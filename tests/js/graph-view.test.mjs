// Tests for static/js/graph-view.js: the canvas + d3 force graph, run under
// jsdom with d3 from npm (the page uses the same version from a CDN) and a
// recording stand-in for the canvas context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as d3 from 'd3';

import { GraphView, DEFAULT_FORCES, alphaDecayFor } from '../../static/js/graph-view.js';
import { seededRandom, graphBounds, RADIUS } from '../../static/js/graph-model.js';
import { makeDom, sleep } from './helpers/dom.mjs';
import { recordingContext } from './helpers/canvas.mjs';

// d3-zoom checks `node instanceof SVGElement` against the global scope.
globalThis.SVGElement ??= makeDom().window.SVGElement;

const WROTE = 'source author wrote target work';
const COMM = 'source base text inspired target commentary';

/** A small graph: one author who wrote three works, one of which has a commentary. */
function sampleGraph() {
  return {
    nodes: [
      { id: 'a', type: 'author', label: 'Author A', is_central: true },
      { id: 'w1', type: 'work', label: 'Work 1' },
      { id: 'w2', type: 'work', label: 'Work 2' },
      { id: 'w3', type: 'work', label: 'Work 3', hidden_neighbors: 2 },
      { id: 'c1', type: 'work', label: 'Commentary 1' },
    ],
    edges: [
      { source: 'a', target: 'w1', relationship: WROTE },
      { source: 'a', target: 'w2', relationship: WROTE },
      { source: 'a', target: 'w3', relationship: WROTE },
      { source: 'w1', target: 'c1', relationship: COMM },
    ],
  };
}

/** A GraphView on an 800×600 canvas, plus everything its callbacks received. */
function setup(t) {
  const dom = makeDom();
  const { window } = dom;
  const canvas = window.document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  const ctx = recordingContext();
  canvas.getContext = () => ctx;
  window.document.body.append(canvas);
  const events = { select: [], expand: [], hover: [] };
  const view = new GraphView({
    canvas,
    d3,
    onSelect: node => events.select.push(node && node.id),
    onExpand: node => events.expand.push(node.id),
    onHover: node => events.hover.push(node && node.id),
    getStyle: () => ({ getPropertyValue: () => '' }),
  });
  // Tests drive the simulation by hand; nothing should tick in the background.
  view.simulation.stop();
  t.after(() => {
    view.destroy();
    window.close();
  });
  return { window, canvas, ctx, view, events };
}

/** Put the view's simulation at rest (so positions stop changing). */
function settle(view, ticks = 300) {
  view.simulation.stop();
  for (let i = 0; i < ticks; i++) view.simulation.tick();
}

/** Screen position (CSS px) of a node under the current zoom. */
function screenOf(view, id) {
  const n = view.getNode(id);
  return view.transform.apply([n.x, n.y]);
}

function mouse(window, target, type, [x, y], extra = {}) {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, ...extra });
  target.dispatchEvent(event);
  return event;
}

test('alphaDecayFor: small graphs settle faster', () => {
  assert.equal(alphaDecayFor(3), 0.08);
  assert.equal(alphaDecayFor(20), 0.05);
  assert.equal(alphaDecayFor(500), 0.0228);
});

test('sizes the canvas and draws an empty scene', t => {
  const { view, canvas } = setup(t);
  assert.equal(view.width, 800);
  assert.equal(view.height, 600);
  assert.equal(canvas.width, 800);
  assert.deepEqual(view.lastStats, { nodesDrawn: 0, edgesDrawn: 0, labelsDrawn: [] });
});

test('resize honours the device pixel ratio', t => {
  const { view, canvas, window } = setup(t);
  window.devicePixelRatio = 2;
  view.resize();
  assert.equal(view.dpr, 2);
  assert.equal(canvas.width, 1600);
  assert.equal(view.width, 800, 'CSS size unchanged');
});

test('first graph: laid out before it is shown, and fitted to the view', t => {
  const { view } = setup(t);
  const { added, removed } = view.setGraph(sampleGraph(), { random: seededRandom(1) });
  view.simulation.stop();
  assert.equal(added.size, 5);
  assert.equal(removed.size, 0);
  assert.ok(view.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)), 'pre-settled');
  assert.equal(view.pendingFit, 'full');
  assert.equal(view.simulation.alphaDecay(), alphaDecayFor(5));
  assert.ok(!view.isOverflowing(), 'everything visible');
  assert.ok(view.transform.k <= 1.5, 'small graph not blown up');
  // Edges were resolved to node objects by d3.
  assert.equal(view.edges[0].source, view.getNode('a'));
});

