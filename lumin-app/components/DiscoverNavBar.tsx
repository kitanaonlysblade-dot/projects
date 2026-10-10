import { ArrowLeft, Search } from 'lucide-react';

interface DiscoverNavBarProps {
  onBack: () => void;
  onOpenSearch: () => void;
}

// Desktop-only equivalent of what VideoStage's own overlay already shows
// on mobile/tablet for discover mode (back button + LUMIN label, search
// icon) — moved OFF the video card and into a fixed corner instead,
// mirroring NavBar's own left corner treatment for shop mode: fixed
// left-0 top-0, h-16, bordered, lg:flex only, and now the same 220px
// width as CategoryDrawer/NavBar's left corner, since discover carries
// that same column now (see page.tsx). Discover still has no NavBar
// (cart/watchlist/notifications/profile genuinely don't belong here —
// see VideoStage's own comment on that), so this stays deliberately
// smaller: identity + a way back, plus search — all on the left, TikTok-
// sidebar style, rather than split across both top corners the way shop
// splits NavBar's icons left (identity) vs right (actions). No right-
// corner box anymore: search used to live there, and nothing else on
// desktop discover ever did.
export function DiscoverNavBar({ onBack, onOpenSearch }: DiscoverNavBarProps) {
  return (
    <div className="fixed left-0 top-0 z-30 hidden h-16 w-[220px] items-center gap-3 border-b border-r border-line bg-white px-[18px] lg:flex">
      <button
        onClick={onBack}
        aria-label="Back to shop"
        className="flex items-center gap-1.5 text-text-mute hover:text-text"
      >
        <ArrowLeft size={18} />
      </button>
      <span className="text-xl font-bold tracking-wide">
        <span className="text-hot-pink">L</span>UMIN
      </span>
      <button onClick={onOpenSearch} aria-label="Search" className="ml-auto text-text-mute hover:text-text">
        <Search size={18} />
      </button>
    </div>
  );
}
