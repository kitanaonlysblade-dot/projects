'use client';

import { useEffect, useRef } from 'react';
import { useState } from 'react';
import { stillSrc, type Box } from '@/lib/wanted';
import { BoxRing } from './CircleIt';

// A still of a moment: the video's own frame at the moment's start, paused. Nothing is
// uploaded or sent anywhere; the browser seeks the video it already has.
export function StillFrame({
  url,
  startMs,
  poster,
  className = '',
}: {
  url: string;
  startMs: number;
  poster?: string | null;
  className?: string;
}) {
  return (
    <video
      src={stillSrc(url, startMs)}
      poster={poster ?? undefined}
      muted
      playsInline
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
      className={`pointer-events-none ${className}`}
    />
  );
}

// A moment played on a loop (just the clipped stretch, muted). It only plays while on
// screen, so a wall of them doesn't all decode at once, and not at all for people who
// have asked their device to reduce motion (they get the paused frame).
export function LoopVideo({
  url,
  startMs,
  endMs,
  poster,
  className = '',
}: {
  url: string;
  startMs: number;
  endMs: number;
  poster?: string | null;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const start = startMs / 1000;
    const end = endMs / 1000;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let visible = typeof IntersectionObserver === 'undefined';

    const seek = () => {
      try {
        v.currentTime = start;
      } catch {
        /* not seekable yet */
      }
    };
    const play = () => {
      if (!reduced && visible) void v.play().catch(() => {});
    };
    const onMeta = () => {
      seek();
      play();
    };
    const onTime = () => {
      if (v.currentTime >= end || v.currentTime < start - 0.3) seek();
    };
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('timeupdate', onTime);
    if (v.readyState >= 1) seek();

    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        ([entry]) => {
          visible = entry.isIntersecting;
          if (visible) play();
          else v.pause();
        },
        { threshold: 0.4 },
      );
      io.observe(v);
    } else {
      play();
    }
    return () => {
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('timeupdate', onTime);
      io?.disconnect();
      v.pause();
    };
  }, [url, startMs, endMs]);

  return (
    <video
      ref={ref}
      src={url}
      poster={poster ?? undefined}
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
      className={`pointer-events-none ${className}`}
    />
  );
}

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;

// A short moment as a few frames you swipe through (taken from the video in the browser,
// nothing uploaded). The circle, if there is one, shows on the frame it was drawn on, and
// that frame is the one you land on.
export function FrameStrip({
  url,
  times,
  poster,
  box,
  boxAtMs,
  videoRatio,
}: {
  url: string;
  times: number[];
  poster?: string | null;
  box?: Box | null;
  boxAtMs?: number | null;
  videoRatio?: number;
}) {
  const boxIdx = box && boxAtMs != null ? times.indexOf(boxAtMs) : -1;
  const [active, setActive] = useState(Math.max(0, boxIdx));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && boxIdx > 0) el.scrollTo({ left: el.clientWidth * boxIdx });
  }, [boxIdx]);
  return (
    <div className="relative h-full w-full">
      <div
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          setActive(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
        role="group"
        aria-label={`${times.length} frames from this moment. Swipe to see them.`}
      >
        {times.map((t, i) => (
          <div key={t} className="relative h-full w-full shrink-0 snap-center overflow-hidden">
            <StillFrame url={url} startMs={t} poster={poster} className="h-full w-full object-cover" />
            {box && i === boxIdx && videoRatio ? <BoxRing box={box} videoRatio={videoRatio} /> : null}
            <span className="absolute left-2.5 top-2.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10.5px] font-bold text-white">{clock(t)}</span>
          </div>
        ))}
      </div>
      {times.length > 1 && (
        <span className="pointer-events-none absolute bottom-3 right-3 flex gap-1.5" aria-hidden="true">
          {times.map((t, i) => (
            <span key={t} className={`h-1.5 rounded-full transition-all ${i === active ? 'w-4 bg-white' : 'w-1.5 bg-white/55'}`} />
          ))}
        </span>
      )}
    </div>
  );
}
