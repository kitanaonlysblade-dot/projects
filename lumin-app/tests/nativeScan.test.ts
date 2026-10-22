import test from 'node:test';
import assert from 'node:assert/strict';
import { scanAction, nativeScanPlugin } from '../lib/nativeScan';

test('working state', () => assert.deepEqual(scanAction({ working: true }), { kind: 'working' }));
test('found opens the result page', () => assert.deepEqual(scanAction({ found: true, video_post_id: 'abc123' }), { kind: 'open', path: '/v/abc123' }));
test('open_path from a notification tap', () => assert.deepEqual(scanAction({ found: true, open_path: '/v/xyz' }), { kind: 'open', path: '/v/xyz' }));
test('rejects off-site open_path', () => {
  assert.equal(scanAction({ found: true, open_path: '//evil.com' }).kind, 'none');
  assert.equal(scanAction({ found: true, open_path: 'https://evil.com' }).kind, 'none');
});
test('rejects odd post ids', () => assert.equal(scanAction({ found: true, video_post_id: '../x?y' }).kind, 'none'));
test('not found carries the message', () => {
  assert.deepEqual(scanAction({ found: false, message: 'No match' }), { kind: 'notfound', message: 'No match' });
  assert.equal((scanAction({ found: false }) as { message: string }).message.length > 0, true);
});
test('empty and junk are ignored', () => {
  assert.equal(scanAction(null).kind, 'none');
  assert.equal(scanAction({}).kind, 'none');
});
test('no plugin outside the app', () => assert.equal(nativeScanPlugin(), null));
