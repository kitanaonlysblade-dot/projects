'use client';

import { useState } from 'react';
import type { Product } from '@/lib/types';

import { PriceTag } from './PriceTag';
import { ProductThumbnail } from './Thumbnails';
interface ProductCardProps {
  product: Product;
  onSelectProduct: (product: Product) => void;
  onBuyNow: (product: Product, color: string, size: string) => void;
  onAddToCart: (product: Product, color: string, size: string) => void;
  // A big picture (the sponsored twin's display card): full width, tall, with the other photos as small thumbnails under it.
  large?: boolean;
}

export function ProductCard({ product, onSelectProduct, onBuyNow, onAddToCart, large = false }: ProductCardProps) {
  const gallery = product.images && product.images.length > 0 ? product.images : product.imageUrl ? [product.imageUrl] : [];
  const [shot, setShot] = useState(0);
  const [selectedColor, setSelectedColor] = useState(product.colors[0]);
  const [selectedSize, setSelectedSize] = useState(product.sizes[0]);
  // Transient confirmation on the button itself rather than a toast
  // component this app doesn't have anywhere else — reverts on its own
  // after a moment.
  const [justOrdered, setJustOrdered] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  // A number here only ever means "tracked" — undefined/null (untracked/
  // unlimited) never shows anything, same as this product having no
  // stock concept at all before this existed. 5 is an arbitrary but
  // common "starting to run low" threshold; nothing below actually
  // depends on this exact number, it's purely copy.
  const lowStock =
    product.inStock && typeof product.stockQuantity === 'number' && product.stockQuantity <= 5;

  const handleBuyNow = () => {
    if (!product.inStock) return;
    onBuyNow(product, selectedColor, selectedSize);
    setJustOrdered(true);
    setTimeout(() => setJustOrdered(false), 1600);
  };

  const handleAddToCart = () => {
    if (!product.inStock) return;
    onAddToCart(product, selectedColor, selectedSize);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1600);
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line p-3">
      <p className="text-[11.5px] text-text-mute">{large ? 'Tap the picture for full details' : 'Tap thumbnail to expand full details ↓'}</p>
      <button
        onClick={() => onSelectProduct(product)}
        aria-label={`View full details for ${product.name}`}
        className={
          large
            ? 'mx-auto block aspect-[4/5] w-full max-w-[440px] overflow-hidden rounded-xl bg-box'
            : 'mx-auto block aspect-square w-full max-w-[220px] overflow-hidden rounded-lg bg-box lg:w-[min(150px,18vh)]'
        }
      >
        <ProductThumbnail product={large && gallery.length > 0 ? { images: [gallery[Math.min(shot, gallery.length - 1)]] } : product} />
      </button>
      {large && gallery.length > 1 && (
        <div className="mx-auto flex w-full max-w-[440px] gap-2 overflow-x-auto pb-1">
          {gallery.map((src, i) => (
            <button
              key={src + i}
              type="button"
              onClick={() => setShot(i)}
              aria-label={`Show picture ${i + 1}`}
              aria-pressed={shot === i}
              className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-box ${shot === i ? 'ring-[1.5px] ring-hot-pink' : 'ring-1 ring-line'}`}
            >
              <ProductThumbnail product={{ images: [src] }} />
            </button>
          ))}
        </div>
      )}
      <button onClick={() => onSelectProduct(product)} className="text-left text-[13px] font-bold text-text">
        {product.name}
      </button>

      <p><PriceTag product={product} className="text-[20px]" /></p>

      {!product.inStock ? (
        <p className="text-[11.5px] font-bold text-text-mute">Out of stock</p>
      ) : (
        lowStock && <p className="text-[11.5px] font-bold text-pink-ink">Only {product.stockQuantity} left</p>
      )}

      <div className="flex gap-2">
        {product.colors.map((color) => (
          <button
            key={color}
            onClick={() => setSelectedColor(color)}
            aria-label={`Select color ${color}`}
            aria-pressed={selectedColor === color}
            className={`h-[18px] w-[18px] rounded-full border-2 ${
              selectedColor === color ? 'border-hot-pink' : 'border-line'
            }`}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>

      <div className="flex gap-1.5">
        {product.sizes.map((size) => (
          <button
            key={size}
            onClick={() => setSelectedSize(size)}
            aria-pressed={selectedSize === size}
            className={`rounded-md border px-2 py-1 text-[11.5px] ${
              selectedSize === size
                ? 'border-hot-pink font-bold text-pink-ink'
                : 'border-line text-text-mute'
            }`}
          >
            {size}
          </button>
        ))}
      </div>

      <div className="mt-0.5 flex gap-2">
        <button
          onClick={handleBuyNow}
          disabled={justOrdered || !product.inStock}
          className={`brand-gradient flex-1 rounded-md py-2 text-center text-[12.5px] font-bold text-white ${
            !product.inStock ? 'opacity-40' : 'disabled:opacity-70'
          }`}
        >
          {justOrdered ? 'Order placed ✓' : product.inStock ? 'Buy now' : 'Out of stock'}
        </button>
        <button
          onClick={handleAddToCart}
          disabled={justAdded || !product.inStock}
          className={`flex-1 rounded-md bg-panel py-2 text-center text-[12.5px] text-text ${
            !product.inStock ? 'opacity-40' : 'disabled:opacity-70'
          }`}
        >
          {justAdded ? 'Added ✓' : 'Add to cart'}
        </button>
      </div>
    </div>
  );
}
