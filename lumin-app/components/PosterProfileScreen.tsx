'use client';

import { useState } from 'react';
import { Flag, Heart, Lock, Repeat2 } from 'lucide-react';
import type { VideoPost } from '@/lib/types';
import { formatCount } from '@/lib/format';
import { PageHeader } from './PageHeader';
import { ReportAccountSheet } from './ReportAccountSheet';

import { AvatarViewer, PostThumbnail } from './Thumbnails';

interface PosterProfileScreenProps {
  posterName: string;
  posterAvatar?: string;
  bio?: string;
  followers: number;
  following: number;
  // True when this poster has turned on Settings' "Private followers/
  // following lists" toggle — the labels below stay tappable either way
  // (tapping still opens FollowListScreen, which shows its own "This
  // list is private" message backed by the real 403), this just adds a
  // lock icon so it's not a surprise. The counts themselves are never
  // gated by this — see the backend's own comment on why.
  isFollowListPrivate?: boolean;
  // Discover-pool posts by this poster — normal social videos, posted
  // straight from a personal profile. Rendered under the "Discover" tab.
  discoverPosts: VideoPost[];
  // Shop-pool posts by this poster — videos posted through a merchant
  // account, shoppable and product-tagged. Rendered under the "Posts"
  // tab.
  shopPosts: VideoPost[];
  onBack: () => void;
  onSelectDiscoverPost: (post: VideoPost) => void;
  onSelectShopPost: (post: VideoPost) => void;
  isFollowing: boolean;
  // Same convention as VideoStage's Follow button: undefined means don't
  // show one at all, covering the same two cases (no real backend id
  // behind this poster, or this is somehow the viewer's own profile).
  onToggleFollow?: () => void;
  // Same undefined-means-nothing-to-target convention as onToggleFollow
  // just above — gates the Followers/Following labels the same way that
  // gates the Follow button and the Report flag, and for the same reason
  // (mock/fallback content has no real account behind it to fetch a list
  // for).
  onOpenFollowers?: () => void;
  onOpenFollowing?: () => void;
  // Present (as a number, not null/undefined) only once app/page.tsx has
  // actually fetched it AND it's > 0 — see that fetch's own comment for
  // the several reasons it might be skipped (not signed in, the account
  // has hidden it, etc.). Renders as a tappable "X mutual followers"
  // row under the bio when set; nothing renders otherwise, same
  // undefined-means-don't-show-it convention as onToggleFollow.
  mutualFollowersCount?: number | null;
  onOpenMutualFollowers?: () => void;
  posterId?: string;
  // Remembered by the parent across a trip into the gallery player and
  // back — this screen remounts on return and would otherwise reset to
  // whichever tab it defaults to.
  initialTab?: 'posts' | 'discover';
  onTabChange?: (tab: 'posts' | 'discover') => void;
}

type Tab = 'posts' | 'discover';

