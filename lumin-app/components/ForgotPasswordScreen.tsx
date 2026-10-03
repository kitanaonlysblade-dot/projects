'use client';

import { useState } from 'react';
import { forgotPassword, ApiError } from '@/lib/api';
import { PageHeader } from './PageHeader';

interface ForgotPasswordScreenProps {
  onBack: () => void;
}

// Reached from LoginScreen's "Forgot password?" link. Always ends in
// the same "check your email" message, whether or not the address
// belongs to an account — matches the backend's own POST
// /auth/forgot-password, which always returns 204 for the same reason
// (see that route's own comment: responding differently would let this
// screen be used to check which emails are registered). There's
// nothing to branch on here even if we wanted to — the response never
// says which case happened.
export function ForgotPasswordScreen({ onBack }: ForgotPasswordScreenProps) {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const canSubmit = email.trim().length > 0 && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      // Rate-limited (5/minute) on the backend — the one error worth
      // surfacing distinctly is "slow down", since every other case
      // (no such account, email failed to send) is deliberately
      // invisible from here.
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title="Reset Password" onBack={onBack} backLabel="Back to login" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-md px-4 py-6 lg:px-0 lg:py-10">
          {sent ? (
            <>
              <p className="mb-1 text-[15px] font-bold text-text">Check your email</p>
              <p className="text-[13.5px] leading-snug text-text-mute">
                If an account exists for {email.trim()}, we&apos;ve sent a link to reset the password. It
                expires in 30 minutes.
              </p>
            </>
          ) : (
            <>
              <p className="mb-1 text-[15px] font-bold text-text">Forgot your password?</p>
              <p className="mb-6 text-[13.5px] leading-snug text-text-mute">
                Enter the email on your account and we&apos;ll send you a link to set a new password.
              </p>

              <label className="mb-4 block">
                <span className="mb-1.5 block text-[12.5px] font-bold text-text">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-text placeholder:text-text-mute focus:border-hot-pink focus:outline-none"
                />
              </label>

              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="brand-gradient mt-2 w-full rounded-full py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
              >
                {isSubmitting ? 'Sending…' : 'Send reset link'}
              </button>
              {error && <p className="mt-3 text-center text-[13.5px] text-hot-pink">{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
