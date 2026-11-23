// Tests for static/js/draw.js, against a fake canvas context that records
// every call, so we can check *what* gets drawn without a real canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScene, readPalette, traceShape, PALETTE_VARS } from '../../static/js/draw.js';
import { ALL_LABELS_MAX_NODES } from '../../static/js/graph-model.js';
import { recordingContext } from './helpers/canvas.mjs';

const palette = readPalette(null);
const WROTE = 'source author wrote target work';
const COMM = 'source base text inspired target commentary';

function scene(nodes, edges = [], extra = {}) {
  return { width: 800, height: 600, transform: { x: 0, y: 0, k: 1 }, nodes, edges, palette, ...extra };
}

const calls = (ctx, name) => ctx.log.filter(c => c[0] === name);
const sets = (ctx, prop) => ctx.log.filter(c => c[0] === `set:${prop}`).map(c => c[1]);

test('readPalette reads CSS variables and falls back to defaults', () => {
  const style = { getPropertyValue: v => (v === PALETTE_VARS.author ? ' #123456 ' : '') };
  const p = readPalette(style);
  assert.equal(p.author, '#123456');
  assert.equal(p.work, readPalette(null).work);
});

test('authors are circles and works rounded squares', () => {
  const ctx = recordingContext();
  traceShape(ctx, { type: 'author', x: 0, y: 0 }, 8);
  assert.equal(calls(ctx, 'arc').length, 1);
  assert.equal(calls(ctx, 'arcTo').length, 0);

  const ctx2 = recordingContext();
  traceShape(ctx2, { type: 'work', x: 0, y: 0 }, 8);
  assert.equal(calls(ctx2, 'arcTo').length, 4);
  assert.equal(calls(ctx2, 'arc').length, 0);
});

test('draws the background, every edge and every node', () => {
  const a = { id: 'a', type: 'author', label: 'A', x: 0, y: 0 };
  const w = { id: 'w', type: 'work', label: 'W', x: 100, y: 0 };
  const ctx = recordingContext();
  const stats = drawScene(ctx, scene([a, w], [{ source: a, target: w, relationship: WROTE }]));
  assert.deepEqual(calls(ctx, 'fillRect')[0], ['fillRect', 0, 0, 800, 600]);
  assert.equal(stats.nodesDrawn, 2);
  assert.equal(stats.edgesDrawn, 1);
  assert.ok(sets(ctx, 'fillStyle').includes(palette.author));
  assert.ok(sets(ctx, 'fillStyle').includes(palette.work));
});

test('skips nodes and edges without positions yet', () => {
  const a = { id: 'a', type: 'author', label: 'A' };
  const w = { id: 'w', type: 'work', label: 'W', x: 1, y: 1 };
  const stats = drawScene(recordingContext(), scene([a, w], [{ source: a, target: w, relationship: WROTE }, { source: 'a', target: 'w' }]));
  assert.equal(stats.nodesDrawn, 1);
  assert.equal(stats.edgesDrawn, 0);
});

test('commentary edges get the commentary colour and an arrowhead', () => {
  const b = { id: 'b', type: 'work', x: 0, y: 0 };
  const c = { id: 'c', type: 'work', x: 100, y: 0 };
  const ctx = recordingContext();
  drawScene(ctx, scene([b, c], [{ source: b, target: c, relationship: COMM }]));
  assert.ok(sets(ctx, 'strokeStyle').includes(palette.commentary));
  // The arrowhead is a filled triangle in the commentary colour, before any node is filled.
  const firstNodeFill = ctx.log.findIndex(e => e[0] === 'set:fillStyle' && e[1] === palette.work);
  const arrowFill = ctx.log.findIndex(e => e[0] === 'set:fillStyle' && e[1] === palette.commentary);
  assert.ok(arrowFill > -1 && arrowFill < firstNodeFill);
});

