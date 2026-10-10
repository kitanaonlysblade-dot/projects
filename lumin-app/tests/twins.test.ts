import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoClipAround, twinPins, pillTwinAt, rangeFromDrag, resizeEdge, suggestLabel, twinsAt, untwinned, MIN_TWIN_MS, DEFAULT_TWIN_MS } from '../lib/twins';
import type { Twin } from '../lib/types';

const tw = (id: string, productId: string, startMs: number, endMs: number, reviewStatus?: Twin['reviewStatus']): Twin => ({
  id, productId, label: id, startMs, endMs, reviewStatus,
});

test('a tap makes a default-length twin starting at the tap', () => {
  assert.deepEqual(rangeFromDrag(5000, 5000, 20000), { startMs: 5000, endMs: 5000 + DEFAULT_TWIN_MS });
});

test('dragging backwards gives the same range as forwards', () => {
  assert.deepEqual(rangeFromDrag(8000, 3000, 20000), rangeFromDrag(3000, 8000, 20000));
});

test('a too-short drag is stretched to the minimum', () => {
  const r = rangeFromDrag(3000, 3400, 20000);
  assert.equal(r.endMs - r.startMs, MIN_TWIN_MS);
});

test('a twin near the end is pulled back inside the video', () => {
  const r = rangeFromDrag(19500, 19500, 20000);
  assert.equal(r.endMs, 20000);
  assert.equal(r.endMs - r.startMs, DEFAULT_TWIN_MS);
});

test('drags are clamped to the video and snapped to 0.1s', () => {
  const r = rangeFromDrag(-500, 30000, 20000);
  assert.deepEqual(r, { startMs: 0, endMs: 20000 });
  assert.equal(rangeFromDrag(1234, 4321, 20000).startMs % 100, 0);
});

test('resizing keeps the minimum length and stays inside the video', () => {
  const t = tw('a', 'p', 4000, 8000);
  assert.equal(resizeEdge(t, 'start', 9000, 20000).startMs, 8000 - MIN_TWIN_MS);
  assert.equal(resizeEdge(t, 'end', 4100, 20000).endMs, 4000 + MIN_TWIN_MS);
  assert.equal(resizeEdge(t, 'end', 99000, 20000).endMs, 20000);
  assert.equal(resizeEdge(t, 'start', -5, 20000).startMs, 0);
});

test('twinsAt is start-inclusive, end-exclusive, and skips flagged twins', () => {
  const list = [tw('a', 'p1', 1000, 3000), tw('b', 'p2', 2000, 4000, 'flagged')];
  assert.deepEqual(twinsAt(list, 1000).map((t) => t.id), ['a']);
  assert.deepEqual(twinsAt(list, 3000), []);
  assert.deepEqual(twinsAt(list, 2500).map((t) => t.id), ['a']);
});

test('no twin on screen means the generic pill', () => {
  assert.equal(pillTwinAt([tw('a', 'p', 1000, 3000)], 5000), null);
  assert.equal(pillTwinAt(undefined, 5000), null);
  assert.equal(pillTwinAt([], 0), null);
});

test('overlapping twins take turns on the pill', () => {
  const list = [tw('a', 'p1', 0, 10000), tw('b', 'p2', 0, 10000)];
  const seen = new Set([0, 2600, 5100, 7700].map((ms) => pillTwinAt(list, ms)?.id));
  assert.deepEqual([...seen].sort(), ['a', 'b']);
});

test('untwinned lists products without an unflagged twin', () => {
  const products = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
  const list = [tw('a', 'p1', 0, 2000), tw('b', 'p2', 0, 2000, 'flagged')];
  assert.deepEqual(untwinned(products, list), ['p2', 'p3']);
});

test('label suggestions are short', () => {
  assert.equal(suggestLabel('Leather Tote Bag'), 'bag');
  assert.equal(suggestLabel('Red Sneakers'), 'red sneakers');
  assert.equal(suggestLabel('Hat'), 'hat');
  assert.equal(suggestLabel('   '), '');
});

