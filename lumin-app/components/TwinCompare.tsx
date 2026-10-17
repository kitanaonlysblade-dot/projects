'use client';

import { useState } from 'react';
import { ArrowLeft, Check, Flag, ShieldCheck } from 'lucide-react';
import type { ApiTwinOption, ApiWantedDetail } from '@/lib/api';
import { apiProductToProduct } from '@/lib/adapters';
import { splitTwins, type TwinSort } from '@/lib/wanted';
import type { Product } from '@/lib/types';
import { MatchTag, ProductThumb, Tag, money } from './TwinBits';

const SORTS: { id: TwinSort; label: string }[] = [
  { id: 'best', label: 'Best match' },
  { id: 'price', label: 'Lowest price' },
  { id: 'confirmed', label: 'Confirmed' },
];

// "6 twinned this moment": every product sellers have twinned to a wanted moment, so a
// shopper can compare prices and matches and go straight to the one they want.
//
// Honesty rules the labels follow:
//  * "Official twin" is only ever the video's own poster's product - the one party who
//    knows what is in their video - and is called the exact item.
//  * Everything else is only called "Similar" when an official twin exists to compare it
//    with; without one nobody can say what the exact item is.
//  * "Offered" means a seller added it and nobody has confirmed it; "Confirmed" means
//    shoppers bought and kept it (or the video's poster approved it).
export function TwinCompare({
  detail,
  options,
  hasOfficial,
  onBack,
  onOpenProduct,
  onReport,
  onWithdraw,
}: {
  detail: ApiWantedDetail;
  options: ApiTwinOption[];
  hasOfficial: boolean;
  onBack: () => void;
  onOpenProduct: (product: Product) => void;
  onReport: (option: ApiTwinOption) => void;
  onWithdraw: (option: ApiTwinOption) => void;
}) {
  const [sort, setSort] = useState<TwinSort>('best');
  const { official, others } = splitTwins(options, sort);

  const card = (o: ApiTwinOption, isOfficial: boolean) => (
    <li
      key={o.product.id}
      className={`rounded-2xl border bg-white p-3 ${isOfficial ? 'border-hot-pink bg-hot-pink/5' : 'border-line'}`}
    >
      <div className="flex gap-3">
        <button onClick={() => onOpenProduct(apiProductToProduct(o.product))} className="flex min-w-0 flex-1 gap-3 text-left">
          <ProductThumb product={o.product} size={56} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-bold text-text">{o.product.name}</span>
            {o.seller_name && <span className="block truncate text-[12.5px] text-text-mute">{o.seller_name}</span>}
            <span className="mt-1 flex flex-wrap items-center gap-1">
              {isOfficial && <Tag tone="green">Exact item</Tag>}
              {o.kind === 'confirmed' && (
                <Tag tone="green">
                  <Check size={10} strokeWidth={3} aria-hidden="true" />
                  {o.kept > 0 ? `Confirmed · ${o.kept} kept` : 'Confirmed'}
                </Tag>
              )}
              {o.kind === 'offered' && <Tag tone="gray">Offered</Tag>}
              {!isOfficial && <MatchTag match={o.match} />}
              {o.similar && <Tag tone="blue">Similar</Tag>}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 flex-col items-end justify-between">
          <span className="text-[15px] font-bold text-text">{money(o.product.price)}</span>
          <button
            onClick={() => onOpenProduct(apiProductToProduct(o.product))}
            className="brand-gradient rounded-full px-4 py-1.5 text-[12.5px] font-bold text-white"
          >
            Buy
          </button>
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        {o.mine ? (
          <button onClick={() => onWithdraw(o)} className="text-[11.5px] font-semibold text-text-mute underline">
            Take my twin back
          </button>
        ) : (
          <button
            onClick={() => onReport(o)}
            aria-label={`Report ${o.product.name}`}
            className="flex items-center gap-1 text-[11.5px] font-semibold text-text-mute"
          >
            <Flag size={11} aria-hidden="true" />
            Report
          </button>
        )}
      </div>
    </li>
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-panel">
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-white px-4 py-4">
        <button onClick={onBack} aria-label="Back" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line">
          <ArrowLeft size={18} className="text-text" />
        </button>
        <h1 className="min-w-0 truncate text-[18px] font-extrabold text-text">
          {options.length} twinned this moment
        </h1>
      </div>

      <div className="flex shrink-0 gap-2 overflow-x-auto bg-white px-4 pb-3 pt-3" role="tablist" aria-label="Sort twins">
        {SORTS.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={sort === s.id}
            onClick={() => setSort(s.id)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${
              sort === s.id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-text'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="space-y-3 px-4 pb-10 pt-3">
        {options.length === 0 && (
          <p className="py-12 text-center text-[13px] text-text-mute">
            No twins yet. When a seller twins a product to this moment, it shows up here.
          </p>
        )}

        {official.length > 0 && (
          <section aria-label="Official twin">
            <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold text-text">
              <ShieldCheck size={14} className="text-hot-pink" aria-hidden="true" />
              Official twin{detail.creator_name ? ` · ${detail.creator_name}` : ''}
            </p>
            <ul className="space-y-2">{official.map((o) => card(o, true))}</ul>
          </section>
        )}

        {others.length > 0 && (
          <section aria-label={hasOfficial ? 'Similar looks' : 'Twins'}>
            {hasOfficial && (
              <p className="mb-1.5 text-[14px] font-bold text-text">
                Similar looks <span className="ml-1 text-[12px] font-normal text-text-mute">not the exact item</span>
              </p>
            )}
            <ul className="space-y-2">{others.map((o) => card(o, false))}</ul>
          </section>
        )}

        {hasOfficial && (
          <p className="pt-1 text-[12px] leading-relaxed text-text-mute">
            Looks that aren&apos;t the exact item are always labelled &ldquo;Similar&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}
