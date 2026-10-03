'use client';

import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Heart, Maximize2, MessageCircle, Send, Bookmark, X } from 'lucide-react';
import type { Order, VideoPost } from '@/lib/types';
import { formatCount } from '@/lib/format';

import { PostThumbnail } from './Thumbnails';
const HOT_PINK = '#FF2D6F';
const HOT_ORANGE = '#FF6B35';
const VIOLET = '#7C3AED';
const SKY = '#0EA5E9';

function ChartCard({
  title,
  subtitle,
  isEmpty,
  emptyMessage,
  children,
}: {
  title: string;
  subtitle: string;
  isEmpty: boolean;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <button
        onClick={() => !isEmpty && setExpanded(true)}
        disabled={isEmpty}
        className={`group relative w-full rounded-xl border border-line bg-white p-4 text-left ${
          isEmpty ? '' : 'cursor-pointer hover:border-hot-pink/40'
        }`}
      >
        {!isEmpty && (
          <Maximize2
            size={15}
            className="absolute right-3.5 top-4 text-text-mute opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
        <p className="text-[13.5px] font-bold text-text">{title}</p>
        <p className="mb-3 text-[12.5px] text-text-mute">{subtitle}</p>
        {isEmpty ? (
          <div className="flex h-48 items-center justify-center">
            <p className="max-w-[200px] text-center text-[12.5px] text-text-mute">{emptyMessage}</p>
          </div>
        ) : (
          <div className="h-48 sm:h-56">{children}</div>
        )}
      </button>

      {expanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-5 lg:p-6">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <p className="text-[15px] font-bold text-text">{title}</p>
                <p className="text-[13.5px] text-text-mute">{subtitle}</p>
              </div>
              <button
                onClick={() => setExpanded(false)}
                aria-label="Close"
                className="text-text-mute hover:text-text"
              >
                <X size={20} />
              </button>
            </div>
            <div className="h-[60vh]">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}

const tooltipStyle = {
  fontSize: '11px',
  borderRadius: '8px',
  border: '1px solid #e6e6e6',
};

// Small overview tile for the KPI strip above the post-performance
// charts — same idea as the summary numbers YouTube Studio shows above
// its per-video breakdown, just built from the real per-post totals
// already on hand rather than a separate metrics source.
function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-text-mute">
        {icon}
        <p className="text-[12px] font-bold uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-[18px] font-bold text-text">{formatCount(value)}</p>
    </div>
  );
}

interface MerchantAnalyticsProps {
  orders: Order[];
  posts: VideoPost[];
}

// Every chart here reads directly off `orders` and `posts` — the same
// state the Orders/Posts tabs manage — so there's nothing to fabricate.
// Deliberately not doing "revenue by day": orders only carry a relative
// "Just now" label, not a real timestamp, so a real calendar time-series
// would mean inventing dates. Order sequence (the order they were placed
// in, this session) is the one time-like axis that's actually true.
export function MerchantAnalytics({ orders, posts }: MerchantAnalyticsProps) {
  const statusData = (['pending', 'shipped', 'delivered'] as const).map((status) => ({
    status: status[0].toUpperCase() + status.slice(1),
    count: orders.filter((o) => o.status === status).length,
  }));

  // Cancelled orders are refunded (see the backend's cancel_order route)
  // — counting their price here would overstate revenue by exactly what
  // got sent back. Both charts below read from this, not `orders`
  // directly, so a cancellation can never inflate either one.
  const revenueOrders = orders.filter((o) => o.status !== 'cancelled');

  const revenueByProduct = Object.values(
    revenueOrders.reduce<Record<string, { name: string; revenue: number }>>((acc, o) => {
      acc[o.productName] = acc[o.productName] ?? { name: o.productName, revenue: 0 };
      acc[o.productName].revenue += o.price;
      return acc;
    }, {}),
  )
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);

  // Oldest first, so the running total actually accumulates left to
  // right — `orders` itself is newest-first (new orders get prepended).
  let running = 0;
  const cumulativeRevenue = [...revenueOrders].reverse().map((o, i) => {
    running += o.price;
    return { seq: i + 1, total: Number(running.toFixed(2)) };
  });

  // Every real per-post engagement signal there is — likes, comments,
  // shares, and saves are all tracked on VideoPost already, so nothing
  // here is invented. Kept in post order for the grouped bar chart, and
  // separately ranked by total for the leaderboard below it.
  const postEngagement = posts.map((p) => ({
    id: p.id,
    name: p.description.length > 14 ? `${p.description.slice(0, 14)}…` : p.description || 'Untitled',
    fullName: p.description || 'Untitled',
    thumbnailUrl: p.thumbnailUrl,
    likes: p.likes,
    comments: p.comments,
    shares: p.shares,
    saves: p.saves,
    total: p.likes + p.comments + p.shares + p.saves,
  }));

  const topPosts = [...postEngagement].sort((a, b) => b.total - a.total);

  const totalLikes = posts.reduce((sum, p) => sum + p.likes, 0);
  const totalComments = posts.reduce((sum, p) => sum + p.comments, 0);
  const totalShares = posts.reduce((sum, p) => sum + p.shares, 0);
  const totalSaves = posts.reduce((sum, p) => sum + p.saves, 0);

  // Composition of all engagement across every post, by type — the
  // "where does the engagement actually come from" view a per-post chart
  // alone can't show.
  const engagementMix = [
    { name: 'Likes', value: totalLikes, color: HOT_PINK },
    { name: 'Comments', value: totalComments, color: VIOLET },
    { name: 'Shares', value: totalShares, color: HOT_ORANGE },
    { name: 'Saves', value: totalSaves, color: SKY },
  ].filter((d) => d.value > 0);

  return (
    <div className="flex-1 px-4 py-5 lg:px-8 lg:py-8">
      <p className="mb-1 text-[13px] font-bold text-text">Analytics</p>
      <p className="mb-4 text-[12.5px] text-text-mute">
        Built from your actual orders and posts — nothing here is sample data.
      </p>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="Orders by status"
          subtitle="Where every order currently sits"
          isEmpty={orders.length === 0}
          emptyMessage="No orders yet — this fills in once someone buys something."
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={statusData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6e6e6" vertical={false} />
              <XAxis dataKey="status" tick={{ fontSize: 11, fill: '#6b6b6b' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b6b6b' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill={HOT_PINK} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Revenue by product"
          subtitle="Top sellers, by total revenue"
          isEmpty={revenueByProduct.length === 0}
          emptyMessage="No sales yet — your best sellers will show up here."
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={revenueByProduct} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6e6e6" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#6b6b6b' }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={90}
                tick={{ fontSize: 10.5, fill: '#6b6b6b' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v.toFixed(2)}`, 'Revenue']} />
              <Bar dataKey="revenue" fill={HOT_ORANGE} radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Cumulative revenue"
          subtitle="Running total across orders, in the order they came in"
          isEmpty={cumulativeRevenue.length < 2}
          emptyMessage="Needs at least two orders to show a trend."
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cumulativeRevenue}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6e6e6" vertical={false} />
              <XAxis
                dataKey="seq"
                tick={{ fontSize: 11, fill: '#6b6b6b' }}
                axisLine={false}
                tickLine={false}
                label={{ value: 'Order #', position: 'insideBottom', offset: -2, fontSize: 10, fill: '#6b6b6b' }}
              />
              <YAxis tick={{ fontSize: 11, fill: '#6b6b6b' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v.toFixed(2)}`, 'Total']} />
              <Line type="monotone" dataKey="total" stroke={VIOLET} strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Post engagement"
          subtitle="Likes, comments, shares, and saves per post"
          isEmpty={postEngagement.length === 0}
          emptyMessage="No posts yet — engagement per post will show up here."
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={postEngagement}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6e6e6" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b6b6b' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b6b6b' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="likes" fill={HOT_PINK} radius={[6, 6, 0, 0]} />
              <Bar dataKey="comments" fill={VIOLET} radius={[6, 6, 0, 0]} />
              <Bar dataKey="shares" fill={HOT_ORANGE} radius={[6, 6, 0, 0]} />
              <Bar dataKey="saves" fill={SKY} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Engagement mix"
          subtitle="Every like, comment, share, and save, combined"
          isEmpty={engagementMix.length === 0}
          emptyMessage="No engagement yet — the breakdown by type will show up here."
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={engagementMix}
                dataKey="value"
                nameKey="name"
                innerRadius="55%"
                outerRadius="80%"
                paddingAngle={2}
              >
                {engagementMix.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [formatCount(v), n]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
            {engagementMix.map((d) => (
              <span key={d.name} className="flex items-center gap-1 text-[12px] text-text-mute">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
                {d.name}
              </span>
            ))}
          </div>
        </ChartCard>
      </div>

      {postEngagement.length > 0 && (
        <div className="mt-6">
          <p className="mb-1 text-[13px] font-bold text-text">Post performance</p>
          <p className="mb-3 text-[12.5px] text-text-mute">Every post, ranked by total engagement — highest first.</p>

          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatTile icon={<Heart size={14} />} label="Likes" value={totalLikes} />
            <StatTile icon={<MessageCircle size={14} />} label="Comments" value={totalComments} />
            <StatTile icon={<Send size={14} />} label="Shares" value={totalShares} />
            <StatTile icon={<Bookmark size={14} />} label="Saves" value={totalSaves} />
          </div>

          <div className="overflow-hidden rounded-xl border border-line bg-white">
            {topPosts.map((p, i) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 p-3 ${i !== topPosts.length - 1 ? 'border-b border-line' : ''}`}
              >
                <p className="w-4 shrink-0 text-center text-[12.5px] font-bold text-text-mute">{i + 1}</p>
                <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-box">
                  <PostThumbnail post={p} className="h-full w-full object-cover" />
                </span>
                <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-text">{p.fullName}</p>
                <div className="flex shrink-0 items-center gap-3 text-[12.5px] text-text-mute">
                  <span className="flex items-center gap-1">
                    <Heart size={13} />
                    {formatCount(p.likes)}
                  </span>
                  <span className="hidden items-center gap-1 sm:flex">
                    <MessageCircle size={13} />
                    {formatCount(p.comments)}
                  </span>
                  <span className="hidden items-center gap-1 sm:flex">
                    <Send size={13} />
                    {formatCount(p.shares)}
                  </span>
                  <span className="hidden items-center gap-1 sm:flex">
                    <Bookmark size={13} />
                    {formatCount(p.saves)}
                  </span>
                  <span className="font-bold text-text">{formatCount(p.total)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
