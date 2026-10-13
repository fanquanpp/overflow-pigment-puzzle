#!/usr/bin/env node
/**
 * Smoke test: can the pipeline actually produce a playable board?
 *
 * This is the integration check between the four logic modules — grid, colour,
 * rules, generator — and it is deliberately blunt. It generates a board, solves
 * it, replays the solution through the *session* (not through the solver's own
 * copy of the rules), and asserts the session agrees it is won. That last step is
 * the one that matters: it catches a rules engine and a solver that have drifted
 * apart, which is the failure mode that would otherwise show up as a level the
 * validator swears is winnable and the player cannot win.
 *
 *   node tools/smoke.mjs
 *   node tools/smoke.mjs --verbose
 */
import { GRID_TYPES } from '../src/grid/grid.js';
import { PALETTES, paletteFor, SHIPPED_PALETTES, buildPalette } from '../src/color/pigment.js';
import { compileLevel, createSession, validateRules, isSolved } from '../src/puzzle/rules.js';
import { analyse } from '../src/puzzle/solve.js';
import { generateBoard, generateRecipe, mulberry32, seedFrom } from '../src/puzzle/generate.js';

const VERBOSE = process.argv.includes('--verbose');
let failures = 0;
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

const lookup = (key) => paletteFor(key);

// ---------------------------------------------------------------------------
console.log('\n1. reverse construction always yields a solvable, well-formed board');

const SPECS = [];
for (const palette of SHIPPED_PALETTES.slice(0, 3)) {
  SPECS.push({
    id: `smoke-square-${palette}`,
    grid: 'square', cols: 6, rows: 6,
    palette, mode: 'mix', goal: 'unify',
    target: 0b111, steps: 6, stepsSpread: 4, slack: 1,
    paletteLookup: lookup,
  });
}

for (const spec of SPECS) {
  const entry = generateBoard(spec, { rng: mulberry32(seedFrom(spec.id)), attempts: 12, beamWidth: 120 });
  if (!entry) { fail(`${spec.id}: generator produced nothing`); continue; }
  const rules = compileLevel(entry.level, lookup);
  const problems = validateRules(rules);
  if (problems.length) { fail(`${spec.id}: ${problems[0]}`); continue; }

  // Replay the solver's solution through the real session.
  const session = createSession(rules);
  for (const mv of entry.report.moves) {
    const res = session.play(mv.cell, mv.pigment);
    if (!res.ok) { fail(`${spec.id}: replay rejected a move (${res.reason})`); break; }
  }
  const won = isSolved(rules, session.colors);
  if (!won) fail(`${spec.id}: replaying the solution did not win`);
  else if (VERBOSE) {
    console.log(
      `  ✓ ${spec.id.padEnd(26)} ${String(entry.report.length).padStart(2)} moves` +
      ` (budget ${entry.level.budget}, lb ${entry.report.lowerBound})` +
      `  ${entry.report.band.nameZh} ${entry.report.difficulty.toFixed(2)}` +
      `  ${entry.report.elapsed}ms`
    );
  }
}

// ---------------------------------------------------------------------------
console.log('\n2. a board that starts off-target is refused, not silently unsolvable');

{
  const spec = {
    id: 'bad', grid: 'square', cols: 4, rows: 4, palette: 'printer',
    mode: 'mix', goal: 'unify', target: 0b001, budget: 5,
    colors: new Array(16).fill(0b010), // starts on a pigment the target lacks
    paletteLookup: lookup,
  };
  const problems = validateRules(compileLevel(spec, lookup));
  if (problems.some((p) => p.includes('unsolvable'))) ok('equality goal with an off-target start is rejected');
  else fail(`expected an unsolvability report, got: ${problems.join('; ') || 'none'}`);
}

// ---------------------------------------------------------------------------
console.log('\n3. replace mode is always winnable and never gets stuck');

