/**
 * The interactive graph: a d3 force simulation drawn on a <canvas>.
 *
 * Responsibilities:
 *   - keep the simulation in step with the graph the server sends, changing it
 *     in place (graph-model.js reconcileGraph) instead of starting over;
 *   - pan/zoom (d3-zoom), drag nodes (d3-drag), hover, click to select,
 *     double-click to expand;
 *   - fit the view: fully on a new graph, and afterwards only when the graph
 *     has grown past the edges of the screen (so expanding a node doesn't yank
 *     the view around);
 *   - redraw at most once per animation frame (draw.js does the drawing).
 *
 * d3 comes from the page's <script> tag (global `d3`) or can be passed in,
 * which is how tests/js/graph-view.test.mjs runs it under jsdom.
 */

import { reconcileGraph, neighborMap, graphBounds, fitTransform, nodeRadius } from './graph-model.js';
import { drawScene, readPalette } from './draw.js';

/** Starting values for the Layout sliders (same as the old interface). */
export const DEFAULT_FORCES = { charge: 250, distance: 100, collide: 15 };

/**
 * The Repulsion that suits a graph of `nodeCount` nodes, used until the user
 * moves the Repulsion slider themselves.
 *
 * The layout also pulls every node gently toward the middle, and with that
 * pull the area each node gets grows with the repulsion, whatever the number
 * of nodes. So a big graph at the usual repulsion spreads far beyond the screen
 * and its labels shrink to nothing when fitted. Up to SMALL_GRAPH nodes this
 * keeps the usual value; above that it eases off as 1/sqrt(n), which keeps the
 * whole graph's width about the same as for SMALL_GRAPH nodes, but never below
 * MIN_AUTO_CHARGE, so nodes still stand apart.
 */
const SMALL_GRAPH = 100;
const MIN_AUTO_CHARGE = 60;
export function chargeFor(nodeCount) {
  if (nodeCount <= SMALL_GRAPH) return DEFAULT_FORCES.charge;
  const scaled = DEFAULT_FORCES.charge * Math.sqrt(SMALL_GRAPH / nodeCount);
  return Math.max(MIN_AUTO_CHARGE, Math.round(scaled / 10) * 10);  // the slider's step is 10
}

/** Small graphs settle faster, as before. */
export function alphaDecayFor(nodeCount) {
  return nodeCount <= 5 ? 0.08 : nodeCount <= 20 ? 0.05 : 0.0228;
}

/** How long (ms) to pre-run the layout before first showing a brand-new graph. */
const PRESETTLE_BUDGET_MS = 150;

