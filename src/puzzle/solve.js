/**
 * Solving, and estimating how hard a board is.
 *
 * ---------------------------------------------------------------------------
 * Why this is not an exact solver
 * ---------------------------------------------------------------------------
 * Flood-fill puzzles are NP-hard, and the *free* variant (the region may start
 * anywhere, which is what "add a pigment to any region" amounts to here) is hard
 * even with three colours. So an exact minimum is not on the table for the board
 * sizes this game ships, and pretending otherwise would mean a validator that
 * hangs on the interesting levels.
 *
 * What the game actually needs is weaker than optimality, and stronger than a
 * guess:
 *
 *   - the move budget must be **achievable**, or the level is unwinnable. That
 *     needs an upper bound, and a beam search provides one that is *guaranteed*
 *     because the search only reports solutions it has actually walked.
 *   - the difficulty label must mean something. That needs the upper bound to be
 *     close to optimal, which a wide beam search gives in practice on boards of
 *     this size, plus a lower bound to bound the error.
 *
 * So: beam search for the solution, a cheap admissible lower bound for the gap,
 * and both reported. When the gap is wide the validator says so instead of
 * quietly shipping a level whose "minimum" is a fiction.
 */

import { MAX_NEIGHBORS } from '../grid/grid.js';
import { FREE, applyMove, findRegion, isSolved, isStuck, legalMoves } from './rules.js';

/** Compact key for a colour array. Values are palette masks, so one char each. */
function hashState(colors, cells) {
  let s = '';
  for (let i = 0; i < cells.length; i++) s += String.fromCharCode(colors[cells[i]]);
  return s;
}

/** How many constrained cells are not yet satisfied. */
export function wrongCount(rules, colors) {
  const containment = rules.goal === 'recipe';
  let n = 0;
  for (const cell of rules.grid.cells) {
    const t = rules.targets[cell];
    if (t === FREE) continue;
    const ok = containment ? (colors[cell] & t) === t : colors[cell] === t;
    if (!ok) n++;
  }
  return n;
}

/**
 * Number of distinct same-coloured connected regions — "fragmentation".
 *
 * Region identity is the lowest cell index in the run, which is what
 * `legalMoves` also uses, so a state's region count and its move list agree.
 */
export function regionCount(rules, colors) {
  const scratch = rules.scratch;
  const seen = new Set();
  let regions = 0;
  for (const cell of rules.grid.cells) {
    if (seen.has(cell)) continue;
    regions++;
    scratch.stamp = (scratch.stamp + 1) | 0;
    const n = findRegion(rules.grid, colors, cell, scratch.region, scratch.marks, scratch.stamp);
    for (let i = 0; i < n; i++) seen.add(scratch.region[i]);
  }
  return regions;
}

/**
 * Admissible lower bound on the number of moves left.
 *
 * Two independent facts, and the bound is the larger of them:
 *
 *   a) every pigment that some cell still needs requires at least one move that
 *      applies it, so the count of distinct missing pigments is a lower bound;
 *   b) a single move can only ever fix cells that are in one region, so if the
 *      still-wrong cells are split across `r` regions, at least ... one move per
 *      region is NOT valid (regions can merge first), so (b) contributes only the
 *      weaker observation that a move touching no wrong cell is wasted — which
 *      bounds nothing on its own.
 *
 * So the bound is (a). It is weak, and it is *honest* about being weak: the
 * validator prints it next to the beam result so a wide gap is visible rather than
 * hidden behind a confident-looking number.
 */
export function lowerBound(rules, colors) {
  let missing = 0;
  for (const cell of rules.grid.cells) {
    const t = rules.targets[cell];
    if (t === FREE) continue;
    missing |= t & ~colors[cell];
  }
  let n = 0;
  for (let p = 0; p < rules.pigmentCount; p++) if (missing & (1 << p)) n++;
  return n;
}

/**
 * Heuristic for ordering the beam: lower is closer to done.
 *
 * Wrong cells dominate, because that is the goal. Region count is the tie-breaker,
 * because fewer regions means fewer separate things left to fix and is the state
 * the final move needs. The 0.4 weight was tuned by watching which states the beam
 * kept — too high and it merges regions that will have to be split back apart, too
 * low and it fixes cells one at a time instead of in batches.
 */
