/**
 * Lets the user drag the sidebar wider or narrower, and remembers the width.
 *
 * The handle is a thin vertical bar between the graph and the sidebar
 * (role="separator"). Drag it with the mouse or a finger; with the keyboard,
 * focus it and use ←/→ (Shift for bigger steps), Home/End for the narrowest
 * and widest; double-click it to go back to the default width.
 *
 * The width is set as the --sidebar-width CSS variable on the layout element
 * (app.css reads it), and kept in localStorage. On narrow screens the sidebar
 * is full width above the graph and the handle is hidden by CSS.
 *
 * Tested in tests/js/sidebar-resize.test.mjs (jsdom).
 */

export const SIDEBAR_DEFAULT_WIDTH = 320;
export const SIDEBAR_MIN_WIDTH = 240;
/** The sidebar may take at most this share of the layout's width. */
export const SIDEBAR_MAX_FRACTION = 0.6;
export const SIDEBAR_STORAGE_KEY = 'panditya-sidebar-width';
const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;

/**
 * Keep `width` between the minimum and the largest share of `layoutWidth`
 * (the minimum wins if the layout is very narrow). Returns a whole number.
 */
export function clampWidth(width, layoutWidth) {
  const max = Math.max(SIDEBAR_MIN_WIDTH, Math.floor(layoutWidth * SIDEBAR_MAX_FRACTION));
  // Infinity means "as wide as allowed"; anything not a number means the default.
  const n = typeof width === 'number' && !Number.isNaN(width) ? width : SIDEBAR_DEFAULT_WIDTH;
  return Math.round(Math.min(max, Math.max(SIDEBAR_MIN_WIDTH, n)));
}

/** Read a localStorage value without throwing (private windows, blocked storage). */
function safeGet(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage, key, value) {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Not saved; the width still applies for this visit.
  }
}

/**
 * Wire up the handle.
 * @param {object} options
 * @param {HTMLElement} options.handle     the separator element
 * @param {HTMLElement} options.layout     the flex container holding graph and sidebar
 * @param {Storage} [options.storage]      where the width is remembered
 * @param {(width: number) => void} [options.onResize]
 * @returns {{setWidth: (w: number, opts?: {save?: boolean}) => number, getWidth: () => number, reset: () => void}}
 */
export function setUpSidebarResizer({ handle, layout, storage, onResize = () => {} }) {
  let width = SIDEBAR_DEFAULT_WIDTH;
  const layoutWidth = () => layout.getBoundingClientRect().width || layout.clientWidth || 0;

  function setWidth(next, { save = true } = {}) {
    const total = layoutWidth();
    // Before layout (width 0) there is nothing to clamp against: keep the request
    // within the minimum and leave the rest to CSS (max-width).
    width = total ? clampWidth(next, total)
      : Number.isFinite(next) ? Math.round(Math.max(SIDEBAR_MIN_WIDTH, next)) : SIDEBAR_DEFAULT_WIDTH;
    layout.style.setProperty('--sidebar-width', `${width}px`);
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuemin', String(SIDEBAR_MIN_WIDTH));
    if (total) handle.setAttribute('aria-valuemax', String(clampWidth(Infinity, total)));
    if (save) safeSet(storage, SIDEBAR_STORAGE_KEY, String(width));
    onResize(width);
    return width;
  }

  function reset() {
    setWidth(SIDEBAR_DEFAULT_WIDTH, { save: false });
    safeSet(storage, SIDEBAR_STORAGE_KEY, null);
  }

  // Start from the remembered width, if any.
  const saved = Number(safeGet(storage, SIDEBAR_STORAGE_KEY));
  setWidth(saved > 0 ? saved : SIDEBAR_DEFAULT_WIDTH, { save: false });

  // Dragging. The sidebar is on the right, so its width is the distance from
  // the pointer to the layout's right edge.
  let dragging = false;
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    handle.setPointerCapture?.(e.pointerId);
    handle.classList.add('dragging');
    layout.classList.add('resizing-sidebar'); // stops text selection while dragging
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const right = layout.getBoundingClientRect().right;
    setWidth(right - e.clientX, { save: false });
  });
  const stop = e => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture?.(e.pointerId);
    handle.classList.remove('dragging');
    layout.classList.remove('resizing-sidebar');
    safeSet(storage, SIDEBAR_STORAGE_KEY, String(width));
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);

  handle.addEventListener('dblclick', () => reset());

  // Keyboard: ← makes the sidebar wider (the handle moves left), → narrower.
  handle.addEventListener('keydown', e => {
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    let next = null;
    if (e.key === 'ArrowLeft') next = width + step;
    else if (e.key === 'ArrowRight') next = width - step;
    else if (e.key === 'Home') next = SIDEBAR_MIN_WIDTH;
    else if (e.key === 'End') next = Infinity;
    if (next === null) return;
    e.preventDefault();
    setWidth(next);
  });

  return { setWidth, getWidth: () => width, reset };
}
