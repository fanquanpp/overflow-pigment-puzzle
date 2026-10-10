#!/usr/bin/env node
/**
 * Prove the grid geometry is actually a tiling.
 *
 * The four shapes in src/grid/grid.js are derived, not transcribed. A wrong
 * neighbour table or a misplaced centroid produces a board that looks *almost*
 * right — a hairline seam, two tiles overlapping by a pixel, a cell whose
 * neighbours are not symmetric so flood-fill leaks — and none of that is visible
 * in a screenshot. So it gets checked as geometry.
 *
 * Three independent checks:
 *
 *   1. NO OVERLAP — separating-axis test on every nearby tile pair. Exact for
 *      convex polygons; no sampling, no epsilon guessing.
 *
 *   2. EDGES CLOSE UP — every geometric edge of every tile is either shared with
 *      exactly one other tile (which must also be in the neighbour list), or it
 *      faces a direction whose cell is genuinely absent from the board (off the
 *      edge, or cut out by the mask). This is the check that catches gaps, and it
 *      is driven by the tiling structure rather than by a bounding box, because a
 *      jagged board's bounding box legitimately contains uncovered notches.
 *
 *   3. ADJACENCY IS REAL — symmetric, duplicate-free, and every listed pair must
 *      actually share two corners. Plus degree and connectivity.
 *
 * A naive "sample points, count containing tiles" test is also run, but only to
 * cross-check `pickAt` against brute force — not to judge coverage, because a
 * sample landing exactly on a shared edge belongs to two tiles by definition and
 * a sample in a boundary notch belongs to none.
 *
 *   node tools/validate-grid.mjs
 *   node tools/validate-grid.mjs --pairs=8000   # random pairs tested for overlap
 */
import { createGrid, GRID_TYPES, MAX_NEIGHBORS, pointInPolygon } from '../src/grid/grid.js';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : fallback; // +3 = "--" and "="
};

const SIZE = 1;
const EDGE_STEP = 0.02 * SIZE; // how far to step outward from an edge midpoint
const EPS = 1e-9;

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (x, y, q = 1e-6) => `${Math.round(x / q)}|${Math.round(y / q)}`;

/** Tile ring in absolute coordinates. */
function absPoly(grid, index) {
  const pts = grid.cellPolygon(index);
  const c = grid.cellCenter(index);
  const out = [];
  for (let i = 0; i < pts.length; i += 2) out.push([c.x + pts[i], c.y + pts[i + 1]]);
  return out;
}

/** Separating-axis overlap test for two convex rings. Touching counts as disjoint. */
function overlapAmount(a, b) {
  let least = Infinity;
  for (const poly of [a, b]) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % n];
      let nx = -(q[1] - p[1]);
      let ny = q[0] - p[0];
      const len = Math.hypot(nx, ny);
      if (len < 1e-12) continue;
      nx /= len; ny /= len;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const v of a) { const d = v[0] * nx + v[1] * ny; if (d < amin) amin = d; if (d > amax) amax = d; }
      for (const v of b) { const d = v[0] * nx + v[1] * ny; if (d < bmin) bmin = d; if (d > bmax) bmax = d; }
      const sep = Math.min(amax, bmax) - Math.max(amin, bmin);
      if (sep < least) least = sep;
      if (least <= EPS) return 0;
    }
  }
  return least;
}

/** Edge midpoint + outward normal, per ring edge. Ring winding is not assumed. */
function edgeFrames(grid, index) {
  const poly = absPoly(grid, index);
  const c = grid.cellCenter(index);
  const frames = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    let mx = (p[0] + q[0]) / 2;
    let my = (p[1] + q[1]) / 2;
    let nx = -(q[1] - p[1]);
    let ny = q[0] - p[0];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    // point the normal away from the cell centre
    if ((mx - c.x) * nx + (my - c.y) * ny < 0) { nx = -nx; ny = -ny; }
    frames.push({ mx, my, nx, ny });
  }
  return frames;
}

