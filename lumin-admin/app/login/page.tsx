'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiError,
  clearToken,
  enableMfa,
  getMfaStatus,
  login,
  setToken,
  startMfaSetup,
  verifyMfa,
} from '@/lib/api';

// Step 1: the same /auth/login the consumer app uses (no separate admin endpoint; nothing promotes a user to admin).
// The token it returns is stored but cannot call admin routes yet. Step 2: the 6-digit code from an authenticator
// app - or, the first time, scan/enter a secret and confirm with the first code. Both end in a new token that
// carries the two-step claim. Non-admin accounts are refused at step 1 and the token is never kept.
type Step = 'password' | 'code' | 'setup';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState<{ secret: string; uri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

  const handlePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    login(email, password)
      .then(async ({ access_token, user }) => {
        if (user.role !== 'admin') {
          clearToken();
          throw new ApiError(403, 'This account does not have admin access.');
        }
        setToken(access_token);
        setPassword('');
        const mfa = await getMfaStatus();
        if (mfa.session_ok) {
          router.replace('/dashboard');
        } else if (mfa.enabled) {
          setStep('code');
        } else {
          setSecret(await startMfaSetup());
          setStep('setup');
        }
      })
      .catch((err: unknown) => {
        clearToken();
        fail(err);
      })
      .finally(() => setLoading(false));
  };

  const handleCode = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    (step === 'setup' ? enableMfa : verifyMfa)(code.replace(/\D/g, ''))
      .then(({ access_token }) => {
        setToken(access_token);
        router.replace('/dashboard');
      })
      .catch(fail)
      .finally(() => setLoading(false));
  };

  const back = () => {
    clearToken();
    setStep('password');
    setCode('');
    setSecret(null);
    setError(null);
  };

  const input = 'w-full rounded-lg border border-line px-3 py-2 text-[14px] outline-none focus:border-hot-pink';
  const button = 'w-full rounded-lg bg-hot-pink py-2.5 text-[14px] font-bold text-white disabled:opacity-60';

  return (
    <div className="flex h-screen items-center justify-center bg-panel">
      <div className="w-full max-w-sm rounded-xl border border-line bg-white p-8">
        <p className="mb-1 text-[18px] font-bold text-text">Lumin Admin</p>
        <p className="mb-6 text-[13px] text-text-mute">
          {step === 'password' && 'Sign in with your admin account.'}
          {step === 'code' && 'Enter the 6-digit code from your authenticator app.'}
          {step === 'setup' && 'Set up two-step login. This is required for admin accounts.'}
        </p>

        {error && <p className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>}

        {step === 'password' && (
          <form onSubmit={handlePassword}>
            <label className="mb-3 block">
              <span className="mb-1 block text-[12px] font-medium text-text-mute">Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
            </label>
            <label className="mb-6 block">
              <span className="mb-1 block text-[12px] font-medium text-text-mute">Password</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={input}
              />
            </label>
            <button type="submit" disabled={loading} className={button}>
              {loading ? 'Signing in…' : 'Continue'}
            </button>
          </form>
        )}

        {step !== 'password' && (
          <form onSubmit={handleCode}>
            {step === 'setup' && secret && (
              <div className="mb-4 space-y-2 text-[12px] text-text-mute">
                <p>
                  1. In an authenticator app (Google Authenticator, 1Password, Authy…) add an account and choose
                  “enter a setup key”.
                </p>
                <p className="break-all rounded-lg bg-panel px-3 py-2 font-mono text-[13px] text-text select-all">
                  {secret.secret}
                </p>
                <p>
                  On a phone you can also{' '}
                  <a href={secret.uri} className="font-medium text-hot-pink underline">
                    open it directly in your authenticator
                  </a>
                  .
                </p>
                <p>2. Type the 6-digit code it shows to finish.</p>
              </div>
            )}
            <label className="mb-6 block">
              <span className="mb-1 block text-[12px] font-medium text-text-mute">6-digit code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className={`${input} text-center font-mono text-[18px] tracking-[0.3em]`}
              />
            </label>
            <button type="submit" disabled={loading || code.length < 6} className={button}>
              {loading ? 'Checking…' : step === 'setup' ? 'Turn on and sign in' : 'Sign in'}
            </button>
            <button type="button" onClick={back} className="mt-3 w-full text-[12px] text-text-mute hover:text-text">
              Use a different account
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
