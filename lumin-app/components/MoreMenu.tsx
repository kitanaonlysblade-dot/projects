'use client';

import { Bell, Flag, ListVideo, ScanSearch, Settings, ShoppingCart, Sparkles, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Notification } from '@/lib/types';
import { useCarousel } from '@/hooks/useCarousel';

interface MoreMenuProps {
  open: boolean;
  onClose: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenWatchlist: () => void;
  onOpenCart: () => void;
  onOpenNotifications: () => void;
  onOpenReport: () => void;
  // Discover only: find the product in this video (kept in the menu, not on screen).
  onVisualSearch?: () => void;
  // Shop only: the Wanted board.
  onOpenWanted?: () => void;
  notifications: Notification[];
  unreadNotificationCount: number;
}

// Mirrors what desktop shows persistently in the NavBar's right-corner icon
// cluster (Profile, Cart), plus a few extra actions that don't have a
// permanent home on mobile/tablet at all. Notifications gets its own row
// below, not a place in this list, since it needs its own layout (badge +
// ticker) that the rest of these plain label+icon rows don't.
const VISUAL_SEARCH_LABEL = 'Find the twin';
const WANTED_LABEL = 'Wanted';

const items: { Icon: LucideIcon; label: string }[] = [
  { Icon: User, label: 'Profile' },
  { Icon: Settings, label: 'Settings' },
  { Icon: Sparkles, label: WANTED_LABEL },
  { Icon: ScanSearch, label: VISUAL_SEARCH_LABEL },
  { Icon: Flag, label: 'Report this video' },
  { Icon: ListVideo, label: 'Watchlist' },
  { Icon: ShoppingCart, label: 'Cart' },
];

function NotificationRow({ notifications, unreadCount, onClick }: { notifications: Notification[]; unreadCount: number; onClick: () => void }) {
  const { item } = useCarousel(notifications, 3000);

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 border-b border-line py-3.5 text-left"
    >
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel">
        <Bell size={17} className="text-text" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-hot-pink px-1 text-[10.5px] font-bold leading-none text-white">
            {unreadCount}
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-text">Notifications</span>
        {/* overflow-hidden on the wrapper clips each incoming line to a
            single row so the slide-up motion doesn't cause a height jump;
            truncate on the line itself handles the ellipsis cutoff. */}
        <span className="block h-4 overflow-hidden">
          {item && (
            <span
              key={item.id}
              className="animate-slide-up block max-w-full truncate text-[12.5px] text-text-mute"
            >
              {item.body}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export function MoreMenu({
  open,
  onClose,
  onOpenProfile,
  onOpenSettings,
  onOpenWatchlist,
  onOpenCart,
  onOpenNotifications,
  onOpenReport,
  onVisualSearch,
  onOpenWanted,
  notifications,
  unreadNotificationCount,
}: MoreMenuProps) {
  const handlers: Record<string, () => void> = {
    Profile: onOpenProfile,
    Settings: onOpenSettings,
    'Report this video': onOpenReport,
    [VISUAL_SEARCH_LABEL]: () => onVisualSearch?.(),
    [WANTED_LABEL]: () => onOpenWanted?.(),
    Watchlist: onOpenWatchlist,
    Cart: onOpenCart,
  };

  return (
    <>
      {/* Backdrop — tap anywhere outside the sheet to dismiss it. */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <div
        className={`fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-white pb-6 pt-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.15)] transition-transform duration-300 lg:hidden ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <button
          onClick={onClose}
          aria-label="Close menu"
          className="mx-auto mb-2 flex w-full flex-col items-center gap-2 py-2"
        >
          <span className="h-1 w-10 rounded-full bg-box" />
        </button>

        <div className="flex flex-col px-[18px]">
          <NotificationRow
            notifications={notifications}
            unreadCount={unreadNotificationCount}
            onClick={() => {
              onClose();
              onOpenNotifications();
            }}
          />
          {items
            .filter(({ label }) => (label !== VISUAL_SEARCH_LABEL || onVisualSearch) && (label !== WANTED_LABEL || onOpenWanted))
            .map(({ Icon, label }) => (
            <button
              key={label}
              onClick={() => {
                onClose();
                handlers[label]?.();
              }}
              className="flex items-center gap-3 border-b border-line py-3.5 text-left last:border-b-0"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel">
                <Icon size={17} className="text-text" />
              </span>
              <span className="text-[13px] font-medium text-text">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
