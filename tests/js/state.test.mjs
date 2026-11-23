// Tests for static/js/state.js (run: npm test, or make test-js)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyState, normalizeHops, stateFromParams, stateFromQuery, stateToUrl, stateToRequest, sameGraph,
  setCenters, addCenter, setHops, setExclude, expandNode, collapseNode, recenter, withNames,
} from '../../static/js/state.js';

const A = { id: '85303', type: 'author', name: 'Bhāsarvajña' };
const W = { id: '89000', type: 'work', name: 'Nyāyasāra' };

test('emptyState has nothing to show', () => {
  assert.deepEqual(emptyState(), { centers: [], hops: 1, exclude: [], expand: [] });
  assert.equal(stateToUrl(emptyState()), '/');
});

test('normalizeHops accepts non-negative integers only', () => {
  assert.equal(normalizeHops('2'), 2);
  assert.equal(normalizeHops(0), 0);
  assert.equal(normalizeHops(-1), 1);
  assert.equal(normalizeHops('x', 3), 3);
  assert.equal(normalizeHops(undefined, 0), 0);
});

test('stateFromParams reads the server-rendered parameters', () => {
  const s = stateFromParams({ authors: ['85303'], works: ['89000', '89000', ''], hops: '2', exclude_list: ['1'], expand: ['2'] });
  assert.deepEqual(s.centers.map(c => [c.id, c.type]), [['85303', 'author'], ['89000', 'work']]);
  assert.equal(s.hops, 2);
  assert.deepEqual(s.exclude, ['1']);
  assert.deepEqual(s.expand, ['2']);
  assert.deepEqual(stateFromParams(null), emptyState());
});

test('stateFromParams tolerates missing lists (older links have no expand)', () => {
  const s = stateFromParams({ works: ['89000'], hops: 1 });
  assert.deepEqual(s.exclude, []);
  assert.deepEqual(s.expand, []);
});

test('URL round trip', () => {
  const s = { centers: [A, W], hops: 2, exclude: ['111'], expand: ['222', '333'] };
  const url = stateToUrl(s);
  assert.equal(url, '/view?authors=85303&works=89000&hops=2&exclude_list=111&expand=222,333');
  const back = stateFromQuery(url.split('?')[1]);
  assert.ok(sameGraph(s, back));
});

test('URL omits empty lists', () => {
  assert.equal(stateToUrl({ centers: [W], hops: 1, exclude: [], expand: [] }), '/view?works=89000&hops=1');
});

test('stateFromQuery with no query is empty', () => {
  assert.deepEqual(stateFromQuery(''), emptyState());
});

test('stateToRequest matches the API body', () => {
  assert.deepEqual(stateToRequest({ centers: [A, W], hops: 3, exclude: ['1'], expand: ['2'] }), {
    authors: ['85303'], works: ['89000'], hops: 3, exclude_list: ['1'], expand: ['2'],
  });
});

test('sameGraph ignores names', () => {
  const a = { centers: [{ ...W, name: '' }], hops: 1, exclude: [], expand: [] };
  const b = { centers: [W], hops: 1, exclude: [], expand: [] };
  assert.ok(sameGraph(a, b));
  assert.ok(!sameGraph(a, { ...b, hops: 2 }));
});

test('actions never modify their input', () => {
  const s = Object.freeze({ centers: Object.freeze([W]), hops: 1, exclude: Object.freeze(['x']), expand: Object.freeze(['y']) });
  addCenter(s, A);
  setHops(s, 2);
  setExclude(s, ['z']);
  expandNode(s, 'x');
  collapseNode(s, 'y');
  recenter(s, { id: '1', type: 'work', label: 'X' });
  setCenters(s, [A]);
});

test('addCenter adds once', () => {
  const s1 = addCenter(emptyState(), W);
  const s2 = addCenter(s1, W);
  assert.equal(s2, s1);
  assert.deepEqual(addCenter(s1, A).centers.map(c => c.id), ['89000', '85303']);
});

test('changing the search starts a new exploration (drops expansions, keeps exclusions)', () => {
  const s = { centers: [W], hops: 1, exclude: ['x'], expand: ['y'] };
  const next = setCenters(s, [W, A]);
  assert.deepEqual(next.expand, []);
  assert.deepEqual(next.exclude, ['x']);
  // Same centers again: nothing to reset.
  assert.deepEqual(setCenters(s, [W]).expand, ['y']);
});

test('setCenters removes duplicates', () => {
  assert.deepEqual(setCenters(emptyState(), [W, W, A]).centers.map(c => c.id), ['89000', '85303']);
});

test('setHops drops expansions, ignores no-ops and bad values', () => {
  const s = { centers: [W], hops: 1, exclude: [], expand: ['y'] };
  assert.deepEqual(setHops(s, '2'), { ...s, hops: 2, expand: [] });
  assert.equal(setHops(s, 1), s);
  assert.equal(setHops(s, 'abc'), s);
});

test('expand and collapse are opposites and override each other', () => {
  let s = { centers: [W], hops: 1, exclude: ['n'], expand: [] };
  s = expandNode(s, 'n');
  assert.deepEqual([s.exclude, s.expand], [[], ['n']]);
  assert.deepEqual(expandNode(s, 'n').expand, ['n']); // no duplicate
  s = collapseNode(s, 'n');
  assert.deepEqual([s.exclude, s.expand], [['n'], []]);
  assert.deepEqual(collapseNode(s, 'n').exclude, ['n']);
});

test('setExclude also cancels expansion of newly excluded nodes', () => {
  const s = setExclude({ centers: [W], hops: 1, exclude: [], expand: ['a', 'b'] }, ['a', 'a', '']);
  assert.deepEqual(s.exclude, ['a']);
  assert.deepEqual(s.expand, ['b']);
});

test('recenter starts over around one node', () => {
  const s = recenter({ centers: [W, A], hops: 1, exclude: ['x'], expand: ['y'] }, { id: '5', type: 'author', label: 'Five' }, 3);
  assert.deepEqual(s, { centers: [{ id: '5', type: 'author', name: 'Five' }], hops: 3, exclude: [], expand: [] });
});

test('withNames fills names and corrects types from the server', () => {
  const s = stateFromParams({ works: ['85303', '1'], hops: 1 }); // an author ID given as a work
  const named = withNames(s, [{ id: '85303', type: 'author', name: 'Bhāsarvajña' }]);
  assert.deepEqual(named.centers, [
    { id: '85303', type: 'author', name: 'Bhāsarvajña' },
    { id: '1', type: 'work', name: '1' }, // unknown: falls back to its ID
  ]);
});
