'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatusBadge } from '@/components/StatusBadge';
import { listReports, resolveReport, type ApiReport, type ReportStatus } from '@/lib/api';

const TABS: { key: ReportStatus | 'all'; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'actioned', label: 'Actioned' },
  { key: 'all', label: 'All' },
];

export default function ReportsPage() {
  const [tab, setTab] = useState<ReportStatus | 'all'>('pending');
  const [reports, setReports] = useState<ApiReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<{ report: ApiReport; action: 'reviewed' | 'actioned' } | null>(
    null,
  );

  const load = () => {
    setLoading(true);
    listReports({ status: tab === 'all' ? undefined : tab, limit: 100 })
      .then(setReports)
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab]);

  const handleResolve = (note: string) => {
    if (!resolving) return;
    resolveReport(resolving.report.id, { status: resolving.action, resolution_note: note || undefined }).then(
      () => {
        setResolving(null);
        load();
      },
    );
  };

  return (
    <AdminShell>
      <p className="mb-1 text-[20px] font-bold text-text">Reports</p>
      <p className="mb-5 text-[13px] text-text-mute">
        User-filed reports against video posts, products, or accounts.
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
      {!loading && reports.length === 0 && <p className="text-[13px] text-text-mute">Nothing here.</p>}

      <div className="space-y-3">
        {reports.map((report) => (
          <div key={report.id} className="rounded-xl border border-line bg-white p-4">
            <div className="mb-2 flex items-start justify-between gap-4">
              <div>
                <p className="text-[13px] font-bold capitalize text-text">
                  {report.target_type.replace('_', ' ')} · {report.reason}
                </p>
                <p className="text-[11px] text-text-mute">
                  Target id: {report.target_id} · Filed {new Date(report.created_at).toLocaleString()}
                </p>
              </div>
              <StatusBadge status={report.status} />
            </div>
            {report.detail && <p className="mb-3 text-[13px] text-text">{report.detail}</p>}
            {report.resolution_note && (
              <p className="mb-3 text-[12px] text-text-mute">Note: {report.resolution_note}</p>
            )}
            {report.status === 'pending' && (
              <div className="flex gap-2">
                <button
                  onClick={() => setResolving({ report, action: 'reviewed' })}
                  className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-text hover:bg-panel"
                >
                  Mark reviewed
                </button>
                <button
                  onClick={() => setResolving({ report, action: 'actioned' })}
                  className="rounded-lg bg-hot-pink px-3 py-1.5 text-[12px] font-bold text-white"
                >
                  Mark actioned
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {resolving && (
        <ConfirmDialog
          title={resolving.action === 'actioned' ? 'Mark this report actioned?' : 'Mark this report reviewed?'}
          body={
            resolving.action === 'actioned'
              ? "If this means removing a listing or banning an account, do that separately from Content/Users first — this just records the report's own outcome."
              : undefined
          }
          noteLabel="Note (optional)"
          confirmLabel="Confirm"
          onConfirm={handleResolve}
          onClose={() => setResolving(null)}
        />
      )}
    </AdminShell>
  );
}
