/**
 * The theme — one print process.
 *
 * The board was once dressed as six different print processes, one per album:
 * offset, letterpress, screenprint, newsprint, duotone, photogravure. The idea was
 * that an album changes its stock and its ink. In practice the album themes
 * (`studio`, `paper`, …) never had entries in this table, so `themeFor` fell back
 * to offset for all six and the other five shipped as dead weight. This version
 * states what was already true: there is one language, and it is this one.
 *
 * The language, and the four effects the board is built around:
 *
 *   折叠 fold        a crease in the sheet — the tile turns over on a hinge and
 *                    shows its reverse. `tile.fold` is how far it turns.
 *   镭光 signal      one red, used as an edge, a pulse and a sweep. No bloom: a
 *                    signal is a flat colour.
 *   反射 impression  a hard offset copy beneath the plate. `plate.impression*`.
 *   水波 wave        a move does not recolour its region at once; each BFS ring
 *                    from the tap waits `tile.waveDelay` before its own
 *                    fold-and-blend begins, so ink spreads outward like water.
 *
 * Nothing here is gloss, transparency or glow. The tile material is matte and
 * opaque; the "reflection" is a hard offset impression, which is what a printed
 * sheet actually casts on the sheet below it.
 */

/** A procedural studio environment, for the one thing that still needs shading. */
export const ENV = { blur: 0.05, intensity: 0.62 };

export const THEMES = {
  offset: {
    id: 'offset',
    name: 'Offset', nameZh: '胶印',
    css: {
      paper: '#f4f3ef', paper2: '#fbfaf7', paper3: '#efeee9',
      ink: '#0b0b0b', ink2: 'rgba(11,11,11,0.78)', ink3: 'rgba(11,11,11,0.55)',
      red: '#da291c', redInk: '#f4f3ef', blue: '#1b4b8f', ochre: '#d99b23',
    },
    plate: {
      paper: '#eceae4', ink: '#0b0b0b',
      gridOpacity: 0.14, gridScale: 7,
      impression: { x: 0.17, z: 0.22, alpha: 0.26 },
      misregistration: 0.0014, halftone: 0.10, halftoneScale: 1.0, grain: 0.012,
    },
    tile: {
      depth: 0.135, gap: 0.050, bevel: 0.012,
      roughness: 0.96, metalness: 0.0,
      keyline: 0.030, edgeTone: 0.58,
      signal: 0.55, signalPower: 2.6, signalSweep: 1.5,
      fold: 0.62, foldTime: 0.42, blendTime: 0.36,
      waveDelay: 0.055,
    },
    camera: { elevation: 44, azimuth: -26, distance: 1.0, fov: 33 },
  },
};

export const THEME_IDS = Object.keys(THEMES);

export function themeFor(id) {
  return THEMES[id] ?? THEMES.offset;
}

/**
 * Apply the theme's chrome to the document.
 *
 * Only colour custom properties are written — the grid, the type and the rules are
 * the same for every album, because that is the point of having a system. The
 * palette (the album's inks) still varies; the paper it prints on does not.
 */
export function applyThemeCss(theme, root = document.documentElement) {
  const c = theme.css;
  for (const [key, value] of Object.entries(c)) {
    root.style.setProperty(`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, value);
  }
  root.dataset.theme = theme.id;
  root.dataset.stock = theme.id;
}
