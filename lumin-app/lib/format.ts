/** Formats large counts compactly, e.g. 4500 -> "4.5k". */
export function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

/**
 * Formats an ISO timestamp (e.g. VideoPost.created_at from the API) as
 * the same short relative style the seed/mock data already uses by hand
 * — "3h ago", "1d ago" — so a live post reads identically to a seeded
 * one. Falls back to a plain date past a week old rather than counting
 * weeks/months, since nothing in this app's mock data ever needed that.
 */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));

  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
