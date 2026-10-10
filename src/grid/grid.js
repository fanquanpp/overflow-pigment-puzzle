/**
 * Grid geometry — the four tilings the puzzles are played on.
 *
 * Pure logic. No three.js, no DOM: this module answers "what are the neighbours
 * of this cell", "where is its centre", "what polygon draws it", and "which cell
 * is under this point", and nothing else. Rendering, colour and puzzle rules all
 * build on top of it.
 *
 * The four shapes are not four implementations of the same idea — they change the
 * puzzle:
 *
 *   square    4 neighbours. The classic flood-fill board.
 *   hex       6 neighbours. More routes to merge two regions, so boards are
 *             looser and easier to untangle, and the silhouette reads as organic.
 *   diamond   Isometric projection of a square grid — 4 neighbours, but the
 *             diagonal adjacency that the eye reads (up-left/up-right) is *not*
 *             adjacency. Players misjudge it, which is a legitimate (and
 *             deliberate) source of difficulty.
 *   triangle  3 neighbours, and the tiling is bipartite: every up-pointing
 *             triangle touches only down-pointing ones. Fewer neighbours means
 *             regions are stringier and merging them takes more deliberate work.
 *
 * ---------------------------------------------------------------------------
 * Coordinate conventions
 * ---------------------------------------------------------------------------
 * Cells are stored in a dense rectangular index space, `index = row * cols + col`,
 * even when the board is masked into a silhouette (see `mask`). A masked-out cell
 * has no polygon and no neighbours, so every system can keep using the same flat
 * arrays and only consult `present`.
 *
 * All geometry is computed in **y-down grid space** (row 0 at the top, y growing
 * downward) because that is how grids are naturally indexed. The renderer flips y
 * once when it builds its matrices, so nothing downstream has to think about it.
 */

/** Equilateral triangle height for side length 1. */
const TRI_H = Math.sqrt(3) / 2;

/** cos/sin of the isometric projection angles used by the diamond board. */
const ISO_X = Math.cos(Math.PI / 6); // 0.8660
const ISO_Y = Math.sin(Math.PI / 6); // 0.5

export const GRID_TYPES = ['square', 'hex', 'diamond', 'triangle'];

/** Largest neighbour count any of the tilings has; used to size the flat arrays. */
export const MAX_NEIGHBORS = 6;

/**
 * Neighbour offsets for pointy-top hexes in **odd-r offset** coordinates
 * (rows counted downward, odd rows pushed right by half a hex).
 *
 * Index 0 is used for even rows, index 1 for odd rows. Verified against the
 * geometry rather than transcribed: for an even-row hex the two hexes above are
 * at the same column and at column-1, because it is the *odd* row that is shifted.
 */
const HEX_ODD_R = [
  [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]],
  [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]],
];

/** Square/diamond orthogonal neighbours (von Neumann), in y-down space. */
const SQUARE_DIRS = [[+1, 0], [0, -1], [-1, 0], [0, +1]];

/**
 * Per-shape geometry. Each entry supplies `center`, `polygon` (a flat
 * [x0,y0,x1,y1,…] ring in cell-local space, scaled by `size`) and `approx`
 * (pixel → nearest index, for picking).
 */
