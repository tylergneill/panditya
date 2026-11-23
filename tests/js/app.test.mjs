// End-to-end tests of the main page (static/js/app.js) under jsdom: the real
// templates/index.html markup, the real modules, d3 from npm, and a small fake
// server standing in for the Flask API.
//
// Each test builds a fresh page and imports app.js anew (a different ?run=
// query makes Node load a new copy), so tests don't share any page state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as d3 from 'd3'; // imported before any `window` global exists, so d3's timers use setTimeout

import { makeDom, sleep, key, type } from './helpers/dom.mjs';
import { recordingContext } from './helpers/canvas.mjs';

const TEMPLATE = readFileSync(new URL('../../templates/index.html', import.meta.url), 'utf8');

// --- A fake Pāṇḍitya API ---------------------------------------------------

const ENTITIES = {
  85303: { type: 'author', name: 'Bhāsarvajña', dates: '10th c.' },
  89000: { type: 'work', name: 'Nyāyasāra' },
  89001: { type: 'work', name: 'Nyāyabhūṣaṇa' },
  89002: { type: 'work', name: 'Nyāyabhūṣaṇa-ṭīkā' },
  40377: { type: 'author', name: 'Kālidāsa' },
  40378: { type: 'work', name: 'Raghuvaṃśa' },
  85352: { type: 'author', name: 'Abhinavagupta' },
};
const EDGES = [
  ['85303', '89000', 'source author wrote target work'],
  ['85303', '89001', 'source author wrote target work'],
  ['89001', '89002', 'source base text inspired target commentary'],
  ['40377', '40378', 'source author wrote target work'],
];
const neighbours = id => EDGES.flatMap(([s, t]) => (s === id ? [t] : t === id ? [s] : []));

/** What the real /api/graph/subgraph would answer, for this tiny data set. */
function subgraph({ authors, works, hops, exclude_list: exclude, expand }) {
  for (const id of [...authors, ...works, ...exclude, ...expand]) {
    if (!ENTITIES[id]) return { status: 400, body: { error: `Invalid ID: ${id}` } };
  }
  const centers = [...authors, ...works];
  const ids = new Set(centers);
  let frontier = [...centers];
  for (let h = 0; h < hops; h++) {
    const next = [];
    for (const id of frontier) {
      if (exclude.includes(id) && !centers.includes(id)) continue;
      for (const n of neighbours(id)) if (!ids.has(n)) { ids.add(n); next.push(n); }
    }
    frontier = next;
  }
  for (const id of expand) for (const n of neighbours(id)) ids.add(n);
  const nodes = [...ids].map(id => ({
    id,
    type: ENTITIES[id].type,
    label: ENTITIES[id].name,
    dates: ENTITIES[id].dates || '',
    is_central: centers.includes(id),
    is_excluded: exclude.includes(id) && !expand.includes(id),
    is_expanded: expand.includes(id),
    hidden_neighbors: neighbours(id).filter(n => !ids.has(n)).length,
    etext_links: false,
  }));
  const edges = EDGES.filter(([s, t]) => ids.has(s) && ids.has(t)).map(([source, target, relationship]) => ({ source, target, relationship }));
  return { status: 200, body: { parameters: {}, graph: { nodes, edges } } };
}

const describe = id => ({ id, type: ENTITIES[id].type, name: ENTITIES[id].name, dates: ENTITIES[id].dates || '', aka: '', has_etexts: false });

function route(url, options = {}) {
  const u = new URL(url, 'http://localhost');
  if (u.pathname === '/api/graph/subgraph') return subgraph(JSON.parse(options.body));
  if (u.pathname === '/api/entities/labels') {
    const ids = u.searchParams.get('ids').split(',').filter(id => ENTITIES[id]);
    return { status: 200, body: ids.map(id => ({ ...describe(id), label: ENTITIES[id].name })) };
  }
  if (u.pathname === '/api/entities/search') {
    const q = u.searchParams.get('q').toLowerCase();
    const ids = Object.keys(ENTITIES).filter(id => ENTITIES[id].name.toLowerCase().startsWith(q));
    return { status: 200, body: ids.map(describe) };
  }
  return { status: 404, body: { error: 'Not found' } };
}

