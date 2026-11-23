/**
 * Small wrappers around the Pāṇḍitya API (see /api/docs).
 *
 * Every call throws an `ApiError` carrying the server's own error message
 * (the API answers errors as {"error": "..."}), so the interface can show
 * the user something better than "Failed to fetch".
 */

export class ApiError extends Error {
  /**
   * @param {string} message what went wrong, fit to show the user
   * @param {number} status HTTP status (0 for a network failure)
   */
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * fetch() a JSON endpoint. Aborts (via `options.signal`) are re-thrown as the
 * browser's own AbortError, so callers can tell "superseded" from "failed".
 */
export async function fetchJSON(url, options = {}, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError("Couldn't reach the Pāṇḍitya server. Check your connection and try again.", 0);
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (e.g. an HTML error page); handled below.
  }
  if (!response.ok) {
    const message = (body && (body.error || body.message)) || `The server answered ${response.status}.`;
    throw new ApiError(message, response.status);
  }
  return body;
}

/** Search authors and works: GET /api/entities/search. */
export function searchEntities(query, { type = 'all', limit = 20, signal } = {}, fetchImpl) {
  const params = new URLSearchParams({ q: query, type, limit: String(limit) });
  return fetchJSON(`/api/entities/search?${params}`, { signal }, fetchImpl);
}

/** Names and types for a list of IDs: GET /api/entities/labels. Unknown IDs are skipped. */
export async function fetchLabels(ids, fetchImpl) {
  if (!ids.length) return [];
  return fetchJSON(`/api/entities/labels?ids=${encodeURIComponent(ids.join(','))}`, {}, fetchImpl);
}

/** The graph for a state's request body: POST /api/graph/subgraph. */
export async function fetchGraph(request, { signal } = {}, fetchImpl) {
  const body = await fetchJSON('/api/graph/subgraph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  }, fetchImpl);
  return body.graph;
}
