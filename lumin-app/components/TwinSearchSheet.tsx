'use client';

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import {
  ApiError,
  createTwinSearch,
  deleteTwinSearch,
  getToken,
  getMomentHints,
  getWantedNearby,
  type ApiMomentHints,
  upvoteWanted,
  type ApiWantedItem,
  pickTwinSearchResult,
  type ApiTwinSearch,
} from '@/lib/api';
import { apiProductToProduct } from '@/lib/adapters';
import { addWord, compactCount, frameTimes, othersLine, twinnedLabel, type Box } from '@/lib/wanted';
import { BoxRing, CircleDemo, CircleLayer } from './CircleIt';
import { autoClipAround, clamp, formatMs, snap } from '@/lib/twins';
import { useTwinConfig } from '@/lib/twinConfig';
import { useVideoFrames } from '@/lib/useVideoFrames';
import type { Category, Product, VideoPost } from '@/lib/types';
import { FirstTimeHint } from './FirstTimeHint';
import { ProductCard } from './ProductCard';

const FRAMES = 10;

const SOURCE_LABEL: Record<string, string> = {
  twin: 'Tagged by the seller',
  crowd: 'Shoppers confirmed this one',
};

// "What is this?" as a search. With a `post`, the shopper clips the moment of the
// video they're curious about (only the start and end times are sent; nothing from the
// video itself); without one it's a plain description search from the discovery screen.
// Before they create anything, requests already on the Wanted wall for the same moment
// are listed so they can say "Want it too" instead of starting a duplicate.
// Matches are shown as ordinary product cards. No match means the shopper is put on
// the waiting list and told when one is listed, and the search itself becomes
// demand data for merchants.
export function TwinSearchSheet({
  post,
  initialQuery = '',
  startAtMs,
  categories = [],
  onClose,
  onSelectProduct,
  onBuyNow,
  onAddToCart,
}: {
  post?: VideoPost | null;
  initialQuery?: string;
  // Where the shopper was in the video when they tapped: the clip is picked for them
  // around that moment (the few seconds before it), and they only adjust if it's off.
  startAtMs?: number;
  categories?: Category[];
  onClose: () => void;
  onSelectProduct: (product: Product) => void;
  onBuyNow: (product: Product, color: string, size: string) => void;
  onAddToCart: (product: Product, color: string, size: string) => void;
}) {
  const MAX_CLIP_MS = useTwinConfig().max_request_clip_ms;
  const videoRef = useRef<HTMLVideoElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ anchor: number } | null>(null);

  const [durationMs, setDurationMs] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const [sel, setSel] = useState<{ startMs: number; endMs: number } | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [result, setResult] = useState<ApiTwinSearch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stoppedWaiting, setStoppedWaiting] = useState(false);
  const autoPickedRef = useRef(false);
  const [box, setBox] = useState<Box | null>(null);
  const [circling, setCircling] = useState(false);
  // The frame (ms into the video) the circle is drawn on.
  const [circleAt, setCircleAt] = useState<number | null>(null);
  const [boxAt, setBoxAt] = useState<number | null>(null);
  const [hints, setHints] = useState<ApiMomentHints | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [seeAll, setSeeAll] = useState(false);
  const [nearby, setNearby] = useState<ApiWantedItem[]>([]);
  const [joined, setJoined] = useState<Record<string, boolean>>({});
  const [joinError, setJoinError] = useState<string | null>(null);

  const hasClip = Boolean(post?.videoUrl);
  const frames = useVideoFrames(post?.videoUrl, durationMs, FRAMES);
  const pct = (ms: number) => (durationMs ? (ms / durationMs) * 100 : 0);
  const clipReady = !hasClip || (sel !== null && sel.endMs - sel.startMs >= 500);
  const canSearch = query.trim().length >= 2 && clipReady && !busy;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onMeta = () => setDurationMs(Math.round((v.duration || 0) * 1000));
    const onTime = () => {
      setNowMs(Math.round(v.currentTime * 1000));
      if (sel && !v.paused && v.currentTime * 1000 >= sel.endMs) v.currentTime = sel.startMs / 1000;
    };
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('durationchange', onMeta);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('seeked', onTime);
    if (v.readyState >= 1) onMeta();
    return () => {
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('durationchange', onMeta);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('seeked', onTime);
    };
  }, [sel, hasClip]);

  // Once the clip has settled (not mid-drag), look for requests already made for it.
  const selStart = sel?.startMs ?? 0;
  const selEnd = sel?.endMs ?? 0;
  useEffect(() => {
    if (!hasClip || !post || selEnd - selStart < 500) {
      setNearby([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      getWantedNearby(post.id, selStart, selEnd, query.trim(), box)
        .then((r) => live && setNearby(r))
        .catch(() => live && setNearby([]));
    }, 450);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // The words only refine the match, so they are not worth a request per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasClip, post?.id, selStart, selEnd, box]);

  // Words and counts from other shoppers on this same moment (and circle, if any).
  useEffect(() => {
    if (!hasClip || !post || selEnd - selStart < 500) {
      setHints(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      getMomentHints(post.id, selStart, selEnd, box)
        .then((r) => live && setHints(r))
        .catch(() => live && setHints(null));
    }, 450);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [hasClip, post?.id, selStart, selEnd, box]);

  const wantToo = async (it: ApiWantedItem) => {
    setJoinError(null);
    if (!getToken()) {
      setJoinError('Log in to join a request.');
      return;
    }
    try {
      await upvoteWanted(it.id);
      setJoined((j) => ({ ...j, [it.id]: true }));
    } catch (e) {
      setJoinError(e instanceof ApiError ? e.message : 'Could not join — try again.');
    }
  };

  const xToMs = (clientX: number) => {
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || durationMs === 0) return 0;
    return clamp(((clientX - rect.left) / rect.width) * durationMs, 0, durationMs);
  };
  const seek = (ms: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = ms / 1000;
    setNowMs(ms);
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!durationMs) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const ms = xToMs(e.clientX);
    videoRef.current?.pause();
    draggingRef.current = { anchor: ms };
    setBox(null);
    setBoxAt(null);
    setCircling(false);
    setResult(null);
    setError(null);
    setSel({ startMs: ms, endMs: ms });
    seek(ms);
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = draggingRef.current;
    if (!d) return;
    const ms = xToMs(e.clientX);
    const start = Math.min(d.anchor, ms);
    const end = Math.min(Math.max(d.anchor, ms), start + MAX_CLIP_MS);
    setSel({ startMs: start, endMs: end });
    seek(ms);
  };
  // One tap: once the video's length is known, pick the clip for them, ending just after
  // the moment they tapped (what they wanted to know about is what they just saw),
  useEffect(() => {
    if (!hasClip || autoPickedRef.current || startAtMs === undefined || durationMs <= 0) return;
    autoPickedRef.current = true;
    const { startMs: start, endMs: end } = autoClipAround(startAtMs, durationMs);
    setSel({ startMs: start, endMs: end });
    seek(start);
    void videoRef.current?.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs, hasClip, startAtMs]);

  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = draggingRef.current;
    draggingRef.current = null;
    if (!d) return;
    const ms = xToMs(e.clientX);
    let start = snap(Math.min(d.anchor, ms));
    let end = snap(Math.max(d.anchor, ms));
    if (end - start < 1000) end = Math.min(snap(durationMs), start + 3000);
    if (end - start < 1000) start = Math.max(0, end - 3000);
    end = Math.min(end, start + MAX_CLIP_MS);
    setSel({ startMs: start, endMs: end });
    seek(start);
    void videoRef.current?.play().catch(() => {});
  };

  const find = async () => {
    if (!canSearch) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createTwinSearch({
        query: query.trim(),
        category_id: categoryId,
        ...(hasClip && post && sel
          ? { video_post_id: post.id, start_ms: sel.startMs, end_ms: sel.endMs, ...(box ? { box, ...(boxAt != null ? { box_at_ms: boxAt } : {}) } : {}) }
          : {}),
      });
      setResult(r);
      setStoppedWaiting(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not search — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const stopWaiting = async () => {
    if (!result) return;
    try {
      await deleteTwinSearch(result.id);
      setStoppedWaiting(true);
    } catch {
      /* leave as is */
    }
  };

  // Adding to cart / buying a result is what tells the server which product is
  // really on screen at that moment, so report it alongside the normal action.
  const reportPick = (product: Product, action: 'cart' | 'buy') => {
    if (result) void pickTwinSearchResult(result.id, product.id, action).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 lg:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 lg:rounded-2xl">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[15px] font-bold text-text">What&apos;s this? 🔎</p>
          <button onClick={onClose} aria-label="Close">
            <X size={18} className="text-text-mute" />
          </button>
        </div>
        {hasClip ? (
          <CircleDemo gone={box !== null} />
        ) : (
          <FirstTimeHint id="twin-words" emoji="✨" className="mb-3">
            A <b>twin</b> is a product that matches what you see. Describe it and we’ll find one.
          </FirstTimeHint>
        )}

        {hasClip && post && (
          <>
            <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-xl bg-black">
              <video ref={videoRef} src={post.videoUrl} muted playsInline preload="auto" className="block max-h-44 w-auto max-w-full" />
              {post.width && post.height && !circling && box && <BoxRing box={box} videoRatio={post.height / post.width} />}
              {circling && (
                <CircleLayer
                  box={box}
                  onChange={(b) => {
                    setBox(b);
                    setBoxAt(circleAt);
                    setResult(null);
                    setCircling(false);
                  }}
                />
              )}
              <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-[10.5px] font-semibold text-white">
                {formatMs(nowMs)}
              </span>
            </div>
            {sel && sel.endMs > sel.startMs && (
              <div className="mt-2 flex items-center justify-center gap-2">
                <button
                  onClick={() => {
                    videoRef.current?.pause();
                    // Circle the frame they are on (inside the clip), else the start of it.
                    const at = sel ? (nowMs >= sel.startMs && nowMs <= sel.endMs ? nowMs : sel.startMs) : 0;
                    setCircleAt(at);
                    seek(at);
                    setCircling((c) => !c);
                  }}
                  aria-pressed={circling}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold ${
                    circling || box ? 'brand-gradient text-white' : 'border border-hot-pink/40 bg-hot-pink/5 text-hot-pink'
                  }`}
                >
                  <Sparkles size={13} aria-hidden="true" />
                  {circling ? 'Cancel' : box ? 'Circle again' : 'Circle it'}
                </button>
                {box && !circling && (
                  <button onClick={() => { setBox(null); setBoxAt(null); setResult(null); }} className="text-[12px] font-semibold text-text-mute underline">
                    Clear
                  </button>
                )}
              </div>
            )}
            {circling && sel && (
              <div className="mt-2 flex items-center justify-center gap-1.5">
                <span className="text-[11.5px] text-text-mute">Pick the clearest frame:</span>
                {frameTimes(sel.startMs, sel.endMs).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setCircleAt(t);
                      seek(t);
                    }}
                    aria-pressed={circleAt === t}
                    className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${circleAt === t ? 'bg-ink text-white' : 'bg-box text-text'}`}
                  >
                    {formatMs(t)}
                  </button>
                ))}
              </div>
            )}
            {box && !circling && (
              <p className="mt-1 text-center text-[11.5px] text-text-mute">Nice eye 👀 sellers will see exactly what you mean.</p>
            )}
            {hints && othersLine(hints.asked, box ? hints.circled : 0) && !circling && (
              <p className="mx-auto mt-1.5 w-fit rounded-full bg-hot-pink/10 px-3 py-1 text-[12px] font-bold text-hot-pink">
                👀 {othersLine(hints.asked, box ? hints.circled : 0)}
              </p>
            )}
            <div
              ref={stripRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              role="group"
              aria-label="Video timeline. Drag across it to clip a moment."
              className="relative mt-3 touch-none select-none"
            >
              <div className="flex overflow-hidden rounded-lg bg-box" style={{ height: 52 }}>
                {frames.map((f, i) => (
                  <div
                    key={i}
                    className="h-full flex-1 bg-cover bg-center"
                    style={f ? { backgroundImage: `url(${f})` } : { background: `hsl(${230 + i * 6} 12% ${86 - i}%)` }}
                  />
                ))}
              </div>
              {sel && sel.endMs > sel.startMs && (
                <div
                  className="pointer-events-none absolute top-0 rounded-lg border-2 border-hot-pink bg-hot-pink/20"
                  style={{ left: `${pct(sel.startMs)}%`, width: `${pct(sel.endMs - sel.startMs)}%`, height: 52 }}
                />
              )}
              <div
                className="pointer-events-none absolute top-0 w-0.5 -translate-x-1/2 rounded bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
                style={{ left: `${pct(nowMs)}%`, height: 52 }}
              />
            </div>
            <p className="mt-1.5 text-[11.5px] text-text-mute">{autoPickedRef.current ? 'We picked the moment you just watched. Drag to change it.' : 'Drag across the timeline to pick the moment.'}</p>
          </>
        )}

        {nearby.length > 0 && (
          <section aria-label="Others want this too" className="mt-3 rounded-xl border border-hot-pink/30 bg-hot-pink/5 p-3">
            <p className="text-[12.5px] font-bold text-text">Others want this too</p>
            <ul className="mt-2 space-y-2">
              {(seeAll ? nearby : nearby.slice(0, 1)).map((it) => {
                const done = joined[it.id] || it.upvoted;
                return (
                  <li key={it.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-text">{it.query}</span>
                      <span className="block text-[11.5px] text-text-mute">
                        {compactCount(it.count + (joined[it.id] && !it.upvoted ? 1 : 0))} want it · {twinnedLabel(it.twinned)}
                      </span>
                    </span>
                    <button
                      onClick={() => void wantToo(it)}
                      disabled={done}
                      aria-pressed={done}
                      className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-bold ${
                        done ? 'bg-box text-text-mute' : 'brand-gradient text-white'
                      }`}
                    >
                      {done ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : null}
                      {joined[it.id] && !it.upvoted ? `You’re #${it.count + 1} 🎉` : done ? 'You want it' : 'Want it too'}
                    </button>
                  </li>
                );
              })}
            </ul>
            {nearby.length > 1 && !seeAll && (
              <button onClick={() => setSeeAll(true)} className="mt-2 text-[12px] font-semibold text-text-mute underline">
                See {nearby.length - 1} more
              </button>
            )}
            {joinError && <p className="mt-2 text-[12px] text-hot-pink">{joinError}</p>}
          </section>
        )}

        <input
          value={query}
          maxLength={300}
          onChange={(e) => {
            setQuery(e.target.value);
            setResult(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void find();
          }}
          placeholder="What is it? e.g. red leather shoulder bag"
          className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-[13px] focus:border-hot-pink focus:outline-none"
        />

        {hints && hints.words.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 text-[11.5px] text-text-mute">Others called it, tap to use:</p>
            <div className="flex flex-wrap gap-1.5">
              {hints.words.map((w) => (
                <button
                  key={w.word}
                  onClick={() => {
                    setQuery((q) => addWord(q, w.word));
                    setResult(null);
                  }}
                  className="rounded-full border border-hot-pink/40 bg-white px-3 py-1 text-[12.5px] font-semibold text-text active:scale-95"
                >
                  {w.word}
                  <span className="ml-1 text-[10.5px] font-bold text-hot-pink">{w.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {categories.length > 0 && !moreOpen && (
          <button onClick={() => setMoreOpen(true)} className="mt-2 text-[12px] font-semibold text-text-mute underline">
            More options{categoryId ? ' · category chosen' : ''}
          </button>
        )}
        {categories.length > 0 && moreOpen && (
          <div className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {[{ id: null as string | null, name: 'Any category' }, ...categories].map((c) => (
              <button
                key={c.id ?? 'any'}
                onClick={() => {
                  setCategoryId(c.id);
                  setResult(null);
                }}
                aria-pressed={categoryId === c.id}
                className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold ${
                  categoryId === c.id ? 'brand-gradient text-white' : 'bg-box text-text'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {error && <p className="mt-2 text-[12.5px] text-hot-pink">{error}</p>}

        <div className="sticky bottom-0 -mx-5 mt-3 bg-white px-5 pb-1 pt-2 shadow-[0_-8px_12px_-8px_rgba(0,0,0,0.12)]">
        <button
          onClick={find}
          disabled={!canSearch}
          className="brand-gradient w-full rounded-full py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
        >
          {busy
            ? 'Searching…'
            : hasClip && !clipReady
              ? 'Drag across the video to clip a moment'
              : sel && hasClip
                ? `Find its twin (${formatMs(sel.startMs)} – ${formatMs(sel.endMs)})`
                : 'Find its twin'}
        </button>
        </div>

        {result && result.results.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[13px] font-bold text-text">{result.message}</p>
            <div className="space-y-3">
              {result.results.map((r) => {
                const product = apiProductToProduct(r.product);
                return (
                  <div key={product.id}>
                    {SOURCE_LABEL[r.source] && (
                      <span className="mb-1 inline-block rounded-full bg-[#0EA5E9]/10 px-2 py-0.5 text-[10.5px] font-bold text-[#0EA5E9]">
                        {SOURCE_LABEL[r.source]}
                      </span>
                    )}
                    <ProductCard
                      product={product}
                      onSelectProduct={(p) => {
                        onClose();
                        onSelectProduct(p);
                      }}
                      onBuyNow={(p, color, size) => {
                        reportPick(p, 'buy');
                        onBuyNow(p, color, size);
                      }}
                      onAddToCart={(p, color, size) => {
                        reportPick(p, 'cart');
                        onAddToCart(p, color, size);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {result && result.results.length === 0 && (
          <div className="mt-4 rounded-xl bg-panel p-4 text-center">
            <p className="text-[14px] font-bold text-text">Couldn&apos;t find a twin match</p>
            {stoppedWaiting ? (
              <p className="mt-1 text-[12.5px] text-text-mute">Okay — we won&apos;t notify you about this one.</p>
            ) : (
              <>
                <p className="mt-1 text-[12.5px] text-text-mute">
                  We&apos;ll notify you as soon as a twin for “{result.query}” is available.
                </p>
                <button onClick={stopWaiting} className="mt-2 text-[12px] font-semibold text-text-mute underline">
                  Don&apos;t notify me
                </button>
              </>
            )}
            <div>
              <button onClick={onClose} className="brand-gradient mt-3 rounded-full px-6 py-2 text-[13px] font-bold text-white">
                Done
              </button>
            </div>
          </div>
        )}

        {result && result.results.length === 0 && result.closest.length > 0 && (
          <div className="mt-4">
            <p className="text-[13px] font-bold text-text">Closest we have</p>
            <p className="mb-2 text-[11.5px] text-text-mute">Not an exact twin — the nearest things in the store right now.</p>
            <div className="space-y-3">
              {result.closest.map((r) => {
                const product = apiProductToProduct(r.product);
                return (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onSelectProduct={(p) => {
                      onClose();
                      onSelectProduct(p);
                    }}
                    onBuyNow={(p, color, size) => {
                      reportPick(p, 'buy');
                      onBuyNow(p, color, size);
                    }}
                    onAddToCart={(p, color, size) => {
                      reportPick(p, 'cart');
                      onAddToCart(p, color, size);
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