/**
 * A fake fetch over `route`. Calls are recorded; `fake.hold = true` makes new
 * graph requests wait until released (to test slow and overlapping requests).
 */
function fakeFetch() {
  const fake = async (url, options = {}) => {
    const call = { url: String(url), options, request: options.body ? JSON.parse(options.body) : null };
    fake.calls.push(call);
    if (fake.hold && call.url.includes('/subgraph')) {
      await new Promise((resolve, reject) => {
        call.release = resolve;
        options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }
    const { status, body } = fake.override?.(call) || route(url, options);
    return { ok: status < 400, status, json: async () => body };
  };
  fake.calls = [];
  fake.hold = false;
  fake.graphCalls = () => fake.calls.filter(c => c.url.includes('/subgraph'));
  fake.lastGraphRequest = () => fake.graphCalls().at(-1)?.request;
  return fake;
}

// --- Page setup ---------------------------------------------------------------

let run = 0;

/** Load the page at `url` with `initialParams` (what Flask renders), and start app.js. */
async function openPage(t, { url = 'http://localhost/', initialParams = null, storage = {} } = {}) {
  const html = TEMPLATE
    .replace(/\{\{\s*url_for\([^}]*\)\s*\}\}/g, '#')
    .replace(/\{\{\s*initial_params\|tojson\s*\}\}/, JSON.stringify(initialParams));
  const dom = makeDom(html, { url });
  const { window } = dom;
  window.initialParams = initialParams; // the inline script that sets it doesn't run in jsdom
  for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
  window.HTMLCanvasElement.prototype.getContext = () => recordingContext();
  const fetch = fakeFetch();
  const pushes = [];
  const realPush = window.history.pushState.bind(window.history);
  window.history.pushState = (state, title, u) => { pushes.push(u); realPush(state, title, u); };

  Object.assign(globalThis, {
    window, document: window.document, localStorage: window.localStorage, d3, fetch,
    SVGElement: window.SVGElement,
    ResizeObserver: class { observe() {} disconnect() {} },
  });

  await import(`../../static/js/app.js?run=${++run}`);
  const page = { window, document: window.document, fetch, pushes, $: id => window.document.getElementById(id) };
  t.after(async () => {
    window.panditya?.view.destroy();
    await sleep(0);
    window.close();
  });
  return page;
}

/** Poll until `predicate()` is true (or fail after `timeout` ms). */
async function until(predicate, message = 'condition', timeout = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
    await sleep(5);
  }
}

const graphIds = page => page.window.panditya.graph.nodes.map(n => n.id).sort();
const chipIds = (page, rootId) => [...page.$(rootId).querySelectorAll('li.chip')].map(li => li.dataset.id);
const pressedHop = page => page.$('hop-buttons').querySelector('[aria-pressed="true"]').dataset.hops;
const path = page => page.window.location.pathname + page.window.location.search;
const loaded = page => !page.$('app-layout').classList.contains('busy') && page.fetch.graphCalls().length > 0;

async function openWith(t, query, params) {
  const page = await openPage(t, { url: `http://localhost/view?${query}`, initialParams: params });
  await until(() => loaded(page), 'first graph');
  return page;
}

const params = (extra = {}) => ({ authors: [], works: ['89000'], hops: 1, exclude_list: [], expand: [], ...extra });

// --- Tests ---------------------------------------------------------------------

