// Tests for static/js/api.js, with a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ApiError, fetchJSON, searchEntities, fetchLabels, fetchGraph } from '../../static/js/api.js';

/** A fake fetch that records its calls and answers with `reply`. */
function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    if (reply instanceof Error) throw reply;
    return {
      ok: reply.status < 400,
      status: reply.status,
      json: async () => {
        if (reply.body === undefined) throw new SyntaxError('not json');
        return reply.body;
      },
    };
  };
  fn.calls = calls;
  return fn;
}

test('fetchJSON returns the body', async () => {
  assert.deepEqual(await fetchJSON('/x', {}, fakeFetch({ status: 200, body: { a: 1 } })), { a: 1 });
});

test("fetchJSON throws the server's own error message", async () => {
  await assert.rejects(
    fetchJSON('/x', {}, fakeFetch({ status: 400, body: { error: 'Invalid ID: 5' } })),
    err => err instanceof ApiError && err.message === 'Invalid ID: 5' && err.status === 400,
  );
});

test('fetchJSON copes with a non-JSON error page', async () => {
  await assert.rejects(
    fetchJSON('/x', {}, fakeFetch({ status: 502 })),
    err => err instanceof ApiError && /502/.test(err.message),
  );
});

test('fetchJSON turns network failures into a readable error', async () => {
  await assert.rejects(
    fetchJSON('/x', {}, fakeFetch(new TypeError('Failed to fetch'))),
    err => err instanceof ApiError && err.status === 0 && /reach/.test(err.message),
  );
});

test('fetchJSON passes aborts through untouched', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await assert.rejects(fetchJSON('/x', {}, fakeFetch(abort)), err => err === abort);
});

test('searchEntities builds the query and forwards the signal', async () => {
  const f = fakeFetch({ status: 200, body: [] });
  const signal = new AbortController().signal;
  await searchEntities('kālidāsa & co', { type: 'works', limit: 5, signal }, f);
  const url = new URL(f.calls[0].url, 'http://x');
  assert.equal(url.pathname, '/api/entities/search');
  assert.equal(url.searchParams.get('q'), 'kālidāsa & co');
  assert.equal(url.searchParams.get('type'), 'works');
  assert.equal(url.searchParams.get('limit'), '5');
  assert.equal(f.calls[0].options.signal, signal);
});

test('fetchLabels skips the request for no IDs', async () => {
  const f = fakeFetch({ status: 200, body: [] });
  assert.deepEqual(await fetchLabels([], f), []);
  assert.equal(f.calls.length, 0);
  await fetchLabels(['1', '2'], f);
  assert.equal(f.calls[0].url, '/api/entities/labels?ids=1%2C2');
});

test('fetchGraph posts the request and returns the graph', async () => {
  const graph = { nodes: [], edges: [] };
  const f = fakeFetch({ status: 200, body: { parameters: {}, graph } });
  const req = { authors: [], works: ['1'], hops: 1, exclude_list: [], expand: [] };
  assert.deepEqual(await fetchGraph(req, {}, f), graph);
  assert.equal(f.calls[0].url, '/api/graph/subgraph');
  assert.equal(f.calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(f.calls[0].options.body), req);
});