import { edgeLimits, fitToFree, freeGaps } from '../lib/twins';

const locked = [{ startMs: 0, endMs: 4000 }, { startMs: 8000, endMs: 10000 }];

test('a drag inside a taken moment is refused', () => {
  assert.equal(fitToFree(2000, 3000, locked, 20000), null);
  assert.equal(fitToFree(9000, 9500, locked, 20000), null);
});

test('a drag that runs into a taken moment is cut at its edge', () => {
  assert.deepEqual(fitToFree(5000, 9500, locked, 20000), { startMs: 5000, endMs: 8000 });
  assert.deepEqual(fitToFree(7000, 1000, locked, 20000), { startMs: 4000, endMs: 7000 });
});

test('touching a taken moment exactly is allowed', () => {
  assert.deepEqual(fitToFree(4000, 6000, locked, 20000), { startMs: 4000, endMs: 6000 });
  assert.deepEqual(fitToFree(8000, 6000, locked, 20000), { startMs: 6000, endMs: 8000 });
});

test('a tap makes a default twin that fits in the gap', () => {
  assert.deepEqual(fitToFree(5000, 5000, locked, 20000), { startMs: 5000, endMs: 7000 });
  assert.deepEqual(fitToFree(7500, 7500, locked, 20000), { startMs: 6000, endMs: 8000 });
});

test('a gap shorter than the minimum is unusable', () => {
  assert.equal(fitToFree(4200, 4300, [{ startMs: 0, endMs: 4000 }, { startMs: 4500, endMs: 6000 }], 20000), null);
});

test('with nothing taken it behaves like a plain drag', () => {
  assert.deepEqual(fitToFree(3000, 8000, [], 20000), { startMs: 3000, endMs: 8000 });
});

test('edge limits stop at the neighbours', () => {
  assert.deepEqual(edgeLimits({ startMs: 5000, endMs: 7000 }, locked, 20000), { minStart: 4000, maxEnd: 8000 });
  assert.deepEqual(edgeLimits({ startMs: 11000, endMs: 12000 }, locked, 20000), { minStart: 10000, maxEnd: 20000 });
});

test('free gaps are what is left between taken moments', () => {
  assert.deepEqual(freeGaps(locked, 20000), [{ startMs: 4000, endMs: 8000 }, { startMs: 10000, endMs: 20000 }]);
  assert.deepEqual(freeGaps([], 5000), [{ startMs: 0, endMs: 5000 }]);
});

test('one-tap clip: the few seconds up to just after the tap', () => {
  assert.deepEqual(autoClipAround(10000, 60000), { startMs: 7000, endMs: 11000 });
});

test('one-tap clip: near the start it still gets a usable length', () => {
  const c = autoClipAround(300, 60000);
  assert.deepEqual(c, { startMs: 0, endMs: 1300 });
  assert.ok(c.endMs - c.startMs >= 1000);
});

test('one-tap clip: at the very end it stays inside the video', () => {
  const c = autoClipAround(59800, 60000);
  assert.deepEqual(c, { startMs: 56000, endMs: 60000 });
});

test('timeline pins: placed along the video, checked when approved, flagged ones left out', () => {
  const pins = twinPins(
    [tw('a', 'p1', 10000, 20000, 'approved'), tw('b', 'p2', 30000, 45000), tw('c', 'p3', 50000, 55000, 'flagged')],
    100000,
  );
  assert.deepEqual(pins, [
    { id: 'a', leftPct: 10, widthPct: 10, approved: true },
    { id: 'b', leftPct: 30, widthPct: 15, approved: false },
  ]);
});

test('timeline pins: nothing until the video length is known, and never outside the video', () => {
  assert.deepEqual(twinPins([tw('a', 'p1', 0, 5000)], 0), []);
  assert.deepEqual(twinPins(undefined, 60000), []);
  const [pin] = twinPins([tw('a', 'p1', 58000, 90000)], 60000);
  assert.equal(pin.leftPct + pin.widthPct, 100);
});
