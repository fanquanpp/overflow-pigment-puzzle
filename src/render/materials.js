/**
 * Tile material — a printed ink patch.
 *
 * Built as a `MeshStandardMaterial` with a shader injection. The physical model is
 * kept for one reason only: the tiles are lit objects, and a matte diffuse surface
 * under a key light is the cheapest honest way to make flat plates read as flat
 * plates. Everything that made the previous version glossy — metalness, clearcoat,
 * iridescence — is gone, because gloss is a way of saying "this is a rendered
 * object" and these are supposed to be *printed*.
 *
 * What is injected:
 *
 *   keyline    the ink outline every printed patch has, drawn from the tile's own
 *              ring so it follows the tile's real outline instead of being faked
 *              with a distance-to-centre circle
 *   reverse    a folded tile shows its underside as paper rather than as more ink,
 *              because a fold is a physical event on a sheet
 *   signal     the one red. The tile under the pointer gets a red edge; a tile
 *              the pointer just landed on flashes one. Both are flat colour, not glow — a
 *              signal that glows stops being a signal and becomes an effect.
 *   pattern    the colour-blind overlay, which in this visual language is also the
 *              most idiomatic thing on screen: a dot screen, a line screen, a
 *              cross-hatch. Printers solved this problem first.
 */

import { Color, DoubleSide, MeshStandardMaterial, Vector2 } from 'three';

export const TILE_ATTRS = {
  fold: 'aFold',
  hinge: 'aHinge',
  scale: 'aScale',
  glow: 'aGlow',
  pattern: 'aPattern',
  radius: 'aRadius',
  seed: 'aSeed',
  hover: 'aHover',
};

/** Most edges any of the four tile shapes has. */
const MAX_RING = 8;

const VERTEX_HEAD = /* glsl */ `
attribute float aFold;
attribute vec2  aHinge;
attribute float aScale;
attribute float aGlow;
attribute float aPattern;
attribute float aRadius;
attribute float aSeed;
attribute float aHover;

varying vec2  vTile;
varying float vPattern;
varying float vGlow;
varying float vHover;
varying float vRadius;
varying float vSeed;
varying vec3  vPlate;
// The world-space "how much does this fragment face up" (0 side, 1 top), used to
// darken the plate's sides. It must be world space, not the fragment stage's
// view-space normal: that one is camera-relative, so a world-up face reads as
// sideways the moment the camera looks straight down — which darkened the whole
// board exactly when it was viewed from overhead.
varying float vFaceUp;

vec3 overflowRotate(vec3 p, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}
`;

const VERTEX_NORMAL = /* glsl */ `
#include <beginnormal_vertex>
{
  // The normal has to turn with the surface. Leaving it flat while the geometry
  // folds lights the crease as though nothing moved, and the fold reads as a
  // wobble instead of a crease.
  vec3 hinge = normalize(vec3(aHinge.x, 0.0, aHinge.y) + vec3(1e-5, 0.0, 0.0));
  vec3 perp  = vec3(-hinge.z, 0.0, hinge.x);
  float side = step(0.0, dot(position, perp));
  vec3 nRot = overflowRotate(objectNormal, hinge, aFold * side);
  objectNormal = normalize(mix(objectNormal, nRot, side));
}
`;

const VERTEX_POSITION = /* glsl */ `
#include <begin_vertex>
{
  vec3 hinge = normalize(vec3(aHinge.x, 0.0, aHinge.y) + vec3(1e-5, 0.0, 0.0));
  vec3 perp  = vec3(-hinge.z, 0.0, hinge.x);
  float side = step(0.0, dot(position, perp));
  float angle = aFold * side;
  float d = dot(position, perp);

  vec3 folded = transformed;
  if (abs(angle) > 1e-4) {
    float c = cos(angle);
    float s = sin(angle);
    vec3 o = perp * d + vec3(0.0, transformed.y, 0.0);
    vec3 oRot = perp * (d * c - transformed.y * s) + vec3(0.0, d * s + transformed.y * c, 0.0);
    folded += (oRot - o) * side;
  }

  transformed = folded * aScale;

  vTile = position.xz;
  vPattern = aPattern;
  vGlow = aGlow;
  vHover = aHover;
  vRadius = aRadius;
  vSeed = aSeed;
#ifdef USE_INSTANCING
  vPlate = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vFaceUp = clamp(normalize((modelMatrix * instanceMatrix * vec4(objectNormal, 0.0)).xyz).y, 0.0, 1.0);
#else
  vPlate = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vFaceUp = clamp(normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz).y, 0.0, 1.0);
#endif
}
`;

