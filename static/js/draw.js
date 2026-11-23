/**
 * Drawing the graph onto a <canvas>.
 *
 * Why canvas: the old SVG view created three DOM elements per node and moved
 * every one of them on every simulation tick, which gets sluggish past a few
 * hundred nodes (the SETI collection views have 600-900). A canvas redraws the
 * whole picture in one pass instead.
 *
 * Visual encoding (also explained by the legend on the page):
 *   - author: circle; work: rounded square (plus the existing colours)
 *   - searched-for node: larger, with an outer ring
 *   - e-texts available: gold ring (as before)
 *   - "don't expand": dashed ring
 *   - more connections than shown: small "+" badge
 *   - author → work edge: plain line; base text → commentary: coloured arrow
 *
 * `drawScene` only calls methods on the 2D context it is given, so tests run
 * it against a recording fake context (tests/js/draw.test.mjs).
 */

import { edgeKind, nodeRadius, shouldShowLabel } from './graph-model.js';

/** Screen-pixel sizes (divided by the zoom scale when drawn). */
const LABEL_PX = 13;
const CENTRAL_LABEL_PX = 15;
const EDGE_PX = 1.25;
const HALO_PX = 3.5;

/** Graph-unit sizes (they grow and shrink with zoom, like the nodes). */
const ARROW = 6;
const ETEXT_RING = 2.5;

export const LABEL_FONT_FAMILY = '"Gentium Plus", "Gentium Book Plus", Georgia, serif';

/** CSS custom properties the canvas reads its colours from (see app.css). */
export const PALETTE_VARS = {
  background: '--graph-bg',
  author: '--author-node',
  work: '--work-node',
  nodeStroke: '--node-stroke',
  link: '--link-color',
  commentary: '--commentary-link',
  etext: '--etext-ring',
  central: '--central-ring',
  selection: '--selection-ring',
  muted: '--muted-ring',
  label: '--label-fill',
  badge: '--badge-bg',
  badgeText: '--badge-text',
};

/** Fallbacks if a variable is missing (e.g. in tests). */
const DEFAULT_PALETTE = {
  background: '#f5f2ee', author: '#8e44ad', work: '#c0392b', nodeStroke: '#ffffff',
  link: '#a0a0a0', commentary: '#e67e22', etext: '#d4a017', central: '#2f1746',
  selection: '#2f80ed', muted: '#7f7f7f', label: '#5a0b73', badge: '#2f1746', badgeText: '#ffffff',
};

/** Read the palette from a CSSStyleDeclaration (getComputedStyle(document.documentElement)). */
export function readPalette(style) {
  const palette = { ...DEFAULT_PALETTE };
  if (!style) return palette;
  for (const [key, cssVar] of Object.entries(PALETTE_VARS)) {
    const value = style.getPropertyValue(cssVar).trim();
    if (value) palette[key] = value;
  }
  return palette;
}

/** Trace a node's shape (circle or rounded square) as the current path. */
export function traceShape(ctx, node, r) {
  ctx.beginPath();
  if (node.type === 'work') {
    const h = r * 0.9; // a square looks bigger than a circle of the same "radius"
    const c = r * 0.35;
    const x0 = node.x - h, y0 = node.y - h, x1 = node.x + h, y1 = node.y + h;
    ctx.moveTo(x0 + c, y0);
    ctx.arcTo(x1, y0, x1, y1, c);
    ctx.arcTo(x1, y1, x0, y1, c);
    ctx.arcTo(x0, y1, x0, y0, c);
    ctx.arcTo(x0, y0, x1, y0, c);
    ctx.closePath();
  } else {
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
  }
}

function strokeRing(ctx, node, r, color, width, dash = null) {
  traceShape(ctx, node, r);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash || []);
  ctx.stroke();
  ctx.setLineDash([]);
}

const positioned = n => n && typeof n === 'object' && Number.isFinite(n.x) && Number.isFinite(n.y);

/**
 * Draw one frame.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} scene
 * @param {number} scene.width   CSS pixels
 * @param {number} scene.height  CSS pixels
 * @param {number} [scene.dpr]   device pixel ratio (canvas is sized width*dpr)
 * @param {{x: number, y: number, k: number}} scene.transform  current zoom
 * @param {Array} scene.nodes    nodes with x, y
 * @param {Array} scene.edges    edges whose source/target are node objects
 * @param {object} scene.palette from readPalette
 * @param {string|null} [scene.hoverId]
 * @param {string|null} [scene.selectedId]
 * @param {Set<string>|null} [scene.focus]  IDs to keep bright; others are dimmed
 *        (the selected node and its neighbours)
 * @param {Set<string>|null} [scene.labelFocus]  extra IDs whose labels to show,
 *        without dimming anything (the hovered node and its neighbours)
 * @returns {{nodesDrawn: number, edgesDrawn: number, labelsDrawn: string[]}}
 */
