// Tests for static/js/viewport.js, with a fake visualViewport.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fitPageToVisibleArea } from '../../static/js/viewport.js';
import { makeDom } from './helpers/dom.mjs';

function setup(t) {
  const { window } = makeDom();
  t.after(() => window.close());
  const vv = new window.EventTarget();
  Object.assign(vv, { height: 844, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  const scrolls = [];
  window.scrollTo = (x, y) => {
    scrolls.push([x, y]);
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  };
  const height = () => window.document.documentElement.style.getPropertyValue('--app-height');
  return { window, vv, scrolls, height };
}

test('the page is sized to the visible area, and follows the keyboard', t => {
  const { window, vv, height, scrolls } = setup(t);
  fitPageToVisibleArea(window);
  assert.equal(height(), '844px');
  assert.deepEqual(scrolls, [], 'nothing to undo');

  // The keyboard opens and iOS pans the page up.
  vv.height = 480.4;
  Object.defineProperty(window, 'scrollY', { value: 300, configurable: true });
  vv.dispatchEvent(new window.Event('resize'));
  assert.equal(height(), '480px');
  assert.deepEqual(scrolls, [[0, 0]], 'the panning is undone');

  // Keyboard closes.
  vv.height = 844;
  vv.dispatchEvent(new window.Event('resize'));
  assert.equal(height(), '844px');
});

test('pinch-zoomed in: left alone', t => {
  const { window, vv, height, scrolls } = setup(t);
  fitPageToVisibleArea(window);
  vv.scale = 2;
  vv.height = 422;
  Object.defineProperty(window, 'scrollY', { value: 100, configurable: true });
  vv.dispatchEvent(new window.Event('scroll'));
  assert.equal(height(), '844px');
  assert.deepEqual(scrolls, []);
});

test('no visualViewport (old browsers): does nothing', t => {
  const { window } = makeDom();
  t.after(() => window.close());
  Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
  fitPageToVisibleArea(window)();
  assert.equal(window.document.documentElement.style.getPropertyValue('--app-height'), '');
});