test('empty page: examples to start from, nothing loaded', async t => {
  const page = await openPage(t);
  await until(() => !page.$('graph-status').hidden, 'empty status');
  const status = page.$('graph-status');
  assert.equal(status.className, 'status-empty');
  assert.deepEqual([...status.querySelectorAll('button.example')].map(b => b.textContent), ['Kālidāsa', 'Abhinavagupta', 'Nyāyasāra']);
  assert.equal(page.fetch.calls.length, 0);
  assert.deepEqual([...page.$('hop-buttons').children].map(b => b.textContent), ['0', '1', '2', '3']);
  assert.equal(pressedHop(page), '1');
  assert.ok(!page.document.body.classList.contains('loading'));
});

test('clicking an example loads its graph and records it in the URL', async t => {
  const page = await openPage(t);
  await until(() => !page.$('graph-status').hidden, 'empty status');
  [...page.$('graph-status').querySelectorAll('button')].find(b => b.textContent === 'Nyāyasāra').click();
  await until(() => loaded(page), 'graph');
  assert.deepEqual(page.fetch.lastGraphRequest(), { authors: [], works: ['89000'], hops: 1, exclude_list: [], expand: [] });
  assert.deepEqual(graphIds(page), ['85303', '89000']);
  assert.deepEqual(chipIds(page, 'search'), ['89000']);
  assert.deepEqual(page.pushes, ['/view?works=89000&hops=1']);
  assert.equal(page.$('graph-status').hidden, true);
  assert.equal(page.$('graph-summary').textContent, '2 nodes, 1 link');
});

test('a shared link: names looked up for the chips, graph loaded, URL left alone', async t => {
  const page = await openWith(t, 'authors=85303&hops=2&exclude_list=89001', params({ authors: ['85303'], works: [], hops: 2, exclude_list: ['89001'] }));
  const labelsCall = page.fetch.calls.find(c => c.url.includes('/labels'));
  assert.ok(labelsCall.url.includes(encodeURIComponent('85303,89001')));
  assert.deepEqual(chipIds(page, 'search'), ['85303']);
  assert.equal(page.$('search').querySelector('.chip .entity-name').textContent, 'Bhāsarvajña');
  assert.deepEqual(chipIds(page, 'exclude-search'), ['89001']);
  assert.equal(page.$('exclude-search').querySelector('.chip .entity-name').textContent, 'Nyāyabhūṣaṇa');
  assert.equal(pressedHop(page), '2');
  assert.deepEqual(graphIds(page), ['85303', '89000', '89001'], 'not expanded past 89001');
  assert.deepEqual(page.pushes, []);
});

test('hops beyond the buttons still show as pressed', async t => {
  const page = await openWith(t, 'works=89000&hops=5', params({ hops: 5 }));
  assert.deepEqual([...page.$('hop-buttons').children].map(b => b.textContent), ['0', '1', '2', '3', '5']);
  assert.equal(pressedHop(page), '5');
});

test('SETI collection view: starts with its own repulsion, URL kept', async t => {
  const page = await openPage(t, {
    url: 'http://localhost/seti/by_collection/GRETIL/visualize',
    initialParams: { authors: ['40377'], works: ['40378'], hops: 0, exclude_list: [], expand: [], repulsion: 50 },
  });
  await until(() => loaded(page), 'graph');
  assert.equal(page.$('chargeStrength').value, '50');
  assert.equal(page.window.panditya.view.forces.charge, 50);
  assert.equal(path(page), '/seti/by_collection/GRETIL/visualize');
  assert.deepEqual(graphIds(page), ['40377', '40378']);
});

test('changing hops reloads in place and adds a history entry', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const view = page.window.panditya.view;
  const kept = view.getNode('89000');
  page.$('hop-buttons').querySelector('[data-hops="2"]').click();
  await until(() => page.fetch.graphCalls().length === 2 && loaded(page), 'second graph');
  assert.equal(page.fetch.lastGraphRequest().hops, 2);
  assert.equal(pressedHop(page), '2');
  assert.deepEqual(page.pushes, ['/view?works=89000&hops=2']);
  assert.equal(view.getNode('89000'), kept, 'same node object: the graph changed in place');
  assert.deepEqual(graphIds(page), ['85303', '89000', '89001']);
});