function checkOverlap(grid, rnd, pairs) {
  const cells = Array.from(grid.cells);
  const polys = cells.map((i) => absPoly(grid, i));
  const worst = [];
  let bad = 0;

  // Spatial hash on centroid so this stays fast on the biggest boards.
  const cell = 2 * SIZE;
  const buckets = new Map();
  cells.forEach((idx, k) => {
    const c = grid.cellCenter(idx);
    const bx = Math.floor(c.x / cell), by = Math.floor(c.y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const k2 = `${bx + dx}|${by + dy}`;
      if (!buckets.has(k2)) buckets.set(k2, []);
      buckets.get(k2).push(k);
    }
  });

  const tested = new Set();
  for (const [, list] of buckets) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a], j = list[b];
        const pairKey = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (tested.has(pairKey)) continue;
        tested.add(pairKey);
        const amt = overlapAmount(polys[i], polys[j]);
        if (amt > EPS) {
          if (bad++ < 4) fail(`tiles ${cells[i]} and ${cells[j]} overlap by ${amt.toFixed(5)}`);
          worst.push(amt);
        }
      }
    }
  }
  // Also throw random far-apart pairs at it, to catch a centroid that is simply
  // in the wrong place rather than slightly off.
  for (let n = 0; n < pairs; n++) {
    const i = (rnd() * cells.length) | 0;
    const j = (rnd() * cells.length) | 0;
    if (i === j) continue;
    const amt = overlapAmount(polys[i], polys[j]);
    if (amt > EPS && bad++ < 8) fail(`tiles ${cells[i]} and ${cells[j]} overlap by ${amt.toFixed(5)} (random pair)`);
  }
  return { bad, testedPairs: tested.size };
}

function checkEdges(grid, refGrid) {
  // Map each cell's neighbour slots to the ring edge that faces them.
  let bad = 0;
  const shape = { square: 4, hex: 6, diamond: 4, triangle: 3 }[grid.type];

  // Candidate directions come from the same cell in an *unmasked* grid of the same
  // shape, never from a blanket 8-offset list: on a square board the diagonal is a
  // present cell that is correctly not a neighbour, and a generic list would report
  // it as a missing edge.
  const directionsFor = (col, row) => {
    const out = [];
    const c0 = refGrid.coordsOf(refGrid.cells[0]);
    for (let k = 0; k < MAX_NEIGHBORS; k++) {
      const n = refGrid.nbr[(row * refGrid.cols + col) * MAX_NEIGHBORS + k];
      if (n < 0) break;
      const nc = refGrid.coordsOf(n);
      out.push([nc.col - col, nc.row - row]);
    }
    void c0;
    return out;
  };

  for (const i of grid.cells) {
    const c = grid.cellCenter(i);
    const frames = edgeFrames(grid, i);
    const { col, row } = grid.coordsOf(i);

    // Which ring edge faces each neighbour direction?
    const facing = new Map(); // edgeIndex -> neighbourIndex | null
    for (let k = 0; k < MAX_NEIGHBORS; k++) {
      const n = grid.nbr[i * MAX_NEIGHBORS + k];
      if (n < 0) break;
      const nc = grid.cellCenter(n);
      let dx = nc.x - c.x, dy = nc.y - c.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      let best = -1, bestScore = -Infinity;
      frames.forEach((f, fi) => {
        const s = f.nx * dx + f.ny * dy;
        if (s > bestScore) { bestScore = s; best = fi; }
      });
      if (facing.has(best)) {
        if (bad++ < 3) fail(`cell ${i}: two neighbours claim the same edge (${best})`);
      }
      facing.set(best, n);
    }

    if (facing.size !== grid.degree(i)) {
      if (bad++ < 3) fail(`cell ${i} (${grid.type}) has ${facing.size} facing edges but ${grid.degree(i)} neighbours`);
    }

    // Every ring edge must be either shared with its facing neighbour, or face
    // a genuinely absent cell.
    frames.forEach((f, fi) => {
      const n = facing.get(fi);
      if (n !== undefined) {
        // shared: the neighbour's ring must contain both endpoints of this edge
        const a = absPoly(grid, i);
        const b = absPoly(grid, n);
        const p = a[fi], q = a[(fi + 1) % a.length];
        const has = (ring, pt) => ring.some((v) => Math.abs(v[0] - pt[0]) < 1e-6 && Math.abs(v[1] - pt[1]) < 1e-6);
        if (!has(b, p) || !has(b, q)) {
          if (bad++ < 3) fail(`cells ${i}/${n} are neighbours but do not share the facing edge`);
        }
        return;
      }
      // unshared: stepping outward must leave the board entirely
      const px = f.mx + f.nx * EDGE_STEP;
      const py = f.my + f.ny * EDGE_STEP;
      for (const j of grid.cells) {
        if (j === i) continue;
        const jc = grid.cellCenter(j);
        const jp = grid.cellPolygon(j);
        if (pointInPolygon(jp, px - jc.x, py - jc.y)) {
          if (bad++ < 3) {
            fail(`cell ${i} edge ${fi} is unshared but steps into cell ${j} — gap in the tiling`);
          }
          return;
        }
      }
      // ...and it must not face a present cell, otherwise the tiling structure
      // itself is wrong (the shape claims no neighbour where the geometry implies
      // one). The bar is 0.75 rather than 0.5 because neighbour directions are at
      // least 60° apart on every one of these tilings — a 0.5 bar would flag the
      // *next* neighbour round, which is exactly 60° off. The diamond board's
      // rhombus edges are the loose case at 0.866, so 0.75 clears everything.
      const dirs = new Map();
      for (const [dc, dr] of directionsFor(col, row)) {
        const ni = grid.indexOf(col + dc, row + dr);
        if (ni < 0) continue;
        const nc = grid.cellCenter(ni);
        let dx = nc.x - c.x, dy = nc.y - c.y;
        const len = Math.hypot(dx, dy) || 1;
        dirs.set(`${dc},${dr}`, (f.nx * dx + f.ny * dy) / len);
      }
      let best = -Infinity, bestKey = null;
      for (const [kk, s] of dirs) if (s > best) { best = s; bestKey = kk; }
      if (bestKey && best > 0.75) {
        if (bad++ < 3) {
          fail(`cell ${i} edge ${fi} faces present cell in direction ${bestKey} but is not adjacent — missing neighbour`);
        }
      }
    });
  }
  return { bad };
}

