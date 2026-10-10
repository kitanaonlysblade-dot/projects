import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STILL_MAX_MS,
  clockLabel,
  compactCount,
  splitColumns,
  splitTwins,
  stillSrc,
  tileKind,
  tileRatio,
  twinnedLabel,
} from '../lib/wanted';

const clip = (start: number | null, end: number | null, url: string | null = 'https://v/x.mp4') => ({
  video_url: url,
  start_ms: start,
  end_ms: end,
});

test('a short moment is a still, a longer one loops, a typed request has no picture', () => {
  assert.equal(tileKind(clip(1000, 1000 + STILL_MAX_MS)), 'still');
  assert.equal(tileKind(clip(1000, 1001 + STILL_MAX_MS)), 'loop');
  assert.equal(tileKind(clip(null, null)), 'text');
  assert.equal(tileKind(clip(1000, 3000, null)), 'text');
});

test('counts read short', () => {
  assert.deepEqual([0, 999, 1000, 2100, 12000, 1500000].map(compactCount), ['0', '999', '1k', '2.1k', '12k', '1.5M']);
  assert.equal(twinnedLabel(0), 'No twins yet');
  assert.equal(twinnedLabel(6), '6 twinned');
});

test('tile height follows the video but stays tidy, and is steady without one', () => {
  assert.equal(tileRatio(1080, 1920, 'a'), 1.6); // very tall -> clamped
  assert.equal(tileRatio(1920, 1080, 'a'), 0.9); // wide -> clamped
  assert.equal(tileRatio(1000, 1250, 'a'), 1.25);
  assert.equal(tileRatio(null, null, 'abc'), tileRatio(null, null, 'abc'));
  assert.ok([1.25, 1.0, 1.45, 1.15].includes(tileRatio(null, null, 'xyz')));
});

test('a still shows the video frame at the start of the moment', () => {
  assert.equal(stillSrc('https://v/x.mp4', 3200), 'https://v/x.mp4#t=3.20');
  assert.equal(stillSrc('https://v/x.mp4#t=9', 0), 'https://v/x.mp4#t=0.00');
});

const t = (id: string, kind: 'official' | 'confirmed' | 'offered', match: 'strong' | 'good' | 'partial' | 'weak', price: string, kept = 0) => ({
  id,
  kind,
  match,
  kept,
  product: { price },
});

test('official twins stay on top; the rest follow the chosen order', () => {
  const items = [
    t('mini', 'offered', 'good', '48.00'),
    t('crimson', 'confirmed', 'strong', '64.00', 14),
    t('rouge', 'official', 'strong', '420.00'),
    t('hobo', 'offered', 'partial', '52.00'),
    t('cross', 'offered', 'weak', '31.00'),
  ];
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
  const best = splitTwins(items, 'best');
  assert.deepEqual(ids(best.official), ['rouge']);
  assert.deepEqual(ids(best.others), ['crimson', 'mini', 'hobo', 'cross']);
  assert.deepEqual(ids(splitTwins(items, 'price').others), ['cross', 'mini', 'hobo', 'crimson']);
  assert.deepEqual(ids(splitTwins(items, 'confirmed').others)[0], 'crimson');
  assert.equal(splitTwins([items[0]], 'best').official.length, 0);
});

test('a clip length reads as a clock', () => {
  assert.deepEqual([0, 8000, 12400, 65000].map(clockLabel), ['0:00', '0:08', '0:12', '1:05']);
});

test('the wall balances tall and short tiles across two columns', () => {
  const h = { a: 1.6, b: 1.0, c: 1.0, d: 1.0, e: 1.45 };
  const cols = splitColumns(['a', 'b', 'c', 'd', 'e'], (k) => h[k as keyof typeof h]);
  // a=1.6 | b, c=2.0 | d joins the shorter first column (2.6) | e joins the other (3.45).
  assert.deepEqual(cols, [['a', 'd'], ['b', 'c', 'e']]);
  assert.deepEqual(splitColumns([], () => 1), [[], []]);
  assert.equal(splitColumns(['x', 'y', 'z'], () => 1, 3).length, 3);
});

import { boxAround, boxFromDrag, boxIou, coverBox } from '../lib/wanted';

test('boxFromDrag orders the corners, keeps the box inside the frame and not tiny', () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  const d = boxFromDrag(0.6, 0.7, 0.2, 0.1);
  near(d.x, 0.2); near(d.y, 0.1); near(d.w, 0.4); near(d.h, 0.6);
  const tiny = boxFromDrag(0.5, 0.5, 0.5, 0.5);
  assert.ok(tiny.w >= 0.06 && tiny.h >= 0.06);
  const edge = boxFromDrag(0.99, 0.99, 1, 1);
  assert.ok(edge.x + edge.w <= 1.0000001 && edge.y + edge.h <= 1.0000001);
});

test('boxAround stays inside the frame near the edges', () => {
  const b = boxAround(0.02, 0.98);
  assert.ok(b.x >= 0 && b.y + b.h <= 1.0000001);
});

test('coverBox maps a circle through a cropped, object-cover view', () => {
  const full = { x: 0.1, y: 0.2, w: 0.5, h: 0.4 };
  const same = coverBox(full, 1.5, 1.5)!;
  for (const k of ['x', 'y', 'w', 'h'] as const) assert.ok(Math.abs(same[k] - full[k]) < 1e-9); // same shape: no crop
  // A wide container over a tall video crops top and bottom.
  const wide = coverBox({ x: 0, y: 0.4, w: 1, h: 0.2 }, 2, 1)!;
  assert.ok(Math.abs(wide.y - 0.3) < 1e-9 && Math.abs(wide.h - 0.4) < 1e-9);
  // A circle in the cropped-away strip is not drawn.
  assert.equal(coverBox({ x: 0, y: 0, w: 1, h: 0.1 }, 2, 1), null);
});

test('boxIou is 1 for the same circle and 0 for apart ones', () => {
  const a = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
  assert.ok(Math.abs(boxIou(a, a) - 1) < 1e-9);
  assert.equal(boxIou(a, { x: 0.6, y: 0.6, w: 0.2, h: 0.2 }), 0);
});

import { addWord, othersLine } from '../lib/wanted';

test('addWord fills an empty query and never repeats a word', () => {
  assert.equal(addWord('', 'jacket'), 'jacket');
  assert.equal(addWord('green', 'jacket'), 'green jacket');
  assert.equal(addWord('Green Jacket', 'jacket'), 'Green Jacket');
});

test('othersLine prefers the circled count and says nothing when alone', () => {
  assert.equal(othersLine(0, 0), null);
  assert.equal(othersLine(3, 0), '3 others asked about this moment');
  assert.equal(othersLine(3, 1), '1 other circled this too');
});

import { frameTimes, tileFrameMs } from '../lib/wanted';

test('frameTimes gives a few frames across a short moment, one for a tiny one', () => {
  assert.deepEqual(frameTimes(1000, 1800), [1000]);
  const t = frameTimes(0, 6000);
  assert.equal(t.length, 3);
  assert.ok(t[0] > 0 && t[2] < 6000 && t[0] < t[1] && t[1] < t[2]);
});

test('the circled frame is always one of the frames', () => {
  const t = frameTimes(0, 6000, 4100);
  assert.equal(t.length, 3);
  assert.ok(t.includes(4100));
  assert.equal(tileFrameMs({ start_ms: 0, end_ms: 6000, box_at_ms: 4100 }), 4100);
  assert.equal(tileFrameMs({ start_ms: 0, end_ms: 6000 }), frameTimes(0, 6000)[1]);
});
