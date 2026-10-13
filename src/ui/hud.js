/**
 * Heads-up display.
 *
 * A rule line across the top carrying the board's data as a row of labelled cells,
 * and a row of numbered ink patches across the bottom. The board keeps the middle
 * of the screen to itself.
 *
 * The palette row is the part worth explaining. Each pigment is a printed patch
 * with its **index number**, a glyph for the colour-blind layer, and a count of
 * **how many tiles still need it** — not how many hold it. That count is the
 * puzzle's remaining work: it falls as the board is solved, it is zero for a
 * pigment the goal does not use (so the patch dims and stops being a legal choice),
 * and it shows at a glance which pigment is the bottleneck. A count of how much of
 * each pigment is on the board would look similar and mean nothing.
 *
 * A row of numbered patches is what a printer's swatch book looks like, which is a
 * happy accident: the clearest arrangement of five choices happens to be the one
 * this visual language already uses.
 */

import { el, fill, button, icon, ICONS } from './dom.js';
import { t, pick } from '../core/i18n.js';
import { linearToCss } from '../color/color.js';

export class Hud {
  constructor(root, { onAction } = {}) {
    this.root = root;
    this.onAction = onAction ?? (() => {});
    this.chips = new Map();
    this.lastState = null;
    this.lastHintPersistent = false;

    // --- top rule line ----------------------------------------------------
    this.albumLabel = el('p', { class: 'hud-album' }, '');
    this.levelLabel = el('p', { class: 'hud-level' }, '');

    this.movesValue = el('div', { class: 'hud-moves' }, '—');
    this.progressBar = el('i');
    this.progressTrack = el('div', { class: 'hud-track' }, [this.progressBar]);
    this.progressPct = el('span', { class: 'hud-pct' }, '0%');

    this.goalSwatch = el('span', { class: 'goal-sw' });
    this.goalLabel = el('span', { class: 'lbl ink' }, '');

    // What is armed. The dock shows it too, but the dock is at the bottom edge and
    // the board is in the middle; a choice you cannot see while you are choosing is
    // a choice you will forget you made.
    this.armedSwatch = el('span', { class: 'sw empty' });
    this.armedName = el('span', { class: 'nm dim' }, t('hud.none'));
    this.armedWrap = el('div', { class: 'armed' }, [this.armedSwatch, this.armedName]);

    this.undoBtn = button(icon(ICONS.undo), {
      class: 'btn icon ghost', title: `${t('hud.undo')} (Z)`, 'aria-label': t('hud.undo'),
      onClick: () => this.onAction('undo'),
    });
    this.resetBtn = button(icon(ICONS.reset), {
      class: 'btn icon ghost', title: `${t('hud.reset')} (R)`, 'aria-label': t('hud.reset'),
      onClick: () => this.onAction('reset'),
    });
    this.recentreBtn = button(icon(ICONS.target), {
      class: 'btn icon ghost', title: `${t('hud.recentre')} (F)`, 'aria-label': t('hud.recentre'),
      onClick: () => this.onAction('recentre'),
    });
    this.hintBtn = button(icon(ICONS.bulb), {
      class: 'btn icon ghost', title: `${t('hud.hint')} (H)`, 'aria-label': t('hud.hint'),
      onClick: () => this.onAction('hint'),
    });
    this.pauseBtn = button(icon(ICONS.menu), {
      class: 'btn icon ghost', title: `${t('hud.pause')} (Esc)`, 'aria-label': t('hud.pause'),
      onClick: () => this.onAction('pause'),
    });

    this.top = el('div', { class: 'hud-top' }, [
      el('div', { class: 'hud-bar' }, [
        el('div', { class: 'hud-cell grow' }, [this.albumLabel, this.levelLabel]),
        el('div', { class: 'hud-cell' }, [
          el('p', { class: 'lbl' }, t('hud.moves')),
          this.movesValue,
        ]),
        el('div', { class: 'hud-cell' }, [
          el('p', { class: 'lbl' }, t('hud.done')),
          el('div', { class: 'hud-progress' }, [this.progressTrack, this.progressPct]),
        ]),
        el('div', { class: 'hud-cell' }, [
          el('p', { class: 'lbl' }, t('hud.selected')),
          this.armedWrap,
        ]),
        el('div', { class: 'hud-cell' }, [
          el('p', { class: 'lbl' }, t('hud.target')),
          el('div', { class: 'hud-goal' }, [this.goalSwatch, this.goalLabel]),
        ]),
        el('div', { class: 'hud-cell right', style: { padding: '0' } }, [
          el('div', { class: 'hud-actions' }, [this.undoBtn, this.resetBtn, this.recentreBtn, this.hintBtn, this.pauseBtn]),
        ]),
      ]),
    ]);

    // --- bottom rule line + palette ---------------------------------------
    this.hintLine = el('div', { class: 'dock-hint' }, '');
    this.mixPreview = el('div', { class: 'mix-preview' });
    this.dock = el('div', { class: 'dock' });

    this.bottom = el('div', { class: 'hud-bottom' }, [
      el('div', { class: 'dock-strip' }, [this.hintLine, this.mixPreview]),
      this.dock,
    ]);
    this.toasts = el('div', { class: 'toasts' });

    fill(root, [this.top, this.bottom, this.toasts]);
  }

