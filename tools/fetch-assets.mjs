#!/usr/bin/env node
/**
 * Fetch the optional assets.
 *
 * Everything in this game is generated at runtime — the board geometry, the
 * colours, the environment map and every sound. The only thing a download genuinely
 * improves is the *type*, so that is what this fetches, and it is fetched from a
 * pinned CDN path with a size check and a retry, because a build step that
 * sometimes produces a broken page is worse than no build step.
 *
 *   node tools/fetch-assets.mjs            # Inter, latin, five weights (~120 KB)
 *   node tools/fetch-assets.mjs --cjk      # also Noto Sans SC (~7 MB, ~200 files)
 *   node tools/fetch-assets.mjs --check    # report what is present, fetch nothing
 *   node tools/fetch-assets.mjs --force    # re-download what already exists
 *
 * Nothing here is required. `assets/fonts/fonts.css` is committed as a placeholder
 * with no @font-face rules in it, so the page always has a stylesheet to load and
 * the system font stack is used until this script fills it in. That means the game
 * works offline, on a fresh clone, with no build step — which is the whole point of
 * the project having no build step.
 *
 * Licences are recorded in assets/CREDITS.md; both faces here are OFL-1.1, which
 * permits redistribution.
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = join(ROOT, 'assets', 'fonts');

const argv = process.argv.slice(2);
const WITH_CJK = argv.includes('--cjk');
const CHECK_ONLY = argv.includes('--check');
const FORCE = argv.includes('--force');

const INTER = 'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.3.0';
const NOTO_SC = 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.0';

/** The weights the interface actually uses: body, semibold, bold, and display. */
const INTER_WEIGHTS = [
  { weight: 400, style: 'normal' },
  { weight: 600, style: 'normal' },
  { weight: 700, style: 'normal' },
  { weight: 800, style: 'normal' },
  { weight: 900, style: 'normal' },
];

const CJK_WEIGHTS = [400, 700];

const exists = (p) => stat(p).then(() => true, () => false);

/** Fetch with a few retries: the CDN drops requests in bursts under load. */
async function fetchWithRetry(url, { attempts = 4, timeoutMs = 30000 } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      // back off a little; a burst of parallel requests is what gets dropped
      await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
  }
  throw lastErr ?? new Error('fetch failed');
}

const stats = { ok: 0, skipped: 0, failed: 0, bytes: 0 };
const failed = [];