{
  const spec = {
    id: 'classic', grid: 'square', cols: 5, rows: 5, palette: 'printer',
    mode: 'replace', goal: 'unify', target: 0b001, steps: 8, slack: 2,
    paletteLookup: lookup,
  };
  const entry = generateBoard(spec, { rng: mulberry32(11), attempts: 8, beamWidth: 120 });
  if (!entry) fail('replace board generation produced nothing');
  else {
    const rules = compileLevel(entry.level, lookup);
    const session = createSession(rules);
    let guard = 0;
    while (!session.solved && !session.lost && guard++ < 200) {
      const moves = session.moves_available();
      if (!moves.length) break;
      // dumbest possible play: paint every region with the target
      const mv = moves.find((m) => m.to === rules.targets[moves[0].cell]) ?? moves[0];
      session.play(mv.cell, mv.pigment);
    }
    if (session.solved) ok(`naive target-painting wins in ${session.moves} moves (budget ${rules.budget})`);
    else fail(`naive play failed: solved=${session.solved} stuck=${session.stuck} lost=${session.lost} moves=${session.moves}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n4. recipe boards mark cells and stay winnable');

{
  const spec = {
    id: 'recipe', grid: 'square', cols: 6, rows: 6, palette: 'painter',
    mode: 'mix', goal: 'recipe', steps: 5, slack: 2, markRatio: 0.6,
    paletteLookup: lookup,
  };
  const entry = generateRecipe(spec, { rng: mulberry32(seedFrom('recipe')), attempts: 14, beamWidth: 120 });
  if (!entry) fail('recipe generation produced nothing');
  else {
    const rules = compileLevel(entry.level, lookup);
    const session = createSession(rules);
    for (const mv of entry.report.moves) session.play(mv.cell, mv.pigment);
    const marked = rules.targets.filter((t) => t !== 0xff).length;
    if (isSolved(rules, session.colors)) {
      ok(`${marked} marked cells satisfied in ${entry.report.length} moves (budget ${entry.level.budget})`);
    } else {
      fail('recipe replay did not satisfy every marked cell');
    }
    // containment means a marked cell may hold extra pigments without failing
    const overfilled = session.colors.some((c, i) => rules.targets[i] !== 0xff && (c & rules.targets[i]) === rules.targets[i] && c !== rules.targets[i]);
    if (overfilled) ok('containment semantics confirmed: marked cells may carry extra pigments');
  }
}

// ---------------------------------------------------------------------------
console.log('\n5. the move budget is achievable — every generated board can be won');

{
  let checked = 0;
  let worst = 0;
  for (let seed = 0; seed < 24; seed++) {
    const palette = SHIPPED_PALETTES[seed % SHIPPED_PALETTES.length];
    const spec = {
      id: `budget-${seed}`, grid: 'square',
      cols: 5 + (seed % 3), rows: 5 + (seed % 3),
      palette, mode: 'mix', goal: 'unify', target: 0b111, steps: 5, slack: 1,
      paletteLookup: lookup,
    };
    const entry = generateBoard(spec, { rng: mulberry32(seed * 2654435761), attempts: 6, beamWidth: 120 });
    if (!entry) continue;
    const rules = compileLevel(entry.level, lookup);
    const session = createSession(rules);
    for (const mv of entry.report.moves) session.play(mv.cell, mv.pigment);
    if (!session.solved) { fail(`seed ${seed} (${palette}): budget not achievable`); continue; }
    checked++;
    worst = Math.max(worst, entry.report.difficulty);
  }
  if (checked) ok(`${checked} boards won within budget; hardest difficulty ${worst.toFixed(2)}`);
  else fail('no boards were generated at all');
}

// ---------------------------------------------------------------------------
console.log('\n6. every shipped palette compiles and every board is square');

{
  let bad = 0;
  for (const key of SHIPPED_PALETTES) {
    const pal = buildPalette(PALETTES[key].pigments);
    if (pal.entries.length !== (1 << pal.pigments.length)) { fail(`${key}: palette is not the full subset lattice`); bad++; }
  }
  const entry = generateBoard({
    id: 'cover-square', grid: 'square', cols: 6, rows: 6, palette: 'printer',
    mode: 'mix', goal: 'unify', target: 0b111, steps: 4, slack: 2, paletteLookup: lookup,
  }, { rng: mulberry32(7), attempts: 6, beamWidth: 100 });
  if (!entry) { fail('square: nothing generated'); bad++; }
  if (!bad) ok(`${SHIPPED_PALETTES.length} palettes compile on the square tiling`);
}

console.log(failures === 0 ? '\nsmoke test passed\n' : `\n${failures} smoke check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
