// Tests for static/js/theme.js, the dark mode button shared by the graph and info pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setUpThemeToggle, THEME_KEY } from '../../static/js/theme.js';
import { makeDom } from './helpers/dom.mjs';

const BUTTONS = '<!DOCTYPE html><body><button class="dark-toggle"></button><button class="dark-toggle"></button></body>';

function setup(t, { saved, storage } = {}) {
  const { window } = makeDom(BUTTONS);
  t.after(() => window.close());
  if (saved) window.localStorage.setItem(THEME_KEY, saved);
  const changes = [];
  setUpThemeToggle({ doc: window.document, storage: storage ?? window.localStorage, onChange: d => changes.push(d) });
  const doc = window.document;
  const theme = () => doc.documentElement.getAttribute('data-theme');
  const labels = () => [...doc.querySelectorAll('.dark-toggle')].map(b => [b.title, b.getAttribute('aria-label')]);
  return { window, doc, changes, theme, labels };
}

test('starts light, and every button says it switches to dark', t => {
  const { theme, labels, changes } = setup(t);
  assert.equal(theme(), null);
  assert.deepEqual(labels(), Array(2).fill(['Switch to dark mode', 'Switch to dark mode']));
  assert.deepEqual(changes, []);
});

test('a click switches, is remembered, relabels every button and tells the page', t => {
  const { window, doc, theme, labels, changes } = setup(t);
  doc.querySelectorAll('.dark-toggle')[1].click();
  assert.equal(theme(), 'dark');
  assert.equal(window.localStorage.getItem(THEME_KEY), 'dark');
  assert.deepEqual(labels(), Array(2).fill(['Switch to light mode', 'Switch to light mode']));
  doc.querySelector('.dark-toggle').click();
  assert.equal(theme(), null);
  assert.equal(window.localStorage.getItem(THEME_KEY), null);
  assert.deepEqual(changes, [true, false]);
});

test('a saved dark theme is applied', t => {
  const { theme, labels } = setup(t, { saved: 'dark' });
  assert.equal(theme(), 'dark');
  assert.equal(labels()[0][0], 'Switch to light mode');
});

test('still switches when storage throws (private windows)', t => {
  const broken = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  const { doc, theme } = setup(t, { storage: broken });
  doc.querySelector('.dark-toggle').click();
  assert.equal(theme(), 'dark');
});
