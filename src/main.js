/**
 * Boot and wiring.
 *
 * This is the only module that knows about all the others. It builds the store,
 * the stage, the HUD, the screens and the play session, then connects them with
 * events: the board reports what happened, the HUD and the screens listen. Nothing
 * reaches into anything else's state, which is what keeps the render loop free of
 * UI concerns and lets a screen be rebuilt without touching the board.
 *
 * ---------------------------------------------------------------------------
 * The demo board behind the menus
 * ---------------------------------------------------------------------------
 * A menu over an empty screen is a menu over nothing. So the title and the album
 * picker sit in front of a real board that plays itself: a mid-difficulty board
 * from the studio album is solved on a loop, slowly, so the mechanic is
 * demonstrated rather than described. That board runs in `demoMode`, which
 * suppresses both the result card and the progress record — scenery must not award
 * the player anything.
 */

import { Stage } from './render/stage.js';
import { themeFor, applyThemeCss } from './render/themes.js';
import { ALBUMS, LEVELS, levelById } from './puzzle/levels.js';
import { paletteFor } from './color/pigment.js';
import { createStore } from './core/save.js';
import { Audio } from './core/audio.js';
import { createInput } from './core/input.js';
import { setLocale, t, pick } from './core/i18n.js';
import { Play } from './game/play.js';
import { Hud } from './ui/hud.js';
import { createScreens } from './ui/screens.js';

const bootEl = document.getElementById('boot');
const bootFill = document.getElementById('boot-fill');
const bootStatus = document.getElementById('boot-status');
const canvas = document.getElementById('scene');
const hudRoot = document.getElementById('hud');
const screensRoot = document.getElementById('screens');

const setBoot = (pct, label, isError = false) => {
  if (bootFill) bootFill.style.width = `${Math.round(pct * 100)}%`;
  if (bootStatus) {
    bootStatus.textContent = label;
    bootStatus.classList.toggle('error', isError);
  }
};

function fatal(err) {
  console.error(err);
  setBoot(1, t('boot.failed', { msg: err?.message ?? String(err) }), true);
}

