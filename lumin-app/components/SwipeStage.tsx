'use client';

import { useEffect, useRef, useState } from 'react';

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
// deliberate drag more than a fifth of the way across the stage, or a
// quick flick that doesn't need to cover much distance at all to clearly
// mean "next." Same two-signal approach Reels/TikTok-style feeds use
// rather than distance alone, which would make a fast flick feel like it
// needs to travel further than it should to register.
const COMMIT_DISTANCE_FRACTION = 0.2;
const COMMIT_VELOCITY_PX_PER_MS = 0.5;

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

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastMoveRef = useRef<{ y: number; time: number } | null>(null);
  const activatedRef = useRef(false);
  const dragPxRef = useRef(0);
  const dragDirectionRef = useRef<'next' | 'prev' | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: globalThis.TouchEvent) => {
      if (dragPhase === 'settling') return; // ignore a new touch landing mid commit/cancel animation
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
        setDragPhase('dragging');
        setDragAnimated(false);
      }

      // Now that this is clearly a vertical drag, it owns the gesture —
      // stop the browser from also treating it as a native page
      // scroll/bounce at the same time (see globals.css's
      // overscroll-behavior-y for the other half of that same guard).
      e.preventDefault();

      const direction: 'next' | 'prev' = dy < 0 ? 'next' : 'prev';
      const hasTarget = direction === 'next' ? !!next : !!prev;
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
      const hasTarget = direction === 'next' ? !!next : direction === 'prev' ? !!prev : false;
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
          onSettled(direction);
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
    // A gesture always starts and ends within one effect lifetime (it
    // can't span a next/prev identity change mid-touch — that only
    // happens between posts), so re-subscribing when they change is
    // fine; dragPhase is read fresh on every touchstart via the closure
    // over current state at listener-registration time, which this
    // dependency keeps current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, prev, dragPhase]);

  const isTouchActive = dragPhase !== 'idle';

  if (isTouchActive) {
    const direction = dragDirection ?? 'next';
    const incoming = direction === 'next' ? next : prev;
    const incomingBase = direction === 'next' ? '100%' : '-100%';
    // Tailwind's JIT compiler only picks up duration-NNN classes it can
    // see literally in source, not one built from a JS constant at
    // runtime — so the transition timing itself goes through inline
    // style (transitionDuration) instead of a dynamic class name, with
    // only the non-duration parts (`transition-transform ease-out`) as
    // static Tailwind classes. `dragAnimated` toggles the transition on
    // only for the settle (commit/cancel) phase — while actively
    // dragging, the transform has to apply with zero latency and track
    // the finger exactly, not ease toward it.
    const transitionStyle = dragAnimated
      ? { transitionProperty: 'transform', transitionDuration: `${DRAG_SETTLE_DURATION_MS}ms`, transitionTimingFunction: 'ease-out' }
      : {};
    return (
      <div ref={containerRef} className="relative h-full w-full touch-none overflow-hidden">
        <div className="absolute inset-0 flex" style={{ transform: `translateY(${dragPx}px)`, ...transitionStyle }}>
          {current}
        </div>
        {incoming && (
          <div
            className="absolute inset-0 flex"
            style={{ transform: `translateY(calc(${incomingBase} + ${dragPx}px))`, ...transitionStyle }}
          >
            {incoming}
          </div>
        )}
      </div>
    );
  }

  if (!pendingDirection) {
    return (
      <div ref={containerRef} className="relative flex h-full w-full touch-none overflow-hidden">
        {current}
      </div>
    );
  }

  const incoming = pendingDirection === 'next' ? next : prev;
  const outgoingTarget = pendingDirection === 'next' ? '-100%' : '100%';
  const incomingStart = pendingDirection === 'next' ? '100%' : '-100%';

  return (
    <div ref={containerRef} className="relative h-full w-full touch-none overflow-hidden">
      <div
        className="absolute inset-0 flex transition-transform duration-300 ease-out"
        style={{ transform: `translateY(${settled ? outgoingTarget : '0%'})` }}
      >
        {current}
      </div>
      <div
        className="absolute inset-0 flex transition-transform duration-300 ease-out"
        style={{ transform: `translateY(${settled ? '0%' : incomingStart})` }}
      >
        {incoming}
      </div>
    </div>
  );
}
