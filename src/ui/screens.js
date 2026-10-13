/**
 * Screens: every full-panel view that is not the board.
 *
 * A screen is a function returning a DOM node. The manager swaps one in at a time,
 * which keeps navigation trivial — no router, no history, no state living in a
 * hidden panel. Each screen gets the context it needs and a `go(name, params)`.
 *
 * The result card and the solution card are exceptions: they are *sheets* shown
 * over a live board, so the board stays visible behind them. Seeing the finished
 * board while reading the result matters — the thing being reported on is the
 * picture, and a full-screen panel would take it away at the exact moment the
 * player wants to look at it.
 *
 * The typography follows the same system as the HUD: a masthead rule, an eyebrow,
 * a display line, and flush-left ragged-right body copy. Numbers are set in the
 * mono face with tabular figures wherever they are compared down a column, because
 * a level table is a table.
 */

import { el, fill, button, icon, ICONS, pill, segmented, toggle, slider, row, richText } from './dom.js';
import { t, pick, LOCALES, isZh } from '../core/i18n.js';
import { linearToCss, linearToOklab, oklabToOklch } from '../color/color.js';
import { PALETTES, paletteFor, mixReflectance, buildPalette } from '../color/pigment.js';

const MODE_TAG = { mix: 'badge.mix', replace: 'badge.replace' };
const BAND_TAG = { gentle: 'band.gentle', steady: 'band.steady', tricky: 'band.tricky', severe: 'band.severe' };

/** Difficulty as four printed ticks: readable before the word is read. */
function ticks(difficulty) {
  const filled = Math.max(1, Math.min(4, Math.ceil(difficulty / 0.25)));
  const wrap = el('span', {
    class: `ticks${difficulty > 0.72 ? ' severe' : ''}`,
    'aria-hidden': 'true',
    title: `${t(BAND_TAG[bandKey(difficulty)])} ${difficulty.toFixed(2)}`,
  });
  for (let i = 0; i < 4; i++) wrap.appendChild(el('i', { class: i < filled ? 'on' : '' }));
  return wrap;
}

function bandKey(d) {
  if (d <= 0.28) return 'gentle';
  if (d <= 0.50) return 'steady';
  if (d <= 0.72) return 'tricky';
  return 'severe';
}

/** The album's colour volume as one sweep, with the reachable mixtures ticked. */
function plateStrip(album) {
  const palette = paletteFor(album.palette);
  const strip = paletteSweep(palette, { ticks: true });
  strip.classList.add('plate-strip-sweep');
  return strip;
}

/**
 * A palette as one continuous sweep instead of a row of blocks.
 *
 * Two reasons this is not decoration. It is *gradual*, which is how a palette
 * actually behaves — the mixtures between two inks are reachable, and a row of
 * seven hard steps hides that. And the interpolation is OKLab, which is the same
 * space the board animates colours through, so the bar shows the album's real colour
 * volume rather than a designer's rendering of it.
 *
 * Entries are ordered by hue, then by lightness where hues are close, so the sweep
 * runs monotonically instead of wandering back and forth across the wheel.
 */
function paletteGradient(palette, angle = 90) {
  const entries = palette.entries
    .filter((e) => e.mask !== 0)
    .map((e) => ({ hex: e.hex, linear: e.linear, mask: e.mask, lch: oklabToOklch(linearToOklab(e.linear)) }))
    .sort((a, b) => {
      const dh = a.lch[2] - b.lch[2];
      return Math.abs(dh) > 0.12 ? dh : a.lch[0] - b.lch[0];
    });
  const stops = entries.map((e) => e.hex);
  return {
    // `in oklab` is what makes the sweep continuous rather than a set of steps; the
    // plain gradient is what a browser without it falls back to.
    css: `linear-gradient(${angle}deg in oklab, ${stops.join(', ')})`,
    fallback: `linear-gradient(${angle}deg, ${stops.join(', ')})`,
    entries,
  };
}

/** The sweep, with a tick at each mixture the board can actually reach. */
function paletteSweep(palette, { angle = 90, ticks = true, flat = false } = {}) {
  const g = paletteGradient(palette, angle);
  const node = el('div', { class: `sweep${flat ? ' flat' : ''}` });
  node.style.backgroundImage = g.fallback;
  // Assigned second: if the browser cannot parse `in oklab` the first value stands.
  node.style.backgroundImage = g.css;
  if (ticks && g.entries.length) {
    const n = g.entries.length;
    g.entries.forEach((entry, i) => {
      const pos = n === 1 ? 50 : (i / (n - 1)) * 100;
      // The tick has to read against whatever is under it, so its ink follows the
      // lightness of the mixture at that position.
      const light = entry.lch[0] > 0.62;
      node.appendChild(el('i', {
        class: `tick${light ? '' : ' light'}`,
        style: { left: `calc(${pos}% - 0.5px)` },
      }));
    });
  }
  return node;
}

/** A three-stop bar: pigment, the mixture, the other pigment. */
function mixBar(palette, a, b, mask) {
  const A = palette.entries[1 << a];
  const B = palette.entries[1 << b];
  const M = palette.entries[mask];
  const node = el('div', { class: 'mix-bar' });
  const stops = `${A.hex}, ${M.hex}, ${B.hex}`;
  node.style.backgroundImage = `linear-gradient(90deg, ${stops})`;
  node.style.backgroundImage = `linear-gradient(90deg in oklab, ${stops})`;
  return node;
}

