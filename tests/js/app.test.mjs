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
function subgraph({ authors, works, hops, exclude_list: exclude, expand, remove = [] }) {
  for (const id of [...authors, ...works, ...exclude, ...expand, ...remove]) {
    if (!ENTITIES[id]) return { status: 400, body: { error: `Invalid ID: ${id}` } };
  }
  const centers = [...authors, ...works];
  const removed = remove.filter(id => !centers.includes(id)); // as grapher.construct_graph
  const stop = [...exclude, ...removed];
  const ids = new Set(centers);
  let frontier = [...centers];
  for (let h = 0; h < hops; h++) {
    const next = [];
    for (const id of frontier) {
      if (stop.includes(id) && !centers.includes(id)) continue;
      for (const n of neighbours(id)) if (!ids.has(n)) { ids.add(n); next.push(n); }
    }
    frontier = next;
  }
  for (const id of expand) if (!removed.includes(id)) for (const n of neighbours(id)) ids.add(n);
  for (const id of removed) ids.delete(id);
  const nodes = [...ids].map(id => ({
    id,
    type: ENTITIES[id].type,
    label: ENTITIES[id].name,
    dates: ENTITIES[id].dates || '',
    is_central: centers.includes(id),
    is_excluded: exclude.includes(id) && !expand.includes(id),
    is_expanded: expand.includes(id),
    hidden_neighbors: neighbours(id).filter(n => !ids.has(n) && !removed.includes(n)).length,
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
/** The hops value the control shows: a pressed button, or the number in the box. */
const pressedHop = page => {
  const pressed = [...page.$('hop-buttons').querySelectorAll('button[aria-pressed="true"]')];
  const input = page.$('hop-input');
  if (input.classList.contains('active')) {
    assert.equal(pressed.length, 0, 'no button pressed while the box is in use');
    return input.value;
  }
  assert.equal(pressed.length, 1, 'exactly one hop button pressed');
  return pressed[0].dataset.hops;
};
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
  assert.deepEqual([...page.$('hop-buttons').querySelectorAll('button')].map(b => b.textContent), ['0', '1', '2', '3']);
  assert.equal(page.$('hop-input').placeholder, '4+');
  assert.equal(page.$('hop-input').value, '');
  assert.equal(pressedHop(page), '1');
  assert.ok(!page.document.body.classList.contains('loading'));
});

test('a later visit to the empty page shows no examples', async t => {
  const page = await openPage(t, { storage: { 'panditya-examples-seen': '1' } });
  await until(() => page.$('graph-status').className === 'status-empty', 'empty status');
  assert.equal(page.$('graph-status').hidden, true);
  assert.equal(page.$('graph-status').querySelectorAll('button.example').length, 0);
});

test('clicking an example loads its graph and records it in the URL', async t => {
  const page = await openPage(t);
  await until(() => !page.$('graph-status').hidden, 'empty status');
  [...page.$('graph-status').querySelectorAll('button')].find(b => b.textContent === 'Nyāyasāra').click();
  await until(() => loaded(page), 'graph');
  assert.deepEqual(page.fetch.lastGraphRequest(), { authors: [], works: ['89000'], hops: 1, exclude_list: [], expand: [], remove: [] });
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

test('hops beyond the buttons show in the box', async t => {
  const page = await openWith(t, 'works=89000&hops=5', params({ hops: 5 }));
  assert.equal(page.$('hop-input').value, '5');
  assert.equal(pressedHop(page), '5');
});

/** Type `text` in the hops box and press `keyName` there. */
function typeHops(page, text, keyName = 'Enter') {
  const input = page.$('hop-input');
  input.focus();
  input.value = text;
  return key(page.window, input, keyName);
}

test('typing a number of hops and pressing Enter applies it', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  typeHops(page, ' 7 ');
  await until(() => page.fetch.graphCalls().length === 2 && loaded(page), 'graph');
  assert.equal(page.fetch.lastGraphRequest().hops, 7);
  assert.deepEqual(page.pushes, ['/view?works=89000&hops=7']);
  assert.equal(pressedHop(page), '7');
  assert.notEqual(page.document.activeElement, page.$('hop-input'), 'box let go of focus');

  // Back to a button: the box empties.
  page.$('hop-buttons').querySelector('[data-hops="2"]').click();
  await until(() => page.fetch.graphCalls().length === 3 && loaded(page), 'graph');
  assert.equal(page.$('hop-input').value, '');
  assert.equal(pressedHop(page), '2');
});

test('a small number typed in the box presses its button', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  typeHops(page, '0');
  await until(() => page.fetch.graphCalls().length === 2 && loaded(page), 'graph');
  assert.equal(pressedHop(page), '0');
  assert.equal(page.$('hop-input').value, '');
});

test('anything but a whole number in the hops box is undone', async t => {
  const page = await openWith(t, 'works=89000&hops=5', params({ hops: 5 }));
  for (const bad of ['abc', '-1', '2.5', '', '1e3']) {
    typeHops(page, bad);
    assert.equal(page.$('hop-input').value, '5', `"${bad}" undone`);
  }
  await sleep(20);
  assert.equal(page.fetch.graphCalls().length, 1, 'no requests');
});

test('the hops box also applies when it loses focus (change)', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const input = page.$('hop-input');
  input.focus();
  input.value = '4';
  input.dispatchEvent(new page.window.Event('change'));
  await until(() => page.fetch.graphCalls().length === 2 && loaded(page), 'graph');
  assert.equal(page.fetch.lastGraphRequest().hops, 4);
});

test('Escape in the hops box undoes the typing and leaves the panel open', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const { view } = page.window.panditya;
  view.onSelect(view.getNode('85303'));
  const esc = typeHops(page, '9', 'Escape');
  assert.equal(page.$('hop-input').value, '');
  assert.equal(page.$('detail-panel').hidden, false);
  await sleep(20);
  assert.equal(page.fetch.graphCalls().length, 1);
  assert.equal(pressedHop(page), '1');
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

test('on a phone, Enter in the search box closes the controls and the keyboard', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  let narrow = false;
  page.window.matchMedia = () => ({ matches: narrow });
  const input = page.$('search').querySelector('input');
  page.$('sidebar').classList.add('open');

  type(page.window, input, 'Kāli');
  await until(() => page.$('search').querySelectorAll('li[role=option]').length === 1, 'search results');
  key(page.window, input, 'Enter');
  assert.ok(page.$('sidebar').classList.contains('open'), 'wide screen: controls stay');

  narrow = true;
  type(page.window, input, 'Bhāsa');
  key(page.window, input, 'Enter'); // before the results come back
  await until(() => !page.$('sidebar').classList.contains('open'), 'controls closed');
  assert.notEqual(page.document.activeElement, input, 'keyboard dismissed');
  await until(() => page.fetch.graphCalls().length === 3 && loaded(page), 'graph with the new search');
  assert.deepEqual(chipIds(page, 'search'), ['89000', '40377', '85303']);
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

test('removing the last chip goes back to an empty page, without the examples this time', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  assert.equal(page.window.localStorage.getItem('panditya-examples-seen'), '1');
  page.$('search').querySelector('.chip-remove').click();
  await until(() => page.$('graph-status').className === 'status-empty', 'empty status');
  assert.equal(page.$('graph-status').hidden, true);
  assert.equal(page.$('graph-status').querySelectorAll('button.example').length, 0);
  assert.equal(page.window.panditya.view.nodes.length, 0);
  assert.deepEqual(page.pushes, ['/']);
  assert.equal(page.fetch.graphCalls().length, 1, 'no request for nothing');
});

test('clicking the name starts over with a blank page; Back returns to the graph', async t => {
  const page = await openWith(t, 'works=89000&hops=2&remove=89001', params({ hops: 2, remove: ['89001'] }));
  const link = page.$('sidebar-header').querySelector('.home-link');
  assert.equal(link.getAttribute('href'), '/');
  page.$('search').querySelector('input').value = 'half-typed';
  const click = new page.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  link.dispatchEvent(click);
  assert.ok(click.defaultPrevented, 'no page reload');
  await until(() => page.$('graph-status').className === 'status-empty', 'blank page');
  assert.equal(page.window.panditya.view.nodes.length, 0);
  assert.deepEqual(chipIds(page, 'search'), []);
  assert.deepEqual(chipIds(page, 'removed-search'), []);
  assert.equal(page.$('search').querySelector('input').value, '');
  assert.equal(pressedHop(page), '1');
  assert.deepEqual(page.pushes, ['/']);

  page.window.history.back();
  await until(() => page.fetch.graphCalls().length === 2 && loaded(page), 'graph again');
  assert.deepEqual(chipIds(page, 'search'), ['89000']);
});

test('a modified click on the name is left to the browser (new tab)', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const click = new page.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true });
  page.$('mobile-header').querySelector('.home-link').dispatchEvent(click);
  assert.ok(!click.defaultPrevented);
  assert.deepEqual(chipIds(page, 'search'), ['89000']);
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
  assert.deepEqual(page.fetch.lastGraphRequest(), { authors: ['85303'], works: [], hops: 2, exclude_list: [], expand: [], remove: [] });
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

test('Remove takes a node off the graph and puts it in the Removed box', async t => {
  const page = await openWith(t, 'works=89000&hops=2', params({ hops: 2 }));
  assert.deepEqual(graphIds(page), ['85303', '89000', '89001']);
  const { view } = page.window.panditya;
  view.onSelect(view.getNode('85303'));
  page.$('detail-panel').querySelector('[data-action="remove"]').click();
  await until(() => page.fetch.graphCalls().length === 2 && loaded(page), 'graph without it');
  assert.deepEqual(page.fetch.lastGraphRequest().remove, ['85303']);
  assert.deepEqual(graphIds(page), ['89000'], 'and 89001, only there through it');
  assert.deepEqual(page.pushes, ['/view?works=89000&hops=2&remove=85303']);
  assert.deepEqual(chipIds(page, 'removed-search'), ['85303']);
  assert.equal(page.$('removed-search').querySelector('.chip .entity-name').textContent, 'Bhāsarvajña');
  assert.equal(page.$('detail-panel').hidden, true, 'its panel closes');

  // × in the Removed box brings it back.
  page.$('removed-search').querySelector('.chip-remove').click();
  await until(() => page.fetch.graphCalls().length === 3 && loaded(page), 'graph with it again');
  assert.deepEqual(page.fetch.lastGraphRequest().remove, []);
  assert.deepEqual(graphIds(page), ['85303', '89000', '89001']);
});

test('Delete removes the selected node; removing a searched-for node takes it out of the search', async t => {
  const page = await openWith(t, 'works=89000&authors=40377&hops=1', params({ authors: ['40377'] }));
  const { view } = page.window.panditya;
  view.onSelect(view.getNode('40377'));
  assert.match(page.$('detail-panel').querySelector('[data-action="remove"]').title, /out of the search/);
  const del = key(page.window, page.document.body, 'Delete');
  assert.ok(del.defaultPrevented);
  await until(() => page.fetch.graphCalls().length === 2 && loaded(page), 'graph');
  assert.deepEqual(page.fetch.lastGraphRequest().authors, []);
  assert.deepEqual(page.fetch.lastGraphRequest().remove, []);
  assert.deepEqual(chipIds(page, 'search'), ['89000']);
  assert.deepEqual(chipIds(page, 'removed-search'), []);
});

test('Delete while typing in a box does nothing to the graph', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const { view } = page.window.panditya;
  view.onSelect(view.getNode('85303'));
  key(page.window, page.$('search').querySelector('input'), 'Delete');
  await sleep(20);
  assert.equal(page.fetch.graphCalls().length, 1);
});

