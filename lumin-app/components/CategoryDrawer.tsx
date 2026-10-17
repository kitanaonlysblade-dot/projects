import { CategoryPanelContent } from './CategoryPanelContent';
import type { Category, Deal } from '@/lib/types';

interface CategoryDrawerProps {
  categories: Category[];
  deals: Deal[];
  onOpenDiscover: () => void;
  onSelectCategory: (category: Category) => void;
  onSelectDeal: (deal: Deal) => void;
  onSelectNewArrivals: () => void;
  hideDiscoverPill?: boolean;
}

export function CategoryDrawer({
  categories,
  deals,
  onOpenDiscover,
  onSelectCategory,
  onSelectDeal,
  onSelectNewArrivals,
  hideDiscoverPill,
}: CategoryDrawerProps) {
  return (
    <aside className="hidden w-[220px] shrink-0 flex-col overflow-y-auto border-r border-line px-[18px] pb-4 pt-[76px] lg:flex">
      <CategoryPanelContent
        categories={categories}
        deals={deals}
        onOpenDiscover={onOpenDiscover}
        onSelectCategory={onSelectCategory}
        onSelectDeal={onSelectDeal}
        onSelectNewArrivals={onSelectNewArrivals}
        hideDiscoverPill={hideDiscoverPill}
      />
    </aside>
  );
}
