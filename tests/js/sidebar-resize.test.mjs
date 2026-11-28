// Tests for static/js/sidebar-resize.js, the handle that resizes the sidebar.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clampWidth, setUpSidebarResizer, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_STORAGE_KEY,
} from '../../static/js/sidebar-resize.js';
import { makeDom, key } from './helpers/dom.mjs';

const LAYOUT = { left: 0, right: 1000, width: 1000 }; // so the widest allowed is 600

/** A handle in a 1000px-wide layout, with a fresh localStorage (pre-filled with `saved`). */
function setup({ saved, storage } = {}) {
  const { window } = makeDom();
  const { document } = window;
  const layout = document.createElement('div');
  const handle = document.createElement('div');
  layout.append(handle);
  document.body.append(layout);
  layout.getBoundingClientRect = () => ({ ...LAYOUT, top: 0, bottom: 600, height: 600 });
  const store = storage || window.localStorage;
  if (saved !== undefined) store.setItem(SIDEBAR_STORAGE_KEY, saved);
  const widths = [];
  const resizer = setUpSidebarResizer({ handle, layout, storage: store, onResize: w => widths.push(w) });
  const cssWidth = () => layout.style.getPropertyValue('--sidebar-width');
  const saved_ = () => store.getItem(SIDEBAR_STORAGE_KEY);
  return { window, layout, handle, resizer, widths, cssWidth, saved: saved_ };
}

/** Fire a pointer event (jsdom may lack PointerEvent; the handler only reads these fields). */
function pointer(window, target, type, clientX, extra = {}) {
  const Ctor = window.PointerEvent || window.MouseEvent;
  const e = new Ctor(type, { bubbles: true, cancelable: true, clientX, button: 0, ...extra });
  target.dispatchEvent(e);
  return e;
}

test('clampWidth keeps the sidebar between the minimum and 60% of the layout', () => {
  assert.equal(clampWidth(100, 1000), SIDEBAR_MIN_WIDTH);
  assert.equal(clampWidth(400.4, 1000), 400);
  assert.equal(clampWidth(900, 1000), 600);
  assert.equal(clampWidth(Infinity, 1000), 600);
  assert.equal(clampWidth(NaN, 1000), SIDEBAR_DEFAULT_WIDTH);
  assert.equal(clampWidth(500, 300), SIDEBAR_MIN_WIDTH, 'tiny layout: the minimum wins');
});

test('starts at the default width and saves nothing', () => {
  const s = setup();
  assert.equal(s.cssWidth(), `${SIDEBAR_DEFAULT_WIDTH}px`);
  assert.equal(s.resizer.getWidth(), SIDEBAR_DEFAULT_WIDTH);
  assert.equal(s.saved(), null);
  assert.equal(s.handle.getAttribute('aria-valuenow'), '320');
  assert.equal(s.handle.getAttribute('aria-valuemin'), '240');
  assert.equal(s.handle.getAttribute('aria-valuemax'), '600');
});

test('starts at the remembered width, clamped to the screen', () => {
  assert.equal(setup({ saved: '450' }).cssWidth(), '450px');
  assert.equal(setup({ saved: '5000' }).cssWidth(), '600px');
  assert.equal(setup({ saved: 'junk' }).cssWidth(), '320px');
});

test('dragging the handle sets the width from the right edge, and saves it on release', () => {
  const s = setup();
  const down = pointer(s.window, s.handle, 'pointerdown', 680);
  assert.ok(down.defaultPrevented, 'no text selection starts');
  assert.ok(s.layout.classList.contains('resizing-sidebar'));
  pointer(s.window, s.handle, 'pointermove', 550);
  assert.equal(s.cssWidth(), '450px');
  assert.equal(s.saved(), null, 'not saved mid-drag');
  pointer(s.window, s.handle, 'pointermove', 100); // too far: clamped
  assert.equal(s.cssWidth(), '600px');
  pointer(s.window, s.handle, 'pointerup', 100);
  assert.equal(s.saved(), '600');
  assert.ok(!s.layout.classList.contains('resizing-sidebar'));
  assert.ok(!s.handle.classList.contains('dragging'));
  pointer(s.window, s.handle, 'pointermove', 700);
  assert.equal(s.cssWidth(), '600px', 'moves after release change nothing');
});

test('a cancelled drag also ends and keeps the width', () => {
  const s = setup();
  pointer(s.window, s.handle, 'pointerdown', 680);
  pointer(s.window, s.handle, 'pointermove', 600);
  pointer(s.window, s.handle, 'pointercancel', 600);
  assert.equal(s.saved(), '400');
});

test('only the main button starts a drag', () => {
  const s = setup();
  pointer(s.window, s.handle, 'pointerdown', 680, { button: 2 });
  pointer(s.window, s.handle, 'pointermove', 500);
  assert.equal(s.cssWidth(), '320px');
});

test('keyboard: ←/→ step, Shift for big steps, Home/End for the limits', () => {
  const s = setup();
  key(s.window, s.handle, 'ArrowLeft');
  assert.equal(s.resizer.getWidth(), 336, 'wider');
  key(s.window, s.handle, 'ArrowRight');
  key(s.window, s.handle, 'ArrowRight');
  assert.equal(s.resizer.getWidth(), 304, 'narrower');
  s.handle.dispatchEvent(new s.window.KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
  assert.equal(s.resizer.getWidth(), 368);
  key(s.window, s.handle, 'End');
  assert.equal(s.resizer.getWidth(), 600);
  key(s.window, s.handle, 'Home');
  assert.equal(s.resizer.getWidth(), SIDEBAR_MIN_WIDTH);
  assert.equal(s.saved(), String(SIDEBAR_MIN_WIDTH), 'keyboard changes are saved');
  const other = key(s.window, s.handle, 'a');
  assert.ok(!other.defaultPrevented, 'other keys are left alone');
});

test('double-click goes back to the default and forgets the saved width', () => {
  const s = setup({ saved: '500' });
  s.handle.dispatchEvent(new s.window.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(s.cssWidth(), '320px');
  assert.equal(s.saved(), null);
});

test('onResize hears every change (the graph re-measures itself then)', () => {
  const s = setup();
  s.resizer.setWidth(500);
  assert.deepEqual(s.widths, [320, 500]);
});

test('blocked storage does not break anything', () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  const { window } = makeDom();
  const layout = window.document.createElement('div');
  const handle = window.document.createElement('div');
  layout.getBoundingClientRect = () => LAYOUT;
  const resizer = setUpSidebarResizer({ handle, layout, storage: broken });
  assert.equal(resizer.setWidth(400), 400);
  resizer.reset();
  assert.equal(resizer.getWidth(), 320);
});

test('before layout (no width yet) a request is kept, within the minimum', () => {
  const { window } = makeDom();
  const layout = window.document.createElement('div');
  const handle = window.document.createElement('div');
  layout.getBoundingClientRect = () => ({ width: 0, right: 0 });
  const resizer = setUpSidebarResizer({ handle, layout, storage: window.localStorage });
  assert.equal(resizer.setWidth(900), 900);
  assert.equal(resizer.setWidth(10), SIDEBAR_MIN_WIDTH);
  assert.equal(resizer.setWidth(Infinity), SIDEBAR_DEFAULT_WIDTH);
});
