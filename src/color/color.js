/**
 * Colour science, implemented once and used everywhere.
 *
 * Three spaces, each with a job:
 *
 *   sRGB        what goes in the DOM, what a designer types as a hex string.
 *   linear sRGB what light actually adds up in. Every blend, every material
 *               colour, every shader constant lives here.
 *   OKLab       perceptually uniform. Used for measuring "are these two palette
 *               colours far enough apart to be told apart", for the UI's
 *               gradients, and for the accessibility pass that nudges a palette
 *               until it is separable under colour-vision deficiency.
 *
 * The OKLab matrices are Björn Ottosson's published constants; they are written
 * out rather than derived because they are a least-squares fit to real data and
 * there is nothing to derive them from.
 *
 * Deliberately NOT here: pigment mixing. That is a different problem with a
 * different model — see pigment.js.
 */

// --- transfer functions ----------------------------------------------------

/** sRGB electro-optical transfer function, per channel, on [0,1]. */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Inverse of {@link srgbToLinear}. */
export function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function rgbToLinear(rgb) {
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
}

export function linearToRgb(rgb) {
  return [linearToSrgb(rgb[0]), linearToSrgb(rgb[1]), linearToSrgb(rgb[2])];
}

// --- OKLab -----------------------------------------------------------------

export function linearToOklab([r, g, b]) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

export function oklabToLinear([L, a, b]) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

export const rgbToOklab = (rgb) => linearToOklab(rgbToLinear(rgb));
export const oklabToRgb = (lab) => linearToRgb(oklabToLinear(lab));

/** OKLab → OKLCh. Hue is in radians, chroma is the a/b radius. */
export function oklabToOklch([L, a, b]) {
  return [L, Math.hypot(a, b), Math.atan2(b, a)];
}

export function oklchToOklab([L, C, h]) {
  return [L, C * Math.cos(h), C * Math.sin(h)];
}

/**
 * Perceptual distance. OKLab is roughly Euclidean-comparable, so plain distance
 * is a usable stand-in for a full CIEDE2000 — and unlike ΔE2000 it composes with
 * the gamut-clamping search below without a special case.
 */
export function deltaE(labA, labB) {
  return Math.hypot(labA[0] - labB[0], labA[1] - labB[1], labA[2] - labB[2]);
}

export function contrastRatio(rgbA, rgbB) {
  const lum = (rgb) => {
    const [r, g, b] = rgbToLinear(rgb);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(rgbA);
  const b = lum(rgbB);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

// --- interpolation ---------------------------------------------------------

/** Component-wise lerp of two linear-RGB triples. */
export function mixLinear(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Interpolate two linear-RGB colours through OKLab.
 *
 * Straight linear lerp between two saturated colours sags through a muddy
 * midpoint (blue→yellow goes grey). Going through OKLab keeps the midpoint
 * saturated and the perceived brightness even, which is what makes a UI gradient
 * between two palette colours look deliberate rather than washed out.
 */
export function mixOklab(a, b, t) {
  const A = linearToOklab(a);
  const B = linearToOklab(b);
  return oklabToLinear([
    A[0] + (B[0] - A[0]) * t,
    A[1] + (B[1] - A[1]) * t,
    A[2] + (B[2] - A[2]) * t,
  ]);
}

/**
 * Interpolate through OKLCh, taking the short way around the hue circle. Use this
 * when the two colours are different hues and you want the transition to keep its
 * chroma; plain OKLab will cut through the neutral axis.
 */
export function mixOklch(a, b, t) {
  const A = oklabToOklch(linearToOklab(a));
  const B = oklabToOklch(linearToOklab(b));
  let dh = B[2] - A[2];
  // wrap into (−π, π] so the hue travels the short arc
  dh = dh - 2 * Math.PI * Math.round(dh / (2 * Math.PI));
  return oklabToLinear(
    oklchToOklab([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + dh * t])
  );
}

// --- gamut -----------------------------------------------------------------

/**
 * Bring a linear-RGB triple into [0,1] by reducing chroma in OKLCh rather than
 * clipping channels. Clipping shifts hue and flattens contrast; holding lightness
 * and hue and walking chroma down keeps the colour recognisable, which matters
 * because these values become the tile colours the player is asked to distinguish.
 */
export function toGamut(linear, { chromaFloor = 0 } = {}) {
  const clamped = linear.map((c) => Math.min(1, Math.max(0, c)));
  if (linear.every((c) => c >= 0 && c <= 1)) return clamped;

  const [L, C, h] = oklabToOklch(linearToOklab(linear));
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const test = oklabToLinear(oklchToOklab([L, mid, h]));
    if (test.every((c) => c >= -1e-6 && c <= 1 + 1e-6)) lo = mid;
    else hi = mid;
  }
  const out = oklabToLinear(oklchToOklab([L, Math.max(lo, chromaFloor), h]));
  return out.map((c) => Math.min(1, Math.max(0, c)));
}

/**
 * Push a colour's chroma until it is at least `minChroma` away from grey, then
 * bring it back into gamut. Palette colours that are nearly neutral are the ones
 * a colour-blind player loses first, so the accessibility pass raises them
 * deliberately instead of hoping the pigment maths produced enough saturation.
 */
export function ensureChroma(linear, minChroma) {
  const lab = linearToOklab(linear);
  const [L, C, h] = oklabToOklch(lab);
  if (C >= minChroma) return toGamut(linear);
  return toGamut(oklabToLinear(oklchToOklab([L, minChroma, h])));
}

/**
 * Scale lightness so the colour sits in a target band, keeping hue and chroma.
 * Applied to display colours so that no tile is so dark it reads as black or so
 * light it disappears into a bright background.
 */
export function fitLightness(linear, [lo, hi]) {
  const [, C, h] = oklabToOklch(linearToOklab(linear));
  const L = linearToOklab(linear)[0];
  const target = Math.min(hi, Math.max(lo, L));
  if (target === L) return linear;
  return toGamut(oklabToLinear(oklchToOklab([target, C, h])));
}

// --- hex ------------------------------------------------------------------

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Parse `#rgb`, `#rrggbb` or `#rrggbbaa` into an sRGB triple on [0,1]. */
export function parseHex(hex) {
  const m = HEX_RE.exec(String(hex).trim());
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  let s = m[1];
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  else if (s.length === 8) s = s.slice(0, 6);
  return [
    parseInt(s.slice(0, 2), 16) / 255,
    parseInt(s.slice(2, 4), 16) / 255,
    parseInt(s.slice(4, 6), 16) / 255,
  ];
}

const hex2 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');

/** sRGB triple → `#rrggbb`. */
export function toHex(rgb) {
  return `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`;
}

/** Linear-RGB triple → `#rrggbb`, applying the sRGB transfer curve first. */
export function linearToHex(linear) {
  return toHex(linearToRgb(linear));
}

export function hexToLinear(hex) {
  return rgbToLinear(parseHex(hex));
}

/**
 * Format a linear colour for CSS. Uses `color(srgb ...)` rather than a hex string
 * so no precision is lost to 8-bit rounding — the tile colours come out of a
 * mixing model and rounding them to bytes shifts the very distinctions the puzzle
 * asks the player to make.
 */
export function linearToCss(linear) {
  const [r, g, b] = linear.map((c) => Math.min(1, Math.max(0, c)));
  return `color(srgb ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)})`;
}
