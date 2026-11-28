// Tests for static/js/graph-model.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RADIUS, ALL_LABELS_MAX_NODES, ALL_LABELS_MIN_SCALE, endpointId, edgeKind, nodeRadius, neighborMap,
  seededRandom, reconcileGraph, shouldShowLabel, graphBounds, fitTransform, connectionGroups,
} from '../../static/js/graph-model.js';

const WROTE = 'source author wrote target work';
const COMM = 'source base text inspired target commentary';

const node = (id, type = 'work', extra = {}) => ({ id, type, label: `Node ${id}`, ...extra });
const edge = (source, target, relationship = WROTE) => ({ source, target, relationship });

test('endpointId handles ids and resolved node objects', () => {
  assert.equal(endpointId('a'), 'a');
  assert.equal(endpointId({ id: 'b' }), 'b');
});

test('edgeKind reads the relationship', () => {
  assert.equal(edgeKind({ relationship: WROTE }), 'wrote');
  assert.equal(edgeKind({ relationship: COMM }), 'commentary');
  assert.equal(edgeKind({}), 'other');
});

test('nodeRadius: searched-for nodes are bigger', () => {
  assert.equal(nodeRadius(node('a')), RADIUS.normal);
  assert.equal(nodeRadius(node('a', 'work', { is_central: true })), RADIUS.central);
});

test('neighborMap is symmetric', () => {
  const m = neighborMap([edge('a', 'b'), edge({ id: 'b' }, { id: 'c' })]);
  assert.deepEqual([...m.get('b')].sort(), ['a', 'c']);
  assert.deepEqual([...m.get('a')], ['b']);
});

test('seededRandom is deterministic and in [0, 1)', () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  for (let i = 0; i < 100; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
});

test('reconcileGraph: first graph is taken as is', () => {
  const r = reconcileGraph([], { nodes: [node('a'), node('b')], edges: [edge('a', 'b')] });
  assert.deepEqual([...r.added].sort(), ['a', 'b']);
  assert.equal(r.removed.size, 0);
  assert.equal(r.nodes[0].x, undefined); // d3 will lay them out
});

test('reconcileGraph keeps existing node objects and positions', () => {
  const prev = [{ ...node('a'), x: 10, y: 20, vx: 1, vy: 2 }, { ...node('b'), x: -5, y: 5 }];
  const prevA = prev[0];
  const r = reconcileGraph(prev, {
    nodes: [node('a', 'work', { is_central: true }), node('b')],
    edges: [edge('a', 'b')],
  });
  assert.equal(r.nodes[0], prevA, 'same object, so d3 keeps its state');
  assert.equal(r.nodes[0].x, 10);
  assert.equal(r.nodes[0].vy, 2);
  assert.equal(r.nodes[0].is_central, true, 'fields refreshed from the server');
  assert.equal(r.added.size, 0);
});

test('reconcileGraph places new nodes next to their positioned neighbour', () => {
  const prev = [{ ...node('a'), x: 100, y: 100 }];
  const r = reconcileGraph(prev, {
    nodes: [node('a'), node('b'), node('c')],
    edges: [edge('a', 'b'), edge('b', 'c')],
  }, { random: seededRandom(1), spread: 30 });
  const b = r.nodes.find(n => n.id === 'b');
  const c = r.nodes.find(n => n.id === 'c');
  assert.ok(Math.hypot(b.x - 100, b.y - 100) <= 45, 'b next to a');
  assert.ok(Number.isFinite(c.x), 'c (two steps out) placed via b');
  assert.ok(Math.hypot(c.x - b.x, c.y - b.y) <= 45, 'c next to b');
  assert.deepEqual([...r.added].sort(), ['b', 'c']);
  assert.ok(r.nodes.every(n => !('_placedInPass' in n)), 'no bookkeeping left behind');
});

test('reconcileGraph drops nodes and edges that are gone', () => {
  const prev = [{ ...node('a'), x: 0, y: 0 }, { ...node('b'), x: 1, y: 1 }];
  const r = reconcileGraph(prev, { nodes: [node('a')], edges: [] });
  assert.deepEqual(r.nodes.map(n => n.id), ['a']);
  assert.deepEqual([...r.removed], ['b']);
  assert.deepEqual(r.edges, []);
});

test('reconcileGraph turns resolved edge ends back into ids', () => {
  const r = reconcileGraph([], { nodes: [node('a'), node('b')], edges: [edge({ id: 'a' }, { id: 'b' }, COMM)] });
  assert.deepEqual(r.edges, [{ source: 'a', target: 'b', relationship: COMM }]);
});

