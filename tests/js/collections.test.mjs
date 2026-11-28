// Tests for static/js/collections.js (run: npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { foldText, collectionResults, withCollections } from '../../static/js/collections.js';

const COLLECTIONS = [
  { name: 'GRETIL', works: 312 },
  { name: 'Vātāyana and Pramāṇa NLP', works: 40 },
  { name: 'DiPAL DCV', works: 1 },
];

test('foldText drops case and diacritics', () => {
  assert.equal(foldText('Pramāṇa'), 'pramana');
  assert.equal(foldText('Vātāyana'), 'vatayana');
});

test('a collection matches when the query starts one of its words', () => {
  const names = q => collectionResults(q, COLLECTIONS).map(r => r.name);
  assert.deepEqual(names('gre'), ['GRETIL']);
  assert.deepEqual(names('PRAMĀ'), ['Vātāyana and Pramāṇa NLP']);
  assert.deepEqual(names('prama'), ['Vātāyana and Pramāṇa NLP'], 'without diacritics');
  assert.deepEqual(names('dcv'), ['DiPAL DCV']);
  assert.deepEqual(names('etil'), [], 'not from the middle of a word');
  assert.deepEqual(names('  '), []);
});

test('results are collection centers with a short description', () => {
  assert.deepEqual(collectionResults('gre', COLLECTIONS), [
    { id: 'collection:GRETIL', type: 'collection', name: 'GRETIL', detail: 'SETI collection · 312 works' },
  ]);
  assert.equal(collectionResults('dipal', COLLECTIONS)[0].detail, 'SETI collection · 1 work');
});

test('withCollections puts matching collections before the entity results', async () => {
  const search = withCollections(async q => [{ id: '1', type: 'work', name: `${q}-work` }], COLLECTIONS);
  assert.deepEqual((await search('gre')).map(r => r.id), ['collection:GRETIL', '1']);
  const failing = withCollections(async () => { throw new Error('offline'); }, COLLECTIONS);
  await assert.rejects(failing('gre'), /offline/);
});
