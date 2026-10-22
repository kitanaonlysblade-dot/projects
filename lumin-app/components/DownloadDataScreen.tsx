'use client';

import { useEffect, useState } from 'react';
import { ApiError, getDeletionCheck, getMyData } from '@/lib/api';
import { PageHeader } from './PageHeader';

// Settings > Account > Download my data. One JSON file with what we hold about the account; asks for the password
// (when there is one) because the file contains addresses and order history.
export function DownloadDataScreen({ onBack }: { onBack: () => void }) {
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    getDeletionCheck()
      .then((c) => live && setHasPassword(c.has_password))
      .catch(() => live && setHasPassword(true)); // unknown: ask for it, the server decides
    return () => {
      live = false;
    };
  }, []);

  const ready = hasPassword !== null && (!hasPassword || password.length > 0) && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const data = await getMyData(hasPassword ? { password } : {});
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'lumin-my-data.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setPassword('');
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not prepare your data — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title="Download my data" onBack={onBack} backLabel="Back to settings" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6 lg:px-0 lg:py-10">
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="text-[14px] font-bold text-text">A copy of your information</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-text-mute">
              You get one file with your profile, videos, comments, likes, saved items, cart, orders and payments, notifications and
              (if you sell) your store, products and sales. It leaves out your password, other people&apos;s personal details, and
              the photos and videos themselves, which are listed as links.
            </p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-text-mute">
              The file contains your address and order history. Keep it somewhere safe.
            </p>
          </div>

          {done ? (
            <p className="mt-5 rounded-xl border border-line bg-surface p-4 text-[13.5px] font-semibold text-text">
              Your file has been downloaded (lumin-my-data.json).
            </p>
          ) : (
            <>
              {hasPassword && (
                <label className="mt-5 block text-[13px] font-bold text-text">
                  Your password
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[14px] font-normal text-text focus:border-hot-pink focus:outline-none"
                  />
                </label>
              )}
              {error && <p className="mt-3 text-[13px] font-semibold text-pink-ink">{error}</p>}
              <button
                onClick={submit}
                disabled={!ready}
                className="brand-gradient mt-5 w-full rounded-full py-3 text-[14px] font-bold text-white disabled:opacity-40"
              >
                {busy ? 'Preparing…' : 'Download my data'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
