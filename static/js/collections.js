/**
 * SETI collections in the main search box.
 *
 * The page knows the collections' names and sizes (rendered into
 * `window.setiCollections` as [{name, works}], largest first), so matching them
 * needs no request. A collection is offered when the query starts any word of
 * its name, ignoring case and diacritics: "gre" finds GRETIL, "prama" finds
 * "Vātāyana and Pramāṇa NLP".
 *
 * Results have the shape ChipSearch shows ({id, type, name, detail}), with
 * the id of the collection's center (state.collectionCenter), so picking one
 * adds the collection to the search like any author or work.
 */

import { collectionCenter } from './state.js';

/** Lower case, without diacritics: "Pramāṇa" → "pramana". */
export function foldText(text) {
  return String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * The collections whose name has a word starting with `query`, as search results.
 * @param {string} query what the user typed
 * @param {Array<{name: string, works: number}>} collections
 */
export function collectionResults(query, collections = []) {
  const q = foldText(query).trim();
  if (!q) return [];
  return collections
    .filter(c => foldText(c.name).split(/[^\p{L}\p{N}]+/u).some(word => word.startsWith(q))
      || foldText(c.name).startsWith(q))
    .map(c => ({
      ...collectionCenter(c.name),
      detail: `SETI collection · ${c.works} work${c.works === 1 ? '' : 's'}`,
    }));
}

/**
 * Wrap an entity search so matching collections come first in its results.
 * If the entity search fails, the failure still reaches the search box as before.
 */
export function withCollections(searchFn, collections) {
  return async (query, signal) => [...collectionResults(query, collections), ...await searchFn(query, signal)];
}
