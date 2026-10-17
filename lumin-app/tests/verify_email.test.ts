import test from 'node:test';
import assert from 'node:assert/strict';
import { isPendingVerification, EMAIL_NOT_VERIFIED } from '../lib/api';

test('signup answers are told apart', () => {
  assert.equal(isPendingVerification({ verification_required: true, email: 'a@b.co' }), true);
  assert.equal(isPendingVerification({ access_token: 't', token_type: 'bearer', user: {} } as never), false);
});

test('the login error code matches the backend', () => {
  assert.equal(EMAIL_NOT_VERIFIED, 'email_not_verified');
});
