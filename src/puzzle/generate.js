/**
 * Board generation.
 *
 * ---------------------------------------------------------------------------
 * What has to be true of a generated board
 * ---------------------------------------------------------------------------
 * A board is winnable by construction when every cell's colour is a *subset* of
 * the level's goal — because union can only add, so each cell can be walked up to
 * the goal independently and nothing can overshoot. For a containment goal
 * (`recipe`) that is true a fortiori, and for `replace` mode it does not matter at
 * all, since a replace move overwrites rather than accumulates.
 *
 * So generation is not a search for solvable boards; it is the job of filling in a
 * *safe* board that looks designed. Two things decide whether it looks designed:
 *
 *   fragmentation   how many distinct regions the board is cut into. One flat
 *                   board is already solved; a board of one-cell confetti reads as
 *                   noise and plays easy, because there is nothing to merge.
 *   distance        how far each region sits from the goal. A region missing one
 *                   pigment costs one delivery; a region missing two costs two,
 *                   and the interesting part is whether they can be delivered
 *                   together.
 *
 * Both are dials the caller sets, and both are measurable afterwards, so the
 * difficulty target is hit by generating a few candidates and keeping the closest
 * rather than by guessing a formula.
 *
 * ---------------------------------------------------------------------------
 * Why not reverse construction
 * ---------------------------------------------------------------------------
 * The textbook recipe is to start from a solved board and apply reverse moves.
 * The version of it that works for a *single* growing region — peel a pigment off
 * the region, repeat — does nothing here: peeling a pigment off the whole board
 * recolours the whole board and creates no regions at all, so the first move
 * produces a flat board and every move after it is a no-op. Reverse construction
 * only fragments a board if it can peel *sub*-regions, and a sub-region peel is not
 * the inverse of any legal forward move.
 *
 * The blob partition below is what replaces it: cut the board into organic regions
 * first, then give each region a partial mixture. Same safety envelope, and it
 * produces boards that look like they were designed rather than unfolded.
 */

import { FREE, compileLevel, validateRules } from './rules.js';
import { analyse } from './solve.js';
import { MAX_NEIGHBORS } from '../grid/grid.js';

/** Deterministic PRNG, so a level id always produces the same board. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable numeric seed from a string, so level ids are reproducible. */
export function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Cut the board into `blobCount` connected regions by randomised multi-source
 * growth.
 *
 * Each region grows from a seed, and the frontier is popped from a random slot
 * rather than in order. That is the whole trick: an ordered BFS produces circular
 * territories, while a random pop produces the ragged, interlocking shapes a
 * hand-drawn puzzle has. `spread` limits how far ahead the random pop looks — a
 * small spread keeps growth roughly balanced so regions do not collapse into one
 * giant blob plus crumbs.
 *
 * Returns an Int32Array of region ids, one per cell.
 */
export function partitionBlobs(grid, blobCount, rnd, { spread = 6 } = {}) {
  const cells = Array.from(grid.cells);
  const owner = new Int32Array(grid.count).fill(-1);
  if (!cells.length) return owner;

  const frontier = [];
  let nextId = 0;
  const wanted = Math.max(1, Math.min(blobCount, cells.length));
  for (let i = 0; i < wanted; i++) {
    const seed = cells[Math.floor(rnd() * cells.length)];
    if (owner[seed] >= 0) continue;
    owner[seed] = nextId++;
    frontier.push(seed);
  }

  const grow = () => {
    while (frontier.length) {
      // pop from a random slot near the front: O(1), and randomised
      const slot = Math.floor(rnd() * Math.min(frontier.length, spread));
      const at = frontier[slot];
      frontier[slot] = frontier[frontier.length - 1];
      frontier.pop();
      const base = at * MAX_NEIGHBORS;
      for (let k = 0; k < MAX_NEIGHBORS; k++) {
        const nb = grid.nbr[base + k];
        if (nb < 0) break;
        if (owner[nb] >= 0) continue;
        owner[nb] = owner[at];
        frontier.push(nb);
      }
    }
  };
  grow();

  // Any cell the seeds could not reach (a board whose mask cut it off) becomes its
  // own region, so no cell is ever left unowned.
  for (const cell of cells) {
    if (owner[cell] >= 0) continue;
    owner[cell] = nextId++;
    frontier.push(cell);
    grow();
  }

  return owner;
}

/** Choose a non-empty subset of `mask` with exactly `size` pigments. */
function subsetOfSize(mask, size, rnd) {
  const bits = [];
  for (let p = 0; p < 16; p++) if (mask & (1 << p)) bits.push(p);
  if (size >= bits.length) return mask;
  // partial Fisher–Yates
  for (let i = bits.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [bits[i], bits[j]] = [bits[j], bits[i]];
  }
  let out = 0;
  for (let i = 0; i < size; i++) out |= 1 << bits[i];
  return out;
}

