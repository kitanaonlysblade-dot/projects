import { ChevronRight, Compass, Sparkles } from 'lucide-react';
import type { Category, Deal } from '@/lib/types';
import { DealBanner } from './DealBanner';

interface CategoryPanelContentProps {
  categories: Category[];
  deals: Deal[];
  onOpenDiscover?: () => void;
  onSelectCategory?: (category: Category) => void;
  onSelectDeal: (deal: Deal) => void;
  onSelectNewArrivals: () => void;
  // True when this panel is already showing inside discover — the "Discover"
  // pill is a shortcut into discover, which makes no sense to offer while
  // already there (there's a back arrow in the header for the reverse trip).
  // Same idea as the pill already being CSS-hidden below lg — just gated on
  // context instead of viewport, and New Arrivals fills the row alone here
  // the same way it does under that lg:hidden case.
  hideDiscoverPill?: boolean;
}

export function CategoryPanelContent({
  categories,
  deals,
  onOpenDiscover,
  onSelectCategory,
  onSelectDeal,
  onSelectNewArrivals,
  hideDiscoverPill,
}: CategoryPanelContentProps) {
  return (
    <>
      <div className="mb-4 flex gap-2">
        <button
          onClick={onSelectNewArrivals}
          className="brand-gradient flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2.5 text-[13px] font-bold text-white"
        >
          <Sparkles size={15} strokeWidth={2.25} aria-hidden="true" />
          New Arrivals
        </button>
        {!hideDiscoverPill && (
          <button
            onClick={onOpenDiscover}
            className="brand-gradient-outline hidden flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2.5 text-[13px] font-bold text-hot-pink lg:flex"
          >
            <Compass size={15} strokeWidth={2.25} aria-hidden="true" />
            Discover
          </button>
        )}
      </div>

      <h2 className="mb-1 text-[13px] font-bold">Explore Categories</h2>
      <p className="mb-3 text-[11.5px] font-bold tracking-wide text-hot-pink">Trending</p>

      <DealBanner deals={deals} onSelectDeal={onSelectDeal} />

      <ul>
        {categories.map((cat) => (
          <li key={cat.id} className="border-b border-line">
            <button
              onClick={() => onSelectCategory?.(cat)}
              className="flex w-full items-center gap-2.5 py-2 text-left"
            >
              <span className="h-8 w-8 shrink-0 rounded-md border border-hot-pink/30 bg-hot-pink/10" />
              <span className="flex-1 text-sm text-text">{cat.name}</span>
              <ChevronRight size={16} className="shrink-0 text-text-mute" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
