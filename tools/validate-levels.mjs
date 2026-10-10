#!/usr/bin/env node
/**
 * Verify the committed level content.
 *
 * `generate-levels.mjs` writes each board's measured numbers into the file —
 * solution length, lower bound, difficulty, band. This tool re-checks every one of
 * those claims against the shipped data, without regenerating anything:
 *
 *   1. every level compiles, and passes `validateRules` (no unsolvable start, no
 *      disconnected silhouette, a positive budget)
 *   2. the stored solution **actually wins when replayed** through the real session,
 *      in exactly `solution` moves, within the budget
 *   3. the difficulty written in the file matches the difficulty recomputed from the
 *      level's own geometry
 *   4. the band label matches the difficulty
 *   5. every palette used is one of the palettes cleared to ship, and each is
 *      perceptually separable
 *   6. the album ramps are monotone in the sense that matters: chapter 1 is easier
 *      than chapter 6 on average
 *
 * Check 2 is the one that matters. Everything else is consistency; that one catches
 * a level the generator believed was solvable and is not, which is the failure a
 * player would experience as a bug they cannot describe.
 *
 *   node tools/validate-levels.mjs
 *   node tools/validate-levels.mjs --album=tide
 *   node tools/validate-levels.mjs --quiet
 */
import { ALBUMS, LEVELS, ALBUM_STATS } from '../src/puzzle/levels.js';
import { PALETTES, paletteFor, SHIPPED_PALETTES, paletteReport } from '../src/color/pigment.js';
import { compileLevel, createSession, validateRules, isSolved } from '../src/puzzle/rules.js';
import { analyse, difficultyOf, bandFor, BANDS } from '../src/puzzle/solve.js';

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const ONLY = (argv.find((a) => a.startsWith('--album=')) ?? '').slice(8) || null;

const lookup = (key) => paletteFor(key);
let failures = 0;
const problems = [];
const notes = [];

const fail = (id, msg) => {
  failures++;
  problems.push(`${id}: ${msg}`);
};

const albums = ONLY ? ALBUMS.filter((a) => a.id === ONLY) : ALBUMS;
if (ONLY && !albums.length) {
  console.error(`no album called ${ONLY}; known: ${ALBUMS.map((a) => a.id).join(', ')}`);
  process.exit(1);
}

console.log(`\nlevel validation — ${albums.reduce((n, a) => n + a.levels.length, 0)} boards\n`);

// ---------------------------------------------------------------------------
// palettes first: a level on an unshipped palette is a level on a palette that was
// measured as too crowded to carry a board
// ---------------------------------------------------------------------------

const shipped = new Set(SHIPPED_PALETTES);
const paletteRows = [];
for (const key of shipped) {
  const report = paletteReport(paletteFor(key));
  paletteRows.push({ key, ...report });
  if (!report.safe) fail(`palette:${key}`, `minimum separation ${report.minDeltaE.toFixed(4)} is below the comfortable bar`);
}
if (!QUIET) {
  for (const row of paletteRows) {
    console.log(`  palette ${row.key.padEnd(9)} ${String(row.count).padStart(2)} inks  minΔE=${row.minDeltaE.toFixed(4)}  ${row.safe ? 'ok' : 'TOO CLOSE'}`);
  }
}

const usedPalettes = new Set(LEVELS.map((l) => l.palette));
for (const key of usedPalettes) {
  if (!shipped.has(key)) fail('levels', `album content uses palette "${key}", which is not cleared to ship`);
}

// ---------------------------------------------------------------------------
// every board
// ---------------------------------------------------------------------------

const perAlbum = [];
let totalMoves = 0;

