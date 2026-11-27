/**
 * What the user has asked to see, and how that maps to requests and URLs.
 *
 * The whole graph on screen is derived from one small "state" object:
 *
 *   {
 *     centers: [{id, type, name}],  // the searched-for authors, works and SETI collections
 *     hops:    1,                   // how far out from the centers to go
 *     exclude: ["85201", ...],      // "don't expand" nodes
 *     expand:  ["88590", ...],      // nodes expanded by one extra hop in place
 *     remove:  ["85212", ...],      // nodes taken off the graph (with what only they brought in)
 *   }
 *
 * Every user action is a pure function from one state to the next (below), the
 * server builds the graph for a state (/api/graph/subgraph), and the URL carries
 * the state (/view?works=...&hops=...), so the back button and shared links
 * reproduce exactly what was on screen.
 *
 * A SETI collection is a center of type 'collection' (see collectionCenter): the
 * server puts all of its works in the search, so the URL stays as short as
 * "/view?collection=GRETIL&hops=0" however many works the collection has.
 *
 * Nothing in this module touches the DOM, so it is unit-tested directly
 * (tests/js/state.test.mjs).
 */

/** Hops can be any non-negative integer; the hop buttons show 0..HOP_BUTTONS. */
export const HOP_BUTTONS = 3;

/** A fresh, empty state. */
export function emptyState(hops = 1) {
  return { centers: [], hops, exclude: [], expand: [], remove: [] };
}

/** The removed IDs of a state (states made before `remove` existed have none). */
const removedIn = state => state.remove || [];

/** Coerce anything hop-like to a non-negative integer, or `fallback`. */
export function normalizeHops(value, fallback = 1) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Collection centers have IDs like "collection:GRETIL", so they never clash with Pandit IDs. */
const COLLECTION_PREFIX = 'collection:';

/** The center for a SETI collection, by its name ("GRETIL"). */
export function collectionCenter(name) {
  return { id: COLLECTION_PREFIX + name, type: 'collection', name };
}

/** True for a collection center's ID (these have no Pandit record to look up). */
export function isCollectionId(id) {
  return String(id).startsWith(COLLECTION_PREFIX);
}

/** The collection names among a state's centers. */
const collectionsIn = state =>
  state.centers.filter(c => c.type === 'collection').map(c => c.id.slice(COLLECTION_PREFIX.length));

/** Drop empty and repeated IDs from a list, keeping first-seen order. */
function uniqueIds(ids) {
  return [...new Set((ids || []).map(String).filter(Boolean))];
}

/**
 * Build a state from the parameters the server renders into the page
 * (`window.initialParams`: {authors, works, hops, exclude_list, expand, remove, collections}).
 * Names are unknown at this point (except collections', which are their names);
 * the caller fills them in from /api/entities/labels.
 */
export function stateFromParams(params) {
  if (!params) return emptyState();
  const centers = [
    ...uniqueIds(params.collections).map(collectionCenter),
    ...uniqueIds(params.authors).map(id => ({ id, type: 'author', name: '' })),
    ...uniqueIds(params.works).map(id => ({ id, type: 'work', name: '' })),
  ];
  return {
    centers,
    hops: normalizeHops(params.hops),
    exclude: uniqueIds(params.exclude_list),
    expand: uniqueIds(params.expand),
    remove: uniqueIds(params.remove),
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
    remove: list('remove'),
    collections: list('collection'),
  });
}

/** The URL path + query that reproduces `state` ("/" when there is nothing to show). */
export function stateToUrl(state) {
  if (!state.centers.length) return '/';
  const ids = type => state.centers.filter(c => c.type === type).map(c => c.id).join(',');
  const parts = [];
  const collections = collectionsIn(state);
  if (collections.length) parts.push(`collection=${collections.map(encodeURIComponent).join(',')}`);
  if (ids('author')) parts.push(`authors=${ids('author')}`);
  if (ids('work')) parts.push(`works=${ids('work')}`);
  parts.push(`hops=${state.hops}`);
  if (state.exclude.length) parts.push(`exclude_list=${state.exclude.join(',')}`);
  if (state.expand.length) parts.push(`expand=${state.expand.join(',')}`);
  if (removedIn(state).length) parts.push(`remove=${removedIn(state).join(',')}`);
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
    remove: [...removedIn(state)],
    collections: collectionsIn(state),
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
// exploration, so in-place expansions are dropped; "don't expand" and
// "removed" choices are kept, as the old Don't Expand box kept them.

/** Replace the searched-for entities (from the search box). */
export function setCenters(state, centers) {
  const seen = new Set();
  const unique = centers.filter(c => !seen.has(c.id) && seen.add(c.id));
  const changed = unique.map(c => c.id).join() !== state.centers.map(c => c.id).join();
  const ids = new Set(unique.map(c => c.id));
  return {
    ...state,
    centers: unique,
    expand: changed ? [] : state.expand,
    // Searching for a node brings it back if it was removed.
    remove: removedIn(state).filter(id => !ids.has(id)),
  };
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

/**
 * Take `id` off the graph, with whatever only it brought in. A searched-for
 * node is taken out of the search instead. (A work that is there because its
 * collection was searched for isn't a center itself, so it goes on the removed
 * list, and the rest of the collection stays.)
 */
export function removeNode(state, id) {
  if (state.centers.some(c => c.id === id)) {
    return setCenters(state, state.centers.filter(c => c.id !== id));
  }
  const remove = removedIn(state);
  return {
    ...state,
    exclude: state.exclude.filter(x => x !== id),
    expand: state.expand.filter(x => x !== id),
    remove: remove.includes(id) ? remove : [...remove, id],
  };
}

/** Replace the removed list (from the Removed box, where × brings a node back). */
export function setRemoved(state, ids) {
  const centers = new Set(state.centers.map(c => c.id));
  const remove = uniqueIds(ids).filter(id => !centers.has(id));
  return {
    ...state,
    remove,
    exclude: state.exclude.filter(id => !remove.includes(id)),
    expand: state.expand.filter(id => !remove.includes(id)),
  };
}

/** Start over around a single node (the old "Recenter" menu). */
export function recenter(state, node, hops = state.hops) {
  return {
    centers: [{ id: node.id, type: node.type, name: node.label || node.name || '' }],
    hops: normalizeHops(hops, state.hops),
    exclude: [],
    expand: [],
    remove: [],
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
