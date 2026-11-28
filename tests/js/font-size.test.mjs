// Tests for static/js/font-size.js, the − A + control for the size of graph names.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setUpFontSize, nearestScale, LABEL_SCALES, LABEL_SCALE_KEY } from '../../static/js/font-size.js';
import { makeDom } from './helpers/dom.mjs';

function setup(t, saved) {
  const { window } = makeDom();
  t.after(() => window.close());
  if (saved !== undefined) window.localStorage.setItem(LABEL_SCALE_KEY, saved);
  const roots = [window.document.createElement('div'), window.document.createElement('div')];
  const changes = [];
  const control = setUpFontSize({ roots, storage: window.localStorage, onChange: s => changes.push(s) });
  const btn = (i, action) => roots[i].querySelector(`[data-font="${action}"]`);
  return { window, roots, changes, control, btn };
}

test('nearestScale snaps to a step; junk is normal size', () => {
  assert.equal(nearestScale('1.3'), 1.3);
  assert.equal(nearestScale(1.2), 1.15);
  assert.equal(nearestScale(99), 2);
  assert.equal(nearestScale('x'), 1);
  assert.equal(nearestScale(-1), 1);
});

test('builds − A + in every slot, starting at normal size', t => {
  const { roots, changes, btn } = setup(t);
  for (const root of roots) {
    assert.deepEqual([...root.querySelectorAll('button')].map(b => b.textContent), ['−', 'A', '+']);
    assert.equal(root.getAttribute('role'), 'group');
  }
  assert.deepEqual(changes, [1]);
  assert.equal(btn(0, 'reset').getAttribute('aria-pressed'), 'true');
});

test('+ and − step the size, A resets; all copies stay in step and it is remembered', t => {
  const { window, changes, btn } = setup(t);
  btn(0, 'up').click();
  btn(1, 'up').click();
  assert.deepEqual(changes, [1, 1.15, 1.3]);
  assert.equal(window.localStorage.getItem(LABEL_SCALE_KEY), '1.3');
  assert.equal(btn(1, 'reset').getAttribute('aria-pressed'), 'false');
  btn(1, 'down').click();
  assert.equal(changes.at(-1), 1.15);
  btn(0, 'reset').click();
  assert.equal(changes.at(-1), 1);
  assert.equal(window.localStorage.getItem(LABEL_SCALE_KEY), null);
});

test('the ends disable their buttons', t => {
  const { control, btn } = setup(t);
  control.set(LABEL_SCALES.at(-1));
  assert.equal(btn(0, 'up').disabled, true);
  assert.equal(btn(1, 'up').disabled, true);
  assert.equal(btn(0, 'down').disabled, false);
  control.set(LABEL_SCALES[0]);
  assert.equal(btn(0, 'down').disabled, true);
  assert.equal(btn(0, 'up').disabled, false);
});

test('starts at the remembered size', t => {
  const { changes } = setup(t, '1.5');
  assert.deepEqual(changes, [1.5]);
});
