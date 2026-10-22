'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Product } from '@/lib/types';
import { apiProductToProduct } from '@/lib/adapters';
import { clickSponsoredTwin, getSponsoredTwins, getSponsoredTwinsForCart, getSponsoredTwinsForProduct, revealSponsoredTwin } from '@/lib/api';
import { rememberSponsored } from '@/lib/sponsoredAttribution';
import { onSale, savePercent, sumCents, unitPrice } from '@/lib/price';
import { ProductThumbnail } from './Thumbnails';

interface Props {
  postId?: string; // shown with a video (scan result), or...
  productId?: string; // ...with one product's detail screen ("buy this too")
  productName?: string; // detail screen: what the add-ons go with
  productIds?: string[]; // cart: the products in it
  variant?: 'video' | 'product' | 'cart';
  // Detail screen: the opened product itself, so "Add the whole set" can put it in the cart with the add-ons in one tap.
  anchor?: { product: Product; color: string; size: string; ready: boolean; onAdd: () => void };
  onSelectProduct: (product: Product) => void;
  onBuyNow: (product: Product, color: string, size: string) => void;
  onAddToCart: (product: Product, color: string, size: string) => void;
  className?: string;
}

type Ad = { id: string; product: Product; kind: string | null; lead: boolean; addedWith: number };

const KIND_LABEL: Record<string, string> = {
  top: 'Top', bottom: 'Bottoms', footwear: 'Shoes', outerwear: 'Jacket', dress: 'Dress', bag: 'Bag', accessory: 'Accessory',
  hair_care: 'Hair care', beard_care: 'Beard care', grooming_tool: 'Grooming', skincare: 'Skincare', makeup: 'Makeup',
  fragrance: 'Fragrance', audio: 'Audio', power: 'Power', wearable_tech: 'Wearable', phone_acc: 'Phone', desk: 'Desk',
  home_decor: 'Decor', home_textile: 'Home', kitchen: 'Kitchen',
};

// What the heading says depends on the category (fashion and beauty complete a look; gadgets, home and kitchen are bought
// together; in the cart it is simply a recommended add-on).
const LOOK_KINDS = new Set(['top', 'bottom', 'footwear', 'outerwear', 'dress', 'bag', 'accessory', 'hair_care', 'beard_care', 'grooming_tool', 'skincare', 'makeup', 'fragrance']);

const money = (n: number) => `$${n.toFixed(2)}`;
const cents = (a: { product: Product }[]) => sumCents(a.map((x) => x.product));

