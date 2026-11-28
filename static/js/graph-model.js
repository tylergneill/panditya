/**
 * Pure helpers for the graph on screen: merging a new server response into the
 * current one, sizing nodes, deciding which labels to draw, and fitting the
 * view. No DOM and no d3 here, so all of it is unit-tested
 * (tests/js/graph-model.test.mjs).
 */

/** Node sizes in graph units (before zoom). */
export const RADIUS = { normal: 8, central: 13 };

/** Draw every label when the graph has at most this many nodes. */
export const ALL_LABELS_MAX_NODES = 40;

/** Draw every label once zoomed in at least this far. */
export const ALL_LABELS_MIN_SCALE = 1.4;

/** An edge endpoint may be an ID or, once d3 has resolved it, a node object. */
export const endpointId = end => (typeof end === 'object' && end !== null ? end.id : end);

/**
 * What an edge means, from the server's `relationship` string:
 * - 'wrote':      author → work
 * - 'commentary': base text → commentary on it
 */
export function edgeKind(edge) {
  const rel = edge.relationship || '';
  if (rel.includes('wrote')) return 'wrote';
  if (rel.includes('commentary')) return 'commentary';
  return 'other';
}

/** Radius of a node, in graph units. */
export function nodeRadius(node) {
  return node.is_central ? RADIUS.central : RADIUS.normal;
}

/** Map of node ID → Set of neighbour IDs. */
export function neighborMap(edges) {
  const map = new Map();
  const add = (a, b) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a).add(b);
  };
  for (const e of edges) {
    const s = endpointId(e.source);
    const t = endpointId(e.target);
    add(s, t);
    add(t, s);
  }
  return map;
}

/**
 * A small deterministic pseudo-random generator (mulberry32), so placing new
 * nodes is reproducible in tests.
 */
export function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Merge a freshly fetched graph into the one on screen, so the picture changes
 * in place instead of starting over.
 *
 * - Nodes present before keep their *objects*, so their position and velocity
 *   (x, y, vx, vy, and fx/fy if pinned) carry over; their other fields are
 *   refreshed from the server (flags such as is_central can change).
 * - New nodes start next to a neighbour that already has a position (the
 *   average of all such neighbours, plus a little jitter), so they appear to
 *   grow out of the node that brought them in.
 * - Nodes and edges missing from the new graph are dropped.
 *
 * @param {Array} prevNodes nodes currently on screen (may be empty)
 * @param {{nodes: Array, edges: Array}} next the server's graph
 * @param {{random?: () => number, spread?: number}} [options]
 * @returns {{nodes: Array, edges: Array, added: Set<string>, removed: Set<string>}}
 */
export function reconcileGraph(prevNodes, next, { random = Math.random, spread = 30 } = {}) {
  const prevById = new Map(prevNodes.map(n => [n.id, n]));
  const nextIds = new Set(next.nodes.map(n => n.id));
  const neighbors = neighborMap(next.edges);

  const added = new Set();
  const nodes = next.nodes.map(fresh => {
    const old = prevById.get(fresh.id);
    if (old) {
      return Object.assign(old, fresh);
    }
    added.add(fresh.id);
    return { ...fresh };
  });

  // Place new nodes near positioned neighbours. Several passes, so a chain of
  // new nodes (A expanded → B new → C new beyond B) also lands near A.
  const byId = new Map(nodes.map(n => [n.id, n]));
  let pending = nodes.filter(n => added.has(n.id));
  for (let pass = 0; pass < 4 && pending.length; pass++) {
    const stillPending = [];
    for (const node of pending) {
      const anchors = [...(neighbors.get(node.id) || [])]
        .map(id => byId.get(id))
        .filter(n => n && Number.isFinite(n.x) && Number.isFinite(n.y) && !(added.has(n.id) && n._placedInPass === pass));
      if (anchors.length) {
        const cx = anchors.reduce((s, n) => s + n.x, 0) / anchors.length;
        const cy = anchors.reduce((s, n) => s + n.y, 0) / anchors.length;
        const angle = random() * 2 * Math.PI;
        const dist = spread * (0.5 + random());
        node.x = cx + Math.cos(angle) * dist;
        node.y = cy + Math.sin(angle) * dist;
        node.vx = 0;
        node.vy = 0;
        node._placedInPass = pass;
      } else {
        stillPending.push(node);
      }
    }
    pending = stillPending;
  }
  for (const node of nodes) delete node._placedInPass;

  const removed = new Set([...prevById.keys()].filter(id => !nextIds.has(id)));
  const edges = next.edges.map(e => ({
    source: endpointId(e.source),
    target: endpointId(e.target),
    relationship: e.relationship,
  }));
  return { nodes, edges, added, removed };
}