function score(rules, colors) {
  return wrongCount(rules, colors) + 0.4 * regionCount(rules, colors);
}

/**
 * Beam search for a short solution.
 *
 * Returns `{ moves, length, solved, expanded, frontierWidth }`. `moves` is a list
 * of `{ cell, pigment }` and is a *real* path — replaying it from the initial
 * colours solves the board, which is what makes the resulting budget safe.
 */
export function beamSearch(rules, colors, { width = 240, maxDepth = 64 } = {}) {
  const cells = rules.grid.cells;
  const initial = Uint8Array.from(colors);

  if (isSolved(rules, initial)) {
    return { moves: [], length: 0, solved: true, expanded: 0, frontierWidth: 0 };
  }
  if (isStuck(rules, initial)) {
    return { moves: null, length: Infinity, solved: false, expanded: 0, frontierWidth: 0, reason: 'stuck' };
  }

  let frontier = [{ colors: initial, moves: [], score: score(rules, initial) }];
  let expanded = 0;
  let widest = frontier.length;

  for (let depth = 0; depth < maxDepth; depth++) {
    const candidates = new Map(); // hash → best node for that state

    for (const node of frontier) {
      const work = Uint8Array.from(node.colors);
      for (const move of legalMoves(rules, node.colors, rules.scratch)) {
        if (!rules.available.includes(move.pigment)) continue;
        work.set(node.colors);
        const changed = applyMove(rules, work, move.cell, move.pigment, rules.scratch);
        expanded++;
        if (changed === 0) continue;

        if (isSolved(rules, work)) {
          return {
            moves: [...node.moves, { cell: move.cell, pigment: move.pigment }],
            length: depth + 1, solved: true, expanded, frontierWidth: widest,
          };
        }
        if (isStuck(rules, work)) continue;

        const key = hashState(work, cells);
        const s = score(rules, work);
        const existing = candidates.get(key);
        if (!existing || s < existing.score) {
          candidates.set(key, {
            colors: Uint8Array.from(work),
            moves: [...node.moves, { cell: move.cell, pigment: move.pigment }],
            score: s,
          });
        }
      }
    }

    if (candidates.size === 0) {
      return { moves: null, length: Infinity, solved: false, expanded, frontierWidth: widest, reason: 'exhausted' };
    }

    frontier = [...candidates.values()].sort((a, b) => a.score - b.score).slice(0, width);
    widest = Math.max(widest, frontier.length);
  }

  return { moves: null, length: Infinity, solved: false, expanded, frontierWidth: widest, reason: 'depth' };
}

/**
 * Replay a move list and report what each move did — region size, whether it
 * merged into a neighbouring region, and how many cells it brought onto target.
 *
 * The merge count is the interesting one: a move that merges is a move that did
 * two jobs at once, and a solution full of them is one that needed real planning
 * rather than bookkeeping.
 */
export function annotateSolution(rules, colors, moves) {
  const work = Uint8Array.from(colors);
  const steps = [];
  let merges = 0;
  let onTargetBefore = rules.grid.cells.length - wrongCount(rules, work);

  for (const move of moves) {
    const from = work[move.cell];
    const to = rules.mixTable[from * rules.pigmentCount + move.pigment];
    const scratch = rules.scratch;
    scratch.stamp = (scratch.stamp + 1) | 0;
    const size = findRegion(rules.grid, work, move.cell, scratch.region, scratch.marks, scratch.stamp);

    // Does the new colour already exist in a neighbouring region? Then this move
    // merges rather than merely recolouring.
    let merged = false;
    for (let i = 0; i < size && !merged; i++) {
      const base = scratch.region[i] * MAX_NEIGHBORS;
      for (let k = 0; k < MAX_NEIGHBORS; k++) {
        const nb = rules.grid.nbr[base + k];
        if (nb < 0) break;
        if (work[nb] === to && work[nb] !== from) { merged = true; break; }
      }
    }

    applyMove(rules, work, move.cell, move.pigment, scratch);
    const onTargetAfter = rules.grid.cells.length - wrongCount(rules, work);
    if (merged) merges++;
    steps.push({ ...move, from, to, size, merged, fixed: onTargetAfter - onTargetBefore });
    onTargetBefore = onTargetAfter;
  }

  return { steps, merges, solved: isSolved(rules, work), finalColors: work };
}