export class GraphView {
  /**
   * @param {object} options
   * @param {HTMLCanvasElement} options.canvas
   * @param {object} [options.d3]  the d3 library (defaults to the global)
   * @param {(node: object|null) => void} [options.onSelect]  click on a node / on empty space
   * @param {(node: object) => void} [options.onExpand]       double-click on a node
   * @param {(node: object|null) => void} [options.onHover]
   * @param {() => CSSStyleDeclaration} [options.getStyle]    where colours come from
   */
  constructor({ canvas, d3 = globalThis.d3, onSelect = () => {}, onExpand = () => {}, onHover = () => {}, getStyle } = {}) {
    this.canvas = canvas;
    this.d3 = d3;
    this.onSelect = onSelect;
    this.onExpand = onExpand;
    this.onHover = onHover;
    this.getStyle = getStyle || (() => canvas.ownerDocument.defaultView.getComputedStyle(canvas.ownerDocument.documentElement));
    this.ctx = canvas.getContext ? canvas.getContext('2d') : null;
    this.palette = readPalette(this.safeStyle());

    this.nodes = [];
    this.edges = [];
    this.neighbors = new Map();
    this.nodesById = new Map();
    this.hoverId = null;
    this.selectedId = null;
    this.forces = { ...DEFAULT_FORCES };
    this.frozen = false;
    this.transform = d3.zoomIdentity;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.pendingFit = null; // null | 'full' | 'overflow'
    this.userMovedView = false;
    this.labelScale = 1;
    this.frame = null;
    this.lastStats = null;

    this.simulation = d3.forceSimulation([])
      .force('link', d3.forceLink([]).id(d => d.id))
      .force('charge', d3.forceManyBody())
      .force('center', d3.forceCenter(0, 0))
      // Weak pull towards the middle, so disconnected pieces (common in the SETI
      // collection views) don't drift off the screen.
      .force('x', d3.forceX(0).strength(0.04))
      .force('y', d3.forceY(0).strength(0.04))
      .force('collide', d3.forceCollide())
      .on('tick', () => this.onTick())
      .stop();
    this.applyForces();

    this.zoom = d3.zoom()
      .scaleExtent([0.03, 6])
      .on('zoom', event => {
        this.transform = event.transform;
        if (event.sourceEvent) this.userMovedView = true;
        this.requestRender();
      });

    this.drag = d3.drag()
      .container(canvas)
      // The subject carries the pointer position itself (not the node's), so
      // that drag events report plain canvas coordinates; see graphPoint.
      .subject(event => {
        const node = this.nodeAt(event.x, event.y);
        return node ? { node, x: event.x, y: event.y } : null;
      })
      .on('start', event => this.onDragStart(event))
      .on('drag', event => this.onDrag(event))
      .on('end', event => this.onDragEnd(event));

    // Drag first, so pressing on a node drags it instead of panning.
    this.selection = d3.select(canvas).call(this.drag).call(this.zoom).on('dblclick.zoom', null);

    this.listeners = [
      ['click', e => this.onClick(e)],
      ['dblclick', e => this.onDoubleClick(e)],
      ['pointermove', e => this.onPointerMove(e)],
      ['pointerleave', () => this.setHover(null)],
    ];
    for (const [type, handler] of this.listeners) canvas.addEventListener(type, handler);

    this.resize();
  }

  safeStyle() {
    try {
      return this.getStyle();
    } catch {
      return null;
    }
  }

  // --- Data -----------------------------------------------------------------

  /**
   * Show a graph from the server, changing what's on screen in place.
   * @param {{nodes: Array, edges: Array}} graph
   * @param {{random?: () => number}} [options]  (tests pass a seeded random)
   * @returns {{added: Set<string>, removed: Set<string>}}
   */
  setGraph(graph, { random } = {}) {
    const firstGraph = !this.nodes.some(n => graph.nodes.some(m => m.id === n.id));
    const { nodes, edges, added, removed } = reconcileGraph(firstGraph ? [] : this.nodes, graph, random ? { random } : {});

    this.nodes = nodes;
    this.edges = edges;
    this.nodesById = new Map(nodes.map(n => [n.id, n]));
    this.neighbors = neighborMap(edges);
    if (this.hoverId && !this.nodesById.has(this.hoverId)) this.hoverId = null;
    if (this.selectedId && !this.nodesById.has(this.selectedId)) {
      this.selectedId = null;
      this.onSelect(null);
    }

    this.simulation.nodes(nodes);
    this.simulation.force('link').links(edges); // resolves edge ends to node objects
    this.simulation.alphaDecay(alphaDecayFor(nodes.length));

    if (firstGraph) {
      this.presettle();
      this.fit({ animate: false });
      this.pendingFit = 'full';
      this.userMovedView = false;
      this.simulation.alpha(Math.max(this.simulation.alpha(), 0.3));
    } else {
      this.pendingFit = 'overflow';
      this.simulation.alpha(added.size || removed.size ? 0.5 : 0.15);
    }
    if (!this.frozen) this.simulation.restart();
    this.requestRender();
    return { added, removed };
  }

  /** Run the layout for a moment without drawing, so a new graph doesn't explode onto the screen. */
  presettle() {
    const start = performance.now();
    this.simulation.alpha(1);
    while (this.simulation.alpha() > 0.08 && performance.now() - start < PRESETTLE_BUDGET_MS) {
      this.simulation.tick();
    }
  }

  clear() {
    this.setGraph({ nodes: [], edges: [] });
    this.simulation.stop();
  }

  getNode(id) {
    return this.nodesById.get(id) || null;
  }

  /** IDs of `id` and its neighbours. */
  neighborhood(id) {
    if (!id || !this.nodesById.has(id)) return null;
    return new Set([id, ...(this.neighbors.get(id) || [])]);
  }