function checkAdjacency(grid, { strictDegree = true } = {}) {
  let asym = 0, noEdge = 0, dupes = 0, degBad = 0;
  const expected = { square: 4, hex: 6, diamond: 4, triangle: 3 }[grid.type];

  for (const i of grid.cells) {
    const seenN = new Set();
    for (let k = 0; k < MAX_NEIGHBORS; k++) {
      const n = grid.nbr[i * MAX_NEIGHBORS + k];
      if (n < 0) break;
      if (seenN.has(n) && dupes++ < 3) fail(`cell ${i} lists neighbour ${n} twice`);
      seenN.add(n);
      let found = false;
      for (let j = 0; j < MAX_NEIGHBORS; j++) {
        const m = grid.nbr[n * MAX_NEIGHBORS + j];
        if (m < 0) break;
        if (m === i) { found = true; break; }
      }
      if (!found && asym++ < 3) fail(`asymmetric adjacency ${i} → ${n}`);
    }

    // Degree: on an unmasked board, any cell one in from every edge must have its
    // full neighbour set. A masked board cannot be checked this way — cutting a
    // cell out legitimately lowers its neighbours' degree.
    if (strictDegree) {
      const { col, row } = grid.coordsOf(i);
      const interior =
        col > grid.colMin && col < grid.colMax && row > grid.rowMin && row < grid.rowMax;
      if (interior) {
        const d = grid.degree(i);
        if (d !== expected && degBad++ < 3) {
          fail(`${grid.type} interior cell ${i} (${col},${row}) has degree ${d}, expected ${expected}`);
        }
      }
    }
  }

  // shared-corner check over distinct pairs
  const seen = new Set();
  for (const i of grid.cells) {
    for (let k = 0; k < MAX_NEIGHBORS; k++) {
      const n = grid.nbr[i * MAX_NEIGHBORS + k];
      if (n < 0) break;
      const pk = i < n ? `${i}:${n}` : `${n}:${i}`;
      if (seen.has(pk)) continue;
      seen.add(pk);
      const a = absPoly(grid, i), b = absPoly(grid, n);
      let shared = 0;
      for (const p of a) for (const q of b) {
        if (Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6) shared++;
      }
      if (shared !== 2 && noEdge++ < 3) fail(`cells ${i}/${n} listed adjacent but share ${shared} corners`);
    }
  }

  let connected = true;
  if (grid.cells.length) {
    const field = grid.distanceField(grid.cells[0]);
    for (const i of grid.cells) if (field[i] < 0) { connected = false; break; }
  }
  // Masked boards report their component count instead of asserting one piece.
  if (!connected && strictDegree) fail('board is not connected');

  return { asym, noEdge, dupes, degBad, connected, pairs: seen.size };
}

