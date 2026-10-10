'use client';

import { useState } from 'react';
import type { UserProfile } from '@/lib/types';
import { apiUserToProfile, login, googleAuth, setToken, ApiError } from '@/lib/api';
import { PageHeader } from './PageHeader';
import { GoogleSignInButton } from './GoogleSignInButton';

interface LoginScreenProps {
  onBack: () => void;
  onLogin: (profile: UserProfile) => void;
  onGoToSignup: () => void;
  onForgotPassword: () => void;
  // Set when page.tsx lands here because the previous session's token
  // stopped being valid (see setUnauthorizedHandler in lib/api.ts) —
  // shown as a neutral heads-up, separate from `error` below, which is
  // reserved for an actual failed login attempt on this screen itself.
  notice?: string;
}

// The counterpart CreateAccountScreen never had — that screen only ever
// called POST /auth/signup, so someone with an existing account (e.g. the
// backend's seeded demo login) had no way back in at all; every
// logged-out path in page.tsx routed straight to account creation.
// Mirrors CreateAccountScreen's structure closely on purpose — same
// layout, same input styling, same error-handling shape — since these are
// two doors into the same wall, not different screens conceptually.
export function LoginScreen({ onBack, onLogin, onGoToSignup, onForgotPassword, notice }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const { access_token, user } = await login(email.trim(), password);
      setToken(access_token);
      onLogin(apiUserToProfile(user));
    } catch (err) {
      // The backend returns 401 with "Incorrect email or password" for
      // both a wrong password and a nonexistent email — same message
      // either way, which is intentional on its side (not leaking which
      // one was wrong), so this just surfaces that string as-is.
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Same POST /auth/google as CreateAccountScreen's — this is the "log
  // in" half of that one endpoint doing double duty: an existing
  // account under this Google email logs straight in, same as if
  // they'd typed their password.
  const handleGoogleCredential = async (idToken: string) => {
    setError(null);
    try {
      const { access_token, user } = await googleAuth(idToken);
      setToken(access_token);
      onLogin(apiUserToProfile(user));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title="Log In" onBack={onBack} backLabel="Back to shop" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-md px-4 py-6 lg:px-0 lg:py-10">
          {notice && (
            <p className="mb-4 rounded-lg bg-panel px-3 py-2 text-center text-[13.5px] text-text-mute">{notice}</p>
          )}
          <span className="mb-4 block h-16 w-16 rounded-full bg-box" />
          <p className="mb-1 text-[15px] font-bold text-text">Welcome back</p>
          <p className="mb-6 text-[13.5px] leading-snug text-text-mute">
            Log in to post to Discover, follow creators, and pick up your watchlist and comments
            where you left off.
          </p>

          <GoogleSignInButton onCredential={handleGoogleCredential} />

          <div className="mb-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="text-[12.5px] text-text-mute">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <label className="mb-4 block">
            <span className="mb-1.5 block text-[12.5px] font-bold text-text">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-text placeholder:text-text-mute focus:border-hot-pink focus:outline-none"
            />
          </label>

          <label className="mb-2 block">
            <span className="mb-1.5 block text-[12.5px] font-bold text-text">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-text placeholder:text-text-mute focus:border-hot-pink focus:outline-none"
            />
          </label>

          <button onClick={onForgotPassword} className="mb-2 block text-[12.5px] font-bold text-hot-pink">
            Forgot password?
          </button>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="brand-gradient mt-4 w-full rounded-full py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
          >
            {isSubmitting ? 'Logging in…' : 'Log in'}
          </button>
          {error && <p className="mt-3 text-center text-[13.5px] text-hot-pink">{error}</p>}

          <p className="mt-6 text-center text-[13.5px] text-text-mute">
            New here?{' '}
            <button onClick={onGoToSignup} className="font-bold text-hot-pink">
              Create an account
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