const eyebrow = (text) => el('p', { class: 'lbl red' }, text);

/**
 * A section head: an ink rule, a red index number, the title, and a note pushed to
 * the right edge. The rule does the structural work; the number is the only thing
 * in red, so a page's eye lands on the sequence rather than on decoration.
 */
const sectionHead = (num, title, note) => el(
  'div',
  { class: 'head', 'data-note': note ?? '' },
  [el('h3', {}, [el('span', { class: 'num' }, num), title])]
);

export function createScreens(root, ctx) {
  let current = null;
  let modal = null;
  const { store, audio, play } = ctx;

  const clearModal = () => {
    if (modal) { modal.remove(); modal = null; }
  };

  const showModal = (node, { dismissable = true } = {}) => {
    clearModal();
    modal = el('div', {
      class: 'layer',
      style: { display: 'grid', placeItems: 'center', padding: '20px', zIndex: '30', background: 'rgba(20,18,15,0.14)' },
    }, [node]);
    if (dismissable) {
      modal.addEventListener('pointerdown', (ev) => {
        if (ev.target === modal) { clearModal(); audio.playUi('close'); ctx.onModalDismiss?.(); }
      });
    }
    root.appendChild(modal);
    return modal;
  };

  // -------------------------------------------------------------------------
  // title
  // -------------------------------------------------------------------------

  /**
   * The landing screen, as five pages.
   *
   * It was one long column, and a long column is a scroll: the reader meets the
   * argument, the grids, the print processes and the counts as one undifferentiated
   * run of paper, and the board had to live in a permanent side column to be seen at
   * all. Both of those are gone. The content is paged, each page is one screenful
   * with nothing to scroll, and the board appears where it earns its place — as the
   * hero under page one — and recedes to background everywhere else.
   */
  const HOME_PAGES = [
    { id: 'start', label: 'home.page.start', hero: true, render: renderStart },
    { id: 'mixing', label: 'home.page.mixing', render: renderMixing },
    { id: 'wave', label: 'home.page.wave', render: renderWave },
    { id: 'inks', label: 'home.page.inks', render: renderInks },
    { id: 'content', label: 'home.page.content', render: renderContents },
  ];

  /** Page one: the masthead, and the board as a hero band beneath it. */
  function renderStart() {
    const next = store.nextBoard(ctx.albums);
    const settled = store.state.settledCount;
    const total = ctx.levels.length;

    const head = el('div', { class: 'hero-head' }, [
      el('div', { class: 'redblock wide' }),
      eyebrow(t('home.eyebrow')),
      el('h1', { class: 'display' }, 'Overflow'),
      el('div', { class: 'plate-zh', style: { fontSize: '0.92rem', marginTop: '4px' } }, '溢彩'),
      el('p', { class: 'body' }, richText(t('home.hero.lede'))),
      el('div', { class: 'chips' }, [
        pill(t('home.jump.boards'), { on: true }),
        pill(t('title.chip.albums')),
        pill(t('title.chip.grids')),
        pill(t('home.jump.mix')),
        settled > 0 ? pill(`${settled} / ${total}`) : null,
      ]),
      el('div', { class: 'actions', style: { marginTop: '18px' } }, [
        button(next ? t('title.continue') : t('title.play'), {
          class: 'btn primary',
          onClick: () => {
            audio.playUi('open');
            if (next) ctx.startLevel(next.album, next.index);
            else go('albums');
          },
        }, [icon(ICONS.play)]),
        button(t('title.albums'), { onClick: () => go('albums') }, [icon(ICONS.grid)]),
        button(t('title.practice'), { onClick: () => { audio.playUi('open'); ctx.startPractice(); } }, [icon(ICONS.dice)]),
        button(t('title.howto'), { onClick: () => go('howto') }, [icon(ICONS.info)]),
        button(t('title.lab'), { onClick: () => go('lab') }, [icon(ICONS.flask)]),
        button(t('title.settings'), { onClick: () => go('settings') }, [icon(ICONS.settings)]),
        button(t('title.credits'), { class: 'btn ghost', onClick: () => go('credits') }),
      ]),
      next ? el('div', { class: 'note' }, [
        el('strong', {}, t('title.continue')),
        ' — ',
        `${pick(ctx.albums.find((a) => a.id === next.album.id) ?? {}, 'name')} · ${pick(next.level, 'name')}`,
      ]) : null,
    ]);

    return [head, el('div', { class: 'hero-spacer' })];
  }

  /** Page two: the mixing claim, demonstrated rather than asserted. */
  function renderMixing() {
    const printer = paletteFor('printer');
    const mineral = paletteFor('mineral');
    const examples = [
      { p: printer, a: 0, b: 2, mask: 0b101, label: t('home.mix.c1') },
      { p: printer, a: 1, b: 2, mask: 0b110, label: t('home.mix.c2') },
      { p: printer, a: 1, b: 0, mask: 0b011, label: t('home.mix.c3') },
      { p: mineral, a: 0, b: 1, mask: 0b011, label: t('home.mix.c4'), note: t('home.mix.c4note') },
    ];
    const grid = el('div', { class: 'mix-demo' });
    for (const ex of examples) {
      const A = ex.p.entries[1 << ex.a];
      const B = ex.p.entries[1 << ex.b];
      const M = ex.p.entries[ex.mask];
      grid.appendChild(el('div', { class: 'mix-cell' }, [
        mixBar(ex.p, ex.a, ex.b, ex.mask),
        el('div', { class: 'mix-foot' }, [
          el('div', { class: 'eq' }, `${A.nameZh} + ${B.nameZh}`),
          el('div', { class: 'res' }, M.nameZh),
          ex.note ? el('div', { class: 'eq', style: { color: 'var(--red)' } }, ex.note) : null,
        ]),
      ]));
    }
    return [
      sectionHead('01', t('home.mix.title'), t('home.page.mixing')),
      el('p', { class: 'body' }, richText(t('home.mix.body'))),
      el('div', { style: { marginTop: '18px' } }, [grid]),
      el('div', { class: 'note' }, [
        el('strong', {}, 'Kubelka–Munk'),
        ' · ',
        isZh()
          ? '色带上每一段都是渐变，因为模型算出来的中间色本来就是可达的——它不是七个硬台阶。'
          : 'Every band above is a gradient because the colours in between are reachable — it is not seven hard steps.',
      ]),
    ];
  }

  /** Page three: how a move spreads, and the practice room. */
  function renderWave() {
    // A 5×5 board that shows the ring order of a wave move, numbered from the tap.
    const N = 5;
    const tap = { c: 2, r: 2 };
    const cells = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const d = Math.abs(c - tap.c) + Math.abs(r - tap.r); // manhattan ring
        cells.push(el('div', { class: 'wave-cell', style: { '--d': String(d) } }, String(d)));
      }
    }
    const board = el('div', { class: 'wave-demo' }, cells);

    return [
      sectionHead('02', t('home.wave.title'), t('home.page.wave')),
      el('p', { class: 'body' }, richText(t('home.wave.body'))),
      el('div', { class: 'wave-wrap' }, [
        board,
        el('div', { class: 'wave-note' }, [
          el('strong', {}, t('home.wave.ringTitle')),
          ' · ',
          t('home.wave.ringBody'),
        ]),
      ]),
      el('div', { class: 'note' }, [
        el('strong', {}, t('home.practice.title')),
        ' — ',
        t('home.practice.body'),
      ]),
      el('div', { class: 'actions', style: { marginTop: '16px' } }, [
        button(t('title.practice'), { onClick: () => { audio.playUi('open'); ctx.startPractice(); } }, [icon(ICONS.dice)]),
      ]),
    ];
  }

  /** Page four: the six print processes, each as one continuous sweep. */
  function renderInks() {
    const rows = el('div', {});
    for (const album of ctx.albums) {
      const palette = paletteFor(album.palette);
      const reach = palette.entries.filter((e) => e.mask !== 0).length;
      rows.appendChild(el('div', { class: 'sweep-row' }, [
        el('div', {}, [
          el('div', { class: 'sweep-name' }, [pick(album, 'name'), el('small', {}, album.nameZh)]),
          paletteSweep(palette, { flat: true }),
        ]),
        el('div', { class: 'sweep-meta' }, t('home.inks.reach', { n: reach })),
      ]));
    }
    return [
      sectionHead('03', t('home.inks.title'), t('home.page.inks')),
      el('p', { class: 'body' }, richText(t('home.inks.body'))),
      el('div', { style: { marginTop: '18px' } }, [rows]),
    ];
  }

  /** Page five: the size of the thing, and how it was measured. */
  function renderContents() {
    const total = ctx.levels.length;
    const hardest = ctx.levels.reduce((a, l) => Math.max(a, l.difficulty), 0);
    const moves = ctx.levels.reduce((a, l) => a + l.solution, 0);
    const palettes = new Set(ctx.levels.map((l) => l.palette)).size;
    const silhouettes = new Set((ctx.levels.map((l) => l.mask).filter(Boolean))
      .map((m) => m.join('')).add('')).size || 1;
    const stat = (n, k, red) => el('div', { class: 'stat' }, [
      el('div', { class: `n${red ? ' red' : ''}` }, n),
      el('div', { class: 'k' }, k),
    ]);
    return [
      sectionHead('04', t('home.content.title'), t('home.page.content')),
      el('div', { class: 'stats' }, [
        stat(String(total), t('home.stat.boards'), true),
        stat(String(ctx.albums.length), t('home.stat.albums')),
        stat(String(palettes), t('home.stat.palettes')),
        stat(String(silhouettes), t('home.stat.silhouettes')),
        stat(moves.toLocaleString(), t('home.stat.moves')),
        stat(hardest.toFixed(2), t('home.stat.hardest')),
      ]),
      el('div', { class: 'note' }, richText(t('home.foot'))),
      el('div', { class: 'actions' }, [
        button(t('title.credits'), { onClick: () => go('credits') }),
        button(t('title.settings'), { onClick: () => go('settings') }),
      ]),
    ];
  }

  function homeScreen(params = {}) {
    const idx = Math.max(0, Math.min(HOME_PAGES.length - 1, params.page ?? 0));
    const spec = HOME_PAGES[idx];

    const pager = el('div', { class: 'pager' }, HOME_PAGES.map((pg, i) => el('button', {
      type: 'button',
      'aria-current': String(i === idx),
      'aria-label': t(pg.label),
      onClick: () => { audio.playUi('tap'); go('title', { page: i }); },
    }, [
      el('span', { class: 'n' }, String(i + 1).padStart(2, '0')),
      el('span', {}, t(pg.label)),
    ])));

    const foot = el('div', { class: 'pager-foot' }, [
      el('div', { class: 'where' },
        `${String(idx + 1).padStart(2, '0')} / ${String(HOME_PAGES.length).padStart(2, '0')} · ${t(spec.label)}`),
      idx > 0 ? button(t('misc.back'), { onClick: () => go('title', { page: idx - 1 }) }, [icon(ICONS.back)]) : null,
      idx < HOME_PAGES.length - 1
        ? button(t('misc.next'), { class: 'btn primary', onClick: () => go('title', { page: idx + 1 }) }, [icon(ICONS.forward)])
        : button(t('title.play'), {
            class: 'btn primary',
            onClick: () => {
              const next = store.nextBoard(ctx.albums);
              if (next) ctx.startLevel(next.album, next.index);
              else go('albums');
            },
          }, [icon(ICONS.play)]),
    ]);

    return el('div', { class: `screen page${spec.hero ? ' hero' : ''}` }, [
      pager,
      el('div', { class: 'page-body' }, spec.render()),
      foot,
    ]);
  }

  // -------------------------------------------------------------------------
  // albums
  // -------------------------------------------------------------------------

  function albumsScreen() {
    const grid = el('div', { class: 'plate-grid' });
    for (const album of ctx.albums) {
      const done = store.albumProgress(album);
      const count = album.levels.length;
      const hardest = album.levels.reduce((a, l) => Math.max(a, l.difficulty), 0);
      grid.appendChild(el('button', {
        type: 'button',
        class: 'plate',
        onClick: () => { audio.playUi('open'); go('levels', { albumId: album.id }); },
      }, [
        plateStrip(album),
        el('div', { class: 'plate-body' }, [
          el('div', { class: 'plate-top' }, [
            el('span', { class: 'index-no' }, String(ctx.albums.indexOf(album) + 1).padStart(2, '0')),
            el('h3', { class: 'plate-name' }, pick(album, 'name')),
            el('span', { class: 'plate-zh' }, album.nameZh),
          ]),
          el('p', { class: 'plate-blurb' }, pick(album, 'blurb')),
          el('div', { class: 'plate-foot' }, [
            el('span', { class: 'data' }, `${done}/${count}`),
            el('div', { class: 'meter' }, [el('i', { style: { width: `${(done / count) * 100}%` } })]),
            ticks(hardest),
          ]),
        ]),
      ]));
    }

    return el('div', { class: 'screen' }, [
      el('div', { class: 'masthead' }, [
        el('div', { class: 'redblock' }),
        eyebrow(t('albums.eyebrow')),
        el('h2', { class: 'display sm' }, t('albums.title').replace(/<[^>]+>/g, '')),
        el('p', { class: 'body' }, t('albums.lede')),
      ]),
      grid,
      el('div', { class: 'actions' }, [
        button(t('albums.back'), { class: 'btn ghost', onClick: () => go('title') }, [icon(ICONS.back)]),
      ]),
    ]);
  }

  // -------------------------------------------------------------------------
  // levels
  // -------------------------------------------------------------------------

  function levelsScreen({ albumId }) {
    const album = ctx.albums.find((a) => a.id === albumId) ?? ctx.albums[0];
    const table = el('div', { class: 'level-table' });

    album.levels.forEach((level, index) => {
      const unlocked = store.isUnlocked(album, index);
      const rec = store.level(level.id);
      table.appendChild(el('button', {
        type: 'button',
        class: 'level-row',
        'data-locked': String(!unlocked),
        'data-settled': String(rec.settled === true),
        disabled: !unlocked,
        title: unlocked
          ? `${pick(level, 'name')} — ${t('result.par')} ${level.solution}`
          : t('levels.unlock'),
        onClick: () => {
          if (!unlocked) return;
          audio.playUi('open');
          ctx.startLevel(album, index);
        },
      }, [
        el('span', { class: 'level-no' }, String(level.chapter + 1).padStart(2, '0')),
        el('span', { class: 'level-name' }, [
          pick(level, 'name'),
          el('small', {}, pick(level, 'nameZh')),
        ]),
        el('span', { class: 'level-tags' }, [
          el('span', { class: 'tag' }, t(MODE_TAG[level.mode] ?? 'badge.mix')),
          level.goal === 'recipe' ? el('span', { class: 'tag' }, t('badge.recipe')) : null,
        ]),
        el('span', { class: 'level-meta' }, [
          rec.settled ? icon(ICONS.check, { size: 14 }) : (unlocked ? null : icon(ICONS.lock, { size: 13 })),
          el('span', { class: 'data' }, `${level.solution} ${t('hud.moves.short')}`),
          ticks(level.difficulty),
        ]),
      ]));
    });

    const done = store.albumProgress(album);
    return el('div', { class: 'screen' }, [
      el('div', { class: 'masthead' }, [
        el('div', { class: 'redblock' }),
        eyebrow(`${t('levels.eyebrow')} · ${done}/${album.levels.length}`),
        el('h2', { class: 'display sm' }, pick(album, 'name')),
        el('p', { class: 'body' }, pick(album, 'blurb')),
      ]),
      table,
      el('div', { class: 'actions' }, [
        button(t('levels.back'), { class: 'btn ghost', onClick: () => go('albums') }, [icon(ICONS.back)]),
      ]),
    ]);
  }

  // -------------------------------------------------------------------------
  // how to play
  // -------------------------------------------------------------------------

  function howtoScreen() {
    const step = (no, titleKey, bodyKey) => el('div', { class: 'row' }, [
      el('div', { class: 'label' }, [
        el('span', {}, [el('span', { class: 'idx' }, no), t(titleKey)]),
        el('small', {}, t(bodyKey)),
      ]),
    ]);

    // A live demonstration of the mixing claim, computed rather than described.
    const printer = buildPalette(PALETTES.printer.pigments);
    const mineral = buildPalette(PALETTES.mineral.pigments);
    const demos = [
      { mask: 0b011, from: '青 + 藤黄', en: 'cyan + yellow' },
      { mask: 0b101, from: '品红 + 藤黄', en: 'magenta + yellow' },
      { mask: 0b110, from: '品红 + 青', en: 'magenta + cyan' },
    ];
    const strip = el('div', { class: 'lab-grid', style: { marginTop: '14px' } });
    for (const d of demos) {
      const e = printer.entries[d.mask];
      strip.appendChild(el('div', {
        class: 'lab-cell',
        style: { background: linearToCss(e.linear), height: '62px' },
        title: `${d.en} → ${e.hex}`,
      }, e.glyph));
    }

    const redBlue = mineral.entries[0b011];

    return el('div', { class: 'screen' }, [
      el('div', { class: 'masthead' }, [
        el('div', { class: 'redblock' }),
        eyebrow(t('howto.eyebrow')),
        el('h2', { class: 'display sm' }, t('howto.title')),
      ]),
      el('div', { class: 'rows' }, [
        step('01', 'howto.s1.title', 'howto.s1.body'),
        step('02', 'howto.s2.title', 'howto.s2.body'),
        step('03', 'howto.s3.title', 'howto.s3.body'),
        step('04', 'howto.s4.title', 'howto.s4.body'),
      ]),

      sectionHead('01', t('howto.mix.title'), null),
      el('p', { class: 'body' }, t('howto.mix.body')),
      strip,
      el('div', { class: 'note' }, [
        el('strong', {}, 'Kubelka–Munk'),
        ' — ',
        isZh()
          ? `矿脉画册里朱砂加花青得到 ${redBlue.hex}，一种发暗的浑绿。红颜料吸收蓝、蓝颜料吸收红，两边都丢了。真实的颜料就是这样，模型没有替它掩饰。`
          : `In the quarry album, vermilion plus indigo gives ${redBlue.hex} — a dull green. Red pigment absorbs blue and blue pigment absorbs red, so the mix loses both. Real paint does this, and the model does not cover for it.`,
      ]),

      sectionHead('02', t('howto.grids.title'), null),
      el('p', { class: 'body' }, t('howto.grids.body')),

      sectionHead('03', t('howto.access.title'), null),
      el('p', { class: 'body' }, t('howto.access.body')),

      sectionHead('04', t('howto.controls'), null),
      el('div', { class: 'rows' }, [
        el('div', { class: 'row' }, [
          el('kbd', {}, '1'), el('kbd', {}, '2'), el('kbd', {}, '3'),
          el('div', { class: 'label' }, [el('span', {}, t('howto.key.pick'))]),
        ]),
        el('div', { class: 'row' }, [el('kbd', {}, 'click'), el('div', { class: 'label' }, [el('span', {}, t('howto.key.click'))])]),
        el('div', { class: 'row' }, [el('kbd', {}, 'Z'), el('div', { class: 'label' }, [el('span', {}, t('howto.key.undo'))])]),
        el('div', { class: 'row' }, [el('kbd', {}, 'R'), el('div', { class: 'label' }, [el('span', {}, t('howto.key.reset'))])]),
        el('div', { class: 'row' }, [el('kbd', {}, 'H'), el('div', { class: 'label' }, [el('span', {}, t('howto.key.hint'))])]),
        el('div', { class: 'row' }, [el('kbd', {}, 'Esc'), el('div', { class: 'label' }, [el('span', {}, t('howto.key.pause'))])]),
      ]),

      el('div', { class: 'actions' }, [
        button(t('howto.back'), { class: 'btn ghost', onClick: () => go('title') }, [icon(ICONS.back)]),
      ]),
    ]);
  }

  // -------------------------------------------------------------------------
  // settings
  // -------------------------------------------------------------------------

  function settingsScreen() {
    const s = store.settings;

    const langSeg = segmented(
      LOCALES.map((l) => ({ value: l.code, label: l.label })),
      s.locale,
      (v) => { store.setSetting('locale', v); ctx.applyLocale(); go('settings'); }
    );

    const qualitySeg = segmented(
      [
        { value: 'high', label: t('settings.quality.high') },
        { value: 'medium', label: t('settings.quality.medium') },
        { value: 'low', label: t('settings.quality.low') },
      ],
      s.quality,
      (v) => { store.setSetting('quality', v); ctx.applyQuality(); }
    );

    let confirming = false;
    const resetRow = el('div', { class: 'row' });
    const paintReset = () => {
      fill(resetRow, [
        el('div', { class: 'label' }, [
          el('span', {}, confirming ? t('settings.reset.confirm') : t('settings.reset')),
          el('small', {}, t('settings.reset.help')),
        ]),
        confirming
          ? el('div', { style: { display: 'flex', gap: '8px' } }, [
              button(t('settings.reset.yes'), {
                class: 'btn primary',
                onClick: () => { store.reset(); confirming = false; paintReset(); },
              }),
              button(t('settings.reset.no'), { class: 'btn ghost', onClick: () => { confirming = false; paintReset(); } }),
            ])
          : button(t('settings.reset'), { class: 'btn ghost', onClick: () => { confirming = true; paintReset(); } }),
      ]);
    };
    paintReset();

    return el('div', { class: 'screen' }, [
      el('div', { class: 'masthead' }, [
        el('div', { class: 'redblock' }),
        el('h2', { class: 'display sm' }, t('settings.title')),
      ]),
      sectionHead('01', t('settings.language'), null),
      el('div', { class: 'rows' }, [row(t('settings.language'), t('settings.language.help'), langSeg)]),
      sectionHead('02', t('settings.audio'), null),
      el('div', { class: 'rows' }, [
        row(t('settings.music'), null, slider(s.music, (v) => { store.setSetting('music', v); audio.setMusicVolume(v); }, { label: t('settings.music') })),
        row(t('settings.sfx'), null, slider(s.sfx, (v) => { store.setSetting('sfx', v); audio.setSfxVolume(v); audio.playUi('tap'); }, { label: t('settings.sfx') })),
        row(t('hud.mute'), null, toggle(s.muted, (v) => { store.setSetting('muted', v); audio.setMuted(v); }, t('hud.mute'))),
      ]),
      sectionHead('03', t('settings.access'), null),
      el('div', { class: 'rows' }, [
        row(t('settings.patterns'), t('settings.patterns.help'), toggle(s.patterns, (v) => {
          store.setSetting('patterns', v);
          play.setPatternStrength(v ? 1 : 0);
        }, t('settings.patterns'))),
        row(t('settings.reducedMotion'), t('settings.reducedMotion.help'), toggle(s.reducedMotion, (v) => {
          store.setSetting('reducedMotion', v);
          ctx.applyMotion();
        }, t('settings.reducedMotion'))),
      ]),
      sectionHead('04', t('settings.quality'), null),
      el('div', { class: 'rows' }, [row(t('settings.quality'), t('settings.quality.help'), qualitySeg)]),
      sectionHead('05', t('settings.reset'), null),
      el('div', { class: 'rows' }, [resetRow]),
      el('div', { class: 'actions' }, [
        button(t('settings.back'), { class: 'btn ghost', onClick: () => go(ctx.backFromSettings ?? 'title') }, [icon(ICONS.back)]),
      ]),
    ]);
  }

  // -------------------------------------------------------------------------
  // credits
  // -------------------------------------------------------------------------

  function creditsScreen() {
    const item = (what, body) => el('li', {}, [
      el('span', { class: 'what' }, what),
      el('span', {}, body),
    ]);
    return el('div', { class: 'screen' }, [
      el('div', { class: 'masthead' }, [
        el('div', { class: 'redblock' }),
        el('h2', { class: 'display sm' }, t('credits.title')),
      ]),
      el('ul', { class: 'credit-list' }, [
        item(t('credits.engine'), t('credits.engineBody')),
        item(t('credits.colour'), t('credits.colourBody')),
        item(t('credits.grids'), t('credits.gridsBody')),
        item(t('credits.type'), t('credits.typeBody')),
        item(t('credits.audio'), t('credits.audioBody')),
      ]),
      el('div', { class: 'note' }, t('credits.note')),
      el('div', { class: 'actions' }, [
        button(t('misc.back'), { class: 'btn ghost', onClick: () => go('title') }, [icon(ICONS.back)]),
      ]),
    ]);
  }

  // -------------------------------------------------------------------------
  // the mixing lab
  // -------------------------------------------------------------------------

  function labScreen() {
    let paletteKey = 'printer';
    let pot = [];

    const potList = el('div', { class: 'lab-pots' });
    const result = el('div', { class: 'lab-result' });
    const formula = el('div', { class: 'lab-formula' });
    const grid = el('div', { class: 'lab-grid' });

    const render = () => {
      const palette = paletteFor(paletteKey);
      fill(potList, palette.pigments.map((pig, i) => {
        const n = pot.filter((x) => x === i).length;
        return el('button', {
          type: 'button',
          class: 'lab-pot',
          onClick: () => { pot.push(i); audio.playSelect(i); render(); },
        }, [
          el('span', { class: 'no' }, String(i + 1)),
          el('span', { class: 'dot', style: { background: linearToCss(palette.entries[1 << i].linear) } }),
          el('span', { class: 'nm' }, [pig.name, el('small', {}, pig.nameZh)]),
          el('span', { class: 'cnt' }, n ? `×${n}` : t('lab.add')),
        ]);
      }));

      if (!pot.length) {
        result.style.background = 'var(--paper-2)';
        result.textContent = t('lab.empty');
        formula.textContent = '';
      } else {
        const parts = pot.map((i) => [palette.pigments[i].id, 1]);
        const raw = mixReflectance(parts);
        const counts = new Map();
        for (const i of pot) counts.set(i, (counts.get(i) ?? 0) + 1);
        let mask = 0;
        for (const i of counts.keys()) mask |= 1 << i;
        const entry = palette.entries[mask];
        result.style.background = linearToCss(entry.linear);
        result.textContent = `${entry.nameZh}  ${entry.glyph}  ${entry.hex}`;
        formula.textContent =
          `${[...counts.entries()].map(([i, n]) => `${palette.pigments[i].nameZh}${n > 1 ? `×${n}` : ''}`).join(' + ')}\n` +
          `${t('lab.reflectance')}  [${raw.map((v) => v.toFixed(3)).join(', ')}]`;
      }

      fill(grid, palette.entries.filter((e) => e.mask !== 0).map((e) => el('div', {
        class: 'lab-cell',
        style: { background: linearToCss(e.linear) },
        title: `${e.name} · ${e.hex}`,
      }, e.glyph)));
    };

    const paletteSeg = segmented(
      Object.entries(PALETTES).filter(([, d]) => d.ship).map(([k, d]) => ({ value: k, label: d.nameZh })),
      paletteKey,
      (v) => { paletteKey = v; pot = []; render(); }
    );

    render();

    return el('div', { class: 'screen' }, [
      el('div', { class: 'masthead' }, [
        el('div', { class: 'redblock' }),
        eyebrow(t('lab.eyebrow')),
        el('h2', { class: 'display sm' }, t('lab.title')),
        el('p', { class: 'body' }, t('lab.lede')),
        el('div', { class: 'chips' }, [paletteSeg]),
      ]),
      el('div', { class: 'lab', style: { marginTop: '22px' } }, [
        el('div', {}, [
          sectionHead('01', t('lab.pot'), null),
          potList,
          el('div', { style: { marginTop: '12px' } }, [
            button(t('lab.clear'), { class: 'btn ghost', onClick: () => { pot = []; render(); } }),
          ]),
        ]),
        el('div', {}, [
          result,
          formula,
          sectionHead('02', t('lab.allMixes'), null),
          grid,
        ]),
      ]),
      el('div', { class: 'actions' }, [
        button(t('lab.back'), { class: 'btn ghost', onClick: () => go('title') }, [icon(ICONS.back)]),
      ]),
    ]);
  }

  // -------------------------------------------------------------------------
  // sheets (modals over a live board)
  // -------------------------------------------------------------------------

  function resultSheet({ kind, moves, par, record, level }) {
    const settled = kind === 'settled';
    const slack = par !== null && par !== undefined ? par - moves : null;
    const perfect = settled && slack !== null && slack === 0;

    const body = settled
      ? (perfect ? t('result.perfect') : t('result.wonBody', { moves, par: par ?? moves, slack: Math.max(0, slack ?? 0) }))
      : kind === 'stuck' ? t('result.stuckBody') : t('result.lostBody', { par: par ?? '?', budget: level.budget });

    const next = ctx.nextLevelFrom(level);
    const rows = el('div', { class: 'rows', style: { marginTop: '18px' } }, [
      el('div', { class: 'row' }, [
        el('div', { class: 'label' }, [el('span', {}, t('result.yourMoves'))]),
        el('span', { class: 'hud-moves', style: { fontSize: '1.3rem' } }, String(moves)),
      ]),
      par !== null && par !== undefined ? el('div', { class: 'row' }, [
        el('div', { class: 'label' }, [el('span', {}, t('result.par'))]),
        el('span', { class: 'data', style: { fontSize: '1.05rem' } }, String(par)),
      ]) : null,
      record?.record?.best ? el('div', { class: 'row' }, [
        el('div', { class: 'label' }, [el('span', {}, t('result.bestEver'))]),
        el('span', { class: 'data', style: { fontSize: '1.05rem' } }, String(record.record.best)),
      ]) : null,
    ]);

    return el('div', { class: 'sheet narrow' }, [
      el('div', { class: 'redblock', style: { background: settled ? 'var(--ink)' : 'var(--red)' } }),
      eyebrow(settled ? t('result.won') : (kind === 'stuck' ? t('result.stuck') : t('result.lost'))),
      el('h2', { class: 'display sm' }, pick(level, 'name')),
      el('p', { class: 'body' }, body),
      rows,
      el('div', { class: 'actions' }, [
        settled && next ? button(t('result.next'), {
          class: 'btn primary',
          onClick: () => { clearModal(); audio.playUi('open'); ctx.startLevel(next.album, next.index); },
        }, [icon(ICONS.play)]) : null,
        !settled ? button(t('result.retry'), { class: 'btn primary', onClick: () => { clearModal(); play.restart(); } }, [icon(ICONS.reset)]) : null,
        !settled && moves > 0 ? button(t('result.undo'), { onClick: () => { clearModal(); play.undo(); } }, [icon(ICONS.undo)]) : null,
        button(t('result.showSolution'), { onClick: () => { clearModal(); ctx.showSolution(); } }, [icon(ICONS.bulb)]),
        button(t('result.back'), { class: 'btn ghost', onClick: () => { clearModal(); ctx.quitToLevels(); } }, [icon(ICONS.back)]),
      ]),
    ]);
  }

  function solutionSheet({ report, fromHere = false }) {
    const palette = play.palette;
    const list = el('ol', { class: 'solve-steps' });
    report.steps.forEach((step, i) => {
      const from = palette.entries[step.from];
      const to = palette.entries[step.to];
      const pigment = palette.pigments[step.pigment];
      list.appendChild(el('li', {}, [
        el('span', { class: 'data' }, String(i + 1).padStart(2, '0')),
        el('span', { class: 'step-sw from', style: { background: linearToCss(from.linear) } }),
        el('span', { class: 'op' }, '+'),
        el('span', { class: 'step-sw', style: { background: linearToCss(palette.entries[1 << step.pigment].linear) } }),
        el('span', { class: 'op' }, '→'),
        el('span', { class: 'step-sw', style: { background: linearToCss(to.linear) } }),
        el('span', { class: 'data', style: { textAlign: 'right' } }, `${pigment.nameZh} · ${step.size}`),
      ]));
    });

    let playing = false;
    const playBtn = button(t('solution.play'), { class: 'btn primary' }, [icon(ICONS.play)]);
    playBtn.addEventListener('click', () => {
      if (playing) { play.stopReplay(); return; }
      playing = true;
      playBtn.textContent = t('solution.playing');
      clearModal();
      play.replay(report.moves, { stepMs: 520 });
    });

    return el('div', { class: 'sheet' }, [
      el('div', { class: 'redblock' }),
      eyebrow(fromHere ? t('hud.hint') : t('result.showSolution')),
      el('h2', { class: 'display sm' }, t('solution.title', { n: report.length })),
      el('p', { class: 'body' }, t('solution.note')),
      el('div', { class: 'note' }, [
        el('strong', {}, `${t('result.par')} ${report.length}`),
        ` · ${isZh() ? '可证明下界' : 'provable floor'} ${report.lowerBound}`,
        ` · ${isZh() ? '其中合并' : 'merges'} ${report.merges}`,
      ]),
      el('div', { style: { marginTop: '16px', maxHeight: '44vh', overflow: 'auto' } }, [list]),
      el('div', { class: 'actions' }, [
        playBtn,
        button(t('misc.close'), { class: 'btn ghost', onClick: () => clearModal() }),
      ]),
    ]);
  }

  function pauseSheet() {
    return el('div', { class: 'sheet narrow' }, [
      el('div', { class: 'redblock' }),
      el('h2', { class: 'display sm' }, t('pause.title')),
      el('div', { class: 'actions' }, [
        button(t('pause.resume'), { class: 'btn primary', onClick: () => clearModal() }, [icon(ICONS.play)]),
        button(t('pause.restart'), { onClick: () => { clearModal(); play.restart(); } }, [icon(ICONS.reset)]),
        button(t('pause.settings'), { onClick: () => { clearModal(); ctx.backFromSettings = 'pause'; go('settings'); } }, [icon(ICONS.settings)]),
        button(t('pause.quit'), { class: 'btn ghost', onClick: () => { clearModal(); ctx.quitToLevels(); } }, [icon(ICONS.back)]),
      ]),
    ]);
  }

  // -------------------------------------------------------------------------
  // manager
  // -------------------------------------------------------------------------

  const RENDERERS = {
    title: homeScreen,
    albums: albumsScreen,
    levels: levelsScreen,
    howto: howtoScreen,
    settings: settingsScreen,
    credits: creditsScreen,
    lab: labScreen,
  };

  let lastParams = {};

  function go(name, params = {}) {
    if (name === 'none') { hide(); return; }
    const renderer = RENDERERS[name];
    if (!renderer) return;
    clearModal();
    current = name;
    lastParams = params;
    fill(root, [renderer(params)]);
    root.style.pointerEvents = 'auto';
    ctx.onScreen?.(name, params);
  }

  function hide() {
    current = null;
    root.textContent = '';
    root.style.pointerEvents = 'none';
  }

  return {
    go,
    hide,
    get current() { return current; },
    get page() { return lastParams?.page ?? null; },
    get hasModal() { return modal !== null; },
    clearModal,
    showResult: (info) => showModal(resultSheet(info)),
    showSolution: (info) => showModal(solutionSheet(info)),
    showPause: () => showModal(pauseSheet()),
    refresh() { if (current) go(current, lastParams); },
  };
}

export { ticks, plateStrip, bandKey };
