'use client';

import { useEffect } from 'react';
import { listenForNativeTaps } from '@/lib/push';

// Registers the tiny service worker that lets Lumin appear in Android's share sheet once installed.
export function ServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    listenForNativeTaps(); // only does anything inside the native app
  }, []);
  return null;
}
