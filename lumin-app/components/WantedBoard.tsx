'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronUp, Layers, Play, Plus } from 'lucide-react';
import {
  getToken,
  listWanted,
  removeWantedUpvote,
  upvoteWanted,
  type ApiWantedItem,
  type ApiWantedTab,
} from '@/lib/api';
import { clockLabel, compactCount, frameTimes, splitColumns, tileFrameMs, tileKind, tileRatio, twinnedLabel } from '@/lib/wanted';
import { BoxRing } from './CircleIt';
import { LoopVideo, StillFrame } from './MomentMedia';
import { Avatar, PhotoStack, TwinIcon } from './TwinBits';

const PAGE = 20;

const TABS: { id: ApiWantedTab; label: string }[] = [
  { id: 'trending', label: 'Trending' },
  { id: 'new', label: 'New' },
  { id: 'most_twinned', label: 'Most twins' },
  { id: 'mine', label: 'Mine' },
];

// Brand-coloured backgrounds for requests typed in words, with no video behind them.
const TEXT_TILES = [
  ['#FF2D6F', '#FF6B35'],
  ['#7C3AED', '#FF2D6F'],
  ['#0B0B0F', '#7C3AED'],
  ['#FF6B35', '#F59E0B'],
];
const textTile = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const [a, b] = TEXT_TILES[h % TEXT_TILES.length];
  return `linear-gradient(150deg, ${a}, ${b})`;
};

