'use client';

import { useEffect, useState } from 'react';

// Thumbnails taken along a video, for timeline strips. Draws frames onto a
// canvas, which only works when the video is same-origin, a local blob: URL,
// or served with CORS; if the canvas gets tainted the remaining tiles simply
// stay null (callers show a plain placeholder).
export function useVideoFrames(src: string | undefined, durationMs: number, count = 10, rowHeight = 52): (string | null)[] {
  const [frames, setFrames] = useState<(string | null)[]>(() => Array(count).fill(null));

  useEffect(() => {
    if (!src || !durationMs) return;
    let cancelled = false;
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
      canvas.height = rowHeight * 2;
      canvas.width = Math.max(1, Math.round((w / h) * rowHeight * 2));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      for (let i = 0; i < count; i++) {
        if (cancelled) return;
        try {
          await new Promise<void>((res, rej) => {
            grabber.addEventListener('seeked', () => res(), { once: true });
            grabber.currentTime = ((i + 0.5) / count) * (durationMs / 1000);
            setTimeout(() => rej(new Error('seek timeout')), 4000);
          });
          ctx.drawImage(grabber, 0, 0, canvas.width, canvas.height);
          const url = canvas.toDataURL('image/jpeg', 0.6);
          if (cancelled) return;
          setFrames((prev) => prev.map((f, idx) => (idx === i ? url : f)));
        } catch {
          return;
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      grabber.removeAttribute('src');
      grabber.load();
    };
  }, [src, durationMs, count, rowHeight]);

  return frames;
}