  setLevel(level, album, rules, palette) {
    this.level = level;
    this.album = album;
    this.rules = rules;
    this.palette = palette;

    this.albumLabel.textContent = pick(album ?? {}, 'name').toUpperCase();
    this.levelLabel.textContent = level.chapter != null
      ? `${String(level.chapter + 1).padStart(2, '0')} · ${pick(level, 'name')}`
      : pick(level, 'name');
    this._buildDock(rules, palette);

    const goalMask = level.goal === 'recipe' ? rules.goalMask : level.target;
    const entry = palette.entries[goalMask] ?? palette.entries[0];
    this.goalSwatch.style.background = linearToCss(entry.linear);
    this.goalSwatch.textContent = level.goal === 'recipe' ? '✦' : entry.glyph;
    this.goalLabel.textContent = level.goal === 'recipe' ? t('badge.recipe') : t('hud.goalUnify');
    this.goalSwatch.title = level.goal === 'recipe' ? t('hud.goalRecipe') : entry.name;

    // The dock was just rebuilt, so its counts are back to zero. Re-apply the last
    // state we were given, or the "how many tiles still need this" numbers would sit
    // at zero until the player's first move — which is exactly the number they are
    // supposed to read *before* choosing a move.
    if (this.lastState) this.setState(this.lastState);
  }

  _buildDock(rules, palette) {
    this.chips.clear();
    const chips = [];
    for (let p = 0; p < rules.pigmentCount; p++) {
      const pigment = palette.pigments[p];
      const usable = rules.available.includes(p);
      const entry = palette.entries[1 << p];
      const swatch = el('div', {
        class: 'chip-swatch',
        style: { background: linearToCss(entry.linear) },
      }, entry.glyph);
      const count = el('span', { class: 'chip-count' }, '0');
      const chip = el('button', {
        type: 'button',
        class: 'chip',
        'aria-pressed': 'false',
        'aria-label': `${pigment.name} / ${pigment.nameZh}`,
        disabled: !usable,
        title: usable ? `${pigment.name} · ${pigment.nameZh}` : t('dock.notNeeded'),
        onClick: () => this.onAction('pigment', p),
      }, [
        swatch,
        el('div', { class: 'chip-body' }, [
          el('span', { class: 'chip-no' }, String(p + 1)),
          el('span', { class: 'chip-name' }, pigment.nameZh),
          count,
        ]),
      ]);
      this.chips.set(p, { chip, count });
      chips.push(chip);
    }
    fill(this.dock, chips);
  }

  /** Update everything that changes on a move. */
  setState({ session, need, selected, progress, remaining, finished, rules, palette }) {
    // The palette and the rules arrive with the event, so this is safe to call
    // before setLevel has ever run — which is the case on the first frame.
    if (palette) this.palette = palette;
    if (rules) this.rules = rules;
    const active = rules ?? this.rules;
    this.lastState = { session, need, selected, progress, remaining, finished, rules: active };

    this.movesValue.textContent = String(Math.max(0, remaining));
    this.movesValue.className = `hud-moves${remaining <= 0 ? ' none' : remaining <= 2 ? ' low' : ''}`;

    const pct = Math.round(progress.ratio * 100);
    this.progressPct.textContent = `${pct}%`;
    this.progressBar.style.width = `${pct}%`;

    if (!active) return;
    for (const [p, entry] of this.chips) {
      const n = need[p] ?? 0;
      entry.count.textContent = String(n);
      entry.chip.setAttribute('aria-pressed', String(selected === p));
      entry.chip.classList.toggle('hot', n > 0 && selected === p);
      entry.chip.disabled = !active.available.includes(p);
    }

    this.undoBtn.disabled = !(session.moves > 0 && !finished);
    this.hintBtn.disabled = Boolean(finished);

    // the armed readout
    if (selected === null || selected === undefined) {
      this.armedSwatch.className = 'sw empty';
      this.armedSwatch.style.background = '';
      this.armedSwatch.textContent = '';
      this.armedName.className = 'nm dim';
      this.armedName.textContent = t('hud.none');
    } else {
      const entry = this.palette.entries[1 << selected];
      this.armedSwatch.className = 'sw';
      this.armedSwatch.style.background = linearToCss(entry.linear);
      this.armedSwatch.textContent = entry.glyph;
      this.armedName.className = 'nm';
      this.armedName.textContent = this._pigmentName(selected);
    }

    // The idle hint has to agree with the armed readout. It was left stale by
    // setState: picking a pigment set the hint, then loading the next board cleared
    // the selection without clearing the sentence, so the bar read "未选" while the
    // hint still claimed a pigment was armed.
    if (!this.hovering) this._idleHint();
  }

