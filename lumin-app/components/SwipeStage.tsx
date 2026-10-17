'use client';

import { isValidElement, useEffect, useRef, useState } from 'react';

// Matches Tailwind's `duration-300` used in the wheel/programmatic path
// below — kept as one constant so the JS timeout and the CSS transition
// can never drift out of sync.
const SETTLE_DURATION_MS = 300;

// The touch-drag path's own finish-the-slide timing, once a drag's
// released past the commit threshold — shorter than SETTLE_DURATION_MS
// above since the live drag has usually already covered most of the
// distance by the time someone lets go; this only has to cover whatever's
// left. Also doubles as how long a *cancelled* drag takes to spring back
// to center. Matches the `duration-[220ms]` arbitrary value used below —
// same reasoning as SETTLE_DURATION_MS/duration-300 staying in sync.
const DRAG_SETTLE_DURATION_MS = 220;

// A touch doesn't count as a swipe at all — just a tap, or a mostly-
// horizontal gesture meant for something else (the double-tap seek zones
// in VideoStage) — until it's moved at least this many vertical pixels.
// Below this, nothing visibly moves yet, so an ordinary tap never nudges
// the video.
const ACTIVATION_PX = 8;

// Drag releases past either of these commit the swipe: a slow but
// deliberate drag part of the way across the stage, or a quick flick
// that doesn't need to cover much distance at all to clearly mean
// "next." Same two-signal approach Reels/TikTok-style feeds use rather
// than distance alone, which would make a fast flick feel like it needs
// to travel further than it should to register.
//
// 🛠️ FIX: was 0.2 / 0.5 — both measured stricter in practice than they
// read on paper. 0.2 of a full phone screen's height is ~160px, and
// 0.5px/ms (500px/s) is a genuinely fast flick, not an ordinary unhurried
// swipe — most normal swipes land short of BOTH, so they'd spring back
// to center instead of committing, needing a second, more forceful
// attempt to actually advance. Lowered to match what an ordinary swipe
// actually covers.
const COMMIT_DISTANCE_FRACTION = 0.12;
const COMMIT_VELOCITY_PX_PER_MS = 0.3;

// How much a drag toward a direction with nothing to show (the very
// first or last post) still gives, rather than being completely rigid —
// a soft "there's nothing more this way" rather than the finger just
// doing nothing at all.
const RUBBER_BAND_FACTOR = 0.35;

interface SwipeStageProps {
  // Identity of whatever's currently "settled" (not mid-transition) —
  // used to reset internal animation state once the parent actually
  // swaps content, for both the wheel path (guards against a stuck
  // mid-animation state if the parent ever swaps without going through
  // pendingDirection) and the touch path (the moment a committed drag's
  // onSettled call lands and settledKey changes, there's nothing left to
  // animate — see the dedicated effect below).
  settledKey: string;
  current: React.ReactNode;
  next?: React.ReactNode;
  prev?: React.ReactNode;
  // Set by the parent for a *programmatic* trigger — currently just
  // VideoStage's desktop wheel/trackpad handler, which has no equivalent
  // of a finger position to live-track, so it still goes through the
  // same "jump straight to animating" path this component has always
  // used. Touch swiping no longer goes through this at all — it's
  // tracked live, below, from the first touch rather than reported after
  // the fact. null means neither is happening; just show `current`.
  pendingDirection: 'next' | 'prev' | null;
  // Called once a swipe actually completes — either the wheel path's
  // fixed-duration animation, or a touch drag that crossed the commit
  // threshold — with which direction it was. This is where the parent
  // actually updates its index/post state, so the content swap and the
  // animation ending happen in the same instant, not before or after it.
  // Takes the direction explicitly (rather than the parent reading its
  // own pendingDirection state back) so the touch path, which never sets
  // that state at all, has something to report too.
  onSettled: (direction: 'next' | 'prev') => void;
}