test('reconcileGraph is reproducible with a seeded random', () => {
  const run = () => reconcileGraph([{ ...node('a'), x: 0, y: 0 }], {
    nodes: [node('a'), node('b')], edges: [edge('a', 'b')],
  }, { random: seededRandom(7) }).nodes[1];
  assert.deepEqual([run().x, run().y], [run().x, run().y]);
});

test('shouldShowLabel', () => {
  const plain = node('a');
  const big = { scale: 1, nodeCount: ALL_LABELS_MAX_NODES + 1, focus: new Set() };
  assert.equal(shouldShowLabel(plain, { ...big, nodeCount: ALL_LABELS_MAX_NODES }), true, 'small graph: all');
  assert.equal(shouldShowLabel(plain, big), false, 'big graph, zoomed out: hidden');
  assert.equal(shouldShowLabel(plain, { ...big, scale: ALL_LABELS_MIN_SCALE }), true, 'zoomed in: shown');
  assert.equal(shouldShowLabel({ ...plain, is_central: true }, big), true, 'searched-for: always');
  assert.equal(shouldShowLabel(plain, { ...big, focus: new Set(['a']) }), true, 'in focus: always');
});

test('graphBounds includes radii and skips unplaced nodes', () => {
  assert.equal(graphBounds([]), null);
  assert.equal(graphBounds([node('a')]), null);
  const b = graphBounds([{ ...node('a'), x: 0, y: 0 }, { ...node('b', 'work', { is_central: true }), x: 100, y: 50 }, node('c')]);
  assert.deepEqual(b, { x0: -RADIUS.normal, y0: -RADIUS.normal, x1: 100 + RADIUS.central, y1: 50 + RADIUS.central });
});

test('fitTransform centres the bounds and fits them inside the padding', () => {
  const t = fitTransform({ x0: 0, y0: 0, x1: 200, y1: 100 }, 1000, 600, { padding: 50, maxScale: 10 });
  assert.equal(t.k, 4.5); // limited by width: (1000 - 100) / 200
  assert.equal(t.x + 100 * t.k, 500, 'centre x maps to middle of view');
  assert.equal(t.y + 50 * t.k, 300, 'centre y maps to middle of view');
});

test('fitTransform on a small area (phone, controls open) still fits instead of zooming right out', () => {
  const b = { x0: 0, y0: 0, x1: 400, y1: 400 };
  const t = fitTransform(b, 390, 90, { padding: 48, minScale: 0.05 });
  assert.ok(t.k > 0.15, `zoom ${t.k}`);
  assert.ok(400 * t.k <= 90, 'and the graph fits the height');
});

test('fitTransform caps the zoom for tiny graphs and handles bad input', () => {
  assert.equal(fitTransform({ x0: 0, y0: 0, x1: 1, y1: 1 }, 800, 600, { maxScale: 1.5 }).k, 1.5);
  assert.deepEqual(fitTransform(null, 800, 600), { x: 0, y: 0, k: 1 });
  assert.deepEqual(fitTransform({ x0: 0, y0: 0, x1: 1, y1: 1 }, 0, 600), { x: 0, y: 0, k: 1 });
  assert.equal(fitTransform({ x0: 0, y0: 0, x1: 1e6, y1: 1e6 }, 800, 600, { minScale: 0.05 }).k, 0.05);
});

test('connectionGroups for a work: authors, base texts, commentaries', () => {
  const nodes = [node('w'), node('a', 'author'), node('base'), node('comm'), node('far')];
  const edges = [edge('a', 'w'), edge('base', 'w', COMM), edge('w', 'comm', COMM), edge('base', 'far', COMM)];
  const groups = connectionGroups(nodes[0], nodes, edges);
  assert.deepEqual(groups.map(g => [g.title, g.nodes.map(n => n.id)]), [
    ['Authors', ['a']],
    ['Base texts', ['base']],
    ['Commentaries', ['comm']],
  ]);
});

test('connectionGroups for an author lists works, sorted, without duplicates', () => {
  const nodes = [node('a', 'author'), { ...node('w2'), label: 'Bāṇa' }, { ...node('w1'), label: 'Abc' }];
  const edges = [edge('a', 'w2'), edge('a', 'w1'), edge({ id: 'a' }, { id: 'w1' })];
  const groups = connectionGroups(nodes[0], nodes, edges);
  assert.deepEqual(groups.map(g => [g.title, g.nodes.map(n => n.id)]), [['Works', ['w1', 'w2']]]);
});

test('connectionGroups for an isolated node is empty', () => {
  assert.deepEqual(connectionGroups(node('x'), [node('x')], []), []);
});
