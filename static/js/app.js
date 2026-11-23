/**
 * Pāṇḍitya main page: wires the search boxes, controls, graph and details panel
 * together around one `state` (see state.js).
 *
 * The flow for every user action is the same:
 *
 *   action → new state → POST /api/graph/subgraph → GraphView.setGraph (in place)
 *                      → URL updated (so Back and shared links work)
 *
 * Requests are numbered and the previous one is aborted, so a fast series of
 * clicks can never leave an older graph on screen.
 */

import {
  emptyState, stateFromParams, stateFromQuery, stateToUrl, stateToRequest, sameGraph,
  setCenters, addCenter, setHops, setExclude, expandNode, collapseNode, recenter, withNames,
  HOP_BUTTONS,
} from './state.js';
import { searchEntities, fetchLabels, fetchGraph } from './api.js';
import { ChipSearch } from './chip-search.js';
import { DetailPanel } from './panel.js';
import { GraphView, DEFAULT_FORCES } from './graph-view.js';

/** Wait this long before showing "Loading…", so quick answers don't flash it. */
const LOADING_DELAY_MS = 250;

/** Shown on an empty page as one-click starting points: [id, type, name]. */
const EXAMPLES = [
  ['40377', 'author', 'Kālidāsa'],
  ['85352', 'author', 'Abhinavagupta'],
  ['89000', 'work', 'Nyāyasāra'],
];

const $ = id => document.getElementById(id);

const app = {
  state: emptyState(),
  graph: { nodes: [], edges: [] },
  seq: 0,
  controller: null,
  names: new Map(), // id → {id, type, name, dates}: names for chips, from any source
};

let view;
let panel;
let mainSearch;
let excludeSearch;

// --- Status overlay (loading / error / empty) ---------------------------------

let loadingTimer = null;

function setStatus(kind, message = '') {
  const box = $('graph-status');
  clearTimeout(loadingTimer);
  box.className = kind ? `status-${kind}` : '';
  box.replaceChildren();
  if (!kind) {
    box.hidden = true;
    return;
  }
  if (kind === 'loading') {
    // Only show it if the request is still running after a moment.
    box.hidden = true;
    loadingTimer = setTimeout(() => {
      box.hidden = false;
      box.append(Object.assign(document.createElement('span'), { className: 'spinner' }),
        document.createTextNode(' Loading graph…'));
    }, LOADING_DELAY_MS);
    return;
  }
  box.hidden = false;
  if (kind === 'empty') {
    const p = document.createElement('p');
    p.textContent = 'Search for an author or work to start. For example:';
    const examples = document.createElement('div');
    examples.className = 'examples';
    for (const [id, type, name] of EXAMPLES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `example ${type}`;
      b.textContent = name;
      b.addEventListener('click', () => commit(addCenter(app.state, { id, type, name })));
      examples.append(b);
    }
    box.append(p, examples);
  } else {
    const p = document.createElement('p');
    p.textContent = message;
    box.append(p);
    if (kind === 'error') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => load({ history: 'none' }));
      box.append(retry);
    }
  }
}

// --- Names (for chips) ----------------------------------------------------------

function remember(entities) {
  for (const e of entities) {
    if (!e?.id) continue;
    app.names.set(String(e.id), {
      id: String(e.id), type: e.type, name: e.name || e.label || String(e.id), dates: e.dates || '',
    });
  }
}

function chipFor(id, fallbackType = 'work') {
  return app.names.get(id) || { id, type: fallbackType, name: id };
}

/** Look up names for IDs we don't know yet (e.g. from a shared URL). */
async function learnNames(ids) {
  const unknown = ids.filter(id => !app.names.has(id));
  if (!unknown.length) return;
  try {
    remember(await fetchLabels(unknown));
  } catch {
    // Unknown IDs: the graph request will report them.
  }
}

// --- State → controls --------------------------------------------------------

