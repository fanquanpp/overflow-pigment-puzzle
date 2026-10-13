/**
 * Play — the glue between the puzzle engine, the renderer and the audio.
 *
 * It owns one board at a time: compiles the level into rules, builds the tile
 * field, translates taps into moves, animates what changed, and reports what
 * happened. The UI listens to its events rather than reaching into it, so a screen
 * can be re-rendered without the board knowing.
 *
 * ---------------------------------------------------------------------------
 * What a move does to the screen
 * ---------------------------------------------------------------------------
 * A move recolours a whole region, and the feedback is layered so the player can
 * read *what* changed without reading the HUD:
 *
 *   fold    the changed tiles turn over, hinged on a per-tile random axis, so a
 *           region folding at once looks like a shingle roof rather than a page
 *   colour  they travel to the new mixture through OKLab, keeping their chroma
 *   glow    they pulse, which with bloom is what makes it read as light
 *   sound   the region's own note plus the pigment's, so the interval *is* the
 *           feedback: a unison means nothing was added, a fifth means a merge
 *
 * Hover is the other half of readability. The pointer marks exactly the tile it is
 * over — the board answers "which tile am I on" — while the HUD reports the region
 * that tile belongs to and what the armed pigment would do to it, because that is
 * the decision, not the highlight.
 */

import { Euler, Group, Vector3 } from 'three';
import { TileField } from '../render/tiles.js';
import { themeFor } from '../render/themes.js';
import { compileLevel, createSession, FREE, isSolved, isStuck, findRegion } from '../puzzle/rules.js';
import { analyse } from '../puzzle/solve.js';
import { paletteFor } from '../color/pigment.js';
import { generateBoard, mulberry32, seedFrom } from '../puzzle/generate.js';
import { MAX_NEIGHBORS } from '../grid/grid.js';

/** The furthest the board tips under the pointer, in radians. */
const TILT_MAX = 0.17;

/** How many tiles still lack each pigment, given the goal. The HUD's "what's left". */
export function needCounts(rules, colors) {
  const need = new Array(rules.pigmentCount).fill(0);
  for (const cell of rules.grid.cells) {
    const t = rules.targets[cell];
    if (t === FREE) continue;
    const missing = t & ~colors[cell];
    for (let p = 0; p < rules.pigmentCount; p++) if (missing & (1 << p)) need[p]++;
  }
  return need;
}

/** How many tiles currently hold each pigment — the "how much of it is out there". */
export function haveCounts(rules, colors) {
  const have = new Array(rules.pigmentCount).fill(0);
  for (const cell of rules.grid.cells) {
    for (let p = 0; p < rules.pigmentCount; p++) if (colors[cell] & (1 << p)) have[p]++;
  }
  return have;
}

/**
 * BFS ring distance for every cell of a region, from the cell that was tapped.
 *
 * This is what turns a move into a wave: ring 0 is the tap, ring 1 its neighbours
 * in the region, and so on. The renderer staggers each ring's animation by
 * `waveDelay`, so the change rolls outward from the finger instead of landing as
 * one swap. Returns a Map cell → ring index.
 */
