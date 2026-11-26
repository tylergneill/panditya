// Tests of the widget loader (static/js/widget-loader.js), run as a classic
// script in a jsdom page, the way a host site would include it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const LOADER = readFileSync(new URL('../../static/js/widget-loader.js', import.meta.url), 'utf8');
// An inline script has no src, so the loader falls back to the public site.
const BASE = 'https://panditya.info';

/** A host page with `body` HTML, then the loader in a script tag carrying `attrs` ({name: value}). */
function hostPage(t, { body = '', attrs = {} } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${body}</body>`,
    { url: 'https://example.org/page', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  // Added as a node, not as markup: the loader's comments mention </script>.
  const script = window.document.createElement('script');
  for (const [name, value] of Object.entries(attrs)) script.setAttribute(name, value);
  script.textContent = LOADER;
  window.document.body.append(script);
  t.after(() => window.close());
  const opened = [];
  window.open = (...args) => opened.push(args);
  const shadow = () => window.document.getElementById('panditya-widget')?.shadowRoot;
  const q = sel => shadow()?.querySelector(sel);
  const page = {
    window,
    document: window.document,
    opened,
    shadow,
    q,
    frame: () => q('iframe'),
    src: () => q('iframe')?.getAttribute('src'),
    tool: action => q(`button[data-action="${action}"]`),
    click: el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })),
    /** The iframe telling the loader what it shows. */
    post: (data, { origin = BASE, source } = {}) => window.dispatchEvent(new window.MessageEvent('message',
      { data, origin, source: source === undefined ? q('iframe').contentWindow : source })),
  };
  return page;
}

test('adds one button in the corner; nothing opens until it is clicked', t => {
  const page = hostPage(t);
  const launcher = page.q('.launcher');
  assert.ok(launcher.classList.contains('right'));
  assert.equal(launcher.getAttribute('aria-label'), 'Open Pāṇḍitya');
  assert.equal(launcher.querySelector('img').getAttribute('src'), `${BASE}/static/imgs/panditya.png`);
  assert.equal(page.q('.panel').hidden, true);
  assert.equal(page.src(), null);
  assert.equal(page.window.Panditya.size, 'closed');
});

test('the button opens the small view, and closes it again', t => {
  const page = hostPage(t);
  page.click(page.q('.launcher'));
  assert.equal(page.window.Panditya.size, 'small');
  assert.equal(page.q('.panel').hidden, false);
  assert.ok(page.q('.panel').classList.contains('small'));
  assert.equal(page.src(), `${BASE}/widget`);
  assert.equal(page.q('.backdrop').hidden, true, 'the small view leaves the page usable');
  page.click(page.q('.launcher'));
  assert.equal(page.window.Panditya.size, 'closed');
  assert.equal(page.q('.panel').hidden, true);
});

test('Expand shows the full app on what the small view showed; the other button makes it small again', t => {
  const page = hostPage(t);
  page.window.Panditya.open();
  page.post({ type: 'panditya:state', path: '/view?works=89000&hops=1' });
  page.click(page.tool('size'));
  assert.equal(page.window.Panditya.size, 'large');
  assert.equal(page.src(), `${BASE}/view?works=89000&hops=1`);
  assert.equal(page.q('.backdrop').hidden, false);
  assert.equal(page.tool('size').getAttribute('aria-label'), 'Make small');
  // The full app moves on (more hops, another search); small follows its first entity.
  page.post({ type: 'panditya:state', path: '/view?authors=85352&works=89000&hops=2&expand=1' });
  page.click(page.tool('size'));
  assert.equal(page.window.Panditya.size, 'small');
  assert.equal(page.src(), `${BASE}/widget?works=89000`);
});

test('Open at panditya.info opens what is on show, in a new tab', t => {
  const page = hostPage(t);
  page.window.Panditya.open();
  page.click(page.tool('newtab'));
  page.post({ type: 'panditya:state', path: '/view?authors=85352&hops=1' });
  page.click(page.tool('newtab'));
  assert.deepEqual(page.opened.map(a => a[0]), [`${BASE}/`, `${BASE}/view?authors=85352&hops=1`]);
  assert.ok(page.opened.every(a => a[1] === '_blank' && a[2] === 'noopener'));
});

test('messages from anywhere but our own iframe, or for other pages, are ignored', t => {
  const page = hostPage(t);
  page.window.Panditya.open();
  page.post({ type: 'panditya:state', path: '/view?works=1&hops=1' }, { origin: 'https://evil.example' });
  page.post({ type: 'panditya:state', path: '/view?works=2&hops=1' }, { source: page.window });
  for (const path of ['//evil.example/view', 'https://evil.example/view?works=3', '/api/graph', '/about', 'javascript:alert(1)']) {
    page.post({ type: 'panditya:state', path });
  }
  page.post({ type: 'other', path: '/view?works=4' });
  page.click(page.tool('newtab'));
  assert.deepEqual(page.opened.map(a => a[0]), [`${BASE}/`]);
});

test('Escape makes the expanded view small, then closes it; the backdrop makes it small', t => {
  const page = hostPage(t);
  page.window.Panditya.open({ works: '89000', size: 'large' });
  assert.equal(page.src(), `${BASE}/view?works=89000&hops=1`);
  const esc = () => page.tool('close').dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  esc();
  assert.equal(page.window.Panditya.size, 'small');
  esc();
  assert.equal(page.window.Panditya.size, 'closed');
  page.window.Panditya.expand();
  page.click(page.q('.backdrop'));
  assert.equal(page.window.Panditya.size, 'small');
});

test('closing and reopening keeps what was shown, without reloading', t => {
  const page = hostPage(t);
  page.window.Panditya.open({ authors: '85352' });
  const frame = page.frame();
  page.click(page.tool('close'));
  page.window.Panditya.open();
  assert.equal(page.frame(), frame);
  assert.equal(page.src(), `${BASE}/widget?authors=85352`);
});

test('marked names open the widget on their author, work or search', t => {
  const page = hostPage(t, {
    body: `<span id="w" data-panditya-work="89000">Nyāyasāra</span>
           <span id="a" data-panditya-author="85352"><i id="inner">Abhinava</i>gupta</span>
           <span id="s" data-panditya-search="Kālidāsa">Kālidāsa</span>
           <span id="bad" data-panditya-work="89000&amp;x">bad</span>`,
  });
  page.click(page.document.getElementById('w'));
  assert.equal(page.src(), `${BASE}/widget?works=89000`);
  page.click(page.document.getElementById('inner'));
  assert.equal(page.src(), `${BASE}/widget?authors=85352`);
  page.click(page.document.getElementById('s'));
  assert.equal(page.src(), `${BASE}/widget?q=K%C4%81lid%C4%81sa`);
  page.click(page.document.getElementById('bad'));
  assert.equal(page.src(), `${BASE}/widget?q=K%C4%81lid%C4%81sa`, 'only numeric IDs are passed on');
  // They are reachable by keyboard too.
  const w = page.document.getElementById('w');
  assert.equal(w.getAttribute('tabindex'), '0');
  assert.equal(w.getAttribute('role'), 'button');
  page.window.Panditya.close();
  w.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(page.window.Panditya.size, 'small');
  assert.equal(page.src(), `${BASE}/widget?works=89000`);
});

test('Pandit links open the widget only when the site asks, and never on a modified click', t => {
  const body = '<a id="p" href="https://www.panditproject.org/node/85303">Bhāsarvajña</a><a id="o" href="https://example.org/node/1">other</a>';
  const off = hostPage(t, { body });
  off.click(off.document.getElementById('p'));
  assert.equal(off.window.Panditya.size, 'closed');

  const page = hostPage(t, { body, attrs: { 'data-pandit-links': 'true' } });
  const link = page.document.getElementById('p');
  const ctrl = new page.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
  link.dispatchEvent(ctrl);
  assert.equal(ctrl.defaultPrevented, false);
  assert.equal(page.window.Panditya.size, 'closed');
  page.click(page.document.getElementById('o'));
  assert.equal(page.window.Panditya.size, 'closed');
  const plain = new page.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  link.dispatchEvent(plain);
  assert.equal(plain.defaultPrevented, true);
  // A bare ID: the small view looks up whether it's an author or a work.
  assert.equal(page.src(), `${BASE}/widget?ids=85303`);
});

test('options: button on the left, or no button at all', t => {
  const left = hostPage(t, { attrs: { 'data-position': 'left' } });
  assert.ok(left.q('.launcher').classList.contains('left'));
  const none = hostPage(t, { attrs: { 'data-launcher': 'false' }, body: '<span id="w" data-panditya-work="89000">N</span>' });
  assert.equal(none.shadow(), undefined, 'nothing is added until it is needed');
  none.click(none.document.getElementById('w'));
  assert.equal(none.q('.launcher').hidden, true);
  assert.equal(none.window.Panditya.size, 'small');
});

test('a bare ID or a search asked for large opens small, where they can be resolved', t => {
  const page = hostPage(t);
  page.window.Panditya.open({ ids: '85303', size: 'large' });
  assert.equal(page.window.Panditya.size, 'small');
  assert.equal(page.src(), `${BASE}/widget?ids=85303`);
});

test('included twice, it still adds one button', t => {
  const page = hostPage(t);
  const script = page.document.createElement('script');
  script.textContent = LOADER;
  page.document.body.append(script);
  assert.equal(page.document.querySelectorAll('#panditya-widget').length, 1);
});
