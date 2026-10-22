import test from 'node:test';
import assert from 'node:assert/strict';
import { twinProducts } from '../lib/twins';
import type { Twin } from '../lib/types';

const twin = (id: string, productId: string, reviewStatus?: 'pending' | 'approved' | 'flagged'): Twin =>
  ({ id, productId, label: id, startMs: 0, endMs: 1000, reviewStatus }) as Twin;
const P = (id: string) => ({ id });

test('a video with no twins shows its tagged products', () => {
  const r = twinProducts([P('a'), P('b')], undefined);
  assert.deepEqual(r.shown.map((p) => p.id), ['a', 'b']);
  assert.equal(r.hidden, 0);
});

test('products with only a reported twin, or no twin, are left out', () => {
  const r = twinProducts([P('a'), P('b'), P('c')], [twin('1', 'a', 'approved'), twin('2', 'b', 'flagged')]);
  assert.deepEqual(r.shown.map((p) => p.id), ['a']);
  assert.equal(r.hidden, 2);
});

test('a product with one good twin and one reported twin stays', () => {
  const r = twinProducts([P('a')], [twin('1', 'a', 'flagged'), twin('2', 'a', 'pending')]);
  assert.deepEqual(r.shown.map((p) => p.id), ['a']);
});

test('when every twin is reported nothing is shown', () => {
  const r = twinProducts([P('a')], [twin('1', 'a', 'flagged')]);
  assert.equal(r.shown.length, 0);
  assert.equal(r.hidden, 1);
});