// The "Complete the look" kit (lumin-backend/app/sponsored.py picks it): a story-style strip of big pictures that go with the
// video's product. Built for no friction: a "+" on every tile adds it in one tap (when there is nothing to choose), "Add the
// whole look" adds everything that needs no choice, and the picked one opens below with a big picture and its sizes.
// Shown = counted as opened; picking a tile = a tap; add / buy = counted and credited to the card (pay per sale).
export function SponsoredTwinCard({ postId, productId, productIds, productName, variant = postId ? 'video' : productIds ? 'cart' : 'product', anchor, onSelectProduct, onBuyNow, onAddToCart, className = '' }: Props) {
  const [ads, setAds] = useState<Ad[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shot, setShot] = useState(0);
  const [size, setSize] = useState<Record<string, string>>({});
  const [color, setColor] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);
  const [nudge, setNudge] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const counted = useRef<Set<string>>(new Set());
  const tapped = useRef<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    setAds([]);
    setSelectedId(null);
    setOpen(false);
    setAdded({});
    setSize({});
    setColor({});
    counted.current = new Set();
    tapped.current = new Set();
    const load = postId ? getSponsoredTwins(postId) : productIds ? (productIds.length ? getSponsoredTwinsForCart(productIds) : Promise.resolve([])) : productId ? getSponsoredTwinsForProduct(productId) : Promise.resolve([]);
    load
      .then((rows) => {
        if (!live || !rows?.length) return;
        setAds(rows.filter((r) => (productIds ? (r.lead ?? true) : true)).map((r) => ({ id: r.id, kind: r.kind ?? null, lead: r.lead ?? true, addedWith: r.added_with ?? 0, product: apiProductToProduct(r.product) })));
        for (const r of rows) {
          if (counted.current.has(r.id)) continue;
          counted.current.add(r.id);
          revealSponsoredTwin(r.id).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [postId, productId, (productIds ?? []).join(',')]);

  const selected = ads.find((a) => a.id === selectedId) ?? ads[0];
  const chosenSize = (a: Ad) => size[a.id] ?? (a.product.sizes.length === 1 ? a.product.sizes[0] : '');
  const chosenColor = (a: Ad) => color[a.id] ?? a.product.colors[0] ?? '';
  const needsSize = (a: Ad) => a.product.sizes.length > 1 && !size[a.id];
  const canAdd = (a: Ad) => a.product.inStock && !added[a.id];

  // "The whole look" is the lead pick of each kind (the alternatives are choices, not extras).
  const leads = useMemo(() => ads.filter((a) => a.lead), [ads]);
  const total = useMemo(() => cents(leads), [leads]);
  const groups = useMemo(() => {
    const out: { kind: string; first: Ad; n: number }[] = [];
    for (const a of ads) {
      const k = a.kind ?? 'other';
      const g = out.find((x) => x.kind === k);
      if (g) g.n += 1;
      else out.push({ kind: k, first: a, n: 1 });
    }
    return out;
  }, [ads]);
  const addedCount = ads.filter((a) => added[a.id]).length;
  const addedTotal = cents(ads.filter((a) => added[a.id]));
  const ready = leads.filter((a) => canAdd(a) && !needsSize(a));
  const waiting = leads.filter((a) => canAdd(a) && needsSize(a));

  const looks = ads.some((a) => a.kind && LOOK_KINDS.has(a.kind));
  const heading = variant === 'cart' ? 'Recommended add-on' : looks ? 'Complete the look' : 'Frequently bought with';
  const subheading =
    variant === 'cart'
      ? 'Picked to go with what is in your cart'
      : variant === 'product'
        ? `Picked to go with ${productName ?? 'this'}`
        : 'Picked to go with this video';
  const whole = looks ? 'look' : 'set';

  if (ads.length === 0 || !selected) return null;

  const click = (id: string, action: 'tap' | 'cart' | 'buy') => clickSponsoredTwin(id, postId, action, postId ? undefined : productId, postId ? undefined : productIds).catch(() => {});
  const pick = (id: string, openSheet = true) => {
    setSelectedId(id);
    setShot(0);
    if (openSheet) setOpen(true); // the picture opens as a slide-up sheet over the video, not below the card
    if (!tapped.current.has(id)) {
      tapped.current.add(id);
      click(id, 'tap');
    }
  };
  const jumpTo = (a: Ad) => {
    pick(a.id, false);
    document.getElementById(`spons-${a.id}`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };
  const flash = (id: string) => {
    setNudge(id);
    setTimeout(() => setNudge((n) => (n === id ? null : n)), 1400);
  };
  const addOne = (a: Ad) => {
    if (!canAdd(a)) return;
    if (needsSize(a)) {
      pick(a.id); // a size is a real choice: open it and point at the sizes instead of guessing
      flash(a.id);
      return;
    }
    rememberSponsored(a.product.id, a.id);
    click(a.id, 'cart');
    onAddToCart(a.product, chosenColor(a), chosenSize(a));
    setAdded((m) => ({ ...m, [a.id]: true }));
  };
  const addAll = () => {
    ready.forEach(addOne);
    if (waiting[0]) {
      pick(waiting[0].id);
      flash(waiting[0].id);
    }
  };
  const buyNow = (a: Ad) => {
    if (!a.product.inStock) return;
    if (needsSize(a)) {
      flash(a.id);
      return;
    }
    rememberSponsored(a.product.id, a.id);
    click(a.id, 'buy');
    onBuyNow(a.product, chosenColor(a), chosenSize(a));
  };

  const p = selected.product;
  const gallery = p.images && p.images.length > 0 ? p.images : p.imageUrl ? [p.imageUrl] : [];
  const lowStock = p.inStock && typeof p.stockQuantity === 'number' && p.stockQuantity <= 5;
  const isAdded = !!added[selected.id];

  return (
    <div className={className}>
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[16px] font-extrabold leading-tight text-text">
            {heading}
          </p>
          <p className="mt-0.5 text-[12.5px] text-text-mute">{subheading}
          </p>
        </div>
        {addedCount > 0 && (
          <span className="shrink-0 rounded-full bg-panel px-2.5 py-1 text-[11.5px] font-bold text-text" aria-live="polite">
            {addedCount} in cart · {money(addedTotal)}
          </span>
        )}
      </div>

      {/* One chip per kind: tap to slide the strip to that group (the number is how many choices it has). */}
      {groups.length > 1 && (
        <div className="-mx-1 mb-1.5 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {groups.map((g) => (
            <button
              key={g.kind}
              type="button"
              onClick={() => jumpTo(g.first)}
              className={`shrink-0 rounded-full border px-3 py-1 text-[12px] font-semibold ${
                selected.kind === g.first.kind ? 'border-hot-pink bg-panel text-pink-ink' : 'border-line text-text-mute'
              }`}
            >
              {KIND_LABEL[g.kind] ?? 'More'}
              {g.n > 1 ? ` · ${g.n}` : ''}
            </button>
          ))}
        </div>
      )}

      {/* Story-style strip: slide sideways, tap a picture to open it, tap + to add it. */}
      <div
        ref={stripRef}
        role="listbox"
        aria-label={variant === 'product' ? `Add-ons that go with ${productName ?? 'this product'}` : variant === 'cart' ? 'Recommended add-ons for your cart' : 'Add-ons that go with this video'}
        className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3 pt-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {ads.map((a) => {
          const on = a.id === selected.id;
          const done = !!added[a.id];
          return (
            <div key={a.id} id={`spons-${a.id}`} className="relative shrink-0 snap-start">
              <button
                type="button"
                role="option"
                aria-selected={on}
                aria-label={`${a.product.name}, ${money(unitPrice(a.product))}`}
                onClick={() => pick(a.id)}
                className={`relative block h-[220px] w-[150px] overflow-hidden rounded-2xl bg-box text-left transition-transform active:scale-[0.97] lg:h-[240px] lg:w-[165px] ${
                  on ? 'ring-[1.5px] ring-hot-pink ring-offset-2 ring-offset-surface' : 'ring-1 ring-line'
                }`}
              >
                <ProductThumbnail product={a.product} className="absolute inset-0 h-full w-full object-cover" />
                {a.kind && KIND_LABEL[a.kind] && (
                  <span className="theme-light absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-text">
                    {KIND_LABEL[a.kind]}
                  </span>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-2.5 pb-2.5 pr-12 pt-9">
                  <span className="line-clamp-2 block text-[12.5px] font-semibold leading-tight text-white">{a.product.name}</span>
                  <span className="mt-0.5 flex items-baseline gap-1.5 text-white">
                    <span className="text-[16px] font-extrabold">{money(unitPrice(a.product))}</span>
                    {onSale(a.product) && <s className="text-[11px] font-semibold text-white/70">{money(a.product.price)}</s>}
                  </span>
                </span>
              </button>
              {a.product.inStock && (
                <button
                  type="button"
                  onClick={() => addOne(a)}
                  disabled={done}
                  aria-label={done ? `${a.product.name} added to cart` : `Add ${a.product.name} to cart`}
                  className={`absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full text-[20px] font-bold leading-none text-white shadow-[0_2px_8px_rgba(0,0,0,0.4)] transition-transform active:scale-90 ${
                    done ? 'bg-[#16a34a]' : 'brand-gradient'
                  }`}
                >
                  {done ? '✓' : '+'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* One tap for the whole kit. Items that need a size are left for the shopper to choose. */}
      {anchor && ready.length > 0 && (
        <button
          type="button"
          onClick={() => {
            if (!anchor.ready) {
              anchor.onAdd(); // it asks for the size of the main product first
              return;
            }
            anchor.onAdd();
            addAll();
          }}
          className="brand-gradient mb-3 flex w-full items-center justify-between rounded-xl px-3.5 py-3 text-left text-white"
        >
          <span>
            <span className="block text-[13.5px] font-bold">Add this + {ready.length} add-on{ready.length > 1 ? 's' : ''} to cart</span>
            <span className="block text-[11.5px] text-white/85">Wear it together: the full set in one tap</span>
          </span>
          <span className="shrink-0 text-[13px] font-bold">{money(cents([...ready, { product: anchor.product }]))}</span>
        </button>
      )}
      {!anchor && variant !== 'cart' && ready.length + waiting.length > 1 && (ready.length > 0 || waiting.length > 0) && (
        <button
          type="button"
          onClick={addAll}
          className="brand-gradient mb-3 flex w-full items-center justify-between rounded-xl px-3.5 py-3 text-left text-white"
        >
          <span>
            <span className="block text-[13.5px] font-bold">
              {ready.length > 0 ? `Add the whole ${whole} · ${ready.length} item${ready.length > 1 ? 's' : ''}` : 'Pick a size to add the rest'}
            </span>
            {waiting.length > 0 && (
              <span className="block text-[11.5px] text-white/85">
                {waiting.length} need{waiting.length > 1 ? '' : 's'} a size first
              </span>
            )}
          </span>
          {ready.length > 0 && (
            <span className="shrink-0 text-[13px] font-bold">
              {money(cents(ready))}
            </span>
          )}
        </button>
      )}

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-end justify-center" role="dialog" aria-modal="true" aria-label={p.name}>
            {/* Tap anywhere outside the sheet to close it, like the comments. */}
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 cursor-default bg-black/55" style={{ animation: 'sheetFade 180ms ease-out' }} />
            <div
              className="relative max-h-[88vh] w-full max-w-[560px] overflow-y-auto overscroll-contain rounded-t-3xl bg-surface shadow-[0_-8px_30px_rgba(0,0,0,0.35)]"
              style={{ animation: 'sheetUp 260ms cubic-bezier(0.22,1,0.36,1)' }}
            >
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="sticky top-0 z-10 flex w-full justify-center bg-surface pb-2 pt-3">
                <span className="h-1.5 w-11 rounded-full bg-line" />
              </button>
      <div className="px-4 pb-5 pt-1">
        <button
          type="button"
          onClick={() => {
            click(selected.id, 'tap');
            setOpen(false);
            onSelectProduct(p);
          }}
          aria-label={`View full details for ${p.name}`}
          className="relative mx-auto block aspect-[4/5] w-full max-w-[440px] overflow-hidden rounded-xl bg-box"
        >
          <ProductThumbnail product={gallery.length > 0 ? { images: [gallery[Math.min(shot, gallery.length - 1)]] } : p} />
          <span className="theme-light absolute bottom-2.5 left-2.5 rounded-full bg-white/95 px-3 py-1 text-[18px] font-extrabold text-text shadow">
            {money(unitPrice(p))}
          </span>
          {onSale(p) && (
            <span className="absolute left-2.5 top-2.5 rounded-full bg-sale px-2.5 py-1 text-[11px] font-bold text-white">-{savePercent(p)}%</span>
          )}
          <span className="absolute bottom-2.5 right-2.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white">Details</span>
        </button>
        {gallery.length > 1 && (
          <div className="mx-auto mt-2 flex w-full max-w-[440px] gap-2 overflow-x-auto pb-1">
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
        <p className="mt-2.5 text-[13.5px] font-bold leading-snug text-text">{p.name}</p>
        {!p.inStock ? (
          <p className="mt-1 text-[11.5px] font-bold text-text-mute">Out of stock</p>
        ) : (
          lowStock && <p className="mt-1 text-[11.5px] font-bold text-pink-ink">Only {p.stockQuantity} left</p>
        )}

        {p.colors.length > 1 && (
          <div className="mt-2.5 flex gap-2" role="group" aria-label="Colour">
            {p.colors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor((m) => ({ ...m, [selected.id]: c }))}
                aria-label={`Colour ${c}`}
                aria-pressed={chosenColor(selected) === c}
                className={`h-[22px] w-[22px] rounded-full border-2 ${chosenColor(selected) === c ? 'border-hot-pink' : 'border-line'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        )}
        {p.sizes.length > 0 && (
          <div
            className={`mt-2.5 flex flex-wrap gap-1.5 rounded-lg ${nudge === selected.id ? 'animate-pulse ring-[1.5px] ring-hot-pink ring-offset-2 ring-offset-surface' : ''}`}
            role="group"
            aria-label="Size"
          >
            {p.sizes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize((m) => ({ ...m, [selected.id]: s }))}
                aria-pressed={chosenSize(selected) === s}
                className={`min-w-[40px] rounded-md border px-2.5 py-1.5 text-[12px] ${
                  chosenSize(selected) === s ? 'border-hot-pink font-bold text-pink-ink' : 'border-line text-text-mute'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {needsSize(selected) && <p className="mt-1.5 text-[11.5px] text-text-mute">Pick a size to add it</p>}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => addOne(selected)}
            disabled={!p.inStock || isAdded}
            className={`flex-[1.4] rounded-lg py-2.5 text-center text-[13px] font-bold text-white ${
              isAdded ? 'bg-[#16a34a]' : 'brand-gradient'
            } ${!p.inStock ? 'opacity-40' : ''}`}
          >
            {!p.inStock ? 'Out of stock' : isAdded ? 'Added to cart ✓' : `Add to cart · ${money(unitPrice(p))}`}
          </button>
          {variant !== 'cart' && (
          <button
            type="button"
            onClick={() => buyNow(selected)}
            disabled={!p.inStock}
            className={`flex-1 rounded-lg bg-panel py-2.5 text-center text-[13px] font-semibold text-text ${!p.inStock ? 'opacity-40' : ''}`}
          >
            Buy now
          </button>
          )}
        </div>
      </div>
            </div>
          </div>,
          document.body,
        )}
      {variant !== 'cart' && leads.length > 1 && <p className="mt-2 text-center text-[11px] text-text-mute">The whole {whole}, {leads.length} items, {money(total)}</p>}
    </div>
  );
}