  // --- Forces ---------------------------------------------------------------

  /**
   * Update the Layout sliders' forces: {charge, distance, collide} (any subset).
   * With `{restart: false}` the layout isn't woken up: for setting the forces
   * just before setGraph, which runs the layout itself.
   */
  setForces(forces, { restart = true } = {}) {
    Object.assign(this.forces, forces);
    this.applyForces();
    if (restart && !this.frozen) this.simulation.alpha(Math.max(this.simulation.alpha(), 0.3)).restart();
  }

  applyForces() {
    this.simulation.force('charge').strength(-this.forces.charge);
    this.simulation.force('link').distance(this.forces.distance);
    this.simulation.force('collide').radius(d => Math.max(this.forces.collide, nodeRadius(d) + 2));
  }

  /** Freeze: stop all movement (dragging still moves the dragged node). */
  setFrozen(frozen) {
    this.frozen = frozen;
    if (frozen) {
      this.simulation.stop();
      return;
    }
    // Let go of nodes that were dragged into place while frozen.
    for (const node of this.nodes) {
      node.fx = null;
      node.fy = null;
    }
    this.simulation.alpha(0.3).restart();
  }

  /**
   * Start the layout over: the given forces (default: DEFAULT_FORCES), nothing
   * frozen or pinned, every node placed afresh, and the view fitted to the result.
   * @param {{charge?: number, distance?: number, collide?: number}} [forces]
   */
  resetLayout(forces = DEFAULT_FORCES) {
    this.forces = { ...DEFAULT_FORCES, ...forces };
    this.applyForces();
    this.frozen = false;
    for (const node of this.nodes) {
      // d3 places nodes without a position anew (in a spiral around the centre).
      delete node.x;
      delete node.y;
      delete node.vx;
      delete node.vy;
      node.fx = null;
      node.fy = null;
    }
    this.simulation.nodes(this.nodes);
    this.presettle();
    this.fit({ animate: true });
    this.pendingFit = 'full';
    this.simulation.alpha(0.3).restart();
    this.requestRender();
  }

  onTick() {
    this.requestRender();
    if (this.pendingFit && this.simulation.alpha() < 0.1) {
      const mode = this.pendingFit;
      this.pendingFit = null;
      if (this.userMovedView) return;
      if (mode === 'full' || this.isOverflowing()) this.fit({ animate: true });
    }
  }

  // --- View -----------------------------------------------------------------

  /**
   * Match the canvas's pixel size to its CSS size (call when the layout changes).
   * If the size changed and the user hasn't panned or zoomed since the last fit,
   * fit again, so the graph stays whole on screen when, say, the sidebar is
   * resized or the controls on a phone are closed.
   */
  resize() {
    const win = this.canvas.ownerDocument.defaultView;
    const before = [this.width, this.height];
    this.dpr = Math.max(1, win?.devicePixelRatio || 1);
    this.width = this.canvas.clientWidth || this.canvas.width || 300;
    this.height = this.canvas.clientHeight || this.canvas.height || 150;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    const changed = before[0] !== this.width || before[1] !== this.height;
    if (changed && this.nodes?.length && !this.userMovedView) this.fit({ animate: false });
    this.render();
  }

  /** Is any node outside the visible area? */
  isOverflowing() {
    const b = graphBounds(this.nodes);
    if (!b) return false;
    const [x0, y0] = this.transform.invert([0, 0]);
    const [x1, y1] = this.transform.invert([this.width, this.height]);
    return b.x0 < x0 || b.y0 < y0 || b.x1 > x1 || b.y1 > y1;
  }

  /** Zoom and pan so the whole graph is visible. */
  fit({ animate = true } = {}) {
    const t = fitTransform(graphBounds(this.nodes), this.width, this.height);
    this.setTransform(t, animate);
    this.userMovedView = false;
  }

  /** Pan (keeping the zoom) so node `id` is in the middle. */
  centerOn(id, { animate = true } = {}) {
    const node = this.getNode(id);
    if (!node || !Number.isFinite(node.x)) return;
    const k = this.transform.k;
    this.setTransform({ x: this.width / 2 - node.x * k, y: this.height / 2 - node.y * k, k }, animate);
  }

