/**
 * Convex polygon helpers used when turning grid cells into tile geometry.
 *
 * Kept free of three.js so it can be unit-tested in Node — the tile field that
 * consumes it cannot be, because `three` is a bare module specifier that only
 * resolves through the browser's import map.
 */

/** Twice the signed area of a ring; its sign is the winding. */
export function ringArea2(pts) {
  let a = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  return a;
}

/** Inward unit normal of the edge (ax,ay)→(bx,by), given the ring's winding. */
function inwardNormal(ax, ay, bx, by, sign) {
  const dx = bx - ax;
  const dy = by - ay;
  const l = Math.hypot(dx, dy) || 1;
  return [(-sign * dy) / l, (sign * dx) / l];
}

/**
 * Offset a convex polygon inward by `d`, along each vertex's angle bisector.
 *
 * Centroid scaling — the obvious shortcut — is only uniform for regular polygons.
 * The diamond board's tiles are 60°/120° rhombi, where scaling by a single factor
 * pulls the short diagonal in twice as far as the long one and the gaps come out
 * visibly uneven. The bisector offset is exact for any convex ring and costs one
 * loop.
 *
 * The ring's winding is *measured* rather than assumed. The rings in grid.js do not
 * all wind the same way — the up-pointing triangle ring runs opposite to the
 * square, hex and diamond rings — and an inset that guessed would push that one
 * shape outward and turn it inside out. `tools/validate-grid.mjs` checks that no
 * ring inverts under the inset it is actually given.
 */
export function insetPolygon(pts, d) {
  const n = pts.length / 2;
  if (d <= 0) return Float32Array.from(pts);
  const sign = ringArea2(pts) >= 0 ? 1 : -1;
  const out = new Float32Array(pts.length);
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    const px = pts[i * 2], py = pts[i * 2 + 1];
    const ax = pts[prev * 2], ay = pts[prev * 2 + 1];
    const bx = pts[next * 2], by = pts[next * 2 + 1];

    const n1 = inwardNormal(ax, ay, px, py, sign);
    const n2 = inwardNormal(px, py, bx, by, sign);
    let bxn = n1[0] + n2[0];
    let byn = n1[1] + n2[1];
    const bl = Math.hypot(bxn, byn);
    if (bl < 1e-9) { out[i * 2] = px; out[i * 2 + 1] = py; continue; }
    bxn /= bl; byn /= bl;
    const cosHalf = n1[0] * bxn + n1[1] * byn;
    // The clamp keeps a near-degenerate corner from throwing its vertex to
    // infinity. At 0.25 the offset can overshoot at a very sharp corner, which is
    // visible but never catastrophic — and every ring this game ships is checked.
    const t = d / Math.max(cosHalf, 0.25);
    out[i * 2] = px + bxn * t;
    out[i * 2 + 1] = py + byn * t;
  }
  return out;
}

/** Largest distance from a ring's centroid to its vertices. */
export function ringRadius(pts) {
  let r = 0;
  for (let i = 0; i < pts.length; i += 2) r = Math.max(r, Math.hypot(pts[i], pts[i + 1]));
  return r || 1;
}

/** Inradius of a regular ring: the distance from its centre to an edge. */
export function ringInradius(pts) {
  const n = pts.length / 2;
  if (!n) return 0;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2], ay = pts[i * 2 + 1];
    const bx = pts[j * 2], by = pts[j * 2 + 1];
    const dx = bx - ax, dy = by - ay;
    const l = Math.hypot(dx, dy) || 1;
    // distance from the origin to the line through a and b
    best = Math.min(best, Math.abs(dx * -ay - dy * -ax) / l);
  }
  return best;
}
