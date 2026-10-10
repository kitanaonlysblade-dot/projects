'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ChevronRight, ShoppingCart } from 'lucide-react';
import { FirstTimeHint } from './FirstTimeHint';
import { getMomentProducts } from '@/lib/api';
import { TWIN_ENABLED } from '@/lib/features';
import { apiProductToProduct } from '@/lib/adapters';
import { formatCount } from '@/lib/format';
import { usePillTwin } from '@/lib/playbackTime';
import type { Product, VideoPost } from '@/lib/types';
import { ProductCard } from './ProductCard';

import { ProductThumbnail } from './Thumbnails';
function DrawerContent({
  post,
  productActivity,
  onSelectProduct,
  onBuyNow,
  onAddToCart,
  onAskTwin,
}: {
  post: VideoPost;
  onAskTwin?: () => void;
  productActivity: Record<string, number>;
  onSelectProduct: (product: Product) => void;
  onBuyNow: (product: Product, color: string, size: string) => void;
  onAddToCart: (product: Product, color: string, size: string) => void;
}) {
  const products = post.products ?? [];
  // Global to the video, not any one product — sum of every featured
  // product's live activity count. Lives here, once, so switching between
  // products (via the thumbnail row or the size/color pickers below)
  // never changes this number.
  const totalCartCount = products.reduce((sum, p) => sum + (productActivity[p.id] ?? 0), 0);
  const bundlePrice = products.reduce((sum, p) => sum + p.price, 0);
  const [justBoughtLook, setJustBoughtLook] = useState(false);
  // Twins shoppers found for this video that the poster didn't tag: only the ones that have
  // earned trust come back from the server (several different shoppers who clipped the moment
  // and bought and kept it - see lumin-backend/app/moment_index.py). Quietly empty if the
  // request fails or there are none.
  const [spotted, setSpotted] = useState<Product[]>([]);
  useEffect(() => {
    let cancelled = false;
    setSpotted([]);
    if (!TWIN_ENABLED) return; // twin discovery layer switched off: nothing to ask the server
    getMomentProducts(post.id)
      .then((rows) => {
        if (cancelled) return;
        const tagged = new Set((post.products ?? []).map((p) => p.id));
        const seen = new Set<string>();
        const extra: Product[] = [];
        for (const r of rows) {
          if (r.source !== 'crowd' || tagged.has(r.product.id) || seen.has(r.product.id)) continue;
          seen.add(r.product.id);
          extra.push(apiProductToProduct(r.product));
        }
        setSpotted(extra);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);
  // Bundle buying is all-or-nothing — if even one featured product is
  // out of stock, the whole "buy the look" action is disabled rather
  // than silently skipping that one item. Someone can still buy every
  // in-stock item individually via its own ProductCard below.
  const someOutOfStock = products.some((p) => !p.inStock);

  // The thumbnail row doesn't pick a "selected" product — every product is
  // already listed in full below, always. Tapping a thumbnail just jumps
  // the scroll position to that product's card and gives it a brief pulse,
  // so it's a shortcut to something already there, not a second source of
  // truth for which product is "active."
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const jumpToProduct = (id: string) => {
    cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setHighlightedId(id);
    setTimeout(() => setHighlightedId((current) => (current === id ? null : current)), 1200);
  };

  // One tap, every featured product — each at its default color/size,
  // same defaults ProductCard itself starts on. This sits alongside
  // individual Buy now/Add to cart below, never instead of them: someone
  // who only wants one item can still just buy that one.
  const handleBuyLook = () => {
    if (someOutOfStock) return;
    products.forEach((p) => onBuyNow(p, p.colors[0], p.sizes[0]));
    setJustBoughtLook(true);
    setTimeout(() => setJustBoughtLook(false), 1600);
  };

  return (
    <>
      <p
        className="mb-2 inline-block w-fit border-b-2 border-transparent pb-1.5 text-sm font-bold"
        style={{ borderImage: 'linear-gradient(135deg, #FF2D6F, #FF6B35) 1' }}
      >
        Twins in this video
      </p>
      <p className="mb-3 flex items-center gap-1.5 text-[12.5px] text-text-mute">
        <ShoppingCart size={14} />
        {formatCount(totalCartCount)} bought &amp; in carts
      </p>
      <div className="mb-3 flex items-center gap-2">
        {products.slice(0, 3).map((p) => (
          <button
            key={p.id}
            onClick={() => jumpToProduct(p.id)}
            aria-label={`Jump to ${p.name}`}
            className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-box transition-transform active:scale-95"
          >
            <ProductThumbnail product={p} />
          </button>
        ))}
        {products.length > 3 && (
          <ChevronRight size={16} className="text-text-mute" />
        )}
      </div>

      {/* Only makes sense as a bundle once there's actually more than one
          thing to bundle. */}
      {products.length > 1 && (
        <button
          onClick={handleBuyLook}
          disabled={justBoughtLook || someOutOfStock}
          className={`brand-gradient mb-3 flex w-full items-center justify-between rounded-xl px-3.5 py-3 text-left text-white ${
            someOutOfStock ? 'opacity-40' : 'disabled:opacity-70'
          }`}
        >
          <span>
            <span className="block text-[13.5px] font-bold">
              {justBoughtLook
                ? 'Order placed ✓'
                : someOutOfStock
                  ? 'One or more items out of stock'
                  : `Buy the whole look — ${products.length} items`}
            </span>
            {!justBoughtLook && !someOutOfStock && (
              <span className="block text-[11.5px] text-white/80">
                One checkout for everything featured here
              </span>
            )}
          </span>
          {!justBoughtLook && !someOutOfStock && (
            <span className="shrink-0 text-[13px] font-bold">${bundlePrice.toFixed(2)}</span>
          )}
        </button>
      )}

      <div className="flex flex-col gap-3">
        {products.map((p) => (
          <div
            key={p.id}
            ref={(el) => {
              cardRefs.current[p.id] = el;
            }}
            className={`rounded-xl transition-shadow duration-300 ${
              highlightedId === p.id ? 'ring-2 ring-hot-pink ring-offset-2' : ''
            }`}
          >
            <ProductCard
              product={p}
              onSelectProduct={onSelectProduct}
              onBuyNow={onBuyNow}
              onAddToCart={onAddToCart}
            />
          </div>
        ))}
      </div>
      {spotted.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[12.5px] font-bold text-text">Twins spotted by shoppers</p>
          <div className="flex flex-col gap-3">
            {spotted.map((p) => (
              <ProductCard key={p.id} product={p} onSelectProduct={onSelectProduct} onBuyNow={onBuyNow} onAddToCart={onAddToCart} />
            ))}
          </div>
        </div>
      )}
      {onAskTwin && (
        <div className="mt-3">
          <FirstTimeHint id="twin-ask" emoji="👀" className="mb-2">
            Spotted something in the video that isn&apos;t listed? Clip the moment and describe it — we&apos;ll search the store for its twin, and tell you when one shows up.
          </FirstTimeHint>
          <button
            onClick={onAskTwin}
            className="flex w-full items-center justify-between rounded-xl border border-line bg-white px-3.5 py-3 text-left"
          >
            <span>
              <span className="block text-[13.5px] font-bold text-text">Seen something else?</span>
              <span className="block text-[11.5px] text-text-mute">Clip the moment and find its twin</span>
            </span>
            <ChevronRight size={16} className="text-text-mute" />
          </button>
        </div>
      )}
    </>
  );
}

// Distance (px) from the bottom of the screen to the floating "Shop this
// video" pill. Worst-case caption column (repost label ~26 + avatar row ~46
// + two-line caption ~39 + "See more" ~23 = ~134) + the caption bar's own
// 18px bottom padding + a 16px gap above it, rounded up.
const PILL_REST_BOTTOM_PX = 170;

interface ProductDrawerProps {
  post: VideoPost;
  overlayVisible: boolean;
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  productActivity: Record<string, number>;
  onSelectProduct: (product: Product) => void;
  onBuyNow: (product: Product, color: string, size: string) => void;
  onAddToCart: (product: Product, color: string, size: string) => void;
  // Height (px) of the poster/caption block at the bottom of the video,
  // reported by VideoStage. The floating pill rises above it so a long
  // caption or repost label is never covered.
  captionHeight?: number;
  // True while the caption's "See more" scrim is open over the video.
  // The pill dims out with everything else behind that scrim rather than
  // staying lit on top of it — see VideoStage's onDescExpandedChange.
  descExpanded?: boolean;
  // Opens the "ask what this is" sheet; absent on your own video.
  onAskTwin?: () => void;
}

// sheetOpen is controlled from page.tsx (not local useState) specifically
// because this component unmounts entirely when navigating to full product
// details — that view isn't part of the shop layout at all — and remounts
// when you come back. Local state would reset to closed on that remount,
// which is exactly the "back button skips past the drawer, straight to the
// bare video" bug this fixes: page.tsx's copy of sheetOpen doesn't go
// anywhere just because this component did.
export function ProductDrawer({
  post,
  overlayVisible,
  sheetOpen,
  onSheetOpenChange,
  productActivity,
  onSelectProduct,
  onBuyNow,
  onAddToCart,
  captionHeight = 0,
  descExpanded = false,
  onAskTwin,
}: ProductDrawerProps) {
  // Real-time drag offset (px) applied on top of the sheet's open position
  // while a finger/pointer is actively dragging the handle down. 0 means
  // "not currently being dragged away from fully open."
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef<number | null>(null);
  const products = post.products ?? [];
  // While a twinned product is on screen the pill speaks for it ("Shop the
  // bag"); otherwise it stays the generic "Shop this video". Older posts have
  // no twins and so never leave the generic state. The drawer itself is unchanged.
  const activeTwin = usePillTwin(post.twins);
  const twinProduct = activeTwin ? products.find((p) => p.id === activeTwin.productId) : undefined;
  const heroProduct = twinProduct ?? products[0];
  const productCount = products.length;
  const showTag = !sheetOpen && overlayVisible && !descExpanded;

  // Pointer Capture (not plain onPointerMove) so the drag keeps tracking
  // even if the finger moves faster than the handle's small hit area —
  // without it, a quick swipe can outrun the element and silently drop
  // the gesture partway through.
  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartY.current = e.clientY;
    setIsDragging(true);
  };

  const handlePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (dragStartY.current === null) return;
    // Only downward movement moves the sheet — dragging up shouldn't push
    // it past fully open.
    setDragY(Math.max(0, e.clientY - dragStartY.current));
  };

  const CLOSE_THRESHOLD_PX = 100;

  const handlePointerUp = () => {
    if (dragStartY.current === null) return;
    if (dragY > CLOSE_THRESHOLD_PX) {
      onSheetOpenChange(false);
    }
    setDragY(0);
    setIsDragging(false);
    dragStartY.current = null;
  };

  return (
    <>
      {/* Desktop / tablet: static side panel */}
      <aside className="hidden w-[280px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line px-[18px] pb-4 pt-[76px] lg:flex">
        <DrawerContent post={post} productActivity={productActivity} onSelectProduct={onSelectProduct} onBuyNow={onBuyNow} onAddToCart={onAddToCart} onAskTwin={onAskTwin} />
      </aside>

      {/* Mobile/tablet: a small floating tag instead of a full-width bar —
          it doesn't eat into the video's width at all, just sits on top of
          it. The bought/cart-activity line + "Shop this video" is what earns
          the tap; the video stays the star of the screen until someone
          actually wants it. */}
      {heroProduct && (
        <button
          onClick={() => onSheetOpenChange(true)}
          aria-label={`View ${productCount} product${productCount > 1 ? 's' : ''} featured in this video`}
          // One fixed resting height for EVERY video, so the pill never
          // jumps around as you swipe between posts with different caption
          // lengths or a "Reposted by" label. PILL_REST_BOTTOM_PX is set to
          // clear the tallest normal case (repost label + avatar row + a
          // two-line caption + "See more") with a small gap. captionHeight
          // can only raise it above that (it's a high-water mark, see
          // page.tsx), as a safety net for unusually tall text such as a
          // larger system font size — it never lowers it again.
          style={{ bottom: `calc(${Math.max(PILL_REST_BOTTOM_PX, captionHeight + 18 + 10)}px + var(--nav-h, 0px))` }}
          className={`fixed left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white py-1.5 pl-1.5 pr-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-[opacity,bottom] duration-200 lg:hidden ${
            showTag ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
            <span className="relative h-9 w-9 overflow-hidden rounded-full bg-box">
              <ProductThumbnail product={heroProduct} />
            </span>
            {productCount > 1 && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-hot-pink text-[10.5px] font-bold text-white">
                {productCount}
              </span>
            )}
          </span>
          <span className="flex flex-col items-start leading-tight">
            <span
              key={twinProduct ? twinProduct.id : 'generic'}
              className="text-[12.5px] font-bold text-text"
              style={{ animation: 'twinPop 200ms ease-out' }}
            >
              {twinProduct && activeTwin ? `Shop the ${activeTwin.label}` : 'Shop this video'}
            </span>
            <span className="flex items-center gap-1.5 text-[10.5px] font-semibold text-hot-pink">
              <ShoppingCart size={15} strokeWidth={2.5} className="shrink-0" />
              {formatCount(productActivity[heroProduct.id] ?? 0)} bought &amp; in carts
            </span>
          </span>
        </button>
      )}

      {/* Backdrop: same dimming treatment as MoreMenu and CategorySheet —
          tap anywhere outside the sheet to dismiss it. Sits below the
          sheet's own z-30 so a tap inside the sheet hits the sheet first,
          and pointer-events stay off entirely while closed so it never
          steals taps meant for the video or the floating tag underneath. */}
      <div
        onClick={() => onSheetOpenChange(false)}
        aria-hidden="true"
        className={`fixed inset-0 z-20 bg-black/40 transition-opacity duration-300 lg:hidden ${
          sheetOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Mobile/tablet: the full sheet, off-screen entirely until opened —
          no partial peek strip left sitting across the video. Transform is
          driven inline (not by Tailwind's translate-y-* classes) so it can
          combine the open/closed state with the live drag offset below —
          mixing the two would mean an inline style silently overriding the
          class, since inline style always wins for the same property. */}
      <div
        className={`fixed inset-x-0 bottom-0 z-30 rounded-t-2xl border-t border-line bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.08)] lg:hidden ${
          sheetOpen ? '' : 'pointer-events-none'
        }`}
        style={{
          maxHeight: '80vh',
          transform: sheetOpen ? `translateY(${dragY}px)` : 'translateY(100%)',
          // No transition while actively dragging — the sheet needs to
          // track the finger 1:1, not ease toward it. Re-enabled the
          // instant a drag ends, for the snap-back or the close animation.
          transition: isDragging ? 'none' : 'transform 300ms ease-out',
        }}
      >
        <button
          onClick={() => onSheetOpenChange(false)}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          aria-expanded={sheetOpen}
          aria-label="Close product details"
          className="flex w-full touch-none flex-col items-center gap-2 py-2.5"
        >
          <span className="h-1 w-10 rounded-full bg-box" />
          <span className="text-[12.5px] text-text-mute">Swipe down to close</span>
        </button>
        <div className="overflow-y-auto px-[18px] pb-4" style={{ maxHeight: 'calc(80vh - 48px)' }}>
          <DrawerContent post={post} productActivity={productActivity} onSelectProduct={onSelectProduct} onBuyNow={onBuyNow} onAddToCart={onAddToCart} onAskTwin={onAskTwin} />
        </div>
      </div>
    </>
  );
}