  /** The sentence shown when nothing is hovered: what is armed, or what to do. */
  _idleHint() {
    const sel = this.lastState?.selected;
    this._setHint(
      sel === null || sel === undefined ? t('hud.pick') : t('dock.pick', { name: this._pigmentName(sel) }),
      '', false
    );
  }

  setHover({ cell, region, preview }) {
    this.hovering = cell >= 0 && Boolean(region?.length);
    if (!this.hovering) {
      this.mixPreview.textContent = '';
      this._idleHint();
      return;
    }

    if (preview) {
      fill(this.mixPreview, [
        el('span', { class: 'sw', style: { background: linearToCss(this.palette.entries[preview.from].linear) } }),
        el('span', { class: 'op' }, '+'),
        el('span', { class: 'sw', style: { background: linearToCss(this.palette.entries[1 << this.selected].linear) } }),
        el('span', { class: 'op' }, '→'),
        el('span', { class: 'sw', style: { background: linearToCss(preview.entry.linear) } }),
        el('span', {}, `${preview.entry.nameZh} · ${preview.size}`),
      ]);
      const regionLabel = region.length === 1
        ? t('dock.hoverRegionOne')
        : t('dock.hoverRegion', { n: region.length });
      if (preview.offGoal > 0) {
        this._setHint(`${regionLabel} · ${t('dock.offGoal', { n: preview.offGoal })}`, 'warn', true);
      } else {
        this._setHint(regionLabel, '', true);
      }
    } else {
      this.mixPreview.textContent = '';
      this._setHint(this.selected === null
        ? t('hud.pick')
        : (region.length === 1 ? t('dock.hoverRegionOne') : t('dock.hoverRegion', { n: region.length })), '', true);
    }
  }

  _pigmentName(p) {
    return this.palette?.pigments?.[p]?.nameZh ?? '';
  }

  _setHint(text, kind = '', persistent = false) {
    if (persistent) this.lastHintPersistent = true;
    this.hintLine.textContent = text;
    this.hintLine.className = `dock-hint${kind ? ` ${kind}` : ''}`;
    this.lastHintPersistent = persistent;
    clearTimeout(this._hintTimer);
    if (!persistent) {
      this._hintTimer = setTimeout(() => {
        this.lastHintPersistent = false;
        this._idleHint();
      }, 3000);
    }
  }

  hint(key, kind = '') {
    this._setHint(t(key), kind);
  }

  toast(message, kind = '', ms = 2400) {
    const node = el('div', { class: `toast ${kind}` }, message);
    this.toasts.appendChild(node);
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 220);
    }, ms);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
  }

  /**
   * A toast with an action — the practice room's "another board" affordance, and
   * anywhere else a small yes/no belongs without a modal over the board.
   */
  offer(message, onClick, ms = 6000) {
    const node = el('div', { class: 'toast offer' }, message);
    const btn = button(t('practice.againBtn'), { onClick: () => { node.remove(); onClick(); } });
    node.appendChild(btn);
    this.toasts.appendChild(node);
    setTimeout(() => {
      if (node.isConnected) {
        node.classList.add('out');
        setTimeout(() => node.remove(), 220);
      }
    }, ms);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
  }

  setVisible(v) {
    this.root.style.display = v ? 'flex' : 'none';
  }

  refreshLabels() {
    this.undoBtn.title = `${t('hud.undo')} (Z)`;
    this.resetBtn.title = `${t('hud.reset')} (R)`;
    this.hintBtn.title = `${t('hud.hint')} (H)`;
    this.recentreBtn.title = `${t('hud.recentre')} (F)`;
    this.pauseBtn.title = `${t('hud.pause')} (Esc)`;
    if (this.level && this.rules) this.setLevel(this.level, this.album, this.rules, this.palette);
  }

  setLevelRefs(level, album) {
    this.level = level;
    this.album = album;
  }
}
