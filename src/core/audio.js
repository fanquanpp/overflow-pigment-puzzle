/**
 * Procedural audio.
 *
 * Every sound in this game is synthesised at runtime with WebAudio. There are no
 * audio files, which means no downloads, no licence to track, and — the reason that
 * actually matters here — sounds that can be *derived from the puzzle* rather than
 * picked from a library.
 *
 * That derivation is the whole design:
 *
 *   a pigment has a pitch        each pigment index maps to a scale degree, so the
 *                               same move on the same pigment always sounds the same
 *   a mix is a chord             applying pigment P to a region of colour C plays
 *                               the interval between their two pitches, so a move
 *                               that merges two pigments is heard as a consonance
 *                               and a move that adds nothing is heard as a unison
 *   a region has a size          the note's gain and length scale with how many
 *                               tiles changed, so a big merge sounds like one
 *
 * The scale is a major pentatonic, so any combination of pigments is consonant and
 * a player cannot make the game sound wrong by playing it in an unusual order.
 */

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const ROOT_MIDI = 45; // A2

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor({ music = 0.4, sfx = 0.7, muted = false } = {}) {
    this.ctx = null;
    this.musicVolume = music;
    this.sfxVolume = sfx;
    this.muted = muted;
    this.started = false;
    this._music = null;
    this._scheduler = null;
    this._theme = null;
  }

  /**
   * WebAudio can only start from a user gesture, so this is called on the first
   * click rather than at boot. Everything before that is silent and nothing throws.
   */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVolume * 0.5;
    this.musicBus.connect(this.master);

    // A short reverb-ish tail built from a decaying noise burst, so notes do not
    // stop dead. Cheaper and more controllable than a convolution reverb.
    this.space = this.ctx.createConvolver();
    const len = Math.floor(this.ctx.sampleRate * 1.6);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * 0.5;
      }
    }
    this.space.buffer = buf;
    this.spaceGain = this.ctx.createGain();
    this.spaceGain.gain.value = 0.22;
    this.space.connect(this.spaceGain);
    this.spaceGain.connect(this.master);

    this.started = true;
    return this.ctx;
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.musicBus) this.musicBus.gain.value = this.muted ? 0 : v * 0.5;
  }

  setSfxVolume(v) {
    this.sfxVolume = v;
    if (this.sfxBus) this.sfxBus.gain.value = this.muted ? 0 : v;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 1;
    if (this.musicBus) this.musicBus.gain.value = m ? 0 : this.musicVolume * 0.5;
  }

  /** Pitch of a pigment, as a MIDI note. Deterministic, so the game has a key. */
  pigmentNote(pigmentIndex, octave = 0) {
    const deg = SCALE[pigmentIndex % SCALE.length];
    return ROOT_MIDI + deg + 12 * octave;
  }

  /** Pitch of a palette entry, so a mixture has a note derived from its pigments. */
  mixNote(palette, mask) {
    const bits = [];
    for (let p = 0; p < palette.pigments.length; p++) if (mask & (1 << p)) bits.push(p);
    if (!bits.length) return ROOT_MIDI;
    // Average the constituent pitches: a two-pigment mix sits between them, which
    // is what makes a merge sound like a resolved interval.
    const sum = bits.reduce((a, p) => a + this.pigmentNote(p), 0);
    return Math.round(sum / bits.length);
  }

  // -------------------------------------------------------------------------
  // voices
  // -------------------------------------------------------------------------

  /** A single plucked tone with a short attack and an exponential decay. */
  _tone({ note, when = 0, duration = 0.4, gain = 0.3, type = 'triangle', detune = 0, send = 0.4 }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = midiToHz(note);
    osc.detune.value = detune;

    // a very short attack; anything longer than ~8ms reads as a swell, not a tap
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(g);
    g.connect(this.sfxBus);
    if (send > 0 && this.space) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(this.space);
    }
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  /** Filtered noise — used for the board settling and for interface clicks. */
  _noise({ when = 0, duration = 0.2, gain = 0.15, freq = 1800, q = 0.7, type = 'bandpass' }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxBus);
    src.start(t0);
  }

  // -------------------------------------------------------------------------
  // game events
  // -------------------------------------------------------------------------

  /**
   * A move: the region's own note, plus the pigment's note when the pigment is new
   * to the mixture.
   *
   * That second note is the whole point. Adding a pigment the region already holds
   * produces a unison — audibly nothing — and adding one that merges two regions
   * produces a fifth or an octave, which sounds like a resolution. The player hears
   * the difference between a good move and a wasted one before reading the HUD.
   */
  playMove({ palette, fromMask, toMask, size = 1, pigment }) {
    if (!this.ensure()) return;
    const base = this.mixNote(palette, fromMask);
    const next = this.mixNote(palette, toMask);
    const weight = Math.min(1, 0.32 + Math.log2(1 + size) * 0.16);
    const dur = 0.28 + Math.min(0.5, size * 0.03);

    this._tone({ note: base, duration: dur * 0.9, gain: 0.20 * weight, type: 'triangle' });
    if (next !== base) {
      // interval between where the region was and where it now is
      this._tone({ note: next, when: 0.012, duration: dur, gain: 0.17 * weight, type: 'sine', detune: 4 });
    }
    if (pigment !== undefined) {
      this._tone({ note: this.pigmentNote(pigment, 1), when: 0.006, duration: 0.22, gain: 0.09, type: 'sine' });
    }
    this._noise({ duration: 0.09, gain: 0.05 * weight, freq: 900 + size * 30, q: 1.1 });
  }

  /** A refused move: a dull thud, not an alarm. Being told "no" should not sting. */
  playReject() {
    if (!this.ensure()) return;
    this._tone({ note: ROOT_MIDI - 7, duration: 0.14, gain: 0.13, type: 'sine' });
    this._noise({ duration: 0.07, gain: 0.05, freq: 320, q: 0.6, type: 'lowpass' });
  }

  /** Selecting a pigment: its own note, quietly. */
  playSelect(pigmentIndex) {
    if (!this.ensure()) return;
    this._tone({ note: this.pigmentNote(pigmentIndex, 1), duration: 0.16, gain: 0.11, type: 'sine', send: 0.2 });
  }

  playUndo() {
    if (!this.ensure()) return;
    this._tone({ note: ROOT_MIDI + 5, duration: 0.2, gain: 0.12, type: 'sine' });
    this._tone({ note: ROOT_MIDI, when: 0.05, duration: 0.24, gain: 0.10, type: 'sine' });
  }

  /** Board settled: a rising pentatonic arpeggio, length scaled to the effort. */
  playSettled({ moves = 8, par = 8 } = {}) {
    if (!this.ensure()) return;
    const tight = moves <= par;
    const notes = tight ? [0, 2, 4, 7, 9, 12, 16] : [0, 4, 7, 12, 16];
    notes.forEach((deg, i) => {
      this._tone({
        note: ROOT_MIDI + 12 + deg,
        when: i * 0.075,
        duration: 0.7 - i * 0.03,
        gain: 0.17,
        type: 'triangle',
        send: 0.55,
      });
    });
    this._noise({ duration: 0.5, gain: 0.06, freq: 3200, q: 0.5, type: 'highpass' });
  }

  /** Out of moves: a descending minor figure. Not a buzzer. */
  playFailed() {
    if (!this.ensure()) return;
    [0, -3, -7].forEach((semi, i) => {
      this._tone({ note: ROOT_MIDI + semi, when: i * 0.11, duration: 0.5, gain: 0.15, type: 'sine', send: 0.4 });
    });
  }

  playUi(kind = 'tap') {
    if (!this.ensure()) return;
    if (kind === 'tap') this._tone({ note: ROOT_MIDI + 19, duration: 0.09, gain: 0.07, type: 'sine', send: 0.15 });
    else if (kind === 'open') this._tone({ note: ROOT_MIDI + 12, duration: 0.2, gain: 0.09, type: 'triangle', send: 0.3 });
    else if (kind === 'close') this._tone({ note: ROOT_MIDI + 7, duration: 0.18, gain: 0.08, type: 'triangle', send: 0.3 });
    else this._tone({ note: ROOT_MIDI + 14, duration: 0.12, gain: 0.08, type: 'sine' });
  }

  // -------------------------------------------------------------------------
  // music
  // -------------------------------------------------------------------------

  /**
   * A generative bed: a slow chord pad plus a sparse pentatonic melody.
   *
   * Each theme gets a mode and a tempo, so the albums do not all sound like the
   * same loop transposed. The melody is scheduled a couple of bars ahead from a
   * timer rather than being a fixed loop, so it never repeats exactly.
   */
  startMusic(themeId) {
    if (!this.ensure()) return;
    this.stopMusic();
    const modes = {
      studio: { degrees: [0, 2, 4, 7, 9], tempo: 66, brightness: 0.5 },
      paper: { degrees: [0, 2, 3, 7, 8], tempo: 58, brightness: 0.35 },
      garden: { degrees: [0, 2, 4, 5, 9], tempo: 62, brightness: 0.45 },
      quarry: { degrees: [0, 3, 5, 7, 10], tempo: 48, brightness: 0.25 },
      tide: { degrees: [0, 2, 5, 7, 9], tempo: 70, brightness: 0.55 },
      ink: { degrees: [0, 1, 5, 7, 8], tempo: 44, brightness: 0.2 },
    };
    const mode = modes[themeId] ?? modes.studio;
    this._theme = themeId;
    this._music = { mode, next: this.ctx.currentTime + 0.4, bar: 0 };
    this._scheduler = setInterval(() => this._tickMusic(), 220);
  }

  _tickMusic() {
    const ctx = this.ctx;
    if (!ctx || !this._music || this.muted) return;
    const { mode } = this._music;
    const beat = 60 / mode.tempo;
    // Schedule two bars ahead so a tab that throttles timers still sounds even.
    while (this._music.next < ctx.currentTime + beat * 8) {
      const t = this._music.next;
      const bar = this._music.bar;

      // pad: a two-note drone, re-struck each bar
      if (bar % 4 === 0) {
        const root = ROOT_MIDI - 12 + (bar % 8 === 4 ? 5 : 0);
        this._pad(root, t, beat * 4.4);
        this._pad(root + mode.degrees[2], t, beat * 4.4, 0.7);
      }

      // melody: one or two notes per bar, from the mode
      const deg = mode.degrees[Math.floor(Math.random() * mode.degrees.length)];
      const octave = Math.random() < 0.28 ? 24 : 12;
      this._musicNote(ROOT_MIDI + deg + octave, t + beat * (Math.random() < 0.5 ? 0 : 2), beat * 1.6, mode.brightness);
      if (Math.random() < 0.35) {
        const deg2 = mode.degrees[Math.floor(Math.random() * mode.degrees.length)];
        this._musicNote(ROOT_MIDI + deg2 + octave, t + beat * 3, beat * 1.2, mode.brightness * 0.8);
      }

      this._music.next += beat * 4;
      this._music.bar++;
    }
  }

  _pad(note, when, duration, gainMul = 1) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.value = midiToHz(note);
    osc.detune.value = (Math.random() - 0.5) * 12;
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    filter.Q.value = 0.6;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(0.055 * gainMul, when + duration * 0.35);
    g.gain.linearRampToValueAtTime(0.0001, when + duration);
    osc.connect(filter);
    filter.connect(g);
    g.connect(this.musicBus);
    const s = ctx.createGain();
    s.gain.value = 0.5;
    g.connect(s);
    s.connect(this.space);
    osc.start(when);
    osc.stop(when + duration + 0.1);
  }

  _musicNote(note, when, duration, brightness = 0.4) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = midiToHz(note);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(0.05 + brightness * 0.05, when + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(g);
    g.connect(this.musicBus);
    const s = ctx.createGain();
    s.gain.value = 0.75;
    g.connect(s);
    s.connect(this.space);
    osc.start(when);
    osc.stop(when + duration + 0.1);
  }

  stopMusic() {
    if (this._scheduler) clearInterval(this._scheduler);
    this._scheduler = null;
    this._music = null;
  }

  /** Duck the music while a board is being solved, to leave room for the notes. */
  duckMusic(amount = 0.5, time = 0.4) {
    if (!this.musicBus || !this.ctx) return;
    const target = this.muted ? 0 : this.musicVolume * 0.5 * amount;
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.linearRampToValueAtTime(target, this.ctx.currentTime + time);
  }

  unduckMusic(time = 0.8) {
    if (!this.musicBus || !this.ctx) return;
    const target = this.muted ? 0 : this.musicVolume * 0.5;
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.linearRampToValueAtTime(target, this.ctx.currentTime + time);
  }
}