test('a shared link with removed nodes shows their names in the Removed box', async t => {
  const page = await openWith(t, 'works=89000&hops=2&remove=85303', params({ hops: 2, remove: ['85303'] }));
  assert.deepEqual(page.fetch.lastGraphRequest().remove, ['85303']);
  assert.equal(page.$('removed-search').querySelector('.chip .entity-name').textContent, 'Bhāsarvajña');
  assert.deepEqual(graphIds(page), ['89000']);
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

test('on a phone, Fit closes the controls so the graph can be seen', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  let narrow = false;
  page.window.matchMedia = () => ({ matches: narrow });
  page.$('sidebar').classList.add('open');
  page.$('fit-button').click();
  assert.ok(page.$('sidebar').classList.contains('open'), 'wide screen: sidebar stays');
  narrow = true;
  page.$('fit-button').click();
  assert.ok(!page.$('sidebar').classList.contains('open'));
});

test('Layout starts open; closing it is remembered', async t => {
  const page = await openPage(t);
  const details = page.$('layout-controls');
  assert.equal(details.open, true);
  details.open = false;
  details.dispatchEvent(new page.window.Event('toggle'));
  assert.equal(page.window.localStorage.getItem('panditya-layout-closed'), '1');
  details.open = true;
  details.dispatchEvent(new page.window.Event('toggle'));
  assert.equal(page.window.localStorage.getItem('panditya-layout-closed'), null);
});

test('Layout stays closed on the next visit if it was closed', async t => {
  const page = await openPage(t, { storage: { 'panditya-layout-closed': '1' } });
  assert.equal(page.$('layout-controls').open, false);
});

test('on a phone, a tap on the graph below the open controls closes them and does nothing else', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const { view } = page.window.panditya;
  let narrow = true;
  page.window.matchMedia = () => ({ matches: narrow });
  const canvas = page.$('graph-canvas');
  const input = page.$('search').querySelector('input');
  const seen = [];
  canvas.addEventListener('pointerdown', () => seen.push('pointerdown'));
  canvas.addEventListener('click', () => seen.push('click'));

  page.$('sidebar').classList.add('open');
  input.focus();
  const down = new page.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  canvas.addEventListener('touchstart', () => seen.push('touchstart'));
  canvas.dispatchEvent(down);
  canvas.dispatchEvent(new page.window.Event('touchstart', { bubbles: true, cancelable: true }));
  canvas.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.ok(!page.$('sidebar').classList.contains('open'));
  assert.notEqual(page.document.activeElement, input, 'keyboard dismissed');
  assert.ok(down.defaultPrevented);
  assert.deepEqual(seen, [], 'the graph never saw the tap');
  assert.equal(view.selectedId, null);

  // Controls closed: taps reach the graph again.
  canvas.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepEqual(seen, ['click']);

  // Wide screen: an open sidebar doesn't get in the way.
  narrow = false;
  page.$('sidebar').classList.add('open');
  canvas.dispatchEvent(new page.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
  assert.ok(page.$('sidebar').classList.contains('open'));
});

test('Reset puts the sliders and Freeze back and lays the graph out again', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const { view } = page.window.panditya;
  const calls = [];
  const real = view.resetLayout.bind(view);
  view.resetLayout = forces => { calls.push(forces); real(forces); };

  for (const [id, value] of [['chargeStrength', '600'], ['linkDistance', '400'], ['collisionRadius', '40']]) {
    page.$(id).value = value;
    page.$(id).dispatchEvent(new page.window.Event('input'));
  }
  page.$('freezeSwitch').checked = true;
  page.$('freezeSwitch').dispatchEvent(new page.window.Event('change'));
  view.getNode('89000').fx = 123; // as if dragged while frozen

  page.$('reset-layout-button').click();
  assert.deepEqual(calls, [{ charge: 250, distance: 100, collide: 15 }]);
  assert.deepEqual(['chargeStrength', 'linkDistance', 'collisionRadius'].map(id => page.$(id).value), ['250', '100', '15']);
  assert.equal(page.$('freezeSwitch').checked, false);
  assert.equal(view.frozen, false);
  assert.equal(view.getNode('89000').fx, null);
  assert.deepEqual(view.forces, { charge: 250, distance: 100, collide: 15 });
});

