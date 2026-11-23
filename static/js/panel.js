/**
 * The details panel for the selected node (replaces the right-click menus).
 *
 * It shows what the old "More info" and "View on" submenus held (dates,
 * aka, social identifiers, discipline, links to Pandit and to e-texts), the
 * node's connections on screen, and the actions that used to be in the
 * "Recenter" and "Exclusions" submenus.
 *
 * All text goes in through textContent and every link is checked to be
 * http(s), so names or links in the data can't inject markup.
 *
 * Tested in tests/js/panel.test.mjs (jsdom).
 */

import { groupEtextLinks } from './etext-links.js';
import { connectionGroups } from './graph-model.js';
import { typeMark } from './chip-search.js';

export const PANDIT_NODE_URL = 'https://www.panditproject.org/node/';

export class DetailPanel {
  /**
   * @param {object} options
   * @param {HTMLElement} options.root  the (initially hidden) panel element
   * @param {(action: string, payload: object) => void} options.onAction
   *        called with one of: 'close'; 'select' {id}; 'expand' {node};
   *        'collapse' {node}; 'recenter' {node, hops}; 'add-to-search' {node}
   */
  constructor({ root, onAction }) {
    this.root = root;
    this.onAction = onAction;
    this.node = null;
    root.addEventListener('click', e => {
      const button = e.target.closest('[data-action]');
      if (!button || !this.root.contains(button)) return;
      const action = button.dataset.action;
      if (action === 'select') this.onAction('select', { id: button.dataset.id });
      else if (action === 'recenter') this.onAction('recenter', { node: this.node, hops: Number(button.dataset.hops) });
      else this.onAction(action, { node: this.node });
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  hide() {
    this.node = null;
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  /**
   * Show `node`.
   * @param {object} node a node from the graph response
   * @param {{nodes: Array, edges: Array, isCenter: boolean}} context
   */
  show(node, { nodes, edges, isCenter = false }) {
    this.node = node;
    const doc = this.root.ownerDocument;
    const el = (tag, className, text) => {
      const e = doc.createElement(tag);
      if (className) e.className = className;
      if (text !== undefined && text !== null) e.textContent = text;
      return e;
    };
    const button = (label, action, extra = {}) => {
      const b = el('button', `panel-button ${extra.className || ''}`.trim(), label);
      b.type = 'button';
      b.dataset.action = action;
      for (const [k, v] of Object.entries(extra.data || {})) b.dataset[k] = v;
      if (extra.title) b.title = extra.title;
      if (extra.pressed !== undefined) b.setAttribute('aria-pressed', String(extra.pressed));
      return b;
    };

    // Header: type, ID, close.
    const header = el('div', 'panel-header');
    const kind = el('span', 'panel-kind');
    kind.append(typeMark(doc, node.type), doc.createTextNode(` ${node.type === 'author' ? 'Author' : 'Work'} · #${node.id}`));
    const close = button('×', 'close', { className: 'panel-close', title: 'Close (Esc)' });
    close.setAttribute('aria-label', 'Close details');
    header.append(kind, close);

    const title = el('h2', 'panel-title entity-name', node.label);

    // Facts.
    const facts = el('dl', 'panel-facts');
    const fact = (term, value) => {
      if (!value) return;
      facts.append(el('dt', null, term), el('dd', null, value));
    };
    fact('Also known as', node.aka);
    fact('Date', node.dates);
    fact('Social identifiers', node.social_ids);
    fact('Discipline', node.discipline);
    fact('Disciplines', node.disciplines);

    // Status line: why the node looks the way it does.
    const notes = [];
    if (isCenter) notes.push('In your search');
    if (node.is_excluded) notes.push('Not expanded');
    if (node.hidden_neighbors > 0) {
      notes.push(`${node.hidden_neighbors} more connection${node.hidden_neighbors === 1 ? '' : 's'} not shown`);
    }
    const status = notes.length ? el('p', 'panel-status', notes.join(' · ')) : null;

    // Actions.
    const actions = el('div', 'panel-actions');
    if (node.is_excluded || node.hidden_neighbors > 0) {
      const label = node.hidden_neighbors > 0 ? `Expand (+${node.hidden_neighbors})` : 'Expand';
      actions.append(button(label, 'expand', { className: 'primary', title: 'Show its connections here (double-click a node does the same)' }));
    }
    if (!node.is_excluded) {
      actions.append(button("Don't expand", 'collapse', { title: 'Hide the connections that only this node brings in' }));
    }
    if (!isCenter) {
      actions.append(button('Add to search', 'add-to-search', { title: 'Add it to the search box' }));
    }
    const recenter = el('div', 'panel-recenter');
    recenter.append(el('span', 'panel-recenter-label', 'Recenter here:'));
    for (const hops of [1, 2, 3]) {
      recenter.append(button(String(hops), 'recenter', {
        className: 'hop-chip', data: { hops: String(hops) }, title: `Start over from this node, ${hops} hop${hops > 1 ? 's' : ''} out`,
      }));
    }

    // Links: Pandit, then e-texts by collection.
    const links = el('section', 'panel-links');
    links.append(el('h3', null, 'View on'));
    const linkList = el('ul', 'link-list');
    const pandit = el('li');
    pandit.append(externalLink(doc, `${PANDIT_NODE_URL}${encodeURIComponent(node.id)}`, 'Pandit'));
    linkList.append(pandit);
    links.append(linkList);

    const etexts = groupEtextLinks(node.etext_links);
    if (etexts.length) {
      const etextSection = el('section', 'panel-etexts');
      etextSection.append(el('h3', null, 'E-texts'));
      for (const { collection, groups } of etexts) {
        const block = el('div', 'etext-collection');
        block.append(el('h4', null, collection));
        for (const { category, links: items } of groups) {
          if (category) block.append(el('div', 'etext-category', category));
          const ul = el('ul', 'link-list');
          for (const { href, label } of items) {
            const li = el('li');
            li.append(externalLink(doc, href, label));
            ul.append(li);
          }
          block.append(ul);
        }
        etextSection.append(block);
      }
      links.append(etextSection);
    }

    // Connections on screen.
    const groups = connectionGroups(node, nodes, edges);
    const connections = el('section', 'panel-connections');
    if (groups.length) {
      connections.append(el('h3', null, 'Connections'));
      for (const group of groups) {
        connections.append(el('h4', null, `${group.title} (${group.nodes.length})`));
        const ul = el('ul', 'connection-list');
        for (const other of group.nodes) {
          const li = el('li');
          const b = button('', 'select', { className: `connection ${other.type}`, data: { id: other.id } });
          b.append(typeMark(doc, other.type), el('span', 'entity-name', other.label));
          if (other.dates) b.append(el('span', 'connection-date', other.dates));
          li.append(b);
          ul.append(li);
        }
        connections.append(ul);
      }
    }

    this.root.replaceChildren(...[header, title, facts, status, actions, recenter, links, connections].filter(Boolean));
    this.root.hidden = false;
    this.root.scrollTop = 0;
  }
}

/** An <a> that opens in a new tab, or plain text if `href` isn't http(s). */
function externalLink(doc, href, label) {
  let safe = false;
  try {
    safe = ['http:', 'https:'].includes(new URL(href).protocol);
  } catch {
    safe = false;
  }
  if (!safe) {
    const span = doc.createElement('span');
    span.textContent = label;
    return span;
  }
  const a = doc.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = label;
  return a;
}
