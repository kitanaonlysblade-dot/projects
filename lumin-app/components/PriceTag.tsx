import type { Product } from '@/lib/types';
import { onSale, savePercent, unitPrice } from '@/lib/price';

// The price: extra bold in the price colour (black on light, white on dark). On sale it also shows the list price struck through
// in red with the percent off, so the saving is obvious at a glance.
export function PriceTag({
  product,
  className = 'text-[17px]',
  showPercent = true,
}: {
  product: Pick<Product, 'price'> & { salePrice?: number };
  className?: string;
  showPercent?: boolean;
}) {
  const sale = onSale(product);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <span className={`font-extrabold leading-tight tracking-tight text-price tabular-nums ${className}`}>${unitPrice(product).toFixed(2)}</span>
      {sale && (
        <>
          <s className="font-semibold text-sale tabular-nums" style={{ fontSize: '0.8em' }}>
            ${product.price.toFixed(2)}
          </s>
          {showPercent && (
            <span className="rounded bg-sale/10 px-1.5 py-px text-[11px] font-bold text-sale">-{savePercent(product)}%</span>
          )}
        </>
      )}
    </span>
  );
}