test('Reset on a SETI collection view goes back to its own repulsion', async t => {
  const page = await openPage(t, {
    url: 'http://localhost/seti/by_collection/GRETIL/visualize',
    initialParams: { authors: ['40377'], works: ['40378'], hops: 0, exclude_list: [], expand: [], repulsion: 50 },
  });
  await until(() => loaded(page), 'graph');
  page.$('chargeStrength').value = '700';
  page.$('chargeStrength').dispatchEvent(new page.window.Event('input'));
  page.$('reset-layout-button').click();
  assert.equal(page.$('chargeStrength').value, '50');
  assert.equal(page.window.panditya.view.forces.charge, 50);
});

test('the − A + buttons size the names on the graph, and are remembered', async t => {
  const page = await openWith(t, 'works=89000&hops=1', params());
  const { view } = page.window.panditya;
  assert.equal(page.document.querySelectorAll('.font-size-control').length, 2, 'sidebar header, and Layout for phones');
  assert.equal(page.document.querySelectorAll('#mobile-header .font-size-control').length, 0, 'phone header has no room');
  assert.equal(view.labelScale, 1);
  page.document.querySelector('#sidebar-header [data-font="up"]').click();
  assert.equal(view.labelScale, 1.15);
  assert.equal(page.window.localStorage.getItem('panditya-label-scale'), '1.15');
  page.document.querySelector('#layout-controls [data-font="reset"]').click();
  assert.equal(view.labelScale, 1);
});

