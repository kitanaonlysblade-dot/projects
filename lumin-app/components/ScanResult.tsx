'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { Product, VideoPost } from '@/lib/types';
import { twinProducts } from '@/lib/twins';
import { clickSponsoredTwin, getSponsoredTwin, revealSponsoredTwin } from '@/lib/api';
import { apiProductToProduct } from '@/lib/adapters';
import { ProductThumbnail } from './Thumbnails';
import { VerifiedOriginalBadge } from './VerifiedOriginalBadge';

interface ScanResultProps {
  post: VideoPost;
  products: Product[];
  disputed: boolean;
  videoUrl: string | null;
  thumbUrl: string | null;
  // Where in the original video the scanned recording started.
  atS: number;
  onClose: () => void;
  onSelectProduct: (product: Product) => void;
  onSelectShopPost: (post: VideoPost) => void;
  // One-tap purchase for a product with nothing to choose (at most one colour and one size). Without it, or when
  // there is a choice to make, Buy now opens the product's page.
  onBuyNow?: (product: Product, color: string, size: string) => void;
  // Puts these products in the cart together and opens it (the first colour/size where there is a choice).
  onBuyLook?: (items: { product: Product; color: string; size: string }[]) => void;
}

// The result of a scan, full screen: the matched video big, playing from the moment that was
// scanned, on a background that carries the video's own colours (a heavily blurred copy of its
// thumbnail, so there is no canvas / cross-origin colour sampling to go wrong), then its products.
// Sits over the search screen (the parent is `relative`), so closing it returns to the search.
export function ScanResult({
  post,
  products,
  disputed,
  videoUrl,
  thumbUrl,
  atS,
  onClose,
  onSelectProduct,
  onSelectShopPost,
  onBuyNow,
  onBuyLook,
}: ScanResultProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [ordered, setOrdered] = useState<string | null>(null);

  const buyNow = (p: Product) => {
    if (!p.inStock) return;
    if (onBuyNow && p.colors.length <= 1 && p.sizes.length <= 1) {
      onBuyNow(p, p.colors[0] ?? '', p.sizes[0] ?? '');
      setOrdered(p.id);
      setTimeout(() => setOrdered((cur) => (cur === p.id ? null : cur)), 1600);
      return;
    }
    onSelectProduct(p);
  };

  // What the shopper is shown: a twin is the product that matches what is on screen, so where the video has twins,
  // only products with a twin that has not been reported as a poor match are listed. A video with no twins at all
  // (a seller's plain product tags) lists its tagged products, as before.
  const { shown, hidden: hiddenCount } = twinProducts(products, post.twins);
  // The look is every in-stock product shown, all ticked to start; the count and total follow the ticks.
  const candidates = shown.filter((p) => p.inStock);
  const [unticked, setUnticked] = useState<Record<string, boolean>>({});
  const look = candidates.filter((p) => !unticked[p.id]);
  // Added up in whole cents so the total never shows 0.1 + 0.2 style slips.
  const lookTotal = look.reduce((sum, p) => sum + Math.round(p.price * 100), 0) / 100;
  const isCandidate = (p: Product) => candidates.some((c) => c.id === p.id);
  const [sponsored, setSponsored] = useState<{ id: string; product: Product } | null>(null);
  useEffect(() => {
    let live = true;
    getSponsoredTwin(post.id)
      .then((r) => {
        if (live && r) setSponsored({ id: r.id, product: apiProductToProduct(r.product) });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [post.id]);
  const [sponsoredOpen, setSponsoredOpen] = useState(false);
  const revealSponsored = () => {
    if (!sponsored) return;
    setSponsoredOpen(true);
    revealSponsoredTwin(sponsored.id).catch(() => {});
  };
  const openSponsored = () => {
    if (!sponsored) return;
    clickSponsoredTwin(sponsored.id).catch(() => {});
    onSelectProduct(sponsored.product);
  };
  const [lookBusy, setLookBusy] = useState(false);
  const buyLook = () => {
    if (!onBuyLook || lookBusy) return;
    setLookBusy(true);
    onBuyLook(look.map((p) => ({ product: p, color: p.colors[0] ?? '', size: p.sizes[0] ?? '' })));
    setTimeout(() => setLookBusy(false), 2500);
  };

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const seek = () => {
      try {
        v.currentTime = atS;
      } catch {
        // not seekable yet; it just starts from the beginning
      }
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener('loadedmetadata', seek, { once: true });
  }, [atS, videoUrl]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col overflow-hidden bg-ink" role="dialog" aria-label="Scan result">
      {/* The video's colours, spread across the whole screen */}
      {thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full scale-150 object-cover opacity-90 blur-3xl saturate-150"
        />
      ) : (
        <div className="brand-gradient pointer-events-none absolute inset-0" />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-black/10 to-black/60" />

      <div className="relative z-10 flex items-center justify-between px-4 pt-4">
        <p className="text-[13px] font-bold text-white/90">Found it</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/30 text-white"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-8">
        {/* Phone: one column (video, then products). Desktop: the video on the left, its products stacked down the right. */}
        <div className="mx-auto w-full max-w-[340px] lg:flex lg:max-w-[920px] lg:items-start lg:gap-10">
          <div className="lg:w-[340px] lg:shrink-0">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
            className="relative mx-auto mt-3 block aspect-[9/16] h-[58vh] max-w-full overflow-hidden rounded-2xl bg-black shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
          >
            {videoUrl ? (
              <video
                ref={video}
                src={videoUrl}
                poster={thumbUrl ?? undefined}
                autoPlay
                loop
                muted={muted}
                playsInline
                className="h-full w-full object-cover"
              />
            ) : thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
          </button>

          <button type="button" onClick={() => onSelectShopPost(post)} className="mt-3 block w-full text-left">
            <p className="text-[15px] font-bold text-white">{post.posterName}</p>
            <p className="text-[12.5px] text-white/70">Open in the feed</p>
            {post.verifiedOriginal && !disputed && <VerifiedOriginalBadge className="mt-1.5" />}
          </button>

          {disputed && (
            <p className="mt-3 rounded-xl bg-black/30 p-3 text-[12px] leading-snug text-white/85">
              This video is under review because a similar one was posted by someone else. Purchases stay covered by buyer protection.
            </p>
          )}

          </div>

          <div className="min-w-0 lg:mt-3 lg:flex-1">
            <h2 className="mb-2 mt-5 text-[13px] font-bold text-white lg:mt-0 lg:text-[15px]">Products in this video</h2>
            {onBuyLook && candidates.length >= 2 && (
              <button
                type="button"
                onClick={buyLook}
                disabled={lookBusy || look.length === 0}
                className="brand-gradient mb-3 w-full rounded-full px-4 py-3 text-[14px] font-bold text-white disabled:opacity-60"
              >
                {lookBusy
                  ? 'Adding to your cart…'
                  : look.length === 0
                    ? 'Tick at least one item'
                    : `${look.length === candidates.length ? 'Buy the whole look' : 'Buy selected'} · ${look.length} item${look.length === 1 ? '' : 's'} · $${lookTotal.toFixed(2)}`}
              </button>
            )}
            <div className="flex flex-col gap-2">
              {shown.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-xl border border-line bg-white p-2.5">
                  {onBuyLook && candidates.length >= 2 && isCandidate(p) && (
                    <input
                      type="checkbox"
                      checked={!unticked[p.id]}
                      onChange={() => setUnticked((u) => ({ ...u, [p.id]: !u[p.id] }))}
                      aria-label={`Include ${p.name} in the look`}
                      className="h-4 w-4 shrink-0 accent-[#ff2d78]"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => onSelectProduct(p)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="block h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-box">
                      <ProductThumbnail product={p} />
                    </span>
                    <span className="min-w-0">
                      <span className="line-clamp-2 block text-[13.5px] leading-snug text-text">{p.name}</span>
                      <span className="mt-1 block text-[14px] font-bold text-hot-pink">${p.price.toFixed(2)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => buyNow(p)}
                    disabled={!p.inStock || ordered === p.id}
                    className="brand-gradient shrink-0 rounded-full px-4 py-2 text-[13px] font-bold text-white disabled:opacity-60"
                  >
                    {!p.inStock ? 'Out of stock' : ordered === p.id ? 'Ordering…' : 'Buy now'}
                  </button>
                </div>
              ))}
              {shown.length === 0 && (
                <p className="text-[13px] text-white/70">
                  {hiddenCount > 0
                    ? "None of this video's products are confirmed matches for what's on screen, so none are shown here."
                    : 'No products are tagged in this video.'}
                </p>
              )}
            </div>
            {sponsored && (
              <div className="mt-5">
                {!sponsoredOpen ? (
                  // Collapsed: the shopper chooses to look. Nothing about the product shows until they tap.
                  <button
                    type="button"
                    onClick={revealSponsored}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/25 bg-white/10 px-3.5 py-3 text-left text-white"
                  >
                    <span className="text-[13px] font-semibold">
                      Sponsored twin <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-[10.5px] font-semibold">Ad</span>
                      <span className="mt-0.5 block text-[12px] font-normal text-white/75">Tap to see a similar product</span>
                    </span>
                    <ChevronDown size={18} aria-hidden="true" />
                  </button>
                ) : (
                  <>
                    <h2 className="mb-2 text-[13px] font-bold text-white lg:text-[15px]">
                      Sponsored twin <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-[10.5px] font-semibold">Ad</span>
                    </h2>
                    <button
                      type="button"
                      onClick={openSponsored}
                      className="flex w-full items-center gap-3 rounded-xl border border-line bg-white p-2.5 text-left"
                    >
                      <span className="block h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-box">
                        <ProductThumbnail product={sponsored.product} />
                      </span>
                      <span className="min-w-0">
                        <span className="line-clamp-2 block text-[13.5px] leading-snug text-text">{sponsored.product.name}</span>
                        <span className="mt-1 block text-[14px] font-bold text-hot-pink">${sponsored.product.price.toFixed(2)}</span>
                      </span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
