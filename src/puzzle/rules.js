/**
 * Puzzle rules — the game itself, with no rendering in it.
 *
 * The board is a grid of cells; each cell holds a **colour index**, which is a
 * subset of the level's pigments (see pigment.js for why a set, and why mixing is
 * union). A move picks a cell and a pigment: the whole connected region of
 * same-coloured cells around that cell takes on the mixture of its current colour
 * and the pigment.
 *
 * ---------------------------------------------------------------------------
 * Two things make this more than flood-fill
 * ---------------------------------------------------------------------------
 * 1. **Mixing instead of replacing.** In `mix` mode the region's colour is the
 *    union, so a cell can never lose a pigment. A region only grows by *becoming
 *    equal* to a neighbour, which means the player has to plan which regions to
 *    make match — "merge, then unify" — rather than just expanding outward.
 *
 * 2. **A target per cell, not one target.** `unify` gives every cell the same
 *    target and demands *equality*: the board must become one flat colour.
 *    `recipe` gives marked cells their own targets and demands *containment*: a
 *    marked cell must hold at least the pigments listed for it, and unmarked cells
 *    are free.
 *
 *    The two demand different relations on purpose, and the reason is solvability.
 *    Under a cumulative mix, equality is only safe when nothing can overshoot —
 *    which is guaranteed for `unify` because every cell starts as a subset of the
 *    single target. A per-cell equality goal has no such guarantee: delivering a
 *    pigment to one marked cell drags its whole region along, and a neighbour
 *    marked for less would be spoiled with no way back. Containment cannot be
 *    spoiled that way, so `recipe` boards are always winnable and the tension
 *    lives in the move budget instead of in a dead end.
 *
 *    One consequence worth stating plainly: **a board is never unwinnable in
 *    `replace` mode**, because setting a region's colour overwrites rather than
 *    accumulates. Apply the target to every region in turn and the board is done.
 *
 * The engine is deliberately allocation-light and side-effect-free where it
 * matters: the solver runs millions of these moves, so `applyMove` writes into a
 * caller-supplied buffer and region finding works on flat typed arrays.
 */

import { createGrid, MAX_NEIGHBORS } from '../grid/grid.js';
import { buildPalette, pigmentIndex as pigmentIndexFor } from '../color/pigment.js';

/** Target value meaning "this cell has no requirement". */
export const FREE = 0xff;

export const MODES = ['mix', 'replace'];
export const GOALS = ['unify', 'recipe'];

/**
 * Flood-fill the connected run of cells sharing `start`'s colour.
 *
 * Writes cell indices into `out` and returns the count. Reusing a caller-owned
 * array is not premature optimisation here: a beam search at width 400 over 20
 * moves performs hundreds of thousands of these, and allocating a fresh array each
 * time is the difference between a snappy validator and a slow one.
 */
export function findRegion(grid, colors, start, out, marks, stamp) {
  const target = colors[start];
  let n = 0;
  out[n++] = start;
  marks[start] = stamp;
  for (let head = 0; head < n; head++) {
    const cell = out[head];
    const base = cell * MAX_NEIGHBORS;
    for (let k = 0; k < MAX_NEIGHBORS; k++) {
      const nb = grid.nbr[base + k];
      if (nb < 0) break;
      if (marks[nb] === stamp || colors[nb] !== target) continue;
      marks[nb] = stamp;
      out[n++] = nb;
    }
  }
  return n;
}

/**
 * Apply a move to `colors` **in place**, returning how many cells changed, or 0 if
 * the move did nothing.
 *
 * A move that changes nothing is not a mistake the player should be charged for:
 * adding a pigment the region already contains is a no-op, and so is targeting a
 * region with the pigment it already has. The UI uses the 0 return to refuse the
 * move and flash the reason instead of silently burning a step.
 */
export function applyMove(rules, colors, cell, pigment, scratch) {
  const { grid, mixTable } = rules;
  const region = scratch.region;
  scratch.stamp = nextStamp(scratch);
  const n = findRegion(grid, colors, cell, region, scratch.marks, scratch.stamp);
  if (n === 0) return 0;

  const before = colors[cell];
  const after = mixTable[before * rules.pigmentCount + pigment];
  if (after === before) return 0;

  for (let i = 0; i < n; i++) colors[region[i]] = after;
  return n;
}

