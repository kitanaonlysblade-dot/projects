'use client';

import type { Product } from '@/lib/types';
import { ProductThumbnail } from './Thumbnails';

// Browse-only now — no purchase actions and no color/size selection live
// here anymore. Tapping opens the full product detail screen, which is
// where all of that moved to; this tile's only job is "does this catch
// your eye." Below the sm breakpoint it lays out as a single row —
// thumbnail on the left, name/price on the right — one product per row;
// from sm up it switches to the stacked card used in the multi-column grid.
interface ProductTileProps {
  product: Product;
  onSelectProduct: (product: Product) => void;
}

export function ProductTile({ product, onSelectProduct }: ProductTileProps) {
  return (
    <button
      onClick={() => onSelectProduct(product)}
      className="flex flex-row gap-3 rounded-xl border border-line bg-white p-2.5 text-left sm:flex-col sm:gap-2 sm:p-3"
    >
      <span className="block h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-box sm:h-auto sm:w-full sm:aspect-square">
        <ProductThumbnail product={product} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 sm:flex-none sm:justify-start">
        <p className="line-clamp-2 text-[13.5px] leading-snug text-text sm:text-[12.5px] lg:text-sm">
          {product.name}
        </p>
        <p className="text-[14px] font-bold text-hot-pink sm:text-[13px] lg:text-sm">
          ${product.price.toFixed(2)}
        </p>
      </div>
    </button>
  );
}