async function grab(rel, url, { required = false, expect = 0 } = {}) {
  const dest = join(ROOT, rel);
  if (!FORCE && await exists(dest)) {
    const info = await stat(dest);
    if (!expect || info.size === expect) {
      stats.skipped++;
      return true;
    }
  }
  if (CHECK_ONLY) {
    console.log(`  missing  ${rel}`);
    stats.failed += required ? 1 : 0;
    return false;
  }
  try {
    const buf = await fetchWithRetry(url);
    if (expect && buf.length !== expect) {
      throw new Error(`size ${buf.length} != expected ${expect}`);
    }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    stats.ok++;
    stats.bytes += buf.length;
    console.log(`  ok       ${rel}  ${(buf.length / 1024).toFixed(0)} KB`);
    return true;
  } catch (err) {
    stats.failed++;
    failed.push({ rel, url, error: err.message, required });
    console.log(`  ${required ? 'FAILED  ' : 'skipped '} ${rel}  (${err.message})`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// fonts
// ---------------------------------------------------------------------------

/**
 * The @font-face rules are generated from what actually downloaded, so a partial
 * run cannot produce a stylesheet that references a file that is not there — which
 * would show up as a silent fallback to the system font and a 404 in the console.
 */
const faces = [];

async function fetchInter() {
  console.log('\nInter — the grotesque the interface is set in (OFL-1.1)');
  const available = [];
  for (const { weight, style } of INTER_WEIGHTS) {
    const file = `inter-latin-${weight}-${style}.woff2`;
    const ok = await grab(
      `assets/fonts/${file}`,
      `${INTER}/files/${file}`,
      { required: weight === 400 || weight === 700 }
    );
    if (ok) available.push({ weight, style, file });
  }
  for (const { weight, style, file } of available) {
    faces.push({ family: 'Inter', weight, style, file, unicodeRange: null });
  }
  return available.length;
}

async function fetchCjk() {
  console.log('\nNoto Sans SC — Simplified Chinese, subset by unicode range (OFL-1.1)');
  const available = [];
  for (const weight of CJK_WEIGHTS) {
    const cssUrl = `${NOTO_SC}/${weight}.css`;
    let css;
    try {
      css = (await fetchWithRetry(cssUrl)).toString('utf8');
    } catch (err) {
      console.log(`  skipped  ${weight}.css  (${err.message})`);
      continue;
    }
    await mkdir(FONT_DIR, { recursive: true });

    // Each @font-face in the package CSS carries a unicode-range and a woff2 URL.
    // Both are needed: the range is what lets the browser fetch only the subsets a
    // page actually uses, which is the difference between 7 MB and 90 KB on screen.
    const blocks = css.split('@font-face').slice(1);
    const entries = [];
    for (const block of blocks) {
      const url = /url\(([^)]+)\)/.exec(block)?.[1]?.replace(/['"]/g, '');
      const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim();
      const w = Number(/font-weight:\s*(\d+)/.exec(block)?.[1] ?? weight);
      const st = /font-style:\s*(\w+)/.exec(block)?.[1] ?? 'normal';
      if (!url) continue;
      const file = url.split('/').pop();
      entries.push({ weight: w, style: st, file, unicodeRange: range });
    }
    let got = 0;
    for (const e of entries) {
      const ok = await grab(`assets/fonts/${e.file}`, `${NOTO_SC}/files/${e.file}`);
      if (ok) { available.push(e); got++; }
    }
    console.log(`  ${weight}: ${got}/${entries.length} subsets`);
  }
  for (const e of available) {
    faces.push({
      family: 'Noto Sans SC',
      weight: e.weight,
      style: e.style,
      file: e.file,
      unicodeRange: e.unicodeRange,
    });
  }
  return available.length;
}

// ---------------------------------------------------------------------------
// the stylesheet
// ---------------------------------------------------------------------------

const PLACEHOLDER = `/* Optional webfonts. Generated by tools/fetch-assets.mjs.
 *
 * This file is committed with no @font-face rules in it on purpose: the interface
 * falls back to the system grotesque stack, which on macOS and Windows is already
 * a Helvetica-adjacent face. Running \`npm run assets\` fills in Inter (and, with
 * --cjk, Noto Sans SC) and the page picks them up with no other change.
 *
 * Committed empty so that index.html can always link it: a stylesheet that is
 * absent in a fresh clone would 404 on every load.
 */
`;

function buildCss() {
  if (!faces.length) return PLACEHOLDER;
  const lines = [
    '/* Optional webfonts. Generated by tools/fetch-assets.mjs — do not edit by hand.',
    ' * Faces listed here are exactly the files that downloaded successfully. */',
    '',
  ];
  for (const f of faces) {
    lines.push('@font-face {');
    lines.push(`  font-family: '${f.family}';`);
    lines.push(`  font-style: ${f.style};`);
    lines.push(`  font-weight: ${f.weight};`);
    lines.push('  font-display: swap;');
    if (f.unicodeRange) lines.push(`  unicode-range: ${f.unicodeRange};`);
    lines.push(`  src: url('./${f.file}') format('woff2');`);
    lines.push('}');
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------

console.log(CHECK_ONLY ? '\nchecking optional assets' : '\nfetching optional assets');

await mkdir(FONT_DIR, { recursive: true });
await fetchInter();
if (WITH_CJK) await fetchCjk();
else console.log('\nNoto Sans SC skipped (pass --cjk to fetch it; ~7 MB)');

if (!CHECK_ONLY) {
  await writeFile(join(FONT_DIR, 'fonts.css'), buildCss());
}

console.log(
  `\n${stats.ok} downloaded · ${stats.skipped} already present · ${stats.failed} failed` +
  (stats.bytes ? ` · ${(stats.bytes / 1024).toFixed(0)} KB written` : '')
);
if (failed.length) {
  console.log('\nnot downloaded (the game runs without them):');
  for (const f of failed.slice(0, 10)) console.log(`  ${f.rel}  ${f.error}`);
  if (failed.length > 10) console.log(`  ... and ${failed.length - 10} more`);
}
console.log(`\nwrote assets/fonts/fonts.css\n`);

// Only a *required* face failing is an error, and only when the run was asked to
// fetch rather than to report.
process.exit(failed.some((f) => f.required) && !CHECK_ONLY ? 1 : 0);