/**
 * Give each region a partial mixture of the goal.
 *
 * `keep` is how many of the goal's pigments a region still holds, so
 * `missing = pigments - keep` is the number of deliveries it needs. Regions are
 * allowed to land exactly on the goal (already-correct cells), which makes a board
 * look partly finished and gives the player somewhere obvious to start.
 */
function assignMixMasks(grid, owner, goalMask, pigmentCount, keep, rnd) {
  const colors = new Uint8Array(grid.count);
  const byBlob = new Map();
  for (const cell of grid.cells) {
    const b = owner[cell];
    if (!byBlob.has(b)) byBlob.set(b, []);
    byBlob.get(b).push(cell);
  }
  const goalBits = [];
  for (let p = 0; p < pigmentCount; p++) if (goalMask & (1 << p)) goalBits.push(p);
  const goalSize = goalBits.length;

  for (const [, blobCells] of byBlob) {
    // jitter keep by ±1 so the board is not uniformly distant from the goal
    const jitter = rnd() < 0.35 ? (rnd() < 0.5 ? -1 : 1) : 0;
    const size = Math.max(1, Math.min(goalSize, keep + jitter));
    const mask = subsetOfSize(goalMask, size, rnd);
    for (const cell of blobCells) colors[cell] = mask === 0 ? 1 << goalBits[0] : mask;
  }
  return colors;
}

/** Give each region one pigment — the classic flood-fill board. */
function assignReplaceMasks(grid, owner, pigmentCount, rnd) {
  const colors = new Uint8Array(grid.count);
  const byBlob = new Map();
  for (const cell of grid.cells) {
    const b = owner[cell];
    if (!byBlob.has(b)) byBlob.set(b, []);
    byBlob.get(b).push(cell);
  }
  for (const [, blobCells] of byBlob) {
    const pigment = Math.floor(rnd() * pigmentCount);
    for (const cell of blobCells) colors[cell] = 1 << pigment;
  }
  return colors;
}

/**
 * Build one board: partition, then colour.
 *
 * @param {object} spec
 * @param {'square'|'hex'|'diamond'|'triangle'} spec.grid
 * @param {number} spec.cols
 * @param {number} spec.rows
 * @param {string[]} [spec.mask]
 * @param {string} spec.palette
 * @param {'mix'|'replace'} [spec.mode]
 * @param {number} [spec.target]      goal mask, for a unify level
 * @param {number} [spec.blobs]       how many regions to cut the board into
 * @param {number} [spec.keep]        pigments each region keeps, for mix mode
 * @param {() => number} rnd
 */
export function buildBoard(spec, rnd) {
  // The probe is always compiled as a unify board: this function only needs the
  // grid, the pigment count and the goal mixture, and a recipe spec has no targets
  // yet at this point.
  const pigmentCountGuess = spec.paletteLookup(spec.palette).pigments.length;
  const probe = compileLevel(
    {
      ...spec,
      goal: 'unify',
      target: spec.target ?? (1 << pigmentCountGuess) - 1,
      colors: new Array(spec.cols * spec.rows).fill(1),
    },
    spec.paletteLookup
  );
  const { grid, pigmentCount, goalMask, mode } = probe;

  const cellCount = grid.cells.length;
  const blobCount = spec.blobs ?? Math.max(3, Math.round(cellCount * 0.28));
  const owner = partitionBlobs(grid, blobCount, rnd, { spread: spec.spread ?? 6 });

  const colors = mode === 'replace'
    ? assignReplaceMasks(grid, owner, pigmentCount, rnd)
    : assignMixMasks(grid, owner, goalMask, pigmentCount, spec.keep ?? Math.max(1, probe.pigmentCount - 1), rnd);

  return { colors, owner, blobCount };
}

/**
 * Generate a `unify` level and measure it.
 *
 * Candidates are produced until one lands near the requested difficulty, or the
 * attempt budget runs out — in which case the closest candidate is returned rather
 * than nothing, because a generator that sometimes produces no level is worse than
 * one that produces an imperfect level and says so in its report.
 */
export function generateBoard(spec, { rng, attempts = 48, targetDifficulty = null, beamWidth = 200 } = {}) {
  const rnd = rng ?? mulberry32(seedFrom(spec.id ?? 'board'));
  const baseBlobs = spec.blobs ?? Math.max(3, Math.round(spec.cols * spec.rows * 0.28));
  let best = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const attemptSpec = {
      ...spec,
      blobs: Math.max(2, baseBlobs + Math.round((rnd() - 0.5) * 4)),
      spread: 3 + Math.floor(rnd() * 8),
    };
    const built = buildBoard(attemptSpec, rnd);
    const candidate = { ...spec, colors: Array.from(built.colors) };

    let compiled;
    try {
      compiled = compileLevel({ ...candidate, budget: 999 }, spec.paletteLookup);
    } catch {
      continue;
    }
    if (validateRules(compiled, { requireBudget: false }).length) continue;

    const found = analyse(compiled, { width: beamWidth });
    if (!found.solved) continue;

    // Budget from the *found* solution: a budget built on an upper bound would
    // hand the player free moves.
    const budget = found.length + (spec.slack ?? 1);
    const withBudget = compileLevel({ ...candidate, budget }, spec.paletteLookup);
    const final = analyse(withBudget, { width: beamWidth });

    const entry = { level: { ...candidate, budget }, report: final, difficulty: final.difficulty };
    if (targetDifficulty === null) return entry;
    const err = Math.abs(final.difficulty - targetDifficulty);
    if (!best || err < best.err) best = { ...entry, err };
    if (err < 0.035) return best;
  }

  return best;
}

