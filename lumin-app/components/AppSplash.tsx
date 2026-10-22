'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { BRAND } from '@/lib/brand';
import { TwinLoader } from './TwinLoader';

// A missing picture falls back to the app logo.
function fallbackToLogo(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (!img.src.endsWith(BRAND.logo)) img.src = BRAND.logo;
}

const MIN_MS = 900; // never a flash: the mark gets a moment even on a fast connection
const GIVE_UP_MS = 12000; // never stuck: leaves anyway, the screens show their own waiting state

// The opening screen. It is part of the server-rendered page, so it shows from the very first paint (before any
// script has run), then fades out once the first screen has its content (page.tsx calls markAppReady).
export function AppSplash({ lightSrc, darkSrc }: { lightSrc?: string; darkSrc?: string }) {
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const started = Date.now();
    let closed = false;
    const leave = () => {
      if (closed) return;
      closed = true;
      const wait = Math.max(0, MIN_MS - (Date.now() - started));
      setTimeout(() => setLeaving(true), wait);
    };
    // Only the home screen has a feed to wait for; any other page (a shared link, the scan page) is ready at once.
    if (pathname !== '/' || (window as unknown as { __luminReady?: boolean }).__luminReady) leave();
    window.addEventListener('lumin:ready', leave);
    const giveUp = setTimeout(leave, GIVE_UP_MS);
    return () => {
      window.removeEventListener('lumin:ready', leave);
      clearTimeout(giveUp);
    };
  }, [pathname]);

  if (gone) return null;
  return (
    <div
      role="status"
      aria-label="Loading"
      onAnimationEnd={() => leaving && setGone(true)}
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center bg-surface"
      style={leaving ? { animation: 'splashOut 0.45s ease forwards' } : undefined}
    >
      <div className="flex flex-col items-center gap-2">
        {/* The opening screen's own pictures (BRAND.splash / splashDark), already inside the page so they show on the first
            paint. Which one shows is decided by CSS from the page's theme class, so a dark phone never flashes the light one. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={lightSrc ?? BRAND.splash} alt={BRAND.name} onError={fallbackToLogo} className="h-20 w-20 rounded-2xl object-contain dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={darkSrc ?? BRAND.splashDark} alt={BRAND.name} onError={fallbackToLogo} className="hidden h-20 w-20 rounded-2xl object-contain dark:block" />
        {!BRAND.logoHasName && <p className="text-[20px] font-extrabold text-text">{BRAND.name}</p>}
      </div>
      <TwinLoader size={52} className="mt-10" />
    </div>
  );
}
