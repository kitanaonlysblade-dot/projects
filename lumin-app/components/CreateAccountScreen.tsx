'use client';

import { useState } from 'react';
import type { UserProfile } from '@/lib/types';
import { apiUserToProfile, signup, googleAuth, setToken, ApiError } from '@/lib/api';
import { PageHeader } from './PageHeader';
import { GoogleSignInButton } from './GoogleSignInButton';

interface CreateAccountScreenProps {
  onBack: () => void;
  onCreate: (profile: UserProfile) => void;
  onGoToLogin: () => void;
  onOpenTerms: () => void;
}

// Same idea as MerchantCreate, one layer earlier — "having an account"
// used to just mean this form had been filled out once, no real backend
// behind it. That's no longer true for the manual form below: it now
// calls the real POST /auth/signup (see lib/api.ts) and stores the JWT
// it gets back, so a page refresh doesn't lose the session — see
// page.tsx's own session-restore effect that reads this same token back
// out on load.
export function CreateAccountScreen({ onBack, onCreate, onGoToLogin, onOpenTerms }: CreateAccountScreenProps) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit =
    displayName.trim().length > 0 &&
    username.trim().length > 0 &&
    isValidEmail &&
    password.length >= 8 &&
    agreedToTerms &&
    !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const cleanedUsername = username.trim().replace(/^@+/, '');
      const { access_token, user } = await signup({
        email: email.trim(),
        password,
        username: cleanedUsername,
        display_name: displayName.trim(),
        bio: bio.trim() || undefined,
      });
      setToken(access_token);
      onCreate(apiUserToProfile(user));
    } catch (err) {
      // A 400 here is almost always "email already registered" or
      // "username already taken" — both come back as ApiError.message
      // straight from the backend's HTTPException detail, so this is
      // already the right thing to show the person rather than a generic
      // "something went wrong."
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Real now — POST /auth/google verifies the ID token GIS hands back
  // and either logs into the existing account for that email or creates
  // one, same TokenWithUser shape and same session-persisting setToken
  // call as the manual form above. Reuses the same `error` state, so a
  // failed Google attempt shows the same inline message the manual form
  // would.
  const handleGoogleCredential = async (idToken: string) => {
    if (!agreedToTerms) {
      // Belt-and-suspenders alongside the pointer-events gate on the
      // button below — Google's button is rendered by Google's own
      // script (see GoogleSignInButton's comment on why it can't be a
      // normal custom onClick), so this is the one place left to
      // actually refuse the request if that gate ever gets bypassed.
      setError('Please agree to the Terms and Conditions to continue.');
      return;
    }
    setError(null);
    try {
      const { access_token, user } = await googleAuth(idToken);
      setToken(access_token);
      onCreate(apiUserToProfile(user));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title="Create Account" onBack={onBack} backLabel="Back to shop" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-md px-4 py-6 lg:px-0 lg:py-10">
          <span className="mb-4 block h-16 w-16 rounded-full bg-box" />
          <p className="mb-1 text-[15px] font-bold text-text">Set up your profile</p>
          <p className="mb-6 text-[13.5px] leading-snug text-text-mute">
            This is your personal profile — for posting to Discover and following creators. It&apos;s
            separate from a business page, which you can set up later from here too.
          </p>

          {/* Google's button is rendered by Google's own script (see
              GoogleSignInButton's own comment) so it can't take a
              normal onClick/disabled prop — pointer-events-none plus
              the dimming is what actually keeps it unusable until the
              box below is checked; handleGoogleCredential above is the
              backstop in case that's ever bypassed. */}
          <div className={agreedToTerms ? undefined : 'pointer-events-none opacity-40'}>
            <GoogleSignInButton onCredential={handleGoogleCredential} />
          </div>

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

          <label className="mb-4 block">
            <span className="mb-1.5 block text-[12.5px] font-bold text-text">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-text placeholder:text-text-mute focus:border-hot-pink focus:outline-none"
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1.5 block text-[12.5px] font-bold text-text">Name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Nadia Ade"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-text placeholder:text-text-mute focus:border-hot-pink focus:outline-none"
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1.5 block text-[12.5px] font-bold text-text">Username</span>
            <div className="flex items-center rounded-lg border border-line bg-white px-3 focus-within:border-hot-pink">
              <span className="text-[13px] text-text-mute">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/\s+/g, ''))}
                placeholder="username"
                className="w-full bg-transparent py-2 pl-1 text-[13px] text-text placeholder:text-text-mute focus:outline-none"
              />
            </div>
          </label>

          <label className="mb-6 block">
            <span className="mb-1.5 block text-[12.5px] font-bold text-text">
              Bio <span className="font-normal text-text-mute">(optional)</span>
            </span>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell people what you post about"
              rows={3}
              className="w-full resize-none rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-text placeholder:text-text-mute focus:border-hot-pink focus:outline-none"
            />
          </label>

          <label className="mb-4 flex items-start gap-2">
            <input
              type="checkbox"
              checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-hot-pink"
            />
            <span className="text-[13.5px] leading-snug text-text-mute">
              I agree to the{' '}
              <button type="button" onClick={onOpenTerms} className="font-bold text-hot-pink underline">
                Terms and Conditions
              </button>
            </span>
          </label>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="brand-gradient w-full rounded-full py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
          >
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
          {error && <p className="mt-3 text-center text-[13.5px] text-hot-pink">{error}</p>}

          <p className="mt-6 text-center text-[13.5px] text-text-mute">
            Already have an account?{' '}
            <button onClick={onGoToLogin} className="font-bold text-hot-pink">
              Log in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
