/**
 * Talking to a page that embeds Pāṇḍitya (the widget, static/js/widget-loader.js).
 *
 * The widget shows /widget (small) or the full app (expanded) in an iframe on
 * someone else's site. It can't read the iframe's address (other origin), so the
 * page inside tells it, after every change, which graph is on screen. The widget
 * needs that for "Expand" and "Open at panditya.info".
 *
 * The message is {type: 'panditya:state', path: '/view?works=...'}. It holds
 * nothing but the public link to what's on screen, so it is posted to any
 * origin ('*'): the embedding site isn't known in advance.
 */

export const STATE_MESSAGE = 'panditya:state';

/** True when this page runs inside a frame on another page. */
export function isEmbedded(win = window) {
  try {
    return win.parent !== win;
  } catch {
    return true; // a cross-origin parent can make the comparison throw in old browsers
  }
}

/** Tell the embedding page (if any) which graph is on screen. `path` is a stateToUrl() result. */
export function tellEmbedder(path, win = window) {
  if (!isEmbedded(win)) return;
  try {
    win.parent.postMessage({ type: STATE_MESSAGE, path }, '*');
  } catch { /* the parent went away; nothing to tell */ }
}