/**
 * Difficulty bands. Named rather than numeric because the UI has to say something
 * to a player, and "0.63" is not something to say.
 */
export const BANDS = [
  { max: 0.28, key: 'gentle', name: 'Gentle', nameZh: '舒缓' },
  { max: 0.50, key: 'steady', name: 'Steady', nameZh: '平稳' },
  { max: 0.72, key: 'tricky', name: 'Tricky', nameZh: '棘手' },
  { max: 1.01, key: 'severe', name: 'Severe', nameZh: '严峻' },
];

export function bandFor(score01) {
  return BANDS.find((b) => score01 <= b.max) ?? BANDS[BANDS.length - 1];
}

/**
 * Score a board's difficulty from things that can be measured, not felt.
 *
 * The inputs, and why each one is in here:
 *
 *   length        how many moves a good solution takes. The dominant term.
 *   slack         budget minus length. Extra moves are free retries, and free
 *                 retries are the single biggest difficulty reducer, so it is a
 *                 penalty rather than a bonus.
 *   pigments      more pigments means more choices per turn.
 *   fragmentation initial regions per cell. A board that is already in big blocks
 *                 is easier than one shattered into confetti, at the same length.
 *   mergeRatio    fraction of the solution that merged regions. A solution made of
 *                 pure bookkeeping is easier than one that had to line things up.
 *
 * Weights are documented so they can be argued with. The result is a 0..1 number
 * that only ever compares boards within this game — it is not a general metric.
 *
 * The length term saturates at 36 moves rather than 24. It saturated at 24 for a
 * while, which put a ceiling around 0.77 on the whole scale: no board could be
 * labelled severe because every board longer than 24 moves scored the same. A
 * difficulty scale whose top band is unreachable is a scale with three bands.
 */
export function difficultyOf({ length, budget, pigments, fragmentation, mergeRatio }) {
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const slack = budget - length;
  const raw =
    0.50 * clamp01(length / 36) +
    0.18 * clamp01((pigments - 2) / 3) +
    0.18 * clamp01(fragmentation / 0.35) +
    0.14 * clamp01(mergeRatio / 0.6) -
    0.20 * clamp01(slack / 4);
  return clamp01(raw);
}

/**
 * Full analysis of a board: the solution, its length, the bounds, and a difficulty
 * label. This is what the level validator and the level editor both call.
 */
export function analyse(rules, { width = 240 } = {}) {
  const colors = Uint8Array.from(rules.level.colors);
  const t0 = Date.now();
  const search = beamSearch(rules, colors, { width });
  const elapsed = Date.now() - t0;

  const initialRegions = regionCount(rules, colors);
  const cells = rules.grid.cells.length;

  if (!search.solved) {
    return {
      solved: false,
      reason: search.reason,
      lowerBound: lowerBound(rules, colors),
      initialRegions,
      elapsed,
    };
  }

  const annotated = annotateSolution(rules, colors, search.moves);
  const lb = lowerBound(rules, colors);
  const fragmentation = initialRegions / cells;
  const mergeRatio = search.moves.length ? annotated.merges / search.moves.length : 0;

  const difficulty = difficultyOf({
    length: search.moves.length,
    budget: rules.budget,
    pigments: rules.available.length,
    fragmentation,
    mergeRatio,
  });

  return {
    solved: true,
    length: search.moves.length,
    moves: search.moves,
    steps: annotated.steps,
    merges: annotated.merges,
    lowerBound: lb,
    /** How much room there is between the bound and the found solution. */
    gap: search.moves.length - lb,
    initialRegions,
    fragmentation,
    mergeRatio,
    difficulty,
    band: bandFor(difficulty),
    expanded: search.expanded,
    elapsed,
  };
}
