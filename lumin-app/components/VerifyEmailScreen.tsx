'use client';

import { useEffect, useState } from 'react';
import type { UserProfile } from '@/lib/types';
import { apiUserToProfile, resendVerificationCode, setToken, verifyEmail, ApiError } from '@/lib/api';
import { PageHeader } from './PageHeader';

const RESEND_SECONDS = 60;

// Step 2 of signup (and of logging in to an account whose email was never confirmed): the 6-digit code we
// emailed. The right code opens the account and logs the person in.
export function VerifyEmailScreen({
  email,
  onBack,
  onVerified,
  intro,
}: {
  email: string;
  onBack: () => void;
  onVerified: (profile: UserProfile) => void;
  intro?: string;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(RESEND_SECONDS);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const ready = code.length === 6 && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const { access_token, user } = await verifyEmail(email, code);
      setToken(access_token);
      onVerified(apiUserToProfile(user));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong — please try again.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (wait > 0) return;
    setError(null);
    setResent(false);
    try {
      await resendVerificationCode(email);
      setResent(true);
      setWait(RESEND_SECONDS);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send a new code — try again in a moment.");
    }
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title="Confirm your email" onBack={onBack} backLabel="Back" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-md px-4 py-6 lg:px-0 lg:py-10">
          <p className="mb-1 text-[15px] font-bold text-text">Enter your code</p>
          <p className="mb-6 text-[13.5px] leading-snug text-text-mute">
            {intro ?? 'We sent a 6-digit code to'} <span className="break-all font-bold text-text">{email}</span>. It works for 15
            minutes. Check your spam folder if you don&apos;t see it.
          </p>

          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            aria-label="6-digit code"
            placeholder="······"
            className="mb-4 w-full rounded-lg border border-line bg-white px-3 py-3 text-center text-[24px] font-bold tracking-[0.5em] text-text placeholder:text-text-mute focus:border-hot-pink focus:outline-none"
          />

          {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}
          {resent && !error && <p className="mb-3 text-[13px] text-text-mute">A new code is on its way.</p>}

          <button
            onClick={submit}
            disabled={!ready}
            className="brand-gradient w-full rounded-full px-4 py-3 text-[14px] font-bold text-white disabled:opacity-50"
          >
            {busy ? 'Checking…' : 'Confirm and open my account'}
          </button>

          <button
            onClick={resend}
            disabled={wait > 0}
            className="mt-4 w-full text-center text-[13px] font-bold text-hot-pink disabled:text-text-mute"
          >
            {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
          </button>
        </div>
      </div>
    </div>
  );
}