/** Enumerate the distinct legal moves: one per (region, pigment) that changes something. */
export function legalMoves(rules, colors, scratch) {
  const { grid, mixTable, pigmentCount } = rules;
  const out = [];
  const seen = new Set();
  const marks = scratch.marks;
  // `grid.cells` is ascending and findRegion starts at `start`, so a region's first
  // slot is always its lowest-index cell — that is the stable identity used to
  // visit each region once no matter which of its cells we started from.
  for (const cell of grid.cells) {
    const base = colors[cell];
    if (seen.has(cell)) continue;
    scratch.stamp = nextStamp(scratch);
    const n = findRegion(grid, colors, cell, scratch.region, marks, scratch.stamp);
    for (let i = 0; i < n; i++) seen.add(scratch.region[i]);
    for (let p = 0; p < pigmentCount; p++) {
      const after = mixTable[base * pigmentCount + p];
      if (after !== base) out.push({ cell, pigment: p, size: n, from: base, to: after });
    }
  }
  return out;
}

/**
 * Advance the flood-fill stamp, clearing the marks array if it would wrap. A stamp
 * collision would silently truncate a region, and a long validation run over many
 * levels gets close enough to the 2^31 boundary to be worth the two lines.
 */
function nextStamp(scratch) {
  const next = scratch.stamp + 1;
  if (next >= 0x7fffffff) {
    scratch.marks.fill(-1);
    return 0;
  }
  return next;
}

/**
 * Is the goal met? Equality for `unify`, containment for `recipe` — see the note
 * at the top of the file for why they differ.
 */
export function isSolved(rules, colors) {
  const { targets } = rules;
  if (rules.goal === 'recipe') {
    for (const cell of rules.grid.cells) {
      const t = targets[cell];
      if (t !== FREE && (colors[cell] & t) !== t) return false;
    }
    return true;
  }
  for (const cell of rules.grid.cells) {
    const t = targets[cell];
    if (t !== FREE && colors[cell] !== t) return false;
  }
  return true;
}

/**
 * Has the board become unwinnable? True when some cell carries a pigment its
 * target does not contain — in `mix` mode nothing can ever remove it.
 *
 * `replace` mode cannot reach this state, because a move overwrites the colour
 * outright rather than accumulating.
 */
export function isStuck(rules, colors) {
  // Only an equality goal under a cumulative mix can be spoiled. Containment can
  // always be satisfied by adding more; a replace move overwrites outright.
  if (rules.mode === 'replace' || rules.goal === 'recipe') return false;
  const { targets } = rules;
  for (const cell of rules.grid.cells) {
    const t = targets[cell];
    if (t === FREE) continue;
    if ((colors[cell] & ~t) !== 0) return true;
  }
  return false;
}

/** Cells that are off their target and can never be repaired — for the UI to mark. */
export function stuckCells(rules, colors) {
  const out = [];
  if (rules.mode === 'replace' || rules.goal === 'recipe') return out;
  for (const cell of rules.grid.cells) {
    const t = rules.targets[cell];
    if (t === FREE) continue;
    if ((colors[cell] & ~t) !== 0) out.push(cell);
  }
  return out;
}

/** How many cells already satisfy their requirement. Used by the HUD progress ring. */
export function progress(rules, colors) {
  const containment = rules.goal === 'recipe';
  let done = 0;
  let total = 0;
  for (const cell of rules.grid.cells) {
    const t = rules.targets[cell];
    if (t === FREE) continue;
    total++;
    if (containment ? (colors[cell] & t) === t : colors[cell] === t) done++;
  }
  return { done, total, ratio: total ? done / total : 1 };
}

// ---------------------------------------------------------------------------
// Building a rules object from a level definition
// ---------------------------------------------------------------------------

/**
 * Compile a level definition into the tables the engine and the solver both use.
 *
 * @param {object} level
 * @param {string} level.grid     square | hex | diamond | triangle
 * @param {number} level.cols
 * @param {number} level.rows
 * @param {string[]} [level.mask] row-major presence flags, '.' = present
 * @param {string} level.palette  key into PALETTES
 * @param {'mix'|'replace'} [level.mode]
 * @param {'unify'|'recipe'} [level.goal]
 * @param {number[]} level.colors initial colour per cell, as a palette mask
 * @param {number} [level.target] the target mask, for `unify`
 * @param {number[]} [level.targets] per-cell target masks, for `recipe` (FREE allowed)
 * @param {number} level.budget   move limit
 */
