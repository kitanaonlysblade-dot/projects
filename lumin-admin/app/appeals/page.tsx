'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatusBadge } from '@/components/StatusBadge';
import { listAppeals, resolveAppeal, type ApiAppeal, type AppealStatus } from '@/lib/api';

const TABS: { key: AppealStatus | 'all'; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'denied', label: 'Denied' },
  { key: 'all', label: 'All' },
];

export default function AppealsPage() {
  const [tab, setTab] = useState<AppealStatus | 'all'>('pending');
  const [appeals, setAppeals] = useState<ApiAppeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<{ appeal: ApiAppeal; action: 'approved' | 'denied' } | null>(
    null,
  );

  const load = () => {
    setLoading(true);
    listAppeals(tab === 'all' ? undefined : tab)
      .then(setAppeals)
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab]);

  const handleResolve = (note: string) => {
    if (!resolving) return;
    resolveAppeal(resolving.appeal.id, { status: resolving.action, admin_response: note || undefined }).then(
      () => {
        setResolving(null);
        load();
      },
    );
  };

  return (
    <AdminShell>
      <p className="mb-1 text-[20px] font-bold text-text">Appeals</p>
      <p className="mb-5 text-[13px] text-text-mute">
        Requests from banned accounts to be reinstated. Approving lifts the ban immediately.
      </p>

      <div className="mb-5 flex gap-2">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-full border px-3.5 py-1.5 text-[12px] font-bold ${
              tab === key ? 'border-hot-pink bg-hot-pink text-white' : 'border-line bg-white text-text-mute'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <p className="text-[13px] text-text-mute">Loading…</p>}
      {!loading && appeals.length === 0 && <p className="text-[13px] text-text-mute">Nothing here.</p>}

      <div className="space-y-3">
        {appeals.map((appeal) => (
          <div key={appeal.id} className="rounded-xl border border-line bg-white p-4">
            <div className="mb-2 flex items-start justify-between gap-4">
              <p className="text-[11px] text-text-mute">
                User id: {appeal.user_id} · Filed {new Date(appeal.created_at).toLocaleString()}
              </p>
              <StatusBadge status={appeal.status} />
            </div>
            <p className="mb-3 text-[13px] text-text">{appeal.message}</p>
            {appeal.admin_response && (
              <p className="mb-3 text-[12px] text-text-mute">Response: {appeal.admin_response}</p>
            )}
            {appeal.status === 'pending' && (
              <div className="flex gap-2">
                <button
                  onClick={() => setResolving({ appeal, action: 'denied' })}
                  className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/5"
                >
                  Deny
                </button>
                <button
                  onClick={() => setResolving({ appeal, action: 'approved' })}
                  className="rounded-lg bg-hot-pink px-3 py-1.5 text-[12px] font-bold text-white"
                >
                  Approve &amp; reinstate
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {resolving && (
        <ConfirmDialog
          title={resolving.action === 'approved' ? 'Reinstate this account?' : 'Deny this appeal?'}
          body={
            resolving.action === 'approved'
              ? 'This clears the suspension immediately — they can use their account normally again.'
              : 'The account stays suspended.'
          }
          noteLabel="Response (shown to the user)"
          confirmLabel={resolving.action === 'approved' ? 'Reinstate' : 'Deny'}
          danger={resolving.action === 'denied'}
          onConfirm={handleResolve}
          onClose={() => setResolving(null)}
        />
      )}
    </AdminShell>
  );
}
