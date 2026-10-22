// Remembers which sponsored twin card a shopper just used for a product, so the sale can be credited to it (the seller pays
// a percent of sales made this way; see lumin-backend/app/sponsored.py). Kept in memory for a short while: the shopper
// taps Buy now / Add to cart on the card, and the cart or payment call that follows names the card. The server checks it
// really is that product's twin, so a wrong or stale id is simply ignored.
const TTL_MS = 30 * 60 * 1000;
const seen = new Map<string, { id: string; at: number }>();

export function rememberSponsored(productId: string, sponsoredId: string): void {
  seen.set(productId, { id: sponsoredId, at: Date.now() });
}

export function sponsoredFor(productId: string): string | undefined {
  const hit = seen.get(productId);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) {
    seen.delete(productId);
    return undefined;
  }
  return hit.id;
}