test('pressing the hop that is already on does nothing', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  page.$('hop-buttons').querySelector('[data-hops="1"]').click();
  await sleep(20);
  assert.equal(page.fetch.graphCalls().length, 1);
});

test('typing in the search box and picking a result adds it to the graph', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const input = page.$('search').querySelector('input');
  type(page.window, input, 'Kāli');
  await until(() => page.$('search').querySelectorAll('li[role=option]').length === 1, 'search results');
  assert.ok(page.fetch.calls.some(c => c.url.includes('/search?q=K%C4%81li&type=all')));
  key(page.window, input, 'Enter');
  await until(() => page.fetch.graphCalls().length === 2 && loaded(page), 'graph with both');
  assert.deepEqual(page.fetch.lastGraphRequest().works, ['89000']);
  assert.deepEqual(page.fetch.lastGraphRequest().authors, ['40377']);
  assert.deepEqual(graphIds(page), ['40377', '40378', '85303', '89000']);
  assert.deepEqual(chipIds(page, 'search'), ['89000', '40377']);
});

test('adding a node to "Don\'t expand" sends it as excluded', async t => {
  const page = await openWith(t, 'works=89000&hops=2', params({ hops: 2 }));
  const input = page.$('exclude-search').querySelector('input');
  type(page.window, input, 'Bhās');
  await until(() => page.$('exclude-search').querySelectorAll('li[role=option]').length === 1, 'exclude results');
  key(page.window, input, 'Enter');
  await until(() => page.fetch.graphCalls().length === 2 && loaded(page), 'graph');
  assert.deepEqual(page.fetch.lastGraphRequest().exclude_list, ['85303']);
  assert.deepEqual(graphIds(page), ['85303', '89000']);
});

test('removing the last chip goes back to the empty page', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  page.$('search').querySelector('.chip-remove').click();
  await until(() => page.$('graph-status').className === 'status-empty', 'empty status');
  assert.equal(page.window.panditya.view.nodes.length, 0);
  assert.deepEqual(page.pushes, ['/']);
  assert.equal(page.fetch.graphCalls().length, 1, 'no request for nothing');
});

test('selecting a node opens its details; Escape closes them', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const { view } = page.window.panditya;
  view.onSelect(view.getNode('85303')); // what a click on the node does
  const panel = page.$('detail-panel');
  assert.equal(panel.hidden, false);
  assert.equal(panel.querySelector('.panel-title').textContent, 'Bhāsarvajña');
  assert.equal(view.selectedId, '85303');
  assert.ok(page.document.body.classList.contains('panel-open'));
  assert.match(panel.querySelector('.panel-status').textContent, /1 more connection not shown/);

  key(page.window, page.document.body, 'Escape');
  assert.equal(panel.hidden, true);
  assert.equal(view.selectedId, null);
  assert.ok(!page.document.body.classList.contains('panel-open'));
});

test('clicking empty space closes the details', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const { view } = page.window.panditya;
  view.onSelect(view.getNode('85303'));
  view.onSelect(null);
  assert.equal(page.$('detail-panel').hidden, true);
});

test('Expand in the details panel brings in the hidden connections and refreshes the panel', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const { view } = page.window.panditya;
  view.onSelect(view.getNode('85303'));
  page.$('detail-panel').querySelector('[data-action="expand"]').click();
  await until(() => page.fetch.graphCalls().length === 2 && loaded(page), 'expanded graph');
  assert.deepEqual(page.fetch.lastGraphRequest().expand, ['85303']);
  assert.deepEqual(graphIds(page), ['85303', '89000', '89001']);
  assert.deepEqual(page.pushes, ['/view?works=89000&hops=1&expand=85303']);
  const panel = page.$('detail-panel');
  assert.equal(panel.hidden, false, 'still open on the same node');
  assert.equal(panel.querySelector('[data-action="expand"]'), null, 'nothing left to expand');
  assert.match(panel.querySelector('.panel-connections').textContent, /Nyāyabhūṣaṇa/);
});

