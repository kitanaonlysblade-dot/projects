import test from 'node:test';
import assert from 'node:assert/strict';
import { scanStatusAt } from '../lib/useScanStatus';

test('scan status moves on with time and settles on the last phrase', () => {
  assert.equal(scanStatusAt(0), 'Looking…');
  assert.equal(scanStatusAt(5), 'Widening the search…');
  assert.equal(scanStatusAt(500), 'Nearly there…');
});
