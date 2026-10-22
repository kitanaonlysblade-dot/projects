'use client';

// The last few videos fetched for the feed, kept on the device (Cache API): the next video is downloaded ahead of the
// swipe (prefetchVideo), plays from here, and stays here, so swiping back is instant and still works with no network or
// no data left, like Facebook. Each video is downloaded ONCE (it is never fetched a second time just to keep it).
// Small on purpose: only the most recent MAX_VIDEOS, none bigger than MAX_BYTES. With Lumin Lite on, it is the small
// Lite copy that is fetched and kept.
//
// If the video's host doesn't allow it (no CORS header), nothing is saved and playback is unaffected. Wiped on logout.

const CACHE_NAME = 'lumin-videos-v1';
export const MAX_VIDEOS = 8;
const MAX_BYTES = 40 * 1024 * 1024;
const SAVE_DELAY_MS = 3500;

// iPhone / iPad (every browser there is WebKit): keeping a video means reading the whole file (up to MAX_BYTES) into
// memory, twice over for the playable copy, while the feed already has three players alive. WebKit kills a tab that
// uses too much ("a problem occurred", the page reloads by itself), so nothing is kept on these devices: videos play
// from the network (streamed, or the mp4) as before, just not offline. iPadOS reports itself as a Mac with touch.
export const isAppleMobile = () =>
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const supported = () =>
  typeof window !== 'undefined' && !isAppleMobile() && 'caches' in window && typeof URL.createObjectURL === 'function';

// Which videos are kept, known without waiting: the player reads this on the way to setting a video's source, so a
// video that is NOT kept starts at once instead of after a storage look-up.
const kept = new Set<string>();
let keptLoaded = false;
function loadKept() {
  if (keptLoaded || !supported()) return;
  keptLoaded = true;
  caches
    .open(CACHE_NAME)
    .then((c) => c.keys())
    .then((keys) => keys.forEach((k) => kept.add(k.url)))
    .catch(() => undefined);
}
if (typeof window !== 'undefined') loadKept();
/** True only when this video is known to be kept on the device (false until that is known). */
export const isVideoKept = (url: string) => kept.has(url);

const objectUrls = new Map<string, string>(); // video url -> blob: url currently handed out
let blocked = false; // the host refused a cross-origin read: stop trying this session
const queue: string[] = [];
let working = false;

/** A playable address for this video from the device, or null when it isn't kept here. */
export async function cachedVideoUrl(url: string): Promise<string | null> {
  if (!supported() || !url || url.startsWith('blob:') || url.startsWith('data:')) return null;
  try {
    if (!kept.has(url)) return null;
    const existing = objectUrls.get(url);
    if (existing) return existing;
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (!hit) return null;
    const blob = await hit.blob();
    const made = URL.createObjectURL(blob);
    objectUrls.set(url, made);
    return made;
  } catch {
    return null;
  }
}

async function trim(cache: Cache) {
  const keys = await cache.keys(); // oldest first
  for (let i = 0; i < keys.length - MAX_VIDEOS; i++) {
    await cache.delete(keys[i]);
    kept.delete(keys[i].url);
    const made = objectUrls.get(keys[i].url);
    if (made) {
      // Not revoked here: it may still be playing. It goes when the page does.
      objectUrls.delete(keys[i].url);
    }
  }
}

async function saveOne(url: string) {
  if (blocked || !navigator.onLine) return;
  const cache = await caches.open(CACHE_NAME);
  if (await cache.match(url)) {
    // Already kept: re-add it as the newest so the one watched most recently is the last to go.
    return;
  }
  let res: Response;
  try {
    res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  } catch {
    blocked = true; // cross-origin read refused (or the network dropped): don't keep retrying
    return;
  }
  const size = Number(res.headers.get('content-length') || 0);
  if (!res.ok || res.status !== 200 || (size && size > MAX_BYTES)) return;
  const blob = await res.blob();
  if (blob.size > MAX_BYTES) return;
  await cache.put(url, new Response(blob, { headers: { 'Content-Type': blob.type || 'video/mp4' } }));
  kept.add(url);
  await trim(cache);
}

async function drain() {
  if (working) return;
  working = true;
  try {
    while (queue.length) {
      const url = queue.shift()!;
      try {
        await saveOne(url);
      } catch {
        // storage full or similar: skip this one
      }
    }
  } finally {
    working = false;
  }
}

/** Keep this video on the device (in the background, a moment from now). */
export function keepVideoSoon(url: string | undefined) {
  if (!url || !supported() || blocked || url.startsWith('blob:') || url.startsWith('data:')) return;
  setTimeout(() => {
    if (!queue.includes(url)) queue.push(url);
    void drain();
  }, SAVE_DELAY_MS);
}

/** Download this video into the device store now (for the one a swipe is about to land on). Resolves true when it
 *  is kept, false when it couldn't be (the host forbids it, no network...), so the caller can fall back. */
export async function prefetchVideo(url: string | undefined): Promise<boolean> {
  if (!url || !supported() || url.startsWith('blob:') || url.startsWith('data:')) return false;
  if (kept.has(url)) return true;
  if (blocked) return false;
  try {
    await saveOne(url);
  } catch {
    return false;
  }
  return kept.has(url);
}

/** Forget everything (sign-out). */
export async function clearVideoCache() {
  if (!supported()) return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // nothing to do
  }
  kept.clear();
  objectUrls.forEach((made) => URL.revokeObjectURL(made));
  objectUrls.clear();
}
