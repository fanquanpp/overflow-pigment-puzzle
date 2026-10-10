/**
 * Pigment mixing.
 *
 * The whole reason this game exists is that "blue + yellow = green" has to be
 * *true*. In sRGB it is not: averaging gives grey, multiplying gives black, and
 * even interpolating in OKLab gives grey, because none of those models know that
 * a blue pigment and a yellow pigment have overlapping reflectance curves.
 *
 * So pigments are modelled by what they physically are: a **reflectance curve**.
 * Three bands (roughly red / green / blue light) is enough to get paint behaviour
 * right, and cheap enough to run in a shader. Mixing uses Kubelka–Munk, which is
 * the standard one-constant approximation of how pigments in a layer combine:
 *
 *     K/S(R) = (1 − R)² / (2R)              absorption/scattering ratio for reflectance R
 *     (K/S)_mix = Σ wᵢ · (K/S)(Rᵢ)          pigments' absorption adds
 *     R_mix = 1 + (K/S)_mix − √((K/S)_mix² + 2(K/S)_mix)
 *
 * With cyan/magenta/yellow reflectances this reproduces the printer's secondaries
 * exactly (magenta+yellow = red, cyan+yellow = green, magenta+cyan = blue) and
 * darkens the triple mixture toward brown — i.e. it behaves like paint.
 *
 * ---------------------------------------------------------------------------
 * The colour state is a SET of pigments
 * ---------------------------------------------------------------------------
 * A tile's colour is which pigments are in it — a bitmask — and the move is
 * "add pigment P". That makes the operation:
 *
 *   closed       P ∪ P is another set, so the palette never leaves the model
 *   commutative  order of adding pigments does not matter
 *   associative  grouping does not matter
 *   idempotent   adding a pigment a tile already has does nothing
 *
 * The first three are what let a player reason about a mixture at all; the fourth
 * is what makes a redundant move free to detect and refuse.
 */

import {
  deltaE, ensureChroma, fitLightness, linearToHex, linearToOklab, oklabToLinear,
  oklabToOklch, oklchToOklab, rgbToLinear, toGamut,
} from './color.js';

/**
 * Pigment catalogue. `reflectance` is the fraction of red / green / blue light the
 * pigment throws back, so a *low* number means it absorbs that band — which is the
 * opposite of how an RGB triple reads, and is exactly why this table exists
 * separately from any colour a designer would type.
 *
 * The values are chosen so that the useful mixtures land on recognisable paint
 * colours; they are eyeballed against real pigments rather than measured.
 */
export const PIGMENTS = {
  cyan: {
    id: 'cyan', name: 'Cyan', nameZh: '青', swatch: '#2fb6c8',
    // phthalo-ish: passes green and blue, swallows red
    reflectance: [0.05, 0.55, 0.82],
  },
  magenta: {
    id: 'magenta', name: 'Magenta', nameZh: '品红', swatch: '#d8388f',
    // crimson-ish: passes red and blue, swallows green
    reflectance: [0.72, 0.08, 0.42],
  },
  yellow: {
    id: 'yellow', name: 'Yellow', nameZh: '藤黄', swatch: '#f2c53d',
    // gamboge: passes red and green, swallows blue
    reflectance: [0.97, 0.86, 0.05],
  },
  white: {
    id: 'white', name: 'White', nameZh: '铅白', swatch: '#f6f3ec',
    reflectance: [0.97, 0.96, 0.94],
  },
  black: {
    id: 'black', name: 'Ink', nameZh: '松烟', swatch: '#2a2b33',
    reflectance: [0.05, 0.05, 0.06],
  },
  vermilion: {
    id: 'vermilion', name: 'Vermilion', nameZh: '朱砂', swatch: '#e0483a',
    // warm red: passes red, leaks a little green, swallows blue
    reflectance: [0.86, 0.17, 0.06],
  },
  indigo: {
    id: 'indigo', name: 'Indigo', nameZh: '花青', swatch: '#2f7fbe',
    // Chinese-painting indigo: a blue that leans cyan, so it still greens with
    // yellow. This is the pigment that makes a *painter's* red/yellow/blue set
    // usable — with a violet-leaning blue, yellow+blue goes muddy instead.
    reflectance: [0.06, 0.42, 0.78],
  },
  ultramarine: {
    id: 'ultramarine', name: 'Ultramarine', nameZh: '群青', swatch: '#3a52c4',
    // violet-leaning blue: passes blue, leaks red, swallows green. Mixes to a
    // dull brown with red — which is what real ultramarine does, and why painters
    // reach for magenta when they want a purple.
    reflectance: [0.16, 0.11, 0.80],
  },
  malachite: {
    id: 'malachite', name: 'Malachite', nameZh: '石绿', swatch: '#3fae74',
    reflectance: [0.10, 0.72, 0.40],
  },
};

