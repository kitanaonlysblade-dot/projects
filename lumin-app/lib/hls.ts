'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { getApiBaseUrl } from './api';

// Adaptive streaming (HLS) for the video feed. The server cuts each video into 2-second pieces at several qualities
// (app/video_optimize.py). The player starts near the quality this connection has actually sustained, so far, and
// moves up/down as conditions change, as Facebook / TikTok do. Lumin Lite uses lite.m3u8, which lists only the two
// smallest qualities.
//
// Safari / iPhone play HLS themselves; every other browser uses hls.js (loaded only when a video needs it).

/** The playlist to play for a post: lite.m3u8 on Lumin Lite, otherwise master.m3u8. */
export const hlsPlaylist = (hlsUrl: string | undefined, lite: boolean): string | undefined =>
  hlsUrl ? (lite ? hlsUrl.replace(/master\.m3u8$/, 'lite.m3u8') : hlsUrl) : undefined;

let nativeCache: boolean | null = null;
export function nativeHls(): boolean {
  if (nativeCache === null) {
    nativeCache = typeof document !== 'undefined' && document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
  }
  return nativeCache;
}

// ---- Remembered bandwidth ------------------------------------------------------------------------------------------
// A fresh Hls instance is created per video (VideoStage mounts one per post), which used to mean every single video
// started the ABR estimate over from hls.js's own conservative built-in default — so a connection that had already
// proven it could sustain 720p still opened the next clip at 240p, with a short clip barely leaving time to climb
// back up before it ended. `abrEwmaDefaultEstimate` seeds a *new* instance's starting guess, so the fix is simply:
// remember what the last instance actually measured (bits/sec), and seed the next one with it instead of nothing.
// sessionStorage (not just a module variable) so a full page reload doesn't throw the estimate away either, and a
// module variable as the fast path so most reads never touch storage at all.
const BANDWIDTH_KEY = 'lumin_hls_bw';
const DEFAULT_ESTIMATE = 350_000; // ~conservative enough to land on the smallest rung cold, same as the old fixed startLevel:0
let bandwidthEstimate: number | null = null;

function loadBandwidthEstimate(): number {
  if (bandwidthEstimate !== null) return bandwidthEstimate;
  try {
    const stored = typeof window !== 'undefined' ? window.sessionStorage.getItem(BANDWIDTH_KEY) : null;
    bandwidthEstimate = stored ? Number(stored) || DEFAULT_ESTIMATE : DEFAULT_ESTIMATE;
  } catch {
    bandwidthEstimate = DEFAULT_ESTIMATE;
  }
  return bandwidthEstimate;
}

function saveBandwidthEstimate(bitsPerSecond: number) {
  if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return;
  bandwidthEstimate = bitsPerSecond;
  try {
    window.sessionStorage.setItem(BANDWIDTH_KEY, String(Math.round(bitsPerSecond)));
  } catch {
    /* private mode / full storage — the module variable still works for this tab's remaining session */
  }
}

// ---- Preloading the library itself ----------------------------------------------------------------------------
// Downloading hls.js is a one-time ~50KB tax the first video pays before it can start — that cost is unavoidable
// the first time streaming is used in a session, but there's no reason to wait for the first video to *need* it
// before starting the download. Call this as soon as the feed is about to show (VideoPrefetch does, on mount).
let preloaded = false;
export function preloadHls(): void {
  if (preloaded || typeof window === 'undefined' || nativeHls()) return;
  preloaded = true;
  void import('hls.js').catch(() => {
    preloaded = false; // let a later real attempt retry rather than being stuck "preloaded" on a failed fetch
  });
}

// ---- Metrics --------------------------------------------------------------------------------------------------
// Queued locally and flushed in batches (POST /hls-metrics) rather than one request per measurement — a session
// that swipes through 20 videos should cost one or two requests, not 20+. See app/models/hls_metric.py for what
// each `kind` means and why this exists at all: without it, "does streaming actually start faster than the plain
// mp4" and "how often does it fall back" are guesses, not numbers.
type MetricKind = 'ttff' | 'stall' | 'level_reached' | 'fallback';
interface MetricPoint {
  kind: MetricKind;
  video_post_id?: string;
  is_hls: boolean;
  lite: boolean;
  value_ms?: number;
  level?: number;
  connection?: string;
}
let metricQueue: MetricPoint[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function currentConnection(): string | undefined {
  const c = (navigator as unknown as { connection?: { effectiveType?: string } }).connection;
  return c?.effectiveType;
}

function flushMetrics(useBeacon = false) {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (metricQueue.length === 0) return;
  const points = metricQueue;
  metricQueue = [];
  const url = `${getApiBaseUrl()}/hls-metrics`;
  const body = JSON.stringify({ points });
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    return;
  }
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {
    /* best-effort — a lost metrics batch isn't worth retrying over */
  });
}