const FRAGMENT_HEAD = /* glsl */ `
varying vec2  vTile;
varying float vPattern;
varying float vGlow;
varying float vHover;
varying float vRadius;
varying float vSeed;
varying vec3  vPlate;
varying float vFaceUp;

uniform vec3  uInk;
uniform vec3  uPaper;
uniform vec3  uSignal;
uniform float uKeyline;
uniform float uEdgeTone;
uniform float uPatternStrength;
uniform vec3  uSweepColor;
uniform float uSweepY;
uniform float uSweepWidth;
uniform float uSweepStrength;
// The tile's own outline, in cell-local space. Every instance shares it, so this is
// a handful of uniforms rather than a per-instance attribute.
uniform int   uRingN;
uniform vec2  uRing[${MAX_RING}];
`;

const FRAGMENT_BODY = /* glsl */ `
{
  // ---- keyline: the ink outline of the patch -------------------------------
  // Distance from this fragment to the tile's own boundary, taken as the smallest
  // distance to any edge. Exact for a convex ring.
  float edge = 1e9;
  for (int i = 0; i < ${MAX_RING}; i++) {
    if (i >= uRingN) break;
    vec2 a = uRing[i];
    vec2 b = uRing[(i + 1) % ${MAX_RING}];
    vec2 e = b - a;
    float len = max(length(e), 1e-5);
    float d = abs(dot(vTile - a, normalize(vec2(e.y, -e.x))));
    edge = min(edge, d);
  }

  float key = 1.0 - smoothstep(uKeyline * 0.7, uKeyline * 1.3, edge);
  diffuseColor.rgb = mix(diffuseColor.rgb, uInk, key * 0.92);

  // ---- the plate's edge ----------------------------------------------------
  // The vertical sides are printed in the same ink but read darker, which is how a
  // screen-printed patch on a thick board actually looks and the cheapest way to
  // make the plate's thickness legible. Lighting alone would not do it: with the
  // lights balanced for colour fidelity the sides come out almost as bright as the
  // face, and the board flattens into a decal.
  //
  // The test is world-space (vFaceUp), never the fragment stage's view-space
  // normal.y: the latter makes a world-up face look sideways as soon as the camera
  // looks straight down, which darkened the board precisely from overhead.
  diffuseColor.rgb *= mix(uEdgeTone, 1.0, smoothstep(0.25, 0.85, vFaceUp));

  // ---- the folded underside reads as paper, not as ink ---------------------
  if (!gl_FrontFacing) {
    diffuseColor.rgb = mix(diffuseColor.rgb, uPaper, 0.86);
    diffuseColor.rgb = mix(diffuseColor.rgb, uInk, key * 0.5);
  }

  // ---- colour-blind pattern -----------------------------------------------
  if (uPatternStrength > 0.001 && vPattern > 0.5) {
    vec2 p = vTile / max(vRadius, 1e-4);
    float pat = 0.0;
    if (vPattern < 1.5) {
      vec2 g = fract(p * 4.0) - 0.5;
      pat = 1.0 - smoothstep(0.16, 0.30, length(g));
    } else if (vPattern < 2.5) {
      pat = smoothstep(0.38, 0.50, abs(fract(p.x * 3.2) - 0.5));
    } else {
      pat = smoothstep(0.38, 0.50, abs(fract((p.x + p.y) * 2.6) - 0.5));
    }
    float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 mark = lum > 0.42 ? uInk : uPaper;
    diffuseColor.rgb = mix(diffuseColor.rgb, mark, pat * uPatternStrength * 0.62);
  }

  // ---- the signal red -----------------------------------------------------
  // The pointer marks the one tile it is on; the pulse marks the tile a move was
  // launched from. Both are drawn as an edge band, which is how a printed diagram
  // highlights something.
  float band = 1.0 - smoothstep(uKeyline * 1.15, uKeyline * 2.8, edge);
  if (vHover > 0.5) {
    diffuseColor.rgb = mix(diffuseColor.rgb, uSignal, band * 0.95);
    diffuseColor.rgb = mix(diffuseColor.rgb, uSignal, 0.09);
  }
  if (vGlow > 0.001) {
    diffuseColor.rgb = mix(diffuseColor.rgb, uSignal, band * vGlow);
  }

  // ---- the reveal sweep ---------------------------------------------------
  if (uSweepStrength > 0.001) {
    float s = exp(-pow((vPlate.y - uSweepY) / max(uSweepWidth, 1e-4), 2.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, uSweepColor, clamp(s * uSweepStrength, 0.0, 1.0));
  }

  totalEmissiveRadiance = vec3(0.0);
}
`;

