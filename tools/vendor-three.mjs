#!/usr/bin/env node
/**
 * Vendor the exact three.js files this game imports, by walking the import graph.
 *
 * The project ships no build step and no node_modules: the browser loads three
 * straight out of `vendor/three/` through the import map in index.html. That only
 * works if every file the addons reach for is present at the same relative path
 * it expects — and an addon's dependency set is not documented anywhere, so
 * hand-copying files is a reliable way to ship a 404.
 *
 * So instead of a hardcoded file list, this script starts from the few modules
 * the game actually imports and follows every relative `from './x.js'` /
 * `import './x.js'` it finds until the closure is closed. `three` itself (the
 * bare specifier) is deliberately NOT followed: it resolves through the import
 * map to the vendored build.
 *
 *   node tools/vendor-three.mjs            # fetch + write vendor/three/
 *   node tools/vendor-three.mjs --check    # verify what's on disk is complete
 *
 * Pinned to the version below, because the addon paths are not stable across
 * majors and a silent bump would be a silent break.
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const THREE_VERSION = '0.186.1';
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vendor', 'three');

/**
 * The build itself plus the entry points of every addon the game uses. Each is
 * relative to the npm package root; addons land under `addons/`, which is the
 * path index.html maps `three/addons/` to.
 */
const SEEDS = [
  { from: 'build/three.module.js', to: 'three.module.js' },
  { from: 'build/three.core.js', to: 'three.core.js' },
  { from: 'LICENSE', to: 'LICENSE' },

  // post-processing chain: bloom is the whole reason this game looks like it does
  { from: 'examples/jsm/postprocessing/EffectComposer.js', to: 'addons/postprocessing/EffectComposer.js' },
  { from: 'examples/jsm/postprocessing/RenderPass.js', to: 'addons/postprocessing/RenderPass.js' },
  { from: 'examples/jsm/postprocessing/UnrealBloomPass.js', to: 'addons/postprocessing/UnrealBloomPass.js' },
  { from: 'examples/jsm/postprocessing/ShaderPass.js', to: 'addons/postprocessing/ShaderPass.js' },
  { from: 'examples/jsm/postprocessing/OutputPass.js', to: 'addons/postprocessing/OutputPass.js' },

  // a procedural studio env map: zero downloaded HDRIs, and it gives the tiles
  // something to reflect (see the 'reflection' material preset)
  { from: 'examples/jsm/environments/RoomEnvironment.js', to: 'addons/environments/RoomEnvironment.js' },

  { from: 'examples/jsm/controls/OrbitControls.js', to: 'addons/controls/OrbitControls.js' },
  { from: 'examples/jsm/loaders/RGBELoader.js', to: 'addons/loaders/RGBELoader.js' },
  { from: 'examples/jsm/libs/lil-gui.module.min.js', to: 'addons/libs/lil-gui.module.min.js' },
];

/** `from './x.js'` / `from "../shaders/Y.js"` / bare `import './x.js'`. */
const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s*(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]/g;

const isRelative = (spec) => spec.startsWith('./') || spec.startsWith('../');

/** Where an addon file's own relative import lives on disk and on the CDN. */
function resolveRel(fromPath, spec) {
  const npmPath = posix.normalize(posix.join(posix.dirname(fromPath), spec));
  // addons keep their examples/jsm/... layout; everything else is build/
  const outPath = npmPath.startsWith('examples/jsm/')
    ? 'addons/' + npmPath.slice('examples/jsm/'.length)
    : npmPath.replace(/^build\//, '');
  return { npmPath, outPath };
}

const exists = (p) => access(p).then(() => true, () => false);

async function fetchText(npmPath) {
  const url = `${CDN}/${npmPath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.text();
}

/** Breadth-first walk of the import graph, seeded from SEEDS. */
async function collectGraph({ check }) {
  const seen = new Map(); // npmPath -> { outPath, source }
  const queue = SEEDS.map((s) => ({ npmPath: s.from, outPath: s.to }));

  while (queue.length) {
    const { npmPath, outPath } = queue.shift();
    if (seen.has(npmPath)) continue;

    let source = null;
    if (check) {
      const disk = join(OUT, outPath);
      if (!(await exists(disk))) throw new Error(`missing on disk: vendor/three/${outPath}`);
      source = await readFile(disk, 'utf8');
    } else {
      source = await fetchText(npmPath);
    }
    seen.set(npmPath, { outPath, source });

    for (const m of source.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (!isRelative(spec)) continue; // 'three' → import map, nothing to vendor
      const next = resolveRel(npmPath, spec);
      if (!seen.has(next.npmPath)) queue.push(next);
    }
  }
  return seen;
}

export async function vendorThree({ check = false } = {}) {
  const graph = await collectGraph({ check });

  if (!check) {
    for (const { outPath, source } of graph.values()) {
      const dest = join(OUT, outPath);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, source);
    }
  }

  const files = [...graph.values()].map((f) => f.outPath).sort();
  const bytes = [...graph.values()].reduce((n, f) => n + Buffer.byteLength(f.source), 0);
  return { version: THREE_VERSION, files, bytes };
}

// Run only when invoked directly (`node tools/vendor-three.mjs`), not on import
// from fetch-assets.mjs. Comparing resolved paths rather than URL strings,
// because Windows hands us a drive-letter path that never string-matches.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const check = process.argv.includes('--check');
  try {
    const { version, files, bytes } = await vendorThree({ check });
    const verb = check ? 'verified' : 'vendored';
    console.log(`three@${version} ${verb}: ${files.length} files, ${(bytes / 1024).toFixed(0)} KB`);
    for (const f of files) console.log(`  ${f}`);
  } catch (err) {
    console.error(`vendor-three failed: ${err.message}`);
    process.exit(1);
  }
}
