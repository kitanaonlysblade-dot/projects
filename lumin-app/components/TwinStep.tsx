'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Check, Pause, Play, Trash2 } from 'lucide-react';
import { FirstTimeHint } from './FirstTimeHint';
import { cleanLabel, clamp, edgeLimits, fitToFree, formatMs, pillTwinAt, rangeFromDrag, resizeEdge, suggestLabel, untwinned, MAX_LABEL } from '@/lib/twins';
import type { Product, Twin } from '@/lib/types';
import { ProductThumbnail } from './Thumbnails';

// "Twinning": pair every tagged product with the stretch of the video where it
// appears. Frames of the video sit in a strip; the merchant picks a product and
// taps/drags on the strip to mark when it is on screen. Required for every
// product (see PostEditor) — that is what stops products being tagged onto
// videos they aren't in.

const COLORS = ['#FF2D6F', '#FF6B35', '#7C3AED', '#0EA5E9', '#10B981', '#F59E0B'];
const FRAME_COUNT = 10;
const FRAME_H = 52;
const LANE_H = 18;

type Drag =
  | { kind: 'scrub' }
  | { kind: 'create'; productId: string; anchorMs: number }
  | { kind: 'resize'; id: string; edge: 'start' | 'end' }
  | { kind: 'none' };

let twinSeq = 0;
const newId = () => `new-${Date.now().toString(36)}-${twinSeq++}`;

interface TwinStepProps {
  videoUrl: string;
  // A local (blob:) copy of the file, when we have one, is used to grab the
  // thumbnails: a cross-origin video can't be drawn to a canvas without CORS.
  frameSrc?: string;
  products: Product[];
  twins: Twin[];
  onChange: (twins: Twin[]) => void;
  // Moments somebody else already holds on this video's shared timeline
  // (the original and other retwins). They show as a "taken" lane and can't
  // be twinned over.
  lockedRanges?: { startMs: number; endMs: number; label: string }[];
  // A retwin's own video, played muted beside the original and kept in step
  // with it, so the merchant can see where their product shows up.
  companionUrl?: string;
}