test('a changed graph keeps nodes where they were and adds new ones beside their neighbours', t => {
  const { view } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  const w1 = view.getNode('w1');
  const before = { x: w1.x, y: w1.y };

  const next = sampleGraph();
  next.nodes.push({ id: 'c2', type: 'work', label: 'Commentary 2' });
  next.edges.push({ source: 'w3', target: 'c2', relationship: COMM });
  next.nodes = next.nodes.filter(n => n.id !== 'c1');
  next.edges = next.edges.filter(e => e.target !== 'c1');
  const { added, removed } = view.setGraph(next, { random: seededRandom(2) });
  view.simulation.stop();

  assert.deepEqual([...added], ['c2']);
  assert.deepEqual([...removed], ['c1']);
  assert.equal(view.getNode('w1'), w1, 'same object');
  assert.deepEqual({ x: w1.x, y: w1.y }, before, 'not moved by the update itself');
  const w3 = view.getNode('w3');
  const c2 = view.getNode('c2');
  assert.ok(Math.hypot(c2.x - w3.x, c2.y - w3.y) < 50, 'new node starts next to its neighbour');
  assert.equal(view.pendingFit, 'overflow');
  assert.equal(view.getNode('c1'), null);
});

test('a graph with nothing in common starts over', t => {
  const { view } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  view.setGraph({ nodes: [{ id: 'z', type: 'work', label: 'Z' }], edges: [] });
  view.simulation.stop();
  assert.equal(view.pendingFit, 'full');
});

test('selection is dropped (and reported) when its node goes away', t => {
  const { view, events } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  view.select('c1');
  assert.equal(view.selectedId, 'c1');
  const next = sampleGraph();
  next.nodes = next.nodes.filter(n => n.id !== 'c1');
  next.edges = next.edges.filter(e => e.target !== 'c1');
  view.setGraph(next);
  view.simulation.stop();
  assert.equal(view.selectedId, null);
  assert.deepEqual(events.select, [null]);
});

test('select ignores unknown IDs; neighborhood lists a node and its neighbours', t => {
  const { view } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  view.simulation.stop();
  view.select('nope');
  assert.equal(view.selectedId, null);
  assert.deepEqual([...view.neighborhood('w1')].sort(), ['a', 'c1', 'w1']);
  assert.equal(view.neighborhood(null), null);
});

test('render passes selection focus and hover to the drawing', t => {
  const { view } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  view.select('w1');
  assert.equal(view.lastStats.nodesDrawn, 5);
  assert.equal(view.lastStats.edgesDrawn, 4);
  // A small graph shows every label.
  assert.equal(view.lastStats.labelsDrawn.length, 5);
});

test('clear empties the graph', t => {
  const { view } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  view.clear();
  assert.equal(view.nodes.length, 0);
  assert.equal(view.edges.length, 0);
});

test('nodeAt finds the node under the pointer, with a little slack', t => {
  const { view } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  view.fit({ animate: false });
  const [x, y] = screenOf(view, 'w2');
  assert.equal(view.nodeAt(x, y).id, 'w2');
  assert.equal(view.nodeAt(x + RADIUS.normal * view.transform.k, y).id, 'w2', 'edge of the node');
  assert.equal(view.nodeAt(-500, -500), null);
});

test('click selects a node, click on empty space selects nothing', t => {
  const { view, canvas, window, events } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  view.fit({ animate: false });
  mouse(window, canvas, 'click', screenOf(view, 'w3'));
  mouse(window, canvas, 'click', [1, 1]);
  assert.deepEqual(events.select, ['w3', null]);
});

test('double-click on a node asks to expand it, and does not zoom', t => {
  const { view, canvas, window, events } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  view.fit({ animate: false });
  const k = view.transform.k;
  const e = mouse(window, canvas, 'dblclick', screenOf(view, 'w3'));
  assert.deepEqual(events.expand, ['w3']);
  assert.ok(e.defaultPrevented);
  assert.equal(view.transform.k, k, 'd3-zoom double-click zoom is off');
  mouse(window, canvas, 'dblclick', [1, 1]);
  assert.deepEqual(events.expand, ['w3']);
});

test('hover: pointer cursor and callback; leaving clears it', t => {
  const { view, canvas, window, events } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  view.fit({ animate: false });
  mouse(window, canvas, 'pointermove', screenOf(view, 'a'));
  assert.equal(view.hoverId, 'a');
  assert.equal(canvas.style.cursor, 'pointer');
  mouse(window, canvas, 'pointermove', screenOf(view, 'a')); // no repeat
  mouse(window, canvas, 'pointerleave', [0, 0]);
  assert.equal(view.hoverId, null);
  assert.equal(canvas.style.cursor, '');
  assert.deepEqual(events.hover, ['a', null]);
});