test("double-clicking a node expands it; \"Don't expand\" puts it back", async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const { view } = page.window.panditya;
  view.onExpand(view.getNode('85303')); // what a double-click does
  await until(() => page.fetch.graphCalls().length === 2 && loaded(page), 'expanded');
  view.onSelect(view.getNode('85303'));
  page.$('detail-panel').querySelector('[data-action="collapse"]').click();
  await until(() => page.fetch.graphCalls().length === 3 && loaded(page), 'collapsed');
  assert.deepEqual(page.fetch.lastGraphRequest().expand, []);
  assert.deepEqual(page.fetch.lastGraphRequest().exclude_list, ['85303']);
  assert.deepEqual(chipIds(page, 'exclude-search'), ['85303']);
});

test('Recenter starts over from the node', async t => {
  const page = await openWith(t, 'works=89000&hops=1&exclude_list=89002', params({ exclude_list: ['89002'] }));
  const { view } = page.window.panditya;
  view.onSelect(view.getNode('85303'));
  page.$('detail-panel').querySelector('[data-action="recenter"][data-hops="2"]').click();
  await until(() => page.fetch.graphCalls().length === 2 && loaded(page), 'recentred');
  assert.deepEqual(page.fetch.lastGraphRequest(), { authors: ['85303'], works: [], hops: 2, exclude_list: [], expand: [] });
  assert.deepEqual(chipIds(page, 'search'), ['85303']);
  assert.deepEqual(chipIds(page, 'exclude-search'), []);
  assert.equal(pressedHop(page), '2');
});

test('Add to search adds the node as another search term', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const { view } = page.window.panditya;
  view.onSelect(view.getNode('85303'));
  page.$('detail-panel').querySelector('[data-action="add-to-search"]').click();
  await until(() => page.fetch.graphCalls().length === 2 && loaded(page), 'graph');
  assert.deepEqual(chipIds(page, 'search'), ['89000', '85303']);
  assert.deepEqual(page.fetch.lastGraphRequest().authors, ['85303']);
});

test('a connection in the panel selects that node', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const { view } = page.window.panditya;
  view.onSelect(view.getNode('89000'));
  page.$('detail-panel').querySelector('[data-action="select"][data-id="85303"]').click();
  assert.equal(page.$('detail-panel').querySelector('.panel-title').textContent, 'Bhāsarvajña');
  assert.equal(view.selectedId, '85303');
});

test('a server error is shown with a way to try again', async t => {
  const page = await openPage(t, { url: 'http://localhost/view?works=1', initialParams: params({ works: ['1'] }) });
  await until(() => page.$('graph-status').className === 'status-error', 'error');
  assert.match(page.$('graph-status').textContent, /Invalid ID: 1/);
  assert.ok(!page.$('app-layout').classList.contains('busy'));

  page.fetch.override = call => (call.url.includes('/subgraph') ? subgraph({ ...call.request, works: ['89000'] }) : null);
  page.$('graph-status').querySelector('button').click();
  await until(() => page.fetch.graphCalls().length === 2 && loaded(page), 'recovered');
  assert.equal(page.$('graph-status').hidden, true);
  assert.deepEqual(graphIds(page), ['85303', '89000']);
});

test('slow requests show "Loading…" only after a moment', async t => {
  const page = await openPage(t);
  await until(() => !page.$('graph-status').hidden, 'empty status');
  page.fetch.hold = true;
  page.$('graph-status').querySelector('button.example').click();
  await until(() => page.fetch.graphCalls().length === 1, 'request sent');
  assert.equal(page.$('graph-status').hidden, true, 'not straight away');
  assert.ok(page.$('app-layout').classList.contains('busy'));
  await until(() => !page.$('graph-status').hidden, 'loading message', 1000);
  assert.match(page.$('graph-status').textContent, /Loading graph/);
  page.fetch.graphCalls()[0].release();
  await until(() => page.$('graph-status').hidden && loaded(page), 'loaded');
});

