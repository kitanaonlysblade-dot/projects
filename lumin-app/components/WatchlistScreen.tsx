'use client';

import { Bookmark, Heart } from 'lucide-react';
import type { VideoPost } from '@/lib/types';
import { formatCount } from '@/lib/format';
import { PageHeader } from './PageHeader';
import { PostThumbnail } from './Thumbnails';

interface WatchlistScreenProps {
  posts: VideoPost[];
  onBack: () => void;
  onSelectPost: (post: VideoPost) => void;
}

// Fed entirely by tapping the Save (bookmark) button on a video's
// engagement rail — there's no seed data here, so an empty list means
// nobody's saved anything yet, not "the demo data hasn't loaded."
export function WatchlistScreen({ posts, onBack, onSelectPost }: WatchlistScreenProps) {
  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title="Watchlist" onBack={onBack} backLabel="Back to shop" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-4 lg:px-0 lg:py-6">
          {posts.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-16 text-center">
              <Bookmark size={22} className="text-text-mute" />
              <p className="text-[13px] font-bold text-text">Nothing saved yet</p>
              <p className="max-w-[220px] text-[13.5px] text-text-mute">
                Tap the bookmark icon on any video to save it here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2 lg:grid-cols-4 xl:grid-cols-5">
              {posts.map((post) => (
                <button
                  key={post.id}
                  onClick={() => onSelectPost(post)}
                  className="relative aspect-[9/13] overflow-hidden rounded-xl bg-[#2a2a28] text-left"
                >
                  <PostThumbnail post={post} />
                  <span className="absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/50 to-transparent" />
                  <span className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/50 to-transparent" />
                  <span className="absolute left-1.5 top-1.5 text-[11.5px] font-semibold text-white/85">
                    {post.posterName}
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
