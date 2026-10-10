'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { resetPassword, ApiError } from '@/lib/api';

// A real route, not one more `view` in app/page.tsx's internal state
// machine the way every other screen in this app is — everything else
// gets reached by clicking around inside the SPA, but this one has to
// work when someone opens it fresh from an actual link in an email
// (password_reset_email on the backend), with no prior app state at
// all. useSearchParams needs a Suspense boundary around whatever calls
// it (Next's own requirement for App Router pages that read the query
// string), hence the wrapper component below doing nothing but that.
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const token = useSearchParams().get('token');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canSubmit =
    !!token && newPassword.length >= 8 && newPassword === confirmPassword && !isSubmitting;

  const handleSubmit = async () => {
    if (!token || !canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await resetPassword(token, newPassword);
      setDone(true);
    } catch (err) {
      // The backend gives one message for every failure case here
      // (missing, already-used, or expired token) — see
      // reset_password's own comment — so this just surfaces it as-is
      // rather than trying to distinguish cases it can't actually tell
      // apart.
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-panel px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6">
        <h1 className="mb-1 text-[15px] font-bold text-text">Set a new password</h1>

        {!token ? (
          <p className="mt-3 text-[13.5px] leading-snug text-text-mute">
            This link is missing its reset code — open the link from your email again, or request a
            new one from the log in screen.
          </p>
        ) : done ? (
          <>
            <p className="mt-3 mb-4 text-[13.5px] leading-snug text-text-mute">
              Your password has been reset. You can log in with it now.
            </p>
            <Link
              href="/"
              className="brand-gradient block w-full rounded-full py-2.5 text-center text-[13px] font-bold text-white"
            >
              Back to Lumin
            </Link>
          </>
        ) : (
          <>
            <p className="mb-6 text-[13.5px] leading-snug text-text-mute">
              Choose a new password for your account — at least 8 characters.
            </p>

            <label className="mb-4 block">
              <span className="mb-1.5 block text-[12.5px] font-bold text-text">New password</span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-text placeholder:text-text-mute focus:border-hot-pink focus:outline-none"
              />
            </label>

            <label className="mb-2 block">
              <span className="mb-1.5 block text-[12.5px] font-bold text-text">Confirm password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Type it again"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-text placeholder:text-text-mute focus:border-hot-pink focus:outline-none"
              />
            </label>
            {confirmPassword.length > 0 && confirmPassword !== newPassword && (
              <p className="mb-2 text-[12.5px] text-hot-pink">Passwords don&apos;t match.</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="brand-gradient mt-2 w-full rounded-full py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
            >
              {isSubmitting ? 'Saving…' : 'Reset password'}
            </button>
            {error && <p className="mt-3 text-center text-[13.5px] text-hot-pink">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
