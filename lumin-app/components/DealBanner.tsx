'use client';

import { Flame } from 'lucide-react';
import { useCarousel } from '@/hooks/useCarousel';
import type { Deal } from '@/lib/types';

interface DealBannerProps {
  // Passed in rather than imported from lib/data: these come from
  // GET /deals now, and an empty list is a normal state (nothing on
  // promotion) rather than something to paper over with mock deals.
  deals: Deal[];
  onSelectDeal: (deal: Deal) => void;
}

export function DealBanner({ deals, onSelectDeal }: DealBannerProps) {
  const { index, item } = useCarousel(deals, 3500);
  // Nothing on promotion — render nothing rather than an empty gradient
  // card. Reachable now that deals come from the API (previously the
  // static list was never empty, so `item` could never be undefined and
  // the dereference below was always safe).
  if (!item) return null;
  // Storewide deals (no categoryId) don't have anywhere to link to, so
  // they stay a plain, non-interactive banner rather than looking
  // clickable and doing nothing.
  const clickable = Boolean(item.categoryId);

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onSelectDeal(item) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onSelectDeal(item);
            }
          : undefined
      }
      className={`brand-gradient mb-4 overflow-hidden rounded-xl p-3 text-left ${clickable ? 'cursor-pointer' : ''}`}
    >
      <div className="mb-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/25">
        <Flame size={15} className="text-white" />
      </div>

      <p key={`text-${index}`} className="animate-fade-in text-sm font-bold text-white">
        {item.text}
      </p>
      <p key={`sub-${index}`} className="animate-fade-in mt-0.5 text-[11.5px] text-white/85">
        {item.sub}
      </p>

      <div className="mt-2 flex gap-1">
        {deals.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full bg-white/35 transition-all ${
              i === index ? 'w-3.5 bg-white' : 'w-1.5'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