test('marks: gold ring for e-texts, ring for searched-for, dashed ring for not expanded', () => {
  const n = { id: 'n', type: 'work', label: 'N', x: 0, y: 0, etext_links: { GRETIL: ['https://x'] }, is_central: true, is_excluded: true };
  const ctx = recordingContext();
  drawScene(ctx, scene([n]));
  const strokes = sets(ctx, 'strokeStyle');
  assert.ok(strokes.includes(palette.etext));
  assert.ok(strokes.includes(palette.central));
  assert.ok(strokes.includes(palette.muted));
  assert.ok(calls(ctx, 'setLineDash').some(c => c[1].length > 0), 'a dashed ring');
});

test('authors never get the e-text ring', () => {
  const ctx = recordingContext();
  drawScene(ctx, scene([{ id: 'a', type: 'author', x: 0, y: 0, etext_links: { X: ['https://x'] } }]));
  assert.ok(!sets(ctx, 'strokeStyle').includes(palette.etext));
});

test('selected node gets the selection ring; "+" badge for hidden connections', () => {
  const n = { id: 'n', type: 'author', label: 'N', x: 0, y: 0, hidden_neighbors: 3 };
  const ctx = recordingContext();
  drawScene(ctx, scene([n], [], { selectedId: 'n' }));
  assert.ok(sets(ctx, 'strokeStyle').includes(palette.selection));
  assert.ok(sets(ctx, 'fillStyle').includes(palette.badge));
});

test('labels: all shown for a small graph, with a halo first', () => {
  const nodes = [0, 1, 2].map(i => ({ id: String(i), type: 'work', label: `L${i}`, x: i * 200, y: 0 }));
  const ctx = recordingContext();
  const stats = drawScene(ctx, scene(nodes));
  assert.deepEqual(stats.labelsDrawn.sort(), ['0', '1', '2']);
  const strokeText = ctx.log.findIndex(c => c[0] === 'strokeText');
  const fillText = ctx.log.findIndex(c => c[0] === 'fillText');
  assert.ok(strokeText > -1 && strokeText < fillText, 'halo drawn under the text');
});

test('labels: big graph zoomed out shows only searched-for and focused ones', () => {
  const nodes = Array.from({ length: ALL_LABELS_MAX_NODES + 10 }, (_, i) => ({
    id: String(i), type: 'work', label: `Label ${i}`, x: (i % 10) * 300, y: Math.floor(i / 10) * 300,
  }));
  nodes[3].is_central = true;
  const stats = drawScene(recordingContext(), scene(nodes, [], { focus: new Set(['7']), labelFocus: new Set(['9']) }));
  assert.deepEqual(stats.labelsDrawn.sort(), ['3', '7', '9']);
});

test('overlapping labels: lower-priority one is skipped, focused one always drawn', () => {
  const nodes = [
    { id: 'a', type: 'work', label: 'Same place', x: 0, y: 0 },
    { id: 'b', type: 'work', label: 'Same place', x: 1, y: 0 },
  ];
  assert.equal(drawScene(recordingContext(), scene(nodes)).labelsDrawn.length, 1);
  const both = drawScene(recordingContext(), scene(nodes, [], { focus: new Set(['a', 'b']) }));
  assert.equal(both.labelsDrawn.length, 2);
});

test('focus dims everything else', () => {
  const nodes = [
    { id: 'a', type: 'work', x: 0, y: 0 },
    { id: 'b', type: 'work', x: 100, y: 0 },
  ];
  const ctx = recordingContext();
  drawScene(ctx, scene(nodes, [], { focus: new Set(['a']) }));
  const alphas = sets(ctx, 'globalAlpha');
  assert.ok(alphas.includes(1));
  assert.ok(alphas.some(a => a < 0.5));
});

test('applies device pixel ratio and zoom', () => {
  const ctx = recordingContext();
  drawScene(ctx, scene([], [], { dpr: 2, transform: { x: 10, y: 20, k: 3 } }));
  assert.deepEqual(calls(ctx, 'setTransform')[0], ['setTransform', 2, 0, 0, 2, 0, 0]);
  assert.deepEqual(calls(ctx, 'translate')[0], ['translate', 10, 20]);
  assert.deepEqual(calls(ctx, 'scale')[0], ['scale', 3, 3]);
});
