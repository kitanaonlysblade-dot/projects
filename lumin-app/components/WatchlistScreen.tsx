'use client';

import { useState } from 'react';
import { Bookmark, Heart } from 'lucide-react';
import { isShopPost, type VideoPost } from '@/lib/types';
import { formatCount } from '@/lib/format';
import { PageHeader } from './PageHeader';
import { PostThumbnail } from './Thumbnails';

interface WatchlistScreenProps {
  posts: VideoPost[];
  onBack: () => void;
  // `siblings` are the saved videos from the SAME feed (shop with shop, Discover with Discover), so swiping in the
  // player moves through those and the video opens where it was saved.
  onSelectPost: (post: VideoPost, siblings: VideoPost[]) => void;
}

type Filter = 'all' | 'shop' | 'discover';

// Fed entirely by tapping the Save (bookmark) button on a video's
// engagement rail — there's no seed data here, so an empty list means
// nobody's saved anything yet, not "the demo data hasn't loaded."
export function WatchlistScreen({ posts, onBack, onSelectPost }: WatchlistScreenProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const shopPosts = posts.filter(isShopPost);
  const discoverPosts = posts.filter((p) => !isShopPost(p));
  const shown = filter === 'shop' ? shopPosts : filter === 'discover' ? discoverPosts : posts;
  const counts: Record<Filter, number> = { all: posts.length, shop: shopPosts.length, discover: discoverPosts.length };
  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title="Watchlist" onBack={onBack} backLabel="Back to shop" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-4 lg:px-0 lg:py-6">
          {posts.length > 0 && (
            <div role="tablist" aria-label="Saved from" className="mb-3 flex gap-1.5 px-1 lg:px-0">
              {(['all', 'shop', 'discover'] as Filter[]).map((f) => (
                <button
                  key={f}
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold capitalize ${
                    filter === f ? 'brand-gradient text-white' : 'border border-line bg-surface text-text-mute'
                  }`}
                >
                  {f} <span className="opacity-75">{counts[f]}</span>
                </button>
              ))}
            </div>
          )}
          {posts.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-16 text-center">
              <Bookmark size={22} className="text-text-mute" />
              <p className="text-[13px] font-bold text-text">Nothing saved yet</p>
              <p className="max-w-[220px] text-[13.5px] text-text-mute">
                Tap the bookmark icon on any video to save it here.
              </p>
            </div>
          ) : shown.length === 0 ? (
            <p className="py-12 text-center text-[13.5px] text-text-mute">Nothing saved from {filter} yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2 lg:grid-cols-4 xl:grid-cols-5">
              {shown.map((post) => (
                <button
                  key={post.id}
                  onClick={() => onSelectPost(post, isShopPost(post) ? shopPosts : discoverPosts)}
                  className="relative aspect-[9/13] overflow-hidden rounded-xl bg-ink text-left"
                >
                  <PostThumbnail post={post} />
                  <span className="absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/50 to-transparent" />
                  <span className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/50 to-transparent" />
                  <span className="absolute left-1.5 top-1.5 text-[11.5px] font-semibold text-white/85">
                    {post.posterName}
                  </span>
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    {isShopPost(post) ? 'Shop' : 'Discover'}
                  </span>
                  <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 text-[11.5px] font-medium text-white">
                    <Heart size={13} />
                    {formatCount(post.likes)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
