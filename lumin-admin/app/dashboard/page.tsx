'use client';

import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AdminShell } from '@/components/AdminShell';
import {
  getAnalyticsSummary,
  getTopProducts,
  getTrafficAnalytics,
  getTrendingPosts,
  type AnalyticsPeriod,
  type ApiTopProduct,
  type ApiTrafficPoint,
  type ApiTrendingPost,
} from '@/lib/api';

const PERIODS: { key: AnalyticsPeriod; label: string }[] = [
  { key: 'day', label: 'Daily' },
  { key: 'month', label: 'Monthly' },
  { key: 'year', label: 'Yearly' },
];

// Chart-ready shape — revenue comes back from the API as a string (see
// ApiAnalyticsPoint's own comment on Decimal serialization), but
// recharts needs a real number to plot a line, not a numeric-looking
// string; period_start is reformatted into a display label at the same
// time this conversion happens.
interface SummaryChartPoint {
  period_start: string;
  order_count: number;
  revenue: number;
}

const tooltipStyle = { fontSize: '11px', borderRadius: '8px', border: '1px solid #e5e5e8' };

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="mb-3 text-[13px] font-bold text-text">{title}</p>
      <div className="h-64">{children}</div>
    </div>
  );
}

// Platform-wide version of the same real order/engagement/traffic data
// MerchantAnalytics.tsx already charts per-merchant on the consumer
// app — every number here is a plain aggregation over data that already
// exists, except traffic, which is genuinely new instrumentation (see
// TrafficSource's own comment on the backend).
export default function DashboardPage() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('day');
  const [summary, setSummary] = useState<SummaryChartPoint[]>([]);
  const [traffic, setTraffic] = useState<ApiTrafficPoint[]>([]);
  const [topProducts, setTopProducts] = useState<ApiTopProduct[]>([]);
  const [trendingPosts, setTrendingPosts] = useState<ApiTrendingPost[]>([]);

  useEffect(() => {
    getAnalyticsSummary(period).then((points) =>
      setSummary(
        points.map((p) => ({
          period_start: new Date(p.period_start).toLocaleDateString(),
          order_count: p.order_count,
          revenue: Number(p.revenue),
        })),
      ),
    );
    getTrafficAnalytics(period).then(setTraffic);
  }, [period]);

  useEffect(() => {
    getTopProducts(8).then(setTopProducts);
    getTrendingPosts(8).then(setTrendingPosts);
  }, []);

  // Traffic comes back as (period, source, count) rows — collapsed
  // here into one total per period for the chart below. The per-source
  // breakdown within each period isn't shown yet (would need its own
  // multi-series chart, and the set of sources isn't known ahead of
  // time) — worth adding once there's enough real traffic data for it
  // to be interesting.
  const totalsByPeriod = new Map<string, number>();
  for (const point of traffic) {
    const label = new Date(point.period_start).toLocaleDateString();
    totalsByPeriod.set(label, (totalsByPeriod.get(label) ?? 0) + point.session_count);
  }

  return (
    <AdminShell>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-[20px] font-bold text-text">Dashboard</p>
          <p className="text-[13px] text-text-mute">Platform-wide activity across every merchant and buyer.</p>
        </div>
        <div className="flex gap-2">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`rounded-full border px-3.5 py-1.5 text-[12px] font-bold ${
                period === key ? 'border-hot-pink bg-hot-pink text-white' : 'border-line bg-white text-text-mute'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Orders">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={summary}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e8" vertical={false} />
              <XAxis dataKey="period_start" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="order_count" name="Orders" stroke="#FF2D6F" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Revenue">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={summary}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e8" vertical={false} />
              <XAxis dataKey="period_start" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${v}`} />
              <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#FF6B35" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="mb-3 text-[13px] font-bold text-text">Top products</p>
          <div className="space-y-2">
            {topProducts.map((p, i) => (
              <div key={p.product_id} className="flex items-center justify-between text-[12px]">
                <span className="truncate text-text">
                  <span className="mr-2 text-text-mute">{i + 1}.</span>
                  {p.name}
                </span>
                <span className="shrink-0 text-text-mute">{p.units_sold} sold · ${p.revenue}</span>
              </div>
            ))}
            {topProducts.length === 0 && <p className="text-[12px] text-text-mute">No sales yet.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-white p-4">
          <p className="mb-3 text-[13px] font-bold text-text">Trending videos</p>
          <div className="space-y-2">
            {trendingPosts.map((p, i) => (
              <div key={p.video_post_id} className="flex items-center justify-between text-[12px]">
                <span className="truncate text-text">
                  <span className="mr-2 text-text-mute">{i + 1}.</span>
                  {p.description || 'Untitled'} — {p.poster_display_name}
                </span>
                <span className="shrink-0 text-text-mute">{p.engagement_total} engagements</span>
              </div>
            ))}
            {trendingPosts.length === 0 && <p className="text-[12px] text-text-mute">No posts yet.</p>}
          </div>
        </div>
      </div>

      <ChartCard title="Sessions by source">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={Array.from(totalsByPeriod, ([period_start, total]) => ({ period_start, total }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e8" vertical={false} />
            <XAxis dataKey="period_start" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="total" name="Sessions" fill="#7C3AED" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      {traffic.length === 0 && (
        <p className="mt-2 text-[12px] text-text-mute">
          No traffic data yet — the consumer app needs to call POST /traffic on load for this to
          populate.
        </p>
      )}
    </AdminShell>
  );
}