/**
 * Generate a `recipe` level: marked cells must end up holding the pigments listed
 * for them, unmarked cells are free.
 *
 * The free cells are the whole point. They are not scored, they are in the way, and
 * they are the only material available for connecting two marked cells into one
 * region so a single move can serve both. A board of nothing but marked cells would
 * be a list of independent errands.
 */
export function generateRecipe(spec, { rng, attempts = 48, targetDifficulty = null, beamWidth = 200 } = {}) {
  const rnd = rng ?? mulberry32(seedFrom(spec.id ?? 'recipe'));
  const blank = new Array(spec.cols * spec.rows).fill(1);
  const freeTargets = new Array(spec.cols * spec.rows).fill(FREE);
  const baseBlobs = spec.blobs ?? Math.max(3, Math.round(spec.cols * spec.rows * 0.28));
  let best = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const attemptSpec = {
      ...spec,
      blobs: Math.max(2, baseBlobs + Math.round((rnd() - 0.5) * 4)),
      spread: 3 + Math.floor(rnd() * 8),
    };
    const probe = compileLevel({ ...attemptSpec, colors: blank, targets: freeTargets }, spec.paletteLookup);
    const { grid, pigmentCount, goalMask } = probe;

    const built = buildBoard({ ...attemptSpec, mode: 'mix', target: goalMask }, rnd);

    // Mark a contiguous-ish figure plus a few strays, so the board reads as a
    // picture rather than as scattered dots.
    const cells = Array.from(grid.cells);
    const want = Math.max(2, Math.round(cells.length * (spec.markRatio ?? 0.6)));
    const marked = new Set();
    const seedCell = cells[Math.floor(rnd() * cells.length)];
    marked.add(seedCell);
    const queue = [seedCell];
    while (marked.size < want && queue.length) {
      const at = queue.splice(Math.floor(rnd() * Math.min(queue.length, 5)), 1)[0];
      for (let k = 0; k < MAX_NEIGHBORS; k++) {
        const nb = grid.nbr[at * MAX_NEIGHBORS + k];
        if (nb < 0) break;
        if (marked.has(nb)) continue;
        marked.add(nb);
        queue.push(nb);
        if (marked.size >= want) break;
      }
    }
    for (let i = 0; i < Math.round(cells.length * 0.08); i++) {
      marked.add(cells[Math.floor(rnd() * cells.length)]);
    }

    const targets = new Array(spec.cols * spec.rows).fill(FREE);
    for (const cell of marked) {
      const current = built.colors[cell];
      const missing = goalMask & ~current;
      if (missing === 0) {
        // The cell already satisfies every pigment it could ask for; asking for
        // less would make it already-satisfied, so leave it free instead.
        continue;
      }
      // Ask for at least one pigment the cell does not have, so the cell is real
      // work. Asking for two where possible makes single-click solutions rarer.
      let want2 = missing;
      const missingBits = [];
      for (let p = 0; p < pigmentCount; p++) if (missing & (1 << p)) missingBits.push(p);
      if (missingBits.length > 1 && rnd() < 0.6) {
        want2 = 1 << missingBits[Math.floor(rnd() * missingBits.length)];
      }
      targets[cell] = current | want2;
    }

    const candidate = { ...spec, colors: Array.from(built.colors), targets };
    let compiled;
    try {
      compiled = compileLevel({ ...candidate, budget: 999 }, spec.paletteLookup);
    } catch {
      continue;
    }
    if (validateRules(compiled, { requireBudget: false }).length) continue;

    const found = analyse(compiled, { width: beamWidth });
    if (!found.solved) continue;

    const budget = found.length + (spec.slack ?? 1);
    const withBudget = compileLevel({ ...candidate, budget }, spec.paletteLookup);
    const final = analyse(withBudget, { width: beamWidth });
    const entry = { level: { ...candidate, budget }, report: final, difficulty: final.difficulty };
    if (targetDifficulty === null) return entry;
    const err = Math.abs(final.difficulty - targetDifficulty);
    if (!best || err < best.err) best = { ...entry, err };
    if (err < 0.035) return best;
  }

  return best;
}

/** Compile + analyse a hand-written level, for the validator and the level editor. */
export function inspect(level, paletteLookup, { beamWidth = 240 } = {}) {
  const rules = compileLevel(level, paletteLookup);
  const problems = validateRules(rules);
  if (problems.length) return { ok: false, problems };
  const report = analyse(rules, { width: beamWidth });
  return { ok: true, rules, report, problems: [] };
}
