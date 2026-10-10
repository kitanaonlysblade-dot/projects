import type { Product, Twin } from './types';

// Pure helpers for "twinning" (pairing each tagged product with when it
// appears in a shop video). Kept free of React/DOM so they can be tested.

export const MIN_TWIN_MS = 1000;
export const DEFAULT_TWIN_MS = 2000;
export const SNAP_MS = 100;
export const MAX_LABEL = 24;
// When two products are on screen at once the pill cycles between them.
export const CYCLE_MS = 2500;

export const snap = (ms: number) => Math.round(ms / SNAP_MS) * SNAP_MS;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// A range from two pointer positions (either order), snapped, at least
// MIN_TWIN_MS long and inside the video. A bare tap (zero length) becomes a
// DEFAULT_TWIN_MS range starting at the tap, pulled back if it would run off the end.
export function rangeFromDrag(aMs: number, bMs: number, durationMs: number): { startMs: number; endMs: number } {
  let start = snap(clamp(Math.min(aMs, bMs), 0, durationMs));
  let end = snap(clamp(Math.max(aMs, bMs), 0, durationMs));
  if (end - start < MIN_TWIN_MS) {
    const wanted = Math.abs(bMs - aMs) < SNAP_MS ? DEFAULT_TWIN_MS : MIN_TWIN_MS;
    end = start + wanted;
    if (end > durationMs) {
      end = snap(durationMs);
      start = Math.max(0, end - wanted);
    }
  }
  return { startMs: start, endMs: end };
}

// Resize one edge of a twin; the other edge stays put and the minimum length holds.
export function resizeEdge(twin: Twin, edge: 'start' | 'end', ms: number, durationMs: number): Twin {
  if (edge === 'start') {
    const startMs = clamp(snap(ms), 0, twin.endMs - MIN_TWIN_MS);
    return { ...twin, startMs };
  }
  const endMs = clamp(snap(ms), twin.startMs + MIN_TWIN_MS, snap(durationMs));
  return { ...twin, endMs };
}

const usable = (t: Twin) => t.reviewStatus !== 'flagged';

// Which twins are on screen at `ms` (flagged ones never are).
export function twinsAt(twins: Twin[] | undefined, ms: number): Twin[] {
  return (twins ?? []).filter((t) => usable(t) && ms >= t.startMs && ms < t.endMs);
}

// The one twin the pill should show at `ms`, or null (=> "Shop this video").
// Overlaps rotate every CYCLE_MS so each product gets its turn.
export function pillTwinAt(twins: Twin[] | undefined, ms: number): Twin | null {
  const active = twinsAt(twins, ms);
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];
  const ordered = [...active].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
  return ordered[Math.floor(ms / CYCLE_MS) % ordered.length];
}

// Products that still have no (unflagged) twin.
export function untwinned(products: Pick<Product, 'id'>[], twins: Twin[]): string[] {
  const covered = new Set(twins.filter(usable).map((t) => t.productId));
  return products.filter((p) => !covered.has(p.id)).map((p) => p.id);
}

// A short suggestion for the label prompt: the product name's last word if the
// name is long ("Leather Tote Bag" -> "bag"), else the whole name, lower-cased.
export function suggestLabel(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const pick = words.length > 2 ? words[words.length - 1] : words.join(' ');
  return pick.toLowerCase().slice(0, MAX_LABEL);
}

export const cleanLabel = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL);

