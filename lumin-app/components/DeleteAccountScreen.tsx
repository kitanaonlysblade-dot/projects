'use client';

import { useEffect, useState } from 'react';
import { ApiError, deleteMyAccount, getDeletionCheck, type ApiDeletionCheck } from '@/lib/api';
import { PageHeader } from './PageHeader';

// Settings > Account > Delete account. Permanent, so it asks twice in the ways that matter:
// it first says what goes and what stays (and refuses up front, with reasons, if an order or
// payment is still in flight), then needs the word DELETE and, for accounts that have one, the
// password. The app stores require an in-app way to do this.
export function DeleteAccountScreen({ onBack, onDeleted }: { onBack: () => void; onDeleted: () => void }) {
  const [check, setCheck] = useState<ApiDeletionCheck | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    getDeletionCheck()
      .then((c) => live && setCheck(c))
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, []);

  const ready = confirm.trim().toUpperCase() === 'DELETE' && (!check?.has_password || password.length > 0) && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await deleteMyAccount({ confirm: confirm.trim(), ...(check?.has_password ? { password } : {}) });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete your account — check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title="Delete account" onBack={done ? onDeleted : onBack} backLabel={done ? 'Close' : 'Back to settings'} />
      <div className="flex-1 overflow-y-auto">
        {done ? (
          <div className="mx-auto w-full max-w-2xl px-4 py-10 text-center">
            <p className="text-[16px] font-bold text-text">Your account has been deleted</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-text-mute">Thanks for being here. You can create a new account any time.</p>
            <button onClick={onDeleted} className="brand-gradient mt-6 rounded-full px-8 py-2.5 text-[13.5px] font-bold text-white">
              Close
            </button>
          </div>
        ) : (
        <div className="mx-auto w-full max-w-2xl px-4 py-6 lg:px-0 lg:py-10">
          {loadError && <p className="text-[13.5px] text-text-mute">Couldn&apos;t check your account right now. Try again in a moment.</p>}
          {!loadError && !check && <p className="text-[13.5px] text-text-mute">Checking your account…</p>}

          {check && !check.can_delete && (
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-[14px] font-bold text-text">You can&apos;t delete your account yet</p>
              <ul className="mt-2 space-y-1.5">
                {check.reasons.map((r) => (
                  <li key={r} className="text-[13.5px] leading-relaxed text-text-mute">
                    {r}
                  </li>
                ))}
              </ul>
              <button onClick={onBack} className="brand-gradient mt-4 w-full rounded-full py-2.5 text-[13.5px] font-bold text-white">
                OK
              </button>
            </div>
          )}

          {check && check.can_delete && (
            <>
              <div className="rounded-xl border border-line bg-white p-4">
                <p className="text-[14px] font-bold text-text">This is permanent</p>
                <p className="mt-2 text-[13px] font-bold text-text">What is deleted</p>
                <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-text-mute">
                  {'• Your profile and login\n• Your videos and comments\n• Your followers, likes, watchlist and cart\n• Your saved address and notifications\n• If you sell: your store and its products'}
                </p>
                <p className="mt-3 text-[13px] font-bold text-text">What stays</p>
                <p className="text-[13.5px] leading-relaxed text-text-mute">
                  Order and payment records, which other people and our accounting rely on. They are no longer linked to you, and the
                  delivery address on them is removed.
                </p>
              </div>

              <label className="mt-5 block text-[13px] font-bold text-text">
                Type DELETE to confirm
                <input
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoCapitalize="characters"
                  autoComplete="off"
                  className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-[14px] font-normal text-text focus:border-hot-pink focus:outline-none"
                />
              </label>
              {check.has_password && (
                <label className="mt-4 block text-[13px] font-bold text-text">
                  Your password
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-[14px] font-normal text-text focus:border-hot-pink focus:outline-none"
                  />
                </label>
              )}
              {error && <p className="mt-3 text-[13px] font-semibold text-hot-pink">{error}</p>}
              <button
                onClick={submit}
                disabled={!ready}
                className="mt-5 w-full rounded-full bg-hot-pink py-3 text-[14px] font-bold text-white disabled:opacity-40"
              >
                {busy ? 'Deleting…' : 'Permanently delete my account'}
              </button>
              <button onClick={onBack} className="mt-3 w-full py-2 text-[13.5px] font-semibold text-text-mute">
                Keep my account
              </button>
            </>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