export function SwipeStage({
  settledKey,
  current,
  next,
  prev,
  pendingDirection,
  onSettled,
}: SwipeStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ---- Wheel/programmatic path — unchanged from before: two-phase flip,
  // mount at the start position first, then move to the target position
  // on the next frame, so the browser has an actual before/after state to
  // interpolate between. ----
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!pendingDirection) {
      setSettled(false);
      return;
    }
    setSettled(false);
    const raf = requestAnimationFrame(() => setSettled(true));
    const timeout = setTimeout(() => onSettled(pendingDirection), SETTLE_DURATION_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDirection, settledKey]);

  // ---- Touch-drag path — the video actually tracks the finger as the
  // gesture happens (the point of this component existing separately
  // from VideoStage at all: it's the one place sitting above all three
  // of current/next/prev, so it's the one place that can slide them
  // together off a single live number). `dragPx` is that number: 0 at
  // rest, following the finger 1:1 while dragging (clamped to one stage
  // height either way), then CSS-transitioned the rest of the way to
  // either 0 (cancel) or a full ±stage-height (commit) once released. ----
  type DragPhase = 'idle' | 'dragging' | 'settling';
  const [dragPhase, setDragPhase] = useState<DragPhase>('idle');
  const [dragPx, setDragPx] = useState(0);
  const [dragDirection, setDragDirection] = useState<'next' | 'prev' | null>(null);
  const [dragAnimated, setDragAnimated] = useState(false);
  // Which post (settledKey) the current drag belongs to. See the render
  // section: once the parent swaps content, a drag tied to the OLD key is
  // treated as already finished in that very same render.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const settledKeyRef = useRef(settledKey);
  settledKeyRef.current = settledKey;

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastMoveRef = useRef<{ y: number; time: number } | null>(null);
  const activatedRef = useRef(false);
  const dragPxRef = useRef(0);
  const dragDirectionRef = useRef<'next' | 'prev' | null>(null);

  // 🛠️ FIX: next/prev/dragPhase used to sit in the listener-attaching
  // effect's own dependency array below. next/prev are JSX elements
  // rebuilt fresh on every render of page.tsx (renderShopVideoStage(...)
  // returns a brand-new element object each call, even when the
  // underlying post hasn't changed) — so that effect was tearing down
  // and re-attaching touchstart/touchmove/touchend on EVERY unrelated
  // re-render of the whole page, not just when a swipe actually
  // happened. Any such re-render landing mid-gesture (easy in an app
  // with video playback, badges, etc. all re-rendering independently)
  // meant the listeners could be rebuilt while a touch was still active
  // — exactly the kind of instability that silently eats a gesture's
  // first attempt. Mirrored into refs here, updated every render
  // (same safe "assign during render" pattern as the other *Ref values
  // below), so the handlers always read the LATEST value without the
  // effect itself needing to depend on them at all.
  const nextRef = useRef(next);
  nextRef.current = next;
  const prevRef = useRef(prev);
  prevRef.current = prev;
  const dragPhaseRef = useRef(dragPhase);
  dragPhaseRef.current = dragPhase;
  // The touch listeners below are attached once ([] deps), so anything they
  // call must be read through a ref or they keep using the callback from the
  // very first render. onSettled is exactly that: in discover it closes over
  // the *current* upcoming post and history, so a stale copy pushed the
  // first-ever "next" post again on every later swipe — the stage then held
  // two videos with the same key and swapped them with no animation, and
  // swiping back landed on posts that were not the ones just passed.
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  // Reset to neutral the instant the parent actually swaps content. This
  // always lands exactly where the commit animation already finished —
  // at full commit, the incoming post was already rendered at its
  // resting position (see the render math below) — so there's nothing to
  // visibly animate back from; dragPx just stops being driven by touch
  // for this post and starts over at rest for the next one.
  useEffect(() => {
    setDragPhase('idle');
    setDragPx(0);
    dragPxRef.current = 0;
    setDragDirection(null);
    dragDirectionRef.current = null;
    setDragAnimated(false);
    setDragKey(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: globalThis.TouchEvent) => {
      if (dragPhaseRef.current === 'settling') return; // ignore a new touch landing mid commit/cancel animation
      const t = e.touches[0];
      touchStartRef.current = { x: t.clientX, y: t.clientY, time: performance.now() };
      lastMoveRef.current = { y: t.clientY, time: performance.now() };
      activatedRef.current = false;
    };

    const onTouchMove = (e: globalThis.TouchEvent) => {
      const start = touchStartRef.current;
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;

      if (!activatedRef.current) {
        // Still below the activation threshold, or more horizontal than
        // vertical so far (likely a double-tap-zone tap, not a swipe) —
        // don't start moving anything yet, and don't block the browser's
        // own handling of it either, in case this never becomes a drag.
        if (Math.abs(dy) < ACTIVATION_PX || Math.abs(dy) < Math.abs(dx)) return;
        activatedRef.current = true;
        setDragKey(settledKeyRef.current);
        setDragPhase('dragging');
        setDragAnimated(false);
      }

      // Now that this is clearly a vertical drag, it owns the gesture —
      // stop the browser from also treating it as a native page
      // scroll/bounce at the same time (see globals.css's
      // overscroll-behavior-y for the other half of that same guard).
      e.preventDefault();

      const direction: 'next' | 'prev' = dy < 0 ? 'next' : 'prev';
      const hasTarget = direction === 'next' ? !!nextRef.current : !!prevRef.current;
      const height = el.clientHeight || 1;
      const offset = hasTarget
        ? Math.max(-height, Math.min(height, dy))
        : dy * RUBBER_BAND_FACTOR;

      lastMoveRef.current = { y: t.clientY, time: performance.now() };
      dragDirectionRef.current = direction;
      setDragDirection(direction);
      dragPxRef.current = offset;
      setDragPx(offset);
    };

    const onTouchEnd = () => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start || !activatedRef.current) {
        // Never crossed the activation threshold — a tap or a
        // mostly-horizontal gesture, not a drag. Nothing was ever
        // visibly moved, so there's nothing to settle or spring back.
        setDragPhase('idle');
        return;
      }
      activatedRef.current = false;

      const height = el.clientHeight || 1;
      const last = lastMoveRef.current;
      const elapsedMs = last ? Math.max(1, last.time - start.time) : 1;
      const velocity = last ? (last.y - start.y) / elapsedMs : 0; // px/ms, signed same as dy

      const direction = dragDirectionRef.current;
      const hasTarget =
        direction === 'next' ? !!nextRef.current : direction === 'prev' ? !!prevRef.current : false;
      const distanceFraction = Math.abs(dragPxRef.current) / height;
      const fastFlick = Math.abs(velocity) > COMMIT_VELOCITY_PX_PER_MS;
      const shouldCommit =
        hasTarget && !!direction && (distanceFraction > COMMIT_DISTANCE_FRACTION || fastFlick);

      setDragPhase('settling');
      setDragAnimated(true);

      if (shouldCommit && direction) {
        const target = direction === 'next' ? -height : height;
        dragPxRef.current = target;
        setDragPx(target);
        window.setTimeout(() => {
          onSettledRef.current(direction);
        }, DRAG_SETTLE_DURATION_MS);
      } else {
        dragPxRef.current = 0;
        setDragPx(0);
        window.setTimeout(() => {
          setDragPhase('idle');
          setDragAnimated(false);
          setDragDirection(null);
          dragDirectionRef.current = null;
        }, DRAG_SETTLE_DURATION_MS);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
    // 🛠️ FIX: was `[next, prev, dragPhase]` — see the comment by
    // nextRef/prevRef/dragPhaseRef above for why that caused the
    // listeners to be torn down and rebuilt on every unrelated render,
    // not just when a swipe happened. All three handlers now read the
    // refs instead of closing over these values directly, so this effect
    // genuinely only needs to run once, attaching stable listeners for
    // the lifetime of this component — the refs are what stay current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Rendering ----
  //
  // Two properties matter here, and both used to be wrong:
  //
  // 1. ONE tree shape in every mode (idle / dragging / wheel animation),
  //    so the video under a finger is never unmounted mid-gesture (that
  //    swallowed touchend and caused the "swipe twice" bug).
  //
  // 2. The incoming video must SURVIVE the swap. Each slide is wrapped in
  //    a <div> keyed by its post's own React key (the VideoStage key =
  //    post id). When a swipe commits and the parent promotes the
  //    incoming post to `current`, that wrapper keeps the same key, so
  //    React reuses it: the very same <video> element that was sliding in
  //    just keeps playing, in place. Before, `current` and `incoming`
  //    were two fixed positional slots, so the incoming video was thrown
  //    away and a brand-new one mounted for `current` — the video
  //    reloaded from 0 (a black flash, and the slide looked like a jump
  //    because what slid in was a not-yet-loaded copy).
  //
  // The swap render also has to be atomic. The reset of dragPx/dragPhase
  // only happens in the effect AFTER the render where settledKey changes,
  // so for one render the new `current` was still being offset by the old
  // drag distance (off-screen) while the NEXT-next video sat at 0 — a one
  // frame flash of the wrong video. `dragLive` ties a drag to the
  // settledKey it started on: the moment settledKey changes, the drag
  // counts as finished in that same render.
  const dragLive = dragPhase !== 'idle' && dragKey === settledKey;
  const wheelActive = !dragLive && !!pendingDirection;

  const dragDir = dragDirection ?? 'next';
  const incoming: React.ReactNode = dragLive
    ? dragDir === 'next'
      ? next
      : prev
    : wheelActive
      ? pendingDirection === 'next'
        ? next
        : prev
      : undefined;
  const incomingBase = dragLive
    ? dragDir === 'next'
      ? '100%'
      : '-100%'
    : pendingDirection === 'next'
      ? '100%'
      : '-100%';
  const wheelOutgoingTarget = pendingDirection === 'next' ? '-100%' : '100%';

  // Tailwind's JIT only picks up duration-NNN classes it can see literally
  // in source, so settle timing goes through inline style. `dragAnimated`
  // turns the transition on only for the settle (commit/cancel) phase —
  // while actively dragging, the transform must track the finger exactly.
  const dragTransition = dragAnimated
    ? { transitionProperty: 'transform', transitionDuration: `${DRAG_SETTLE_DURATION_MS}ms`, transitionTimingFunction: 'ease-out' }
    : {};
  const wheelTransition = {
    transitionProperty: 'transform',
    transitionDuration: `${SETTLE_DURATION_MS}ms`,
    transitionTimingFunction: 'ease-out',
  };

  // No transform at all while idle (rather than translateY(0)): a
  // transform on an ancestor makes it the containing block for any
  // position:fixed descendant, which VideoStage's overlays rely on NOT
  // happening at rest.
  const currentStyle = dragLive
    ? { transform: `translateY(${dragPx}px)`, ...dragTransition }
    : wheelActive
      ? { transform: `translateY(${settled ? wheelOutgoingTarget : '0%'})`, ...wheelTransition }
      : undefined;

  const incomingStyle = dragLive
    ? { transform: `translateY(calc(${incomingBase} + ${dragPx}px))`, ...dragTransition }
    : { transform: `translateY(${settled ? '0%' : incomingBase})`, ...wheelTransition };

  const keyOf = (node: React.ReactNode, fallback: string) =>
    isValidElement(node) && node.key != null ? String(node.key) : fallback;

  return (
    <div ref={containerRef} className="relative h-full w-full touch-none overflow-hidden">
      <div key={keyOf(current, settledKey)} className="absolute inset-0 flex" style={currentStyle}>
        {current}
      </div>
      {incoming && (
        <div key={keyOf(incoming, 'incoming')} className="absolute inset-0 flex" style={incomingStyle}>
          {incoming}
        </div>
      )}
    </div>
  );
}
