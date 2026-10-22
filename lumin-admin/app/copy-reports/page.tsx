'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { listCopyReviews, resolveCopyReview, type ApiCopyReview } from '@/lib/api';

type Tab = 'open' | 'confirmed' | 'dismissed';
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// Reviews opened when someone reported a video as "copied from my video" AND it is a known copy of an earlier upload
// by a different person. Nothing is shown to buyers. While one is open the later video has no verified badge and the
// payout of orders that came from it waits; closing it (either way) releases the payout. Confirmed = remove the copy
// yourself from Content / Moderation.
export default function CopyReportsPage() {
  const [tab, setTab] = useState<Tab>('open');
  const [rows, setRows] = useState<ApiCopyReview[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setRows(null);
    setFailed(false);
    listCopyReviews(tab)
      .then(setRows)
      .catch(() => setFailed(true));
  }, [tab]);
  useEffect(load, [load]);

  const decide = async (id: string, status: 'dismissed' | 'confirmed') => {
    setBusy(id);
    try {
      await resolveCopyReview(id, status);
      setRows((r) => r?.filter((x) => x.id !== id) ?? r);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const Side = ({ title, p }: { title: string; p: ApiCopyReview['later'] }) => (
    <div className="min-w-0 flex-1 rounded-lg bg-panel p-3">
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-text-mute">{title}</p>
      <p className="mt-1 text-[14px] font-bold text-text">{p.poster_display_name}</p>
      <p className="text-[12px] text-text-mute">Posted {day(p.created_at)}</p>
      {p.description && <p className="mt-1 line-clamp-2 text-[12.5px] text-text">{p.description}</p>}
      <p className="mt-1 break-all font-mono text-[11px] text-text-mute">{p.id}</p>
    </div>
  );

  return (
    <AdminShell>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold text-text">Copy reports</h1>
        <div className="flex gap-1.5">
          {(['open', 'confirmed', 'dismissed'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 text-[13px] font-medium capitalize ${tab === t ? 'bg-text text-white' : 'bg-white text-text-mute'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-4 max-w-[640px] text-[13px] text-text-mute">
        Someone reported a video as copied, and it matches an earlier upload by a different person. The first upload is the one a scan shows. Dismiss
        if it is fine (a supplier&apos;s clip, a trend); confirm if it was copied, then remove it from Content. Payouts held for this review are released when you close it.
      </p>
      {failed && <p className="mb-3 text-[13px] text-red-600">Something went wrong. Try again.</p>}
      {!rows && !failed && <p className="text-[13px] text-text-mute">Loading…</p>}
      {rows && rows.length === 0 && <p className="text-[13px] text-text-mute">Nothing here.</p>}
      <div className="flex flex-col gap-3">
        {rows?.map((r) => (
          <div key={r.id} className="rounded-xl border border-line bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Side title="First upload" p={r.earlier} />
              <Side title="Reported as a copy" p={r.later} />
            </div>
            {r.status === 'open' ? (
              <div className="mt-3 flex gap-2">
                <button
                  disabled={busy === r.id}
                  onClick={() => decide(r.id, 'dismissed')}
                  className="rounded-full bg-panel px-4 py-1.5 text-[13px] font-semibold text-text disabled:opacity-50"
                >
                  Dismiss (fine)
                </button>
                <button
                  disabled={busy === r.id}
                  onClick={() => decide(r.id, 'confirmed')}
                  className="rounded-full bg-text px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
                >
                  Confirm copy
                </button>
              </div>
            ) : (
              <p className="mt-3 text-[12px] text-text-mute">
                {r.status === 'confirmed' ? 'Confirmed as a copy' : 'Dismissed'}
                {r.resolved_at ? ` · ${day(r.resolved_at)}` : ''}
              </p>
            )}
          </div>
        ))}
      </div>
    </AdminShell>
  );
}
