/**
 * What the user has asked to see, and how that maps to requests and URLs.
 *
 * The whole graph on screen is derived from one small "state" object:
 *
 *   {
 *     centers: [{id, type, name}],  // the searched-for authors and works
 *     hops:    1,                   // how far out from the centers to go
 *     exclude: ["85201", ...],      // "don't expand" nodes
 *     expand:  ["88590", ...],      // nodes expanded by one extra hop in place
 *   }
 *
 * Every user action is a pure function from one state to the next (below), the
 * server builds the graph for a state (/api/graph/subgraph), and the URL carries
 * the state (/view?works=...&hops=...), so the back button and shared links
 * reproduce exactly what was on screen.
 *
 * Nothing in this module touches the DOM, so it is unit-tested directly
 * (tests/js/state.test.mjs).
 */

/** Hops can be any non-negative integer; the hop buttons show 0..HOP_BUTTONS. */
export const HOP_BUTTONS = 3;

/** A fresh, empty state. */
export function emptyState(hops = 1) {
  return { centers: [], hops, exclude: [], expand: [] };
}

/** Coerce anything hop-like to a non-negative integer, or `fallback`. */
export function normalizeHops(value, fallback = 1) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Drop empty and repeated IDs from a list, keeping first-seen order. */
function uniqueIds(ids) {
  return [...new Set((ids || []).map(String).filter(Boolean))];
}

/**
 * Build a state from the parameters the server renders into the page
 * (`window.initialParams`: {authors, works, hops, exclude_list, expand}).
 * Names are unknown at this point; the caller fills them in from /api/entities/labels.
 */
export function stateFromParams(params) {
  if (!params) return emptyState();
  const centers = [
    ...uniqueIds(params.authors).map(id => ({ id, type: 'author', name: '' })),
    ...uniqueIds(params.works).map(id => ({ id, type: 'work', name: '' })),
  ];
  return {
    centers,
    hops: normalizeHops(params.hops),
    exclude: uniqueIds(params.exclude_list),
    expand: uniqueIds(params.expand),
  };
}

/** The same as stateFromParams, but read from a URL query string ("?works=1,2&hops=2"). */
export function stateFromQuery(search) {
  const q = new URLSearchParams(search);
  const list = key => (q.get(key) || '').split(',');
  if (![...q.keys()].length) return emptyState();
  return stateFromParams({
    authors: list('authors'),
    works: list('works'),
    hops: q.get('hops') ?? 1,
    exclude_list: list('exclude_list'),
    expand: list('expand'),
  });
}

/** The URL path + query that reproduces `state` ("/" when there is nothing to show). */
export function stateToUrl(state) {
  if (!state.centers.length) return '/';
  const ids = type => state.centers.filter(c => c.type === type).map(c => c.id).join(',');
  const parts = [];
  if (ids('author')) parts.push(`authors=${ids('author')}`);
  if (ids('work')) parts.push(`works=${ids('work')}`);
  parts.push(`hops=${state.hops}`);
  if (state.exclude.length) parts.push(`exclude_list=${state.exclude.join(',')}`);
  if (state.expand.length) parts.push(`expand=${state.expand.join(',')}`);
  return `/view?${parts.join('&')}`;
}

/** The JSON body for POST /api/graph/subgraph. */
export function stateToRequest(state) {
  return {
    authors: state.centers.filter(c => c.type === 'author').map(c => c.id),
    works: state.centers.filter(c => c.type === 'work').map(c => c.id),
    hops: state.hops,
    exclude_list: [...state.exclude],
    expand: [...state.expand],
  };
}

/** True when two states would produce the same graph (names don't matter). */
export function sameGraph(a, b) {
  return stateToUrl(a) === stateToUrl(b);
}

// --- Actions -----------------------------------------------------------------
// Each returns a new state and never modifies its input.
//
// Rule of thumb: changing the search (centers) or the hops starts a new
// exploration, so in-place expansions are dropped; "don't expand" choices are
// kept, as the old Don't Expand box kept them.

/** Replace the searched-for entities (from the search box). */
export function setCenters(state, centers) {
  const seen = new Set();
  const unique = centers.filter(c => !seen.has(c.id) && seen.add(c.id));
  const changed = unique.map(c => c.id).join() !== state.centers.map(c => c.id).join();
  return { ...state, centers: unique, expand: changed ? [] : state.expand };
}

/** Add one entity to the search, unless it is already there. */
export function addCenter(state, entity) {
  if (state.centers.some(c => c.id === entity.id)) return state;
  return setCenters(state, [...state.centers, { id: entity.id, type: entity.type, name: entity.name || '' }]);
}

/** Set how many hops out from the centers to go. */
export function setHops(state, hops) {
  const n = normalizeHops(hops, state.hops);
  return n === state.hops ? state : { ...state, hops: n, expand: [] };
}

/** Replace the "don't expand" list (from its search box). */
export function setExclude(state, ids) {
  const exclude = uniqueIds(ids);
  return { ...state, exclude, expand: state.expand.filter(id => !exclude.includes(id)) };
}

/** Show one more hop around `id`, in place. Overrides "don't expand" for it. */
export function expandNode(state, id) {
  return {
    ...state,
    exclude: state.exclude.filter(x => x !== id),
    expand: state.expand.includes(id) ? state.expand : [...state.expand, id],
  };
}

/** Stop expanding `id`: hide whatever only it brought in. */
export function collapseNode(state, id) {
  return {
    ...state,
    exclude: state.exclude.includes(id) ? state.exclude : [...state.exclude, id],
    expand: state.expand.filter(x => x !== id),
  };
}

/** Start over around a single node (the old "Recenter" menu). */
export function recenter(state, node, hops = state.hops) {
  return {
    centers: [{ id: node.id, type: node.type, name: node.label || node.name || '' }],
    hops: normalizeHops(hops, state.hops),
    exclude: [],
    expand: [],
  };
}

/**
 * Fill in center names from a list of {id, name, type} (a labels response).
 * The type from the server wins, so an author ID given as `works=` in a URL
 * still ends up as an author.
 */
export function withNames(state, entities) {
  const known = new Map(entities.map(e => [String(e.id), e]));
  return {
    ...state,
    centers: state.centers.map(c => {
      const e = known.get(c.id);
      return { ...c, name: c.name || e?.name || e?.label || c.id, type: e?.type || c.type };
    }),
  };
}
