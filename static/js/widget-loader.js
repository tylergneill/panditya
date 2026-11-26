/**
 * Pāṇḍitya widget loader, for other people's sites (served at /widget.js).
 *
 * Install with one tag:
 *
 *   <script src="https://panditya.info/widget.js" async></script>
 *
 * That puts a small Pāṇḍitya button in a corner of the page. It opens a panel
 * over the page, in the same window, with three sizes of use:
 *
 *   1. Small (the default): /widget, one search and a 1-hop graph.
 *   2. Expanded: a large overlay with the full app (/view), every feature.
 *   3. "Open at panditya.info": the same search or graph in a new tab.
 *
 * Both views run in an iframe, so the site's styles and ours can't touch each
 * other; the button and the panel's frame live in a shadow root for the same
 * reason. The page inside the iframe posts {type: 'panditya:state', path} after
 * every change (static/js/embed.js), which is how the loader knows what to open
 * when expanding or opening a new tab.
 *
 * Options, as attributes on the script tag:
 *   data-position="left"    put the button bottom left (default: bottom right)
 *   data-launcher="false"   no button; open only from marked names or the API
 *   data-pandit-links="true"  links to panditproject.org/node/<id> open the widget
 *                           (Ctrl/Cmd/Shift-click still follows the link)
 *
 * Marking names on the page (a click opens the widget there):
 *   <span data-panditya-work="89000">Nyāyasāra</span>
 *   <span data-panditya-author="85352">Abhinavagupta</span>
 *   <span data-panditya-search="Kālidāsa">Kālidāsa</span>
 *
 * Script API: window.Panditya.open({works, authors, ids, search, size}),
 * .expand(), .shrink(), .close().
 *
 * Plain ES2017 with no imports or build step, so it runs as a classic script
 * on any site. Tested in tests/js/widget-loader.test.mjs.
 */
