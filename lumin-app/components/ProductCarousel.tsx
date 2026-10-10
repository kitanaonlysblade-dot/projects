'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef } from 'react';
import type { Product } from '@/lib/types';

interface ProductCarouselProps {
  products: Product[];
  onSelectProduct: (product: Product) => void;
}

// Amazon's module carousels page by roughly one screenful at a time and
// snap each tile into place, rather than free-scrolling a loose strip —
// that's what makes them read as a grid instead of a pile of cards.
export function ProductCarousel({ products, onSelectProduct }: ProductCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const page = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' });
  };

  return (
    <div className="group relative">
      <div
        ref={scrollerRef}
        className="flex gap-3 overflow-x-auto scroll-smooth px-4 pb-1 lg:gap-4 lg:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {products.map((product) => (
          <button
            key={product.id}
            onClick={() => onSelectProduct(product)}
            style={{ scrollSnapAlign: 'start' }}
            className="w-[30%] shrink-0 text-left sm:w-[23%] lg:w-[17.5%] xl:w-[14.5%] 2xl:w-[12%]"
          >
            <span className="block aspect-square w-full rounded-lg bg-box" />
            <span className="mt-1.5 block line-clamp-2 text-[12.5px] leading-snug text-text lg:text-sm">
              {product.name}
            </span>
            <span className="block text-[13.5px] font-bold text-hot-pink lg:text-sm">
              ${product.price.toFixed(2)}
            </span>
          </button>
        ))}
      </div>

      {/* Paging arrows — desktop/tablet-with-pointer only, revealed on
          hover like Amazon's, since touch devices page by swipe instead. */}
      <button
        type="button"
        onClick={() => page(-1)}
        aria-label="Scroll left"
        className="absolute left-1 top-[38%] hidden -translate-y-1/2 rounded-full border border-line bg-panel p-2 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 md:flex"
      >
        <ChevronLeft size={18} className="text-text" />
      </button>
      <button
        type="button"
        onClick={() => page(1)}
        aria-label="Scroll right"
        className="absolute right-1 top-[38%] hidden -translate-y-1/2 rounded-full border border-line bg-panel p-2 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 md:flex"
      >
        <ChevronRight size={18} className="text-text" />
      </button>
    </div>
  );
}