function recordMetric(point: MetricPoint) {
  metricQueue.push({ ...point, connection: currentConnection() });
  if (metricQueue.length >= 25) {
    flushMetrics();
    return;
  }
  if (!flushTimer) flushTimer = setTimeout(() => flushMetrics(), 5000);
}

if (typeof window !== 'undefined') {
  // pagehide (not just beforeunload — iOS Safari doesn't reliably fire beforeunload) catches a swipe straight out
  // of the app, which is exactly when an interval-based flush would otherwise lose whatever's still queued.
  window.addEventListener('pagehide', () => flushMetrics(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushMetrics(true);
  });
}

/**
 * Plays `playlist` in the video element. Does nothing without a playlist. If streaming can't work (the browser can't,
 * or it fails for good), `onFail` is called once so the caller can fall back to the plain mp4.
 */
export function useHls(
  videoRef: RefObject<HTMLVideoElement | null>,
  playlist: string | undefined,
  lite: boolean,
  onFail: () => void,
  videoPostId?: string,
) {
  // Across the lifetime of one `playlist` — survives the effect re-running for unrelated reasons, cleared whenever
  // the playlist genuinely changes (new video).
  const startedAtRef = useRef<number | null>(null);
  const ttffSentRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playlist) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    startedAtRef.current = performance.now();
    ttffSentRef.current = false;

    const reportTtff = (isHls: boolean) => {
      if (ttffSentRef.current || startedAtRef.current === null) return;
      ttffSentRef.current = true;
      recordMetric({
        kind: 'ttff',
        video_post_id: videoPostId,
        is_hls: isHls,
        lite,
        value_ms: Math.round(performance.now() - startedAtRef.current),
      });
    };

    // Shared by both the native and hls.js paths below: a stall is fundamentally "the video element had to pause
    // playback because it ran out of buffer," which is exactly what the standard `waiting`/`playing` media events
    // mean — using those instead of an hls.js-internal error detail means stalls are measured the same way
    // regardless of which path is playing, including native Safari HLS where hls.js isn't involved at all. `waiting`
    // can also fire for a deliberate pause-to-seek, not just a true rebuffer, so this only counts it as a stall if
    // playback was actually underway (not paused, not already ended) when it fired.
    let stallStart: number | null = null;
    const onWaiting = () => {
      if (!video.paused && !video.ended) stallStart = performance.now();
    };
    const onPlaying = () => {
      if (stallStart === null) return;
      recordMetric({
        kind: 'stall',
        video_post_id: videoPostId,
        is_hls: true, // this whole function only runs when a streaming playlist is in play, native or hls.js alike
        lite,
        value_ms: Math.round(performance.now() - stallStart),
      });
      stallStart = null;
    };
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);

    if (nativeHls()) {
      const onLoadedData = () => reportTtff(true);
      video.addEventListener('loadeddata', onLoadedData, { once: true });
      video.src = playlist;
      return () => {
        video.removeEventListener('loadeddata', onLoadedData);
        video.removeEventListener('waiting', onWaiting);
        video.removeEventListener('playing', onPlaying);
        video.removeAttribute('src');
        video.load();
      };
    }

    import('hls.js')
      .then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          onFail();
          return;
        }
        const seedEstimate = loadBandwidthEstimate();
        const hls = new Hls({
          // -1 = let hls.js choose the start rung itself from abrEwmaDefaultEstimate below, instead of always
          // forcing the smallest — this is the actual fix for "every video starts at 240p": a connection that's
          // already proven it can sustain more starts the next clip near there instead of from zero.
          startLevel: -1,
          abrEwmaDefaultEstimate: seedEstimate,
          capLevelToPlayerSize: true,
          maxBufferLength: 10, // seconds ahead; keeps data use and memory modest
          maxMaxBufferLength: 20,
          // Managed dynamically below once this clip's actual duration is known (LEVEL_LOADED) — short feed clips
          // get this disabled entirely so a loop/replay never has to re-fetch the start of the video; this 8s
          // default only ever applies to the brief window before that duration is known, or to a longer video.
          backBufferLength: 8,
          startFragPrefetch: true,
        });
        // Not a constructor option (TS rejects it in HlsConfig) — this is a runtime property on the instance
        // itself. Lite never climbs above the second-smallest rendition.
        hls.autoLevelCapping = lite ? 1 : -1;

        let maxLevelReached = 0;

        hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => {
          // Keep the whole clip buffered for anything feed-length — these are short-form videos by design (the
          // whole app), so there's essentially never a real memory cost to this, and it's what stops a replayed/
          // looped video from dropping its first couple of seconds out of the back buffer and having to re-fetch
          // them. A longer video (over ~45s) keeps the normal 8s back-buffer management instead.
          const duration = data.details?.totalduration ?? 0;
          hls.config.backBufferLength = duration > 0 && duration <= 45 ? Infinity : 8;
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
          maxLevelReached = Math.max(maxLevelReached, data.level);
        });
        hls.on(Hls.Events.FRAG_BUFFERED, () => reportTtff(true));
        hls.on(Hls.Events.BUFFER_APPENDED, () => {
          // The bandwidth estimate updates continuously inside hls.js's ABR controller as fragments load — grabbing
          // it here (cheap, just a property read) rather than only at teardown means a video someone lingers on for
          // a while still contributes a fresh number, not just whatever was true in its first second.
          saveBandwidthEstimate(hls.bandwidthEstimate);
        });
        let retries = 0;
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retries < 2) {
            retries += 1;
            hls.recoverMediaError();
          } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retries < 2) {
            retries += 1;
            hls.startLoad();
          } else {
            recordMetric({ kind: 'fallback', video_post_id: videoPostId, is_hls: true, lite });
            hls.destroy();
            onFail();
          }
        });
        hls.loadSource(playlist);
        hls.attachMedia(video);
        destroy = () => {
          recordMetric({ kind: 'level_reached', video_post_id: videoPostId, is_hls: true, lite, level: maxLevelReached });
          saveBandwidthEstimate(hls.bandwidthEstimate);
          hls.destroy();
        };
      })
      .catch(() => {
        if (!cancelled) onFail();
      });

    return () => {
      cancelled = true;
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist, lite]);
}