  setTransform({ x, y, k }, animate) {
    const target = this.d3.zoomIdentity.translate(x, y).scale(k);
    if (animate && this.selection.transition) {
      this.selection.transition().duration(450).call(this.zoom.transform, target);
    } else {
      this.selection.call(this.zoom.transform, target);
    }
  }

  /** Size of the names on the graph, as a factor of normal (the − A + control). */
  setLabelScale(scale) {
    this.labelScale = scale > 0 ? scale : 1;
    this.render();
  }

  /** Re-read colours from CSS (after switching light/dark). */
  refreshPalette() {
    this.palette = readPalette(this.safeStyle());
    this.render();
  }

  // --- Selection and hover --------------------------------------------------

  select(id) {
    this.selectedId = id && this.nodesById.has(id) ? id : null;
    this.render();
  }

  setHover(id) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.canvas.style.cursor = id ? 'pointer' : '';
    this.onHover(id ? this.getNode(id) : null);
    this.requestRender();
  }

  /** The node under canvas position (x, y) in CSS pixels, or null. */
  nodeAt(x, y) {
    const [gx, gy] = this.transform.invert([x, y]);
    const slack = 4 / this.transform.k; // a few screen pixels of forgiveness
    let best = null;
    let bestDist = Infinity;
    for (const node of this.nodes) {
      if (!Number.isFinite(node.x)) continue;
      const d = Math.hypot(node.x - gx, node.y - gy);
      if (d <= nodeRadius(node) + slack && d < bestDist) {
        best = node;
        bestDist = d;
      }
    }
    return best;
  }

  pointerPosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  onPointerMove(event) {
    if (event.buttons) return; // dragging or panning
    const node = this.nodeAt(...this.pointerPosition(event));
    this.setHover(node ? node.id : null);
  }

  onClick(event) {
    if (event.defaultPrevented) return;
    const node = this.nodeAt(...this.pointerPosition(event));
    this.onSelect(node);
  }

  onDoubleClick(event) {
    const node = this.nodeAt(...this.pointerPosition(event));
    if (node) {
      event.preventDefault();
      this.onExpand(node);
    }
  }

  // --- Dragging -------------------------------------------------------------

  graphPoint(event) {
    return this.transform.invert([event.x, event.y]);
  }

  onDragStart(event) {
    if (!event.active && !this.frozen) this.simulation.alphaTarget(0.3).restart();
    const node = event.subject.node;
    const [gx, gy] = this.graphPoint(event);
    node.fx = gx;
    node.fy = gy;
  }

  onDrag(event) {
    const node = event.subject.node;
    const [gx, gy] = this.graphPoint(event);
    node.fx = gx;
    node.fy = gy;
    if (this.frozen) {
      node.x = gx;
      node.y = gy;
      this.requestRender();
    }
  }

  onDragEnd(event) {
    if (!event.active) this.simulation.alphaTarget(0);
    if (this.frozen) return; // a frozen node stays where it was put
    event.subject.node.fx = null;
    event.subject.node.fy = null;
  }

  // --- Drawing --------------------------------------------------------------

  requestRender() {
    if (this.frame !== null) return;
    const win = this.canvas.ownerDocument.defaultView;
    const schedule = win?.requestAnimationFrame?.bind(win) || (cb => setTimeout(cb, 16));
    this.frame = schedule(() => {
      this.frame = null;
      this.render();
    });
  }

  render() {
    if (!this.ctx) return;
    this.lastStats = drawScene(this.ctx, {
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      transform: this.transform,
      nodes: this.nodes,
      edges: this.edges,
      palette: this.palette,
      hoverId: this.hoverId,
      selectedId: this.selectedId,
      focus: this.neighborhood(this.selectedId),
      labelFocus: this.neighborhood(this.hoverId),
      labelScale: this.labelScale,
    });
  }

  destroy() {
    this.simulation.stop();
    for (const [type, handler] of this.listeners) this.canvas.removeEventListener(type, handler);
    this.selection.on('.zoom', null).on('.drag', null);
  }
}
