/**
 * The tile field — the board as it is printed.
 *
 * One `InstancedMesh` per grid, with per-instance attributes for everything that
 * varies per tile: colour, fold angle, hinge direction, signal, hover, the
 * colour-blind pattern, and a scale used for the shift when a tile changes.
 *
 * ---------------------------------------------------------------------------
 * Three decisions worth explaining
 * ---------------------------------------------------------------------------
 * **One geometry, not one per orientation.** A triangular tiling has up-pointing
 * and down-pointing tiles, which look like two shapes. They are one shape: rotating
 * an equilateral triangle by 180° in its own plane turns it over. So the geometry is
 * built once from the up-pointing ring and down-pointing cells get a 180° rotation
 * baked into their instance matrix. That keeps a single draw call per grid and a
 * single mapping from cell to instance, which everything else here relies on.
 *
 * **Picking is analytic, not a raycast.** `InstancedMesh.raycast` walks every
 * instance and tests its geometry — on the thin triangle tiles that is both slow and
 * inaccurate at the seams. Instead the pointer ray is intersected with the board's
 * own plane and the hit is resolved by `grid.pickAt`, the same maths the geometry
 * validator checks, so a click can never land on a tile that is not there.
 *
 * **The impression, not a reflection.** The previous version drew a mirrored copy of
 * the field below the floor to fake a glossy reflection. A mirror belongs to a
 * different visual language; what a printed sheet actually does is cast a hard,
 * offset, slightly darker impression of itself on the sheet under it. So the second
 * mesh shares this field's geometry, attributes *and* colour buffer, is translated
 * by a small offset, and is drawn flat in a darkened tone. Sharing the colour
 * buffer is what makes it free: the fold, the signal and the blend are written once
 * and read by both meshes.
 */

import {
  BufferGeometry, Color, DoubleSide, DynamicDrawUsage, ExtrudeGeometry, Group,
  InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, Plane,
  Ray, Raycaster, Shape, Vector3,
} from 'three';
import { MAX_NEIGHBORS } from '../grid/grid.js';
import { linearToOklab, oklabToLinear, toGamut } from '../color/color.js';
import { insetPolygon, ringRadius } from '../grid/polygon.js';
import { createTileMaterial, retuneTileMaterial, TILE_ATTRS } from './materials.js';

export { insetPolygon, ringRadius };

export class TileField {
  /**
   * @param {object} opts
   * @param {object} opts.grid
   * @param {object} opts.palette
   * @param {object} opts.theme
   * @param {number} [opts.patternStrength]
   */
  constructor({ grid, palette, theme, patternStrength = 0 }) {
    this.grid = grid;
    this.palette = palette;
    this.theme = theme;
    this.group = new Group();
    this.group.name = 'plate';

    this.count = grid.cells.length;
    /** cell index → instance index (instance i is cells[i]) */
    this.cellToInstance = new Int32Array(grid.count).fill(-1);
    for (let i = 0; i < this.count; i++) this.cellToInstance[grid.cells[i]] = i;

    this._buildGeometry();
    // The material needs the ring the geometry was actually built from, so the
    // keyline follows the drawn edge exactly rather than an idealised outline.
    this.material = createTileMaterial(theme, {
      ring: this.insetRing,
      patternStrength,
    });
    this._buildMesh();

    this.state = {
      colorFrom: new Float32Array(this.count * 3),
      colorTo: new Float32Array(this.count * 3),
      blend: new Float32Array(this.count),
      fold: new Float32Array(this.count),
      foldT: new Float32Array(this.count),
      foldMax: new Float32Array(this.count),
      glow: new Float32Array(this.count),
      scale: new Float32Array(this.count).fill(1),
      scaleTarget: new Float32Array(this.count).fill(1),
    };

    this._raycaster = new Raycaster();
    this._plane = new Plane(new Vector3(0, 1, 0), 0);
    this._hit = new Vector3();
    this._dirty = { fold: false, glow: false, hover: false, scale: false };
  }

