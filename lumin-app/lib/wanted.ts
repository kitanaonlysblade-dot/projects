// Pure helpers for the Wanted wall and its compare list. No React/DOM, so they can be tested.

// A moment this short is shown as a still frame; a longer one loops as video.
export const STILL_MAX_MS = 6000;

export type TileKind = 'still' | 'loop' | 'text';

export function tileKind(i: { video_url: string | null; start_ms: number | null; end_ms: number | null }): TileKind {
  if (!i.video_url || i.start_ms == null || i.end_ms == null) return 'text'; // a typed request has no picture
  return i.end_ms - i.start_ms <= STILL_MAX_MS ? 'still' : 'loop';
}

// "2100" -> "2.1k", "12000" -> "12k", "1500000" -> "1.5M".
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  const f = (v: number) => (v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)).replace(/\.0$/, '');
  if (n < 1_000_000) return `${f(n / 1000)}k`;
  return `${f(n / 1_000_000)}M`;
}

// Tile height as a multiple of its width: follows the video's own shape (clamped so the
// wall stays tidy), or - with no known shape - a steady, id-based variety so a wall of text
// tiles still looks like a wall and doesn't reshuffle between loads.
export function tileRatio(width: number | null, height: number | null, seed: string): number {
  if (width && height && width > 0 && height > 0) return Math.min(1.6, Math.max(0.9, height / width));
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return [1.25, 1.0, 1.45, 1.15][h % 4];
}

// A still of the moment from the video itself, with no upload: the browser seeks to the
// start and shows that frame paused.
export function stillSrc(videoUrl: string, startMs: number): string {
  return `${videoUrl.split('#')[0]}#t=${(Math.max(0, startMs) / 1000).toFixed(2)}`;
}

export type TwinMatch = 'strong' | 'good' | 'partial' | 'weak';
export type TwinKind = 'official' | 'confirmed' | 'offered';

export const MATCH_LABEL: Record<TwinMatch, string> = {
  strong: 'Strong match',
  good: 'Good match',
  partial: 'Partial',
  weak: 'Weak',
};

const MATCH_RANK: Record<TwinMatch, number> = { strong: 3, good: 2, partial: 1, weak: 0 };

export type TwinSort = 'best' | 'price' | 'confirmed';

interface Sortable {
  kind: TwinKind;
  match: TwinMatch;
  kept: number;
  product: { price: string | number };
}

const price = (o: Sortable) => (typeof o.product.price === 'number' ? o.product.price : parseFloat(o.product.price));

// The official twin(s) always sit on top, in their own box; the rest are sorted by the
// chosen order. Ties keep the server's order (the sort is stable).
export function splitTwins<T extends Sortable>(items: T[], sort: TwinSort): { official: T[]; others: T[] } {
  const official = items.filter((o) => o.kind === 'official');
  const others = items.filter((o) => o.kind !== 'official');
  const cmp: Record<TwinSort, (a: T, b: T) => number> = {
    best: (a, b) => MATCH_RANK[b.match] - MATCH_RANK[a.match] || b.kept - a.kept,
    price: (a, b) => price(a) - price(b),
    confirmed: (a, b) =>
      Number(b.kind === 'confirmed') - Number(a.kind === 'confirmed') || b.kept - a.kept || MATCH_RANK[b.match] - MATCH_RANK[a.match],
  };
  return { official, others: [...others].sort(cmp[sort]) };
}

// What the twin count reads like next to the tile: "No twins yet" / "1 twinned" / "6 twinned".
export function twinnedLabel(n: number): string {
  return n === 0 ? 'No twins yet' : `${compactCount(n)} twinned`;
}