export function compileLevel(level, paletteLookup) {
  const grid = createGrid({
    type: level.grid,
    cols: level.cols,
    rows: level.rows,
    size: 1,
    mask: level.mask,
  });
  const palette = paletteLookup(level.palette);
  const pigmentCount = palette.pigments.length;

  if (level.colors.length !== grid.count) {
    throw new Error(`level colours has ${level.colors.length} entries, grid has ${grid.count} cells`);
  }

  // Mix table, indexed [from * pigmentCount + pigment]. `mix` unions the pigment
  // in; `replace` throws the region's colour away and uses the pigment alone.
  const mixTable = new Uint8Array(palette.entries.length * pigmentCount);
  for (let from = 0; from < palette.entries.length; from++) {
    for (let p = 0; p < pigmentCount; p++) {
      const bit = 1 << p;
      const to = level.mode === 'replace' ? bit : from | bit;
      mixTable[from * pigmentCount + p] = to;
    }
  }

  // Which pigments the player may reach for. In `mix` mode a pigment outside every
  // target could only ever spoil a cell, so it is not offered; in `replace` mode
  // every pigment is a legal choice because a move overwrites.
  const goalMask = (() => {
    // A recipe level's reachable pigments are the union of what any marked cell
    // asks for. The generator compiles recipe boards before it has chosen targets,
    // so the union falls back to the full palette in that pass.
    if (level.goal === 'recipe' && level.targets) {
      let m = 0;
      for (const t of level.targets) if (t !== FREE) m |= t;
      return m || level.target || (1 << pigmentCount) - 1;
    }
    return level.target ?? (1 << pigmentCount) - 1;
  })();

  const available = [];
  for (let p = 0; p < pigmentCount; p++) {
    if (level.mode === 'replace' || (goalMask & (1 << p)) !== 0) available.push(p);
  }

  const targets = new Uint8Array(grid.count).fill(FREE);
  if (level.goal === 'recipe') {
    if (!level.targets || level.targets.length !== grid.count) {
      throw new Error('a recipe goal needs a targets array the same size as the grid');
    }
    for (let i = 0; i < grid.count; i++) targets[i] = level.targets[i] ?? FREE;
  } else {
    const t = level.target;
    if (t === undefined || t === null) throw new Error('a unify goal needs a target mask');
    for (const cell of grid.cells) targets[cell] = t;
  }

  const rules = {
    level, grid, palette, pigmentCount, mixTable, targets, available,
    mode: level.mode ?? 'mix',
    goal: level.goal ?? 'unify',
    budget: level.budget,
    goalMask,
    /** Scratch buffers, sized once. The engine is single-threaded by design. */
    scratch: {
      region: new Int32Array(grid.count),
      marks: new Int32Array(grid.count).fill(-1),
      stamp: 0,
    },
  };
  return rules;
}

/**
 * Validate a level definition without playing it. Returns a list of problems;
 * an empty list means the level is well-formed and winnable in principle.
 *
 * The important checks are the two that make a board *unsolvable by construction*:
 * a cell starting with a pigment its target lacks (in `mix` mode), and an initial
 * colour that is not a subset of its target. Both are silent traps — the board
 * looks fine and simply cannot be finished.
 */
export function validateRules(rules, { requireBudget = true } = {}) {
  const problems = [];
  const { grid, palette, targets, mode, available, budget, level } = rules;

  // The generator compiles a board with a placeholder budget while it is still
  // measuring how many moves the board needs, so the budget check is separable.
  if (requireBudget && (!Number.isInteger(budget) || budget < 1)) {
    problems.push('budget must be a positive integer');
  }

  const presentCells = new Set(grid.cells);
  if (presentCells.size !== grid.cells.length) problems.push('grid has duplicate cell indices');

  for (const cell of grid.cells) {
    const c = level.colors[cell];
    if (c === undefined) { problems.push(`cell ${cell} has no colour`); continue; }
    if (c >= palette.entries.length) { problems.push(`cell ${cell} colour ${c} is outside the palette`); continue; }
    if (c === 0) problems.push(`cell ${cell} is empty (mask 0); boards start fully pigmented`);
    const t = targets[cell];
    if (t !== FREE && t === 0) problems.push(`cell ${cell} target is empty`);
    // An equality goal under a cumulative mix can only be reached if the board
    // starts as a subset of the target. Anything else is silently unsolvable.
    if (t !== FREE && mode === 'mix' && level.goal !== 'recipe' && (c & ~t) !== 0) {
      problems.push(`cell ${cell} starts with pigments ${bin(c)} its target ${bin(t)} does not contain — unsolvable`);
    }
  }

  // Every cell that is not already satisfied must be able to change at all.
  const containment = level.goal === 'recipe';
  let anyWrong = false;
  for (const cell of grid.cells) {
    const t = targets[cell];
    if (t === FREE) continue;
    const ok = containment ? (level.colors[cell] & t) === t : level.colors[cell] === t;
    if (!ok) anyWrong = true;
  }
  if (!anyWrong) problems.push('the board starts already solved');

  // Masked-out cells must not be referenced.
  for (let i = 0; i < grid.count; i++) {
    if (!grid.present[i] && level.colors[i] !== undefined && level.colors[i] !== 0) {
      // harmless, but it means the level data and the mask disagree
      problems.push(`cell ${i} is masked out but has colour ${level.colors[i]}`);
    }
  }

  if (mode === 'replace' && !available.length) problems.push('replace mode with no pigments available');

  // Connectivity. A board in two pieces is still *winnable* — each piece can be
  // unified on its own — but it reads as a rendering bug rather than a design, and
  // it usually means a mask cut the board apart by accident. Triangle boards are
  // the ones this catches: their adjacency is bipartite, so a silhouette that looks
  // fine can leave a component stranded.
  if (grid.cells.length) {
    const field = grid.distanceField(grid.cells[0]);
    for (const cell of grid.cells) {
      if (field[cell] < 0) { problems.push('board is not connected'); break; }
    }
  }

  // In replace mode an equality target has to be a single pigment, otherwise a
  // cell can never sit on it.
  if (mode === 'replace' && !containment) {
    for (const cell of grid.cells) {
      const t = targets[cell];
      if (t === FREE) continue;
      if ((t & (t - 1)) !== 0) {
        problems.push(`cell ${cell} target ${bin(t)} is a mixture, unreachable in replace mode`);
        break;
      }
    }
  }

  return problems;
}

