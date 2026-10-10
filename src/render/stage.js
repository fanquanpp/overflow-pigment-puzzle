/**
 * The stage: renderer, camera, lights, paper field and the print pass.
 *
 * ---------------------------------------------------------------------------
 * Why there is no bloom any more
 * ---------------------------------------------------------------------------
 * The previous version lit the board like a product shot — image-based lighting,
 * clearcoat, iridescence, an Unreal bloom pass, a vignette and film grain. All of
 * that says "this is a rendered object", and it was in direct conflict with the
 * interface it sat under. Worse, it fought the puzzle: bloom bleeds a bright colour
 * into its neighbours, and the whole game is telling colours apart.
 *
 * So the renderer runs `NoToneMapping` and the lights sum to roughly one. A matte
 * surface under those conditions reproduces its albedo almost exactly, which means
 * the colour the mixing model computed is the colour on screen. That is not a
 * stylistic preference; it is a correctness requirement of this particular game.
 *
 * ---------------------------------------------------------------------------
 * The print pass
 * ---------------------------------------------------------------------------
 * `RenderPass → OutputPass → PrintPass`. The print pass runs *after* tone mapping
 * and sRGB encoding, which is the opposite of the usual advice and is deliberate: a
 * dot screen, a paper tooth and a misregistration are things that happen to a
 * finished sheet, in ink, on the way to a reader's eye. Simulating them on
 * display-referred pixels is what makes them read as printing rather than as a
 * filter over a render.
 *
 * ---------------------------------------------------------------------------
 * The paper field
 * ---------------------------------------------------------------------------
 * A flat sheet with a printed grid, not a gradient dome. The grid pitch matches the
 * tile spacing, so the composition sits visibly *on* a grid — the single most
 * recognisable thing about the style this is drawn from, and also simply true: the
 * board really is a grid.
 */

import {
  AmbientLight, Color, DirectionalLight, DoubleSide, Euler, HalfFloatType,
  HemisphereLight, Matrix4, Mesh, NoToneMapping, PMREMGenerator, PerspectiveCamera,
  PlaneGeometry, Scene, ShaderMaterial, SRGBColorSpace, Vector2, Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ENV, themeFor } from './themes.js';

const DEG = Math.PI / 180;
// Scratch vector for the framing fit; it runs in a loop and must not allocate.
const _v = new Vector3();

/** Keep the frustum shift inside a sane range; a runaway shift loses the board. */
const clampShift = (v) => Math.min(0.6, Math.max(-0.6, v));

/**
 * The print pass: a dot screen, two-pass misregistration, and paper tooth.
 *
 * Everything here is restrained on purpose. A halftone strong enough to notice at a
 * glance is a halftone strong enough to change the colour of a tile, and this game
 * cannot afford that — so the screen is at a pitch fine enough to read as texture,
 * the misregistration is a fraction of a pixel, and the grain is paper, not film.
 */