export function waveRegion(grid, colors, region, tap) {
  const dist = new Map();
  if (!region.includes(tap)) {
    // A region whose tap is elsewhere (should not happen, but never wedge on it):
    // everything starts together.
    return dist;
  }
  dist.set(tap, 0);
  let frontier = [tap];
  let ring = 0;
  const wanted = new Set(region);
  while (frontier.length) {
    ring++;
    const next = [];
    for (const cell of frontier) {
      const base = cell * MAX_NEIGHBORS;
      for (let k = 0; k < MAX_NEIGHBORS; k++) {
        const nb = grid.nbr[base + k];
        if (nb < 0) break;
        if (dist.has(nb) || !wanted.has(nb)) continue;
        dist.set(nb, ring);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return dist;
}

/**
 * Generate one random practice board.
 *
 * The practice mode is the other half of the design borrowed from the sketch: a
 * board that exists to be played with, drawn fresh on demand, that records nothing
 * and unlocks nothing. It uses the same generator and the same analyser the albums
 * use, at a mid difficulty, so a practice board looks and plays like the real
 * thing — it is just not scored.
 */
export function generatePracticeBoard(albumId = 'studio', difficulty = 0.45) {
  const album = albumId;
  const seed = `practice-${Math.floor(Math.random() * 0xffffffff)}`;
  const spec = {
    id: seed,
    album,
    grid: 'square',
    cols: 8, rows: 8,
    mask: null,
    palette: 'printer',
    mode: 'mix',
    goal: 'unify',
    target: 0b111,
    blobs: 14,
    keep: 1,
    slack: 2,
    paletteLookup: (key) => paletteFor(key),
  };
  const rnd = mulberry32(seedFrom(seed));
  // A few attempts, keeping the candidate nearest the requested difficulty — the
  // same contract generateBoard has for its albums, applied to a throwaway board.
  const entry = generateBoard(spec, { rng: rnd, attempts: 10, beamWidth: 180, targetDifficulty: difficulty });
  if (entry) return entry.level;
  // Fallback: the generator's own last word, or the spec as it stands. A practice
  // board that is slightly off-difficulty is fine; one that fails to appear is not.
  return spec;
}

export class Play {
  constructor({ stage, audio, store, onEvent }) {
    this.stage = stage;
    this.audio = audio;
    this.store = store;
    this.onEvent = onEvent ?? (() => {});

    this.level = null;
    this.album = null;
    this.rules = null;
    this.session = null;
    this.field = null;
    this.impression = null;
    /**
     * Everything on the board hangs off one group, so the whole sheet can be tipped
     * under the pointer. Tilting the camera instead would move the light with the
     * board and the thickness would not read; tilting the board against a fixed
     * light is what makes it look like an object on a table.
     */
    this.boardRoot = new Group();
    this.boardRoot.name = 'board';
    this.tilt = { x: 0, z: 0, tx: 0, tz: 0 };
    this.selected = null;
    this.hoverCell = -1;
    this.solution = null;
    this.replaying = null;
    this.finished = null;
    /** When true the board is scenery: no progress is recorded, no result shown. */
    this.demoMode = false;
    /** When true the board is a random practice board: live, but unscored. */
    this.practiceMode = false;
  }

  // -------------------------------------------------------------------------

  load(level, album) {
    this.disposeBoard();
    this.level = level;
    this.album = album;
    this.selected = null;
    this.hoverCell = -1;
    this.solution = null;
    this.replaying = null;
    this.finished = null;
    // A scored load clears practice unless the caller re-sets it after `load`
    // (practice() does). Loading an album board always ends a practice run.
    if (album?.id !== 'practice') this.practiceMode = false;

    const palette = paletteFor(level.palette);
    this.rules = compileLevel(level, (key) => paletteFor(key));
    this.session = createSession(this.rules);
    this.palette = palette;

    const theme = themeFor(album?.theme ?? 'studio');
    this.field = new TileField({
      grid: this.rules.grid,
      palette,
      theme,
      patternStrength: this.store.settings.patterns ? 1 : 0,
    });
    this.boardRoot.add(this.field.group);

    // The plate's own impression: a hard offset copy in darkened ink. This is what
    // replaces the glossy mirrored reflection of the previous visual language.
    const impression = this.field.createImpression();
    this.impression = impression;
    this.boardRoot.add(impression.mesh);

    this.tilt = { x: 0, z: 0, tx: 0, tz: 0 };
    this.boardRoot.rotation.set(0, 0, 0);
    this.stage.add(this.boardRoot);

    // The sheet's control strip prints this album's actual inks.
    this.stage.setPalette?.(palette);

    // Snap the board's colours in without animating, then reveal it with a bar of
    // signal red crossing the sheet.
    this.field.setColors(this.session.colors, { animate: false });
    const { width, height } = this.rules.grid.bounds;
    this.stage.frameBoard(width, height, {
      impression: Math.max(
        this.stage.theme.plate.impression.x, this.stage.theme.plate.impression.z),
      // The requested tilt. frameBoard will reduce it if the board is too big for
      // the rectangle to allow the full amount.
      tilt: this.stage.reducedMotion ? 0 : TILT_MAX,
    });

    this._sweep = { t: 0, duration: this.stage.reducedMotion ? 0.01 : 0.8, span: height + 2 };

    // The plate's corners, in the board's own space. Tipping the board rotates it
    // about its centre, which would sink the low edge below the sheet it is lying on;
    // the frame loop lifts the board by exactly that amount, so it tips like a plate
    // resting on a table rather than like one sinking through it.
    const halfW = width * 0.5;
    const halfH = height * 0.5;
    const d = this.field.depth;
    this._corners = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, d]) {
      this._corners.push([sx * halfW, y, sz * halfH]);
    }
    this.field.setSweep({ y: height * 0.5 + 1, strength: 0, width: 0.45 });

    this.onEvent({ type: 'loaded', level, album, rules: this.rules, palette, session: this.session });
    this._emitState();
  }

  disposeBoard() {
    if (this.field) {
      this.boardRoot.remove(this.field.group);
      this.field.dispose();
      this.field = null;
    }
    if (this.impression) {
      this.boardRoot.remove(this.impression.mesh);
      this.impression = null;
    }
    this.stage.remove(this.boardRoot);
    this.rules = null;
    this.session = null;
  }

  dispose() {
    this.disposeBoard();
  }

  // -------------------------------------------------------------------------

  selectPigment(index) {
    if (!this.rules) return;
    if (!this.rules.available.includes(index)) {
      this.audio.playReject();
      this.onEvent({ type: 'hint', key: 'dock.notNeeded', kind: 'bad' });
      return;
    }
    this.selected = this.selected === index ? null : index;
    if (this.selected !== null) this.audio.playSelect(index);
    this.onEvent({ type: 'select', pigment: this.selected });
    this._emitState();
    this._refreshHover();
  }

  /** A tap on the board. */
  tap(point) {
    if (!this.rules || this.finished) return;
    const cell = this.field.pick({ x: point.nx, y: point.ny }, this.stage.camera, this.boardRoot);
    if (cell < 0) return;
    this.applyAt(cell);
  }

  /**
   * Tip the sheet under the pointer.
   *
   * The camera parallax and this are deliberately separate: the camera swings, which
   * changes what you see of the room, and the board tips, which changes what you see
   * of the board. Together they read as a solid object on a surface rather than as a
   * picture that slides.
   */
  setPointerTilt(nx, ny, { suspended = false } = {}) {
    if (this.stage.reducedMotion) return;
    // While a drag is in progress the camera is being orbited, and tilting the board
    // at the same time would be two motions fighting over one gesture.
    if (suspended) return;
    // The limit is solved per board by the framing pass, so a big board tips less
    // than a small one and neither leaves the frame.
    const max = this.stage.tiltLimit || TILT_MAX;
    this.tilt.tx = -ny * max;
    this.tilt.tz = nx * max * 0.72;
  }

  applyAt(cell) {
    if (this.selected === null) {
      // Selecting a pigment is a real requirement, so say so rather than guessing
      // one — guessing would make a deliberate puzzle feel like a toy.
      this.audio.playReject();
      this.onEvent({ type: 'hint', key: 'hud.pickPigment', kind: 'warn' });
      return;
    }

    const before = this.session.colors[cell];
    const result = this.session.play(cell, this.selected);
    if (!result.ok) {
      this.audio.playReject();
      this.onEvent({
        type: 'hint',
        key: result.reason === 'noop' ? 'dock.noop' : 'hud.pickPigment',
        kind: result.reason === 'noop' ? 'warn' : 'bad',
      });
      this.onEvent({ type: 'reject', reason: result.reason, cell });
      return;
    }

    this.audio.playMove({
      palette: this.palette,
      fromMask: result.from,
      toMask: result.to,
      size: result.size,
      pigment: this.selected,
    });

    // The wave: BFS ring distance from the tap, so each ring of the region waits
    // its turn before folding. Undo and reset call setCells without a distance and
    // stay instant — those are corrections, not events.
    const dist = waveRegion(this.rules.grid, this.session.colors, result.region, cell);
    this.field.rippleAt(cell);
    this.field.setCells(this.session.colors, result.region, { animate: true, dist });
    this.field.foldCells(result.region);

    this.onEvent({ type: 'move', result, session: this.session, need: needCounts(this.rules, this.session.colors) });
    this._emitState();

    if (this.session.solved) this._finish('settled');
    else if (this.session.stuck) this._finish('stuck');
    else if (this.session.moves >= this.rules.budget) this._finish('lost');
    else this._refreshHover();
  }

  undo() {
    if (!this.rules || this.replaying) return false;
    if (!this.session.undo()) return false;
    this.finished = null;
    this.audio.playUndo();
    this.field.setColors(this.session.colors, { animate: true });
    this.onEvent({ type: 'undo', session: this.session });
    this._emitState();
    this._refreshHover();
    return true;
  }

  reset() {
    if (!this.rules || this.replaying) return;
    this.session.reset();
    this.finished = null;
    this.selected = null;
    this.audio.playUi('close');
    this.field.setColors(this.session.colors, { animate: true });
    this.onEvent({ type: 'reset', session: this.session });
    this._emitState();
    this._refreshHover();
  }

  restart() {
    this.load(this.level, this.album);
  }

  // -------------------------------------------------------------------------
  // practice
  // -------------------------------------------------------------------------

  /**
   * Load a fresh random board. Nothing about it is recorded: `practiceMode`
   * suppresses the result card and the progress record the same way `demoMode`
   * does, but the board is live and the player plays it themselves.
   */
  practice({ albumId = 'studio', difficulty = 0.45, palette = 'printer' } = {}) {
    this.stopReplay();
    // A demo board replaying itself over a practice board would be two ghosts in
    // one machine; whoever calls this wants a live board. (The UI entry also stops
    // the demo's timer loop — this clears the flag on the play side.)
    this.demoMode = false;
    const level = generatePracticeBoard(albumId, difficulty);
    level.palette = level.palette ?? palette;
    // load() clears practiceMode for album boards, so the flag is set after it —
    // the album check inside load() must keep winning for real album levels.
    this.load(level, this.album ?? { id: 'practice', theme: 'studio', name: 'Practice', nameZh: '练习' });
    this.practiceMode = true;
    // The goal line reads as a scored level otherwise; a practice board has no par.
    this.onEvent({ type: 'practice', level });
    this._emitState();
    return level;
  }

  get inPractice() {
    return this.practiceMode === true && this.demoMode !== true;
  }

  // -------------------------------------------------------------------------
  // hints
  // -------------------------------------------------------------------------

  /**
   * Compute a solution from the *current* position, not from the start.
   *
   * A hint after four moves should account for those four moves; solving the
   * original board and reading off step five would be wrong whenever the player
   * took a different route — which is most of the time.
   */
  solveFromHere({ width = 420 } = {}) {
    if (!this.rules) return null;
    const snapshot = this.session.snapshot();
    const rules = { ...this.rules, level: { ...this.level, colors: Array.from(snapshot.colors) } };
    const report = analyse(rules, { width });
    if (!report.solved) return null;
    return report;
  }

  hint() {
    if (!this.rules || this.finished || this.replaying) return null;
    const report = this.solution ?? this.solveFromHere();
    if (!report) {
      this.onEvent({ type: 'hint', key: 'hud.stuck', kind: 'bad' });
      return null;
    }
    this.solution = report;
    this.onEvent({ type: 'solution', report });
    return report;
  }

  /** Play a solution back move by move, so the player sees the idea, not the answer. */
  replay(moves, { stepMs = 460 } = {}) {
    if (!this.rules || this.replaying) return;
    this.replaying = { moves: [...moves], i: 0, timer: null };
    this.onEvent({ type: 'replay', state: 'start' });
    const tick = () => {
      const r = this.replaying;
      if (!r) return;
      if (r.i >= r.moves.length || this.session.solved) {
        this.stopReplay();
        return;
      }
      const mv = r.moves[r.i++];
      this.selected = mv.pigment;
      this.applyAt(mv.cell);
      this.onEvent({ type: 'replay', state: 'step', index: r.i, total: r.moves.length });
      if (this.session.solved) { this.stopReplay(); return; }
      r.timer = setTimeout(tick, stepMs);
    };
    tick();
  }

  stopReplay() {
    if (!this.replaying) return;
    if (this.replaying.timer) clearTimeout(this.replaying.timer);
    this.replaying = null;
    this.onEvent({ type: 'replay', state: 'stop' });
  }

  // -------------------------------------------------------------------------

  _finish(kind) {
    if (this.finished) return;
    this.finished = kind;
    const moves = this.session.moves;
    const par = this.level.solution ?? null;

    // A demo board is scenery behind a menu. A practice board is live play, but it
    // is not a level in any album: recording it would hand the player progress they
    // did not earn against a real board, and showing the scored result card would
    // pretend otherwise. Both just finish, quietly.
    if (this.demoMode) {
      this.onEvent({ type: 'demoFinished', kind });
      return;
    }
    if (this.practiceMode) {
      if (kind === 'settled') this.audio.playSettled({ moves, par: moves });
      else this.audio.playFailed();
      this.onEvent({ type: 'practiceFinished', kind, moves });
      return;
    }

    let record = null;
    if (kind === 'settled') {
      this.audio.playSettled({ moves, par: par ?? moves });
      record = this.store.record(this.level.id, { settled: true, moves });
    } else {
      this.audio.playFailed();
      this.store.record(this.level.id, { settled: false, moves });
    }
    this.onEvent({ type: 'finished', kind, moves, par, record, session: this.session });
  }  _emitState() {
    if (!this.rules) return;
    this.onEvent({
      type: 'state',
      // The event carries everything the HUD needs rather than relying on it having
      // been told about the level first. A state event that only works after some
      // other call has happened is a state event with a hidden precondition, and it
      // is how this crashed on the very first frame of every board.
      rules: this.rules,
      palette: this.palette,
      session: this.session,
      need: needCounts(this.rules, this.session.colors),
      have: haveCounts(this.rules, this.session.colors),
      selected: this.selected,
      progress: this.session.progress,
      remaining: this.session.remaining,
      finished: this.finished,
      stuckCells: this.session.stuckCells,
    });
  }

  // -------------------------------------------------------------------------

  hover(point) {
    if (!this.rules || !this.field) return;
    const cell = this.field.pick({ x: point.nx, y: point.ny }, this.stage.camera, this.boardRoot);
    if (cell === this.hoverCell) return;
    this.hoverCell = cell;
    this._refreshHover();
  }

  clearHover() {
    if (this.hoverCell === -1) return;
    this.hoverCell = -1;
    this._refreshHover();
  }

  _refreshHover() {
    if (!this.field || !this.session) return;
    if (this.hoverCell < 0) {
      this.field.clearHover();
      this.onEvent({ type: 'hover', cell: -1, region: [] });
      return;
    }
    // Highlight exactly the tile under the pointer, not its whole region. The
    // region is still what a move acts on, and the HUD still reports its size and
    // the previewed outcome — but the board itself answers "which tile am I on",
    // which is the question the pointer is actually asking.
    const region = this.field.regionOf(this.hoverCell, this.session.colors);
    this.field.setHover([this.hoverCell]);

    // Preview what the selected pigment would do here, so the player can see the
    // outcome before committing a move.
    let preview = null;
    if (this.selected !== null && this.rules.available.includes(this.selected)) {
      const from = this.session.colors[this.hoverCell];
      const to = this.rules.mixTable[from * this.rules.pigmentCount + this.selected];
      if (to !== from) {
        const entry = this.palette.entries[to];
        const offGoal = this._countOffGoal(region, to);
        preview = { from, to, entry, offGoal, size: region.length };
      }
    }
    this.onEvent({ type: 'hover', cell: this.hoverCell, region, preview });
  }

  /** How many of these tiles would end up past their goal by taking this colour. */
  _countOffGoal(region, to) {
    const { targets } = this.rules;
    let n = 0;
    for (const cell of region) {
      const t = targets[cell];
      if (t === FREE) continue;
      if (this.rules.goal === 'recipe') {
        if ((to & t) !== t) n++;
      } else if (to !== t) {
        n++;
      }
    }
    return n;
  }

  // -------------------------------------------------------------------------

  setPatternStrength(v) {
    this.field?.setPatternStrength(v);
  }

  update(dt) {
    if (!this.field) return;
    this.field.update(dt);

    // Spring the tilt toward the pointer. The lag is the point: a board that
    // tracked the pointer exactly would feel weightless.
    // A slightly slow spring: the lag is what makes the board feel like it has
    // weight. Tracking the pointer exactly would read as a cursor, not a panel.
    const k = Math.min(1, dt * 5.2);
    this.tilt.x += (this.tilt.tx - this.tilt.x) * k;
    this.tilt.z += (this.tilt.tz - this.tilt.z) * k;
    const tipping = Math.abs(this.tilt.x) > 1e-5 || Math.abs(this.tilt.z) > 1e-5;
    if (tipping) {
      this.boardRoot.rotation.set(this.tilt.x, 0, this.tilt.z);
      // Lift by the lowest the plate's own corners now sit, so the underside never
      // passes through the sheet. Measured from the corners rather than derived from
      // the tilt angle, because the two axes compound and a formula that is right for
      // one tilt is wrong for the combination.
      let lowest = Infinity;
      for (const c of this._corners) {
        const y = _e.set(this.tilt.x, 0, this.tilt.z, 'XYZ');
        const vy = _v.set(c[0], c[1], c[2]).applyEuler(_e).y;
        if (vy < lowest) lowest = vy;
      }
      this.boardRoot.position.y = -lowest;
    } else if (this.boardRoot.position.y !== 0) {
      this.boardRoot.rotation.set(0, 0, 0);
      this.boardRoot.position.y = 0;
    }

    // The reveal: one bar of signal red crossing the sheet, once, on load.
    if (this._sweep && this._sweep.t < 1) {
      this._sweep.t = Math.min(1, this._sweep.t + dt / this._sweep.duration);
      const t = this._sweep.t;
      const y = this._sweep.span * (0.5 - t);
      const strength = Math.sin(t * Math.PI);
      this.field.setSweep({ y, width: 0.45, strength });
      if (t >= 1) this.field.setSweep({ strength: 0 });
    }
  }

  get animating() {
    return (this._sweep && this._sweep.t < 1) || (this.field?.animating ?? false);
  }
}

/** Scratch: the tilt lift runs every frame and must not allocate. */
const _e = new Euler();
const _v = new Vector3();

export { isSolved, isStuck, findRegion, FREE, MAX_NEIGHBORS };