test('hover is ignored while a button is held (dragging or panning)', t => {
  const { view, canvas, window } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  view.fit({ animate: false });
  mouse(window, canvas, 'pointermove', screenOf(view, 'a'), { buttons: 1 });
  assert.equal(view.hoverId, null);
});

test('fit, centerOn and isOverflowing', t => {
  const { view } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  view.setTransform({ x: 0, y: 0, k: 5 }, false);
  assert.ok(view.isOverflowing());
  view.fit({ animate: false });
  assert.ok(!view.isOverflowing());
  const b = graphBounds(view.nodes);
  const [sx0, sy0] = view.transform.apply([b.x0, b.y0]);
  const [sx1, sy1] = view.transform.apply([b.x1, b.y1]);
  assert.ok(sx0 >= 0 && sy0 >= 0 && sx1 <= 800 && sy1 <= 600);

  view.centerOn('c1', { animate: false });
  const [cx, cy] = screenOf(view, 'c1');
  assert.ok(Math.abs(cx - 400) < 1e-6 && Math.abs(cy - 300) < 1e-6);
  view.centerOn('nope', { animate: false }); // no error
});

test('a fitted view stays fitted when the canvas changes size, unless the user moved it', t => {
  const { view, canvas } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  view.fit({ animate: false });
  const fits = [];
  const realFit = view.fit.bind(view);
  view.fit = options => { fits.push(options); realFit(options); };

  view.resize(); // same size
  assert.deepEqual(fits, []);

  canvas.width = 400; // jsdom has no layout; the view reads the canvas size
  canvas.height = 300;
  view.resize();
  assert.deepEqual(fits, [{ animate: false }]);
  assert.ok(!view.isOverflowing());

  view.userMovedView = true;
  canvas.width = 800;
  canvas.height = 600;
  view.resize();
  assert.equal(fits.length, 1, 'the user panned or zoomed: leave it');
});

test('after an update, the view refits only if the graph overflows and the user has not moved it', t => {
  const { view } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  view.fit({ animate: false });
  view.pendingFit = 'overflow';
  view.simulation.alpha(0.05);
  const fits = [];
  view.fit = options => fits.push(options);

  view.onTick();
  assert.deepEqual(fits, [], 'all visible: no refit');
  assert.equal(view.pendingFit, null);

  view.setTransform({ x: 0, y: 0, k: 6 }, false);
  view.pendingFit = 'overflow';
  view.onTick();
  assert.deepEqual(fits, [{ animate: true }], 'overflowing: refit');

  view.pendingFit = 'full';
  view.userMovedView = true;
  view.onTick();
  assert.equal(fits.length, 1, 'user moved the view: leave it');
});

test('no refit while the layout is still moving fast', t => {
  const { view } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  view.simulation.stop();
  view.simulation.alpha(0.5);
  view.onTick();
  assert.equal(view.pendingFit, 'full');
});

test('setForces updates the simulation', t => {
  const { view } = setup(t);
  assert.deepEqual(view.forces, DEFAULT_FORCES);
  view.setForces({ charge: 400, distance: 50 });
  view.simulation.stop();
  assert.equal(view.simulation.force('charge').strength()({}), -400);
  assert.equal(view.simulation.force('link').distance()({}), 50);
  view.setForces({ collide: 30 });
  view.simulation.stop();
  assert.equal(view.simulation.force('collide').radius()({ id: 'x' }), 30);
  view.setForces({ collide: 1 });
  view.simulation.stop();
  assert.equal(view.simulation.force('collide').radius()({ is_central: true }), RADIUS.central + 2, 'never smaller than the node');
});

test('freezing stops movement; unfreezing lets go of pinned nodes', t => {
  const { view } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  view.setFrozen(true);
  const node = view.getNode('w1');
  node.fx = 10;
  node.fy = 20;
  view.setFrozen(false);
  view.simulation.stop();
  assert.equal(node.fx, null);
  assert.equal(node.fy, null);
});

test('resetLayout lays everything out afresh with the given forces', t => {
  const { view } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  view.setForces({ charge: 700, distance: 500, collide: 40 });
  view.setFrozen(true);
  const node = view.getNode('w1');
  node.fx = 5000;
  node.fy = 5000;
  node.x = 5000;
  node.y = 5000;
  view.setTransform({ x: 0, y: 0, k: 6 }, false);

  view.resetLayout({ charge: 80 });
  view.simulation.stop();
  assert.deepEqual(view.forces, { ...DEFAULT_FORCES, charge: 80 });
  assert.equal(view.simulation.force('charge').strength()({}), -80);
  assert.equal(view.frozen, false);
  assert.ok(view.nodes.every(n => n.fx === null && n.fy === null), 'nothing pinned');
  assert.ok(view.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)), 'placed again');
  assert.ok(Math.hypot(node.x, node.y) < 1000, 'the far-off node came back');
  assert.equal(view.getNode('w1'), node, 'same node objects');
  assert.equal(view.pendingFit, 'full');
});

