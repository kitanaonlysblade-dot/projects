import test from 'node:test';
import assert from 'node:assert/strict';
import { appleMode, joinName, randomNonce, wasCancelled } from '../lib/appleSignIn';

test('joinName', () => {
  assert.equal(joinName('Jo', 'Ade'), 'Jo Ade');
  assert.equal(joinName('Jo', null), 'Jo');
  assert.equal(joinName(' ', undefined), undefined);
});
test('nonce is random hex', () => {
  const a = randomNonce();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, randomNonce());
});
test('cancel detection', () => {
  assert.equal(wasCancelled({ error: 'popup_closed_by_user' }), true);
  assert.equal(wasCancelled({ code: 1001 }), true);
  assert.equal(wasCancelled(new Error('network down')), false);
});
test('button hidden with nothing configured', () => {
  (globalThis as any).window = {};
  assert.equal(appleMode(), null);
  delete (globalThis as any).window;
});