// "8000" -> "0:08": a clip's length as a badge on its tile.
export function clockLabel(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// Deal items into columns for a masonry wall: each goes under the shortest column so far, so
// tall and short tiles balance out. Items keep their order within a column (and so, roughly,
// their rank down the page).
export function splitColumns<T>(items: T[], heightOf: (t: T) => number, cols = 2): T[][] {
  const out: T[][] = Array.from({ length: cols }, () => []);
  const heights = new Array<number>(cols).fill(0);
  for (const it of items) {
    let c = 0;
    for (let i = 1; i < cols; i++) if (heights[i] < heights[c]) c = i;
    out[c].push(it);
    heights[c] += heightOf(it);
  }
  return out;
}

// "Circle it": the part of a frame a shopper means, as fractions (0..1) of the frame.
export type Box = { x: number; y: number; w: number; h: number };

const MIN_BOX = 0.06;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// A box from a drag between two points (fractions of the frame), kept inside it and
// never smaller than a fingertip.
export function boxFromDrag(ax: number, ay: number, bx: number, by: number): Box {
  const x0 = clamp01(Math.min(ax, bx));
  const y0 = clamp01(Math.min(ay, by));
  const x1 = clamp01(Math.max(ax, bx));
  const y1 = clamp01(Math.max(ay, by));
  const w = Math.max(MIN_BOX, x1 - x0);
  const h = Math.max(MIN_BOX, y1 - y0);
  return { x: Math.min(x0, 1 - w), y: Math.min(y0, 1 - h), w, h };
}

// One tap: drop a ring of a friendly size around the point.
export function boxAround(cx: number, cy: number, size = 0.3): Box {
  const x = Math.min(1 - size, Math.max(0, cx - size / 2));
  const y = Math.min(1 - size, Math.max(0, cy - size / 2));
  return { x, y, w: size, h: size };
}

// Where a frame-fraction box lands inside a container that shows the video with
// object-fit: cover (so the edges can be cropped). `videoRatio` and `boxRatio` are
// height / width. Returns fractions of the container, clipped to it, or null when the
// circled part has been cropped out of view altogether.
export function coverBox(box: Box, videoRatio: number, containerRatio: number): Box | null {
  if (!(videoRatio > 0) || !(containerRatio > 0)) return null;
  let sx = 1;
  let sy = 1;
  let ox = 0;
  let oy = 0;
  if (containerRatio > videoRatio) {
    // The container is taller than the video: the sides are cropped.
    sx = containerRatio / videoRatio;
    ox = (sx - 1) / 2;
  } else {
    // The container is wider than the video: the top and bottom are cropped.
    sy = videoRatio / containerRatio;
    oy = (sy - 1) / 2;
  }
  const x0 = Math.max(0, box.x * sx - ox);
  const y0 = Math.max(0, box.y * sy - oy);
  const x1 = Math.min(1, (box.x + box.w) * sx - ox);
  const y1 = Math.min(1, (box.y + box.h) * sy - oy);
  if (x1 - x0 < 0.02 || y1 - y0 < 0.02) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function boxIou(a: Box, b: Box): number {
  const iw = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const ih = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

// Tap a word chip: it becomes the query when empty, otherwise it is added (once).
export function addWord(query: string, word: string): string {
  const q = query.trim();
  if (!q) return word;
  const has = q.toLowerCase().split(/\s+/).includes(word.toLowerCase());
  return has ? q : `${q} ${word}`;
}

// "2 others circled this too" / "3 others asked about this moment": numbers, never names.
export function othersLine(asked: number, circled: number): string | null {
  if (circled > 0) return `${circled} ${circled === 1 ? 'other' : 'others'} circled this too`;
  if (asked > 0) return `${asked} ${asked === 1 ? 'other' : 'others'} asked about this moment`;
  return null;
}

// A short moment is shown as a few frames from it rather than as video. Where the circle
// was drawn is always one of them, so the ring lands on the frame it was drawn on.
export const STILL_FRAMES = 3;

export function frameTimes(startMs: number, endMs: number, boxAtMs?: number | null): number[] {
  const len = Math.max(0, endMs - startMs);
  const n = len < 1500 ? 1 : STILL_FRAMES;
  const times = n === 1 ? [startMs] : Array.from({ length: n }, (_, i) => Math.round(startMs + (len * i) / n + len / (2 * n)));
  if (boxAtMs != null && boxAtMs >= startMs && boxAtMs <= endMs) {
    let best = 0;
    times.forEach((t, i) => {
      if (Math.abs(t - boxAtMs) < Math.abs(times[best] - boxAtMs)) best = i;
    });
    times[best] = Math.round(boxAtMs);
  }
  return times.sort((a, b) => a - b);
}

// The frame a wall tile shows: the circled one, else the middle of the moment.
export function tileFrameMs(i: { start_ms: number; end_ms: number; box_at_ms?: number | null }): number {
  if (i.box_at_ms != null) return i.box_at_ms;
  const t = frameTimes(i.start_ms, i.end_ms);
  return t[Math.floor(t.length / 2)];
}
