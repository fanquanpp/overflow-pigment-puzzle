/**
 * Save data.
 *
 * Everything lives in one localStorage key, versioned, and every read is defensive:
 * a corrupt or half-written save must degrade to "no progress" rather than to a
 * crash on boot. Settings and progress are in the same record because they are
 * written by the same screen and there is no reason for two keys to disagree about
 * when they were last touched.
 */

const KEY = 'overflow.save.v1';
const VERSION = 1;

export const DEFAULT_SETTINGS = {
  locale: 'auto',
  music: 0.40,
  sfx: 0.70,
  patterns: false,
  reducedMotion: false,
  quality: 'high',
  muted: false,
};

function blank() {
  return {
    version: VERSION,
    settings: { ...DEFAULT_SETTINGS },
    /** levelId → { moves, settled, attempts, best } */
    levels: {},
    /** albumId → highest chapter index unlocked */
    unlocked: {},
    lastLevel: null,
    totalMoves: 0,
    settledCount: 0,
  };
}

/** Coerce anything into a valid settings object. */
function sanitizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  if (['auto', 'en', 'zh'].includes(raw.locale)) out.locale = raw.locale;
  if (['high', 'medium', 'low'].includes(raw.quality)) out.quality = raw.quality;
  for (const k of ['music', 'sfx']) {
    if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) {
      out[k] = Math.min(1, Math.max(0, raw[k]));
    }
  }
  for (const k of ['patterns', 'reducedMotion', 'muted']) {
    if (typeof raw[k] === 'boolean') out[k] = raw[k];
  }
  return out;
}

function sanitizeLevels(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, rec] of Object.entries(raw)) {
    if (!rec || typeof rec !== 'object') continue;
    out[id] = {
      settled: rec.settled === true,
      moves: Number.isFinite(rec.moves) ? rec.moves : null,
      best: Number.isFinite(rec.best) ? rec.best : null,
      attempts: Number.isFinite(rec.attempts) ? rec.attempts : 0,
    };
  }
  return out;
}

export function load() {
  if (typeof localStorage === 'undefined') return blank();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== VERSION) return blank();
    return {
      version: VERSION,
      settings: sanitizeSettings(parsed.settings),
      levels: sanitizeLevels(parsed.levels),
      unlocked: parsed.unlocked && typeof parsed.unlocked === 'object' ? parsed.unlocked : {},
      lastLevel: typeof parsed.lastLevel === 'string' ? parsed.lastLevel : null,
      totalMoves: Number.isFinite(parsed.totalMoves) ? parsed.totalMoves : 0,
      settledCount: Number.isFinite(parsed.settledCount) ? parsed.settledCount : 0,
    };
  } catch {
    // A save that cannot be parsed is a save that should not exist. Start over
    // rather than letting a boot fail on someone's stale data.
    return blank();
  }
}

export function save(state) {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false; // quota, private mode — not worth surfacing
  }
}

export function clear() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** A tiny wrapper that owns the record and writes on change. */
export function createStore() {
  let state = load();
  const listeners = new Set();
  let pending = null;

  const flush = () => {
    pending = null;
    save(state);
  };

  const changed = (what) => {
    for (const fn of listeners) fn(state, what);
    // Coalesce writes: a settings slider fires on every input event.
    if (pending) clearTimeout(pending);
    pending = setTimeout(flush, 180);
  };

  return {
    get state() { return state; },
    get settings() { return state.settings; },

    setSetting(key, value) {
      state.settings = sanitizeSettings({ ...state.settings, [key]: value });
      changed(`setting:${key}`);
      return state.settings[key];
    },

    /** Record the outcome of a board. Returns what changed, for the result card. */
    record(levelId, { settled, moves }) {
      const rec = state.levels[levelId] ?? { settled: false, moves: null, best: null, attempts: 0 };
      const before = { ...rec };
      rec.attempts += 1;
      if (settled) {
        rec.settled = true;
        rec.moves = moves;
        if (rec.best === null || moves < rec.best) rec.best = moves;
        if (!before.settled) state.settledCount += 1;
        state.totalMoves += moves;
      }
      state.levels[levelId] = rec;
      state.lastLevel = levelId;
      changed('level');
      return { first: !before.settled && settled, improved: rec.best !== before.best, record: rec };
    },

    level(levelId) {
      return state.levels[levelId] ?? { settled: false, moves: null, best: null, attempts: 0 };
    },

    isSettled(levelId) { return state.levels[levelId]?.settled === true; },

    /** How many of an album's boards are settled. */
    albumProgress(album) {
      let done = 0;
      for (const l of album.levels) if (state.levels[l.id]?.settled) done++;
      return done;
    },

    /** A board is unlocked when the previous one in its album is settled. */
    isUnlocked(album, index) {
      if (index === 0) return true;
      return state.levels[album.levels[index - 1].id]?.settled === true;
    },

    /** The first unsettled, unlocked board — where "Continue" goes. */
    nextBoard(albums) {
      for (const album of albums) {
        for (let i = 0; i < album.levels.length; i++) {
          if (!state.levels[album.levels[i].id]?.settled) {
            return { album, index: i, level: album.levels[i] };
          }
        }
      }
      return null;
    },

    reset() {
      state = blank();
      changed('reset');
      flush();
    },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    flush,
  };
}
