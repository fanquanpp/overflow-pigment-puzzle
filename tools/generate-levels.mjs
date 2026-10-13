#!/usr/bin/env node
/**
 * Build the level content file: src/puzzle/levels.js
 *
 * Build-time tool. It writes a plain data module the game imports directly, so
 * shipping the game needs no generator — only regenerating the content does.
 *
 *   node tools/generate-levels.mjs               # write src/puzzle/levels.js
 *   node tools/generate-levels.mjs --dry         # report only, write nothing
 *   node tools/generate-levels.mjs --only=tide   # one album
 *
 * ---------------------------------------------------------------------------
 * Structure
 * ---------------------------------------------------------------------------
 * Six **albums**, one per shipped palette, each with a theme, a material treatment
 * and a music mode. Inside an album, six **chapters** ramp from a teaching board to
 * a severe one, and each chapter has three boards.
 *
 * ---------------------------------------------------------------------------
 * The ramp is measured, not authored
 * ---------------------------------------------------------------------------
 * The generator builds a **pool** of candidates spread across board size, grid
 * shape, silhouette, rule set and fragmentation; measures every one with the same
 * analyser the validator uses; then fills six difficulty bins with the candidates
 * that land nearest each bin's target.
 *
 * The alternative — decide a chapter's parameters, then hope they produce the
 * difficulty the label claims — does not survive contact with the board: the same
 * fragmentation count is easy on a full rectangle and brutal inside a ring
 * silhouette, and a replace board needs an order of magnitude more regions than a
 * mix board to reach the same length. Measuring first makes the label true, and turns a hole in the
 * ramp into an unfilled bin that gets reported rather than a level that quietly
 * plays easier than its name.
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { paletteFor, PALETTES } from '../src/color/pigment.js';
import { compileLevel, validateRules } from '../src/puzzle/rules.js';
import { analyse } from '../src/puzzle/solve.js';
import { generateBoard, generateRecipe, mulberry32, seedFrom } from '../src/puzzle/generate.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'puzzle', 'levels.js');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const ONLY = (argv.find((a) => a.startsWith('--only=')) ?? '').slice(7) || null;
const lookup = (key) => paletteFor(key);

const BOARDS_PER_CHAPTER = 3;
const CHAPTERS = 6;

// ---------------------------------------------------------------------------
// Albums: a palette, a theme, and six chapter names
// ---------------------------------------------------------------------------

const ALBUMS = [
  {
    id: 'studio', palette: 'printer', theme: 'studio',
    name: 'The Studio', nameZh: '工坊',
    blurb: 'Clean primaries on a workbench, under a neutral lamp. Cyan, magenta and yellow: every pair gives a clean secondary.',
    blurbZh: '工作台上的干净原色，中性灯光下。青、品红、黄——任意两色相混都得到干净的间色。',
    chapters: [
      ['Primer', '底涂'], ['Solvent', '溶剂'], ['Proof', '打样'],
      ['Register', '套准'], ['Overprint', '叠印'], ['Edition', '版次'],
    ],
  },
  {
    id: 'paper', palette: 'painter', theme: 'paper',
    name: 'Paper Fold', nameZh: '纸艺',
    blurb: 'Thick stock that folds and unfolds. Red and blue make brown here, because that is what red and blue pigment actually do.',
    blurbZh: '会翻折的厚纸。红加蓝在这里变成浑褐——因为真实的红蓝颜料就是如此。',
    chapters: [
      ['Crease', '折痕'], ['Gusset', '褶角'], ['Valley Fold', '谷折'],
      ['Mountain Fold', '峰折'], ['Tessellation', '密铺'], ['Unfold', '展开'],
    ],
  },
  {
    id: 'garden', palette: 'botanic', theme: 'garden',
    name: 'The Garden', nameZh: '园圃',
    blurb: 'Foliage, petals and pollen — a single red that reaches both green and pink.',
    blurbZh: '枝叶、花瓣与花粉——一个红同时够到绿与粉。',
    chapters: [
      ['Seedbed', '苗床'], ['Trellis', '花架'], ['Pollen', '花粉'],
      ['Chlorophyll', '叶绿'], ['Graft', '嫁接'], ['Bloom', '盛放'],
    ],
  },
  {
    id: 'quarry', palette: 'mineral', theme: 'quarry',
    name: 'Deep Quarry', nameZh: '矿脉',
    blurb: 'Ore, soot and wet stone. The darkest palette, and the one that muddies fastest.',
    blurbZh: '矿石、烟灰与湿石。最深的一套颜色，也最容易调浑。',
    chapters: [
      ['Tailings', '尾矿'], ['Seam', '矿层'], ['Slurry', '矿浆'],
      ['Overburden', '覆土'], ['Fault', '断层'], ['Core Sample', '岩芯'],
    ],
  },
  {
    id: 'tide', palette: 'lagoon', theme: 'tide',
    name: 'Shallow Tide', nameZh: '潮汐',
    blurb: 'Two blues that are genuinely different blues, and the green that lives between them.',
    blurbZh: '两种真正不同的蓝，以及它们之间的绿。',
    chapters: [
      ['Shallows', '浅滩'], ['Tide Line', '潮线'], ['Undertow', '回流'],
      ['Kelp', '海带'], ['Lagoon', '潟湖'], ['Deep Water', '深水'],
    ],
  },
  {
    id: 'ink', palette: 'shade', theme: 'ink',
    name: 'Ink and Ash', nameZh: '赭墨',
    blurb: 'A palette that only ever gets darker. Every move is a commitment.',
    blurbZh: '一套只会越调越深的颜色。每一步都是承诺。',
    chapters: [
      ['Wash', '淡墨'], ['Dry Brush', '枯笔'], ['Bleed', '洇'],
      ['Smudge', '擦'], ['Soot', '烟'], ['Seal', '印'],
    ],
  },
];

// ---------------------------------------------------------------------------
// Board shapes
// ---------------------------------------------------------------------------

/**
 * Silhouettes. A mask cuts cells out of the index rectangle, so a board can be a
 * shape rather than a rectangle — the renderer gets the outline for free and the
 * engine needs no special case, because a masked cell simply has no neighbours.
 *
 * Silhouettes are where a single tiling earns its variety: with the grid always
 * square, it is the outline (a ring, a bottleneck, a cross) that changes the
 * problem, and each of these masks changes which regions can reach which.
 */
