// Tests of the widget's small view (static/js/widget.js) under jsdom: the real
// templates/widget.html markup, the real modules, d3 from npm, and the fake API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as d3 from 'd3';

import { makeDom, sleep, key } from './helpers/dom.mjs';
import { recordingContext } from './helpers/canvas.mjs';
import { fakeFetch } from './helpers/fake-api.mjs';

const TEMPLATE = readFileSync(new URL('../../templates/widget.html', import.meta.url), 'utf8');

let run = 0;

/**
 * Open /widget with `params` (what Flask renders). With `embedded`, the page
 * gets a parent window whose postMessage calls are recorded in `messages`.
 */
async function openWidget(t, params = {}, { embedded = false } = {}) {
  const html = TEMPLATE
    .replace(/\{\{\s*url_for\([^}]*\)\s*\}\}/g, '#')
    .replace(/\{\{\s*widget_params\|tojson\s*\}\}/, JSON.stringify(params));
  const { window } = makeDom(html, { url: 'http://localhost/widget' });
  window.widgetParams = { works: [], authors: [], ids: [], q: '', ...params };
  window.HTMLCanvasElement.prototype.getContext = () => recordingContext();
  const messages = [];
  if (embedded) {
    Object.defineProperty(window, 'parent', { value: { postMessage: (data, origin) => messages.push({ data, origin }) } });
  }
  const fetch = fakeFetch();
  Object.assign(globalThis, {
    window, document: window.document, localStorage: window.localStorage, d3, fetch,
    SVGElement: window.SVGElement,
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  await import(`../../static/js/widget.js?run=${++run}`);
  const widget = window.pandityaWidget;
  await widget.ready;
  t.after(async () => {
    widget.view.destroy();
    await sleep(0);
    window.close();
  });
  return { window, document: window.document, widget, fetch, messages, $: id => window.document.getElementById(id) };
}

const graphIds = page => page.widget.graph.nodes.map(n => n.id).sort();

async function until(predicate, message = 'condition', timeout = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
    await sleep(5);
  }
}

test('empty: a search box and a hint, nothing loaded', async t => {
  const page = await openWidget(t);
  assert.equal(page.$('widget-status').textContent, 'Search for an author or work.');
  assert.equal(page.fetch.graphCalls().length, 0);
  assert.equal(page.$('widget-pandit').hidden, true);
});

test('a work from the URL: named, 1 hop, with its Pandit link', async t => {
  const page = await openWidget(t, { works: ['89000'] });
  assert.deepEqual(page.fetch.lastGraphRequest(), { authors: [], works: ['89000'], hops: 1, exclude_list: [], expand: [], remove: [], collections: [] });
  assert.deepEqual(graphIds(page), ['85303', '89000']);
  assert.equal(page.$('widget-current').textContent, 'Nyāyasāra');
  assert.equal(page.$('widget-pandit').href, 'https://www.panditproject.org/node/89000');
  assert.equal(page.$('widget-status').hidden, true);
  assert.deepEqual([...page.document.querySelectorAll('li.chip')].map(li => li.dataset.id), ['89000']);
});

test('a bare Pandit ID is looked up to find whether it is an author or a work', async t => {
  const page = await openWidget(t, { ids: ['85303'] });
  assert.deepEqual(page.fetch.lastGraphRequest().authors, ['85303']);
  assert.equal(page.$('widget-current').textContent, 'Bhāsarvajña');
});

test('an ID Pandit does not know says so', async t => {
  const page = await openWidget(t, { ids: ['999'] });
  assert.equal(page.$('widget-status').textContent, 'Pandit has no author or work with ID 999.');
  assert.equal(page.fetch.graphCalls().length, 0);
});

test('a work ID given as an author is not shown as one', async t => {
  const page = await openWidget(t, { authors: ['89000'] });
  assert.match(page.$('widget-status').textContent, /no author or work with ID 89000/);
});

test('a search from the URL shows its results; picking one shows it', async t => {
  const page = await openWidget(t, { q: 'Nyāya' });
  const results = page.document.querySelector('.results');
  await until(() => !results.hidden, 'results');
  assert.deepEqual([...results.querySelectorAll('[role="option"]')].map(li => li.querySelector('.entity-name').textContent),
    ['Nyāyasāra', 'Nyāyabhūṣaṇa', 'Nyāyabhūṣaṇa-ṭīkā']);
  key(page.window, page.widget.search.input, 'Enter');
  await until(() => page.fetch.graphCalls().length === 1, 'graph');
  assert.deepEqual(page.fetch.lastGraphRequest().works, ['89000']);
});

test('one at a time: picking another replaces the first', async t => {
  const page = await openWidget(t, { works: ['89000'] });
  page.widget.search.add({ id: '40377', type: 'author', name: 'Kālidāsa' });
  await until(() => page.widget.graph.nodes.some(n => n.id === '40377'), 'new graph');
  assert.deepEqual(page.widget.search.getItems().map(i => i.id), ['40377']);
  assert.deepEqual(page.fetch.lastGraphRequest().authors, ['40377']);
  assert.deepEqual(page.fetch.lastGraphRequest().works, []);
});

test('clicking a name in the graph moves there', async t => {
  const page = await openWidget(t, { works: ['89000'] });
  page.widget.view.onSelect(page.widget.view.getNode('85303'));
  await until(() => page.widget.graph.nodes.length === 3, 'author graph');
  assert.deepEqual(graphIds(page), ['85303', '89000', '89001']);
  assert.equal(page.$('widget-current').textContent, 'Bhāsarvajña');
  // Clicking empty space, or what's already shown, asks for nothing.
  const calls = page.fetch.graphCalls().length;
  page.widget.view.onSelect(null);
  page.widget.view.onSelect(page.widget.view.getNode('85303'));
  await sleep(20);
  assert.equal(page.fetch.graphCalls().length, calls);
});

test('removing the chip empties the view', async t => {
  const page = await openWidget(t, { works: ['89000'] });
  page.widget.search.remove('89000');
  assert.equal(page.$('widget-status').textContent, 'Search for an author or work.');
  assert.equal(page.$('widget-current').textContent, '');
});

test('inside the widget, every change tells the embedding page what is shown', async t => {
  const page = await openWidget(t, { works: ['89000'] }, { embedded: true });
  page.widget.view.onSelect(page.widget.view.getNode('85303'));
  page.widget.search.remove('85303');
  assert.deepEqual(page.messages.map(m => m.data.path), ['/view?works=89000&hops=1', '/view?authors=85303&hops=1', '/']);
  assert.ok(page.messages.every(m => m.data.type === 'panditya:state' && m.origin === '*'));
});

test('not embedded: no messages', async t => {
  const page = await openWidget(t, { works: ['89000'] });
  assert.equal(page.window.parent, page.window);
});