test('the sidebar starts at its remembered width', async t => {
  const page = await openPage(t, { storage: { 'panditya-sidebar-width': '400' } });
  const handle = page.$('sidebar-resizer');
  assert.equal(handle.getAttribute('role'), 'separator');
  assert.equal(page.$('app-layout').style.getPropertyValue('--sidebar-width'), '400px');
  assert.equal(handle.getAttribute('aria-valuenow'), '400');
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
  const labels = () => [...page.document.querySelectorAll('.dark-toggle')].map(b => [b.title, b.getAttribute('aria-label')]);
  assert.ok(toggle.querySelector('.icon-moon') && toggle.querySelector('.icon-sun'), 'CSS picks the icon from data-theme');
  assert.deepEqual(labels(), [['Switch to dark mode', 'Switch to dark mode'], ['Switch to dark mode', 'Switch to dark mode']]);
  toggle.click();
  assert.equal(page.document.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(page.window.localStorage.getItem('panditya-theme'), 'dark');
  assert.deepEqual(labels(), [['Switch to light mode', 'Switch to light mode'], ['Switch to light mode', 'Switch to light mode']]);
  toggle.click();
  assert.equal(page.document.documentElement.getAttribute('data-theme'), null);
  assert.equal(page.window.localStorage.getItem('panditya-theme'), null);
  assert.equal(refreshed, 2);
});

test('a saved dark theme is applied on load', async t => {
  const page = await openPage(t, { storage: { 'panditya-theme': 'dark' } });
  assert.equal(page.document.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(page.document.querySelector('.dark-toggle').title, 'Switch to light mode');
});