const MASKS = {
  full: (cols, rows) => new Array(cols * rows).fill('.'),
  diamond: (cols, rows) => {
    const out = [];
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const d = Math.abs(c - cx) / (cx + 0.001) + Math.abs(r - cy) / (cy + 0.001);
        out.push(d <= 1.02 ? '.' : '#');
      }
    }
    return out;
  },
  /** A loop. Two regions can then be joined two different ways, which changes the
   *  problem rather than decorating it. */
  ring: (cols, rows) => {
    const out = [];
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    const outer = Math.min(cx, cy);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const d = Math.max(Math.abs(c - cx), Math.abs(r - cy));
        out.push(d > outer - 0.6 && d < outer + 0.6 ? '.' : '#');
      }
    }
    return out;
  },
  /** A bottleneck: one move can serve both lobes, but only after they are joined. */
  hourglass: (cols, rows) => {
    const out = [];
    const cx = (cols - 1) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const waist = Math.abs(r - (rows - 1) / 2);
        const halfWidth = waist < 1 ? 1 : Math.min(cx, waist * 1.4);
        out.push(Math.abs(c - cx) <= halfWidth ? '.' : '#');
      }
    }
    return out;
  },
  /** A stepped bowl. */
  bowl: (cols, rows) => {
    const out = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const inset = Math.floor((r / rows) * (cols / 3));
        out.push(c >= inset && c < cols - inset ? '.' : '#');
      }
    }
    return out;
  },
  /** A plus sign. */
  cross: (cols, rows) => {
    const out = [];
    const cx = Math.floor((cols - 1) / 2);
    const cy = Math.floor((rows - 1) / 2);
    const arm = Math.max(1, Math.floor(Math.min(cols, rows) / 5));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const inV = Math.abs(c - cx) <= arm;
        const inH = Math.abs(r - cy) <= arm;
        out.push(inV || inH ? '.' : '#');
      }
    }
    return out;
  },
};