// The Wanted wall: moments shoppers are asking about, as an Instagram-style wall of tiles.
// A short moment is a still frame, a longer one loops. Each tile carries how many people
// want it (the up-arrow) and how many products sellers have twinned to it (the twin icon);
// tapping the twin count goes straight to the compare list. Counts are different people,
// never names.
export function WantedBoard({
  onBack,
  onOpen,
  onRequest,
  onNeedLogin,
}: {
  onBack: () => void;
  onOpen: (id: string, screen?: 'compare') => void;
  // Start a new request: opens twin search without a video.
  onRequest: () => void;
  onNeedLogin: () => void;
}) {
  const [tab, setTab] = useState<ApiWantedTab>('trending');
  const [items, setItems] = useState<ApiWantedItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const signedIn = typeof window !== 'undefined' && Boolean(getToken());

  const load = useCallback(
    (quiet = false) => {
      setError(false);
      if (!quiet) setItems(null);
      listWanted(tab)
        .then((r) => {
          setItems(r.items);
          setHasMore(r.items.length >= PAGE);
        })
        .catch(() => setError(true));
    },
    [tab],
  );

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = () => {
    if (!items || loadingMore) return;
    setLoadingMore(true);
    listWanted(tab, items.length)
      .then((r) => {
        setItems((prev) => {
          const seen = new Set((prev ?? []).map((i) => i.id));
          return [...(prev ?? []), ...r.items.filter((i) => !seen.has(i.id))];
        });
        setHasMore(r.items.length >= PAGE);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  const toggleWant = async (it: ApiWantedItem) => {
    if (!getToken()) {
      onNeedLogin();
      return;
    }
    // Show it straight away; put it back if the server says no.
    setItems((prev) =>
      prev ? prev.map((x) => (x.id === it.id ? { ...x, upvoted: !x.upvoted, count: x.count + (x.upvoted ? -1 : 1) } : x)) : prev,
    );
    try {
      if (it.upvoted) await removeWantedUpvote(it.id);
      else await upvoteWanted(it.id);
      if (tab === 'mine') load(true);
    } catch {
      load(true);
    }
  };

  const columns = useMemo(
    () => splitColumns<ApiWantedItem>(items ?? [], (i: ApiWantedItem) => tileRatio(i.width, i.height, i.id)),
    [items],
  );

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-4">
        <button onClick={onBack} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full border border-line">
          <ArrowLeft size={18} className="text-text" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[22px] font-extrabold tracking-tight text-text">Wanted twins</h1>
        <button
          onClick={onRequest}
          className="brand-gradient flex items-center gap-1 rounded-full px-3.5 py-2 text-[13px] font-bold text-white"
        >
          <Plus size={14} strokeWidth={3} />
          Request
        </button>
      </div>

      <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-3 pt-1" role="tablist" aria-label="Wanted tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${
              tab === t.id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {error && <p className="py-14 text-center text-[13px] text-text-mute">Couldn&apos;t load the wall right now.</p>}
        {!error && items === null && <p className="py-14 text-center text-[13px] text-text-mute">Loading…</p>}
        {items?.length === 0 && (
          <p className="mx-auto max-w-[280px] py-14 text-center text-[13px] leading-relaxed text-text-mute">
            {tab === 'mine'
              ? signedIn
                ? 'You haven’t asked for anything yet. Scan a video for something you can’t find and it will show up here.'
                : 'Log in to see the twins you’re waiting for.'
              : 'Nothing wanted yet. Scan a video for something you can’t find — when others want it too, it shows up here.'}
          </p>
        )}
        {items && items.length > 0 && (
          <div className="flex items-start gap-2">
            {columns.map((col, c) => (
              <div key={c} className="flex min-w-0 flex-1 flex-col gap-2">
                {col.map((it, idx) => (
                  <Tile
                    key={it.id}
                    it={it}
                    // The first tile in each column has room to spell the twin count out.
                    roomy={idx === 0}
                    onOpen={() => onOpen(it.id)}
                    onCompare={() => onOpen(it.id, it.twinned > 0 ? 'compare' : undefined)}
                    onWant={() => void toggleWant(it)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
        {hasMore && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="mx-auto mt-4 block rounded-full border border-line px-5 py-2 text-[13px] font-semibold text-text disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}

function Tile({
  it,
  roomy,
  onOpen,
  onCompare,
  onWant,
}: {
  it: ApiWantedItem;
  roomy: boolean;
  onOpen: () => void;
  onCompare: () => void;
  onWant: () => void;
}) {
  const kind = tileKind(it);
  const ratio = tileRatio(it.width, it.height, it.id);
  const none = it.twinned === 0;
  return (
    <div className="relative overflow-hidden rounded-xl bg-box" style={{ aspectRatio: `1 / ${ratio}` }}>
      <button
        onClick={onOpen}
        aria-label={`${it.query}. ${it.count} want it. ${twinnedLabel(it.twinned)}.`}
        className="absolute inset-0 block h-full w-full text-left"
      >
        {kind === 'still' && (
          <StillFrame url={it.video_url!} startMs={tileFrameMs({ start_ms: it.start_ms!, end_ms: it.end_ms!, box_at_ms: it.box_at_ms })} poster={it.thumbnail_url} className="h-full w-full object-cover" />
        )}
        {kind === 'loop' && (
          <LoopVideo
            url={it.video_url!}
            startMs={it.start_ms!}
            endMs={it.end_ms!}
            poster={it.thumbnail_url}
            className="h-full w-full object-cover"
          />
        )}
        {it.box && it.width && it.height && kind !== 'text' && <BoxRing box={it.box} videoRatio={it.height / it.width} />}
        {kind === 'text' && (
          <span
            className="flex h-full w-full items-center justify-center p-3 text-center"
            style={{ backgroundImage: textTile(it.id) }}
          >
            <span className="line-clamp-5 text-[15px] font-extrabold leading-snug text-white">{it.query}</span>
          </span>
        )}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent" />
        {it.creator_name && (
          <span className="absolute left-2 top-2">
            <Avatar url={it.creator_avatar_url} name={it.creator_name} size={24} />
          </span>
        )}
        {kind === 'still' && frameTimes(it.start_ms!, it.end_ms!, it.box_at_ms).length > 1 && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10.5px] font-bold text-white">
            <Layers size={10} aria-hidden="true" />
            {frameTimes(it.start_ms!, it.end_ms!, it.box_at_ms).length}
          </span>
        )}
        {kind === 'loop' && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10.5px] font-bold text-white">
            <Play size={9} fill="currentColor" aria-hidden="true" />
            {clockLabel(it.end_ms! - it.start_ms!)}
          </span>
        )}
      </button>

      <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-center justify-between gap-1">
        <button
          onClick={onWant}
          aria-pressed={it.upvoted}
          aria-label={it.upvoted ? 'You want this. Tap to withdraw' : 'Want it'}
          className={`pointer-events-auto flex items-center gap-0.5 rounded-full px-2 py-1 text-[11.5px] font-bold text-white transition-transform active:scale-110 ${
            it.upvoted ? 'bg-hot-pink' : 'bg-black/45 backdrop-blur-sm'
          }`}
        >
          <ChevronUp size={13} strokeWidth={2.8} aria-hidden="true" />
          {compactCount(it.count)}
        </button>
        <button
          onClick={onCompare}
          aria-label={none ? 'No twins yet. Open it' : `${twinnedLabel(it.twinned)}. Compare`}
          className={`pointer-events-auto flex items-center gap-1 whitespace-nowrap rounded-full py-1 text-[11.5px] font-bold text-white ${
            none ? 'bg-hot-pink px-2' : 'bg-black/45 pl-1 pr-2 backdrop-blur-sm'
          }`}
        >
          {none || it.twin_previews.length === 0 ? <TwinIcon size={12} className={none ? '' : 'ml-1'} /> : <PhotoStack urls={it.twin_previews} />}
          {none ? '+' : roomy ? twinnedLabel(it.twinned) : compactCount(it.twinned)}
        </button>
      </div>
    </div>
  );
}
