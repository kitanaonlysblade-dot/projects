import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveDuration, progressFraction } from '../lib/videoProgress';

test('a normal video: the fraction of the way through', () => {
  assert.equal(progressFraction(5, 20), 0.25);
  assert.equal(progressFraction(0, 20), 0);
  assert.equal(progressFraction(20, 20), 1);
});

test('an Infinity or NaN duration no longer pins the bar at zero when the browser can still seek', () => {
  assert.equal(effectiveDuration(Infinity, 12), 12);
  assert.equal(progressFraction(6, Infinity, 12), 0.5);
  assert.equal(progressFraction(3, NaN, 12), 0.25);
});

test('with no usable length at all the answer is 0, not a wrong guess', () => {
  assert.equal(progressFraction(4, Infinity), 0);
  assert.equal(progressFraction(4, NaN, 0), 0);
  assert.equal(progressFraction(4, 0), 0);
  assert.equal(progressFraction(NaN, 10), 0);
});

test('it never leaves 0..1 (a stale time past the end, or a negative one)', () => {
  assert.equal(progressFraction(25, 20), 1);
  assert.equal(progressFraction(-1, 20), 0);
});