test('fast clicks: an older answer never replaces a newer one', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  page.fetch.hold = true;
  page.$('hop-buttons').querySelector('[data-hops="2"]').click();
  page.$('hop-buttons').querySelector('[data-hops="0"]').click();
  await until(() => page.fetch.graphCalls().length === 3, 'both requests');
  const [, older, newer] = page.fetch.graphCalls();
  assert.equal(older.options.signal.aborted, true, 'older request aborted');
  newer.release();
  await until(() => loaded(page), 'newer graph');
  assert.deepEqual(graphIds(page), ['89000']);
  assert.equal(pressedHop(page), '0');
  assert.equal(page.$('graph-status').hidden, true, 'the aborted request shows no error');
});

test('Back and Forward restore earlier graphs', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  page.$('hop-buttons').querySelector('[data-hops="2"]').click();
  await until(() => page.fetch.graphCalls().length === 2 && loaded(page), 'hops 2');
  page.window.history.back();
  await until(() => page.fetch.graphCalls().length === 3 && loaded(page), 'back');
  assert.equal(page.fetch.lastGraphRequest().hops, 1);
  assert.equal(pressedHop(page), '1');
  assert.deepEqual(chipIds(page, 'search'), ['89000']);
  assert.equal(page.$('search').querySelector('.chip .entity-name').textContent, 'Nyāyasāra', 'name kept');
  assert.equal(page.pushes.length, 1, 'going back adds no entry');
  page.window.history.forward();
  await until(() => page.fetch.graphCalls().length === 4 && loaded(page), 'forward');
  assert.equal(page.fetch.lastGraphRequest().hops, 2);
});

test('layout sliders, Freeze and Fit reach the graph', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const { view } = page.window.panditya;
  const slider = page.$('linkDistance');
  slider.value = '300';
  slider.dispatchEvent(new page.window.Event('input'));
  assert.equal(view.forces.distance, 300);

  const freeze = page.$('freezeSwitch');
  freeze.checked = true;
  freeze.dispatchEvent(new page.window.Event('change'));
  assert.equal(view.frozen, true);

  let fits = 0;
  view.fit = () => { fits += 1; };
  page.$('fit-button').click();
  key(page.window, page.document.body, 'f');
  assert.equal(fits, 2);
});

test('keyboard: "/" jumps to search; typing "f" in a box does not fit', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const { view } = page.window.panditya;
  let fits = 0;
  view.fit = () => { fits += 1; };
  const slash = key(page.window, page.document.body, '/');
  assert.ok(slash.defaultPrevented);
  const input = page.$('search').querySelector('input');
  assert.equal(page.document.activeElement, input);
  assert.ok(page.$('sidebar').classList.contains('open'));
  key(page.window, input, 'f');
  assert.equal(fits, 0);
});

test('dark mode toggles, is remembered, and recolours the graph', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const { view } = page.window.panditya;
  let refreshed = 0;
  view.refreshPalette = () => { refreshed += 1; };
  const toggle = page.document.querySelector('.dark-toggle');
  toggle.click();
  assert.equal(page.document.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(page.window.localStorage.getItem('panditya-theme'), 'dark');
  toggle.click();
  assert.equal(page.document.documentElement.getAttribute('data-theme'), null);
  assert.equal(page.window.localStorage.getItem('panditya-theme'), null);
  assert.equal(refreshed, 2);
});

test('a saved dark theme is applied on load', async t => {
  const page = await openPage(t, { storage: { 'panditya-theme': 'dark' } });
  assert.equal(page.document.documentElement.getAttribute('data-theme'), 'dark');
});
