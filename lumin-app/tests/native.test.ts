import test from 'node:test';
import assert from 'node:assert/strict';
import { isNativeApp, nativePlatform, nativePush, safeAppPath } from '../lib/native';

test('outside the app nothing native exists and nothing throws', () => {
  assert.equal(isNativeApp(), false);
  assert.equal(nativePlatform(), null);
  assert.equal(nativePush(), null);
});

test('a tapped notification can only open a path inside the app', () => {
  assert.equal(safeAppPath('/?post=abc'), '/?post=abc');
  assert.equal(safeAppPath('/?open=notifications'), '/?open=notifications');
  assert.equal(safeAppPath('https://evil.example/x'), null);
  assert.equal(safeAppPath('//evil.example/x'), null);
  assert.equal(safeAppPath('javascript:alert(1)'), null);
  assert.equal(safeAppPath(undefined), null);
  assert.equal(safeAppPath(42), null);
});
