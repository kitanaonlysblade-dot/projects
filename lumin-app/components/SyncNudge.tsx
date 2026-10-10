'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

const STEP = 100;
const RANGE = 10_000;

// "Line it up": a retwin plays right under the original, so if you started
// recording a little late (or early), slide until the same moment matches in
// both. Offset = how far into THEIR video yours starts (original time =
// your time + offset). Both videos play together here exactly as viewers will
// see them.
export function SyncNudge({
  originalUrl,
  retwinUrl,
  offsetMs,
  onChange,
  originalName,
}: {
  originalUrl: string;
  retwinUrl: string;
  offsetMs: number;
  onChange: (ms: number) => void;
  originalName: string;
}) {
  const origRef = useRef<HTMLVideoElement>(null);
  const mineRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  // Keep the original at (your time + offset), whether playing or scrubbing.
  useEffect(() => {
    const orig = origRef.current;
    const mine = mineRef.current;
    if (!orig || !mine) return;
    const follow = () => {
      const target = mine.currentTime + offsetMs / 1000;
      if (target < 0) {
        orig.pause();
        if (orig.currentTime > 0.05) orig.currentTime = 0;
        return;
      }
      if (orig.duration && target >= orig.duration) {
        orig.pause();
        return;
      }
      if (orig.paused && !mine.paused) void orig.play().catch(() => {});
      if (Math.abs(orig.currentTime - target) > 0.25) orig.currentTime = target;
    };
    const onPlay = () => {
      setPlaying(true);
      follow();
    };
    const onPause = () => {
      setPlaying(false);
      orig.pause();
    };
    follow();
    mine.addEventListener('timeupdate', follow);
    mine.addEventListener('seeked', follow);
    mine.addEventListener('play', onPlay);
    mine.addEventListener('pause', onPause);
    mine.addEventListener('ended', onPause);
    return () => {
      mine.removeEventListener('timeupdate', follow);
      mine.removeEventListener('seeked', follow);
      mine.removeEventListener('play', onPlay);
      mine.removeEventListener('pause', onPause);
      mine.removeEventListener('ended', onPause);
    };
  }, [offsetMs]);

  const toggle = () => {
    const mine = mineRef.current;
    if (!mine) return;
    if (mine.paused) void mine.play().catch(() => {});
    else mine.pause();
  };
  const nudge = (delta: number) => onChange(Math.max(-RANGE, Math.min(RANGE, offsetMs + delta)));

  const label =
    offsetMs === 0
      ? 'Starts together'
      : offsetMs > 0
        ? `Yours starts ${(offsetMs / 1000).toFixed(1)}s into theirs`
        : `Theirs starts ${(-offsetMs / 1000).toFixed(1)}s into yours`;

  return (
    <div className="mt-4 rounded-xl bg-panel p-3">
      <p className="text-[13px] font-bold text-text">Line it up 🎚️</p>
      <p className="mb-2 text-[12px] text-text-mute">
        Press play and slide until the same moment matches in both. Skip this if you started together.
      </p>
      <div className="flex justify-center gap-2">
        <div className="w-24 overflow-hidden rounded-lg bg-black">
          <video ref={origRef} src={originalUrl} muted playsInline preload="auto" className="block max-h-40 w-full object-contain" />
          <p className="truncate bg-black/70 px-1 py-0.5 text-center text-[10px] text-white">{originalName}</p>
        </div>
        <div className="w-24 overflow-hidden rounded-lg bg-black">
          <video ref={mineRef} src={retwinUrl} muted playsInline preload="auto" className="block max-h-40 w-full object-contain" />
          <p className="bg-black/70 px-1 py-0.5 text-center text-[10px] text-white">You</p>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause both' : 'Play both'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-text"
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button type="button" onClick={() => nudge(-STEP)} className="h-8 rounded-full bg-white px-2.5 text-[12px] font-bold text-text">
          −0.1s
        </button>
        <input
          type="range"
          min={-RANGE}
          max={RANGE}
          step={STEP}
          value={offsetMs}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Offset between the two videos"
          className="min-w-0 flex-1 accent-hot-pink"
        />
        <button type="button" onClick={() => nudge(STEP)} className="h-8 rounded-full bg-white px-2.5 text-[12px] font-bold text-text">
          +0.1s
        </button>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <p className="text-[12px] font-bold text-text">{label}</p>
        {offsetMs !== 0 && (
          <button type="button" onClick={() => onChange(0)} className="text-[12px] font-bold text-hot-pink">
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
