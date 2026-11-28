// Tests for static/js/etext-links.js. The expected labels are what the old
// right-click menu showed for the same links.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { basename, displayLabel, isSafeUrl, groupEtextLinks } from '../../static/js/etext-links.js';

test('basename: last path or query segment, no extension', () => {
  assert.equal(basename('https://gretil.sub.uni-goettingen.de/gretil/1_sanskr/sa_kAlidAsa-kumArasaMbhava.htm'), 'sa_kAlidAsa-kumArasaMbhava');
  assert.equal(basename('https://x.org/a?id=foo.txt'), 'foo');
  assert.equal(basename(null), '');
});

const cases = [
  ['GRETIL', 'https://gretil.example/1_sanskr/sa_nyAyasAra.htm', 'sa_nyAyasAra'],
  ['DCS', 'http://www.sanskrit-linguistics.org/dcs/index.php?contents=texte&IDTextDisplay=165', '165'],
  ['DCS', 'https://github.com/OliverHellwig/sanskrit/tree/master/dcs/data/conllu/files/Kumārasaṃbhava', 'Kumārasaṃbhava'],
  ['Vātāyana and Pramāṇa NLP', 'https://vatayana.info/docExplore?text_abbrv=HB%E1%B9%AC', 'HBṬ'],
  ['Muktabodha KSTS', 'https://muktabodha.org/digital_library/book_view.php?miri_catalog_number=M00349&x=1', 'M00349'],
  ['DiPAL DCV', 'https://dipal.example/view.php?wor_id=6&tra_id=77', '77'],
  ['DiPAL DCV', 'https://dipal.example/view.php?wor_id=6', '6'],
  ['UTA Dharmaśāstra', 'https://sites.utexas.edu/dharma/resources/manusm%E1%B9%9Bti/', 'manusmṛti'],
  ['Some New Collection', 'https://new.example/texts/abc.xml', 'abc'],
];

for (const [collection, link, expected] of cases) {
  test(`displayLabel ${collection}: ${expected}`, () => {
    assert.equal(displayLabel(collection, link), expected);
  });
}

test('UTA Google Docs are numbered when there are several', () => {
  const doc = 'https://docs.google.com/document/d/abc/edit';
  assert.equal(displayLabel('UTA Dharmaśāstra', doc, 0, 1), 'Google Doc');
  assert.equal(displayLabel('UTA Dharmaśāstra', doc, 1, 3), 'Google Doc 2');
});

test('a bad percent-escape does not throw', () => {
  assert.equal(displayLabel('Vātāyana and Pramāṇa NLP', 'https://v.example/?text_abbrv=%E1%'), '%E1%');
});

test('isSafeUrl allows only http(s)', () => {
  assert.ok(isSafeUrl('https://a.org/x'));
  assert.ok(isSafeUrl('http://a.org/x'));
  assert.ok(!isSafeUrl('javascript:alert(1)'));
  assert.ok(!isSafeUrl('data:text/html,hi'));
  assert.ok(!isSafeUrl('not a url'));
});

test('groupEtextLinks handles plain lists, categories and junk', () => {
  const groups = groupEtextLinks({
    GRETIL: ['https://g.example/a.htm', 'javascript:alert(1)'],
    DCS: { GitHub: ['https://github.com/x/files/T1'], web: 'http://dcs.example/index.php?IDTextDisplay=9' },
    SARIT: ['javascript:void(0)'],
    Broken: 42,
  });
  assert.deepEqual(groups, [
    { collection: 'GRETIL', groups: [{ category: null, links: [{ href: 'https://g.example/a.htm', label: 'a' }] }] },
    {
      collection: 'DCS',
      groups: [
        { category: 'GitHub', links: [{ href: 'https://github.com/x/files/T1', label: 'T1' }] },
        { category: 'web', links: [{ href: 'http://dcs.example/index.php?IDTextDisplay=9', label: '9' }] },
      ],
    },
  ]);
});

test('groupEtextLinks with nothing', () => {
  assert.deepEqual(groupEtextLinks(false), []);
  assert.deepEqual(groupEtextLinks(undefined), []);
  assert.deepEqual(groupEtextLinks({}), []);
});
