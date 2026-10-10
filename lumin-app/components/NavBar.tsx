import { Bell, ListVideo, Search, ShoppingCart, User } from 'lucide-react';

interface NavBarProps {
  onOpenProfile: () => void;
  onOpenWatchlist: () => void;
  onOpenNotifications: () => void;
  onOpenCart: () => void;
  onOpenSearch: () => void;
  unreadNotificationCount: number;
  cartCount: number;
}

export function NavBar({
  onOpenProfile,
  onOpenWatchlist,
  onOpenNotifications,
  onOpenCart,
  onOpenSearch,
  unreadNotificationCount,
  cartCount,
}: NavBarProps) {
  return (
    <>
      {/* Left corner: sits only above the category drawer's 220px column. */}
      <div className="fixed left-0 top-0 z-30 hidden h-16 w-[220px] items-center border-b border-r border-line bg-white px-[18px] lg:flex">
        <span className="text-xl font-bold tracking-wide">
          <span className="text-hot-pink">L</span>UMIN
        </span>
      </div>

      {/* Right corner: sits only above the product drawer's 280px column.
          Nothing renders above the video column in between — that's what
          lets the video reach the literal top edge of the screen. */}
      <div className="fixed right-0 top-0 z-30 hidden h-16 w-[280px] items-center justify-end gap-3 border-b border-l border-line bg-white px-[18px] lg:flex">
        <button
          onClick={onOpenWatchlist}
          aria-label="Watchlist"
          className="flex items-center gap-1.5 rounded-full bg-panel px-2.5 py-1 text-[12.5px] font-medium text-text-mute hover:text-text"
        >
          <ListVideo size={16} />
          Watchlist
        </button>
        <button onClick={onOpenSearch} aria-label="Search" className="text-text-mute hover:text-text">
          <Search size={18} />
        </button>
        <button onClick={onOpenNotifications} aria-label="Notifications" className="relative text-text-mute hover:text-text">
          <Bell size={18} />
          {unreadNotificationCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-hot-pink px-1 text-[10.5px] font-bold leading-none text-white">
              {unreadNotificationCount}
            </span>
          )}
        </button>
        <button onClick={onOpenProfile} aria-label="Profile" className="text-text-mute hover:text-text">
          <User size={18} />
        </button>
        <button onClick={onOpenCart} aria-label="Cart" className="relative text-text-mute hover:text-text">
          <ShoppingCart size={18} />
          {cartCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-hot-pink px-1 text-[10.5px] font-bold leading-none text-white">
              {cartCount}
            </span>
          )}
        </button>
      </div>
    </>
  );
}
