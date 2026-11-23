/**
 * A search box that collects entities as chips (replaces jQuery + Select2).
 *
 * Typing asks the server for matches (debounced; a newer keystroke aborts the
 * older request), the results show in a list under the box, and picking one
 * adds it as a chip. Keyboard: ↑/↓ move through results, Enter picks,
 * Escape closes the list, Backspace in an empty box removes the last chip.
 *
 * Markup it builds inside `root`:
 *
 *   <div class="chip-search">
 *     <ul class="chips">  <li class="chip author|work">Name (dates) ×</li> … </ul>
 *     <input role="combobox" …>
 *     <ul class="results" role="listbox"> <li role="option">…</li> … </ul>
 *   </div>
 *
 * Tested in tests/js/chip-search.test.mjs (jsdom).
 */

let instanceCount = 0;

export class ChipSearch {
  /**
   * @param {object} options
   * @param {HTMLElement} options.root  element to build the component in
   * @param {(query: string, signal: AbortSignal) => Promise<Array>} options.search
   *        returns entities {id, type, name, dates?, aka?, has_etexts?}
   * @param {(items: Array) => void} [options.onChange]  called with the chips after each change
   * @param {string} [options.placeholder]
   * @param {string} [options.label]  accessible name for the input
   * @param {number} [options.debounceMs]
   */
  constructor({ root, search, onChange = () => {}, placeholder = '', label = '', debounceMs = 150 }) {
    this.root = root;
    this.search = search;
    this.onChange = onChange;
    this.debounceMs = debounceMs;
    this.items = [];
    this.results = [];
    this.active = -1;
    this.timer = null;
    this.controller = null;
    this.id = `chip-search-${++instanceCount}`;

    const doc = root.ownerDocument;
    this.el = doc.createElement('div');
    this.el.className = 'chip-search';

    this.chipList = doc.createElement('ul');
    this.chipList.className = 'chips';

    this.input = doc.createElement('input');
    Object.assign(this.input, { type: 'text', placeholder, autocomplete: 'off', spellcheck: false });
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-expanded', 'false');
    this.input.setAttribute('aria-controls', `${this.id}-results`);
    if (label) this.input.setAttribute('aria-label', label);
    // Not a credential: keep password managers' inline menus out of this field.
    this.input.setAttribute('data-1p-ignore', '');
    this.input.setAttribute('data-lpignore', 'true');
    this.input.setAttribute('data-bwignore', '');

    this.resultList = doc.createElement('ul');
    this.resultList.className = 'results';
    this.resultList.id = `${this.id}-results`;
    this.resultList.setAttribute('role', 'listbox');
    this.resultList.hidden = true;

    this.el.append(this.chipList, this.input, this.resultList);
    root.append(this.el);

    this.input.addEventListener('input', () => this.scheduleSearch());
    this.input.addEventListener('keydown', e => this.onKeyDown(e));
    this.input.addEventListener('blur', () => {
      // Let a click on a result land before the list closes.
      setTimeout(() => this.closeResults(), 150);
    });
    this.input.addEventListener('focus', () => {
      if (this.results.length) this.openResults();
    });
    // mousedown (not click) so the input doesn't lose focus first.
    this.resultList.addEventListener('mousedown', e => {
      const li = e.target.closest('li[data-index]');
      if (!li) return;
      e.preventDefault();
      this.pick(Number(li.dataset.index));
    });
    // Clicking the empty part of the box focuses the input.
    this.el.addEventListener('click', e => {
      if (e.target === this.el || e.target === this.chipList) this.input.focus();
    });
  }

  /** Current chips. */
  getItems() {
    return [...this.items];
  }

  /** Replace the chips without calling onChange (used when state comes from elsewhere). */
  setItems(items) {
    this.items = [...items];
    this.renderChips();
  }

  /** Add an entity as a chip (no-op if already there) and notify. */
  add(entity) {
    if (!this.items.some(item => item.id === entity.id)) {
      this.items.push(entity);
      this.renderChips();
      this.onChange(this.getItems());
    }
  }