/**
 * Should this node's label be drawn right now?
 *
 * Labels are what make a big graph unreadable, so only some are drawn:
 * all of them for small graphs or when zoomed in, otherwise the searched-for
 * nodes plus whatever the user is focused on (hovered or selected nodes and
 * their neighbours).
 *
 * @param {object} node
 * @param {{scale: number, nodeCount: number, focus: Set<string>}} view
 */
export function shouldShowLabel(node, { scale, nodeCount, focus }) {
  if (focus && focus.has(node.id)) return true;
  if (node.is_central) return true;
  if (nodeCount <= ALL_LABELS_MAX_NODES) return true;
  return scale >= ALL_LABELS_MIN_SCALE;
}

/** Bounding box {x0, y0, x1, y1} of positioned nodes (radii included), or null. */
export function graphBounds(nodes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
    const r = nodeRadius(n);
    x0 = Math.min(x0, n.x - r);
    y0 = Math.min(y0, n.y - r);
    x1 = Math.max(x1, n.x + r);
    y1 = Math.max(y1, n.y + r);
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

/**
 * The zoom transform {x, y, k} that fits `bounds` into a width × height view.
 *
 * Screen position = graph position × k + (x, y). The scale is capped at
 * `maxScale`, so a graph of two nodes isn't blown up to fill the screen.
 */
export function fitTransform(bounds, width, height, { padding = 48, maxScale = 1.5, minScale = 0.05 } = {}) {
  if (!bounds || width <= 0 || height <= 0) return { x: 0, y: 0, k: 1 };
  // On a small area (a phone with the controls open) a fixed padding can eat the
  // whole height and force the minimum zoom; keep it to a share of the area.
  padding = Math.min(padding, width / 8, height / 8);
  const w = Math.max(bounds.x1 - bounds.x0, 1);
  const h = Math.max(bounds.y1 - bounds.y0, 1);
  const k = Math.min(
    maxScale,
    Math.max(minScale, Math.min((width - 2 * padding) / w, (height - 2 * padding) / h)),
  );
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cy = (bounds.y0 + bounds.y1) / 2;
  return { x: width / 2 - cx * k, y: height / 2 - cy * k, k };
}

/**
 * A node's neighbours on screen, grouped the way a reader thinks of them.
 * For a work: its authors, the base texts it comments on, and commentaries on it.
 * For an author: their works.
 *
 * @returns {Array<{title: string, nodes: Array}>} non-empty groups, names sorted
 */
export function connectionGroups(node, nodes, edges) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const groups = node.type === 'work'
    ? { Authors: [], 'Base texts': [], 'Commentaries': [] }
    : { Works: [] };
  for (const e of edges) {
    const s = endpointId(e.source);
    const t = endpointId(e.target);
    if (s !== node.id && t !== node.id) continue;
    const other = byId.get(s === node.id ? t : s);
    if (!other) continue;
    if (node.type === 'author') groups.Works.push(other);
    else if (edgeKind(e) === 'wrote') groups.Authors.push(other);
    else if (t === node.id) groups['Base texts'].push(other);
    else groups.Commentaries.push(other);
  }
  return Object.entries(groups)
    .filter(([, list]) => list.length)
    .map(([title, list]) => ({
      title,
      nodes: [...new Map(list.map(n => [n.id, n])).values()]
        .sort((a, b) => (a.label || '').localeCompare(b.label || '')),
    }));
}
