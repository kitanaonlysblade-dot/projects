'use client';

import { useSyncExternalStore } from 'react';

// "Lumin Lite" — the data-saving mode. A per-device choice (what matters is
// the connection this phone/laptop is on, not the account), so it lives in
// localStorage rather than on the user's profile, and every component reads
// the same value through useLuminLite() without needing it passed down.
//
//   Lite ON:  plays the smaller "lite" copy of each video when one exists
//             (falls back to the original otherwise), loads only what is
//             being watched (no pre-downloading of the next/previous video),
//             stops instead of looping a finished video, and pauses while
//             the tab is hidden.
//   Lite OFF: original quality, with a small look-ahead download of the
//             next video (skipped automatically on slow or data-saver
//             connections).
const STORAGE_KEY = 'lumin-lite';

let current = false;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    current = window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    current = false;
  }
}

export function setLuminLite(on: boolean) {
  load();
  current = on;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // Private mode / blocked storage: still works for this session.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => {
  load();
  return current;
};

export function useLuminLite(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

// True when the browser says the person wants less data used (Data Saver),
// or the connection is slow enough that a look-ahead download would only
// compete with the video being watched.
export function connectionIsConstrained(): boolean {
  if (typeof navigator === 'undefined') return false;
  const c = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!c) return false;
  return !!c.saveData || c.effectiveType === 'slow-2g' || c.effectiveType === '2g' || c.effectiveType === '3g';
}
