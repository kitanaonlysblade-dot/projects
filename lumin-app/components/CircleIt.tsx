'use client';

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { hintSeen, markHintSeen } from '@/lib/hints';
import { boxAround, boxFromDrag, coverBox, type Box } from '@/lib/wanted';

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

// The ring itself: a glowing pink outline that springs in, with the rest of the frame
// dimmed a little so the circled thing is what the eye lands on. It is drawn from four
// numbers; nothing is cropped, uploaded or stored as a picture.
function Ring({ box, live = false }: { box: Box; live?: boolean }) {
  const [shown, setShown] = useState(live);
  useEffect(() => {
    if (live) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [live]);
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute rounded-2xl border-[2.5px] border-white transition-transform duration-300 ease-out ${
        shown ? 'scale-100' : 'scale-125'
      }`}
      style={{
        left: pct(box.x),
        top: pct(box.y),
        width: pct(box.w),
        height: pct(box.h),
        boxShadow: '0 0 0 1.5px #FF2D6F, 0 0 14px 2px rgba(255,45,111,0.65), 0 0 0 999px rgba(0,0,0,0.38)',
      }}
    />
  );
}

// Shows a circled part of a video on whatever frame it is laid over (a wall tile, the
// opened tile). The parent must be `relative overflow-hidden`; the video inside it may be
// shown with object-cover, so the ring is mapped through the crop.
export function BoxRing({ box, videoRatio }: { box: Box; videoRatio: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [ratio, setRatio] = useState(0);
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      if (parent.clientWidth > 0) setRatio(parent.clientHeight / parent.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);
  const mapped = ratio > 0 ? coverBox(box, videoRatio, ratio) : null;
  return (
    <span ref={ref} className="pointer-events-none absolute inset-0 block">
      {mapped && <Ring box={mapped} />}
    </span>
  );
}

// Draw-a-circle layer over a paused frame: drag around the thing, or just tap it. The
// parent must be `relative` and exactly the size of the frame.
export function CircleLayer({ box, onChange }: { box: Box | null; onChange: (b: Box) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<Box | null>(null);

  const at = (e: RPointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height))),
    };
  };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = at(e);
    setLive(null);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const s = startRef.current;
    if (!s) return;
    const p = at(e);
    if (Math.abs(p.x - s.x) > 0.02 || Math.abs(p.y - s.y) > 0.02) setLive(boxFromDrag(s.x, s.y, p.x, p.y));
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    const s = startRef.current;
    startRef.current = null;
    if (!s) return;
    const p = at(e);
    const dragged = Math.abs(p.x - s.x) > 0.02 || Math.abs(p.y - s.y) > 0.02;
    onChange(dragged ? boxFromDrag(s.x, s.y, p.x, p.y) : boxAround(s.x, s.y));
    setLive(null);
    try {
      navigator.vibrate?.(12); // a little tick where the device has one
    } catch {
      /* no haptics */
    }
  };

  const shown = live ?? box;
  return (
    <div
      ref={ref}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        startRef.current = null;
        setLive(null);
      }}
      role="group"
      aria-label="Draw a circle around the item, or tap it"
      className="absolute inset-0 cursor-crosshair touch-none select-none bg-black/10"
    >
      {shown && <Ring box={shown} live={live !== null} key={live ? 'live' : `${shown.x}-${shown.y}-${shown.w}`} />}
      {!shown && (
        <span className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-black/60 px-3 py-1 text-[12px] font-semibold text-white motion-safe:animate-pulse">
          Tap or draw ✨
        </span>
      )}
    </div>
  );
}

// A ten-second lesson, once per device: a tiny frame where a ring draws itself around the
// item. It teaches "tap or draw" without a paragraph, and it goes away for good once
// dismissed or once they have circled something.
export function CircleDemo({ gone }: { gone: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => setShow(!hintSeen('circle-demo')), []);
  useEffect(() => {
    if (gone && show) {
      markHintSeen('circle-demo');
      setShow(false);
    }
  }, [gone, show]);
  if (!show) return null;
  return (
    <div role="note" className="mb-2 flex items-center gap-3 rounded-xl bg-hot-pink/5 px-3 py-2">
      <style>{`
        @keyframes lumin-ring { 0% { opacity: 0; transform: scale(1.6); } 25%, 80% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1); } }
        @keyframes lumin-tap { 0%, 15% { opacity: 0; transform: translate(14px, 18px) scale(1); } 30% { opacity: 1; transform: translate(0, 0) scale(1); } 40% { transform: translate(0, 0) scale(0.85); } 55%, 100% { opacity: 0; transform: translate(0, 0) scale(1); } }
        .lumin-ring { animation: lumin-ring 3s ease-out infinite; }
        .lumin-tap { animation: lumin-tap 3s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) { .lumin-ring, .lumin-tap { animation: none; opacity: 1; } }
      `}</style>
      <span aria-hidden="true" className="relative h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-violet to-hot-pink">
        <span className="absolute left-2 top-3 h-6 w-5 rounded bg-white/85" />
        <span
          className="lumin-ring absolute left-[3px] top-[7px] h-8 w-[34px] rounded-xl border-2 border-white"
          style={{ boxShadow: '0 0 0 1px #FF2D6F, 0 0 8px rgba(255,45,111,0.8)' }}
        />
        <span className="lumin-tap absolute left-4 top-6 h-3 w-3 rounded-full bg-white/90 shadow" />
      </span>
      <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-text">
        <b>Tap the thing you mean</b>, or draw around it. We’ll find its twin.
      </p>
      <button
        onClick={() => {
          markHintSeen('circle-demo');
          setShow(false);
        }}
        className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11.5px] font-bold text-text"
      >
        Got it
      </button>
    </div>
  );
}
