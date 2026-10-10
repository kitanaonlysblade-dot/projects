'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { getTwinStats, type ApiTwinStats } from '@/lib/api';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

const COLUMNS = [
  { key: 'twins_created', label: 'Twins', color: 'bg-sky-500' },
  { key: 'searches', label: 'Searches', color: 'bg-amber-500' },
  { key: 'searches_not_found', label: 'No twin found', color: 'bg-rose-500' },
  { key: 'searches_picked', label: 'Added / bought', color: 'bg-emerald-500' },
] as const;

// A few numbers a day that say whether twin search is working. Watch these before
// tightening any rule: if most searches find nothing, the catalog (or the matching) is
// the problem; if they match but nobody adds to cart, the matches are poor.
export default function TwinHealthPage() {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<ApiTwinStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setStats(null);
    setFailed(false);
    getTwinStats(days)
      .then(setStats)
      .catch(() => setFailed(true));
  }, [days]);

  const max = (key: (typeof COLUMNS)[number]['key']) => Math.max(1, ...(stats?.series.map((r) => r[key]) ?? [1]));

  return (
    <AdminShell>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold text-text">Twin health</h1>
        <div className="flex gap-1.5">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-full px-3 py-1 text-[13px] font-medium ${days === d ? 'bg-text text-white' : 'bg-white text-text-mute'}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {failed && <p className="text-[13px] text-red-600">Couldn&apos;t load the numbers.</p>}
      {!stats && !failed && <p className="text-[13px] text-text-mute">Loading…</p>}
      {stats && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {COLUMNS.map((c) => (
              <div key={c.key} className="rounded-xl border border-line bg-white p-4">
                <p className="text-[22px] font-bold text-text">{stats.totals[c.key]}</p>
                <p className="text-[12.5px] text-text-mute">{c.label} · last {stats.days}d</p>
              </div>
            ))}
          </div>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              { label: 'Searches that matched', value: pct(stats.match_rate), hint: 'found at least one twin' },
              { label: 'Searches that ended in a cart', value: pct(stats.pick_rate), hint: 'shopper added or bought a result' },
              { label: 'Twins flagged', value: pct(stats.flag_rate), hint: 'of reviewed twins — a sign of lazy twinning' },
              { label: 'Waiting for review', value: String(stats.pending_review), hint: 'twins' },
              { label: 'Waiting shoppers', value: String(stats.waiting_searches), hint: 'searched, nothing matched yet' },
            ].map((t) => (
              <div key={t.label} className="rounded-xl border border-line bg-white p-4">
                <p className="text-[22px] font-bold text-text">{t.value}</p>
                <p className="text-[12.5px] font-medium text-text">{t.label}</p>
                <p className="text-[11.5px] text-text-mute">{t.hint}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-text-mute">
                  <th className="px-4 py-2.5 font-medium">Day</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-4 py-2.5 font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...stats.series].reverse().map((row) => (
                  <tr key={row.date} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2 text-text-mute">{row.date}</td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 text-right font-medium text-text">{row[c.key]}</span>
                          <span className={`h-1.5 rounded-full ${c.color}`} style={{ width: `${(row[c.key] / max(c.key)) * 60}px` }} />
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AdminShell>
  );
}
