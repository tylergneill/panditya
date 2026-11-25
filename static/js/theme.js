/**
 * Light/dark theme, shared by the graph page (app.js) and the info pages (info.js).
 *
 * The saved choice lives in localStorage under THEME_KEY. Each page's <head>
 * applies it before the first paint, so dark mode never flashes; this module
 * wires up the .dark-toggle buttons. Each button shows what it will do (moon in
 * light mode, sun in dark mode). CSS picks the icon from data-theme, and the
 * tooltip and screen-reader label are kept in step here.
 */

export const THEME_KEY = 'panditya-theme';

/** True when the page is currently in dark mode. */
export function isDark(doc = document) {
  return doc.documentElement.getAttribute('data-theme') === 'dark';
}

/** Give every .dark-toggle a title and aria-label naming what a click does. */
export function labelThemeButtons(doc = document) {
  const text = isDark(doc) ? 'Switch to light mode' : 'Switch to dark mode';
  doc.querySelectorAll('.dark-toggle').forEach(b => {
    b.title = text;
    b.setAttribute('aria-label', text);
  });
}

/**
 * Apply the saved theme and make every .dark-toggle switch it.
 *
 * @param {object} [options]
 * @param {Document} [options.doc] the page (tests pass a jsdom document)
 * @param {Storage} [options.storage] where the choice is remembered
 * @param {(dark: boolean) => void} [options.onChange] called after each switch,
 *   e.g. so the graph can redraw in the new colours
 */
export function setUpThemeToggle({ doc = document, storage = safeStorage(doc), onChange } = {}) {
  const root = doc.documentElement;
  if (read(storage) === 'dark') root.setAttribute('data-theme', 'dark');
  labelThemeButtons(doc);

  const toggle = () => {
    const dark = !isDark(doc);
    if (dark) root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    write(storage, dark);
    labelThemeButtons(doc);
    onChange?.(dark);
  };
  doc.querySelectorAll('.dark-toggle').forEach(b => b.addEventListener('click', toggle));
  return toggle;
}

// localStorage can be missing or throw (private windows, blocked site data);
// the theme still switches for this page, it just isn't remembered.
function safeStorage(doc) {
  try { return doc.defaultView.localStorage; } catch { return null; }
}

function read(storage) {
  try { return storage?.getItem(THEME_KEY); } catch { return null; }
}

function write(storage, dark) {
  try {
    if (dark) storage?.setItem(THEME_KEY, 'dark');
    else storage?.removeItem(THEME_KEY);
  } catch { /* not remembered; see safeStorage */ }
}