/**
 * Named palettes, i.e. the sets of pigments a level may draw from.
 *
 * Three pigments give seven colours, and seven is close to the ceiling for a
 * puzzle whose whole difficulty is telling colours apart: four pigments give
 * fifteen mixtures, but they have to fit in the same colour volume, so pairs start
 * landing within a just-noticeable difference of each other. That is not a hunch —
 * `tools/validate-color.mjs` measures the minimum OKLab separation of every
 * palette, and only sets marked `ship` clear the bar.
 *
 * The three-pigment sets below were not chosen by taste. Every trio in the
 * catalogue was scored and these are the ones with room to breathe, which is why
 * there is no "warm" or "cool" family here: a palette whose three pigments all sit
 * in the same hue region is inherently crowded — adding vermilion to magenta +
 * yellow lands within ΔE 0.012 of the red it started from.
 *
 * The crowded four- and five-pigment sets are kept as laboratory palettes. They
 * are genuinely interesting to mix in, and the measurement of *why* they cannot
 * carry a board is worth keeping next to them.
 */
export const PALETTES = {
  /** Printer's primaries. Cleanest secondaries; the default teaching palette. */
  printer: {
    name: 'Printer', nameZh: '印刷', ship: true, theme: 'studio',
    note: 'Cyan, magenta, yellow. Every pair gives a clean secondary.',
    noteZh: '青、品红、黄。任意两色相混都得到干净的间色。',
    pigments: ['cyan', 'magenta', 'yellow'],
  },
  /** The familiar red / yellow / blue, with magenta standing in for the red. */
  painter: {
    name: 'Painter', nameZh: '画师', ship: true, theme: 'paper',
    note: 'Magenta, yellow, indigo — red, yellow and blue as a painter knows them.',
    noteZh: '品红、藤黄、花青——画师意义上的红、黄、蓝。',
    pigments: ['magenta', 'yellow', 'indigo'],
  },
  /** Foliage and flowers: a red that leans pink, a yellow, and a green. */
  botanic: {
    name: 'Botanic', nameZh: '草木', ship: true, theme: 'garden',
    note: 'Magenta, yellow, malachite. Greens and pinks out of one red.',
    noteZh: '品红、藤黄、石绿。一个红就能调出绿与粉。',
    pigments: ['magenta', 'yellow', 'malachite'],
  },
  /** Ore and soot. The darkest palette, and the one where mixing muddies fastest. */
  mineral: {
    name: 'Mineral', nameZh: '矿脉', ship: true, theme: 'quarry',
    note: 'Vermilion, indigo, ink. Every mixture is an earth tone.',
    noteZh: '朱砂、花青、松烟。所有混合都是土色。',
    pigments: ['vermilion', 'indigo', 'black'],
  },
  /** Water and light: two blues that are genuinely different blues. */
  lagoon: {
    name: 'Lagoon', nameZh: '潮汐', ship: true, theme: 'tide',
    note: 'Cyan, yellow, ultramarine. Two blues, and green between them.',
    noteZh: '青、藤黄、群青。两种不同的蓝，中间夹着绿。',
    pigments: ['cyan', 'yellow', 'ultramarine'],
  },
  /** Ink on paper: everything resolves toward a warm dark. */
  shade: {
    name: 'Shade', nameZh: '赭墨', ship: true, theme: 'ink',
    note: 'Magenta, yellow, ink. A palette that only ever gets darker.',
    noteZh: '品红、藤黄、松烟。只会越调越深的一套颜色。',
    pigments: ['magenta', 'yellow', 'black'],
  },

  // --- laboratory palettes: measured, documented, deliberately not shipped ---

  /** Adding white mostly makes paler versions of colours that are already light. */
  tinted: {
    name: 'Tinted', nameZh: '含白四色', ship: false,
    note: 'Yellow reflects 97% of red already, so yellow + white is still yellow.',
    noteZh: '藤黄本就反射 97% 的红光，加白之后还是藤黄。',
    pigments: ['cyan', 'magenta', 'yellow', 'white'],
  },
  /** Ink muddies the three-pigment mixture into colours close to each other. */
  shaded: {
    name: 'Shaded', nameZh: '含墨四色', ship: false,
    note: 'Ink collapses the three-pigment mixture onto a narrow dark band.',
    noteZh: '松烟会把三色混合压到一条很窄的暗带上。',
    pigments: ['cyan', 'magenta', 'yellow', 'black'],
  },
  /** Five pigments, thirty-one mixtures: a mixing toy, not a board. */
  full: {
    name: 'Full', nameZh: '全色系', ship: false,
    note: 'Thirty-one mixtures in the volume seven already fills.',
    noteZh: '三十一种混合，挤在七色就填满的空间里。',
    pigments: ['cyan', 'magenta', 'yellow', 'white', 'black'],
  },
};