const SHAPES = {
  /**
   * Square grid. Centres on a `size` lattice; the tile is a `size` square.
   * Note the tile spans [−s/2, +s/2] around the centre so that a lattice of
   * centres spaced `s` apart tiles the plane exactly.
   */
  square: {
    neighbors: (col, row) => SQUARE_DIRS,
    center: (col, row, size) => ({ x: col * size, y: row * size }),
    polygon: (col, row, size) => {
      const h = size / 2;
      return new Float32Array([-h, -h, h, -h, h, h, -h, h]);
    },
    approx: (x, y, size) => ({ col: Math.round(x / size), row: Math.round(y / size) }),
  },

  /**
   * Pointy-top hexes in odd-r offset layout.
   *
   * A hex of circumradius `size` is `sqrt(3)*size` wide and `2*size` tall, but
   * rows overlap: consecutive rows are only `1.5*size` apart. Odd rows are pushed
   * right by half a hex width.
   */
  hex: {
    neighbors: (col, row) => HEX_ODD_R[row & 1],
    center: (col, row, size) => ({
      x: Math.sqrt(3) * size * (col + 0.5 * (row & 1)),
      y: 1.5 * size * row,
    }),
    polygon: (col, row, size) => {
      const pts = new Float32Array(12);
      // Vertices every 60°, starting at 90° so one vertex points straight up.
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 2 + (i * Math.PI) / 3;
        pts[i * 2] = size * Math.cos(a);
        pts[i * 2 + 1] = size * Math.sin(a);
      }
      return pts;
    },
    // Invert the axial→pixel mapping, then snap with the cube-rounding rule.
    approx: (x, y, size) => {
      const q = ((Math.sqrt(3) / 3) * x - y / 3) / size;
      const r = ((2 / 3) * y) / size;
      const { q: rq, r: rr } = cubeRound(q, r);
      // axial → odd-r offset
      return { col: rq + (rr - (rr & 1)) / 2, row: rr };
    },
  },

  /**
   * Diamond board: a square grid seen isometrically, so each square renders as a
   * rhombus. Adjacency is the square grid's 4-neighbour relation — *not* the
   * visually adjacent rhombi up-left and up-right. See the note at the top of the
   * file: that mismatch is the point.
   */
  diamond: {
    neighbors: (col, row) => SQUARE_DIRS,
    center: (col, row, size) => ({
      x: (col - row) * ISO_X * size,
      y: (col + row) * ISO_Y * size,
    }),
    polygon: (col, row, size) => {
      // Unit square projected, then re-centred on its own centroid.
      const c = cellCornerISO(0, 0, size);
      const k = [cellCornerISO(0, 0, size), cellCornerISO(1, 0, size),
                 cellCornerISO(1, 1, size), cellCornerISO(0, 1, size)];
      const cx = (k[0].x + k[1].x + k[2].x + k[3].x) / 4;
      const cy = (k[0].y + k[1].y + k[2].y + k[3].y) / 4;
      const pts = new Float32Array(8);
      for (let i = 0; i < 4; i++) {
        pts[i * 2] = k[i].x - cx;
        pts[i * 2 + 1] = k[i].y - cy;
      }
      void c;
      return pts;
    },
    approx: (x, y, size) => {
      // invert: x = (c−r)·ISO_X·s ,  y = (c+r)·ISO_Y·s
      const a = x / (ISO_X * size);
      const b = y / (ISO_Y * size);
      return { col: Math.round((a + b) / 2), row: Math.round((b - a) / 2) };
    },
  },

  /**
   * Triangular tiling.
   *
   * Addressing trick: a triangle is `(col, row)` and it points **up** when
   * `(col + row)` is even. Rows overlap in the same way hex rows do — the triangle
   * at row `r` has its horizontal edge at `y = TRI_H * size * r`.
   *
   * Every triangle's three neighbours are of the opposite orientation, which makes
   * the adjacency graph bipartite. Derived from the geometry (shared edges) rather
   * than recalled, and checked by the tiling test in tools/validate-grid.mjs.
   */
  triangle: {
    neighbors: (col, row) => {
      const up = (col + row) % 2 === 0;
      // Third neighbour is the one across the horizontal edge: below for an
      // up-pointing triangle, above for a down-pointing one.
      return [[+1, 0], [-1, 0], [0, up ? +1 : -1]];
    },
    center: (col, row, size) => {
      const up = (col + row) % 2 === 0;
      return {
        x: 0.5 * col * size,
        y: TRI_H * size * (row + (up ? 2 / 3 : 1 / 3)),
      };
    },
    polygon: (col, row, size) => {
      const up = (col + row) % 2 === 0;
      const h = TRI_H * size;
      if (up) {
        // apex at the top, horizontal edge at the bottom
        return new Float32Array([0, (-2 * h) / 3, -0.5 * size, h / 3, 0.5 * size, h / 3]);
      }
      return new Float32Array([-0.5 * size, -h / 3, 0.5 * size, -h / 3, 0, (2 * h) / 3]);
    },
    approx: (x, y, size) => {
      const h = TRI_H * size;
      const row = Math.floor(y / h + 1e-9);
      const col = Math.round(x / (0.5 * size));
      return { col, row };
    },
  },
};

function cellCornerISO(col, row, size) {
  return { x: (col - row) * ISO_X * size, y: (col + row) * ISO_Y * size };
}

/**
 * Snap fractional axial coordinates to the nearest hex by rounding in cube space
 * and repairing whichever component drifted furthest. This is the standard
 * `cube_round` from the hex-grid literature; rounding q and r independently would
 * produce cells that do not exist.
 */
function cubeRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

/** Signed area ×2 of a polygon ring; positive means clockwise in y-down space. */
function ringArea2(pts) {
  let a = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  return a;
}