/** Board size per scale. The grid is always square; only the extent varies. */
const SIZES = [
  { square: [5, 5] },
  { square: [6, 6] },
  { square: [7, 7] },
  { square: [7, 7] },
  { square: [8, 8] },
  { square: [9, 9] },
];

const MASK_CYCLE = ['full', 'full', 'diamond', 'ring', 'hourglass', 'cross', 'full', 'bowl'];

/** Difficulty target per chapter. Which board lands where is decided by measurement. */
const CHAPTER_TARGETS = [0.15, 0.28, 0.41, 0.54, 0.66, 0.78];

const RULE_SETS = {
  mix:     { mode: 'mix',     goal: 'unify' },
  classic: { mode: 'replace', goal: 'unify' },
  recipe:  { mode: 'mix',     goal: 'recipe' },
};
const RULE_KEYS = ['mix', 'classic', 'recipe'];

const BLOB_LADDER = [3, 4, 6, 8, 11, 15, 20, 27, 36, 48, 64];

/** Candidates built per album before the eighteen that ship are chosen. */
const POOL_SIZE = 96;

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

function specFor(album, { scale, grid, ruleKey, blobs, maskName, slack, variantIndex }) {
  const rule = RULE_SETS[ruleKey];
  const [cols, rows] = SIZES[scale][grid];
  const pigmentCount = PALETTES[album.palette].pigments.length;
  return {
    id: `${album.id}-p${variantIndex}`,
    album: album.id,
    grid, cols, rows,
    mask: MASKS[maskName](cols, rows),
    palette: album.palette,
    mode: rule.mode, goal: rule.goal,
    // A replace level needs a single-pigment goal; a recipe level has no single
    // goal at all, because every marked cell carries its own.
    target: rule.mode === 'replace' ? 1 << (variantIndex % pigmentCount) : (1 << pigmentCount) - 1,
    blobs,
    keep: scale <= 1 ? 2 : 1,
    markRatio: 0.55 + scale * 0.02,
    // Slack is part of the pool, not fixed, because extra moves are the single
    // biggest difficulty reducer: a board with two spare moves is a different
    // board from the same layout with none, and only the measurement can say
    // which chapter each belongs in.
    slack,
    paletteLookup: lookup,
  };
}

/**
 * Build and measure one candidate.
 *
 * Candidates that fail validation — a silhouette that cut the board in two, a board
 * that came out already solved — are dropped rather than repaired: the pool is
 * large, and a repaired board is a board nobody chose.
 */
function makeCandidate(album, params, rng) {
  const spec = specFor(album, params);
  const opts = { rng, attempts: 5, beamWidth: 240 };
  const raw = spec.goal === 'recipe' ? generateRecipe(spec, opts) : generateBoard(spec, opts);
  if (!raw) return null;

  const level = { ...raw.level };
  for (const k of ['paletteLookup', 'maskName']) delete level[k];

  let rules;
  try {
    rules = compileLevel(level, lookup);
  } catch {
    return null;
  }
  if (validateRules(rules).length) return null;

  // Measure at a fixed, generous width, then make sure the budget can afford what
  // that measurement found.
  //
  // Not paranoia: beam search length is *not* monotone in beam width. A narrow beam
  // can get lucky and reach a solution at a shallower depth than a wide one, so a
  // budget derived from the search's own width can land below the length reported
  // here. A longer path existing is fine — a budget only has to be achievable — but
  // a budget below the number printed on the level select screen is a level that
  // lies about itself.
  let report = analyse(rules, { width: 420 });
  if (!report.solved) return null;

  if (report.length > level.budget) {
    level.budget = report.length + 1;
    try {
      rules = compileLevel(level, lookup);
    } catch {
      return null;
    }
    if (validateRules(rules).length) return null;
    report = analyse(rules, { width: 420 });
    if (!report.solved) return null;
  }

  return {
    level, report,
    difficulty: report.difficulty,
    grid: level.grid,
    ruleKey: params.ruleKey,
    maskName: params.maskName,
    params,
  };
}

