// A small fake Pāṇḍitya API for page tests (app.test.mjs, widget.test.mjs):
// a handful of real-looking authors and works, answering like the Flask routes.

// --- A fake Pāṇḍitya API ---------------------------------------------------

export const ENTITIES = {
  85303: { type: 'author', name: 'Bhāsarvajña', dates: '10th c.' },
  89000: { type: 'work', name: 'Nyāyasāra' },
  89001: { type: 'work', name: 'Nyāyabhūṣaṇa' },
  89002: { type: 'work', name: 'Nyāyabhūṣaṇa-ṭīkā' },
  40377: { type: 'author', name: 'Kālidāsa' },
  40378: { type: 'work', name: 'Raghuvaṃśa' },
  85352: { type: 'author', name: 'Abhinavagupta' },
};
const EDGES = [
  ['85303', '89000', 'source author wrote target work'],
  ['85303', '89001', 'source author wrote target work'],
  ['89001', '89002', 'source base text inspired target commentary'],
  ['40377', '40378', 'source author wrote target work'],
];
const neighbours = id => EDGES.flatMap(([s, t]) => (s === id ? [t] : t === id ? [s] : []));
/** SETI collections: name → work IDs. */
export const COLLECTIONS = { GRETIL: ['89000', '89001'], DCS: ['40378'] };

/** What the real /api/graph/subgraph would answer, for this tiny data set. */
export function subgraph({ authors, works, hops, exclude_list: exclude, expand, remove = [], collections = [] }) {
  for (const id of [...authors, ...works, ...exclude, ...expand, ...remove]) {
    if (!ENTITIES[id]) return { status: 400, body: { error: `Invalid ID: ${id}` } };
  }
  for (const name of collections) {
    if (!COLLECTIONS[name]) return { status: 400, body: { error: `Invalid collection: ${name}` } };
  }
  // A collection's works are searched for (less any removed); their authors come along as ordinary nodes.
  const collectionWorks = collections.flatMap(name => COLLECTIONS[name]).filter(id => !remove.includes(id));
  const centers = [...new Set([...authors, ...works, ...collectionWorks])];
  const removed = remove.filter(id => !centers.includes(id)); // as grapher.construct_graph
  const stop = [...exclude, ...removed];
  const ids = new Set(centers);
  let frontier = [...centers];
  for (let h = 0; h < hops; h++) {
    const next = [];
    for (const id of frontier) {
      if (stop.includes(id) && !centers.includes(id)) continue;
      for (const n of neighbours(id)) if (!ids.has(n)) { ids.add(n); next.push(n); }
    }
    frontier = next;
  }
  for (const id of expand) if (!removed.includes(id)) for (const n of neighbours(id)) ids.add(n);
  for (const id of removed) ids.delete(id);
  for (const id of collectionWorks) {
    for (const n of neighbours(id)) if (ENTITIES[n].type === 'author' && !removed.includes(n)) ids.add(n);
  }
  const nodes = [...ids].map(id => ({
    id,
    type: ENTITIES[id].type,
    label: ENTITIES[id].name,
    dates: ENTITIES[id].dates || '',
    is_central: centers.includes(id),
    is_excluded: exclude.includes(id) && !expand.includes(id),
    is_expanded: expand.includes(id),
    hidden_neighbors: neighbours(id).filter(n => !ids.has(n) && !removed.includes(n)).length,
    etext_links: false,
  }));
  const edges = EDGES.filter(([s, t]) => ids.has(s) && ids.has(t)).map(([source, target, relationship]) => ({ source, target, relationship }));
  return { status: 200, body: { parameters: {}, graph: { nodes, edges } } };
}

const describe = id => ({ id, type: ENTITIES[id].type, name: ENTITIES[id].name, dates: ENTITIES[id].dates || '', aka: '', has_etexts: false });

function route(url, options = {}) {
  const u = new URL(url, 'http://localhost');
  if (u.pathname === '/api/graph/subgraph') return subgraph(JSON.parse(options.body));
  if (u.pathname === '/api/entities/labels') {
    const ids = u.searchParams.get('ids').split(',').filter(id => ENTITIES[id]);
    return { status: 200, body: ids.map(id => ({ ...describe(id), label: ENTITIES[id].name })) };
  }
  if (u.pathname === '/api/entities/search') {
    const q = u.searchParams.get('q').toLowerCase();
    const ids = Object.keys(ENTITIES).filter(id => ENTITIES[id].name.toLowerCase().startsWith(q));
    return { status: 200, body: ids.map(describe) };
  }
  return { status: 404, body: { error: 'Not found' } };
}

/**
 * A fake fetch over `route`. Calls are recorded; `fake.hold = true` makes new
 * graph requests wait until released (to test slow and overlapping requests).
 */
export function fakeFetch() {
  const fake = async (url, options = {}) => {
    const call = { url: String(url), options, request: options.body ? JSON.parse(options.body) : null };
    fake.calls.push(call);
    if (fake.hold && call.url.includes('/subgraph')) {
      await new Promise((resolve, reject) => {
        call.release = resolve;
        options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }
    const { status, body } = fake.override?.(call) || route(url, options);
    return { ok: status < 400, status, json: async () => body };
  };
  fake.calls = [];
  fake.hold = false;
  fake.graphCalls = () => fake.calls.filter(c => c.url.includes('/subgraph'));
  fake.lastGraphRequest = () => fake.graphCalls().at(-1)?.request;
  return fake;
}
