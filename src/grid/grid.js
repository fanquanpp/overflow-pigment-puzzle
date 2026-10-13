/**
 * Grid geometry — the square tiling the puzzles are played on.
 *
 * Pure logic. No three.js, no DOM: this module answers "what are the neighbours
 * of this cell", "where is its centre", "what polygon draws it", and "which cell
 * is under this point", and nothing else. Rendering, colour and puzzle rules all
 * build on top of it.
 *
 * The board was once four tilings — square, hex, diamond, triangle. Shipping all
 * four meant every system below carried a branch for each: the material keyed its
 * program on ring shape, the validator proved four tilings, the level table showed
 * a shape tag nobody used for planning. The square won on every axis that matters
 * — it is the only tiling whose drawn grid *is* the adjacency graph (no diagonal
 * mirage, no bipartite parity), and silhouettes cut from it (see `mask`) give the
 * boards their variety instead. So the other three went, and the effort they were
 * spending went into the wave animation and the practice mode.
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

/** Orthogonal neighbours (von Neumann), in y-down space. */
const SQUARE_DIRS = [[+1, 0], [0, -1], [-1, 0], [0, +1]];

export const GRID_TYPES = ['square'];

/** Largest neighbour count any tiling has; used to size the flat arrays. */
export const MAX_NEIGHBORS = 4;

/**
 * Per-shape geometry. The single square entry supplies `center`, `polygon`
 * (a flat [x0,y0,…] ring in cell-local space, scaled by `size`) and `approx`
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
};

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
 * so the winding is measured rather than assumed.
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
 * @param {'square'} spec.type
 * @param {number} spec.cols   columns in the index space (before masking)
 * @param {number} spec.rows   rows in the index space
 * @param {number} [spec.size] cell side length, default 1
 * @param {(string|boolean)[]} [spec.mask] row-major presence flags; a character
 *        (e.g. '.') or `true` means present, anything else means the cell is cut
 *        out. Lets a level shape the board into a silhouette — a gem, a ring, a
 *        bottleneck — while every array stays dense.
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
  // One polygon shape per grid; cached so a 100-cell board allocates one ring,
  // not one hundred.
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
      let pi = polyCache.get(type);
      if (pi === undefined) {
        pi = polys.length;
        polys.push(shape.polygon(col, row, size));
        polyCache.set(type, pi);
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
     * both slower and less accurate at the seams.
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
