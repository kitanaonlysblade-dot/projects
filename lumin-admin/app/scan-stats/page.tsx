'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { getScanStats, type ApiScanStats } from '@/lib/api';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

// What people scan and what it finds. Watch the found rate: a low one means real recordings are being missed
// (look at the stage column and the recent scans), a very high one on short clips is worth a spot check.
export default function ScanResultsPage() {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<ApiScanStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setStats(null);
    setFailed(false);
    getScanStats(days)
      .then(setStats)
      .catch(() => setFailed(true));
  }, [days]);

  const maxDay = Math.max(1, ...(stats?.series.map((r) => r.scans) ?? [1]));

  return (
    <AdminShell>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold text-text">Scan results</h1>
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
            {[
              { label: 'Scans', value: String(stats.totals.scans), hint: `last ${stats.days}d` },
              { label: 'Found a video', value: pct(stats.found_rate), hint: `${stats.totals.found} found · ${stats.totals.missed} not found` },
              { label: 'Average recording', value: stats.avg_clip_s === null ? '—' : `${stats.avg_clip_s}s`, hint: 'length scanned' },
              { label: 'Not found', value: String(stats.totals.missed), hint: 'most videos are not on the app: normal' },
            ].map((t) => (
              <div key={t.label} className="rounded-xl border border-line bg-white p-4">
                <p className="text-[22px] font-bold text-text">{t.value}</p>
                <p className="text-[12.5px] font-medium text-text">{t.label}</p>
                <p className="text-[11.5px] text-text-mute">{t.hint}</p>
              </div>
            ))}
          </div>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-line bg-white p-4">
              <h2 className="mb-2 text-[13px] font-bold text-text">Which check found it</h2>
              {stats.by_stage.length === 0 ? (
                <p className="text-[12.5px] text-text-mute">Nothing found in this period.</p>
              ) : (
                <ul className="space-y-1.5 text-[13px]">
                  {stats.by_stage.map((s) => (
                    <li key={s.stage} className="flex justify-between">
                      <span className="text-text">{s.stage}</span>
                      <span className="font-medium text-text">{s.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <h2 className="mb-2 text-[13px] font-bold text-text">Most scanned videos</h2>
              {stats.top_videos.length === 0 ? (
                <p className="text-[12.5px] text-text-mute">None yet.</p>
              ) : (
                <ul className="space-y-1.5 text-[13px]">
                  {stats.top_videos.map((v) => (
                    <li key={v.video_post_id} className="flex justify-between gap-3">
                      <span className="truncate text-text">{v.caption || v.video_post_id.slice(0, 8)}</span>
                      <span className="shrink-0 font-medium text-text">{v.scans}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="mb-6 overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full min-w-[480px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-text-mute">
                  <th className="px-4 py-2.5 font-medium">Day</th>
                  <th className="px-4 py-2.5 font-medium">Scans</th>
                  <th className="px-4 py-2.5 font-medium">Found</th>
                  <th className="px-4 py-2.5 font-medium">Not found</th>
                </tr>
              </thead>
              <tbody>
                {[...stats.series].reverse().map((r) => (
                  <tr key={r.date} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2 text-text-mute">{r.date}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 text-right font-medium text-text">{r.scans}</span>
                        <span className="h-1.5 rounded-full bg-sky-500" style={{ width: `${(r.scans / maxDay) * 60}px` }} />
                      </div>
                    </td>
                    <td className="px-4 py-2 text-emerald-700">{r.found}</td>
                    <td className="px-4 py-2 text-text-mute">{r.missed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mb-2 text-[13px] font-bold text-text">Latest scans</h2>
          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full min-w-[480px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-text-mute">
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">Result</th>
                  <th className="px-4 py-2.5 font-medium">Check</th>
                  <th className="px-4 py-2.5 font-medium">Recording</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent.map((r, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2 text-text-mute">{r.at ? new Date(r.at).toLocaleString() : '—'}</td>
                    <td className={`px-4 py-2 font-medium ${r.found ? 'text-emerald-700' : 'text-text-mute'}`}>{r.found ? 'Found' : 'Not found'}</td>
                    <td className="px-4 py-2 text-text">{r.stage ?? '—'}</td>
                    <td className="px-4 py-2 text-text-mute">{r.clip_s === null ? '—' : `${r.clip_s}s`}</td>
                  </tr>
                ))}
                {stats.recent.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-text-mute">
                      No scans yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AdminShell>
  );
}