  // -------------------------------------------------------------------------
  // construction
  // -------------------------------------------------------------------------

  _buildGeometry() {
    const { grid, theme } = this;
    const gap = theme.tile.gap;
    const depth = theme.tile.depth;
    const bevel = theme.tile.bevel;

    // The canonical ring: cell 0's polygon. Every other tile is this shape moved,
    // and on a triangle board sometimes turned over.
    const canonical = this.grid.cells.find((i) => grid.cellPolygon(i)) ?? 0;
    const ring = grid.cellPolygon(canonical);
    this.radius = ringRadius(ring);
    const inset = insetPolygon(ring, gap / 2);
    this.insetRing = inset;
    this.rawRing = ring;

    // Author in the extrude plane: (gx, −gy), because the −90° X rotation below
    // maps local (x, y) to world (x, −y).
    const shape = new Shape();
    shape.moveTo(inset[0], -inset[1]);
    for (let i = 1; i < inset.length / 2; i++) shape.lineTo(inset[i * 2], -inset[i * 2 + 1]);
    shape.closePath();

    const geometry = new ExtrudeGeometry(shape, {
      curveSegments: 1,
      steps: 1,
      depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelOffset: 0,
      bevelSegments: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();

    this.geometry = geometry;
    this.depth = depth;
    this.canonicalCell = canonical;
  }

  _buildMesh() {
    const { grid } = this;
    const mesh = new InstancedMesh(this.geometry, this.material, this.count);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.name = 'plateField';
    mesh.frustumCulled = false;
    // The plate casts; the sheet receives. It does NOT receive, and that is a
    // correctness requirement rather than a saving: a tile darkened by its
    // neighbour's shadow is a tile whose colour is no longer the colour the mixing
    // model computed, and telling two tiles apart is the entire game.
    //
    // The fold is not reflected in the shadow — the depth pass uses its own material
    // and does not get the shader injection — which is a fair trade for not keeping
    // a second injected depth material in step.
    mesh.castShadow = true;
    mesh.receiveShadow = false;

    const m = new Matrix4();
    const fold = new Float32Array(this.count);
    const hinge = new Float32Array(this.count * 2);
    const scale = new Float32Array(this.count).fill(1);
    const glow = new Float32Array(this.count);
    const pattern = new Float32Array(this.count);
    const radius = new Float32Array(this.count);
    const seed = new Float32Array(this.count);
    const hover = new Float32Array(this.count);

    const center = grid.center;
    const isTriangle = grid.type === 'triangle';
    // Seed the colour buffer with the first *pigment*, not the empty mixture at
    // index 0. The empty entry is white by definition, so seeding with it makes the
    // board flash white for the frame before the first setColors.
    const seedEntry = this.palette.entries[1] ?? this.palette.entries[0];

    for (let i = 0; i < this.count; i++) {
      const cell = grid.cells[i];
      const c = grid.cellCenter(cell);
      const { col, row } = grid.coordsOf(cell);
      // Grid space is y-down and the world is y-up; mapping grid y straight onto
      // world z keeps row 0 at z = 0 with rows running away from the camera.
      const wx = c.x - center.x;
      const wz = c.y - center.y;
      m.makeRotationY(isTriangle && (col + row) % 2 === 1 ? Math.PI : 0);
      m.setPosition(wx, 0, wz);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, new Color(seedEntry.linear[0], seedEntry.linear[1], seedEntry.linear[2]));

      // The crease runs along a per-tile random direction, so a region folding at
      // once does not look like one sheet of paper — it looks like a shingled roof.
      // Deterministic per tile, so a replay folds the same way.
      const a = (((cell * 2654435761) % 1000) / 1000) * Math.PI * 2;
      hinge[i * 2] = Math.cos(a);
      hinge[i * 2 + 1] = Math.sin(a);
      pattern[i] = PATTERN_ID[this.palette.entries[0].pattern] ?? 0;
      radius[i] = this.radius;
      seed[i] = ((cell * 40503) % 997) / 997;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.setUsage(DynamicDrawUsage);

    const inst = (name, arr, size) => {
      const attr = new InstancedBufferAttribute(arr, size);
      attr.setUsage(DynamicDrawUsage);
      this.geometry.setAttribute(name, attr);
      return attr;
    };
    this.attrs = {
      fold: inst(TILE_ATTRS.fold, fold, 1),
      hinge: inst(TILE_ATTRS.hinge, hinge, 2),
      scale: inst(TILE_ATTRS.scale, scale, 1),
      glow: inst(TILE_ATTRS.glow, glow, 1),
      pattern: inst(TILE_ATTRS.pattern, pattern, 1),
      radius: inst(TILE_ATTRS.radius, radius, 1),
      seed: inst(TILE_ATTRS.seed, seed, 1),
      hover: inst(TILE_ATTRS.hover, hover, 1),
    };

    this.mesh = mesh;
    this.group.add(mesh);
  }

  /**
   * Build the plate's impression: a flat, offset, darkened copy sharing this
   * field's geometry, attributes and colour buffer.
   *
   * Sharing the colour buffer is what makes it free — the fold, the signal and the
   * blend are written once by this field and read by both meshes, so the impression
   * is always in step without a second update pass. Three tracks upload state per
   * attribute object, so assigning the same `instanceColor` to both meshes is
   * correct and uploads once.
   */
  createImpression({ dx = null, dz = null, alpha = null, tone = 0.42 } = {}) {
    if (this.impression) return this.impression;
    const t = this.theme.plate.impression;
    const offX = dx ?? t.x;
    const offZ = dz ?? t.z;

    const geo = new BufferGeometry();
    for (const [name, attr] of Object.entries(this.geometry.attributes)) {
      geo.setAttribute(name, attr); // shared objects — one upload serves both
    }
    if (this.geometry.index) geo.setIndex(this.geometry.index);

    const mat = new MeshBasicMaterial({
      // The tile colour is multiplied by this tone, so the impression is the same
      // ink at a darker value rather than a black smudge.
      color: new Color(tone, tone, tone),
      transparent: true,
      opacity: alpha ?? t.alpha,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
    });

    const mesh = new InstancedMesh(geo, mat, this.count);
    // Copy the plate's matrices and push each one down and sideways. Composing a
    // translation on the right keeps the triangle parity rotation intact.
    const src = this.mesh.instanceMatrix.array;
    const dst = mesh.instanceMatrix.array;
    dst.set(src);
    const m = new Matrix4();
    for (let i = 0; i < this.count; i++) {
      m.makeTranslation(offX, -(this.depth + 0.008), offZ);
      const inst = new Matrix4().fromArray(dst, i * 16).multiply(m);
      inst.toArray(dst, i * 16);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = this.mesh.instanceColor; // same buffer, same updates
    mesh.name = 'plateImpression';
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;

    this.impression = { mesh, material: mat, geometry: geo, offset: { x: offX, z: offZ } };
    return this.impression;
  }

  // -------------------------------------------------------------------------
  // colours
  // -------------------------------------------------------------------------

  /**
   * Set the board's colours from a per-cell palette index.
   *
   * Colours travel through OKLab rather than being linearly interpolated in RGB, so
   * a blue→yellow change stays saturated all the way across instead of sagging
   * through grey. That matters more here than in most games: the whole puzzle is the
   * difference between two colours, and a transition that passes through mud makes
   * the destination harder to read at exactly the moment the player is checking it.
   */
  setColors(colors, { animate = true, duration = null } = {}) {
    this._blendTime = duration ?? this.theme.tile.blendTime;
    let wrote = false;
    for (let i = 0; i < this.count; i++) {
      const cell = this.grid.cells[i];
      const entry = this.palette.entries[colors[cell]] ?? this.palette.entries[0];
      wrote = this._aim(i, entry, animate) || wrote;
      this.attrs.pattern.array[i] = PATTERN_ID[entry.pattern] ?? 0;
    }
    this.attrs.pattern.needsUpdate = true;
    if (wrote) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Update only the cells that changed, so a move animates just its own region. */
  setCells(colors, cells, { animate = true, duration = null } = {}) {
    this._blendTime = duration ?? this.theme.tile.blendTime;
    let wrote = false;
    for (const cell of cells) {
      const i = this.cellToInstance[cell];
      if (i < 0) continue;
      const entry = this.palette.entries[colors[cell]] ?? this.palette.entries[0];
      wrote = this._aim(i, entry, animate) || wrote;
      this.attrs.pattern.array[i] = PATTERN_ID[entry.pattern] ?? 0;
    }
    this.attrs.pattern.needsUpdate = true;
    if (wrote) this.mesh.instanceColor.needsUpdate = true;
  }

  /**
   * Point one instance at a colour.
   *
   * When `animate` is false the colour is written straight into `instanceColor`
   * *and* the animation state, because nothing else will: the frame loop only
   * touches instances whose blend is still running, so an instance left at blend = 1
   * without a write keeps whatever the buffer held — which is how the whole board
   * once came out white, showing the empty-mixture entry the buffer was seeded with.
   */
  _aim(i, entry, animate) {
    const t = entry.linear;
    if (!animate) {
      this.state.colorFrom[i * 3] = t[0];
      this.state.colorFrom[i * 3 + 1] = t[1];
      this.state.colorFrom[i * 3 + 2] = t[2];
      this.state.colorTo[i * 3] = t[0];
      this.state.colorTo[i * 3 + 1] = t[1];
      this.state.colorTo[i * 3 + 2] = t[2];
      this.state.blend[i] = 1;
      this.mesh.setColorAt(i, _tmpColor.setRGB(t[0], t[1], t[2]));
      return true;
    }
    const cur = this._currentColor(i);
    this.state.colorFrom[i * 3] = cur[0];
    this.state.colorFrom[i * 3 + 1] = cur[1];
    this.state.colorFrom[i * 3 + 2] = cur[2];
    this.state.colorTo[i * 3] = t[0];
    this.state.colorTo[i * 3 + 1] = t[1];
    this.state.colorTo[i * 3 + 2] = t[2];
    this.state.blend[i] = 0;
    return false;
  }

  _currentColor(i) {
    const t = this.state.blend[i];
    if (t >= 1) {
      return [this.state.colorTo[i * 3], this.state.colorTo[i * 3 + 1], this.state.colorTo[i * 3 + 2]];
    }
    const from = [this.state.colorFrom[i * 3], this.state.colorFrom[i * 3 + 1], this.state.colorFrom[i * 3 + 2]];
    const to = [this.state.colorTo[i * 3], this.state.colorTo[i * 3 + 1], this.state.colorTo[i * 3 + 2]];
    const lab = linearToOklab(from);
    const lab2 = linearToOklab(to);
    return oklabToLinear([
      lab[0] + (lab2[0] - lab[0]) * t,
      lab[1] + (lab2[1] - lab[1]) * t,
      lab[2] + (lab2[2] - lab[2]) * t,
    ]);
  }

  // -------------------------------------------------------------------------
  // per-tile effects
  // -------------------------------------------------------------------------

  /** Crease a set of tiles over on their own hinge lines. */
  foldCells(cells, { strength = null, duration = null } = {}) {
    const amp = (strength ?? this.theme.tile.fold) * Math.PI;
    this._foldDuration = duration ?? this.theme.tile.foldTime;
    for (const cell of cells) {
      const i = this.cellToInstance[cell];
      if (i < 0) continue;
      this.state.foldMax[i] = amp;
      this.state.foldT[i] = 1e-4;
      this.state.fold[i] = 0;
    }
    this._dirty.fold = true;
  }

  /** Signal a set of tiles — used on the tiles a move actually changed. */
  pulseCells(cells, amount = 1) {
    for (const cell of cells) {
      const i = this.cellToInstance[cell];
      if (i < 0) continue;
      this.state.glow[i] = Math.max(this.state.glow[i], amount);
      this.state.scaleTarget[i] = 1.03;
    }
    this._dirty.glow = true;
    this._dirty.scale = true;
  }

  /** Mark a set of tiles as the region a click would affect. */
  setHover(cells) {
    const arr = this.attrs.hover.array;
    let changed = false;
    const want = new Set(cells);
    for (let i = 0; i < this.count; i++) {
      const v = want.has(this.grid.cells[i]) ? 1 : 0;
      if (arr[i] !== v) { arr[i] = v; changed = true; }
    }
    if (changed) this._dirty.hover = true;
  }

  clearHover() {
    const arr = this.attrs.hover.array;
    let changed = false;
    for (let i = 0; i < this.count; i++) if (arr[i] !== 0) { arr[i] = 0; changed = true; }
    if (changed) this._dirty.hover = true;
  }

  /** The reveal bar that crosses the sheet when a board loads. */
  setSweep({ y = -999, width = 0.4, strength = 0 } = {}) {
    const u = this.material.userData.uniforms;
    u.uSweepY.value = y;
    u.uSweepWidth.value = width;
    u.uSweepStrength.value = strength;
  }

  // -------------------------------------------------------------------------
  // picking
  // -------------------------------------------------------------------------

  /**
   * Resolve a pointer position to a cell.
   *
   * When the board is tilted — and it tilts under the pointer — intersecting the
   * pointer ray with a world-space y = 0 plane is wrong: the plane is no longer
   * where the tiles are, so every click near an edge lands on the wrong cell. The
   * fix is to carry the ray into the board's own local space and intersect there,
   * which is exact for any rotation the board is wearing.
   *
   * @param {Vector2|{x:number,y:number}} ndc  normalised device coordinates (−1..1)
   * @param {Camera} camera
   * @param {Object3D} [root]  the board's transform, if it is not the identity
   * @returns {number} cell index, or −1
   */
  pick(ndc, camera, root = null) {
    this._raycaster.setFromCamera(ndc, camera);
    let ray = this._raycaster.ray;
    if (root) {
      root.updateWorldMatrix(true, false);
      _inv.copy(root.matrixWorld).invert();
      _ray.copy(ray).applyMatrix4(_inv);
      ray = _ray;
    }
    if (!ray.intersectPlane(this._plane, this._hit)) return -1;
    const { center } = this.grid;
    // local → grid space: undo the (x − cx, z − cy) mapping
    return this.grid.pickAt(this._hit.x + center.x, this._hit.z + center.y);
  }

  /** The connected region containing `cell`, as a cell-index array. */
  regionOf(cell, colors) {
    if (cell < 0) return [];
    const { grid } = this;
    const region = new Int32Array(grid.count);
    const marks = new Int32Array(grid.count).fill(-1);
    const target = colors[cell];
    let n = 0;
    region[n++] = cell;
    marks[cell] = 0;
    for (let head = 0; head < n; head++) {
      const base = region[head] * MAX_NEIGHBORS;
      for (let k = 0; k < MAX_NEIGHBORS; k++) {
        const nb = grid.nbr[base + k];
        if (nb < 0) break;
        if (marks[nb] === 0 || colors[nb] !== target) continue;
        marks[nb] = 0;
        region[n++] = nb;
      }
    }
    return Array.from(region.subarray(0, n));
  }

  // -------------------------------------------------------------------------
  // frame
  // -------------------------------------------------------------------------

  update(dt) {
    const s = this.state;
    const blendStep = this._blendTime ? dt / this._blendTime : 1;
    const foldStep = this._foldDuration ? dt / this._foldDuration : 1;
    let colorDirty = false;

    for (let i = 0; i < this.count; i++) {
      if (s.blend[i] < 1) {
        s.blend[i] = Math.min(1, s.blend[i] + blendStep);
        const t = s.blend[i];
        // smoothstep, so the change settles rather than stopping dead
        const e = t * t * (3 - 2 * t);
        const from = [s.colorFrom[i * 3], s.colorFrom[i * 3 + 1], s.colorFrom[i * 3 + 2]];
        const to = [s.colorTo[i * 3], s.colorTo[i * 3 + 1], s.colorTo[i * 3 + 2]];
        const lab = linearToOklab(from);
        const lab2 = linearToOklab(to);
        const mixed = toGamut(oklabToLinear([
          lab[0] + (lab2[0] - lab[0]) * e,
          lab[1] + (lab2[1] - lab[1]) * e,
          lab[2] + (lab2[2] - lab[2]) * e,
        ]));
        this.mesh.setColorAt(i, _tmpColor.setRGB(mixed[0], mixed[1], mixed[2]));
        colorDirty = true;
        if (s.blend[i] >= 1) {
          s.colorFrom[i * 3] = to[0];
          s.colorFrom[i * 3 + 1] = to[1];
          s.colorFrom[i * 3 + 2] = to[2];
        }
      }

      if (s.foldT[i] > 0 && s.foldT[i] < 1) {
        s.foldT[i] = Math.min(1, s.foldT[i] + foldStep);
        s.fold[i] = Math.sin(s.foldT[i] * Math.PI) * s.foldMax[i];
        this.attrs.fold.array[i] = s.fold[i];
        this._dirty.fold = true;
        if (s.foldT[i] >= 1) {
          s.fold[i] = 0;
          this.attrs.fold.array[i] = 0;
        }
      }

      if (s.glow[i] > 0.001) {
        s.glow[i] = Math.max(0, s.glow[i] - dt * 2.8);
        this.attrs.glow.array[i] = s.glow[i];
        this._dirty.glow = true;
      } else if (s.glow[i] !== 0) {
        s.glow[i] = 0;
        this.attrs.glow.array[i] = 0;
        this._dirty.glow = true;
      }

      if (Math.abs(s.scale[i] - s.scaleTarget[i]) > 1e-4) {
        s.scale[i] += (s.scaleTarget[i] - s.scale[i]) * Math.min(1, dt * 14);
        this.attrs.scale.array[i] = s.scale[i];
        this._dirty.scale = true;
      }
      if (s.scaleTarget[i] !== 1 && Math.abs(s.scale[i] - 1) < 0.02) {
        s.scaleTarget[i] = 1;
      }
    }

    if (colorDirty && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    for (const key of ['fold', 'glow', 'hover', 'scale']) {
      if (this._dirty[key]) {
        this.attrs[key].needsUpdate = true;
        this._dirty[key] = false;
      }
    }
  }

  /** True while any tile is mid-animation — lets the loop idle when nothing moves. */
  get animating() {
    const s = this.state;
    for (let i = 0; i < this.count; i++) {
      if (s.blend[i] < 1 || (s.foldT[i] > 0 && s.foldT[i] < 1) || s.glow[i] > 0.001 ||
          Math.abs(s.scale[i] - s.scaleTarget[i]) > 1e-4) return true;
    }
    return false;
  }

  applyTheme(theme) {
    this.theme = theme;
    retuneTileMaterial(this.material, theme);
    if (this.impression) {
      const t = theme.plate.impression;
      this.impression.material.opacity = t.alpha;
      this.impression.material.needsUpdate = true;
    }
  }

  setPatternStrength(v) {
    this.material.userData.uniforms.uPatternStrength.value = v;
    this.material.userData.patternStrength = v;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
    this.group.clear();
    if (this.impression) {
      this.impression.geometry.dispose();
      this.impression.material.dispose();
      this.impression.mesh.dispose();
      this.impression = null;
    }
  }
}

const _tmpColor = new Color();
const _inv = new Matrix4();
const _ray = new Ray();

/** Pattern names to the id the shader branches on. */
const PATTERN_ID = { none: 0, dots: 1, stripes: 2, hatch: 3 };
