'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { getJobQueue, type ApiJobQueue } from '@/lib/api';

const CARDS = [
  { key: 'queued', label: 'Waiting' },
  { key: 'running', label: 'Running' },
  { key: 'done', label: 'Done (last 7 days)' },
  { key: 'failed', label: 'Failed' },
] as const;

// Video re-encoding and scan fingerprinting run as background jobs. Waiting jobs piling up with none running
// means no worker is running (see DEPLOY.md, "Background worker").
export default function JobsPage() {
  const [queue, setQueue] = useState<ApiJobQueue | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      getJobQueue()
        .then((q) => live && (setQueue(q), setFailed(false)))
        .catch(() => live && setFailed(true));
    load();
    const t = setInterval(load, 10000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const stuck = queue && queue.counts.queued > 0 && queue.counts.running === 0 && queue.oldest_queued_at !== null && Date.now() - new Date(queue.oldest_queued_at).getTime() > 5 * 60 * 1000;

  return (
    <AdminShell>
      <h1 className="mb-5 text-xl font-bold text-text">Background jobs</h1>
      {failed && <p className="text-[13px] text-red-600">Couldn&apos;t load the queue.</p>}
      {!queue && !failed && <p className="text-[13px] text-text-mute">Loading…</p>}
      {queue && (
        <>
          {stuck && (
            <p className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">
              Jobs have been waiting for over 5 minutes and nothing is running. The worker may be down.
            </p>
          )}
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {CARDS.map((c) => (
              <div key={c.key} className="rounded-xl border border-line bg-white p-4">
                <p className="text-[22px] font-bold text-text">{queue.counts[c.key]}</p>
                <p className="text-[12.5px] text-text-mute">{c.label}</p>
              </div>
            ))}
          </div>
          <h2 className="mb-2 text-[14px] font-bold text-text">Recent failures</h2>
          {queue.recent_failures.length === 0 && <p className="text-[13px] text-text-mute">None.</p>}
          <div className="space-y-2">
            {queue.recent_failures.map((j) => (
              <div key={j.id} className="rounded-xl border border-line bg-white p-3 text-[13px]">
                <p className="font-semibold text-text">
                  {j.kind} · {j.attempts} attempts
                </p>
                <p className="break-all text-text-mute">{j.error}</p>
                <p className="break-all text-[12px] text-text-mute">{JSON.stringify(j.payload)}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </AdminShell>
  );
}
