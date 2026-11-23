/**
 * The − A + buttons: make the names on the graph smaller or bigger, or put
 * them back to normal (A). Like HANSEL's text size control.
 *
 * The size is a scale factor on the graph's label font (draw.js), stepped
 * through LABEL_SCALES and remembered in localStorage. Every copy of the
 * control on the page (sidebar header, phone header) stays in step.
 *
 * Tested in tests/js/font-size.test.mjs (jsdom).
 */

/** The sizes the buttons step through; 1 is normal. */
export const LABEL_SCALES = [0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
export const LABEL_SCALE_KEY = 'panditya-label-scale';

/** Nearest allowed step to `value` (anything not a positive number is 1). */
export function nearestScale(value) {
  const n = Number(value);
  if (!(n > 0)) return 1;
  return LABEL_SCALES.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), 1);
}

/**
 * Build the buttons into each of `roots` and wire them up.
 * @param {object} options
 * @param {HTMLElement[]} options.roots   empty containers, one per copy of the control
 * @param {Storage} [options.storage]
 * @param {(scale: number) => void} options.onChange  also called once at start
 * @returns {{get: () => number, set: (scale: number) => void}}
 */
export function setUpFontSize({ roots, storage, onChange }) {
  let scale = 1;
  try {
    scale = nearestScale(storage?.getItem(LABEL_SCALE_KEY) ?? 1);
  } catch {
    // Storage blocked: start at normal size.
  }

  const buttons = [];
  for (const root of roots.filter(Boolean)) {
    const doc = root.ownerDocument;
    root.classList.add('font-size-control');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Size of names on the graph');
    for (const [action, text, title] of [
      ['down', '−', 'Smaller names on the graph'],
      ['reset', 'A', 'Normal size names'],
      ['up', '+', 'Bigger names on the graph'],
    ]) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.dataset.font = action;
      b.textContent = text;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', () => step(action));
      root.append(b);
      buttons.push(b);
    }
  }

  function render() {
    const i = LABEL_SCALES.indexOf(scale);
    for (const b of buttons) {
      if (b.dataset.font === 'down') b.disabled = i === 0;
      else if (b.dataset.font === 'up') b.disabled = i === LABEL_SCALES.length - 1;
      else b.setAttribute('aria-pressed', String(scale === 1)); // A shows when at normal
    }
  }

  function set(next) {
    scale = nearestScale(next);
    try {
      if (scale === 1) storage?.removeItem(LABEL_SCALE_KEY);
      else storage?.setItem(LABEL_SCALE_KEY, String(scale));
    } catch {
      // Not remembered; fine for this visit.
    }
    render();
    onChange(scale);
  }

  function step(action) {
    const i = LABEL_SCALES.indexOf(scale);
    if (action === 'reset') set(1);
    else if (action === 'down') set(LABEL_SCALES[Math.max(0, i - 1)]);
    else set(LABEL_SCALES[Math.min(LABEL_SCALES.length - 1, i + 1)]);
  }

  render();
  onChange(scale);
  return { get: () => scale, set };
}
