'use client';

import { BrandLogo } from './BrandLogo';
import { X } from 'lucide-react';
import { CategoryPanelContent } from './CategoryPanelContent';
import type { Category, Deal } from '@/lib/types';

interface CategorySheetProps {
  categories: Category[];
  deals: Deal[];
  open: boolean;
  onClose: () => void;
  onSelectCategory: (category: Category) => void;
  onSelectDeal: (deal: Deal) => void;
  onSelectNewArrivals: () => void;
}

export function CategorySheet({
  categories,
  deals,
  open,
  onClose,
  onSelectCategory,
  onSelectDeal,
  onSelectNewArrivals,
}: CategorySheetProps) {
  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <div
        className={`fixed inset-y-0 left-0 z-50 w-[82%] max-w-[300px] overflow-y-auto bg-white px-[18px] pb-4 pt-4 shadow-xl transition-transform duration-300 lg:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo at the top (it carries the name itself, or the name sits beside it), close button on the right. */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <BrandLogo />
          <button
            onClick={onClose}
            aria-label="Close categories"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel"
          >
            <X size={17} className="text-text-mute" />
          </button>
        </div>
        <CategoryPanelContent
          categories={categories}
          deals={deals}
          onSelectCategory={(category) => {
            onClose();
            onSelectCategory(category);
          }}
          onSelectDeal={(deal) => {
            onClose();
            onSelectDeal(deal);
          }}
          onSelectNewArrivals={() => {
            onClose();
            onSelectNewArrivals();
          }}
        />
      </div>
    </>
  );
}
