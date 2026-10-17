'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Product, VideoPost } from '@/lib/types';

const PLACEHOLDER = '/images/placeholder.svg';

// One place for "show this product's photo, and never leave a blank tile"
// — every product thumbnail in the app goes through here instead of each
// screen rolling its own `{src && <img/>}`, which is how some screens
// ended up with empty boxes (ProductTile never rendered an image at all)
// while others fell back to the placeholder. Also covers the other way a
// tile goes blank: a URL that exists but fails to load (deleted from
// storage, expired, blocked) — onError swaps to the placeholder instead
// of leaving the browser's broken-image glyph or an empty box.
export function ProductThumbnail({
  product,
  className = 'h-full w-full object-cover',
}: {
  product: Pick<Product, 'images' | 'imageUrl'>;
  className?: string;
}) {
  const src = product.images?.[0] || product.imageUrl;
  // Remembers *which* src failed rather than a plain boolean, so a tile
  // that gets re-used for a different product (list re-ordering, a
  // carousel swapping items) tries the new image instead of staying
  // stuck on the placeholder from the previous one's failure.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showPlaceholder = !src || failedSrc === src;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={showPlaceholder ? PLACEHOLDER : src}
      alt=""
      className={className}
      onError={() => src && setFailedSrc(src)}
    />
  );
}

// Video post tiles, in order of preference: the saved thumbnail image →
// the video's own first frame (thumbnail generation can fail at upload
// time — an unsupported codec, a flaky network — but the video itself is
// always there, and `#t=0.001` is the standard trick to make browsers,
// iOS Safari especially, paint a frame instead of an empty black box) →
// the generic placeholder if even that fails to load.
export function PostThumbnail({
  post,
  className = 'absolute inset-0 h-full w-full object-cover',
}: {
  post: Pick<VideoPost, 'thumbnailUrl' | 'videoUrl'>;
  className?: string;
}) {
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const [failedVideoSrc, setFailedVideoSrc] = useState<string | null>(null);

  const imageOk = !!post.thumbnailUrl && failedImageSrc !== post.thumbnailUrl;
  if (imageOk) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={post.thumbnailUrl}
        alt=""
        className={className}
        onError={() => setFailedImageSrc(post.thumbnailUrl ?? null)}
      />
    );
  }

  const videoOk = !!post.videoUrl && failedVideoSrc !== post.videoUrl;
  if (videoOk) {
    return (
      <video
        src={`${post.videoUrl}#t=0.001`}
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
        // Purely a stand-in image here — never interactive, never
        // playing, so it shouldn't swallow the tile's own tap target.
        className={`pointer-events-none ${className}`}
        onError={() => setFailedVideoSrc(post.videoUrl ?? null)}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={PLACEHOLDER} alt="" className={className} />
  );
}

// Full-screen look at someone's profile picture — shared by the own-
// profile screen and the screen for viewing another person's profile, so
// tapping an avatar behaves the same in both. Backdrop tap, the X, and
// Escape all close it; a tap on the image itself doesn't (so a stray tap
// while looking at the picture doesn't dismiss it). Falls back to the
// same placeholder every other avatar uses, both when there's no picture
// set and when the saved one fails to load.
export function AvatarViewer({
  src,
  name,
  onClose,
}: {
  src?: string;
  name: string;
  onClose: () => void;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${name}'s profile picture`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
      >
        <X size={18} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={!src || failed ? PLACEHOLDER : src}
        alt={`${name}'s profile picture`}
        className="max-h-full max-w-full rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