export function formatMs(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// ---- Shared pool of moments (retwins) ---------------------------------------
// A video and all its retwins share one timeline; a moment somebody already
// holds ("locked") can't be twinned again. Edges touching is fine.

export interface Span {
  startMs: number;
  endMs: number;
}

// Turns a drag (anchor = where the finger went down, other = where it is now)
// into a twin that stays inside the free gap around the anchor. Null when the
// anchor is on a taken moment or the gap is too small for the minimum length.
export function fitToFree(anchorMs: number, otherMs: number, locked: Span[], durationMs: number): Span | null {
  const goingRight = otherMs >= anchorMs;
  const a = clamp(anchorMs, 0, durationMs);
  for (const l of locked) {
    const inside = goingRight ? a >= l.startMs && a < l.endMs : a > l.startMs && a <= l.endMs;
    if (inside) return null;
  }
  const lo = locked.reduce((m, l) => (l.endMs <= a ? Math.max(m, l.endMs) : m), 0);
  const hi = locked.reduce((m, l) => (l.startMs >= a && !(goingRight && l.startMs === a) ? Math.min(m, l.startMs) : m), snap(durationMs));
  if (hi - lo < MIN_TWIN_MS) return null;

  const tap = Math.abs(otherMs - anchorMs) < SNAP_MS;
  let start = snap(clamp(Math.min(a, otherMs), lo, hi));
  let end = snap(clamp(Math.max(a, otherMs), lo, hi));
  if (tap) {
    // A tap makes a default-length twin extending away from the anchor, shifted to fit.
    start = a;
    end = a + DEFAULT_TWIN_MS;
  }
  if (end - start < MIN_TWIN_MS) {
    if (goingRight || tap) end = start + (tap ? DEFAULT_TWIN_MS : MIN_TWIN_MS);
    else start = end - MIN_TWIN_MS;
  }
  if (end > hi) {
    end = hi;
    if (tap) start = Math.max(lo, end - DEFAULT_TWIN_MS);
    if (end - start < MIN_TWIN_MS) start = end - MIN_TWIN_MS;
  }
  if (start < lo) {
    start = lo;
    if (end - start < MIN_TWIN_MS) end = start + MIN_TWIN_MS;
  }
  if (start < lo || end > hi || end - start < MIN_TWIN_MS) return null;
  return { startMs: start, endMs: end };
}

// How far a twin's edges may be dragged before they bump into a taken moment.
export function edgeLimits(twin: Span, locked: Span[], durationMs: number): { minStart: number; maxEnd: number } {
  const minStart = locked.reduce((m, l) => (l.endMs <= twin.startMs ? Math.max(m, l.endMs) : m), 0);
  const maxEnd = locked.reduce((m, l) => (l.startMs >= twin.endMs ? Math.min(m, l.startMs) : m), snap(durationMs));
  return { minStart, maxEnd };
}

// The free stretches left on a timeline (for drawing "open space to claim").
export function freeGaps(locked: Span[], durationMs: number): Span[] {
  const sorted = [...locked].sort((x, y) => x.startMs - y.startMs);
  const gaps: Span[] = [];
  let cursor = 0;
  for (const l of sorted) {
    if (l.startMs > cursor) gaps.push({ startMs: cursor, endMs: l.startMs });
    cursor = Math.max(cursor, l.endMs);
  }
  if (cursor < durationMs) gaps.push({ startMs: cursor, endMs: durationMs });
  return gaps;
}

// One-tap twin search: the clip for "what's this?" is the few seconds up to just after the
// moment the shopper tapped (what they want to know about is what they just saw). Always
// at least a second long and inside the video.
export function autoClipAround(tappedMs: number, durationMs: number): { startMs: number; endMs: number } {
  const tapped = clamp(tappedMs, 0, Math.max(0, durationMs));
  let end = Math.min(durationMs, tapped + 1000);
  let start = Math.max(0, end - 4000);
  if (end - start < 1000) end = Math.min(durationMs, start + 1000);
  if (end - start < 1000) start = Math.max(0, end - 1000);
  return { startMs: start, endMs: end };
}

// Pins for the viewer's timeline: where each usable twin's moment sits along the video, and
// whether it has been checked (approved). Flagged twins are not shown; a twin nobody has
// reviewed yet still gets a pin, just without the check.
export interface TwinPin {
  id: string;
  leftPct: number;
  widthPct: number;
  approved: boolean;
}

export function twinPins(twins: Twin[] | undefined, durationMs: number): TwinPin[] {
  if (!twins || !Number.isFinite(durationMs) || durationMs <= 0) return [];
  return twins
    .filter(usable)
    .map((t) => {
      const start = clamp(t.startMs, 0, durationMs);
      const end = clamp(t.endMs, start, durationMs);
      return {
        id: t.id,
        leftPct: (start / durationMs) * 100,
        widthPct: ((end - start) / durationMs) * 100,
        approved: t.reviewStatus === 'approved',
      };
    })
    .filter((p) => p.widthPct > 0)
    .sort((a, b) => a.leftPct - b.leftPct);
}
