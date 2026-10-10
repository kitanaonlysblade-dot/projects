'use client';

import { ClipboardList, Compass, Home, LayoutGrid, ScanSearch } from 'lucide-react';
import { TWIN_ENABLED } from '@/lib/features';

export type BottomTab = 'home' | 'discover' | 'wanted' | 'categories';

interface BottomNavProps {
  active: BottomTab | null;
  onHome: () => void;
  onDiscover: () => void;
  onScan: () => void;
  onWanted: () => void;
  onCategories: () => void;
}

// The persistent bar under the content (mobile/tablet only - desktop already has the
// left rail): Home, Discover, a gradient Scan in the middle, Wanted, Categories.
//
// It is a real row BELOW the page (page.tsx lays the screen out as a column), not an
// overlay, so nothing - captions, product buttons, the video itself - sits under it.
// The bottom padding is the phone's home-indicator inset, which is why this relies on
// viewport-fit=cover (layout.tsx). Scan is the app's signature action, so it is the
// one that stands out: a gradient pill that sits flush in the bar (no rise, so it
// never covers captions).
export function BottomNav({ active, onHome, onDiscover, onScan, onWanted, onCategories }: BottomNavProps) {
  const tab = (id: BottomTab, label: string, Icon: typeof Home, onClick: () => void) => {
    const on = active === id;
    return (
      <button
        key={id}
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={on ? 'page' : undefined}
        className={`flex flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-[10.5px] font-semibold transition-colors ${
          on ? 'text-white' : 'text-white/55 active:text-white'
        }`}
      >
        <Icon size={22} strokeWidth={on ? 2.5 : 2} aria-hidden="true" />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <nav
      aria-label="Main"
      data-bottom-nav
      className="relative z-[25] flex shrink-0 items-stretch border-t border-white/10 bg-ink px-1 pb-[env(safe-area-inset-bottom)] lg:hidden"
      style={{ height: 'var(--nav-h)' }}
    >
      {tab('home', 'Home', Home, onHome)}
      {tab('discover', 'Discover', Compass, onDiscover)}
      {/* Scan and Wanted are the twin discovery layer: hidden while it is switched off
          (lib/features.ts), leaving Home, Discover and Categories. */}
      {TWIN_ENABLED && (
      <div className="flex flex-1 items-center justify-center">
        <button
          type="button"
          onClick={onScan}
          aria-label="Scan to find the twin"
          className="brand-gradient flex h-[34px] w-[48px] items-center justify-center rounded-xl text-white shadow-[0_2px_10px_rgba(255,45,111,0.4)] transition-transform active:scale-95"
        >
          <ScanSearch size={22} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>
      )}
      {TWIN_ENABLED && tab('wanted', 'Wanted', ClipboardList, onWanted)}
      {tab('categories', 'Categories', LayoutGrid, onCategories)}
    </nav>
  );
}