/** Palettes that clear the separation bar and are therefore usable as level content. */
export const SHIPPED_PALETTES = Object.entries(PALETTES)
  .filter(([, p]) => p.ship)
  .map(([key]) => key);

/** Palette key for a theme id, so a level only has to name its album. */
export const PALETTE_BY_THEME = Object.fromEntries(
  Object.entries(PALETTES).filter(([, p]) => p.theme).map(([key, p]) => [p.theme, key])
);

/** Reflectances are clamped away from 0 and 1 so K/S stays finite and invertible. */
const R_MIN = 0.004;
const R_MAX = 1.0;

/** Kubelka–Munk: reflectance → absorption/scattering ratio. */
export function reflectanceToKS(R) {
  const r = Math.min(R_MAX, Math.max(R_MIN, R));
  return ((1 - r) * (1 - r)) / (2 * r);
}

/** Kubelka–Munk inverse: absorption/scattering ratio → reflectance. */
export function ksToReflectance(ks) {
  const k = Math.max(0, ks);
  return Math.min(1, 1 + k - Math.sqrt(k * k + 2 * k));
}

/**
 * Mix pigments given as `[id, weight]` pairs. Weights are normalised, so they can
 * be counts or concentrations. Returns a **linear-RGB reflectance triple**, not an
 * sRGB colour — it is a physical quantity and stays linear until display.
 */
export function mixReflectance(parts) {
  let total = 0;
  for (const [, w] of parts) total += w;
  if (total <= 0) return [0, 0, 0];

  const ks = [0, 0, 0];
  for (const [id, w] of parts) {
    const pig = PIGMENTS[id];
    if (!pig) throw new Error(`unknown pigment: ${id}`);
    const f = w / total;
    for (let c = 0; c < 3; c++) ks[c] += f * reflectanceToKS(pig.reflectance[c]);
  }
  return [ksToReflectance(ks[0]), ksToReflectance(ks[1]), ksToReflectance(ks[2])];
}

/**
 * How a raw reflectance becomes something worth looking at.
 *
 * Subtractive mixing darkens: the three-pigment mixture lands near (0.12, 0.18,
 * 0.12), which on screen is a very dark olive. Physically right, and useless as a
 * tile the player must identify. So display colours get a chroma floor and a
 * lightness band — the *relationships* between the colours (green is greener than
 * brown) are preserved, the absolute levels are lifted into a readable range.
 */
export const DISPLAY = {
  minChroma: 0.055,
  lightness: [0.34, 0.80],
  /** Extra chroma for the base pigments, so primaries read as vivid paint. */
  primaryChroma: 0.14,
};

/** Reflectance → displayable linear RGB, gamut-safe. */
export function toDisplayColor(reflectance, { vivid = false } = {}) {
  const lifted = ensureChroma(reflectance, vivid ? DISPLAY.primaryChroma : DISPLAY.minChroma);
  return fitLightness(lifted, DISPLAY.lightness);
}