export function TwinStep({ videoUrl, frameSrc, products, twins, onChange, lockedRanges, companionUrl }: TwinStepProps) {
  // `lockedRanges ?? []` directly here used to hand previewTwin's useMemo
  // below a brand-new array reference every single render whenever the
  // prop itself was undefined (a fresh `[]` literal each time, even
  // though its contents — nothing — never actually changed), defeating
  // that memo entirely: it recomputed on every render regardless of
  // whether twins/nowMs had moved at all. Memoizing the fallback itself,
  // keyed on the prop, means `locked` only gets a new reference when
  // lockedRanges actually does.
  const locked = useMemo(() => lockedRanges ?? [], [lockedRanges]);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const companionRef = useRef<HTMLVideoElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice((cur) => (cur === msg ? null : cur)), 1800);
  };
  const videoRef = useRef<HTMLVideoElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>({ kind: 'none' });
  const twinsRef = useRef(twins);
  twinsRef.current = twins;
  const selectedTwinRef = useRef<string | null>(null);

  const [durationMs, setDurationMs] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [frames, setFrames] = useState<(string | null)[]>(() => Array(FRAME_COUNT).fill(null));
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    () => untwinned(products, twins)[0] ?? products[0]?.id ?? null,
  );
  const [selectedTwinId, setSelectedTwinId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ productId: string; startMs: number; endMs: number } | null>(null);
  const [labelFor, setLabelFor] = useState<string | null>(null); // productId being named
  const [labelText, setLabelText] = useState('');
  const [justDone, setJustDone] = useState(false);

  const colorOf = useCallback(
    (productId: string) => COLORS[Math.max(0, products.findIndex((p) => p.id === productId)) % COLORS.length],
    [products],
  );
  const productOf = (id: string) => products.find((p) => p.id === id);
  const missing = untwinned(products, twins);
  const doneCount = products.length - missing.length;
  selectedTwinRef.current = selectedTwinId;
  const selectedTwin = twins.find((t) => t.id === selectedTwinId) ?? null;
  const hasFlagged = twins.some((t) => t.reviewStatus === 'flagged');

  // ---- video wiring ------------------------------------------------------
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onMeta = () => setDurationMs(Math.round((v.duration || 0) * 1000));
    const onTime = () => {
      setNowMs(Math.round(v.currentTime * 1000));
      // Loop the section being worked on.
      const sel = twinsRef.current.find((t) => t.id === selectedTwinRef.current);
      if (sel && !v.paused && v.currentTime * 1000 >= sel.endMs) v.currentTime = sel.startMs / 1000;
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('durationchange', onMeta);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('seeked', onTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    if (v.readyState >= 1) onMeta();
    const c = companionRef.current;
    const follow = () => {
      if (!c) return;
      if (c.duration && v.currentTime >= c.duration) return c.pause();
      if (Math.abs(c.currentTime - v.currentTime) > 0.4) c.currentTime = v.currentTime;
    };
    const cPlay = () => {
      follow();
      void c?.play().catch(() => {});
    };
    const cPause = () => c?.pause();
    if (c) {
      v.addEventListener('play', cPlay);
      v.addEventListener('pause', cPause);
      v.addEventListener('seeked', follow);
      v.addEventListener('timeupdate', follow);
    }
    return () => {
      if (c) {
        v.removeEventListener('play', cPlay);
        v.removeEventListener('pause', cPause);
        v.removeEventListener('seeked', follow);
        v.removeEventListener('timeupdate', follow);
      }
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('durationchange', onMeta);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('seeked', onTime);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [videoUrl, companionUrl]);

  const seek = (ms: number) => {
    const v = videoRef.current;
    if (v && Number.isFinite(ms)) v.currentTime = ms / 1000;
    setNowMs(ms);
  };

  // ---- frame thumbnails --------------------------------------------------
  useEffect(() => {
    if (!durationMs) return;
    let cancelled = false;
    const src = frameSrc || videoUrl;
    const grabber = document.createElement('video');
    if (!src.startsWith('blob:')) grabber.crossOrigin = 'anonymous';
    grabber.muted = true;
    grabber.preload = 'auto';
    grabber.src = src;
    const canvas = document.createElement('canvas');
    const run = async () => {
      await new Promise<void>((res) => {
        if (grabber.readyState >= 2) return res();
        grabber.addEventListener('loadeddata', () => res(), { once: true });
        grabber.addEventListener('error', () => res(), { once: true });
        setTimeout(res, 6000);
      });
      const w = grabber.videoWidth || 90;
      const h = grabber.videoHeight || 160;
      canvas.height = FRAME_H * 2;
      canvas.width = Math.max(1, Math.round((w / h) * FRAME_H * 2));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      for (let i = 0; i < FRAME_COUNT; i++) {
        if (cancelled) return;
        const t = ((i + 0.5) / FRAME_COUNT) * (durationMs / 1000);
        try {
          await new Promise<void>((res, rej) => {
            const done = () => res();
            grabber.addEventListener('seeked', done, { once: true });
            grabber.currentTime = t;
            setTimeout(() => rej(new Error('seek timeout')), 4000);
          });
          ctx.drawImage(grabber, 0, 0, canvas.width, canvas.height);
          const url = canvas.toDataURL('image/jpeg', 0.6); // throws if the canvas is tainted
          if (cancelled) return;
          setFrames((prev) => prev.map((f, idx) => (idx === i ? url : f)));
        } catch {
          return; // leave the remaining tiles as plain placeholders
        }
      }
    };
    run();
    return () => {
      cancelled = true;
      grabber.removeAttribute('src');
      grabber.load();
    };
  }, [durationMs, frameSrc, videoUrl]);

  // ---- timeline gestures -------------------------------------------------
  const xToMs = (clientX: number) => {
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || durationMs === 0) return 0;
    return clamp(((clientX - rect.left) / rect.width) * durationMs, 0, durationMs);
  };

  const selectTwin = (t: Twin) => {
    setSelectedTwinId(t.id);
    setSelectedProductId(t.productId);
    seek(t.startMs);
    const v = videoRef.current;
    if (v) void v.play().catch(() => {});
  };

  const handlePointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (durationMs === 0) return;
    const target = e.target as HTMLElement;
    const ms = xToMs(e.clientX);
    e.currentTarget.setPointerCapture(e.pointerId);
    const handle = target.closest<HTMLElement>('[data-handle]');
    const bar = target.closest<HTMLElement>('[data-bar]');
    const lane = target.closest<HTMLElement>('[data-lane]');
    if (target.closest('[data-locked-lane]')) {
      flash('That moment is taken');
      dragRef.current = { kind: 'none' };
      return;
    }
    if (handle) {
      dragRef.current = { kind: 'resize', id: handle.dataset.twin!, edge: handle.dataset.handle as 'start' | 'end' };
      return;
    }
    if (bar) {
      const t = twinsRef.current.find((x) => x.id === bar.dataset.bar);
      if (t) selectTwin(t);
      dragRef.current = { kind: 'none' };
      return;
    }
    const productId = lane?.dataset.lane ?? selectedProductId;
    videoRef.current?.pause();
    if (!productId) {
      dragRef.current = { kind: 'scrub' };
      seek(ms);
      return;
    }
    setSelectedProductId(productId);
    setSelectedTwinId(null);
    dragRef.current = { kind: 'create', productId, anchorMs: ms };
    setDraft({ productId, startMs: ms, endMs: ms });
    seek(ms);
  };

  const handlePointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag.kind === 'none') return;
    const ms = xToMs(e.clientX);
    if (drag.kind === 'scrub') return seek(ms);
    if (drag.kind === 'create') {
      setDraft({ productId: drag.productId, startMs: Math.min(drag.anchorMs, ms), endMs: Math.max(drag.anchorMs, ms) });
      return seek(ms);
    }
    if (drag.kind === 'resize') {
      onChange(
        twinsRef.current.map((t) => {
          if (t.id !== drag.id) return t;
          const { minStart, maxEnd } = edgeLimits(t, lockedRef.current, durationMs);
          return resizeEdge(t, drag.edge, drag.edge === 'start' ? Math.max(ms, minStart) : Math.min(ms, maxEnd), durationMs);
        }),
      );
      seek(ms);
    }
  };

  const handlePointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = { kind: 'none' };
    if (drag.kind === 'create') {
      const ms = xToMs(e.clientX);
      const fitted = lockedRef.current.length
        ? fitToFree(drag.anchorMs, ms, lockedRef.current, durationMs)
        : rangeFromDrag(drag.anchorMs, ms, durationMs);
      if (!fitted) {
        setDraft(null);
        flash('No room there — try a free stretch');
        return;
      }
      const { startMs, endMs } = fitted;
      const product = productOf(drag.productId);
      const known = twinsRef.current.find((t) => t.productId === drag.productId && t.label)?.label;
      const label = known || cleanLabel(suggestLabel(product?.name ?? '')) || 'item';
      const twin: Twin = { id: newId(), productId: drag.productId, label, startMs, endMs };
      onChange([...twinsRef.current, twin]);
      setDraft(null);
      setSelectedTwinId(twin.id);
      seek(startMs);
      void videoRef.current?.play().catch(() => {});
      if (!known) {
        setLabelFor(drag.productId);
        setLabelText(label);
      } else {
        advanceFrom(drag.productId, [...twinsRef.current, twin]);
      }
    }
  };

  // After finishing a product, jump to the next one that still needs a twin.
  const advanceFrom = (doneProductId: string, nextTwins: Twin[]) => {
    const left = untwinned(products, nextTwins).filter((id) => id !== doneProductId);
    if (left.length > 0) setSelectedProductId(left[0]);
    else setJustDone(true);
  };
  useEffect(() => {
    if (!justDone) return;
    const t = setTimeout(() => setJustDone(false), 1400);
    return () => clearTimeout(t);
  }, [justDone]);

  const confirmLabel = () => {
    if (!labelFor) return;
    const product = productOf(labelFor);
    const label = cleanLabel(labelText) || cleanLabel(suggestLabel(product?.name ?? '')) || 'item';
    const next = twinsRef.current.map((t) => (t.productId === labelFor ? { ...t, label } : t));
    onChange(next);
    setLabelFor(null);
    advanceFrom(labelFor, next);
  };

  const removeSelected = () => {
    if (!selectedTwin) return;
    onChange(twins.filter((t) => t.id !== selectedTwin.id));
    setSelectedProductId(selectedTwin.productId);
    setSelectedTwinId(null);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  const previewTwin = useMemo(
    () =>
      pillTwinAt(
        [...twins, ...locked.map((l, i) => ({ id: `locked-${i}`, productId: 'locked', label: l.label, startMs: l.startMs, endMs: l.endMs }))],
        nowMs,
      ),
    [twins, locked, nowMs],
  );
  const pct = (ms: number) => (durationMs ? (ms / durationMs) * 100 : 0);

  return (
    <div>
      <FirstTimeHint id="twin-step" emoji="✨" className="mb-3">
        <b>Twinning:</b> drag across the strip to show when each product is on screen. Viewers see “Shop the …” right at that moment.
      </FirstTimeHint>
      {/* Video(s) + live "what viewers will see" pill */}
      <div className="flex justify-center gap-2">
      <div className="relative w-fit max-w-full overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          preload="auto"
          onClick={togglePlay}
          className={`block w-auto max-w-full ${companionUrl ? 'max-h-44' : 'max-h-56'}`}
        />
        <button
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white"
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-[10.5px] font-semibold text-white">
          {formatMs(nowMs)}
        </span>
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex flex-col items-center gap-1">
          <span
            key={previewTwin?.id ?? 'generic'}
            className="rounded-full bg-white px-3 py-1 text-[12px] font-bold text-text shadow-lg"
            style={{ animation: 'twinPop 200ms ease-out' }}
          >
            {previewTwin ? `Shop the ${previewTwin.label}` : 'Shop this video'}
          </span>
          <span className="text-[9.5px] font-semibold uppercase tracking-wide text-white/80">What viewers see</span>
        </div>
      </div>
      {companionUrl && (
        <div className="relative w-fit max-w-full overflow-hidden rounded-xl bg-black">
          <video ref={companionRef} src={companionUrl} muted playsInline preload="auto" className="block max-h-44 w-auto max-w-full" />
          <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-[10.5px] font-semibold text-white">Yours</span>
        </div>
      )}
      </div>

      {/* Product chips: tap one, then mark where it appears */}
      <div className="mt-3 flex items-center justify-between">
        <p className="text-[12.5px] font-bold text-text">
          {missing.length === 0 ? 'All twinned 🎉' : 'Twin each product to when it appears'}
        </p>
        <span className={`text-[12px] font-bold ${missing.length === 0 ? 'text-hot-pink' : 'text-text-mute'}`}>
          {doneCount} of {products.length}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-box">
        <div
          className="brand-gradient h-full rounded-full transition-[width] duration-300"
          style={{ width: `${products.length ? (doneCount / products.length) * 100 : 0}%` }}
        />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {products.map((p) => {
          const selected = selectedProductId === p.id;
          const twinned = !missing.includes(p.id);
          const label = twins.find((t) => t.productId === p.id)?.label;
          return (
            <button
              key={p.id}
              onClick={() => {
                setSelectedProductId(p.id);
                setSelectedTwinId(null);
              }}
              aria-pressed={selected}
              className={`flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-left transition-colors ${
                selected ? 'bg-white' : 'border-line bg-panel'
              }`}
              style={selected ? { borderColor: colorOf(p.id), boxShadow: `0 0 0 2px ${colorOf(p.id)}33` } : undefined}
            >
              <span className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-box">
                <ProductThumbnail product={p} />
              </span>
              <span className="max-w-[110px] truncate text-[12px] font-bold text-text">{label ?? p.name}</span>
              {twinned ? (
                <span className="flex h-4 w-4 items-center justify-center rounded-full" style={{ background: colorOf(p.id) }}>
                  <Check size={11} className="text-white" strokeWidth={3} />
                </span>
              ) : (
                <span className="h-2.5 w-2.5 animate-pulse rounded-full" style={{ background: colorOf(p.id) }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Timeline: frames, then one lane per product */}
      <div
        ref={stripRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative mt-3 touch-none select-none rounded-lg"
        role="group"
        aria-label="Video timeline. Drag across it to mark when the selected product appears."
      >
        <div className="flex overflow-hidden rounded-lg bg-box" style={{ height: FRAME_H }}>
          {frames.map((f, i) => (
            <div
              key={i}
              className="h-full flex-1 bg-cover bg-center"
              style={f ? { backgroundImage: `url(${f})` } : { background: `hsl(${230 + i * 6} 12% ${86 - i}%)` }}
            />
          ))}
        </div>
        <div className="mt-1 flex flex-col gap-1">
          {locked.length > 0 && (
            <div data-locked-lane aria-label="Taken moments" className="relative rounded-md bg-[#0000000a]" style={{ height: LANE_H }}>
              {locked.map((l, i) => (
                <div
                  key={i}
                  className="absolute top-0 flex h-full items-center overflow-hidden rounded-md px-1 text-[9.5px] font-bold text-white/90"
                  style={{
                    left: `${pct(l.startMs)}%`,
                    width: `${pct(l.endMs - l.startMs)}%`,
                    background: 'repeating-linear-gradient(45deg,#6b7280,#6b7280 5px,#9ca3af 5px,#9ca3af 10px)',
                  }}
                >
                  <span className="truncate">{l.label}</span>
                </div>
              ))}
            </div>
          )}
          {products.map((p) => {
            const color = colorOf(p.id);
            const mine = twins.filter((t) => t.productId === p.id);
            const draftHere = draft?.productId === p.id ? draft : null;
            return (
              <div
                key={p.id}
                data-lane={p.id}
                aria-label={`${p.name} lane`}
                className="relative rounded-md"
                style={{ height: LANE_H, background: selectedProductId === p.id ? `${color}1f` : '#0000000a' }}
              >
                {mine.map((t) => {
                  const flagged = t.reviewStatus === 'flagged';
                  const sel = t.id === selectedTwinId;
                  return (
                    <div
                      key={t.id}
                      data-bar={t.id}
                      className="absolute top-0 h-full rounded-md"
                      style={{
                        left: `${pct(t.startMs)}%`,
                        width: `${pct(t.endMs - t.startMs)}%`,
                        background: flagged
                          ? 'repeating-linear-gradient(45deg,#ef4444,#ef4444 4px,#fca5a5 4px,#fca5a5 8px)'
                          : color,
                        outline: sel ? '2px solid #111' : undefined,
                        outlineOffset: 1,
                      }}
                    >
                      {sel && (
                        <>
                          <span data-handle="start" data-twin={t.id} className="absolute -left-2 top-0 h-full w-4 cursor-ew-resize">
                            <span className="absolute left-1.5 top-1 h-[10px] w-1 rounded bg-white" />
                          </span>
                          <span data-handle="end" data-twin={t.id} className="absolute -right-2 top-0 h-full w-4 cursor-ew-resize">
                            <span className="absolute right-1.5 top-1 h-[10px] w-1 rounded bg-white" />
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
                {draftHere && (
                  <div
                    className="absolute top-0 h-full rounded-md opacity-60"
                    style={{ left: `${pct(draftHere.startMs)}%`, width: `${pct(draftHere.endMs - draftHere.startMs)}%`, background: color }}
                  />
                )}
              </div>
            );
          })}
        </div>
        {/* Playhead */}
        <div
          className="pointer-events-none absolute top-0 w-0.5 -translate-x-1/2 rounded bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
          style={{ left: `${pct(nowMs)}%`, height: '100%' }}
        />
      </div>
      {notice && (
        <p role="status" className="mt-1.5 rounded-lg bg-black px-3 py-1.5 text-center text-[12px] font-semibold text-white">
          {notice}
        </p>
      )}
      {locked.length > 0 && (
        <p className="mt-1.5 text-[11.5px] text-text-mute">
          Striped stretches already have the original poster’s product — anywhere else is yours.
        </p>
      )}
      {durationMs > 0 && missing.length > 0 && !labelFor && (
        <p className="mt-1.5 text-[11.5px] text-text-mute">
          Drag across the frames where{' '}
          <b style={{ color: colorOf(selectedProductId ?? '') }}>{productOf(selectedProductId ?? '')?.name ?? 'the product'}</b> shows up
          — or just tap for 2 seconds.
        </p>
      )}

      {/* Name it: what the pill will say */}
      {labelFor && (
        <div className="mt-2.5 rounded-xl border border-line bg-panel p-2.5">
          <p className="text-[12.5px] font-bold text-text">What is this?</p>
          <p className="mb-1.5 text-[11.5px] text-text-mute">
            A short name for the pill — viewers see “Shop the <b>{cleanLabel(labelText) || '…'}</b>”.
          </p>
          <div className="flex gap-2">
            <input
              autoFocus
              value={labelText}
              maxLength={MAX_LABEL}
              onChange={(e) => setLabelText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmLabel()}
              placeholder="e.g. bag"
              className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-[13px] focus:border-hot-pink focus:outline-none"
            />
            <button onClick={confirmLabel} className="brand-gradient rounded-full px-4 text-[12.5px] font-bold text-white">
              Done
            </button>
          </div>
        </div>
      )}

      {/* Selected twin */}
      {selectedTwin && !labelFor && (
        <div className="mt-2.5 flex items-center justify-between rounded-xl bg-panel px-3 py-2">
          <button
            onClick={() => {
              setLabelFor(selectedTwin.productId);
              setLabelText(selectedTwin.label);
            }}
            className="min-w-0 text-left"
          >
            <span className="block truncate text-[12.5px] font-bold text-text">Shop the {selectedTwin.label}</span>
            <span className="text-[11.5px] text-text-mute">
              {formatMs(selectedTwin.startMs)} – {formatMs(selectedTwin.endMs)} · tap to rename
            </span>
          </button>
          <button onClick={removeSelected} aria-label="Delete this twin" className="shrink-0 p-1.5 text-text-mute">
            <Trash2 size={17} />
          </button>
        </div>
      )}
      {hasFlagged && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600">
          Some twins were flagged in review (striped). Mark where those products really appear and they&apos;ll be replaced.
        </p>
      )}
    </div>
  );
}
