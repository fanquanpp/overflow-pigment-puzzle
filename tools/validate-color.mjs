#!/usr/bin/env node
/**
 * Check the pigment model actually behaves like paint.
 *
 * The load-bearing claim of the whole game is "cyan + yellow = green". That is a
 * physical claim about reflectance curves, and it is either true of the numbers or
 * it is not — so it gets asserted, not eyeballed.
 *
 * What is checked:
 *
 *   1. MIXING IDENTITIES — the printer's secondaries come out the right hue:
 *      cyan+yellow is green, magenta+yellow is red, magenta+cyan is blue, and all
 *      three together go dark. Hues are measured in OKLCh, not guessed from hex.
 *   2. ALGEBRA — the mix operation is closed, commutative, associative and
 *      idempotent. The game's move ("add pigment P") is only explainable to a
 *      player if these hold.
 *   3. KUBELKA–MUNK INVERSE — ksToReflectance(reflectanceToKS(r)) == r across the
 *      range, so a mixture of one pigment is that pigment.
 *   4. PALETTE SEPARATION — no two entries of a shipped palette are closer than a
 *      just-noticeable difference, and the colour-blind layer gives every entry a
 *      unique (glyph, pattern) pair.
 *
 *   node tools/validate-color.mjs
 *   node tools/validate-color.mjs --verbose   # print every mixture
 */
import {
  PIGMENTS, PALETTES, buildPalette, mixIndex, mixReflectance, reflectanceToKS,
  ksToReflectance, paletteReport, paletteDistance, DISPLAY, SEPARATION,
} from '../src/color/pigment.js';
import { linearToOklab, oklabToOklch, linearToHex, deltaE } from '../src/color/color.js';

const VERBOSE = process.argv.includes('--verbose');

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

const DEG = 180 / Math.PI;
/** Hue angle in degrees, or null for a neutral. */
function hueOf(linear) {
  const [, C, h] = oklabToOklch(linearToOklab(linear));
  return C < 0.01 ? null : ((h * DEG) % 360 + 360) % 360;
}

/** Coarse hue name, so an assertion can say "green" instead of "128°". */
function hueName(h) {
  if (h === null) return 'neutral';
  if (h < 20 || h >= 340) return 'red';
  if (h < 45) return 'orange';
  if (h < 75) return 'yellow';
  if (h < 105) return 'yellow-green';
  if (h < 160) return 'green';
  if (h < 200) return 'cyan';
  if (h < 250) return 'blue';
  if (h < 300) return 'violet';
  return 'magenta';
}

// --- 1. Kubelka–Munk round trip -------------------------------------------

console.log('\nKubelka–Munk inverse');
{
  let worst = 0;
  for (let i = 0; i <= 1000; i++) {
    const r = 0.004 + (i / 1000) * (1 - 0.004);
    const back = ksToReflectance(reflectanceToKS(r));
    worst = Math.max(worst, Math.abs(back - r));
  }
  if (worst > 1e-9) fail(`round trip error ${worst.toExponential(2)} exceeds 1e-9`);
  else ok(`reflectance → K/S → reflectance is exact to ${worst.toExponential(2)}`);

  // A single-pigment mixture must reproduce that pigment's reflectance.
  let worstSingle = 0;
  for (const p of Object.values(PIGMENTS)) {
    const m = mixReflectance([[p.id, 1]]);
    for (let c = 0; c < 3; c++) worstSingle = Math.max(worstSingle, Math.abs(m[c] - p.reflectance[c]));
  }
  if (worstSingle > 1e-9) fail(`single-pigment mix drifts by ${worstSingle.toExponential(2)}`);
  else ok('a one-pigment mixture is that pigment');
}

// --- 2. mixing identities --------------------------------------------------

