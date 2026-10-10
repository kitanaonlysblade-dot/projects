'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, clearToken, login, setToken } from '@/lib/api';

// The same /auth/login route the consumer app uses — there is no
// separate admin login endpoint, and no route anywhere that promotes a
// user to admin (see the backend's own UserRole comment). login() alone
// can't tell an admin from anyone else; it's this page's job, right
// after, to check `user.role` and refuse to store the token at all for
// a non-admin account, rather than letting them into a console where
// every real request would just come back 403.
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    login(email, password)
      .then(({ access_token, user }) => {
        if (user.role !== 'admin') {
          clearToken();
          throw new ApiError(403, 'This account does not have admin access.');
        }
        setToken(access_token);
        router.replace('/dashboard');
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      })
      .finally(() => setLoading(false));
  };

  return (
    <div className="flex h-screen items-center justify-center bg-panel">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl border border-line bg-white p-8">
        <p className="mb-1 text-[18px] font-bold text-text">Lumin Admin</p>
        <p className="mb-6 text-[13px] text-text-mute">Sign in with your admin account.</p>

        {error && (
          <p className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>
        )}

        <label className="mb-3 block">
          <span className="mb-1 block text-[12px] font-medium text-text-mute">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-line px-3 py-2 text-[14px] outline-none focus:border-hot-pink"
          />
        </label>

        <label className="mb-6 block">
          <span className="mb-1 block text-[12px] font-medium text-text-mute">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-line px-3 py-2 text-[14px] outline-none focus:border-hot-pink"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-hot-pink py-2.5 text-[14px] font-bold text-white disabled:opacity-60"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