function checkPicking(grid, rnd) {
  let wrong = 0, checked = 0;
  const { minX, minY, maxX, maxY } = grid.bounds;
  for (let n = 0; n < 12000; n++) {
    const x = minX + rnd() * (maxX - minX);
    const y = minY + rnd() * (maxY - minY);
    const fast = grid.pickAt(x, y);
    // Brute force: every present tile, containment tested directly.
    let expect = -1;
    const hits = [];
    for (const i of grid.cells) {
      const c = grid.cellCenter(i);
      if (pointInPolygon(grid.cellPolygon(i), x - c.x, y - c.y)) hits.push(i);
    }
    if (hits.length) expect = hits[0];
    checked++;
    if (fast !== expect) {
      // On a shared border either answer is defensible; on a notch both say -1.
      const defensible = hits.includes(fast) || (fast >= 0 && hits.length === 0 && isNearBorder(grid, fast, x, y));
      if (!defensible && wrong++ < 4) {
        fail(`pickAt(${x.toFixed(4)}, ${y.toFixed(4)}) = ${fast}, brute force = ${expect}`);
      }
    }
  }
  return { wrong, checked };
}

/** Within a hair of a tile edge — the containment test's own epsilon decides here. */
function isNearBorder(grid, index, x, y) {
  const c = grid.cellCenter(index);
  const poly = grid.cellPolygon(index);
  for (let i = 0; i < poly.length; i += 2) {
    const j = (i + 2) % poly.length;
    const ax = c.x + poly[i], ay = c.y + poly[i + 1];
    const bx = c.x + poly[j], by = c.y + poly[j + 1];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(x - (ax + dx * t), y - (ay + dy * t)) < 1e-6) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------

const BOARDS = [
  { cols: 7, rows: 7 },
  { cols: 6, rows: 9 },
  { cols: 12, rows: 5 },
];

console.log('\ngrid validation — geometry, not screenshots\n');

for (const type of GRID_TYPES) {
  console.log(`${type}`);
  for (const b of BOARDS) {
    const grid = createGrid({ type, cols: b.cols, rows: b.rows, size: SIZE });
    const rnd = mulberry32(0x9e3779b9 ^ (b.cols * 31 + b.rows));
    const o = checkOverlap(grid, rnd, 3000);
    const e = checkEdges(grid, grid);
    const a = checkAdjacency(grid);
    const p = checkPicking(grid, rnd);
    const ok = o.bad === 0 && e.bad === 0 && a.asym === 0 && a.noEdge === 0 &&
               a.dupes === 0 && a.degBad === 0 && a.connected && p.wrong === 0;
    console.log(
      `  ${ok ? '✓' : '✗'} ${String(b.cols).padStart(2)}×${String(b.rows).padStart(2)}` +
      `  tiles=${String(grid.cells.length).padStart(3)}` +
      `  adjPairs=${String(a.pairs).padStart(3)}` +
      `  overlapTests=${String(o.testedPairs).padStart(4)}` +
      `  pick=${String(p.checked).padStart(5)}` +
      `  bbox=${grid.bounds.width.toFixed(2)}×${grid.bounds.height.toFixed(2)}`
    );
  }
}

console.log('\nmasked boards (a plus-shaped silhouette must not leak)');
for (const type of GRID_TYPES) {
  const cols = 9, rows = 9;
  const mask = [];
  const mid = Math.floor(cols / 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) mask.push(r === mid || c === mid ? '.' : '#');
  }
  const ref = createGrid({ type, cols, rows, size: SIZE });
  const masked = createGrid({ type, cols, rows, size: SIZE, mask });
  const e = checkEdges(masked, ref);
  const a = checkAdjacency(masked, { strictDegree: false });
  const o = checkOverlap(masked, mulberry32(7), 500);
  const ok = e.bad === 0 && a.asym === 0 && a.noEdge === 0 && a.dupes === 0 && o.bad === 0;
  // Connectivity is reported, not asserted: a mask can legitimately cut a board
  // into pieces — a plus on a triangular grid does exactly that, because triangles
  // have no vertical neighbour at the same column. Level data has to reject such
  // boards, but that is a content rule, not a geometry bug.
  let components = 0;
  const seen = new Set();
  for (const i of masked.cells) {
    if (seen.has(i)) continue;
    components++;
    const field = masked.distanceField(i);
    for (const j of masked.cells) if (field[j] >= 0) seen.add(j);
  }
  console.log(
    `  ${ok ? '✓' : '✗'} ${type.padEnd(9)} cells=${String(masked.cells.length).padStart(3)}` +
    `  components=${components}` +
    `  bbox=${masked.bounds.width.toFixed(2)}×${masked.bounds.height.toFixed(2)}`
  );
  if (!ok) failures++;
}

console.log(failures === 0 ? '\nall grid checks passed\n' : `\n${failures} grid check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