console.log('\nmixing identities (printer\'s primaries)');
{
  const cases = [
    { parts: ['cyan', 'yellow'], expect: ['green', 'yellow-green'], label: 'cyan + yellow' },
    { parts: ['magenta', 'yellow'], expect: ['red', 'orange'], label: 'magenta + yellow' },
    { parts: ['magenta', 'cyan'], expect: ['blue', 'violet'], label: 'magenta + cyan' },
  ];
  for (const c of cases) {
    const lin = mixReflectance(c.parts.map((id) => [id, 1]));
    const h = hueOf(lin);
    const name = hueName(h);
    const good = c.expect.includes(name);
    const line = `${c.label.padEnd(18)} → ${linearToHex(lin)}  ${name.padEnd(13)} ${h === null ? '' : h.toFixed(0) + '°'}`;
    if (good) console.log(`  ✓ ${line}`);
    else fail(`${line}  (expected ${c.expect.join(' or ')})`);
  }

  // All three primaries must darken, not stay saturated.
  const tri = mixReflectance([['cyan', 1], ['magenta', 1], ['yellow', 1]]);
  const triL = linearToOklab(tri)[0];
  const yellowL = linearToOklab(PIGMENTS.yellow.reflectance)[0];
  if (triL < yellowL - 0.2) console.log(`  ✓ cyan + magenta + yellow → ${linearToHex(tri)}  L ${triL.toFixed(3)} (darkened from ${yellowL.toFixed(3)})`);
  else fail(`three-pigment mix did not darken: L ${triL.toFixed(3)} vs yellow ${yellowL.toFixed(3)}`);

  // Painter's primaries: yellow + indigo must go green, because indigo is the
  // cyan-leaning blue. Red + indigo going muddy is *expected* — that is what real
  // paint does, and the level design leans on it rather than hiding it.
  const ryb2 = mixReflectance([['yellow', 1], ['indigo', 1]]);
  const ryb2Hue = hueName(hueOf(ryb2));
  if (['green', 'yellow-green', 'cyan'].includes(ryb2Hue)) {
    console.log(`  ✓ yellow + indigo     → ${linearToHex(ryb2)}  ${ryb2Hue}`);
  } else {
    fail(`yellow + indigo came out ${ryb2Hue} (${linearToHex(ryb2)}), expected green`);
  }
  const ryb = mixReflectance([['vermilion', 1], ['indigo', 1]]);
  const rybHue = hueName(hueOf(ryb));
  console.log(`  · vermilion + indigo  → ${linearToHex(ryb)}  ${rybHue}  (muddy on purpose: red pigment eats blue and vice versa)`);
}

// --- 3. algebra ------------------------------------------------------------

console.log('\nmix algebra');
for (const [key, def] of Object.entries(PALETTES)) {
  const palette = buildPalette(def.pigments);
  const n = palette.entries.length;
  let closure = 0, comm = 0, assoc = 0, idem = 0;

  for (let a = 0; a < n; a++) {
    if (mixIndex(palette, a, a) !== a) idem++;
    for (let b = 0; b < n; b++) {
      const ab = mixIndex(palette, a, b);
      if (ab < 0 || ab >= n) closure++;
      if (ab !== mixIndex(palette, b, a)) comm++;
      for (let c = 0; c < n; c++) {
        const left = mixIndex(palette, ab, c);
        const right = mixIndex(palette, a, mixIndex(palette, b, c));
        if (left !== right) assoc++;
      }
    }
  }
  const bad = closure + comm + assoc + idem;
  if (bad === 0) ok(`${key.padEnd(6)} ${n - 1} colours — closed, commutative, associative, idempotent`);
  else fail(`${key}: closure=${closure} commutative=${comm} associative=${assoc} idempotent=${idem}`);
}

// --- 4. palette separation and the colour-blind layer ----------------------