/**
 * Is a point inside a convex polygon ring given in local space? Uses the
 * consistent-sign edge test, which needs the ring's winding to decide the sign —
 * so the winding is measured rather than assumed (triangle tiles are authored in
 * different rotational orders for up and down).
 */
export function pointInPolygon(pts, px, py) {
  const n = pts.length / 2;
  const sign = ringArea2(pts) >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2], ay = pts[i * 2 + 1];
    const bx = pts[j * 2], by = pts[j * 2 + 1];
    if (sign * ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) < 0) return false;
  }
  return true;
}

/**
 * Build a grid.
 *
 * @param {object} spec
 * @param {'square'|'hex'|'diamond'|'triangle'} spec.type
 * @param {number} spec.cols   columns in the index space (before masking)
 * @param {number} spec.rows   rows in the index space
 * @param {number} [spec.size] cell circumradius / side length, default 1
 * @param {(string|boolean)[]} [spec.mask] row-major presence flags; a character
 *        (e.g. '.') or `true` means present, anything else means the cell is cut
 *        out. Lets a level shape the board into a silhouette — a wave, a gem, a
 *        letter — while every array stays dense.
 */
export function createGrid(spec) {
  const type = spec.type ?? 'square';
  if (!GRID_TYPES.includes(type)) throw new Error(`unknown grid type: ${type}`);
  const shape = SHAPES[type];
  const cols = spec.cols;
  const rows = spec.rows;
  const size = spec.size ?? 1;
  const count = cols * rows;

  const present = new Uint8Array(count);
  const mask = spec.mask;
  for (let i = 0; i < count; i++) {
    if (!mask) present[i] = 1;
    else {
      const m = mask[i];
      present[i] = m === true || m === 1 || m === '.' ? 1 : 0;
    }
  }

  // --- neighbours, flattened -------------------------------------------------
  // Stored as `count * MAX_NEIGHBORS` with -1 for "no such neighbour", so the
  // solver can walk the graph without allocating an array per visit.
  const nbr = new Int32Array(count * MAX_NEIGHBORS).fill(-1);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      if (!present[i]) continue;
      const dirs = shape.neighbors(col, row);
      let k = 0;
      for (const [dc, dr] of dirs) {
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (!present[ni]) continue;
        nbr[i * MAX_NEIGHBORS + k++] = ni;
      }
    }
  }

  // --- centres and polygons -------------------------------------------------
  const cx = new Float64Array(count);
  const cy = new Float64Array(count);
  // Square/hex/diamond share one polygon shape; triangles have two. Cache per
  // (type, parity) so a 400-cell board allocates two rings, not four hundred.
  const polyCache = new Map();
  const polyIndex = new Int8Array(count).fill(-1);
  const polys = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      if (!present[i]) continue;
      const c = shape.center(col, row, size);
      cx[i] = c.x;
      cy[i] = c.y;
      const key = type === 'triangle' ? `t${(col + row) % 2}` : type;
      let pi = polyCache.get(key);
      if (pi === undefined) {
        pi = polys.length;
        polys.push(shape.polygon(col, row, size));
        polyCache.set(key, pi);
      }
      polyIndex[i] = pi;
    }
  }

  // Bounding box over present cells only, including each tile's own extent.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    if (!present[i]) continue;
    const pts = polys[polyIndex[i]];
    for (let k = 0; k < pts.length; k += 2) {
      minX = Math.min(minX, cx[i] + pts[k]);
      maxX = Math.max(maxX, cx[i] + pts[k]);
      minY = Math.min(minY, cy[i] + pts[k + 1]);
      maxY = Math.max(maxY, cy[i] + pts[k + 1]);
    }
  }
  if (!Number.isFinite(minX)) { minX = minY = maxX = maxY = 0; }

  const bounds = { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

  // Row/column extents of the present cells, for boards whose mask trims edges.
  let colMin = cols, colMax = -1, rowMin = rows, rowMax = -1;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!present[row * cols + col]) continue;
      if (col < colMin) colMin = col;
      if (col > colMax) colMax = col;
      if (row < rowMin) rowMin = row;
      if (row > rowMax) rowMax = row;
    }
  }

  const grid = {
    type, cols, rows, size, count,
    present, nbr,
    bounds, center,
    colMin, colMax, rowMin, rowMax,

    /** Flat list of present cell indices — the iteration order everything uses. */
    cells: (() => {
      const out = [];
      for (let i = 0; i < count; i++) if (present[i]) out.push(i);
      return Int32Array.from(out);
    })(),

    indexOf(col, row) {
      if (col < 0 || col >= cols || row < 0 || row >= rows) return -1;
      const i = row * cols + col;
      return present[i] ? i : -1;
    },

    coordsOf(index) {
      return { col: index % cols, row: (index / cols) | 0 };
    },

    /** Neighbour list for a cell, as a plain array. Allocates — use `nbr` in hot loops. */
    neighbors(index) {
      const out = [];
      for (let k = 0; k < MAX_NEIGHBORS; k++) {
        const n = nbr[index * MAX_NEIGHBORS + k];
        if (n < 0) break;
        out.push(n);
      }
      return out;
    },

    /** Neighbour count without allocating. */
    degree(index) {
      let k = 0;
      while (k < MAX_NEIGHBORS && nbr[index * MAX_NEIGHBORS + k] >= 0) k++;
      return k;
    },

    /** Tile centre in y-down grid space. */
    cellCenter(index) {
      return { x: cx[index], y: cy[index] };
    },

    /** Tile outline ring (flat [x,y,…]) in cell-local space; null if cut out. */
    cellPolygon(index) {
      const pi = polyIndex[index];
      return pi < 0 ? null : polys[pi];
    },

    /**
     * Which cell contains this point, or -1. Analytic rather than raycast: the
     * renderer draws thousands of instanced tiles and a per-tile raycast would be
     * both slower and, on the thin triangle tiles, less accurate at the seams.
     *
     * The shape gives an approximate cell; that cell and its neighbours are then
     * containment-tested, which resolves every ambiguity at tile borders without
     * a search.
     */
    pickAt(x, y) {
      const { col, row } = shape.approx(x, y, size);
      const tried = new Set();
      const test = (c, r) => {
        const i = grid.indexOf(c, r);
        if (i < 0 || tried.has(i)) return -1;
        tried.add(i);
        const pts = grid.cellPolygon(i);
        if (pts && pointInPolygon(pts, x - cx[i], y - cy[i])) return i;
        return -1;
      };

      let hit = test(col, row);
      if (hit >= 0) return hit;

      // Rings are materialised before being walked: expanding the frontier in
      // place while iterating it would never terminate.
      const ring = [[col, row]];
      for (const [dc, dr] of shape.neighbors(col, row)) ring.push([col + dc, row + dr]);
      for (const [c, r] of ring) {
        hit = test(c, r);
        if (hit >= 0) return hit;
      }
      for (const [c, r] of ring) {
        for (const [dc, dr] of shape.neighbors(c, r)) {
          hit = test(c + dc, r + dr);
          if (hit >= 0) return hit;
        }
      }
      return -1;
    },

    /**
     * Graph distance between two cells, in steps. BFS — the boards are small and
     * only effects and difficulty scoring need this, never the solver's inner loop.
     */
    distance(a, b) {
      if (a === b) return 0;
      const dist = new Int32Array(count).fill(-1);
      dist[a] = 0;
      let frontier = [a];
      while (frontier.length) {
        const next = [];
        for (const i of frontier) {
          for (let k = 0; k < MAX_NEIGHBORS; k++) {
            const n = nbr[i * MAX_NEIGHBORS + k];
            if (n < 0) break;
            if (dist[n] >= 0) continue;
            if (n === b) return dist[i] + 1;
            dist[n] = dist[i] + 1;
            next.push(n);
          }
        }
        frontier = next;
      }
      return Infinity;
    },

    /** BFS distance from one source to every cell; -1 for unreachable. */
    distanceField(a) {
      const dist = new Int32Array(count).fill(-1);
      if (!present[a]) return dist;
      dist[a] = 0;
      let frontier = [a];
      while (frontier.length) {
        const next = [];
        for (const i of frontier) {
          for (let k = 0; k < MAX_NEIGHBORS; k++) {
            const n = nbr[i * MAX_NEIGHBORS + k];
            if (n < 0) break;
            if (dist[n] >= 0) continue;
            dist[n] = dist[i] + 1;
            next.push(n);
          }
        }
        frontier = next;
      }
      return dist;
    },
  };

  return grid;
}

/** Every tile ring the grid uses, so a renderer can build one geometry per ring. */
export function gridPolygons(grid) {
  const seen = new Set();
  const out = [];
  for (const i of grid.cells) {
    const pi = grid.cellPolygon(i);
    if (!pi || seen.has(pi)) continue;
    seen.add(pi);
    out.push(pi);
  }
  return out;
}

export const TRIANGLE_HEIGHT = TRI_H;
export const ISO = { x: ISO_X, y: ISO_Y };