// ---------------------------------------------------------------------------
// Palette construction
// ---------------------------------------------------------------------------

/**
 * Glyphs and patterns for the colour-blind support layer.
 *
 * Every palette colour gets a unique (glyph, pattern) pair, so the board is fully
 * readable with colour ignored. Uniqueness comes from indexing by the subset's
 * *rank* — its position in the list of subsets ordered by size then mask — rather
 * than by its bitmask, because the rank is dense: a four-pigment palette's fifteen
 * entries get fifteen different glyphs instead of colliding on shared bits.
 */
const GLYPHS = ['●', '▲', '■', '◆', '★', '✚', '⬟', '⬢', '◗', '⬖', '✦', '◍', '▰', '⬣', '✱'];
const PATTERNS = ['none', 'dots', 'stripes', 'hatch'];

const popcount = (n) => {
  let c = 0;
  while (n) { n &= n - 1; c++; }
  return c;
};

/**
 * Rank every mask of an n-bit palette by (size, mask). Returned as a dense
 * lookup so the palette builder never has to re-derive it.
 */
function ranksFor(n) {
  const masks = [];
  for (let m = 1; m < (1 << n); m++) masks.push(m);
  masks.sort((a, b) => popcount(a) - popcount(b) || a - b);
  const ranks = new Int32Array(1 << n).fill(-1);
  masks.forEach((m, i) => { ranks[m] = i; });
  return ranks;
}

/**
 * Build a level's colour palette from its pigment list.
 *
 * The palette is the full subset lattice — every combination of pigments the
 * player can actually reach — with a display colour, a name, an accessibility
 * glyph and a pattern for each entry. Indices into this array are the puzzle's
 * colour alphabet, so the solver works on small integers instead of colours.
 *
 * Index 0 is reserved for "empty" (no pigment). It never appears on a board; it
 * exists so that bitmask 0 has a well-defined entry.
 */
export function buildPalette(pigmentIds, { vivid = true } = {}) {
  const ids = [...pigmentIds];
  if (ids.length < 2 || ids.length > 5) {
    throw new Error(`a palette needs 2..5 pigments, got ${ids.length}`);
  }
  for (const id of ids) if (!PIGMENTS[id]) throw new Error(`unknown pigment: ${id}`);

  const entries = [];
  const n = ids.length;
  const ranks = ranksFor(n);
  for (let mask = 0; mask < (1 << n); mask++) {
    const parts = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) parts.push([ids[i], 1]);

    const raw = mask === 0 ? [1, 1, 1] : mixReflectance(parts);
    const single = parts.length === 1;
    const linear = mask === 0 ? raw : toDisplayColor(raw, { vivid: vivid && single });

    const rank = mask === 0 ? 0 : ranks[mask];
    const pigmentNames = parts.map(([id]) => PIGMENTS[id]);

    entries.push({
      mask,
      index: entries.length,
      pigments: parts.map(([id]) => id),
      /** raw Kubelka–Munk output, kept for the mixing lab and for shader tinting */
      reflectance: raw,
      /** gamut-safe linear RGB, what the renderer and the DOM both use */
      linear,
      hex: mask === 0 ? '#000000' : linearToHex(linear),
      name: mask === 0 ? 'Empty' : pigmentNames.map((p) => p.name).join(' + '),
      nameZh: mask === 0 ? '空' : pigmentNames.map((p) => p.nameZh).join('+'),
      glyph: GLYPHS[rank % GLYPHS.length],
      pattern: PATTERNS[Math.floor(rank / GLYPHS.length) % PATTERNS.length],
    });
  }

  return {
    pigments: ids.map((id) => PIGMENTS[id]),
    entries,
    /** index of the mixture containing every pigment — the "full" colour */
    fullIndex: entries.length - 1,
    byMask: entries,
  };
}

/** Palette index of the union of two palette entries. Union is the mix operation. */
export function mixIndex(palette, indexA, indexB) {
  const a = palette.entries[indexA];
  const b = palette.entries[indexB];
  if (!a || !b) throw new Error(`palette index out of range: ${indexA}, ${indexB}`);
  const n = palette.pigments.length;
  let mask = 0;
  for (let i = 0; i < n; i++) {
    if ((a.mask & (1 << i)) || (b.mask & (1 << i))) mask |= 1 << i;
  }
  return mask; // entries are ordered by mask, so mask IS the index
}

