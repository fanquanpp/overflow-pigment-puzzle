/**
 * Pointer and keyboard input.
 *
 * The pointer handling exists mainly to tell a *click* from a *drag*. The camera
 * parallax follows the pointer, so without a threshold every click would also nudge
 * the camera — and on a touch device a tap would be indistinguishable from the
 * start of a pan. So a press records where it started and only counts as a click if
 * it is released within `CLICK_SLOP` pixels and `CLICK_TIME` milliseconds.
 *
 * Keyboard input is exposed as a set of named actions rather than raw key codes, so
 * the bindings live in one place and the game logic never sees a `KeyboardEvent`.
 */

const CLICK_SLOP = 8; // px
const CLICK_TIME = 700; // ms

const KEY_ACTIONS = {
  '1': 'pigment:0', '2': 'pigment:1', '3': 'pigment:2', '4': 'pigment:3', '5': 'pigment:4',
  z: 'undo', Z: 'undo',
  r: 'reset', R: 'reset',
  h: 'hint', H: 'hint',
  escape: 'pause', Escape: 'pause',
  Enter: 'confirm', ' ': 'confirm',
  ArrowLeft: 'nav:prev', ArrowRight: 'nav:next',
};

export function createInput(target, { onAction, onPointer, onHover } = {}) {
  const listeners = [];
  let down = null;
  let pointer = { x: 0, y: 0, nx: 0, ny: 0 };
  let lastHoverAt = 0;

  const add = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    listeners.push(() => el.removeEventListener(type, fn, opts));
  };

  const localPoint = (ev) => {
    const rect = target.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    return { x, y, nx: (x / rect.width) * 2 - 1, ny: -((y / rect.height) * 2 - 1) };
  };

  add(target, 'pointerdown', (ev) => {
    if (ev.button !== undefined && ev.button !== 0 && ev.pointerType === 'mouse') return;
    const p = localPoint(ev);
    down = { ...p, t: performance.now(), id: ev.pointerId };
    target.setPointerCapture?.(ev.pointerId);
  });

  add(target, 'pointermove', (ev) => {
    const p = localPoint(ev);
    pointer = p;
    onPointer?.(p);
    const now = performance.now();
    // Hover drives the region highlight, which is a raycast — throttle it so a
    // fast mouse does not queue up more picks than the frame can draw.
    if (now - lastHoverAt > 40) {
      lastHoverAt = now;
      onHover?.(p);
    }
  });

  add(target, 'pointerup', (ev) => {
    if (!down) return;
    const p = localPoint(ev);
    const dt = performance.now() - down.t;
    const moved = Math.hypot(p.x - down.x, p.y - down.y);
    const wasDown = down;
    down = null;
    if (wasDown.id !== ev.pointerId) return;
    if (moved <= CLICK_SLOP && dt <= CLICK_TIME) {
      onAction?.('tap', { ...p, pointerType: ev.pointerType });
    }
  });

  add(target, 'pointercancel', () => { down = null; });
  add(target, 'contextmenu', (ev) => ev.preventDefault());

  add(window, 'keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const tag = ev.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || ev.target?.isContentEditable) return;
    const action = KEY_ACTIONS[ev.key] ?? KEY_ACTIONS[ev.key.toLowerCase?.()];
    if (!action) return;
    // Space would otherwise scroll the page, and the arrow keys would move focus.
    if (ev.key === ' ' || ev.key.startsWith('Arrow')) ev.preventDefault();
    onAction?.(action);
  });

  return {
    get pointer() { return pointer; },
    /** True while a button is held — used to hand the gesture to the orbit controls. */
    get pointerDown() { return down !== null; },
    /** True while a press is in progress — used to suppress parallax mid-drag. */
    get dragging() {
      return down !== null && Math.hypot(pointer.x - down.x, pointer.y - down.y) > CLICK_SLOP;
    },
    dispose() { for (const off of listeners) off(); listeners.length = 0; },
  };
}
