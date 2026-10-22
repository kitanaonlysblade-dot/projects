'use client';

import { useEffect, useRef, useState } from 'react';
import { BRAND } from '@/lib/brand';

// The platform logo (public/brand/logo.png). If the logo picture already contains the name it is shown alone;
// otherwise, or if the picture can't be loaded, the built-in icon is shown with the name beside it.
// `className` sizes the picture when it is shown alone (e.g. "h-10 max-w-[200px]").
export function BrandLogo({ className = 'h-10 max-w-[200px]' }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  const [darkFailed, setDarkFailed] = useState(false);
  const alone = BRAND.logoHasName && !failed;
  // The picture can fail before the page has finished loading its scripts (slow phone connections), and then onError
  // never fires. So also check once on mount whether it already failed.
  const ref = useRef<HTMLImageElement>(null);
  const darkRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
    const dark = darkRef.current;
    if (dark && dark.complete && dark.naturalWidth === 0) setDarkFailed(true);
  }, []);
  const size = alone ? `${className} w-auto shrink object-contain object-left` : 'h-8 w-8 shrink-0 rounded-lg';

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {/* Two pictures, one per theme: the page's theme class decides which shows (no flash on a dark phone). If the dark
          one is missing, the normal logo is used on the dark page too. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={ref}
        src={failed ? '/icons/icon-192.png' : BRAND.logo}
        alt={alone ? BRAND.name : ''}
        onError={() => setFailed(true)}
        className={`${size} ${darkFailed || failed ? '' : 'dark:hidden'}`}
      />
      {!failed && !darkFailed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={darkRef}
          src={BRAND.logoDark}
          alt=""
          aria-hidden="true"
          onError={() => setDarkFailed(true)}
          className={`${size} hidden dark:block`}
        />
      )}
      {!alone && <span className="truncate text-[18px] font-bold text-text">{BRAND.name}</span>}
    </div>
  );
}