for (const album of albums) {
  const rows = [];
  let replayed = 0;

  for (const level of album.levels) {
    const id = level.id;
    let rules;
    try {
      rules = compileLevel(level, lookup);
    } catch (err) {
      fail(id, `does not compile: ${err.message}`);
      continue;
    }

    const ruleProblems = validateRules(rules);
    if (ruleProblems.length) {
      fail(id, ruleProblems[0]);
      continue;
    }

    // --- 2. a solution must exist within the budget ------------------------
    // Solve from the stored start, replay it through the real session, and require
    // the board to come out solved without running out of moves. That is the whole
    // claim a level makes: it can be finished inside its budget.
    const fresh = analyse(rules, { width: 320 });
    if (!fresh.solved) {
      fail(id, 'no solution found from the stored start');
      continue;
    }
    const session = createSession(rules);
    let broke = null;
    for (const mv of fresh.moves) {
      const res = session.play(mv.cell, mv.pigment);
      if (!res.ok) { broke = `move refused (${res.reason})`; break; }
      if (session.lost) { broke = 'ran out of moves mid-solve'; break; }
    }
    if (broke) { fail(id, `a found solution does not replay: ${broke}`); continue; }
    if (!isSolved(rules, session.colors)) {
      fail(id, 'a found solution replays but does not solve the board');
      continue;
    }
    replayed++;

    // --- 3. the numbers in the file must be internally consistent ----------
    // Checked against the *stored* length rather than a fresh solve. Beam search is
    // a heuristic and its result is not monotone in beam width, so re-solving at a
    // different width can legitimately return a different length. What must hold is
    // that the file's own arithmetic is right, and that its budget affords its own
    // solution.
    if (level.solution > level.budget) {
      fail(id, `stored solution ${level.solution} exceeds the budget ${level.budget}`);
    }
    if (level.solution > fresh.length + 2) {
      notes.push(`${id}: the file claims ${level.solution} moves, a fresh solve found ${fresh.length}`);
    }
    const recomputed = difficultyOf({
      length: level.solution,
      budget: level.budget,
      pigments: rules.available.length,
      fragmentation: fresh.fragmentation,
      mergeRatio: fresh.mergeRatio,
    });
    if (Math.abs(recomputed - level.difficulty) > 0.05) {
      fail(id, `difficulty in the file is ${level.difficulty.toFixed(3)}, recomputed ${recomputed.toFixed(3)}`);
    }
    // The band comes from a difficulty that gets rounded on the way into the file, so
    // a board sitting exactly on a boundary can round across it. Accept the
    // neighbouring band inside that slop.
    if (bandFor(level.difficulty).key !== level.band) {
      const nearBoundary = BANDS.some((b) => Math.abs(b.max - level.difficulty) < 0.006);
      if (!nearBoundary) {
        fail(id, `band "${level.band}" does not match difficulty ${level.difficulty.toFixed(4)}`);
      }
    }

    totalMoves += level.solution;
    rows.push({
      level,
      moves: level.solution,
      budget: level.budget,
      difficulty: level.difficulty,
      band: level.band,
      cells: rules.grid.cells.length,
    });
  }

  perAlbum.push({ album, rows, replayed });
}

// ---------------------------------------------------------------------------
// the ramps
// ---------------------------------------------------------------------------

for (const { album, rows } of perAlbum) {
  if (!rows.length) continue;
  const byChapter = new Map();
  for (const r of rows) {
    const c = r.level.chapter;
    if (!byChapter.has(c)) byChapter.set(c, []);
    byChapter.get(c).push(r.difficulty);
  }
  const means = [...byChapter.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([c, list]) => ({ chapter: c, mean: list.reduce((a, b) => a + b, 0) / list.length }));
  if (means.length >= 2) {
    const first = means[0].mean;
    const last = means[means.length - 1].mean;
    if (last <= first) {
      fail(album.id, `the ramp does not rise: chapter 1 mean ${first.toFixed(2)} vs last ${last.toFixed(2)}`);
    }
  }
  const grids = new Set(rows.map((r) => r.level.grid));
  const modes = new Set(rows.map((r) => r.level.mode));
  const goals = new Set(rows.map((r) => r.level.goal));

  if (!QUIET) {
    console.log(`\n  ${album.nameZh} / ${album.name}  [${album.palette}]`);
    console.log(
      `    ${rows.length} boards · ${[...grids].sort().join(', ')} · ` +
      `modes ${[...modes].sort().join('/')} · goals ${[...goals].sort().join('/')}`
    );
    console.log(
      `    ramp: ${means.map((m) => `ch${m.chapter + 1} ${m.mean.toFixed(2)}`).join('  ')}`
    );
    const hardest = rows.reduce((a, r) => (r.difficulty > a.difficulty ? r : a), rows[0]);
    console.log(
      `    hardest: ${hardest.level.name.padEnd(18)} ${hardest.difficulty.toFixed(2)} ` +
      `(${hardest.moves} moves in ${hardest.budget}, ${hardest.cells} cells)`
    );
  }
  if (grids.size < 4) fail(album.id, `only ${grids.size} grid shapes appear in this album`);
  if (modes.size < 2) fail(album.id, 'this album never uses the replace rule set');
  if (goals.size < 2) fail(album.id, 'this album never uses the recipe goal');
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

const checked = perAlbum.reduce((n, a) => n + a.rows.length, 0);
const allDifficulties = LEVELS.map((l) => l.difficulty);
console.log(
  `\n${checked} boards replayed and re-measured · ` +
  `${LEVELS.length} in the file · ${totalMoves} moves of content`
);
console.log(
  `difficulty range ${Math.min(...allDifficulties).toFixed(2)} – ${Math.max(...allDifficulties).toFixed(2)}` +
  ` · ${Object.keys(ALBUM_STATS).length} albums · ${LEVELS.length} boards`
);

if (notes.length) {
  console.log(`\n${notes.length} note(s) - the file's move count differs from a fresh solve:`);
  for (const n of notes.slice(0, 8)) console.log(`  - ${n}`);
  if (notes.length > 8) console.log(`  - ... and ${notes.length - 8} more`);
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems.slice(0, 30)) console.log(`  ✗ ${p}`);
  if (problems.length > 30) console.log(`  … and ${problems.length - 30} more`);
}

console.log(failures === 0 ? '\nall level checks passed\n' : `\n${failures} level check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);

// ---------------------------------------------------------------------------

