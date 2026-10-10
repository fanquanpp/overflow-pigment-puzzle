/**
 * Album themes, as print processes.
 *
 * The previous pass dressed each album as a different *material world* — wet
 * stone, glossy lacquer, folded paper — and reached for metalness, clearcoat,
 * iridescence and bloom to say so. That vocabulary belongs to a different visual
 * language, and it fought the interface: a glossy dark board under a dark glass
 * HUD is a mood, not a system.
 *
 * This version keeps one language and varies the *process* within it. Every album
 * is a printed sheet; what changes is the stock and the ink:
 *
 *   offset        coated white stock, cool neutral ink, crisp edges
 *   letterpress   soft cream stock, warm ink, a deep deboss and a long fold
 *   screenprint   thick flat ink, visible misregistration, coarse dot screen
 *   newsprint     grey coarse stock, warm black ink, heavy dot gain
 *   duotone       cool pale stock, blue-black ink, clean and even
 *   photogravure  deep warm black plate, matte, maximum contrast
 *
 * Nothing in here is gloss, transparency or glow. The tile material is matte and
 * opaque; the "reflection" is a hard offset impression, which is what a printed
 * sheet actually casts on the sheet below it; the "laser" is the one signal red,
 * used sparingly enough that it still reads as a signal.
 *
 * The four effects the board is built around, in this vocabulary:
 *
 *   折叠 fold        a crease in the sheet — the tile turns over on a hinge and
 *                    shows its reverse. `tile.fold` is how far it turns.
 *   镭光 signal      one red, used as an edge and as a sweep. `tile.signal*` and
 *                    `plate.sweep`. No bloom: a signal is a flat colour.
 *   反射 impression  a hard offset copy beneath the plate. `plate.impression*`.
 *   色彩过渡 blend   travel between two inks through OKLab, so a mix keeps its
 *                    chroma instead of sagging through grey.
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
    },
    camera: { elevation: 44, azimuth: -26, distance: 1.0, fov: 33 },
  },

  letterpress: {
    id: 'letterpress',
    name: 'Letterpress', nameZh: '活版',
    css: {
      paper: '#f0e9db', paper2: '#e5ddcc', paper3: '#d5cbb6',
      ink: '#1d1710', ink2: '#544a3c', ink3: '#8a7f6c',
      red: '#c8341f', redInk: '#f0e9db', blue: '#22436f', ochre: '#c08b28',
    },
    plate: {
      paper: '#e6dccb', ink: '#1d1710',
      gridOpacity: 0.10, gridScale: 6,
      impression: { x: 0.12, z: 0.15, alpha: 0.32 },
      misregistration: 0.0009, halftone: 0.06, halftoneScale: 0.85, grain: 0.026,
    },
    tile: {
      // a thick plate, a deep deboss, and the longest fold in the set: this is the
      // album where turning a tile over should be a visible physical event
      depth: 0.205, gap: 0.074, bevel: 0.024,
      roughness: 1.0, metalness: 0.0,
      keyline: 0.042, edgeTone: 0.64,
      signal: 0.32, signalPower: 4.0, signalSweep: 0.9,
      fold: 1.05, foldTime: 0.60, blendTime: 0.38,
    },
    camera: { elevation: 38, azimuth: -32, distance: 1.03, fov: 32 },
  },

  screenprint: {
    id: 'screenprint',
    name: 'Screenprint', nameZh: '丝网印',
    css: {
      paper: '#f4f2ec', paper2: '#eae7df', paper3: '#dcd8cd',
      ink: '#141210', ink2: '#4a453d', ink3: '#847e72',
      red: '#e02a17', redInk: '#f4f2ec', blue: '#1d4fa0', ochre: '#e0a01c',
    },
    plate: {
      paper: '#eae6de', ink: '#141210',
      gridOpacity: 0.08, gridScale: 8,
      // the process that misregisters: the channels are pulled apart in the print
      // pass, which is the honest way to show "ink laid in flat passes"
      impression: { x: 0.21, z: 0.26, alpha: 0.24 },
      misregistration: 0.0042, halftone: 0.22, halftoneScale: 1.5, grain: 0.016,
    },
    tile: {
      depth: 0.105, gap: 0.058, bevel: 0.0,
      roughness: 1.0, metalness: 0.0,
      keyline: 0.024, edgeTone: 0.54,
      signal: 0.75, signalPower: 2.2, signalSweep: 2.1,
      fold: 0.46, foldTime: 0.36, blendTime: 0.36,
    },
    camera: { elevation: 50, azimuth: -20, distance: 1.0, fov: 34 },
  },

  newsprint: {
    id: 'newsprint',
    name: 'Newsprint', nameZh: '新闻纸',
    css: {
      paper: '#e8e4d9', paper2: '#ddd8cb', paper3: '#cbc5b5',
      ink: '#231d16', ink2: '#585045', ink3: '#8d8577',
      red: '#c02a1c', redInk: '#e8e4d9', blue: '#2c3f5e', ochre: '#b58836',
    },
    plate: {
      paper: '#ddd8cb', ink: '#231d16',
      gridOpacity: 0.16, gridScale: 5,
      impression: { x: 0.09, z: 0.12, alpha: 0.22 },
      misregistration: 0.0032, halftone: 0.30, halftoneScale: 0.7, grain: 0.055,
    },
    tile: {
      depth: 0.082, gap: 0.042, bevel: 0.0,
      roughness: 1.0, metalness: 0.0,
      keyline: 0.020, edgeTone: 0.62,
      signal: 0.40, signalPower: 3.2, signalSweep: 1.2,
      fold: 0.38, foldTime: 0.38, blendTime: 0.32,
    },
    camera: { elevation: 43, azimuth: -28, distance: 1.01, fov: 33 },
  },

  duotone: {
    id: 'duotone',
    name: 'Duotone', nameZh: '双色调',
    css: {
      paper: '#eef0f0', paper2: '#e2e6e7', paper3: '#cfd5d7',
      ink: '#12181c', ink2: '#465057', ink3: '#7f898f',
      red: '#d63a2a', redInk: '#eef0f0', blue: '#14567f', ochre: '#c9973a',
    },
    plate: {
      paper: '#e3e8e9', ink: '#12181c',
      gridOpacity: 0.12, gridScale: 9,
      impression: { x: 0.18, z: 0.23, alpha: 0.28 },
      misregistration: 0.0022, halftone: 0.14, halftoneScale: 1.2, grain: 0.012,
    },
    tile: {
      depth: 0.125, gap: 0.054, bevel: 0.008,
      roughness: 0.94, metalness: 0.0,
      keyline: 0.028, edgeTone: 0.58,
      signal: 0.62, signalPower: 2.4, signalSweep: 1.7,
      fold: 0.54, foldTime: 0.42, blendTime: 0.46,
    },
    camera: { elevation: 41, azimuth: -22, distance: 1.0, fov: 34 },
  },

  photogravure: {
    id: 'photogravure',
    name: 'Photogravure', nameZh: '照相凹版',
    css: {
      paper: '#efece5', paper2: '#e3dfd5', paper3: '#d0cbbf',
      ink: '#100d0b', ink2: '#453f39', ink3: '#7d766c',
      red: '#d4241a', redInk: '#efece5', blue: '#1a3f6b', ochre: '#c08a2a',
    },
    plate: {
      paper: '#e4dfd5', ink: '#100d0b',
      gridOpacity: 0.05, gridScale: 10,
      impression: { x: 0.15, z: 0.19, alpha: 0.36 },
      misregistration: 0.0010, halftone: 0.05, halftoneScale: 0.9, grain: 0.030,
    },
    tile: {
      depth: 0.165, gap: 0.036, bevel: 0.014,
      roughness: 1.0, metalness: 0.0,
      keyline: 0.036, edgeTone: 0.66,
      // the highest-contrast stock, so the signal can be at its most restrained
      signal: 0.30, signalPower: 3.6, signalSweep: 0.8,
      fold: 0.44, foldTime: 0.40, blendTime: 0.30,
    },
    camera: { elevation: 46, azimuth: -24, distance: 0.98, fov: 32 },
  },
};

export const THEME_IDS = Object.keys(THEMES);

export function themeFor(id) {
  return THEMES[id] ?? THEMES.offset;
}

/**
 * Apply a theme's chrome to the document.
 *
 * Only colour custom properties are written — the grid, the type and the rules are
 * the same on every album, because that is the point of having a system. An album
 * changes its stock and its ink; it does not get to redesign the page.
 */
export function applyThemeCss(theme, root = document.documentElement) {
  const c = theme.css;
  for (const [key, value] of Object.entries(c)) {
    root.style.setProperty(`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, value);
  }
  root.dataset.theme = theme.id;
  root.dataset.stock = theme.id;
}