console.log(`\npalette separation (OKLab ΔE; ${SEPARATION.jnd} = indistinguishable, ${SEPARATION.safe} = comfortable)`);
for (const [key, def] of Object.entries(PALETTES)) {
  const palette = buildPalette(def.pigments);
  const report = paletteReport(palette);

  // unique (glyph, pattern) per entry is what makes the board readable in greyscale
  const seen = new Set();
  let collisions = 0;
  for (const e of palette.entries) {
    if (e.mask === 0) continue;
    const k = `${e.glyph}|${e.pattern}`;
    if (seen.has(k)) collisions++;
    seen.add(k);
  }
  if (collisions) fail(`${key}: ${collisions} duplicate (glyph, pattern) pairs`);

  // nothing may be so dark it reads as the background, or so light it vanishes
  let outOfBand = 0;
  for (const e of palette.entries) {
    if (e.mask === 0) continue;
    const L = linearToOklab(e.linear)[0];
    if (L < DISPLAY.lightness[0] - 1e-6 || L > DISPLAY.lightness[1] + 1e-6) outOfBand++;
  }
  if (outOfBand) fail(`${key}: ${outOfBand} display colours outside the lightness band`);

  // A palette marked `ship` is level content and must clear the bar. The rest are
  // kept for the mixing lab; their crowding is the documented finding, not a bug,
  // so they are reported without failing the run.
  const mark = def.ship ? (report.safe ? '✓' : '✗') : '·';
  console.log(
    `  ${mark} ${key.padEnd(8)} ${(def.ship ? 'content' : 'lab').padEnd(7)}` +
    ` ${String(report.count).padStart(2)} colours` +
    `  minΔE=${report.minDeltaE.toFixed(4)}` +
    `  ${report.safe ? 'comfortable' : report.distinguishable ? 'needs the glyph layer' : 'too close to ship'}` +
    `  closest: ${report.closest.join(' vs ')}`
  );
  if (def.ship && !report.safe) failures++;

  if (VERBOSE) {
    for (const e of palette.entries) {
      if (e.mask === 0) continue;
      const L = linearToOklab(e.linear)[0];
      console.log(
        `        ${e.hex}  L=${L.toFixed(3)}  ${e.glyph} ${e.pattern.padEnd(7)}` +
        `  ${e.name.padEnd(28)} ${e.nameZh}`
      );
    }
  }
}

// --- the accessibility pass must actually help -----------------------------

console.log('\naccessibility pass');
{
  // Under deuteranopia red and green collapse. Check that no palette relies on
  // that axis alone: every pair closer than ΔE 0.08 must differ in lightness or
  // carry a different glyph.
  const palette = buildPalette(PALETTES.printer.pigments);
  const entries = palette.entries.filter((e) => e.mask !== 0);
  let unguarded = 0;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const d = paletteDistance(palette, entries[i].index, entries[j].index);
      if (d >= 0.08) continue;
      const dL = Math.abs(linearToOklab(entries[i].linear)[0] - linearToOklab(entries[j].linear)[0]);
      const glyphsDiffer = entries[i].glyph !== entries[j].glyph || entries[i].pattern !== entries[j].pattern;
      if (!glyphsDiffer && dL < 0.04) unguarded++;
    }
  }
  if (unguarded === 0) ok('every near-identical pair differs by glyph/pattern or by lightness');
  else fail(`${unguarded} close pairs have no non-colour distinction`);
}

// --- verbose mixture table -------------------------------------------------

if (VERBOSE) {
  console.log('\nfull mixture table — printer');
  const palette = buildPalette(PALETTES.printer.pigments);
  for (const e of palette.entries) {
    if (e.mask === 0) continue;
    const h = hueOf(e.linear);
    console.log(
      `  ${e.hex}  mask=${e.mask.toString(2).padStart(3, '0')}  ` +
      `${hueName(h).padEnd(13)} ${h === null ? '   —' : h.toFixed(0).padStart(3) + '°'}  ` +
      `raw=[${e.reflectance.map((v) => v.toFixed(3)).join(', ')}]  ${e.nameZh}`
    );
  }
  console.log('\nfull mixture table — painter');
  const ryb = buildPalette(PALETTES.painter.pigments);
  for (const e of ryb.entries) {
    if (e.mask === 0) continue;
    const h = hueOf(e.linear);
    console.log(
      `  ${e.hex}  mask=${e.mask.toString(2).padStart(3, '0')}  ` +
      `${hueName(h).padEnd(13)} ${h === null ? '   —' : h.toFixed(0).padStart(3) + '°'}  ${e.nameZh}`
    );
  }
}

console.log(failures === 0 ? '\nall colour checks passed\n' : `\n${failures} colour check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
