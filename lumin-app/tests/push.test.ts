import test from 'node:test';
import assert from 'node:assert/strict';
import { urlBase64ToBytes } from '../lib/push';

test('VAPID public key decodes from url-safe base64', () => {
  // 65-byte uncompressed P-256 point, starts with 0x04
  const bytes = Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i));
  const b64 = Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const out = urlBase64ToBytes(b64);
  assert.equal(out.length, 65);
  assert.deepEqual(Array.from(out), bytes);
});

test('url-safe characters are handled', () => {
  assert.deepEqual(Array.from(urlBase64ToBytes('-_8')), [251, 255]);
});
