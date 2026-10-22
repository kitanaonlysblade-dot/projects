'use client';

import { WifiOff } from 'lucide-react';
import { useNetState } from '@/lib/netState';
import { TwinLoader } from './TwinLoader';

// A small pill at the top of the screen for a severe outage only (offline, or the server can't be reached at all),
// plus a short "Back online" once it recovers. Ordinary slowness never shows it. It never blocks taps.
export function NetworkStatus() {
  const { offline, severe, back } = useNetState();
  if (!severe && !back) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 z-[900] flex items-center gap-2 rounded-full bg-black/80 px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-lg backdrop-blur"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 10px)', animation: 'pillIn 0.25s ease both' }}
    >
      {offline ? (
        <>
          <WifiOff size={14} aria-hidden="true" /> Offline. Waiting for a connection
        </>
      ) : severe ? (
        <>
          <TwinLoader size={16} /> Can&apos;t reach the server. Retrying
        </>
      ) : (
        <>Back online</>
      )}
    </div>
  );
}