function syncControls() {
  const { state } = app;
  mainSearch.setItems(state.centers.map(c => ({ ...chipFor(c.id, c.type), ...c, name: c.name || chipFor(c.id).name })));
  excludeSearch.setItems(state.exclude.map(id => chipFor(id)));
  renderHopButtons();
}

function renderHopButtons() {
  const box = $('hop-buttons');
  const values = [...Array(HOP_BUTTONS + 1).keys()];
  if (!values.includes(app.state.hops)) values.push(app.state.hops);
  box.replaceChildren(...values.map(h => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = String(h);
    b.dataset.hops = String(h);
    b.setAttribute('aria-pressed', String(h === app.state.hops));
    b.title = h === 0 ? 'Only what you searched for' : `${h} step${h > 1 ? 's' : ''} out from what you searched for`;
    return b;
  }));
}

// --- Loading -------------------------------------------------------------------

/**
 * Move to `next` and load its graph.
 * @param {'push'|'replace'|'none'} history how to record it in the browser history
 */
function commit(next, { history = 'push' } = {}) {
  const changed = !sameGraph(app.state, next);
  app.state = next;
  remember(next.centers);
  syncControls();
  if (changed) load({ history });
}

async function load({ history = 'push' } = {}) {
  const seq = ++app.seq;
  app.controller?.abort();
  const { state } = app;

  if (!state.centers.length) {
    app.graph = { nodes: [], edges: [] };
    view.clear();
    closePanel();
    updateUrl(history);
    setStatus('empty');
    return;
  }

  const controller = new AbortController();
  app.controller = controller;
  setStatus('loading');
  $('app-layout').classList.add('busy');
  try {
    const graph = await fetchGraph(stateToRequest(state), { signal: controller.signal });
    if (seq !== app.seq) return;
    app.graph = graph;
    remember(graph.nodes);
    view.setGraph(graph);
    refreshPanel();
    updateUrl(history);
    setStatus(null);
    $('graph-summary').textContent = `${graph.nodes.length} node${graph.nodes.length === 1 ? '' : 's'}, ${graph.edges.length} link${graph.edges.length === 1 ? '' : 's'}`;
  } catch (err) {
    if (err?.name === 'AbortError' || seq !== app.seq) return;
    setStatus('error', err.message || 'Something went wrong while building the graph.');
  } finally {
    if (seq === app.seq) $('app-layout').classList.remove('busy');
  }
}

function updateUrl(mode) {
  if (mode === 'none') return;
  const url = stateToUrl(app.state);
  if (url === window.location.pathname + window.location.search) return;
  if (mode === 'replace') window.history.replaceState({ panditya: true }, '', url);
  else window.history.pushState({ panditya: true }, '', url);
}

// --- Selection and the details panel -------------------------------------------

function openPanel(node) {
  if (!node) {
    closePanel();
    return;
  }
  view.select(node.id);
  panel.show(node, {
    nodes: app.graph.nodes,
    edges: app.graph.edges,
    isCenter: app.state.centers.some(c => c.id === node.id),
  });
  document.body.classList.add('panel-open');
}

function closePanel() {
  panel.hide();
  view.select(null);
  document.body.classList.remove('panel-open');
}

/** After a reload, show the selected node's fresh data, or close if it's gone. */
function refreshPanel() {
  if (!panel.isOpen || !panel.node) return;
  const node = view.getNode(panel.node.id);
  if (node) openPanel(node);
  else closePanel();
}

function onPanelAction(action, { node, id, hops }) {
  switch (action) {
    case 'close':
      closePanel();
      break;
    case 'select': {
      const target = view.getNode(id);
      if (target) {
        openPanel(target);
        view.centerOn(id);
      }
      break;
    }
    case 'expand':
      commit(expandNode(app.state, node.id));
      break;
    case 'collapse':
      commit(collapseNode(app.state, node.id));
      break;
    case 'recenter':
      commit(recenter(app.state, node, hops));
      break;
    case 'add-to-search':
      commit(addCenter(app.state, { id: node.id, type: node.type, name: node.label }));
      break;
    default:
      break;
  }
}

