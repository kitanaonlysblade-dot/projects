'use client';

import { useSyncExternalStore } from 'react';
import { pillTwinAt } from './twins';
import type { Twin } from './types';

// The active video's playback position, shared so the shop pill (rendered
// elsewhere in the tree from the video) can follow it without prop-drilling
// a value that changes four times a second through the whole page.
let currentMs = 0;
const listeners = new Set<() => void>();

export function setPlaybackMs(ms: number) {
  if (ms === currentMs) return;
  currentMs = ms;
  listeners.forEach((l) => l());
}

export const getPlaybackMs = () => currentMs;

// Where the video being watched is, for ANY post (the pill only needs twinned ones).
// Plain variable on purpose: nothing re-renders from it; it is read once, when
// someone taps "what's this?", to pick the moment they just saw.
let watched: { postId: string; ms: number } | null = null;
export const noteWatched = (postId: string, ms: number) => {
  watched = { postId, ms };
};
export const getWatchedMs = (postId: string): number | null => (watched && watched.postId === postId ? watched.ms : null);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// Returns the twin the pill should show right now. The snapshot is a primitive
// (the twin's id), so components re-render only when the answer changes, not on
// every time update.
export function usePillTwin(twins: Twin[] | undefined): Twin | null {
  const id = useSyncExternalStore(
    subscribe,
    () => pillTwinAt(twins, currentMs)?.id ?? '',
    () => '',
  );
  return id ? (twins ?? []).find((t) => t.id === id) ?? null : null;
}
