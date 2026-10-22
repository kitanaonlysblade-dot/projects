'use client';

import { useSyncExternalStore } from 'react';

// What the connection looks like right now, for the "slow / offline" pill and the opening screen.
//   offline : the browser says there is no network.
//   slow    : a request has been waiting for more than SLOW_MS (or the device reports a 2G-class link).
//   severe  : a real outage: offline, a request stuck for SEVERE_MS, or several network failures in a row.
//             Only this puts the pill on screen; ordinary slowness never does.
//   back    : the network just returned after a severe outage (shown for a couple of seconds).
// Requests report themselves through trackRequest (lib/api.ts); nothing here changes what a request does.
export interface NetState {
  offline: boolean;
  slow: boolean;
  severe: boolean;
  back: boolean;
}

const SLOW_MS = 4000;
const SEVERE_MS = 20000;
const SEVERE_FAILURES = 3;
const SERVER: NetState = { offline: false, slow: false, severe: false, back: false };
let state: NetState = SERVER;
const listeners = new Set<() => void>();
const slowIds = new Set<number>();
const stuckIds = new Set<number>();
let failures = 0;
let nextId = 1;
let wired = false;
let backTimer: ReturnType<typeof setTimeout> | undefined;

function set(patch: Partial<NetState>) {
  const next = { ...state, ...patch };
  next.severe = next.offline || stuckIds.size > 0 || failures >= SEVERE_FAILURES;
  if (state.severe && !next.severe && !next.offline) next.back = true;
  if (next.offline === state.offline && next.slow === state.slow && next.severe === state.severe && next.back === state.back) return;
  if (next.back && !state.back) {
    clearTimeout(backTimer);
    backTimer = setTimeout(() => set({ back: false }), 2200);
  }
  state = next;
  listeners.forEach((l) => l());
}

function slowLink(): boolean {
  const c = (navigator as unknown as { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
  return c?.effectiveType === 'slow-2g' || c?.effectiveType === '2g';
}

function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  set({ offline: !navigator.onLine, slow: slowLink() });
  window.addEventListener('offline', () => set({ offline: true, back: false }));
  window.addEventListener('online', () => {
    failures = 0;
    set({ offline: false });
  });
}

/** Wraps one request: if it is still waiting after SLOW_MS the connection counts as slow until it finishes. */
export function trackRequest<T>(p: Promise<T>): Promise<T> {
  if (typeof window === 'undefined') return p;
  wire();
  const id = nextId++;
  const timer = setTimeout(() => {
    slowIds.add(id);
    set({ slow: true });
  }, SLOW_MS);
  const stuck = setTimeout(() => {
    stuckIds.add(id);
    set({});
  }, SEVERE_MS);
  const done = () => {
    clearTimeout(timer);
    clearTimeout(stuck);
    slowIds.delete(id);
    stuckIds.delete(id);
    if (slowIds.size === 0) set({ slow: slowLink() });
    else set({});
  };
  p.then(
    () => {
      failures = 0;
      done();
    },
    (err) => {
      // Only "could not reach the server at all" counts, not an error answer like 404 or 500.
      if (err instanceof TypeError) failures += 1;
      done();
    },
  );
  return p;
}

function subscribe(l: () => void) {
  wire();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useNetState(): NetState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}

// The first screen is ready (the opening screen can leave).
export function markAppReady() {
  if (typeof window === 'undefined') return;
  (window as unknown as { __luminReady?: boolean }).__luminReady = true;
  window.dispatchEvent(new Event('lumin:ready'));
}
