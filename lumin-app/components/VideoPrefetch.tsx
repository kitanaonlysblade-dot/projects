'use client';

import { useEffect, useState } from 'react';
import { connectionIsConstrained, useLuminLite } from '@/lib/lite';
import { hlsPlaylist, preloadHls, warmHls } from '@/lib/hls';
import { isAppleMobile, prefetchVideo } from '@/lib/videoCache';

export interface PrefetchItem {
  url?: string; // the original mp4
  liteUrl?: string; // the smaller mp4 (Lumin Lite)
  hlsUrl?: string; // the streaming playlist (master.m3u8)
}

// Quietly gets the videos a swipe is about to land on, so they start at once instead of showing a spinner.
//   - A video with a streaming version (hlsUrl): only its playlists and first two pieces, at the quality this
//     connection has been sustaining, are fetched (about 200 KB). That is cheap enough to do on Lumin Lite and on slow connections too.
//   - Any other video: the whole file goes into the device store (lib/videoCache.ts), the Lite copy on Lumin Lite.
//     If the video host doesn't allow that, a hidden element loads the start of it into the browser's media cache.
// Nothing is fetched when the browser's Data Saver is on. Never shown or played.
export function VideoPrefetch({ items }: { items: PrefetchItem[] }) {
  const lite = useLuminLite();
  const [saveData, setSaveData] = useState(true); // assume yes until checked on the client
  const [slow, setSlow] = useState(true);
  useEffect(() => {
    const c = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
    setSaveData(!!c?.saveData);
    setSlow(connectionIsConstrained());
    // The player library is a one-time download the first streamed video would otherwise wait on; start it as soon
    // as the feed is up (skipped under Data Saver, like every other look-ahead here; no-op on Safari/iPhone).
    if (!c?.saveData) preloadHls();
  }, []);

  // Streaming first; then whole files (not on a slow connection unless Lumin Lite is on).
  const streams = items.map((i) => hlsPlaylist(i.hlsUrl, lite)).filter((u): u is string => !!u);
  const files = items
    .filter((i) => !i.hlsUrl)
    .map((i) => (lite ? i.liteUrl : i.url))
    .filter((u): u is string => !!u);
  const streamKey = streams.join('|');
  const fileKey = files.join('|');
  const [fallback, setFallback] = useState<string[]>([]);

  useEffect(() => {
    if (saveData || streams.length === 0) return;
    let live = true;
    const timer = setTimeout(async () => {
      for (const url of streams) {
        if (!live) return;
        await warmHls(url);
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamKey, saveData]);

  useEffect(() => {
    if (saveData || (slow && !lite) || files.length === 0) return;
    let live = true;
    // One after another, the nearest first. Lite files are small, so there the wait is short.
    const timer = setTimeout(async () => {
      for (const url of files) {
        const ok = await prefetchVideo(url);
        if (live && !ok) setFallback((prev) => (prev.includes(url) ? prev : [...prev, url]));
        if (!live) return;
      }
    }, lite ? 250 : 1500); // full-size: let the video being watched get going first
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey, lite, saveData, slow]);

  // Not on iPhone/iPad: hidden full-size <video preload=auto> elements are exactly the memory use that gets a tab killed there.
  if (saveData || lite || slow || isAppleMobile()) return null; // the hidden-element fallback is for full-size videos on a normal connection
  const hidden = files.filter((u) => fallback.includes(u));
  if (hidden.length === 0) return null;
  return (
    <div
      aria-hidden="true"
      style={{ position: 'fixed', left: -9999, top: 0, width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}
    >
      {hidden.map((url) => (
        <video key={url} src={url} preload="auto" muted playsInline tabIndex={-1} />
      ))}
    </div>
  );
}
