// Tests for static/js/panel.js, the details panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DetailPanel, PANDIT_NODE_URL } from '../../static/js/panel.js';
import { makeDom } from './helpers/dom.mjs';

const WROTE = 'source author wrote target work';
const COMM = 'source base text inspired target commentary';

const author = { id: '85303', type: 'author', label: 'Bhāsarvajña', dates: '10th c.', aka: 'Bhāsarvajña Ācārya', social_ids: 'Śaiva', discipline: 'Nyāya' };
const work = {
  id: '89000', type: 'work', label: 'Nyāyasāra', dates: '900',
  etext_links: { GRETIL: ['https://gretil.example/sa_nyAyasAra.htm'], DCS: { GitHub: ['https://github.com/x/files/Nyayasara'] } },
};
const comm = { id: '89001', type: 'work', label: 'Nyāyabhūṣaṇa' };
const nodes = [author, work, comm];
const edges = [
  { source: '85303', target: '89000', relationship: WROTE },
  { source: '89000', target: '89001', relationship: COMM },
];

function setup() {
  const { window } = makeDom();
  const root = window.document.createElement('aside');
  root.hidden = true;
  window.document.body.append(root);
  const actions = [];
  const panel = new DetailPanel({ root, onAction: (action, payload) => actions.push([action, payload]) });
  return { window, root, panel, actions };
}

const buttons = root => [...root.querySelectorAll('button[data-action]')];
const byAction = (root, action) => buttons(root).filter(b => b.dataset.action === action);

test('starts closed; show opens; hide empties', () => {
  const s = setup();
  assert.equal(s.panel.isOpen, false);
  s.panel.show(work, { nodes, edges });
  assert.equal(s.panel.isOpen, true);
  assert.equal(s.panel.node, work);
  s.panel.hide();
  assert.equal(s.panel.isOpen, false);
  assert.equal(s.root.children.length, 0);
  assert.equal(s.panel.node, null);
});

test('author facts', () => {
  const s = setup();
  s.panel.show(author, { nodes, edges });
  assert.equal(s.root.querySelector('.panel-title').textContent, 'Bhāsarvajña');
  assert.match(s.root.querySelector('.panel-kind').textContent, /Author · #85303/);
  const facts = Object.fromEntries([...s.root.querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]));
  assert.deepEqual(facts, {
    'Also known as': 'Bhāsarvajña Ācārya', Date: '10th c.', 'Social identifiers': 'Śaiva', Discipline: 'Nyāya',
  });
});

test('Pandit link and e-texts, opening in a new tab', () => {
  const s = setup();
  s.panel.show(work, { nodes, edges });
  const links = [...s.root.querySelectorAll('a')];
  assert.deepEqual(links.map(a => [a.textContent, a.href]), [
    ['Pandit', `${PANDIT_NODE_URL}89000`],
    ['sa_nyAyasAra', 'https://gretil.example/sa_nyAyasAra.htm'],
    ['Nyayasara', 'https://github.com/x/files/Nyayasara'],
  ]);
  assert.ok(links.every(a => a.target === '_blank' && a.rel === 'noopener'));
  assert.deepEqual([...s.root.querySelectorAll('.etext-collection h4')].map(h => h.textContent), ['GRETIL', 'DCS']);
  assert.equal(s.root.querySelector('.etext-category').textContent, 'GitHub');
});

test('no e-texts section for a node without them', () => {
  const s = setup();
  s.panel.show(author, { nodes, edges });
  assert.equal(s.root.querySelector('.panel-etexts'), null);
});

test('unsafe links are never links', () => {
  const s = setup();
  s.panel.show({ ...work, etext_links: { X: ['javascript:alert(1)'] } }, { nodes, edges });
  assert.deepEqual([...s.root.querySelectorAll('a')].map(a => a.textContent), ['Pandit']);
});

test('labels with markup are shown as text', () => {
  const s = setup();
  s.panel.show({ ...work, label: '<b onclick=x>bold</b>' }, { nodes, edges });
  assert.equal(s.root.querySelector('.panel-title b'), null);
  assert.equal(s.root.querySelector('.panel-title').textContent, '<b onclick=x>bold</b>');
});

test('connections are grouped and clickable', () => {
  const s = setup();
  s.panel.show(work, { nodes, edges });
  assert.deepEqual([...s.root.querySelectorAll('.panel-connections h4')].map(h => h.textContent), ['Authors (1)', 'Commentaries (1)']);
  byAction(s.root, 'select')[1].click();
  assert.deepEqual(s.actions, [['select', { id: '89001' }]]);
});

test('ordinary node: collapse, add to search, recenter; no expand', () => {
  const s = setup();
  s.panel.show(work, { nodes, edges });
  const names = buttons(s.root).map(b => b.dataset.action);
  assert.ok(!names.includes('expand'));
  assert.ok(names.includes('collapse'));
  assert.ok(names.includes('add-to-search'));
  assert.equal(byAction(s.root, 'recenter').length, 3);
  assert.equal(s.root.querySelector('.panel-status'), null);
});

test('searched-for node: no "Add to search", status says so', () => {
  const s = setup();
  s.panel.show(work, { nodes, edges, isCenter: true });
  assert.equal(byAction(s.root, 'add-to-search').length, 0);
  assert.equal(s.root.querySelector('.panel-status').textContent, 'In your search');
});

test('node with hidden connections offers Expand with the count', () => {
  const s = setup();
  s.panel.show({ ...comm, hidden_neighbors: 1 }, { nodes, edges });
  const expand = byAction(s.root, 'expand')[0];
  assert.equal(expand.textContent, 'Expand (+1)');
  assert.match(s.root.querySelector('.panel-status').textContent, /1 more connection not shown/);
  s.panel.show({ ...comm, hidden_neighbors: 4 }, { nodes, edges });
  assert.match(s.root.querySelector('.panel-status').textContent, /4 more connections not shown/);
});

test('excluded node offers Expand and not "Don\'t expand"', () => {
  const s = setup();
  s.panel.show({ ...comm, is_excluded: true }, { nodes, edges });
  assert.equal(byAction(s.root, 'expand')[0].textContent, 'Expand');
  assert.equal(byAction(s.root, 'collapse').length, 0);
  assert.match(s.root.querySelector('.panel-status').textContent, /Not expanded/);
});

test('buttons report their action with the node', () => {
  const s = setup();
  const node = { ...comm, hidden_neighbors: 2 };
  s.panel.show(node, { nodes, edges });
  byAction(s.root, 'expand')[0].click();
  byAction(s.root, 'collapse')[0].click();
  byAction(s.root, 'add-to-search')[0].click();
  byAction(s.root, 'recenter')[1].click();
  byAction(s.root, 'close')[0].click();
  assert.deepEqual(s.actions, [
    ['expand', { node }],
    ['collapse', { node }],
    ['add-to-search', { node }],
    ['recenter', { node, hops: 2 }],
    ['close', { node }],
  ]);
});

test('clicks on non-buttons do nothing', () => {
  const s = setup();
  s.panel.show(work, { nodes, edges });
  s.root.querySelector('.panel-title').click();
  assert.deepEqual(s.actions, []);
});