export function drawScene(ctx, scene) {
  const {
    width, height, dpr = 1, transform, nodes, edges, palette,
    hoverId = null, selectedId = null, focus = null, labelFocus = null,
    labelScale = 1, // the − A + text size control (font-size.js)
  } = scene;
  const k = transform.k;
  const dim = focus && focus.size > 0;
  const stats = { nodesDrawn: 0, edgesDrawn: 0, labelsDrawn: [] };

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);
  ctx.translate(transform.x, transform.y);
  ctx.scale(k, k);

  // --- Edges ---
  ctx.lineCap = 'round';
  for (const edge of edges) {
    const s = edge.source;
    const t = edge.target;
    if (!positioned(s) || !positioned(t)) continue;
    const kind = edgeKind(edge);
    const bright = !dim || (focus.has(s.id) && focus.has(t.id));
    ctx.globalAlpha = bright ? (kind === 'commentary' ? 0.9 : 0.7) : 0.12;
    const color = kind === 'commentary' ? palette.commentary : palette.link;
    ctx.strokeStyle = color;
    ctx.lineWidth = (kind === 'commentary' ? EDGE_PX * 1.4 : EDGE_PX) / k;

    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const endGap = kind === 'commentary' ? nodeRadius(t) + 2 : 0;
    const ex = t.x - ux * endGap;
    const ey = t.y - uy * endGap;

    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(ex - ux * (kind === 'commentary' ? ARROW * 0.8 : 0), ey - uy * (kind === 'commentary' ? ARROW * 0.8 : 0));
    ctx.stroke();

    if (kind === 'commentary' && len > nodeRadius(t) + ARROW) {
      // Arrowhead pointing at the commentary.
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - ux * ARROW - uy * ARROW * 0.55, ey - uy * ARROW + ux * ARROW * 0.55);
      ctx.lineTo(ex - ux * ARROW + uy * ARROW * 0.55, ey - uy * ARROW - ux * ARROW * 0.55);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
    stats.edgesDrawn++;
  }

  // --- Nodes ---
  const showBadges = k >= 0.6 || nodes.length <= 150;
  for (const node of nodes) {
    if (!positioned(node)) continue;
    const r = nodeRadius(node);
    ctx.globalAlpha = !dim || focus.has(node.id) ? 1 : 0.22;

    traceShape(ctx, node, r);
    ctx.fillStyle = node.type === 'work' ? palette.work : palette.author;
    ctx.fill();
    ctx.strokeStyle = palette.nodeStroke;
    ctx.lineWidth = (node.id === hoverId ? 2.5 : 1.5) / k;
    ctx.stroke();

    let ring = r + 1;
    if (node.type === 'work' && node.etext_links) {
      ring += ETEXT_RING / 2 + 0.5;
      strokeRing(ctx, node, ring, palette.etext, ETEXT_RING);
      ring += ETEXT_RING / 2;
    }
    if (node.is_central) {
      ring += 2.5;
      strokeRing(ctx, node, ring, palette.central, 1.75);
    }
    if (node.is_excluded) {
      ring += 2.5;
      strokeRing(ctx, node, ring, palette.muted, 1.5, [2.5, 2.5]);
    }
    if (node.id === selectedId) {
      ring += 3.5;
      strokeRing(ctx, node, ring, palette.selection, 2.5);
    }
    if (node.hidden_neighbors > 0 && showBadges) {
      const bx = node.x + r * 0.85;
      const by = node.y - r * 0.85;
      const br = 4;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, 2 * Math.PI);
      ctx.fillStyle = palette.badge;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(bx - 2.2, by);
      ctx.lineTo(bx + 2.2, by);
      ctx.moveTo(bx, by - 2.2);
      ctx.lineTo(bx, by + 2.2);
      ctx.strokeStyle = palette.badgeText;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    stats.nodesDrawn++;
  }

  // --- Labels ---
  // Greedy placement in priority order: a label that would overlap one already
  // drawn is skipped, unless it is for something the user is looking at.
  const labelSet = new Set([...(focus || []), ...(labelFocus || [])]);
  const view = { scale: k, nodeCount: nodes.length, focus: labelSet };
  const priority = n => (n.id === selectedId ? 0 : n.id === hoverId ? 1 : labelSet.has(n.id) ? 2 : n.is_central ? 3 : 4);
  const candidates = nodes
    .filter(n => positioned(n) && n.label && shouldShowLabel(n, view))
    .sort((a, b) => priority(a) - priority(b));
  const placed = [];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';
  for (const node of candidates) {
    const px = (node.is_central ? CENTRAL_LABEL_PX : LABEL_PX) * labelScale;
    ctx.font = `${node.is_central ? 'bold ' : ''}${px / k}px ${LABEL_FONT_FAMILY}`;
    const textWidth = ctx.measureText(node.label).width * k; // in screen px
    const sx = node.x * k + transform.x;
    const sy = (node.y - nodeRadius(node) - 3) * k + transform.y - 4;
    const box = { x0: sx - textWidth / 2 - 2, x1: sx + textWidth / 2 + 2, y0: sy - px - 1, y1: sy + 1 };
    const must = priority(node) <= 2;
    if (!must && placed.some(b => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) continue;
    placed.push(box);

    const y = node.y - nodeRadius(node) - 3 - 4 / k;
    ctx.globalAlpha = !dim || focus.has(node.id) ? 1 : 0.35;
    ctx.lineWidth = HALO_PX / k;
    ctx.strokeStyle = palette.background;
    ctx.strokeText(node.label, node.x, y);
    ctx.fillStyle = palette.label;
    ctx.fillText(node.label, node.x, y);
    stats.labelsDrawn.push(node.id);
  }
  ctx.globalAlpha = 1;
  return stats;
}
