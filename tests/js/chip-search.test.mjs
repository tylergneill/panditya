// Tests for static/js/chip-search.js, the search box that collects chips.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ChipSearch, typeMark } from '../../static/js/chip-search.js';
import { makeDom, flush, sleep, key, type } from './helpers/dom.mjs';

const KALIDASA = { id: '40377', type: 'author', name: 'Kālidāsa', dates: '5th c.' };
const RAGHU = { id: '40378', type: 'work', name: 'Raghuvaṃśa', has_etexts: true, aka: 'Raghu' };
const KUMARA = { id: '40379', type: 'work', name: 'Kumārasaṃbhava' };

/** Build a ChipSearch whose search answers from `answers` (query -> results). */
function setup({ answers = {}, search, debounceMs = 0 } = {}) {
  const dom = makeDom();
  const { document } = dom.window;
  const root = document.createElement('div');
  document.body.append(root);
  const changes = [];
  const queries = [];
  const chips = new ChipSearch({
    root,
    debounceMs,
    label: 'Search',
    placeholder: 'Find…',
    search: search || (async (q, signal) => {
      queries.push({ q, signal });
      return answers[q] || [];
    }),
    onChange: items => changes.push(items.map(i => i.id)),
  });
  return { dom, window: dom.window, document, root, chips, changes, queries, input: chips.input };
}

const options = s => [...s.chips.resultList.querySelectorAll('li[role=option]')];
const chipIds = s => [...s.chips.chipList.querySelectorAll('li.chip')].map(li => li.dataset.id);

test('builds an accessible combobox', () => {
  const s = setup();
  assert.equal(s.input.getAttribute('role'), 'combobox');
  assert.equal(s.input.getAttribute('aria-label'), 'Search');
  assert.equal(s.input.getAttribute('aria-controls'), s.chips.resultList.id);
  assert.equal(s.input.getAttribute('aria-expanded'), 'false');
  assert.equal(s.input.placeholder, 'Find…');
  assert.ok(s.input.hasAttribute('data-1p-ignore'), 'password managers stay out');
  assert.equal(s.chips.resultList.hidden, true);
});

test('two instances get different ids', () => {
  const a = setup();
  const b = setup();
  assert.notEqual(a.chips.resultList.id, b.chips.resultList.id);
});