test('resetLayout with no arguments uses the defaults, and works on an empty graph', t => {
  const { view } = setup(t);
  view.setForces({ charge: 10 });
  view.resetLayout();
  view.simulation.stop();
  assert.deepEqual(view.forces, DEFAULT_FORCES);
});

test('drag handlers pin the node while dragging and release it after', t => {
  const { view } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  view.fit({ animate: false });
  const node = view.getNode('w2');
  const subject = { node };
  view.onDragStart({ active: 0, subject, x: 100, y: 100 });
  view.simulation.stop();
  const [gx, gy] = view.transform.invert([100, 100]);
  assert.deepEqual([node.fx, node.fy], [gx, gy]);
  view.onDrag({ subject, x: 200, y: 150 });
  assert.deepEqual([node.fx, node.fy], view.transform.invert([200, 150]));
  view.onDragEnd({ active: 0, subject });
  assert.deepEqual([node.fx, node.fy], [null, null]);
  assert.equal(view.simulation.alphaTarget(), 0);
});

test('while frozen, a dragged node moves directly and stays put', t => {
  const { view } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  view.setFrozen(true);
  const node = view.getNode('w2');
  const subject = { node };
  view.onDragStart({ active: 0, subject, x: 50, y: 60 });
  view.onDrag({ subject, x: 70, y: 80 });
  const [gx, gy] = view.transform.invert([70, 80]);
  assert.deepEqual([node.x, node.y], [gx, gy]);
  view.onDragEnd({ active: 0, subject });
  assert.deepEqual([node.fx, node.fy], [gx, gy]);
});

test('dragging a node with the mouse moves the node, not the view', t => {
  const { view, canvas, window } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  view.fit({ animate: false });
  const before = { ...view.transform };
  const start = screenOf(view, 'w2');
  const end = [start[0] + 60, start[1] + 40];
  mouse(window, canvas, 'mousedown', start, { button: 0 });
  mouse(window, window, 'mousemove', [start[0] + 30, start[1] + 20]);
  mouse(window, window, 'mousemove', end);
  const node = view.getNode('w2');
  view.simulation.stop();
  const expected = view.transform.invert(end);
  assert.ok(Math.abs(node.fx - expected[0]) < 1e-6 && Math.abs(node.fy - expected[1]) < 1e-6, 'node follows the pointer');
  mouse(window, window, 'mouseup', end);
  view.simulation.stop();
  assert.equal(node.fx, null, 'released');
  assert.deepEqual({ ...view.transform }, before, 'view did not pan');
});

test('dragging empty space pans the view and marks it as moved by the user', t => {
  const { view, canvas, window } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  view.fit({ animate: false });
  const x0 = view.transform.x;
  mouse(window, canvas, 'mousedown', [2, 2], { button: 0 });
  mouse(window, window, 'mousemove', [40, 2]);
  mouse(window, window, 'mouseup', [40, 2]);
  assert.ok(Math.abs(view.transform.x - (x0 + 38)) < 1e-6);
  assert.equal(view.userMovedView, true);
});

test('refreshPalette re-reads colours', t => {
  const { view } = setup(t);
  view.getStyle = () => ({ getPropertyValue: v => (v === '--author-node' ? '#abcdef' : '') });
  view.refreshPalette();
  assert.equal(view.palette.author, '#abcdef');
});

test('a failing style lookup falls back to default colours', t => {
  const { view } = setup(t);
  view.getStyle = () => { throw new Error('no styles'); };
  view.refreshPalette();
  assert.ok(view.palette.author);
});

test('requestRender batches redraws into one frame', async t => {
  const { view } = setup(t);
  let renders = 0;
  const real = view.render.bind(view);
  view.render = () => { renders += 1; real(); };
  view.requestRender();
  view.requestRender();
  view.requestRender();
  await sleep(50);
  assert.equal(renders, 1);
});

test('destroy removes the listeners', t => {
  const { view, canvas, window, events } = setup(t);
  view.setGraph(sampleGraph(), { random: seededRandom(1) });
  settle(view);
  view.fit({ animate: false });
  const pos = screenOf(view, 'w1');
  view.destroy();
  mouse(window, canvas, 'click', pos);
  assert.deepEqual(events.select, []);
});