/** Palette index for a single pigment (by its position in the palette's list). */
export function pigmentIndex(palette, pigmentId) {
  const i = palette.pigments.findIndex((p) => p.id === pigmentId);
  if (i < 0) throw new Error(`${pigmentId} is not in this palette`);
  return 1 << i;
}

/**
 * The most perceptually separated pair in a palette — used by the accessibility
 * report to state how much room the palette actually has, and by the level
 * validator to refuse a level whose colours are too close to tell apart.
 */
export function minPaletteSeparation(palette, { ignoreEmpty = true } = {}) {
  const entries = palette.entries.filter((e) => !(ignoreEmpty && e.mask === 0));
  const labs = entries.map((e) => linearToOklab(e.linear));
  let worst = Infinity;
  let pair = null;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const d = deltaE(labs[i], labs[j]);
      if (d < worst) {
        worst = d;
        pair = [entries[i], entries[j]];
      }
    }
  }
  return { distance: worst, pair };
}

/**
 * Perceptual spread of a palette. Two bars, because "too close to tell apart" is
 * not one threshold:
 *
 *   JND (0.02)   below this the two colours are the same colour in practice. A
 *                palette that fails this cannot be used as level content at all.
 *   SAFE (0.05)  comfortably distinguishable as large flat patches. Below this,
 *                the accessibility layer (glyph + pattern) has to carry the
 *                difference, which works but is a worse experience.
 *
 * Both are OKLab distances, which is why they are plain numbers and not ΔE2000.
 */
export const SEPARATION = { jnd: 0.02, safe: 0.05 };

export function paletteReport(palette) {
  const sep = minPaletteSeparation(palette);
  return {
    count: palette.entries.length - 1,
    minDeltaE: sep.distance,
    closest: sep.pair ? sep.pair.map((e) => `${e.name} ${e.hex}`) : [],
    distinguishable: sep.distance >= SEPARATION.jnd,
    safe: sep.distance >= SEPARATION.safe,
  };
}

/** Round-trip helper for the mixing lab UI: which pigments produce this index. */
export function describeMix(palette, index) {
  const e = palette.entries[index];
  return { name: e.name, nameZh: e.nameZh, hex: e.hex, glyph: e.glyph, pattern: e.pattern };
}

/** Distance between two palette entries, in OKLab. Used for "too similar" hints. */
export function paletteDistance(palette, a, b) {
  return deltaE(linearToOklab(palette.entries[a].linear), linearToOklab(palette.entries[b].linear));
}

/** Convenience: the sRGB hex of a pigment's own swatch, for the palette UI. */
export function pigmentSwatch(id) {
  const p = PIGMENTS[id];
  if (!p) throw new Error(`unknown pigment: ${id}`);
  // The hand-picked swatch is for UI chrome (chips, labels); the mixed colour on
  // the board comes from the model, and the two are deliberately allowed to differ.
  return { hex: p.swatch, linear: rgbToLinear(hexToRgb(p.swatch)) };
}

/**
 * Memoised palette lookup by key. Building a palette runs the mixing model over
 * every subset, which is cheap but not free, and the level validator asks for the
 * same handful of palettes thousands of times.
 */
const paletteCache = new Map();

export function paletteFor(key, opts) {
  const cacheKey = `${key}:${opts?.vivid === false ? 'flat' : 'vivid'}`;
  let pal = paletteCache.get(cacheKey);
  if (!pal) {
    const def = PALETTES[key];
    if (!def) throw new Error(`unknown palette: ${key}`);
    pal = buildPalette(def.pigments, opts);
    pal.key = key;
    pal.def = def;
    paletteCache.set(cacheKey, pal);
  }
  return pal;
}

function hexToRgb(hex) {
  const s = hex.replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16) / 255,
    parseInt(s.slice(2, 4), 16) / 255,
    parseInt(s.slice(4, 6), 16) / 255,
  ];
}

export { oklabToOklch, oklchToOklab, oklabToLinear, toGamut };
