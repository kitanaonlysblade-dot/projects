'use client';

import { useEffect, useState } from 'react';
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
import { ArrowLeft, Clock, DollarSign, Eye, MousePointerClick, ShoppingBag, ShoppingCart, Heart, Maximize2, MessageCircle, Send, Bookmark, Users, X } from 'lucide-react';
import type { Order, Product, VideoPost } from '@/lib/types';
import { listMyPostFunnel } from '@/lib/api';
import { formatCount } from '@/lib/format';

import { PostThumbnail, ProductThumbnail } from './Thumbnails';
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
  children: React.ReactNode | ((expanded: boolean) => React.ReactNode);
}) {
  const [expanded, setExpanded] = useState(false);
  const render = (isExpanded: boolean) => (typeof children === 'function' ? children(isExpanded) : children);

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
          <div className="h-48 sm:h-56">{render(false)}</div>
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
            <div className="h-[60vh]">{render(true)}</div>
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
  // here is invented.
  //
  // Built to stay readable at any volume: the period filter narrows the
  // set, the sort key ranks it, the chart only ever draws the top few
  // (10 on the card, 25 expanded) and the list pages in 10 at a time —
  // so 5 posts and 5,000 posts both produce a screen a person can read.
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [range, setRange] = useState<RangeKey>('all');
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const isNarrow = useIsNarrow();

  // Shopping funnel per video (taps, cart adds, orders, revenue) — owner-only
  // data from its own endpoint. Silent on failure: the rest of the screen
  // works without it and the funnel parts just show dashes.
  const [funnel, setFunnel] = useState<Record<string, Funnel>>({});
  const [funnelLoaded, setFunnelLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    listMyPostFunnel()
      .then((rows) => {
        if (cancelled) return;
        setFunnel(
          Object.fromEntries(
            rows.map((r) => [
              r.video_post_id,
              { taps: r.product_taps, cartAdds: r.cart_adds, orders: r.orders, revenue: r.revenue },
            ]),
          ),
        );
        setFunnelLoaded(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [posts.length]);

  // Reset paging whenever the view of the list changes.
  useEffect(() => setVisibleCount(LIST_PAGE_SIZE), [sortKey, range]);

  const toEngagement = (p: VideoPost) => ({
    id: p.id,
    fullName: p.description || 'Untitled',
    thumbnailUrl: p.thumbnailUrl,
    likes: p.likes,
    comments: p.comments,
    shares: p.shares,
    saves: p.saves,
    total: p.likes + p.comments + p.shares + p.saves,
    views: p.views ?? 0,
    taps: funnel[p.id]?.taps ?? 0,
    cartAdds: funnel[p.id]?.cartAdds ?? 0,
    orders: funnel[p.id]?.orders ?? 0,
    revenue: funnel[p.id]?.revenue ?? 0,
    // Engagement per view, as a percentage — 0 until there is a view to divide by.
    rate: (p.views ?? 0) > 0 ? ((p.likes + p.comments + p.shares + p.saves) / (p.views ?? 0)) * 100 : 0,
  });

  // Posts without a timestamp (just created this session) count as new.
  const inRange = (p: VideoPost) => {
    if (range === 'all' || !p.createdAt) return true;
    const t = new Date(p.createdAt).getTime();
    if (Number.isNaN(t)) return true;
    return Date.now() - t <= Number(range) * 24 * 60 * 60 * 1000;
  };

  const rangedPosts = posts.filter(inRange);
  const postEngagement = rangedPosts.map(toEngagement);
  const topPosts = [...postEngagement].sort((a, b) => b[sortKey] - a[sortKey] || b.total - a.total);

  const chartLimit = (expanded: boolean) => (expanded ? CHART_LIMIT_EXPANDED : CHART_LIMIT);
  const chartData = (expanded: boolean) =>
    topPosts.slice(0, chartLimit(expanded)).map((p, i) => ({ ...p, rank: i + 1 }));
  const sortLabel = SORT_OPTIONS.find((o) => o.key === sortKey)?.label.toLowerCase() ?? 'engagement';
  const chartSubtitle =
    postEngagement.length > CHART_LIMIT
      ? `Top ${CHART_LIMIT} of ${postEngagement.length} posts by ${sortKey === 'total' ? 'total engagement' : sortLabel}`
      : 'Likes, comments, shares, and saves per post';

  const totalLikes = rangedPosts.reduce((sum, p) => sum + p.likes, 0);
  const totalComments = rangedPosts.reduce((sum, p) => sum + p.comments, 0);
  const totalShares = rangedPosts.reduce((sum, p) => sum + p.shares, 0);
  const totalSaves = rangedPosts.reduce((sum, p) => sum + p.saves, 0);
  // Views are lifetime totals (the app doesn't keep a view history by day),
  // so they ignore the period filter and always cover every post.
  const totalViews = posts.reduce((sum, p) => sum + (p.views ?? 0), 0);
  const totalWatchSeconds = posts.reduce((sum, p) => sum + (p.watchSeconds ?? 0), 0);
  const totalCompletions = posts.reduce((sum, p) => sum + (p.completions ?? 0), 0);
  const totalTaps = posts.reduce((sum, p) => sum + (funnel[p.id]?.taps ?? 0), 0);
  const totalCartAdds = posts.reduce((sum, p) => sum + (funnel[p.id]?.cartAdds ?? 0), 0);
  const totalOrdersFromVideos = posts.reduce((sum, p) => sum + (funnel[p.id]?.orders ?? 0), 0);
  const totalRevenueFromVideos = posts.reduce((sum, p) => sum + (funnel[p.id]?.revenue ?? 0), 0);
  const totalEngagementAll = posts.reduce((sum, p) => sum + p.likes + p.comments + p.shares + p.saves, 0);

  // Composition of all engagement across every post, by type — the
  // "where does the engagement actually come from" view a per-post chart
  // alone can't show.
  const engagementMix = [
    { name: 'Likes', value: totalLikes, color: HOT_PINK },
    { name: 'Comments', value: totalComments, color: VIOLET },
    { name: 'Shares', value: totalShares, color: HOT_ORANGE },
    { name: 'Saves', value: totalSaves, color: SKY },
  ].filter((d) => d.value > 0);

  const selectedPost = selectedPostId ? posts.find((p) => p.id === selectedPostId) : undefined;
  if (selectedPost) {
    return (
      <PostInsights
        post={selectedPost}
        posts={posts}
        funnel={funnelLoaded ? funnel[selectedPost.id] ?? { taps: 0, cartAdds: 0, orders: 0, revenue: 0 } : undefined}
        onBack={() => setSelectedPostId(null)}
      />
    );
  }

  return (
    <div className="flex-1 px-4 py-5 lg:px-8 lg:py-8">
      <p className="mb-1 text-[13px] font-bold text-text">Analytics</p>
      <p className="mb-4 text-[12.5px] text-text-mute">
        Built from your actual orders and posts — nothing here is sample data.
      </p>

      {posts.length > 1 && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-line bg-white p-3">
          <PillRow label="Posts · sort by" options={SORT_OPTIONS} value={sortKey} onChange={setSortKey} />
          <PillRow label="Posts · period" options={RANGE_OPTIONS} value={range} onChange={setRange} />
        </div>
      )}

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
          subtitle={chartSubtitle}
          isEmpty={postEngagement.length === 0}
          emptyMessage={
            posts.length === 0
              ? 'No posts yet — engagement per post will show up here.'
              : 'No posts in this period — try a longer one.'
          }
        >
          {(expanded) => {
            const data = chartData(expanded);
            // Four bars per post only stays legible for a handful of posts;
            // on a phone, or past 12 posts, one stacked bar per post (each
            // coloured by type) keeps the chart readable.
            const stacked = isNarrow || data.length > 12;
            const radius: [number, number, number, number] = stacked ? [0, 0, 0, 0] : [6, 6, 0, 0];
            return (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e6e6e6" vertical={false} />
                  <XAxis
                    dataKey="rank"
                    interval={0}
                    tickFormatter={(r) => `#${r}`}
                    tick={{ fontSize: 10, fill: '#6b6b6b' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b6b6b' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(_, payload) => {
                      const item = payload?.[0]?.payload as { rank: number; fullName: string } | undefined;
                      return item ? `#${item.rank} · ${item.fullName.length > 40 ? `${item.fullName.slice(0, 40)}…` : item.fullName}` : '';
                    }}
                  />
                  <Bar dataKey="likes" stackId={stacked ? 'e' : undefined} fill={HOT_PINK} radius={radius} />
                  <Bar dataKey="comments" stackId={stacked ? 'e' : undefined} fill={VIOLET} radius={radius} />
                  <Bar dataKey="shares" stackId={stacked ? 'e' : undefined} fill={HOT_ORANGE} radius={radius} />
                  <Bar dataKey="saves" stackId={stacked ? 'e' : undefined} fill={SKY} radius={stacked ? [6, 6, 0, 0] : radius} />
                </BarChart>
              </ResponsiveContainer>
            );
          }}
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
          <p className="mb-3 text-[12.5px] text-text-mute">
            Ranked by {sortKey === 'total' ? 'total engagement' : sortLabel} — highest first. Tap a post for its own
            analytics.
          </p>

          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatTile icon={<Heart size={14} />} label="Likes" value={totalLikes} />
            <StatTile icon={<MessageCircle size={14} />} label="Comments" value={totalComments} />
            <StatTile icon={<Send size={14} />} label="Shares" value={totalShares} />
            <StatTile icon={<Bookmark size={14} />} label="Saves" value={totalSaves} />
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <TextTile icon={<Eye size={14} />} label="Views" value={totalViews > 0 ? formatCount(totalViews) : '—'} />
            <TextTile
              icon={<Clock size={14} />}
              label="Avg watch time"
              value={totalViews > 0 ? formatDuration(totalWatchSeconds / totalViews) : '—'}
            />
            <TextTile
              icon={<Users size={14} />}
              label="Completion"
              value={totalViews > 0 ? `${Math.round((totalCompletions / totalViews) * 100)}%` : '—'}
            />
            <TextTile
              icon={<Heart size={14} />}
              label="Engagement rate"
              value={totalViews > 0 ? `${((totalEngagementAll / totalViews) * 100).toFixed(1)}%` : '—'}
            />
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <TextTile icon={<MousePointerClick size={14} />} label="Product taps" value={funnelLoaded ? formatCount(totalTaps) : '—'} />
            <TextTile icon={<ShoppingCart size={14} />} label="Cart adds" value={funnelLoaded ? formatCount(totalCartAdds) : '—'} />
            <TextTile icon={<ShoppingBag size={14} />} label="Orders from videos" value={funnelLoaded ? formatCount(totalOrdersFromVideos) : '—'} />
            <TextTile
              icon={<DollarSign size={14} />}
              label="Revenue from videos"
              value={funnelLoaded ? `$${totalRevenueFromVideos.toFixed(2)}` : '—'}
            />
          </div>
          {range !== 'all' && (
            <p className="-mt-2 mb-4 text-[12px] text-text-mute">
              Views, watch time, completion and the shopping numbers are lifetime totals — they don&apos;t follow the period
              filter.
            </p>
          )}

          <div className="overflow-hidden rounded-xl border border-line bg-white">
            {topPosts.slice(0, visibleCount).map((p, i, shown) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedPostId(p.id)}
                className={`flex w-full items-center gap-3 p-3 text-left hover:bg-panel ${
                  i !== shown.length - 1 ? 'border-b border-line' : ''
                }`}
              >
                <p className="w-5 shrink-0 text-center text-[12.5px] font-bold text-text-mute">{i + 1}</p>
                <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-box">
                  <PostThumbnail post={p} className="h-full w-full object-cover" />
                </span>
                <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-text">{p.fullName}</p>
                <div className="flex shrink-0 items-center gap-3 text-[12.5px] text-text-mute">
                  <span className="flex items-center gap-1">
                    <Eye size={13} />
                    {formatCount(p.views)}
                  </span>
                  <span className="hidden items-center gap-1 sm:flex">
                    <ShoppingBag size={13} />
                    {formatCount(p.orders)}
                  </span>
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
              </button>
            ))}
          </div>

          {topPosts.length > LIST_PAGE_SIZE && (
            <div className="mt-3 flex flex-col items-center gap-1.5">
              <p className="text-[12.5px] text-text-mute">
                Showing {Math.min(visibleCount, topPosts.length)} of {topPosts.length} posts
              </p>
              {visibleCount < topPosts.length && (
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + LIST_PAGE_SIZE)}
                  className="brand-gradient-outline rounded-full px-4 py-2 text-[13px] font-bold text-hot-pink"
                >
                  Show more
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- helpers & the single-post analytics screen ----

type SortKey = 'total' | 'views' | 'rate' | 'orders' | 'revenue' | 'likes' | 'comments' | 'shares' | 'saves';
type RangeKey = 'all' | '30' | '7';

interface Funnel {
  taps: number;
  cartAdds: number;
  orders: number;
  revenue: number;
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'total', label: 'Total' },
  { key: 'views', label: 'Views' },
  { key: 'rate', label: 'Engagement rate' },
  { key: 'orders', label: 'Orders' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'saves', label: 'Saves' },
];
const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: '30', label: 'Last 30 days' },
  { key: '7', label: 'Last 7 days' },
];
const LIST_PAGE_SIZE = 10;
const CHART_LIMIT = 10;
const CHART_LIMIT_EXPANDED = 25;

function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return narrow;
}

function PillRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <p className="mr-1 w-full text-[12px] font-bold uppercase tracking-wide text-text-mute sm:w-auto">{label}</p>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${
            value === o.key ? 'brand-gradient text-white' : 'border border-line bg-white text-text-mute'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Read-only look at a product tagged on a video, opened from the single-post
// analytics screen — everything a merchant would want to check while judging
// whether the video is selling it (price, stock, options, photos).
function ProductInspector({ product, onClose }: { product: Product; onClose: () => void }) {
  const images = product.images && product.images.length > 0 ? product.images : product.imageUrl ? [product.imageUrl] : [];
  const [active, setActive] = useState(0);
  const discounted =
    product.discountPercent && product.discountPercent > 0
      ? product.price * (1 - product.discountPercent / 100)
      : null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-label={`${product.name} details`}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <p className="text-[15px] font-bold text-text">{product.name}</p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-text-mute hover:text-text">
            <X size={20} />
          </button>
        </div>

        {images.length > 0 && (
          <div className="mb-3">
            <div className="mb-2 aspect-square w-full overflow-hidden rounded-xl bg-box">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={images[Math.min(active, images.length - 1)]} alt={product.name} className="h-full w-full object-cover" />
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto">
                {images.map((src, i) => (
                  <button
                    key={src + i}
                    type="button"
                    onClick={() => setActive(i)}
                    aria-label={`Photo ${i + 1}`}
                    className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2 ${
                      i === active ? 'border-hot-pink' : 'border-transparent'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="mb-3 text-[18px] font-bold text-text">
          {discounted !== null ? (
            <>
              ${discounted.toFixed(2)}{' '}
              <span className="text-[13px] font-medium text-text-mute line-through">${product.price.toFixed(2)}</span>{' '}
              <span className="text-[12.5px] font-bold text-hot-pink">-{product.discountPercent}%</span>
            </>
          ) : (
            `$${product.price.toFixed(2)}`
          )}
        </p>

        <p className="mb-3 text-[13.5px] text-text-mute">{product.description || 'No description yet.'}</p>

        <div className="flex flex-col gap-2 text-[13px]">
          <div className="flex justify-between">
            <span className="text-text-mute">Availability</span>
            <span className="font-bold text-text">
              {product.inStock ? (product.stockQuantity != null ? `${product.stockQuantity} in stock` : 'In stock') : 'Out of stock'}
            </span>
          </div>
          {product.cartCount > 0 && (
            <div className="flex justify-between">
              <span className="text-text-mute">Bought &amp; in carts</span>
              <span className="font-bold text-text">{formatCount(product.cartCount)}</span>
            </div>
          )}
          {product.colors.length > 0 && (
            <div className="flex justify-between gap-4">
              <span className="text-text-mute">Colors</span>
              <span className="text-right font-bold text-text">{product.colors.join(', ')}</span>
            </div>
          )}
          {product.sizes.length > 0 && (
            <div className="flex justify-between gap-4">
              <span className="text-text-mute">Sizes</span>
              <span className="text-right font-bold text-text">{product.sizes.join(', ')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

function TextTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-text-mute">
        {icon}
        <p className="text-[12px] font-bold uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-[18px] font-bold text-text">{value}</p>
    </div>
  );
}

// One post's own analytics — opened from the Post performance list. Only
// numbers the app genuinely tracks (likes, comments, shares, saves), set
// against the rest of the merchant's posts so they mean something.
function PostInsights({
  post,
  posts,
  funnel,
  onBack,
}: {
  post: VideoPost;
  posts: VideoPost[];
  funnel?: Funnel;
  onBack: () => void;
}) {
  const total = (p: VideoPost) => p.likes + p.comments + p.shares + p.saves;
  const mine = total(post);
  const views = post.views ?? 0;
  const ranked = [...posts].sort((a, b) => total(b) - total(a));
  const rank = ranked.findIndex((p) => p.id === post.id) + 1;
  const allTotal = posts.reduce((sum, p) => sum + total(p), 0);
  const average = posts.length > 0 ? allTotal / posts.length : 0;
  const sharePct = allTotal > 0 ? (mine / allTotal) * 100 : 0;
  const vsAverage = average > 0 ? ((mine - average) / average) * 100 : 0;

  const [inspected, setInspected] = useState<Product | null>(null);
  const taggedProducts = post.products ?? [];

  const parts = [
    { name: 'Likes', value: post.likes, color: HOT_PINK, icon: <Heart size={14} /> },
    { name: 'Comments', value: post.comments, color: VIOLET, icon: <MessageCircle size={14} /> },
    { name: 'Shares', value: post.shares, color: HOT_ORANGE, icon: <Send size={14} /> },
    { name: 'Saves', value: post.saves, color: SKY, icon: <Bookmark size={14} /> },
  ];

  return (
    <div className="flex-1 px-4 py-5 lg:px-8 lg:py-8">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 text-[13px] font-semibold text-text-mute hover:text-text"
      >
        <ArrowLeft size={16} />
        Back to analytics
      </button>

      <div className="mb-4 flex items-start gap-3">
        <span className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-box">
          <PostThumbnail post={post} className="h-full w-full object-cover" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-text">{post.description || 'Untitled'}</p>
          <p className="mt-0.5 text-[12.5px] text-text-mute">
            Posted {post.postedAt || 'recently'}
            {post.products && post.products.length > 0
              ? ` · ${post.products.length} product${post.products.length === 1 ? '' : 's'} tagged`
              : ''}
          </p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {parts.map((d) => (
          <StatTile key={d.name} icon={d.icon} label={d.name} value={d.value} />
        ))}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-white p-3">
          <p className="text-[12px] font-bold uppercase tracking-wide text-text-mute">Total engagement</p>
          <p className="text-[18px] font-bold text-text">{formatCount(mine)}</p>
        </div>
        <div className="rounded-xl border border-line bg-white p-3">
          <p className="text-[12px] font-bold uppercase tracking-wide text-text-mute">Rank</p>
          <p className="text-[18px] font-bold text-text">
            #{rank} <span className="text-[13px] font-medium text-text-mute">of {posts.length}</span>
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white p-3">
          <p className="text-[12px] font-bold uppercase tracking-wide text-text-mute">Vs your average post</p>
          <p className="text-[18px] font-bold text-text">
            {average === 0 ? '—' : `${vsAverage >= 0 ? '+' : ''}${Math.round(vsAverage)}%`}
          </p>
          <p className="text-[12px] text-text-mute">{sharePct.toFixed(1)}% of all your engagement</p>
        </div>
      </div>

      <p className="mb-2 text-[13.5px] font-bold text-text">Viewing</p>
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <TextTile icon={<Eye size={14} />} label="Views" value={views > 0 ? formatCount(views) : '—'} />
        <TextTile icon={<Users size={14} />} label="Unique viewers" value={views > 0 ? formatCount(post.uniqueViewers ?? 0) : '—'} />
        <TextTile
          icon={<Clock size={14} />}
          label="Avg watch time"
          value={views > 0 ? formatDuration((post.watchSeconds ?? 0) / views) : '—'}
        />
        <TextTile
          icon={<Heart size={14} />}
          label="Completion"
          value={views > 0 ? `${Math.round(((post.completions ?? 0) / views) * 100)}%` : '—'}
        />
      </div>
      {views > 0 && (
        <p className="-mt-2 mb-4 text-[12.5px] text-text-mute">
          {((mine / views) * 100).toFixed(1)}% of viewers liked, commented, shared or saved this post. A view counts after
          about 3 seconds of watching, once per person per day.
        </p>
      )}
      {views === 0 && (
        <p className="-mt-2 mb-4 text-[12.5px] text-text-mute">
          No views recorded yet — they appear as people watch this post.
        </p>
      )}

      {taggedProducts.length > 0 && (
        <div className="mb-4 rounded-xl border border-line bg-white p-4">
          <p className="mb-1 text-[13.5px] font-bold text-text">
            Products in this video <span className="font-medium text-text-mute">({taggedProducts.length})</span>
          </p>
          <p className="mb-3 text-[12.5px] text-text-mute">Tap a product to inspect it.</p>
          <div className="flex flex-col">
            {taggedProducts.map((product, i) => (
              <button
                key={product.id}
                type="button"
                onClick={() => setInspected(product)}
                className={`flex items-center gap-3 py-2.5 text-left hover:bg-panel ${
                  i !== taggedProducts.length - 1 ? 'border-b border-line' : ''
                }`}
              >
                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-box">
                  <ProductThumbnail product={product} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-text">{product.name}</span>
                  <span className="block text-[12.5px] text-text-mute">
                    {product.inStock ? (product.stockQuantity != null ? `${product.stockQuantity} in stock` : 'In stock') : 'Out of stock'}
                    {product.cartCount > 0 ? ` · ${formatCount(product.cartCount)} bought & in carts` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-[13.5px] font-bold text-text">
                  ${(product.discountPercent ? product.price * (1 - product.discountPercent / 100) : product.price).toFixed(2)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {inspected && <ProductInspector product={inspected} onClose={() => setInspected(null)} />}

      {funnel && (post.products?.length ?? 0) > 0 && (
        <div className="mb-4 rounded-xl border border-line bg-white p-4">
          <p className="mb-3 text-[13.5px] font-bold text-text">Does it sell?</p>
          {(() => {
            const steps = [
              { label: 'Views', value: views },
              { label: 'Opened a product', value: funnel.taps },
              { label: 'Added to cart', value: funnel.cartAdds },
              { label: 'Ordered', value: funnel.orders },
            ];
            const top = Math.max(steps[0].value, 1);
            return (
              <div className="flex flex-col gap-2">
                {steps.map((step, i) => {
                  const prev = i > 0 ? steps[i - 1].value : 0;
                  return (
                    <div key={step.label}>
                      <div className="mb-1 flex items-baseline justify-between text-[13px]">
                        <span className="text-text-mute">{step.label}</span>
                        <span className="font-bold text-text">
                          {formatCount(step.value)}
                          {i > 0 && prev > 0 && (
                            <span className="ml-2 text-[12px] font-medium text-text-mute">
                              {Math.round((step.value / prev) * 100)}% of previous step
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-box">
                        <div
                          className="brand-gradient h-full"
                          style={{ width: `${Math.min(100, (step.value / top) * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          <p className="mt-3 text-[13px] text-text-mute">
            Revenue from this video: <span className="font-bold text-text">${funnel.revenue.toFixed(2)}</span>
            {views > 0 && funnel.orders > 0 ? ` · ${((funnel.orders / views) * 100).toFixed(2)}% of viewers ordered` : ''}
          </p>
          <p className="mt-1 text-[12px] text-text-mute">
            Orders and revenue count purchases made while watching this video (cancelled orders excluded). Only the
            steps since this tracking was added are counted.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-line bg-white p-4">
        <p className="mb-3 text-[13.5px] font-bold text-text">What the engagement is made of</p>
        {mine === 0 ? (
          <p className="text-[12.5px] text-text-mute">No engagement on this post yet.</p>
        ) : (
          <>
            <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-box">
              {parts
                .filter((d) => d.value > 0)
                .map((d) => (
                  <div key={d.name} style={{ width: `${(d.value / mine) * 100}%`, backgroundColor: d.color }} />
                ))}
            </div>
            <div className="flex flex-col gap-1.5">
              {parts.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-[13px]">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="flex-1 text-text-mute">{d.name}</span>
                  <span className="font-bold text-text">{formatCount(d.value)}</span>
                  <span className="w-12 text-right text-text-mute">{Math.round((d.value / mine) * 100)}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
