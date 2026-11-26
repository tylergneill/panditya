/**
 * The small view of the Pāṇḍitya widget (templates/widget.html).
 *
 * Deliberately minimal: one search box, and the chosen author or work with its
 * direct connections (1 hop). Clicking a name in the graph moves there. Anything
 * more (hops, Don't expand, the details panel...) is the expanded view, which is
 * the full app; widget-loader.js switches between the two.
 *
 * Starting points come from the URL, filled in by the loader:
 *   /widget?works=89000        a work
 *   /widget?authors=85352      an author
 *   /widget?ids=89000          a Pandit ID of either kind (e.g. from a Pandit link)
 *   /widget?q=Kālidāsa         a search, with its results open
 *
 * After every change the page tells the embedding site which graph is showing
 * (embed.js), so "Expand" and "Open at panditya.info" show the same thing.
 */
import { searchEntities, fetchGraph, fetchLabels } from './api.js';
import { ChipSearch } from './chip-search.js';
import { GraphView } from './graph-view.js';
import { PANDIT_NODE_URL } from './panel.js';
import { emptyState, stateToRequest, stateToUrl } from './state.js';
import { tellEmbedder } from './embed.js';

/** The hops the small view always shows. */
export const WIDGET_HOPS = 1;

const $ = id => document.getElementById(id);

const widget = {
  state: emptyState(WIDGET_HOPS),
  graph: { nodes: [], edges: [] },
  seq: 0,
  controller: null,
};
window.pandityaWidget = widget; // for tests and debugging

/** The one author or work on show, as {id, type, name}; null when nothing is. */
const current = () => widget.state.centers[0] || null;

const view = new GraphView({
  canvas: $('graph-canvas'),
  onSelect: node => {
    if (node && node.id !== current()?.id) show({ id: node.id, type: node.type, name: node.label });
  },
  // A double-click is two clicks, and the first already moved there.
  onExpand: () => {},
});
widget.view = view;
new ResizeObserver(() => view.resize()).observe($('widget-graph'));

const search = new ChipSearch({
  root: $('widget-search'),
  search: (query, signal) => searchEntities(query, { signal }),
  label: 'Search authors and works',
  placeholder: 'Search authors and works…',
  // One at a time: a new pick replaces the old one.
  onChange: items => show(items.at(-1) || null),
});
widget.search = search;

/** Show `entity` ({id, type, name}) and its connections, or the empty view for null. */
async function show(entity) {
  widget.state = { ...emptyState(WIDGET_HOPS), centers: entity ? [entity] : [] };
  search.setItems(entity ? [entity] : []);
  updateFooter();
  tellEmbedder(stateToUrl(widget.state));

  const seq = ++widget.seq;
  widget.controller?.abort();
  if (!entity) {
    widget.graph = { nodes: [], edges: [] };
    view.clear();
    setStatus('Search for an author or work.');
    return;
  }

  const controller = new AbortController();
  widget.controller = controller;
  setStatus('Loading…');
  try {
    const graph = await fetchGraph(stateToRequest(widget.state), { signal: controller.signal });
    if (seq !== widget.seq) return;
    widget.graph = graph;
    view.setGraph(graph);
    setStatus('');
  } catch (err) {
    if (err?.name === 'AbortError' || seq !== widget.seq) return;
    setStatus(err.message || 'Something went wrong while building the graph.');
  }
}

function setStatus(text) {
  const box = $('widget-status');
  box.textContent = text;
  box.hidden = !text;
}

/** The footer names what's on show and links to its Pandit record. */
function updateFooter() {
  const entity = current();
  const link = $('widget-pandit');
  $('widget-current').textContent = entity ? entity.name : '';
  link.hidden = !entity;
  if (entity) {
    link.href = PANDIT_NODE_URL + entity.id;
    link.title = `${entity.name} on panditproject.org`;
  }
}

/** Start from what the URL asks for (see the top of this file). */
async function start(params) {
  const p = params || {};
  const first = (p.works || []).map(id => ({ id, type: 'work' }))[0]
    || (p.authors || []).map(id => ({ id, type: 'author' }))[0]
    || (p.ids || []).map(id => ({ id }))[0];

  if (first) {
    // Names (and, for a bare Pandit ID, the type) come from the server.
    try {
      const [label] = await fetchLabels([first.id]);
      if (label && (!first.type || first.type === label.type)) {
        await show({ id: label.id, type: label.type, name: label.name || label.label });
        return;
      }
    } catch { /* fall through to the message below */ }
    setStatus(`Pandit has no author or work with ID ${first.id}.`);
    return;
  }

  await show(null);
  // Opened empty or on a search: the box is where to type. (Not on touch
  // screens with nothing to search yet, where focus would pop up the keyboard.)
  const touch = window.matchMedia?.('(hover: none)').matches;
  if (p.q || !touch) search.focus();
  if (p.q) {
    search.input.value = p.q;
    await search.runSearch(p.q.trim());
  }
}

widget.ready = start(window.widgetParams);