// Separate from useHls on purpose: the mp4 <video> element has no hls.js lifecycle to hang this off, so VideoStage
// calls this directly once its plain-mp4 path actually starts playing, giving the mp4 side of the ttff comparison
// the same measurement the streaming side gets.
export function reportMp4Ttff(videoPostId: string | undefined, lite: boolean, startedAt: number) {
  recordMetric({
    kind: 'ttff',
    video_post_id: videoPostId,
    is_hls: false,
    lite,
    value_ms: Math.round(performance.now() - startedAt),
  });
}

// ---- Look-ahead ---------------------------------------------------------------------------------------------------
// For the video a swipe is about to land on: fetch its playlists and the first two pieces of whichever quality this
// connection has actually been sustaining (not always the smallest — warming the wrong rung just gets evicted and
// re-fetched once the player picks a higher one), so when the player asks for them a moment later the browser
// already has them and the first picture shows at once.
const warmed = new Set<string>();

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim());

interface Variant {
  bandwidth: number;
  uri: string;
}

function parseVariants(master: string, baseUrl: string): Variant[] {
  const all = lines(master);
  const variants: Variant[] = [];
  for (let i = 0; i < all.length; i++) {
    if (!all[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const uri = all[i + 1];
    if (!uri || uri.startsWith('#')) continue;
    const m = /BANDWIDTH=(\d+)/.exec(all[i]);
    variants.push({ bandwidth: m ? Number(m[1]) : 0, uri: new URL(uri, baseUrl).toString() });
  }
  return variants; // already smallest-first, same order the encoder wrote them in
}

/** The variant to warm for the current remembered bandwidth: the richest one this connection can plausibly sustain. */
function pickVariant(variants: Variant[]): Variant | undefined {
  if (variants.length === 0) return undefined;
  const estimate = loadBandwidthEstimate();
  // Same headroom factor hls.js's own ABR uses by default (never commit to a rung that would eat the whole
  // estimated budget) — picking the richest rung at or under that, falling back to the smallest.
  const budget = estimate * 0.9;
  const fits = variants.filter((v) => v.bandwidth <= budget);
  return fits.length > 0 ? fits[fits.length - 1] : variants[0];
}

export async function warmHls(playlist: string | undefined): Promise<boolean> {
  if (!playlist || typeof window === 'undefined') return false;
  if (warmed.has(playlist)) return true;
  try {
    const master = await fetch(playlist);
    if (!master.ok) return false;
    const variant = pickVariant(parseVariants(await master.text(), playlist));
    if (!variant) return false;
    const list = await fetch(variant.uri);
    if (!list.ok) return false;
    const text = await list.text();
    const pieces = lines(text)
      .filter((l) => l && !l.startsWith('#'))
      .slice(0, 2)
      .map((l) => new URL(l, variant.uri).toString());
    for (const url of pieces) {
      const r = await fetch(url);
      if (r.ok) await r.arrayBuffer();
    }
    warmed.add(playlist);
    return true;
  } catch {
    return false;
  }
}