/**
 * Build a pool, then choose the boards that ship.
 *
 * Six difficulty bins, each filled with the candidates nearest its target. Quotas
 * stop a chapter being three near-identical boards: every album must end up showing
 * all four grid shapes and all three rule sets.
 */
function buildAlbum(album) {
  const rnd = mulberry32(seedFrom(album.id));
  const pool = [];
  const pick = (n) => Math.floor(rnd() * n);
  for (let i = 0; i < POOL_SIZE; i++) {
    // Stratified sampling. "A big board, heavily fragmented, with no spare moves"
    // is a small corner of the parameter space, and sampling it uniformly leaves
    // the hardest chapter with nothing to fill it — which is exactly what happened
    // when the pool was uniform. So a third of the pool is drawn from the easy end,
    // a third from the hard end, and a third uniformly across everything.
    const band = i % 3;
    let scale;
    let blobs;
    let slack;
    if (band === 0) {
      scale = pick(3);
      blobs = BLOB_LADDER[pick(5)];
      slack = 1 + pick(2);
    } else if (band === 1) {
      scale = 3 + pick(3);
      blobs = BLOB_LADDER[5 + pick(BLOB_LADDER.length - 5)];
      slack = rnd() < 0.6 ? 0 : 1;
    } else {
      scale = pick(6);
      blobs = BLOB_LADDER[pick(BLOB_LADDER.length)];
      slack = [0, 1, 1, 2][pick(4)];
    }
    const params = {
      scale,
      grid: 'square',
      ruleKey: RULE_KEYS[pick(RULE_KEYS.length)],
      blobs,
      slack,
      variantIndex: i,
    };
    params.maskName = MASK_CYCLE[pick(MASK_CYCLE.length)];
    const c = makeCandidate(album, params, rnd);
    if (c) pool.push(c);
  }
  if (pool.length < CHAPTERS * BOARDS_PER_CHAPTER) {
    return { error: `only ${pool.length} candidates survived` };
  }

  const chosen = [];
  const used = new Set();
  const counts = { mix: 0, classic: 0, recipe: 0 };

  for (let chapter = 0; chapter < CHAPTERS; chapter++) {
    const target = CHAPTER_TARGETS[chapter];
    const ordered = [...pool]
      .filter((c) => !used.has(c.level.id))
      .sort((a, b) => Math.abs(a.difficulty - target) - Math.abs(b.difficulty - target));
    const group = [];
    for (const c of ordered) {
      if (group.length >= BOARDS_PER_CHAPTER) break;
      // Leave room for the rule sets that are still under-represented.
      const scarce = RULE_KEYS.some((k) => counts[k] < 2);
      if (scarce && counts[c.ruleKey] >= 3 && ordered.some((o) => counts[o.ruleKey] < 2)) continue;
      group.push(c);
    }
    for (const c of group) {
      used.add(c.level.id);
      counts[c.ruleKey]++;
    }
    chosen.push(...group.map((c, i) => ({ ...c, chapter, variant: i })));
  }

  chosen.sort((a, b) => a.chapter - b.chapter || a.variant - b.variant);
  return { chosen, pool };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const HEADER = `/**
 * Level content. GENERATED by tools/generate-levels.mjs — edit the generator, not
 * this file.
 *
 * Six albums, one per palette; six chapters per album; three boards per chapter.
 * That is ${ALBUMS.length * CHAPTERS * BOARDS_PER_CHAPTER} boards.
 *
 * The chapters are a **measured** ramp, not an authored one. The generator builds a
 * pool of candidates spread across board size, grid shape, silhouette, rule set and
 * fragmentation, measures each one, and fills six difficulty bins with the
 * candidates landing nearest each bin's target. So a chapter label means what it
 * says, and a hole in the ramp shows up as an unfilled bin rather than as a board
 * that quietly plays easier than its name.
 *
 * Every board carries the numbers it was measured on — \`solution\` (moves a beam
 * search found), \`lowerBound\` (a provable floor), \`difficulty\` and its \`band\` —
 * so the level select can show what a board really asks for, and
 * \`tools/validate-levels.mjs\` can re-verify the claims without regenerating.
 *
 * A level record:
 *   grid / cols / rows / mask   board shape and silhouette
 *   palette                     key into PALETTES
 *   mode / goal                 rule set — see src/puzzle/rules.js
 *   colors                      initial colour per cell, as a palette bitmask
 *   target | targets            the goal: one mask, or one per cell with 255 = free
 *   budget                      move limit
 *   solution / lowerBound       measured move count and a provable floor
 *   difficulty / band           measured difficulty, and its named band
 */
`;

const ROMAN = ['I', 'II', 'III'];
const CN_NUM = ['一', '二', '三'];

function fmtArray(arr, perLine, indent) {
  const parts = [];
  for (let i = 0; i < arr.length; i += perLine) {
    parts.push(indent + arr.slice(i, i + perLine).join(', '));
  }
  return parts.join(',\n');
}

function fmtLevel(entry, album, indent) {
  const { level, report, chapter, variant } = entry;
  const [en, zh] = album.chapters[chapter];
  const name = `${en} ${ROMAN[variant]}`;
  const nameZh = `${zh}·${CN_NUM[variant]}`;
  const L = [];
  L.push(`${indent}{`);
  L.push(`${indent}  id: ${JSON.stringify(level.id)},`);
  L.push(`${indent}  chapter: ${chapter}, variant: ${variant},`);
  L.push(`${indent}  name: ${JSON.stringify(name)}, nameZh: ${JSON.stringify(nameZh)},`);
  L.push(`${indent}  grid: ${JSON.stringify(level.grid)}, cols: ${level.cols}, rows: ${level.rows},`);
  if (level.mask && level.mask.includes('#')) {
    L.push(`${indent}  mask: [\n${fmtArray(level.mask.map((c) => JSON.stringify(c)), 48, indent + '  ')}\n${indent}  ],`);
  }
  L.push(`${indent}  palette: ${JSON.stringify(level.palette)},`);
  L.push(`${indent}  mode: ${JSON.stringify(level.mode)}, goal: ${JSON.stringify(level.goal)},`);
  if (level.goal === 'unify') L.push(`${indent}  target: ${level.target},`);
  else L.push(`${indent}  targets: [\n${fmtArray(level.targets, 32, indent + '  ')}\n${indent}  ],`);
  L.push(`${indent}  colors: [\n${fmtArray(level.colors, 32, indent + '  ')}\n${indent}  ],`);
  L.push(`${indent}  budget: ${level.budget},`);
  L.push(`${indent}  solution: ${report.length},`);
  L.push(`${indent}  lowerBound: ${report.lowerBound},`);
  L.push(`${indent}  difficulty: ${report.difficulty.toFixed(4)},`);
  L.push(`${indent}  band: ${JSON.stringify(report.band.key)},`);
  L.push(`${indent}},`);
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const albums = ONLY ? ALBUMS.filter((a) => a.id === ONLY) : ALBUMS;
if (ONLY && !albums.length) {
  console.error(`no album called ${ONLY}; known: ${ALBUMS.map((a) => a.id).join(', ')}`);
  process.exit(1);
}

console.log(`\nbuilding ${albums.length} album(s), ${POOL_SIZE} candidates each\n`);

const albumResults = [];
const failures = [];
const t0 = Date.now();

for (const album of albums) {
  const { chosen, pool, error } = buildAlbum(album);
  if (error) {
    failures.push(`${album.id}: ${error}`);
    console.log(`${album.nameZh} / ${album.name}: FAILED — ${error}`);
    continue;
  }
  console.log(`${album.nameZh} / ${album.name}  [${album.palette}]  pool=${pool.length}`);
  for (let chapter = 0; chapter < CHAPTERS; chapter++) {
    const group = chosen.filter((c) => c.chapter === chapter);
    const cells = group.map((c) => {
      const miss = c.difficulty - CHAPTER_TARGETS[chapter];
      return `${String(c.report.length).padStart(3)}m/${c.difficulty.toFixed(2)}${Math.abs(miss) > 0.13 ? '!' : ' '}`;
    });
    const shapes = group.map((c) => `${c.grid.slice(0, 3)}/${c.ruleKey.slice(0, 4)}`).join(' ');
    console.log(`  ch${chapter + 1} want ${CHAPTER_TARGETS[chapter].toFixed(2)}  ${cells.join(' ')}   ${shapes}`);
  }
  albumResults.push({ album, chosen });
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const all = albumResults.flatMap((r) => r.chosen);
console.log(`\n${all.length} boards selected in ${elapsed}s`);
for (const f of failures) console.log(`  FAILED ${f}`);

const misses = all
  .map((c) => ({ id: c.level.id, miss: c.difficulty - CHAPTER_TARGETS[c.chapter], diff: c.difficulty }))
  .filter((m) => Math.abs(m.miss) > 0.13)
  .sort((a, b) => Math.abs(b.miss) - Math.abs(a.miss));
if (misses.length) {
  console.log(`\n${misses.length} boards sit more than 0.13 from their chapter target:`);
  for (const m of misses.slice(0, 12)) {
    console.log(`  ${m.id.padEnd(13)} got ${m.diff.toFixed(2)} ${m.miss > 0 ? '+' : ''}${m.miss.toFixed(2)}`);
  }
}

if (DRY) {
  console.log('\ndry run — nothing written\n');
  process.exit(failures.length ? 1 : 0);
}
if (failures.length) {
  console.error('\nrefusing to write a partial level file\n');
  process.exit(1);
}

const albumBlocks = ALBUMS.map((album) => {
  const result = albumResults.find((r) => r.album.id === album.id);
  const list = result ? [...result.chosen] : [];
  list.sort((a, b) => a.chapter - b.chapter || a.variant - b.variant);
  return `  {
    id: ${JSON.stringify(album.id)},
    palette: ${JSON.stringify(album.palette)},
    theme: ${JSON.stringify(album.theme)},
    name: ${JSON.stringify(album.name)},
    nameZh: ${JSON.stringify(album.nameZh)},
    blurb: ${JSON.stringify(album.blurb)},
    blurbZh: ${JSON.stringify(album.blurbZh)},
    chapters: ${JSON.stringify(album.chapters.map(([en, zh]) => ({ name: en, nameZh: zh })))},
    levels: [
${list.map((e) => fmtLevel(e, album, '      ')).join('\n')}
    ],
  },`;
}).join('\n');

const body = `${HEADER}
export const ALBUMS = [
${albumBlocks}
];

/** Flat list in album order — the order levels unlock in. */
export const LEVELS = ALBUMS.flatMap((album) => album.levels);

export const LEVEL_ORDER = LEVELS.map((l) => l.id);

export function levelById(id) {
  return LEVELS.find((l) => l.id === id) ?? null;
}

export function albumById(id) {
  return ALBUMS.find((a) => a.id === id) ?? null;
}

export function albumOf(level) {
  return albumById(level.album) ?? null;
}

/** Aggregate per album, for the album select screen. */
export const ALBUM_STATS = Object.fromEntries(
  ALBUMS.map((album) => {
    const hardest = album.levels.reduce((a, l) => Math.max(a, l.difficulty), 0);
    const moves = album.levels.reduce((a, l) => a + l.solution, 0);
    return [album.id, { count: album.levels.length, hardest, moves }];
  })
);

/** Grid shapes actually used, for the how-to-play screen. */
export const GRID_SHAPES_USED = [...new Set(LEVELS.map((l) => l.grid))];
export const CHAPTER_TARGETS = ${JSON.stringify(CHAPTER_TARGETS)};
`;

await writeFile(OUT, body);
console.log(`\nwrote ${OUT}\n`);