/**
 * Build the tile material for a theme.
 *
 * @param {object} theme
 * @param {object} [opts]
 * @param {Float32Array|number[]} [opts.ring]  the tile outline, flat [x, y, …]
 * @param {number} [opts.patternStrength]
 */
export function createTileMaterial(theme, { ring = null, patternStrength = 0 } = {}) {
  const t = theme.tile;
  const ink = new Color(theme.plate.ink);
  const paper = new Color(theme.plate.paper);
  const signal = new Color(theme.css.red);

  const material = new MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: t.roughness,
    envMapIntensity: 0.55,
    // Both faces are visible the moment a tile folds, and the underside is part of
    // the design rather than an artefact.
    side: DoubleSide,
  });

  const ringN = Math.min(MAX_RING, ring ? Math.floor(ring.length / 2) : 0);
  // A vec2 array uniform uploads through Vector2.toArray(); plain {x, y} objects
  // throw inside three's uniform flattener. Slots past ringN are padded with the
  // FIRST vertex, not (0,0): the fragment loop's wrap segment reads index ringN,
  // and a (0,0) there draws a keyline from the ring's last corner to the tile
  // centre — on a square, a full corner-to-centre diagonal. Padding with the
  // first vertex makes the wrap segment the ring's real closing edge.
  const ringArray = [];
  for (let i = 0; i < MAX_RING; i++) {
    const px = ring && i * 2 + 1 < ring.length ? ring[i * 2] : (ring && ring.length >= 2 ? ring[0] : 0);
    const py = ring && i * 2 + 1 < ring.length ? ring[i * 2 + 1] : (ring && ring.length >= 2 ? ring[1] : 0);
    ringArray.push(new Vector2(px, py));
  }

  const uniforms = {
    uInk: { value: ink },
    uPaper: { value: paper },
    uSignal: { value: signal },
    uKeyline: { value: t.keyline },
    uEdgeTone: { value: t.edgeTone ?? 0.6 },
    uPatternStrength: { value: patternStrength },
    uSweepColor: { value: signal.clone() },
    uSweepY: { value: -999 },
    uSweepWidth: { value: 0.4 },
    uSweepStrength: { value: 0 },
    uRingN: { value: ringN },
    uRing: { value: ringArray },
  };

  material.userData.uniforms = uniforms;
  material.userData.patternStrength = patternStrength;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERTEX_HEAD + shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', VERTEX_NORMAL)
      .replace('#include <begin_vertex>', VERTEX_POSITION);
    shader.fragmentShader = FRAGMENT_HEAD + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      FRAGMENT_BODY
    );
  };

  // The injection depends on the theme and on the pattern setting, and a program
  // built for one must never be reused for the other.
  material.customProgramCacheKey = () =>
    `overflow-plate-${theme.id}-${ringN}-${patternStrength > 0.001 ? 'pat' : 'nopat'}`;

  return material;
}

/** Push a new theme's ink values into an existing material, in place. */
export function retuneTileMaterial(material, theme) {
  const t = theme.tile;
  material.roughness = t.roughness;
  material.envMapIntensity = 0.55;
  const u = material.userData.uniforms;
  u.uInk.value.set(theme.plate.ink);
  u.uPaper.value.set(theme.plate.paper);
  u.uSignal.value.set(theme.css.red);
  u.uSweepColor.value.set(theme.css.red);
  u.uKeyline.value = t.keyline;
  u.uEdgeTone.value = t.edgeTone ?? 0.6;
  material.needsUpdate = true;
}
