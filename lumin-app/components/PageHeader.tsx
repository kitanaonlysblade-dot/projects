'use client';

import { ArrowLeft, Search, X } from 'lucide-react';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  onBack: () => void;
  backLabel?: string;
  rightSlot?: ReactNode;
  // Omitting these three leaves the header exactly as before (no search
  // row) — anything using PageHeader that doesn't need product search
  // isn't affected by adding this here.
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
}

// Back arrow, centered title, symmetric right side — the category
// landing/catalog pages don't need their own bespoke header. An empty
// right-side span keeps the title centered even when there's no rightSlot
// to fill it. The optional search row below it is a persistent input, not
// an icon that opens something — on a browse/grid screen, search is
// reached for constantly, not occasionally.
export function PageHeader({
  title,
  onBack,
  backLabel = 'Back',
  rightSlot,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search',
}: PageHeaderProps) {
  const showSearch = onSearchChange !== undefined;

  return (
    <div className="shrink-0 border-b border-line bg-white">
      <div className="flex h-14 items-center justify-between px-4 lg:h-16 lg:px-6">
        <button onClick={onBack} aria-label={backLabel} className="text-text-mute hover:text-text">
          <ArrowLeft size={19} />
        </button>
        <span className="truncate px-2 text-[15px] font-bold text-text">{title}</span>
        <span className="flex w-[19px] shrink-0 justify-end">{rightSlot}</span>
      </div>

      {showSearch && (
        <div className="px-4 pb-3 lg:px-6 lg:pb-4">
          <div className="relative">
            <Search
              size={17}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-mute"
            />
            <input
              type="text"
              value={searchValue}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-full border border-line bg-panel py-2 pl-9 pr-9 text-[13px] text-text placeholder:text-text-mute focus:border-hot-pink focus:bg-white focus:outline-none"
            />
            {searchValue && (
              <button
                onClick={() => onSearchChange?.('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-mute hover:text-text"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
