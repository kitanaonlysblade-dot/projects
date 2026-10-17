'use client';

import { useMemo, useState } from 'react';
import type { Category, CategoryBanner, Product } from '@/lib/types';
import { PageHeader } from './PageHeader';
import { ProductTile } from './ProductTile';

interface CategoryCatalogProps {
  category: Category;
  banner: CategoryBanner;
  onBack: () => void;
  onSelectProduct: (product: Product) => void;
}

export function CategoryCatalog({ category, banner, onBack, onSelectProduct }: CategoryCatalogProps) {
  // Scoped to this banner's own product pool, not a site-wide search — the
  // person already narrowed down to this collection by tapping into it.
  const [query, setQuery] = useState('');
  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return banner.products;
    return banner.products.filter((p) => p.name.toLowerCase().includes(q));
  }, [banner.products, query]);

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader
        title={banner.title}
        onBack={onBack}
        backLabel={`Back to ${category.name}`}
        searchValue={query}
        onSearchChange={setQuery}
        searchPlaceholder={`Search in ${banner.title}`}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full px-4 py-4 lg:max-w-none lg:px-10 lg:py-6">
          <p className="text-[11.5px] font-bold uppercase tracking-wide text-hot-pink">{category.name}</p>
          {banner.subtitle && <p className="mb-4 mt-0.5 text-sm text-text-mute">{banner.subtitle}</p>}
          <p className="mb-3 text-[12.5px] text-text-mute">
            {filteredProducts.length} result{filteredProducts.length === 1 ? '' : 's'}
          </p>
          {filteredProducts.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-mute">
              {query ? `No products match "${query}".` : 'Nothing here yet — check back soon.'}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {filteredProducts.map((product) => (
                <ProductTile key={product.id} product={product} onSelectProduct={onSelectProduct} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
