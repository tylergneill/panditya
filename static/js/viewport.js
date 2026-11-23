/**
 * Keep the page fitted to the part of the screen you can actually see.
 *
 * On iPhones the on-screen keyboard covers the bottom of the page without
 * making the page shorter. The page is a fixed-height app (body is 100dvh with
 * overflow hidden), so when a box gets focus iOS pans the whole page up to make
 * room, which pushes the header and the search box itself off the top.
 *
 * The fix: size the page to the visual viewport (what's visible above the
 * keyboard) via the --app-height CSS variable that app.css uses for the body,
 * and undo any panning iOS has already done. With the page no taller than the
 * visible area, there is nothing for iOS to pan.
 *
 * Pinch-zoom also shrinks the visual viewport, so nothing is changed while the
 * page is zoomed in: then the usual behaviour (panning around) is what you want.
 *
 * Tested in tests/js/viewport.test.mjs (with a fake visualViewport).
 */

/**
 * @param {Window} win
 * @returns {() => void} the sync function (also run on every viewport change)
 */
export function fitPageToVisibleArea(win = window) {
  const vv = win.visualViewport;
  if (!vv) return () => {};
  const root = win.document.documentElement;

  function sync() {
    if (Math.abs((vv.scale || 1) - 1) > 0.01) return; // zoomed in: leave it be
    root.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
    if (win.scrollY || win.scrollX) win.scrollTo(0, 0);
  }

  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  sync();
  return sync;
}