// --- Setup -----------------------------------------------------------------------

function setUpLayoutControls(initialRepulsion) {
  const sliders = { chargeStrength: 'charge', linkDistance: 'distance', collisionRadius: 'collide' };
  const defaults = { ...DEFAULT_FORCES };
  if (initialRepulsion !== undefined) defaults.charge = Number(initialRepulsion);
  for (const [elementId, force] of Object.entries(sliders)) {
    const input = $(elementId);
    input.value = defaults[force];
    input.addEventListener('input', () => view.setForces({ [force]: Number(input.value) }));
  }
  view.setForces(defaults);
  $('freezeSwitch').addEventListener('change', e => view.setFrozen(e.target.checked));
  $('fit-button').addEventListener('click', () => view.fit());
  $('hop-buttons').addEventListener('click', e => {
    const b = e.target.closest('button[data-hops]');
    if (b) commit(setHops(app.state, b.dataset.hops));
  });
}

function setUpTheme() {
  if (localStorage.getItem('panditya-theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  const toggle = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (dark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('panditya-theme');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('panditya-theme', 'dark');
    }
    view?.refreshPalette();
  };
  document.querySelectorAll('.dark-toggle').forEach(b => b.addEventListener('click', toggle));
}

function setUpKeyboard() {
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key === 'Escape' && panel.isOpen) {
      closePanel();
    } else if (!typing && e.key === '/') {
      e.preventDefault();
      document.getElementById('sidebar').classList.add('open');
      mainSearch.focus();
    } else if (!typing && (e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey) {
      view.fit();
    }
  });
}

async function init() {
  setUpTheme();

  const canvas = $('graph-canvas');
  view = new GraphView({
    canvas,
    onSelect: node => openPanel(node),
    onExpand: node => commit(expandNode(app.state, node.id)),
  });
  new ResizeObserver(() => view.resize()).observe($('graph-container'));

  panel = new DetailPanel({ root: $('detail-panel'), onAction: onPanelAction });

  const search = type => (query, signal) => searchEntities(query, { type, signal });
  mainSearch = new ChipSearch({
    root: $('search'),
    search: search('all'),
    label: 'Search authors and works',
    placeholder: 'Search authors and works…',
    onChange: items => {
      remember(items);
      commit(setCenters(app.state, items.map(i => ({ id: i.id, type: i.type, name: i.name }))));
    },
  });
  excludeSearch = new ChipSearch({
    root: $('exclude-search'),
    search: search('all'),
    label: "Don't expand",
    placeholder: 'Nodes not to expand…',
    onChange: items => {
      remember(items);
      commit(setExclude(app.state, items.map(i => i.id)));
    },
  });

  const params = window.initialParams || null;
  setUpLayoutControls(params?.repulsion);
  setUpKeyboard();

  $('sidebar-toggle')?.addEventListener('click', () => $('sidebar').classList.toggle('open'));
  window.addEventListener('popstate', async () => {
    if (!/^\/(view)?$/.test(window.location.pathname)) {
      window.location.reload();
      return;
    }
    const next = stateFromQuery(window.location.search);
    await learnNames([...next.centers.map(c => c.id), ...next.exclude]);
    app.state = withNames(next, [...app.names.values()]);
    syncControls();
    load({ history: 'none' });
  });

  // Debugging handle for the browser console.
  window.panditya = { view, get state() { return app.state; }, get graph() { return app.graph; } };

  document.body.classList.remove('loading');
  if (params) {
    const start = stateFromParams(params);
    await learnNames([...start.centers.map(c => c.id), ...start.exclude]);
    app.state = withNames(start, [...app.names.values()]);
    syncControls();
    await load({ history: 'none' });
  } else {
    syncControls();
    setStatus('empty');
  }
}

init();