async function main() {
  setBoot(0.05, t('boot.loading', { label: 'settings' }));

  const store = createStore();
  setLocale(store.settings.locale);

  setBoot(0.2, t('boot.loading', { label: 'renderer' }));
  if (!canvas) throw new Error('no canvas');
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) {
    setBoot(1, t('boot.noWebgl'), true);
    return;
  }

  const stage = new Stage(canvas, {
    theme: 'offset',
    reducedMotion: store.settings.reducedMotion,
  });
  setBoot(0.55, t('boot.loading', { label: 'audio' }));

  const audio = new Audio({
    music: store.settings.music,
    sfx: store.settings.sfx,
    muted: store.settings.muted,
  });

  setBoot(0.75, t('boot.loading', { label: 'board' }));

  let screens;
  let hud;
  let play;

  // -------------------------------------------------------------------------
  // navigation
  // -------------------------------------------------------------------------

  const ctx = {
    albums: ALBUMS,
    levels: LEVELS,
    store,
    audio,
    stage,
    play: null,
    startLevel,
    quitToLevels,
    nextLevelFrom,
    showSolution,
    applyLocale,
    applyQuality,
    applyMotion,
    onScreen,
    onModalDismiss: () => { if (demoWanted) startDemo(); },
  };

  screens = createScreens(screensRoot, ctx);

  hud = new Hud(hudRoot, {
    onAction: (action, value) => {
      if (action === 'recentre') { stage.resetView(); hud.toast(t('hud.recentred'), '', 1400); }
      else if (action === 'undo') play.undo();
      else if (action === 'reset') play.reset();
      else if (action === 'hint') showSolution({ fromHere: true });
      else if (action === 'pause') openPause();
      else if (action === 'pigment') play.selectPigment(value);
    },
  });

  play = new Play({
    stage,
    audio,
    store,
    onEvent: onPlayEvent,
  });
  ctx.play = play;

  // -------------------------------------------------------------------------
  // demo board
  // -------------------------------------------------------------------------

  let demoWanted = true;
  let demoTimer = null;
  let demoLevel = null;

  /** A board that looks good and demonstrates merging, not one that shows off size. */
  function pickDemoLevel() {
    const album = ALBUMS[0];
    const candidates = album.levels.filter((l) => l.difficulty > 0.3 && l.difficulty < 0.58 && l.grid !== 'triangle');
    return candidates[Math.floor(candidates.length / 2)] ?? album.levels[2];
  }

  function startDemo() {
    if (!demoWanted || screens.current === 'levels' || !screens.current) {
      // No demo while a level list is open; it would animate behind a wall of cards.
      if (!screens.current) return;
    }
    stopDemo();
    demoWanted = true;
    demoLevel = pickDemoLevel();
    play.demoMode = true;
    applyChrome(screens.current === 'title' && (screens.page ?? 0) === 0 ? 'hero' : 'ambient');
    play.load(demoLevel, ALBUMS[0]);
    hud.setVisible(false);
    applyThemeFor(demoLevel);
    const report = play.solveFromHere({ width: 260 });
    if (!report) return;
    const loop = () => {
      if (!demoWanted) return;
      play.replay(report.moves, { stepMs: 620 });
      demoTimer = setTimeout(() => {
        if (!demoWanted) return;
        play.stopReplay();
        play.session.reset();
        play.field.setColors(play.session.colors, { animate: true });
        demoTimer = setTimeout(loop, 1400);
      }, report.length * 620 + 1800);
    };
    demoTimer = setTimeout(loop, 900);
  }

  function stopDemo() {
    demoWanted = false;
    if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; }
    play.stopReplay();
  }

  // -------------------------------------------------------------------------
  // level flow
  // -------------------------------------------------------------------------

  function applyThemeFor(level) {
    const album = ALBUMS.find((a) => a.id === level.album) ?? ALBUMS[0];
    const theme = themeFor(album.theme);
    stage.applyTheme(theme);
    applyThemeCss(theme);
    play.field?.applyTheme(theme);
  }

  /**
   * How much of the viewport the board may use.
   *
   * While playing, the HUD bars take a strip top and bottom. In a menu, the printed
   * panel takes the left column on a wide screen and the board keeps the right one —
   * so the framing has to be told, because it fits the board into whatever rectangle
   * it is given rather than into the window.
   */
  /**
   * How much of the screen the board gets, and how loudly it is allowed to say it.
   *
   * Three registers, set in one place so no screen can quietly disagree with
   * another:
   *
   *   focus    playing. The board is the screen; the two HUD rules are the only
   *            thing reserved, measured from the real elements rather than guessed,
   *            so a longer level name cannot push the board under a bar.
   *   hero     page one of the landing screen. The board is the subject, in a band
   *            across the lower half, under a header rather than beside it.
   *   ambient  everything else. A functional page is a page of type; the board sits
   *            behind it, framed to the whole viewport so it shows in the margins
   *            around the measure-limited column, and dimmed to say it is scenery.
   */
  function applyChrome(mode, params = {}) {
    const H = window.innerHeight || 720;

    // Orbiting is available everywhere — the board is the one thing on screen in every
    // state, and being able to walk around it is how you read a layout of tiles. On a
    // menu it drifts slowly on its own; while playing it holds still until you ask.
    stage.setControlsEnabled(true, { autoRotate: mode !== 'focus' });

    if (mode === 'focus') {
      document.body.dataset.canvas = 'focus';
      const bar = hudRoot.querySelector('.hud-bar');
      const dock = hudRoot.querySelector('.hud-bottom');
      // A hidden or not-yet-populated bar reports offsetHeight 0, not undefined, so
      // `?? 56` does not catch it — and the board then gets framed into nearly the
      // whole viewport and slides under the bars. Clamp to a real minimum instead,
      // and re-run this after the HUD has been filled (see startLevel).
      const top = Math.max(bar?.offsetHeight ?? 0, 52) + 10;
      const bottom = Math.max(dock?.offsetHeight ?? 0, 92) + 10;
      stage.setViewportInset({ x0: 0.012, x1: 0.988, y0: top / H, y1: 1 - bottom / H });
      return;
    }

    const hero = mode === 'hero';
    document.body.dataset.canvas = hero ? 'hero' : 'ambient';
    if (hero) {
      stage.setViewportInset({ x0: 0.035, x1: 0.965, y0: 0.575, y1: 0.985 });
    } else {
      stage.setViewportInset({ x0: 0.02, x1: 0.98, y0: 0.05, y1: 0.95 });
    }
  }

  function startLevel(album, index) {
    stopDemo();
    const level = album.levels[index];
    play.demoMode = false;
    play.load(level, album);
    applyChrome('focus');
    applyThemeFor(level);
    hud.setVisible(true);
    hud.setLevel(level, album, play.rules, play.palette);
    // Only now do the bars have their real heights — a different palette can wrap
    // the dock to a second row — so the framing is solved after them, not before.
    applyChrome('focus');
    screens.hide();
    audio.ensure();
    audio.startMusic(album.theme);
    currentLevel = { album, index };
  }

  let currentLevel = null;

  function nextLevelFrom(level) {
    const album = ALBUMS.find((a) => a.id === level.album);
    if (!album) return null;
    const i = album.levels.findIndex((l) => l.id === level.id);
    if (i < 0 || i + 1 >= album.levels.length) {
      // End of an album: offer the next album's first board if there is one.
      const ai = ALBUMS.indexOf(album);
      const nextAlbum = ALBUMS[ai + 1];
      if (nextAlbum) return { album: nextAlbum, index: 0 };
      return null;
    }
    return { album, index: i + 1 };
  }

  function quitToLevels() {
    stopDemo();
    const album = currentLevel?.album ?? ALBUMS[0];
    play.demoMode = true;
    audio.unduckMusic();
    applyChrome('ambient');
    screens.go('levels', { albumId: album.id });
    hud.setVisible(false);
  }

  function openPause() {
    if (play.finished) return;
    audio.playUi('open');
    screens.showPause();
  }

  function showSolution({ fromHere = false } = {}) {
    const report = play.hint();
    if (report) screens.showSolution({ report, fromHere });
  }

  // -------------------------------------------------------------------------
  // play events → UI
  // -------------------------------------------------------------------------

  function onPlayEvent(ev) {
    switch (ev.type) {
      case 'loaded':
        hud.setLevelRefs(ev.level, ev.album);
        break;
      case 'state':
        hud.setState(ev);
        break;
      case 'move':
        audio.duckMusic(0.55, 0.2);
        break;
      case 'hint':
        hud.hint(ev.key, ev.kind);
        break;
      case 'hover':
        hud.setHover(ev);
        break;
      case 'select':
        break;
      case 'solution':
        break;
      case 'finished':
        audio.unduckMusic(1.0);
        screens.showResult({
          kind: ev.kind, moves: ev.moves, par: ev.par, record: ev.record, level: play.level,
        });
        break;
      case 'demoFinished':
        break;
      case 'replay':
        if (ev.state === 'stop') audio.unduckMusic(0.8);
        break;
      default:
        break;
    }
  }

  function onScreen(name, params) {
    hud.setVisible(false);
    const hero = name === 'title' && (params?.page ?? 0) === 0;
    applyChrome(hero ? 'hero' : 'ambient');
    // A wall of rows deserves a quiet board, not one solving itself behind it.
    if (name === 'levels' || name === 'settings') {
      stopDemo();
      if (play.level && play.demoMode) applyThemeFor(play.level);
      return;
    }
    // Every other menu sits in front of a board that is demonstrating the mechanic.
    if (!play.finished) startDemo();
  }

  // -------------------------------------------------------------------------
  // settings application
  // -------------------------------------------------------------------------

  function applyLocale() {
    setLocale(store.settings.locale);
    hud.refreshLabels();
    screens.refresh();
  }

  function applyQuality() {
    const q = store.settings.quality;
    // There is no bloom pass any more, so quality is about pixel count and about
    // how much of the print simulation to run: the dot screen and the paper tooth
    // are per-pixel work on the finished image.
    const ratio = q === 'low' ? 1
      : q === 'medium' ? Math.min(window.devicePixelRatio || 1, 1.35)
      : Math.min(window.devicePixelRatio || 1, 1.75);
    stage.pixelRatio = ratio;
    stage.renderer.setPixelRatio(ratio);
    const plate = stage.theme.plate;
    const print = stage.print.uniforms;
    print.uHalftone.value = q === 'low' ? 0 : plate.halftone;
    print.uGrain.value = q === 'low' || store.settings.reducedMotion ? 0 : plate.grain;
    print.uMisregistration.value = q === 'low' ? 0 : plate.misregistration;
    stage.resize();
  }

  function applyMotion() {
    stage.reducedMotion = store.settings.reducedMotion;
    applyQuality();
  }

  // -------------------------------------------------------------------------
  // input + loop
  // -------------------------------------------------------------------------

  const input = createInput(canvas, {
    onAction: (action, point) => {
      audio.ensure();
      if (screens.hasModal) return;
      if (screens.current) return; // menus own their own clicks
      if (action === 'tap') play.tap(point);
      else if (action === 'undo') play.undo();
      else if (action === 'reset') play.reset();
      else if (action === 'hint') showSolution({ fromHere: true });
      else if (action === 'pause') openPause();
      else if (action?.startsWith('pigment:')) play.selectPigment(Number(action.slice(8)));
    },
    onPointer: (p) => {
      if (screens.hasModal) return;
      // The board tips under the pointer; the camera does not. Two motions at two
      // different smoothings — the tilt is spring-damped, the camera parallax was
      // set straight from the pointer — read as the board jittering against its own
      // background. One damped motion against a fixed camera and a fixed light is
      // both calmer and more convincing: it looks like an object on a table.
      play.setPointerTilt(p.nx, p.ny, { suspended: input.pointerDown });
    },
    onHover: (p) => {
      if (screens.current || screens.hasModal) return;
      play.hover(p);
    },
  });

  // The first gesture is also what unlocks audio, and what stops the demo.
  const unlock = () => {
    audio.ensure();
    if (store.settings.music > 0) {
      const album = ALBUMS.find((a) => a.id === (currentLevel?.album.id ?? play.level?.album)) ?? ALBUMS[0];
      audio.startMusic(album.theme);
    }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });

  let last = performance.now();
  let raf = 0;
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    play.update(dt);
    stage.render(dt);
  };

  // -------------------------------------------------------------------------
  // go
  // -------------------------------------------------------------------------

  applyQuality();
  setBoot(0.9, t('boot.loading', { label: 'albums' }));
  hud.setVisible(false);
  applyChrome('hero');
  screens.go('title', { page: 0 });
  startDemo();

  setBoot(1, t('boot.ready'));
  bootEl?.classList.add('gone');
  setTimeout(() => bootEl?.remove(), 600);

  raf = requestAnimationFrame(frame);

  // Pause the render loop when the tab is hidden: a background tab that keeps
  // rendering burns battery for nothing, and `dt` is clamped on return anyway.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      audio.stopMusic();
    } else {
      last = performance.now();
      raf = requestAnimationFrame(frame);
      if (!store.settings.muted) {
        const album = ALBUMS.find((a) => a.id === (currentLevel?.album.id ?? play.level?.album)) ?? ALBUMS[0];
        audio.startMusic(album.theme);
      }
    }
  });

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && screens.hasModal) { screens.clearModal(); demoWanted = true; startDemo(); }
    // F puts the camera back where the board was framed. With free orbit, a player
    // who has walked the camera somewhere unhelpful needs one key that undoes it.
    if ((ev.key === 'f' || ev.key === 'F') && !screens.hasModal) {
      const tag = ev.target?.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
        stage.resetView();
        hud.toast(t('hud.recentred'), '', 1400);
      }
    }
  });

  // A sheet over the board pauses the camera too: dragging behind a modal would move
  // the thing the modal is talking about.
  screensRoot.addEventListener('pointerdown', () => {}, { passive: true });

  // The panel collapses to one column below 900px, so the board's allowed area
  // changes with the window and the framing has to be re-solved.
  let lastWide = window.innerWidth >= 900;
  window.addEventListener('resize', () => {
    const wide = window.innerWidth >= 900;
    if (wide === lastWide) return;
    lastWide = wide;
    if (!screens.current) applyChrome('focus');
    else {
      const hero = screens.current === 'title' && (screens.page ?? 0) === 0;
      applyChrome(hero ? 'hero' : 'ambient');
    }
  });

  // Expose a small handle for debugging in the console; harmless in production and
  // genuinely useful when a board misbehaves.
  window.overflow = {
    stage, play, store, audio, screens, hud, ALBUMS, LEVELS, levelById, paletteFor,
    startLevel, applyChrome, applyThemeFor,
  };
}

main().catch(fatal);
