'use client';

import { useEffect, useState } from 'react';
import { ApiError, listBlockedUsers, unblockUser, type ApiPersonResult } from '@/lib/api';
import { PageHeader } from './PageHeader';

// Settings > Account > Blocked accounts. Blocking hides both people's videos, comments, products and profiles
// from each other; unblocking here brings everything back.
export function BlockedAccountsScreen({ onBack }: { onBack: () => void }) {
  const [people, setPeople] = useState<ApiPersonResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listBlockedUsers()
      .then((p) => live && setPeople(p))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : "Couldn't load your blocked accounts."));
    return () => {
      live = false;
    };
  }, []);

  const unblock = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await unblockUser(id);
      setPeople((cur) => (cur ? cur.filter((p) => p.id !== id) : cur));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't unblock this account — try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title="Blocked accounts" onBack={onBack} backLabel="Back to settings" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-xl px-4 py-5">
          <p className="mb-4 text-[12.5px] leading-snug text-text-mute">
            You and a blocked account can&apos;t see each other&apos;s videos, comments, products or profile, and
            you no longer follow each other. They aren&apos;t told. Unblock to bring everything back.
          </p>
          {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}
          {people === null && !error && <p className="text-[13.5px] text-text-mute">Loading…</p>}
          {people && people.length === 0 && <p className="py-8 text-center text-[13.5px] text-text-mute">You haven&apos;t blocked anyone.</p>}
          <ul className="flex flex-col gap-2">
            {people?.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-xl border border-line bg-white p-3">
                <img src={p.avatar_url || '/images/placeholder.svg'} alt="" className="h-10 w-10 shrink-0 rounded-full bg-box object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold text-text">{p.display_name}</span>
                  <span className="block truncate text-[12.5px] text-text-mute">@{p.username}</span>
                </span>
                <button
                  onClick={() => unblock(p.id)}
                  disabled={busyId === p.id}
                  className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-bold text-text disabled:opacity-50"
                >
                  {busyId === p.id ? '…' : 'Unblock'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