  /** Remove the chip with this ID and notify. */
  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter(item => item.id !== id);
    if (this.items.length !== before) {
      this.renderChips();
      this.onChange(this.getItems());
    }
  }

  focus() {
    this.input.focus();
  }

  scheduleSearch() {
    clearTimeout(this.timer);
    const query = this.input.value.trim();
    if (!query) {
      this.controller?.abort();
      this.setResults([]);
      return;
    }
    this.timer = setTimeout(() => this.runSearch(query), this.debounceMs);
  }

  async runSearch(query) {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.el.classList.add('searching');
    try {
      const results = await this.search(query, controller.signal);
      if (controller.signal.aborted || this.input.value.trim() !== query) return;
      this.setResults(results, query);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      this.setResults([], query, err.message || 'Search failed');
    } finally {
      if (this.controller === controller) this.el.classList.remove('searching');
    }
  }

  /** Show `results` (or a "no matches" / error line) under the box. */
  setResults(results, query = '', error = '') {
    const doc = this.root.ownerDocument;
    const chosen = new Set(this.items.map(item => item.id));
    this.results = results.filter(r => !chosen.has(r.id));
    this.active = this.results.length ? 0 : -1;
    this.resultList.replaceChildren();

    this.results.forEach((entity, index) => {
      const li = doc.createElement('li');
      li.id = `${this.id}-option-${index}`;
      li.dataset.index = String(index);
      li.setAttribute('role', 'option');
      li.className = `result ${entity.type}`;
      li.append(typeMark(doc, entity.type));
      const text = doc.createElement('span');
      text.className = 'result-text';
      const name = doc.createElement('span');
      name.className = 'entity-name';
      name.textContent = entity.name;
      text.append(name);
      const meta = [entity.dates, entity.aka && `aka ${entity.aka}`, `#${entity.id}`].filter(Boolean).join(' · ');
      const metaEl = doc.createElement('span');
      metaEl.className = 'result-meta';
      metaEl.textContent = meta;
      text.append(metaEl);
      li.append(text);
      if (entity.has_etexts) {
        const badge = doc.createElement('span');
        badge.className = 'etext-badge';
        badge.title = 'E-texts available';
        badge.textContent = 'e-text';
        li.append(badge);
      }
      this.resultList.append(li);
    });

    if (!this.results.length && query) {
      const li = doc.createElement('li');
      li.className = error ? 'result-empty error' : 'result-empty';
      li.textContent = error || `No authors or works match “${query}”.`;
      this.resultList.append(li);
    }
    this.highlight();
    if (this.resultList.children.length && this.input === doc.activeElement) this.openResults();
    else if (!this.resultList.children.length) this.closeResults();
  }

  openResults() {
    this.resultList.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
  }

  closeResults() {
    this.resultList.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
  }

  highlight() {
    [...this.resultList.querySelectorAll('li[data-index]')].forEach((li, i) => {
      const on = i === this.active;
      li.classList.toggle('active', on);
      li.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on && typeof li.scrollIntoView === 'function') li.scrollIntoView({ block: 'nearest' });
    });
    if (this.active >= 0) this.input.setAttribute('aria-activedescendant', `${this.id}-option-${this.active}`);
    else this.input.removeAttribute('aria-activedescendant');
  }

  pick(index) {
    const entity = this.results[index];
    if (!entity) return;
    this.input.value = '';
    this.setResults([]);
    this.closeResults();
    this.add(entity);
  }

  onKeyDown(e) {
    const count = this.results.length;
    if (e.key === 'ArrowDown' && count) {
      e.preventDefault();
      this.openResults();
      this.active = (this.active + 1) % count;
      this.highlight();
    } else if (e.key === 'ArrowUp' && count) {
      e.preventDefault();
      this.active = (this.active - 1 + count) % count;
      this.highlight();
    } else if (e.key === 'Enter') {
      if (count && this.active >= 0 && !this.resultList.hidden) {
        e.preventDefault();
        this.pick(this.active);
      }
    } else if (e.key === 'Escape') {
      if (!this.resultList.hidden) {
        e.preventDefault();
        e.stopPropagation();
        this.closeResults();
      }
    } else if (e.key === 'Backspace' && !this.input.value && this.items.length) {
      this.remove(this.items[this.items.length - 1].id);
    }
  }

  renderChips() {
    const doc = this.root.ownerDocument;
    this.chipList.replaceChildren(...this.items.map(item => {
      const li = doc.createElement('li');
      li.className = `chip ${item.type}`;
      li.dataset.id = item.id;
      li.append(typeMark(doc, item.type));
      const name = doc.createElement('span');
      name.className = 'entity-name';
      name.textContent = item.name || item.id;
      li.title = [item.name, item.dates, `#${item.id}`].filter(Boolean).join(' · ');
      li.append(name);
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'chip-remove';
      button.setAttribute('aria-label', `Remove ${item.name || item.id}`);
      button.textContent = '×';
      button.addEventListener('click', () => this.remove(item.id));
      li.append(button);
      return li;
    }));
    this.el.classList.toggle('has-chips', this.items.length > 0);
  }
}

/** The little circle (author) or square (work) used throughout the interface. */
export function typeMark(doc, type) {
  const mark = doc.createElement('span');
  mark.className = `type-mark ${type}`;
  mark.setAttribute('aria-hidden', 'true');
  mark.title = type === 'author' ? 'Author' : 'Work';
  return mark;
}