const PrintShader = {
  uniforms: {
    tDiffuse: { value: null },
    uPaper: { value: new Color(0xffffff) },
    uInk: { value: new Color(0x000000) },
    uHalftone: { value: 0.1 },
    uHalftoneScale: { value: 1 },
    uMisregistration: { value: 0.0015 },
    uGrain: { value: 0.02 },
    uResolution: { value: new Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uPaper;
    uniform vec3 uInk;
    uniform float uHalftone;
    uniform float uHalftoneScale;
    uniform float uMisregistration;
    uniform float uGrain;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 px = vUv * uResolution;

      // Misregistration: the ink passes are not perfectly aligned. Sampling the
      // channels a fraction of a pixel apart is what a two-pass press does to a
      // hard edge, and it is what stops the board looking vector-clean.
      vec2 off = vec2(uMisregistration, uMisregistration * 0.6);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;

      // The dot screen. Fine pitch, low contrast, applied to luminance so it
      // modulates the print rather than tinting it.
      if (uHalftone > 0.001) {
        float pitch = 3.4 / max(uHalftoneScale, 0.2);
        vec2 cell = fract(px / pitch) - 0.5;
        float dots = 1.0 - smoothstep(0.14, 0.36, length(cell));
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        // only the midtones get screened, which is how a real screen behaves
        float mid = 1.0 - abs(lum * 2.0 - 1.0);
        col = mix(col, mix(col, uPaper, 0.5), dots * uHalftone * mid);
      }

      // Paper tooth.
      if (uGrain > 0.001) {
        col += (hash(px * 0.9) - 0.5) * uGrain;
      }

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

export class Stage {
  constructor(canvas, { theme = 'offset', reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.reducedMotion = reducedMotion;
    this.theme = themeFor(theme);

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    // Print colours are flat. A filmic curve would desaturate exactly the saturated
    // mixtures this game asks the player to tell apart.
    this.renderer.toneMapping = NoToneMapping;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(this.pixelRatio);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(this.theme.camera.fov, 1, 0.1, 400);

    this._setupEnvironment();
    this._setupLights();
    this._setupPaper();
    this._setupComposer();

    this._setupControls();

    this._boardRadius = 6;
    this._ndcShift = { x: 0, y: 0 };
    /** How far the board may tilt and still stay inside its rectangle. Solved per
     *  board by frameBoard; zero until then. */
    this.tiltLimit = 0;
    // The part of the viewport the board is allowed to occupy, as fractions. The
    // menu panel takes one column, the HUD takes a strip top and bottom, and the
    // framing has to fit into what is left rather than into the whole window.
    this._inset = { x0: 0, x1: 1, y0: 0, y1: 1 };
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
    this.applyTheme(this.theme);
  }

  // -------------------------------------------------------------------------

  /**
   * Real canvas control: orbit, zoom, pan.
   *
   * The previous version had a fixed camera and a pointer parallax, which reads as a
   * picture that slides rather than as an object you are looking at. Orbiting is the
   * difference between being shown a board and being handed one — and for a puzzle
   * whose whole content is a layout of coloured tiles, being able to walk around the
   * board is a reading aid, not a flourish.
   *
   * The bounds matter more than the freedom. Distance is clamped so the board can
   * never be lost or clipped, the polar angle stops just short of the poles so the
   * camera cannot end up looking straight down a degenerate up-vector, and `F` (and
   * the button in the HUD) returns to the framing the board was solved for.
   */
  _setupControls() {
    const c = new OrbitControls(this.camera, this.canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.075;
    c.rotateSpeed = 0.85;
    c.zoomSpeed = 0.9;
    c.panSpeed = 0.7;
    c.screenSpacePanning = false;
    c.enablePan = true;
    c.minPolarAngle = 0.06;
    c.maxPolarAngle = Math.PI * 0.48;   // never below the sheet
    c.autoRotateSpeed = 0.35;
    c.target.set(0, 0, 0);
    // Left-drag orbits, wheel zooms, right-drag pans — the defaults, left alone so
    // the gestures match every other 3D viewer the player has used.
    c.mouseButtons = {
      LEFT: 0, MIDDLE: 1, RIGHT: 2,
    };
    this.controls = c;
  }

  /** Whether the camera is currently under the player's control. */
  setControlsEnabled(on, { autoRotate = false } = {}) {
    if (!this.controls) return;
    this.controls.enabled = on;
    this.controls.autoRotate = on && autoRotate;
  }

  /** Return to the framing the board was solved for. */
  resetView() {
    if (!this.controls) return;
    // `reset()` restores the saved position and target, but it does *not* clear a
    // pending damping residual — and its own `update()` then applies whatever is
    // left, so the camera drifts off the saved framing again. Turning damping off for
    // one update makes that update flush the residual and zero it, after which the
    // reset lands exactly where the board was framed.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.reset();
    this.controls.enableDamping = damping;
    this._applyViewOffset(this._ndcShift);
  }

  _setupEnvironment() {
    // A dim, even environment, kept only so folded faces are not pitch black where
    // the key light does not reach. It contributes almost no specular.
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envRT = pmrem.fromScene(room, ENV.blur);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = ENV.intensity;
    room.dispose?.();
    pmrem.dispose();
  }

  _setupLights() {
    // Chosen so a surface facing the key receives roughly 1.0 of light: the board
    // then reproduces its albedo, and the palette on screen is the palette the
    // mixing model computed.
    this.ambient = new AmbientLight(0xffffff, 0.58);
    this.fill = new HemisphereLight(0xffffff, 0x9a948a, 0.20);
    this.key = new DirectionalLight(0xffffff, 0.32);
    this.key.position.set(-4, 7, 5);

    // A real contact shadow. This is the single biggest thing that makes the plate
    // read as an object lying on a sheet rather than as a picture of a plate: the
    // hard offset impression says "printed", and the shadow says "and it is resting
    // here". The map is small because the board is small; the bias values are the
    // ones that keep a thin plate from shadowing itself.
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.near = 0.5;
    this.key.shadow.camera.far = 40;
    const S = 9;
    Object.assign(this.key.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
    this.key.shadow.bias = -0.0015;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 2.2;

    this.scene.add(this.ambient, this.fill, this.key);
  }

  _setupPaper() {
    this.paperMaterial = new ShaderMaterial({
      side: DoubleSide,
      transparent: true,
      uniforms: {
        uPaper: { value: new Color(this.theme.plate.paper) },
        uInk: { value: new Color(this.theme.plate.ink) },
        uGrid: { value: this.theme.plate.gridOpacity },
        uPitch: { value: 1 },
        uExtent: { value: 78 },
        // The sheet is decorated relative to the board rather than to itself, so the
        // marks frame the board wherever the board happens to be sized.
        uBoardR: { value: 6 },
        uViewR: { value: 6 },
        uViewX: { value: 9 },
        uFiber: { value: 0.035 },
        uStripN: { value: 0 },
        uStrip: { value: Array.from({ length: 8 }, () => new Color(0xffffff)) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uPaper, uInk;
        uniform float uGrid, uPitch, uExtent, uBoardR, uViewR, uViewX, uFiber, uStripN;
        uniform vec3 uStrip[8];
        varying vec3 vWorld;

        float hash(vec2 p) {
          p = fract(p * vec2(443.897, 441.423));
          p += dot(p, p + 19.19);
          return fract(p.x * p.y);
        }

        // A rule between two parallel lines, used for crop marks and the strip.
        float rule(float v, float at, float half_, float soft) {
          return 1.0 - smoothstep(half_ - soft, half_ + soft, abs(v - at));
        }

        void main() {
          vec3 p = vWorld;

          // --- the graph grid: three weights, as a drafting sheet has ---------
          vec2 g = abs(fract(p.xz / uPitch) - 0.5) * uPitch;
          float hair = 1.0 - smoothstep(0.006, 0.019, min(g.x, g.y));
          vec2 g5 = abs(fract(p.xz / (uPitch * 5.0)) - 0.5) * (uPitch * 5.0);
          float five = 1.0 - smoothstep(0.010, 0.030, min(g5.x, g5.y));

          vec3 col = uPaper;
          col = mix(col, uInk, hair * uGrid);
          col = mix(col, uInk, five * uGrid * 1.5);

          // --- paper fibre: the thing that stops a flat colour reading as a screen
          float fib = hash(floor(p.xz * 130.0)) - 0.5;
          col += fib * uFiber;

          // --- crop marks: four corner brackets at the sheet's trim -------------
          // Placed against the visible extent rather than the board's radius: a wide
          // board has a large radius and a small visible height, and marks sized to
          // the radius end up off the top and bottom of the screen entirely.
          // At the corners of the visible rectangle, not at a radius from the centre:
          // a wide board covers anything placed at a radius, and the marks are meant
          // to frame the sheet around whatever is on it.
          float t = max(uViewR * 0.007, 0.012);
          float arm = uViewR * 0.11;
          float corner = 0.0;
          for (int sx = -1; sx <= 1; sx += 2) {
            for (int sz = -1; sz <= 1; sz += 2) {
              float x = float(sx) * uViewX * 0.86;
              float z = float(sz) * uViewR * 0.82;
              float vx = rule(p.x, x, t, t * 0.6) * step(abs(p.z - z), arm);
              float vz = rule(p.z, z, t, t * 0.6) * step(abs(p.x - x), arm);
              corner = max(corner, max(vx, vz));
            }
          }
          col = mix(col, uInk, corner * 0.55);

          // --- a registration cross on the centre line of each edge ------------
          float reg = 0.0;
          float rArm = uViewR * 0.07;
          reg = max(reg, rule(p.x, -uViewX * 0.86, t * 1.2, t * 0.7) * step(abs(p.z), rArm));
          reg = max(reg, rule(p.x, uViewX * 0.86, t * 1.2, t * 0.7) * step(abs(p.z), rArm));
          reg = max(reg, rule(p.z, -uViewR * 0.82, t * 1.2, t * 0.7) * step(abs(p.x), rArm));
          reg = max(reg, rule(p.z, uViewR * 0.82, t * 1.2, t * 0.7) * step(abs(p.x), rArm));
          col = mix(col, uInk, reg * 0.5);

          // --- the press control strip: the album's own palette, printed -------
          // A real press sheet carries a strip of the inks in use so the operator can
          // check the run. Printing the album's palette along the edge of the sheet is
          // therefore both the decoration this page wanted and a true statement about
          // what the board is made of.
          if (uStripN > 0.5) {
            float pw = uViewX * 0.14;
            float ph = uViewR * 0.030;
            float x0 = -pw * uStripN * 0.5;
            float zc = uViewR * 0.93;
            // GLSL step(edge, x) is x >= edge ? 1 : 0, so both bounds are written as
            // step(low, value) — writing the lower one as step(value - low, 0.0)
            // inverts it and paints the strip off to one side of where it belongs.
            float inside = step(abs(p.z - zc), ph) * step(x0, p.x) * step(p.x, x0 + pw * uStripN);
            if (inside > 0.5) {
              float idx = floor((p.x - x0) / pw);
              vec3 swatch = uPaper;
              for (int i = 0; i < 8; i++) {
                if (float(i) == idx && float(i) < uStripN) swatch = uStrip[i];
              }
              // a hairline between patches, so it reads as a strip and not a smear
              float seam = 1.0 - smoothstep(0.0, t * 1.4, abs(fract((p.x - x0) / pw) - 0.0));
              swatch = mix(swatch, uInk, seam * 0.5);
              col = mix(col, swatch, 0.92);
            }
          }

          // Fade the sheet out at the edges so it has no visible border.
          float r = length(p.xz) / uExtent;
          gl_FragColor = vec4(col, 1.0 - smoothstep(0.5, 1.0, r));
        }
      `,
    });
    const geo = new PlaneGeometry(180, 180);
    geo.rotateX(-Math.PI / 2);
    this.paper = new Mesh(geo, this.paperMaterial);
    this.paper.position.y = -0.02;
    this.paper.receiveShadow = true;
    this.paper.renderOrder = -3;
    this.scene.add(this.paper);
  }

  /** Give the sheet the album's palette, so the control strip prints the real inks. */
  setPalette(palette) {
    if (!palette || !this.paperMaterial) return;
    const u = this.paperMaterial.uniforms;
    const entries = palette.entries.filter((e) => e.mask !== 0);
    const n = Math.min(8, entries.length);
    for (let i = 0; i < n; i++) u.uStrip.value[i].setRGB(...entries[i].linear);
    u.uStripN.value = n;
  }

  _setupComposer() {
    this.composer = new EffectComposer(this.renderer, undefined, { type: HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Tone mapping and encoding happen here, once.
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    // ...and the sheet is printed afterwards, in ink, on the finished image.
    this.print = new ShaderPass(PrintShader);
    this.composer.addPass(this.print);
  }

  // -------------------------------------------------------------------------
  // framing
  // -------------------------------------------------------------------------

  /**
   * Frame the camera on a board of the given world extent.
   *
   * Fitting the board's *bounding circle* into the field of view is the obvious
   * approach and it frames badly: the board is a flat plane seen from 50-odd
   * degrees above, so its near half is magnified and its far half minified, and the
   * projected outline is a trapezoid whose centre sits well below the screen centre.
   * A circle fit cannot see that because it never projects anything.
   *
   * So this projects, and corrects in two independent ways:
   *
   *   distance     moves the camera along its orbit, so it only changes scale
   *   view offset  shifts the frustum, so it only changes position
   *
   * Keeping them separate is the whole trick. The first attempt moved the camera
   * *and* its aim point together to recentre, which changes the projection
   * non-linearly, overshoots, and diverges — the fit ran away to an aim point
   * sixteen units off the board. `camera.setViewOffset` shifts the sampled window
   * instead, which is exactly linear in screen space, so it converges in one pass
   * and leaves the camera's orientation alone for the parallax to use.
   */
  /**
   * Reserve part of the viewport. Fractions of the viewport, origin top-left.
   * Re-frames the board if one is loaded.
   */
  setViewportInset(inset) {
    const next = { x0: 0, x1: 1, y0: 0, y1: 1, ...inset };
    const same = ['x0', 'x1', 'y0', 'y1'].every((k) => Math.abs(next[k] - this._inset[k]) < 1e-3);
    this._inset = next;
    if (!same && this._lastBoard) {
      this.frameBoard(this._lastBoard.w, this._lastBoard.h, this._lastBoard.opts);
    }
  }

  frameBoard(width, height, opts = {}) {
    // Board size and tilt are a single budget: the fit solves the board to fill this
    // fraction of its rectangle at rest, and whatever is left over becomes the tilt
    // allowance. Raising it makes the board bigger and the tilt smaller — the way to
    // get both is to give the board a bigger rectangle, which means thinner HUD bars,
    // not a different margin.
    const { margin = 0.86, impression = 0.5, tilt = 0 } = opts;
    // The options are kept with the board, because applyTheme re-frames — a theme
    // change alters the field of view — and re-framing with defaults silently drops
    // both the tilt allowance and the impression's footprint.
    this._lastBoard = { w: width, h: height, opts };

    const cam = this.theme.camera;
    const el = cam.elevation * DEG;
    const az = cam.azimuth * DEG;
    this._orbit = { x: 0, y: 0, z: 0 };
    this._boardRadius = Math.max(Math.max(width, height) * 0.5, 1.2);

    const hw = width * 0.5;
    const hh = height * 0.5;
    // The corners at the plate's own height and at the impression's, because the
    // offset copy sits beside the plate and is part of the picture.
    const corners = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push([sx * hw, 0, sz * hh]);
        corners.push([sx * hw + impression, 0, sz * hh + impression]);
      }
    }

    // The rectangle the board may occupy.
    const ins = this._inset;
    const halfW = Math.max(0.12, (ins.x1 - ins.x0) * 0.5);
    const halfH = Math.max(0.12, (ins.y1 - ins.y0) * 0.5);
    const target = Math.min(halfW, halfH) * 2 * margin;
    const targetX = (ins.x0 + ins.x1) - 1;   // NDC centre of the visible rect
    const targetY = 1 - (ins.y0 + ins.y1);

    /**
     * Largest distance from the visible rect's centre to any projected corner, over
     * a set of board rotations. This is the only measurement the fit uses.
     */
    const extentAt = (poses) => {
      let worst = 1e-3;
      for (const [tx, tz] of poses) {
        let rot = null;
        if (tx !== 0 || tz !== 0) {
          rot = new Matrix4().makeRotationFromEuler(new Euler(tx, 0, tz, 'XYZ'));
        }
        for (const c of corners) {
          const p = rot ? _v.set(c[0], c[1], c[2]).applyMatrix4(rot) : _v.set(c[0], c[1], c[2]);
          p.project(this.camera);
          worst = Math.max(worst, p.x - targetX, targetX - p.x, p.y - targetY, targetY - p.y);
        }
      }
      return worst;
    };

    // --- pass one: fit the board at rest, as large as the rectangle allows -----
    let dist = (this._boardRadius * 1.5) / Math.tan(cam.fov * DEG * 0.5) * cam.distance;
    let shift = { x: 0, y: 0 };

    for (let pass = 0; pass < 4; pass++) {
      this._placeCamera(dist, el, az);
      this._applyViewOffset(shift);
      // Measure both the extent and the centre offset at rest.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of corners) {
        const v = _v.set(c[0], c[1], c[2]).project(this.camera);
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      }
      const extent = Math.max(maxX - targetX, targetX - minX, maxY - targetY, targetY - minY) || 1e-3;
      dist *= extent / target;
      const cx = (minX + maxX) * 0.5 - targetX;
      const cy = (minY + maxY) * 0.5 - targetY;
      // A window offset of s moves the content by −s in NDC, so add the residual.
      shift = { x: clampShift(shift.x + cx), y: clampShift(shift.y - cy) };
      if (Math.abs(extent - target) < 0.006 && Math.abs(cx) < 0.006 && Math.abs(cy) < 0.006) break;
    }

    // --- pass two: how far may it tilt before it leaves the rectangle? ---------
    //
    // Deriving the tilt from the board, rather than shrinking the board to fit a
    // fixed tilt, is the difference between a board that fills the screen and one
    // that looks like it was sized for the worst case and never recovered. The board
    // is now as large as the rectangle allows at rest, and the tilt is whatever
    // still fits — which on a small board is the full amount and on a large one is
    // less, without either being a special case.
    const tiltPoses = (t) => [
      [t, 0], [-t, 0], [0, t], [0, -t],
      [t, t], [t, -t], [-t, t], [-t, -t],
    ];
    let limit = tilt;
    if (limit > 0) {
      for (let i = 0; i < 4; i++) {
        const ext = extentAt(tiltPoses(limit));
        if (ext <= target) break;
        limit = Math.max(0, limit * (target / ext));
      }
    }
    this.tiltLimit = limit;

    this._camTarget = { dist, el, az };
    this._ndcShift = shift;
    this._placeCamera(dist, el, az);
    this._applyViewOffset(shift);

    // The orbit bounds follow the board, so zooming cannot lose it, and the framed
    // camera is saved as the state `resetView` returns to. Saving it here rather than
    // reconstructing it later is what makes the reset exact: OrbitControls keeps its
    // own spherical state and damping residual, and writing the camera position by
    // hand does not clear them — the reset would drift back.
    if (this.controls) {
      this.controls.minDistance = dist * 0.42;
      this.controls.maxDistance = dist * 2.6;
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      this.controls.saveState();
    }
    if (this.paperMaterial) {
      const u = this.paperMaterial.uniforms;
      u.uBoardR.value = this._boardRadius;
      // Half the visible height at the board's plane: what the camera can actually
      // see, which is what the sheet's marks have to be sized against. A wide board
      // has a large radius and a small visible height, and marks sized to the radius
      // end up off the top and bottom of the screen entirely.
      const halfH = dist * Math.tan(cam.fov * DEG * 0.5);
      u.uViewR.value = halfH * 0.94;
      u.uViewX.value = halfH * this.camera.aspect * 0.94;
    }
  }

  /** Shift the frustum so the board is centred, without turning the camera. */
  _applyViewOffset(shift) {
    if (!shift || (Math.abs(shift.x) < 1e-4 && Math.abs(shift.y) < 1e-4)) {
      this.camera.clearViewOffset();
      return;
    }
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.camera.setViewOffset(w, h, (shift.x * w) / 2, (shift.y * h) / 2, w, h);
  }

  _placeCamera(dist, el, az) {
    const o = this._orbit ?? { x: 0, y: 0, z: 0 };
    this.camera.position.set(
      o.x + Math.sin(az) * Math.cos(el) * dist,
      o.y + Math.sin(el) * dist,
      o.z + Math.cos(az) * Math.cos(el) * dist
    );
    this.camera.lookAt(o.x, o.y, o.z);
  }

  _applyCamera() {
    const t = this._camTarget;
    if (!t) { this._placeCamera(12, 0.9, -0.4); return; }
    this._placeCamera(t.dist, t.el, t.az);
    this._applyViewOffset(this._ndcShift);
  }

  /** A small parallax on pointer move: the sheet is on a table, not a screen. */
  setParallax(nx, ny) {
    if (this.reducedMotion) return;
    const t = this._camTarget;
    if (!t) return;
    this._placeCamera(t.dist, t.el + ny * 0.045, t.az + nx * 0.08);
    this._applyViewOffset(this._ndcShift);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._applyViewOffset(this._ndcShift);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    if (this.print) this.print.uniforms.uResolution.value.set(w, h);
  }

  applyTheme(theme) {
    this.theme = theme;
    const p = this.print.uniforms;
    p.uPaper.value.set(theme.plate.paper);
    p.uInk.value.set(theme.plate.ink);
    p.uHalftone.value = theme.plate.halftone;
    p.uHalftoneScale.value = theme.plate.halftoneScale;
    p.uMisregistration.value = theme.plate.misregistration;
    p.uGrain.value = this.reducedMotion ? 0 : theme.plate.grain;

    const u = this.paperMaterial.uniforms;
    u.uPaper.value.set(theme.plate.paper);
    u.uInk.value.set(theme.plate.ink);
    u.uGrid.value = theme.plate.gridOpacity;
    u.uPitch.value = theme.plate.gridScale / 7;
    this.scene.background = new Color(theme.plate.paper);

    this.key.color.set(0xffffff);
    this.camera.fov = theme.camera.fov;
    this.camera.updateProjectionMatrix();
    // A theme changes the field of view and the camera angles, so the framing has
    // to be re-solved rather than re-applied.
    if (this._lastBoard) this.frameBoard(this._lastBoard.w, this._lastBoard.h, this._lastBoard.opts);
    else this._applyCamera();
  }

  add(object) { this.scene.add(object); }
  remove(object) { this.scene.remove(object); }

  render(dt) {
    // Damping has to be stepped, and stepping it also applies the auto-rotate.
    if (this.controls?.enabled) this.controls.update();
    this.composer.render(dt);
  }

  dispose() {
    this.controls?.dispose();
    window.removeEventListener('resize', this._onResize);
    this.envRT?.dispose();
    this.composer?.dispose?.();
    this.renderer.dispose();
  }
}