const bin = (n) => n.toString(2).padStart(4, '0');

// ---------------------------------------------------------------------------
// A playable session
// ---------------------------------------------------------------------------

/**
 * Wrap compiled rules in a mutable session: colours, move count, history.
 *
 * History stores whole snapshots rather than a move log. Boards are at most a few
 * hundred bytes, the player will undo a handful of times, and a snapshot cannot
 * desynchronise the way a replayed log can.
 */
export function createSession(rules) {
  const start = Uint8Array.from(rules.level.colors);
  let colors = Uint8Array.from(start);
  let moves = 0;
  const history = [];
  const listeners = new Set();

  const emit = (event) => { for (const fn of listeners) fn(event); };

  const api = {
    rules,
    get colors() { return colors; },
    get moves() { return moves; },
    get remaining() { return rules.budget - moves; },
    get solved() { return isSolved(rules, colors); },
    get stuck() { return isStuck(rules, colors); },
    get lost() { return !api.solved && (api.stuck || moves >= rules.budget); },
    get progress() { return progress(rules, colors); },
    get stuckCells() { return stuckCells(rules, colors); },

    /** Legal moves right now, with the region size each would affect. */
    moves_available() {
      return legalMoves(rules, colors, rules.scratch)
        .filter((m) => rules.available.includes(m.pigment));
    },

    /**
     * Play a move. Returns a result describing what happened, so the caller can
     * animate exactly the cells that changed without recomputing anything.
     */
    play(cell, pigment) {
      if (api.lost || api.solved) return { ok: false, reason: 'over' };
      if (!rules.available.includes(pigment)) return { ok: false, reason: 'unavailable' };

      // snapshot the region before the move so the caller knows what to animate
      const scratch = rules.scratch;
      scratch.stamp = nextStamp(scratch);
      const n = findRegion(rules.grid, colors, cell, scratch.region, scratch.marks, scratch.stamp);
      const region = Array.from(scratch.region.subarray(0, n));
      const from = colors[cell];
      const to = rules.mixTable[from * rules.pigmentCount + pigment];

      if (to === from) return { ok: false, reason: 'noop' };

      history.push({ colors: Uint8Array.from(colors), moves });
      for (const c of region) colors[c] = to;
      moves++;

      const result = {
        ok: true, cell, pigment, from, to, region, size: region.length,
        solved: api.solved, stuck: api.stuck, lost: api.lost,
      };
      emit(result);
      return result;
    },

    undo() {
      const prev = history.pop();
      if (!prev) return false;
      colors = prev.colors;
      moves = prev.moves;
      emit({ undone: true });
      return true;
    },

    reset() {
      colors = Uint8Array.from(start);
      moves = 0;
      history.length = 0;
      emit({ reset: true });
    },

    /** The state the solver would search from, for the hint button. */
    snapshot() {
      return { colors: Uint8Array.from(colors), moves };
    },

    restore(snapshot) {
      colors = Uint8Array.from(snapshot.colors);
      moves = snapshot.moves;
      emit({ restored: true });
    },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };

  return api;
}

/** Convenience: pigment index for an id, for level authors and the UI. */
export function pigmentIndex(palette, pigmentId) {
  return pigmentIndexFor(palette, pigmentId);
}

export { buildPalette };
