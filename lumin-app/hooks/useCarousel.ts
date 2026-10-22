import { useEffect, useState } from 'react';

/**
 * Cycles through `items` on a fixed interval. Pauses automatically
 * when there's nothing to rotate between.
 */
export function useCarousel<T>(items: T[], intervalMs = 3500) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (items.length <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % items.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [items.length, intervalMs]);

  return { index, item: items[index], setIndex };
}
