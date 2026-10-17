'use client';

import { useMemo, useState } from 'react';
import type { Category, CategoryBanner, Product } from '@/lib/types';
import { PageHeader } from './PageHeader';
import { ProductCarousel } from './ProductCarousel';

function BannerSection({
  category,
  banner,
  products,
  onSelectBanner,
}: {
  category: Category;
  banner: CategoryBanner;
  products: Product[];
  onSelectBanner: (banner: CategoryBanner) => void;
}) {
  return (
    <section className="mb-5 rounded-xl2 border border-line bg-white py-4 lg:mb-6 lg:py-5">
      {/* Plain typographic header — title + a "See more" link, the way an
          Amazon module reads, instead of a colored promo pill glued onto
          the carousel. */}
      <div className="mb-3 flex items-start justify-between gap-3 px-4 lg:px-6">
        <div className="min-w-0">
          <p className="text-[11.5px] font-bold uppercase tracking-wide text-text-mute">{category.name}</p>
          <h3 className="mt-0.5 text-[15px] font-bold text-text lg:text-lg">{banner.title}</h3>
          {banner.subtitle && (
            <p className="mt-0.5 text-[12.5px] text-text-mute lg:text-sm">{banner.subtitle}</p>
          )}
        </div>
        {/* Always navigates with the full, unfiltered banner — search only
            narrows what's shown on this page, never what "See more" opens. */}
        <button
          onClick={() => onSelectBanner(banner)}
          className="shrink-0 whitespace-nowrap text-[12.5px] font-bold text-hot-pink hover:underline lg:text-sm"
        >
          See more
        </button>
      </div>

      {/* Every tile also opens the catalog — same as clicking a product
          tile in one of Amazon's landing carousels. */}
      <ProductCarousel products={products} onSelectProduct={() => onSelectBanner(banner)} />
    </section>
  );
}

interface CategoryLandingProps {
  category: Category;
  banners: CategoryBanner[];
  onSelectBanner: (banner: CategoryBanner) => void;
  onBack: () => void;
}

export function CategoryLanding({ category, banners, onSelectBanner, onBack }: CategoryLandingProps) {
  const [query, setQuery] = useState('');

  const totalProductCount = useMemo(
    () => banners.reduce((sum, b) => sum + b.products.length, 0),
    [banners],
  );

  // Search narrows which products show inside each banner's carousel —
  // and hides a banner entirely once none of its products match — but
  // never touches the banner objects themselves, so "See more" still
  // opens the full collection even mid-search.
  const visibleBanners = useMemo(() => {
    const q = query.trim().toLowerCase();
    return banners
      .map((banner) => ({
        banner,
        products: q ? banner.products.filter((p) => p.name.toLowerCase().includes(q)) : banner.products,
      }))
      .filter(({ products }) => products.length > 0);
  }, [banners, query]);

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader
        title={category.name}
        onBack={onBack}
        backLabel="Back to shop"
        searchValue={query}
        onSearchChange={setQuery}
        searchPlaceholder={`Search in ${category.name}`}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full px-3 py-4 lg:max-w-none lg:px-10 lg:py-6">
          {/* Compact category identity strip — not a marketing hero. This
              is a page people return to routinely to get to products, so
              it stays a couple of lines, not a full-bleed banner image. */}
          {!query && (
            <div className="mb-5 rounded-xl2 border border-line bg-gradient-to-br from-hot-pink/5 to-hot-orange/5 p-4 lg:mb-6 lg:p-5">
              <p className="text-[11.5px] font-bold uppercase tracking-wide text-hot-pink">Category</p>
              <h2 className="mt-0.5 text-lg font-bold text-text lg:text-xl">{category.name}</h2>
              <p className="mt-1 text-[12.5px] text-text-mute lg:text-sm">
                {totalProductCount} product{totalProductCount === 1 ? '' : 's'} across {banners.length}{' '}
                collection{banners.length === 1 ? '' : 's'}
              </p>
            </div>
          )}

          {visibleBanners.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-mute">
              {query ? `No products match "${query}".` : 'Nothing here yet — check back soon.'}
            </p>
          ) : (
            visibleBanners.map(({ banner, products }) => (
              <BannerSection
                key={banner.id}
                category={category}
                banner={banner}
                products={products}
                onSelectBanner={onSelectBanner}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