// Someone else's profile, not the viewer's own — reached by tapping a
// poster's name or avatar in the shop or discover feed. Otherwise
// read-only: no edit button, no business-account entry point, nothing
// that only makes sense on your own profile. Follow is the one exception
// — an action a viewer takes on someone else's profile, never their own.
// `discoverPosts`/`shopPosts` are whatever the caller found matching this
// poster's display name in each pool — this component doesn't do that
// lookup itself — it just splits the two pools into tabs: "Posts" for
// what went out through a merchant account (shop-pool), "Discover" for
// what went out from a personal profile (discover-pool).
export function PosterProfileScreen({
  posterName,
  posterAvatar,
  bio,
  followers,
  following,
  isFollowListPrivate,
  discoverPosts,
  shopPosts,
  onBack,
  onSelectDiscoverPost,
  onSelectShopPost,
  isFollowing,
  onToggleFollow,
  onOpenFollowers,
  onOpenFollowing,
  mutualFollowersCount,
  onOpenMutualFollowers,
  posterId,
  initialTab,
  onTabChange,
}: PosterProfileScreenProps) {
  const [tab, setTabState] = useState<Tab>(
    initialTab ?? (shopPosts.length === 0 && discoverPosts.length > 0 ? 'discover' : 'posts'),
  );
  const setTab = (next: Tab) => {
    setTabState(next);
    onTabChange?.(next);
  };
  const [reportOpen, setReportOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const totalPosts = discoverPosts.length + shopPosts.length;
  const activePosts = tab === 'posts' ? shopPosts : discoverPosts;

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader
        title={posterName}
        onBack={onBack}
        backLabel="Back"
        rightSlot={
          posterId && (
            <button onClick={() => setReportOpen(true)} aria-label={`Report ${posterName}`} className="text-text-mute hover:text-hot-pink">
              <Flag size={17} />
            </button>
          )
        }
      />
      {posterId && (
        <ReportAccountSheet
          posterId={posterId}
          posterName={posterName}
          open={reportOpen}
          onClose={() => setReportOpen(false)}
        />
      )}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:px-0 lg:py-8">
          <div className="mb-5 flex items-center gap-4">
            <button
              onClick={() => setAvatarOpen(true)}
              aria-label={`View ${posterName}'s profile picture`}
              className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-box lg:h-20 lg:w-20"
            >
              <img src={posterAvatar || '/images/placeholder.svg'} alt="" className="h-full w-full object-cover" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold text-text lg:text-lg">{posterName}</p>
              {bio && <p className="mt-1 text-[13.5px] leading-snug text-text-mute">{bio}</p>}
            </div>
            {onToggleFollow && (
              <button
                onClick={onToggleFollow}
                className={`shrink-0 rounded-full px-4 py-2 text-[13.5px] font-bold ${
                  isFollowing ? 'bg-white text-text-mute' : 'brand-gradient text-white'
                }`}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            )}
          </div>

          <div className="mb-5 flex gap-6 border-y border-line py-3 lg:gap-10">
            <div>
              <p className="text-[14px] font-bold text-text">{totalPosts}</p>
              {/* Same flex/gap/text classes as the Followers/Following
                  labels below (span here since this one's never
                  clickable) — a bare <p> next to their <button>s was
                  what threw the three labels out of alignment with each
                  other despite all being 11px text. */}
              <span className="flex items-center gap-0.5 text-[12.5px] text-text-mute">Posts</span>
            </div>
            <div>
              <p className="text-[14px] font-bold text-text">{formatCount(followers)}</p>
              {onOpenFollowers ? (
                <button onClick={onOpenFollowers} className="flex items-center gap-0.5 text-[12.5px] text-text-mute">
                  Followers
                  {isFollowListPrivate && <Lock size={9} className="text-text-mute" />}
                </button>
              ) : (
                <span className="flex items-center gap-0.5 text-[12.5px] text-text-mute">Followers</span>
              )}
            </div>
            <div>
              <p className="text-[14px] font-bold text-text">{formatCount(following)}</p>
              {onOpenFollowing ? (
                <button onClick={onOpenFollowing} className="flex items-center gap-0.5 text-[12.5px] text-text-mute">
                  Following
                  {isFollowListPrivate && <Lock size={9} className="text-text-mute" />}
                </button>
              ) : (
                <span className="flex items-center gap-0.5 text-[12.5px] text-text-mute">Following</span>
              )}
            </div>
          </div>

          {typeof mutualFollowersCount === 'number' && mutualFollowersCount > 0 && onOpenMutualFollowers && (
            <button
              onClick={onOpenMutualFollowers}
              className="mb-4 flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12.5px] font-semibold text-text-mute"
            >
              {formatCount(mutualFollowersCount)} mutual {mutualFollowersCount === 1 ? 'follower' : 'followers'}
            </button>
          )}

          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setTab('posts')}
              className={`flex-1 rounded-full py-2 text-center text-[13.5px] font-bold transition-colors ${
                tab === 'posts' ? 'brand-gradient text-white' : 'bg-white text-text-mute'
              }`}
            >
              Posts <span className={tab === 'posts' ? 'text-white/80' : 'text-text-mute'}>({shopPosts.length})</span>
            </button>
            <button
              onClick={() => setTab('discover')}
              className={`flex-1 rounded-full py-2 text-center text-[13.5px] font-bold transition-colors ${
                tab === 'discover' ? 'brand-gradient text-white' : 'bg-white text-text-mute'
              }`}
            >
              Discover <span className={tab === 'discover' ? 'text-white/80' : 'text-text-mute'}>({discoverPosts.length})</span>
            </button>
          </div>

          {activePosts.length === 0 ? (
            <p className="py-16 text-center text-[13.5px] text-text-mute">
              {tab === 'posts' ? 'Nothing posted or reposted through a shop account yet.' : 'Nothing posted or reposted to Discover yet.'}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2 lg:grid-cols-4 xl:grid-cols-5">
              {activePosts.map((post) => (
                <button
                  key={post.id}
                  onClick={() => (tab === 'posts' ? onSelectShopPost(post) : onSelectDiscoverPost(post))}
                  className="relative aspect-[9/13] overflow-hidden rounded-xl bg-[#2a2a28] text-left"
                >
                  <PostThumbnail post={post} />
                  {post.repostId && (
                    <span className="absolute left-1.5 top-1.5 z-10 flex items-center gap-1 rounded-full bg-black/50 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      <Repeat2 size={13} />
                      Reposted
                    </span>
                  )}
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
      {avatarOpen && <AvatarViewer src={posterAvatar} name={posterName} onClose={() => setAvatarOpen(false)} />}
    </div>
  );
}
