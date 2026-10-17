'use client';

import { useEffect, useState } from 'react';
import { connectionIsConstrained, useLuminLite } from '@/lib/lite';

// Quietly downloads the start of the video a swipe is about to land on, so
// it already has data when it slides in and starts. The element is never
// shown or played; the browser keeps what it fetches in its media cache for
// the real <video> to reuse.
//
// Skipped entirely (nothing is downloaded) when:
//   - Lumin Lite is on, or
//   - the browser reports Data Saver, or a slow (2G/3G) connection.
// Lite viewers are also pointed at the smaller copy when there is one.
export function VideoPrefetch({ urls }: { urls: (string | undefined)[] }) {
  const lite = useLuminLite();
  const [constrained, setConstrained] = useState(true); // assume yes until checked on the client
  useEffect(() => setConstrained(connectionIsConstrained()), []);
  if (lite || constrained) return null;

  const unique = Array.from(new Set(urls.filter((u): u is string => !!u)));
  if (unique.length === 0) return null;
  return (
    <div
      aria-hidden="true"
      style={{ position: 'fixed', left: -9999, top: 0, width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}
    >
      {unique.map((url) => (
        <video key={url} src={url} preload="auto" muted playsInline tabIndex={-1} />
      ))}
    </div>
  );
}
