'use client';

import { useRef, useState } from 'react';
import type { ScanArea } from '@/lib/liveScan';

interface AreaPickerProps {
  // A picture of the shared screen (a data URL).
  picture: string;
  onDone: (area: ScanArea | null) => void;
}

// "Which part of your screen is the video?" Drag a box around it, or scan the whole screen.
export function AreaPicker({ picture, onDone }: AreaPickerProps) {
  const box = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<ScanArea | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const point = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const update = (e: React.PointerEvent) => {
    const a = start.current;
    if (!a) return;
    const b = point(e);
    setRect({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  };
  const usable = rect && rect.w > 0.05 && rect.h > 0.05;

  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-black/85 p-4" role="dialog" aria-label="Pick the video area">
      <p className="max-w-md text-center text-[14px] font-semibold text-white">Drag a box around the video, then scan just that part.</p>
      <div
        ref={box}
        className="relative max-h-[70vh] max-w-full touch-none select-none overflow-hidden rounded-lg border border-white/30"
        style={{ cursor: 'crosshair' }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          start.current = point(e);
          setRect(null);
        }}
        onPointerMove={update}
        onPointerUp={(e) => {
          update(e);
          start.current = null;
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={picture} alt="Your shared screen" draggable={false} className="block max-h-[70vh] max-w-full" />
        {rect && (
          <div
            className="pointer-events-none absolute border-2 border-hot-pink bg-hot-pink/15"
            style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
          />
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          disabled={!usable}
          onClick={() => onDone(rect)}
          className="rounded-full bg-hot-pink px-5 py-2 text-[13.5px] font-bold text-white disabled:opacity-40"
        >
          Scan this area
        </button>
        <button type="button" onClick={() => onDone(null)} className="rounded-full border border-white/50 px-5 py-2 text-[13.5px] font-bold text-white">
          Scan the whole screen
        </button>
      </div>
    </div>
  );
}