test('typing shows results; picking adds a chip and clears the box', async () => {
  const s = setup({ answers: { kali: [KALIDASA, RAGHU] } });
  type(s.window, s.input, 'kali');
  await sleep(5);
  const opts = options(s);
  assert.equal(opts.length, 2);
  assert.equal(s.chips.resultList.hidden, false);
  assert.equal(s.input.getAttribute('aria-expanded'), 'true');
  assert.match(opts[0].textContent, /Kālidāsa/);
  assert.match(opts[0].textContent, /5th c\./);
  assert.match(opts[1].textContent, /aka Raghu/);
  assert.ok(opts[1].querySelector('.etext-badge'), 'e-text badge');
  assert.ok(!opts[0].querySelector('.etext-badge'));

  // Mouse pick on the second result.
  opts[1].dispatchEvent(new s.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  assert.deepEqual(chipIds(s), ['40378']);
  assert.deepEqual(s.changes, [['40378']]);
  assert.equal(s.input.value, '');
  assert.equal(s.chips.resultList.hidden, true);
});

test('keyboard: arrows move, Enter picks, Escape closes', async () => {
  const s = setup({ answers: { k: [KALIDASA, RAGHU, KUMARA] } });
  type(s.window, s.input, 'k');
  await sleep(5);
  assert.equal(s.chips.active, 0);
  assert.equal(options(s)[0].getAttribute('aria-selected'), 'true');
  key(s.window, s.input, 'ArrowDown');
  key(s.window, s.input, 'ArrowDown');
  assert.equal(s.chips.active, 2);
  assert.equal(s.input.getAttribute('aria-activedescendant'), options(s)[2].id);
  key(s.window, s.input, 'ArrowDown');
  assert.equal(s.chips.active, 0, 'wraps around');
  key(s.window, s.input, 'ArrowUp');
  assert.equal(s.chips.active, 2, 'wraps backwards');

  const esc = key(s.window, s.input, 'Escape');
  assert.ok(esc.defaultPrevented);
  assert.equal(s.chips.resultList.hidden, true);
  const enterWhileClosed = key(s.window, s.input, 'Enter');
  assert.ok(!enterWhileClosed.defaultPrevented, 'Enter does nothing when the list is closed');
  assert.deepEqual(chipIds(s), []);

  key(s.window, s.input, 'ArrowDown'); // reopens, moves to 0
  assert.equal(s.chips.resultList.hidden, false);
  const enter = key(s.window, s.input, 'Enter');
  assert.ok(enter.defaultPrevented);
  assert.deepEqual(chipIds(s), ['40377']);
});

test('Escape with the list already closed is left for the page (e.g. to close the panel)', () => {
  const s = setup();
  const esc = key(s.window, s.input, 'Escape');
  assert.ok(!esc.defaultPrevented);
});

test('Backspace in an empty box removes the last chip', () => {
  const s = setup();
  s.chips.add(KALIDASA);
  s.chips.add(RAGHU);
  key(s.window, s.input, 'Backspace');
  assert.deepEqual(chipIds(s), ['40377']);
  s.input.value = 'x';
  key(s.window, s.input, 'Backspace');
  assert.deepEqual(chipIds(s), ['40377'], 'not while there is text');
});

test('chip × button removes it', () => {
  const s = setup();
  s.chips.add(KALIDASA);
  s.chips.add(RAGHU);
  const button = s.chips.chipList.querySelector('li[data-id="40377"] .chip-remove');
  assert.equal(button.getAttribute('aria-label'), 'Remove Kālidāsa');
  button.click();
  assert.deepEqual(chipIds(s), ['40378']);
  assert.deepEqual(s.changes.at(-1), ['40378']);
});

test('add ignores duplicates; remove of a missing id is silent', () => {
  const s = setup();
  s.chips.add(KALIDASA);
  s.chips.add(KALIDASA);
  s.chips.remove('nope');
  assert.deepEqual(s.changes, [['40377']]);
});

test('setItems does not notify', () => {
  const s = setup();
  s.chips.setItems([KALIDASA, { id: '9', type: 'work', name: '' }]);
  assert.deepEqual(chipIds(s), ['40377', '9']);
  assert.equal(s.chips.chipList.querySelectorAll('.entity-name')[1].textContent, '9', 'falls back to the ID');
  assert.deepEqual(s.changes, []);
  assert.ok(s.chips.el.classList.contains('has-chips'));
  assert.deepEqual(s.chips.getItems().map(i => i.id), ['40377', '9']);
});

test('chips already chosen are not offered again', async () => {
  const s = setup({ answers: { k: [KALIDASA, RAGHU] } });
  s.chips.setItems([KALIDASA]);
  type(s.window, s.input, 'k');
  await sleep(5);
  assert.deepEqual(options(s).map(li => li.textContent.includes('Raghu')), [true]);
});

test('no matches and errors show a line instead of options', async () => {
  const s = setup({ answers: {} });
  type(s.window, s.input, 'zzz');
  await sleep(5);
  const empty = s.chips.resultList.querySelector('.result-empty');
  assert.match(empty.textContent, /No authors or works match “zzz”/);
  assert.equal(options(s).length, 0);

  const failing = setup({ search: async () => { throw new Error('Server down'); } });
  type(failing.window, failing.input, 'x');
  await sleep(5);
  const err = failing.chips.resultList.querySelector('.result-empty.error');
  assert.equal(err.textContent, 'Server down');
});

test('names are shown as text, never as markup', async () => {
  const evil = { id: '1', type: 'work', name: '<img src=x onerror=alert(1)>' };
  const s = setup({ answers: { e: [evil] } });
  type(s.window, s.input, 'e');
  await sleep(5);
  assert.equal(s.chips.resultList.querySelector('img'), null);
  s.chips.add(evil);
  assert.equal(s.chips.chipList.querySelector('img'), null);
});

test('typing fast: debounced to one search for the last text', async () => {
  const s = setup({ debounceMs: 20, answers: { kal: [KALIDASA] } });
  type(s.window, s.input, 'k');
  type(s.window, s.input, 'ka');
  type(s.window, s.input, 'kal');
  await sleep(50);
  assert.deepEqual(s.queries.map(q => q.q), ['kal']);
  assert.equal(options(s).length, 1);
});

test('a newer search aborts the older one, whose late answer is ignored', async () => {
  const pending = [];
  const s = setup({
    search: (q, signal) => new Promise(resolve => pending.push({ q, signal, resolve })),
  });
  type(s.window, s.input, 'old');
  await sleep(5);
  type(s.window, s.input, 'new');
  await sleep(5);
  assert.equal(pending.length, 2);
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve([RAGHU]);
  await flush();
  pending[0].resolve([KALIDASA]); // arrives late
  await flush();
  assert.deepEqual(options(s).map(li => li.textContent.includes('Raghu')), [true]);
  assert.ok(!s.chips.el.classList.contains('searching'));
});

test('clearing the box clears the results and aborts the search', async () => {
  const pending = [];
  const s = setup({ search: (q, signal) => new Promise(resolve => pending.push({ signal, resolve })) });
  type(s.window, s.input, 'abc');
  await sleep(5);
  type(s.window, s.input, '  ');
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(s.chips.resultList.hidden, true);
  assert.equal(s.chips.resultList.children.length, 0);
});

test('aborted searches show no error', async () => {
  const s = setup({
    search: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); },
  });
  type(s.window, s.input, 'x');
  await sleep(5);
  assert.equal(s.chips.resultList.children.length, 0);
});

test('focusing again reopens earlier results; blur closes them', async () => {
  const s = setup({ answers: { k: [KALIDASA] } });
  type(s.window, s.input, 'k');
  await sleep(5);
  s.input.blur();
  await sleep(200);
  assert.equal(s.chips.resultList.hidden, true);
  s.input.focus();
  assert.equal(s.chips.resultList.hidden, false);
});

test('clicking the empty part of the box focuses the input', () => {
  const s = setup();
  s.chips.el.dispatchEvent(new s.window.MouseEvent('click', { bubbles: true }));
  assert.equal(s.document.activeElement, s.input);
});

test('typeMark', () => {
  const { document } = makeDom().window;
  const author = typeMark(document, 'author');
  assert.equal(author.className, 'type-mark author');
  assert.equal(author.title, 'Author');
  assert.equal(author.getAttribute('aria-hidden'), 'true');
  assert.equal(typeMark(document, 'work').title, 'Work');
});

test('a long list keeps its scroll position on refresh, and scrolls to a new chip', () => {
  const s = setup();
  s.chips.setItems([KALIDASA, RAGHU]);
  Object.defineProperty(s.chips.chipList, 'scrollHeight', { configurable: true, value: 300 });
  s.chips.chipList.scrollTop = 50;
  s.chips.setItems([KALIDASA, RAGHU]);
  assert.equal(s.chips.chipList.scrollTop, 50, 'refreshing from the page state does not jump');
  s.chips.add(KUMARA);
  assert.equal(s.chips.chipList.scrollTop, 300, 'the new chip is in view');
});
