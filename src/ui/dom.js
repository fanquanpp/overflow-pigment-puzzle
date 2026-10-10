/**
 * Tiny DOM helpers.
 *
 * Not a framework. There are about eight screens, they are built once and updated
 * by hand, and a framework would cost more than it saves. What these do buy is that
 * text is always inserted as text — the level data and the i18n tables both flow
 * through here, and using `innerHTML` for either would be one string away from
 * injecting markup into the page.
 */

/** Create an element. `attrs` handles classes, dataset, aria-*, and listeners. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class' || k === 'className') node.className = v;
    else if (k === 'text') node.textContent = String(v);
    else if (k === 'html') node.innerHTML = v; // only ever used with authored markup
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    // Event names are lower-case in the DOM, so `onClick` has to become 'click'.
    // Slicing the attribute name alone yields 'Click', which addEventListener
    // accepts silently and never fires — every handler in this interface was
    // attached that way and none of them ran. Nothing caught it because the tests
    // drove the game through its API rather than through the UI.
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') node[k] = Boolean(v);
    else node.setAttribute(k, String(v));
  }
  append(node, children);
  return node;
}

export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' || typeof child === 'number'
      ? document.createTextNode(String(child))
      : child);
  }
  return parent;
}

/**
 * Render `**emphasis**` inside a translated string as <strong>.
 *
 * Built by splitting the string and creating text nodes, never by assigning
 * innerHTML: the level data and the i18n tables both flow through here, and one
 * `innerHTML` is all it takes for a stray angle bracket in a translation to become
 * markup. Splitting on a two-character marker cannot do that.
 */
export function richText(text) {
  const parts = String(text ?? '').split(/\*\*(.+?)\*\*/g);
  const nodes = [];
  parts.forEach((part, i) => {
    if (!part) return;
    nodes.push(i % 2 === 1 ? el('strong', {}, part) : document.createTextNode(part));
  });
  return nodes;
}

/** Replace a node's children. */
export function fill(parent, children) {
  parent.textContent = '';
  append(parent, children);
  return parent;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** A button. Keyboard-activatable for free, because it is a real <button>. */
export function button(label, attrs = {}, children = []) {
  return el('button', { type: 'button', class: 'btn', ...attrs }, [label, ...children]);
}

/** An inline SVG from a path string, sized to the current font. */
export function icon(path, { size = 16, fill = 'none', stroke = 'currentColor', width = 1.8 } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', fill);
  svg.setAttribute('stroke', stroke);
  svg.setAttribute('stroke-width', width);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

export const ICONS = {
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  reset: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  bulb: 'M9 18h6M10 22h4M12 2a6 6 0 0 0-3.5 10.9V15h7v-2.1A6 6 0 0 0 12 2Z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 18l-6-6 6-6',
  forward: 'M9 6l6 6-6 6',
  target: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  play: 'M7 4l12 8-12 8z',
  pause: 'M8 5v14M16 5v14',
  sound: 'M11 5 6 9H3v6h3l5 4zM16 9a4 4 0 0 1 0 6',
  muted: 'M11 5 6 9H3v6h3l5 4zM16 9l4 6M20 9l-4 6',
  lock: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z',
  check: 'M4 12l5 5L20 6',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 12h2M19 12h2M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4',
  flask: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3M7.5 14h9',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8h.01M11 12h1v5h1',
};

/** Format a number with the locale's grouping. */
export const num = (n) => Number(n).toLocaleString();

/** A pill. */
export const pill = (label, { on = false } = {}) => el('span', { class: `pill${on ? ' on' : ''}` }, label);

/**
 * A segmented control. Returns the element; `onChange` gets the value.
 * Buttons carry `aria-pressed` so a screen reader announces the selection.
 */
export function segmented(options, value, onChange) {
  const wrap = el('div', { class: 'seg', role: 'group' });
  const buttons = options.map((opt) => {
    const b = el('button', {
      type: 'button',
      'aria-pressed': String(opt.value === value),
      onClick: () => {
        for (const other of buttons) other.setAttribute('aria-pressed', String(other === b));
        onChange(opt.value);
      },
    }, opt.label);
    return b;
  });
  append(wrap, buttons);
  return wrap;
}

/** A switch. */
export function toggle(checked, onChange, label) {
  const node = el('button', {
    type: 'button',
    class: 'switch',
    role: 'switch',
    'aria-checked': String(Boolean(checked)),
    'aria-label': label,
    onClick: () => {
      const next = node.getAttribute('aria-checked') !== 'true';
      node.setAttribute('aria-checked', String(next));
      onChange(next);
    },
  });
  return node;
}

/** A slider with a label and a live value. */
export function slider(value, onChange, { min = 0, max = 1, step = 0.05, label } = {}) {
  const out = el('span', { class: 'chip-count' }, `${Math.round(value * 100)}%`);
  const input = el('input', {
    type: 'range',
    min, max, step, value,
    'aria-label': label,
    style: { width: '132px', accentColor: 'var(--accent)' },
    onInput: (ev) => {
      const v = Number(ev.target.value);
      out.textContent = `${Math.round(v * 100)}%`;
      onChange(v);
    },
  });
  return el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [input, out]);
}

/** A row in a settings list. */
export const row = (label, help, control) => el('div', { class: 'row' }, [
  el('div', { class: 'label' }, [
    el('span', {}, label),
    help ? el('small', {}, help) : null,
  ]),
  control,
]);
