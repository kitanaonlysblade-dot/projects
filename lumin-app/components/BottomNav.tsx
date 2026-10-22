'use client';

import { Compass, Home, LayoutGrid, Scan, User } from 'lucide-react';

export type BottomTab = 'home' | 'discover' | 'categories' | 'profile';

interface BottomNavProps {
  active: BottomTab | null;
  onHome: () => void;
  onDiscover: () => void;
  onScan: () => void;
  onCategories: () => void;
  onProfile: () => void;
}

// The persistent bar under the content (mobile/tablet only - desktop already has the
// left rail): Home, Discover, a gradient Scan in the middle, Categories, Me.
//
// It is a real row BELOW the page (page.tsx lays the screen out as a column), not an
// overlay, so nothing - captions, product buttons, the video itself - sits under it.
// The bottom padding is the phone's home-indicator inset, which is why this relies on
// viewport-fit=cover (layout.tsx). Scan is the app's signature action, so it is the
// one that stands out: a gradient pill that sits flush in the bar (no rise, so it
// never covers captions).
export function BottomNav({ active, onHome, onDiscover, onScan, onCategories, onProfile }: BottomNavProps) {
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
        <span className="relative">
          <Icon size={22} strokeWidth={on ? 2.5 : 2} aria-hidden="true" />
        </span>
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
      <div className="flex flex-1 items-center justify-center">
        <button
          type="button"
          onClick={onScan}
          aria-label="Scan a video to find the product"
          className="brand-gradient flex h-[34px] w-[48px] items-center justify-center rounded-xl text-white shadow-[0_2px_10px_rgba(245,51,74,0.4)] transition-transform active:scale-95"
        >
          <Scan size={22} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>
      {tab('categories', 'Categories', LayoutGrid, onCategories)}
      {tab('profile', 'Me', User, onProfile)}
    </nav>
  );
}