(function () {
  'use strict';

  if (window.Panditya && window.Panditya.loaded) return; // included twice

  var script = document.currentScript;
  var BASE = new URL(script && script.src ? script.src : 'https://panditya.info/widget.js', window.location.href).origin;
  var data = (script && script.dataset) || {};
  var config = {
    left: data.position === 'left',
    launcher: data.launcher !== 'false',
    panditLinks: data.panditLinks === 'true',
  };

  var STATE_MESSAGE = 'panditya:state';
  var PANDIT_LINK = /^https?:\/\/(?:www\.)?panditproject\.org\/node\/(\d+)\/?(?:[?#].*)?$/;
  var ID = /^\d+$/;

  // --- State ------------------------------------------------------------------

  var host = null;          // the element in the page that holds the shadow root
  var ui = null;            // {launcher, panel, backdrop, frame, sizeButton}
  var size = 'closed';      // 'closed' | 'small' | 'large'
  var shownPath = '/';      // what the iframe shows, as a Pāṇḍitya path ('/view?...' or '/')
  var lastFocus = null;     // where focus was before the panel opened, to give it back

  // --- Paths --------------------------------------------------------------------

  function idList(value) {
    return (Array.isArray(value) ? value : value ? String(value).split(',') : [])
      .map(function (x) { return String(x).trim(); })
      .filter(function (x) { return ID.test(x); });
  }

  /** The small view's address for a start ({works, authors, ids, search}). */
  function widgetUrl(start) {
    var q = new URLSearchParams();
    var works = idList(start.works), authors = idList(start.authors), ids = idList(start.ids);
    if (works.length) q.set('works', works[0]);
    else if (authors.length) q.set('authors', authors[0]);
    else if (ids.length) q.set('ids', ids[0]);
    else if (start.search) q.set('q', String(start.search).slice(0, 200));
    var query = q.toString();
    return BASE + '/widget' + (query ? '?' + query : '');
  }

  /** The small view's address for a Pāṇḍitya path ('/view?works=...'): its first author or work. */
  function widgetUrlForPath(path) {
    var q = new URL(path, BASE).searchParams;
    return widgetUrl({ works: q.get('works'), authors: q.get('authors') });
  }

  /** A Pāṇḍitya path for a start, for the expanded view and new tabs. */
  function pathFor(start) {
    var works = idList(start.works), authors = idList(start.authors);
    if (!works.length && !authors.length) return '/';
    var parts = [];
    if (authors.length) parts.push('authors=' + authors.join(','));
    if (works.length) parts.push('works=' + works.join(','));
    parts.push('hops=1');
    return '/view?' + parts.join('&');
  }

  /** Accept only our own app's paths from the iframe ('/' or '/view?...'). */
  function safePath(path) {
    if (typeof path !== 'string' || path.charAt(0) !== '/' || path.charAt(1) === '/') return null;
    var url;
    try { url = new URL(path, BASE); } catch (e) { return null; }
    if (url.origin !== BASE) return null;
    if (url.pathname === '/' && !url.search) return '/';
    if (url.pathname === '/view') return url.pathname + url.search;
    return null;
  }

  // --- Building the UI ----------------------------------------------------------

  var CSS = [
    ':host { all: initial; }',
    '* { box-sizing: border-box; }',
    'button { font: inherit; cursor: pointer; }',
    '.launcher { position: fixed; bottom: 16px; z-index: 2147483000; width: 52px; height: 52px;',
    '  border-radius: 50%; border: 2px solid #5a0b73; background: #2f1746; padding: 0;',
    '  display: flex; align-items: center; justify-content: center;',
    '  box-shadow: 0 4px 14px rgba(20, 10, 30, 0.35); transition: transform 0.15s ease; }',
    '.launcher:hover { transform: scale(1.06); }',
    '.launcher:focus-visible, .tool:focus-visible { outline: 2px solid #e0afff; outline-offset: 2px; }',
    '.launcher img { width: 34px; height: 34px; }',
    '.right { right: 16px; } .left { left: 16px; }',
    '.backdrop { position: fixed; inset: 0; z-index: 2147483001; background: rgba(15, 8, 22, 0.5); }',
    '.panel { position: fixed; z-index: 2147483002; display: flex; flex-direction: column;',
    '  background: #2f1746; border: 1px solid #5a0b73; border-radius: 12px; overflow: hidden;',
    '  box-shadow: 0 12px 40px rgba(20, 10, 30, 0.45);',
    '  font: 14px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }',
    '.panel.small { bottom: 80px; width: min(380px, calc(100vw - 32px)); height: min(540px, calc(100vh - 112px)); }',
    '.panel.small.no-launcher { bottom: 16px; height: min(540px, calc(100vh - 32px)); }',
    '.panel.large { inset: 3vh 3vw; width: auto; height: auto; }',
    '.bar { display: flex; align-items: center; gap: 4px; padding: 6px 6px 6px 12px; color: #fff; }',
    '.title { flex: 1; font: 700 16px/1 "Gentium Plus", Georgia, serif; letter-spacing: 0.01em; }',
    '.tool { min-width: 30px; height: 28px; padding: 0 8px; border-radius: 6px; color: #fff;',
    '  background: none; border: 1px solid rgba(255, 255, 255, 0.28); font-size: 13px; }',
    '.tool:hover { background: rgba(255, 255, 255, 0.12); }',
    'iframe { flex: 1; width: 100%; border: 0; background: #f5f2ee; }',
    '[hidden] { display: none !important; }',
    '@media (max-width: 600px) {',
    '  .panel.small { left: 0; right: 0; bottom: 0; width: 100%; height: 65vh; border-radius: 12px 12px 0 0; }',
    '  .panel.large { inset: 0; border-radius: 0; }',
    '  .tool .label { display: none; }',
    '}',
  ].join('\n');

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text) node.textContent = text;
    return node;
  }

  function tool(action, label, symbol) {
    var b = el('button', { type: 'button', class: 'tool', 'data-action': action, title: label, 'aria-label': label });
    b.append(el('span', { 'aria-hidden': 'true' }, symbol));
    return b;
  }

  function build() {
    host = el('div', { id: 'panditya-widget' });
    var root = host.attachShadow({ mode: 'open' });
    root.append(el('style', {}, CSS));
    var side = config.left ? 'left' : 'right';

    var launcher = el('button', { type: 'button', class: 'launcher ' + side, title: 'Open Pāṇḍitya', 'aria-label': 'Open Pāṇḍitya' });
    launcher.append(el('img', { src: BASE + '/static/imgs/panditya.png', alt: '' }));
    launcher.hidden = !config.launcher;
    launcher.addEventListener('click', function () { size === 'closed' ? open() : close(); });

    var backdrop = el('div', { class: 'backdrop' });
    backdrop.hidden = true;
    backdrop.addEventListener('click', shrink);

    var panel = el('div', { class: 'panel small ' + side + (config.launcher ? '' : ' no-launcher'), role: 'dialog', 'aria-label': 'Pāṇḍitya' });
    panel.hidden = true;
    var bar = el('div', { class: 'bar' });
    var sizeButton = tool('size', 'Expand', '⤢');
    bar.append(el('span', { class: 'title' }, 'Pāṇḍitya'), sizeButton,
      tool('newtab', 'Open at panditya.info', '↗'), tool('close', 'Close', '×'));
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-action]');
      if (!b) return;
      var action = b.getAttribute('data-action');
      if (action === 'size') size === 'large' ? shrink() : expand();
      else if (action === 'newtab') openInNewTab();
      else if (action === 'close') close();
    });
    var frame = el('iframe', { title: 'Pāṇḍitya', referrerpolicy: 'origin' });
    panel.append(bar, frame);
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); size === 'large' ? shrink() : close(); }
    });

    root.append(launcher, backdrop, panel);
    (document.body || document.documentElement).append(host);
    ui = { launcher: launcher, panel: panel, backdrop: backdrop, frame: frame, sizeButton: sizeButton };
  }

  function ensureUi() {
    if (!ui) build();
    return ui;
  }

  // --- Sizes ------------------------------------------------------------------------

  function setSize(next) {
    size = next;
    var u = ensureUi();
    u.panel.hidden = next === 'closed';
    u.backdrop.hidden = next !== 'large';
    u.panel.classList.toggle('small', next === 'small');
    u.panel.classList.toggle('large', next === 'large');
    u.panel.setAttribute('aria-modal', next === 'large' ? 'true' : 'false');
    var label = next === 'large' ? 'Make small' : 'Expand';
    u.sizeButton.title = label;
    u.sizeButton.setAttribute('aria-label', label);
    u.sizeButton.firstChild.textContent = next === 'large' ? '⤡' : '⤢';
    u.launcher.setAttribute('aria-expanded', String(next !== 'closed'));
  }

  /**
   * Open the widget. With no argument it shows whatever it showed last (or an
   * empty search). `start` = {works, authors, ids, search, size: 'small'|'large'}.
   * A bare Pandit ID or a search always opens small: only the small view can
   * look up an ID's type or show search results; Expand then works as usual.
   */
  function open(start) {
    start = start || {};
    var u = ensureUi();
    if (size === 'closed') lastFocus = document.activeElement;
    var target = idList(start.works).length || idList(start.authors).length || idList(start.ids).length || start.search;
    var lookup = !idList(start.works).length && !idList(start.authors).length && target;
    var wanted = start.size === 'large' && !lookup ? 'large'
      : start.size ? 'small'
      : size === 'large' ? 'large' : 'small';

    if (target) {
      shownPath = pathFor(start);
      load(wanted === 'large' ? BASE + shownPath : widgetUrl(start), wanted);
    } else if (u.frame.getAttribute('data-view') !== wanted) {
      load(wanted === 'large' ? BASE + shownPath : widgetUrlForPath(shownPath), wanted);
    }
    setSize(wanted);
    u.panel.querySelector('button[data-action="close"]').focus();
  }

  /** Point the iframe at `src`, remembering which view ('small' or 'large') that is. */
  function load(src, view) {
    var frame = ensureUi().frame;
    frame.setAttribute('src', src);
    frame.setAttribute('data-view', view);
  }

  function expand() {
    if (size === 'large') return;
    load(BASE + shownPath, 'large');
    setSize('large');
  }

  function shrink() {
    if (size !== 'large') return;
    load(widgetUrlForPath(shownPath), 'small');
    setSize('small');
  }

  function close() {
    if (size === 'closed') return;
    setSize('closed');
    if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  function openInNewTab() {
    window.open(BASE + shownPath, '_blank', 'noopener');
  }

  // --- Messages from the iframe -------------------------------------------------------

  window.addEventListener('message', function (e) {
    if (!ui || e.origin !== BASE || e.source !== ui.frame.contentWindow) return;
    var msg = e.data;
    if (!msg || msg.type !== STATE_MESSAGE) return;
    var path = safePath(msg.path);
    if (path) shownPath = path;
  });

  // --- Marked names and Pandit links ---------------------------------------------------

  function startFromElement(target) {
    var marked = target.closest('[data-panditya-work],[data-panditya-author],[data-panditya-search]');
    if (marked) {
      return {
        element: marked,
        start: {
          works: marked.getAttribute('data-panditya-work'),
          authors: marked.getAttribute('data-panditya-author'),
          search: marked.getAttribute('data-panditya-search'),
        },
      };
    }
    if (config.panditLinks) {
      var link = target.closest('a[href]');
      var match = link && PANDIT_LINK.exec(link.href);
      if (match) return { element: link, start: { ids: match[1] } };
    }
    return null;
  }

  document.addEventListener('click', function (e) {
    // Leave modified clicks alone, so Ctrl/Cmd-click still opens a link in a new tab.
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (!(e.target instanceof Element) || (host && host.contains(e.target))) return;
    var found = startFromElement(e.target);
    if (!found) return;
    e.preventDefault();
    open(found.start);
  });

  // Marked names that aren't links still need to work from the keyboard.
  function markNames(root) {
    var marked = (root || document).querySelectorAll('[data-panditya-work],[data-panditya-author],[data-panditya-search]');
    Array.prototype.forEach.call(marked, function (node) {
      if (node.closest('a[href], button')) return;
      if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '0');
      if (!node.hasAttribute('role')) node.setAttribute('role', 'button');
      if (!node.title) node.title = 'Show in Pāṇḍitya';
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (!(e.target instanceof Element) || e.target.closest('a[href], button, input, textarea, select')) return;
    var found = startFromElement(e.target);
    if (!found || found.element !== e.target) return;
    e.preventDefault();
    open(found.start);
  });

  // --- Start -----------------------------------------------------------------------

  function init() {
    if (config.launcher) ensureUi();
    markNames(document);
  }

  window.Panditya = {
    loaded: true,
    open: open,
    expand: function () { if (size === 'closed') open({ size: 'large' }); else expand(); },
    shrink: shrink,
    close: close,
    /** Mark names added to the page after it loaded (keyboard access; clicks work anyway). */
    refresh: markNames,
    /** 'closed', 'small' or 'large'. */
    get size() { return size; },
  };

  // Put the button in as soon as there is a body; names further down the page
  // are marked once it has all loaded (both steps are safe to repeat).
  if (document.body) init();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
})();
