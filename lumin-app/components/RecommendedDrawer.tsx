'use client';

import type { VideoPost } from '@/lib/types';

// Shared "what counts as related" logic — used to pick discover's starting
// post and to advance on swipe/scroll, so every presentation agrees on
// what's related to what. `pool` is passed in (the live discoverPosts
// state from page.tsx) rather than imported here directly, so a freshly
// uploaded personal post is actually eligible to surface while swiping —
// not just visible in the uploader's own profile grid.
//
// Shared interest tags still decide the *candidate set* (a post with no
// tags in common never outranks one that matches, no matter how many
// times its products have sold) — popularity only breaks ties within
// that set. `popularityScore` is the same "X bought & in carts" number
// ProductTile/ProductCard already show on screen (Product.cartCount),
// summed across whatever products a post has tagged. Most discover
// posts carry no products at all, so this is a no-op for them today —
// it only actually moves the order for shop posts, or a discover post
// someone tagged products on.
function popularityScore(post: VideoPost): number {
  return post.products?.reduce((sum, p) => sum + p.cartCount, 0) ?? 0;
}

export function getRecommended(currentPost: VideoPost, pool: VideoPost[]): VideoPost[] {
  const candidates = pool.filter((p) => p.id !== currentPost.id);
  const byPopularity = (list: VideoPost[]) =>
    [...list].sort((a, b) => popularityScore(b) - popularityScore(a));

  if (!currentPost.interestIds?.length) return byPopularity(candidates);

  const related = candidates.filter((p) =>
    p.interestIds?.some((id) => currentPost.interestIds?.includes(id)),
  );
  return related.length > 0 ? byPopularity(related) : byPopularity(candidates);
}
