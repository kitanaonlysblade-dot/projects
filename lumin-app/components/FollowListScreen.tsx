'use client';

import { Lock, Users } from 'lucide-react';
import type { SearchPerson } from '@/lib/types';
import { PageHeader } from './PageHeader';

interface FollowListScreenProps {
  // "Followers", "Following", "Likes", or "Mutual" — drives both the
  // header title and the empty-state copy.
  kind: 'followers' | 'following' | 'likes' | 'mutual';
  // Whose list this is: the account name for followers/following (empty
  // state reads "No followers yet" vs "Nia Fields has no followers
  // yet" — undefined for the viewer's own list, where "you" reads more
  // naturally than repeating their own name), the post's poster name for
  // likes (empty state reads "No likes yet" vs "No one has liked Nia
  // Fields's post yet"), or the other account's name for mutual
  // followers (empty state reads "You and Nia Fields have no mutual
  // followers." — in practice PosterProfileScreen only opens this when
  // the count is already known to be > 0, so this mostly covers the
  // count having changed between the two fetches).
  ownerName?: string;
  people: SearchPerson[];
  // True while the initial fetch is in flight — people stays [] during
  // this, so this is what tells the empty state apart from "still
  // loading" rather than the screen flashing "no followers yet" for a
  // moment on every open.
  loading: boolean;
  // Set when the fetch failed — most commonly a private followers/
  // following list (list_followers/list_following's 403), but also
  // covers a deleted post/account or a network hiccup. Takes over the
  // whole body in place of the list/empty-state either way, since
  // "private" and "genuinely empty" need to read differently.
  error?: string | null;
  onBack: () => void;
  onSelectPerson: (person: SearchPerson) => void;
}

// Reached by tapping the "Followers"/"Following" label on either
// ProfileScreen.tsx (the viewer's own counts) or PosterProfileScreen.tsx
// (someone else's), or the like count on VideoStage — same list
// component either way, just pointed at a different subject id and
// title by the caller in app/page.tsx. Read-only: no follow/unfollow
// button on a row here, since tapping a row already takes you to that
// person's profile, where the existing Follow button lives.
export function FollowListScreen({
  kind,
  ownerName,
  people,
  loading,
  error,
  onBack,
  onSelectPerson,
}: FollowListScreenProps) {
  const title = kind === 'followers' ? 'Followers' : kind === 'following' ? 'Following' : kind === 'likes' ? 'Likes' : 'Mutual followers';
  const emptyCopy =
    kind === 'followers'
      ? ownerName
        ? `${ownerName} has no followers yet.`
        : "You don't have any followers yet."
      : kind === 'following'
        ? ownerName
          ? `${ownerName} isn't following anyone yet.`
          : "You aren't following anyone yet."
        : kind === 'likes'
          ? ownerName
            ? `No one has liked ${ownerName}'s post yet.`
            : 'No one has liked this post yet.'
          : ownerName
            ? `You and ${ownerName} have no mutual followers.`
            : 'No mutual followers.';
  // A private-list 403 reads as a lock icon + the backend's own message
  // (specific: "This account's followers list is private."); anything
  // else (a deleted post/account, a network hiccup) still gets the
  // generic Users icon, same as the empty state, since there's nothing
  // permission-shaped about those.
  const isPrivate = !!error && /private/i.test(error);

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title={title} onBack={onBack} backLabel={kind === 'likes' ? 'Back to video' : 'Back to profile'} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-4 lg:px-0 lg:py-6">
          {loading ? (
            <div className="flex flex-col items-center gap-1.5 py-16 text-center">
              <p className="text-[13.5px] text-text-mute">Loading…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-1.5 py-16 text-center">
              {isPrivate ? (
                <Lock size={22} className="text-text-mute" />
              ) : (
                <Users size={22} className="text-text-mute" />
              )}
              <p className="text-[13px] font-bold text-text">{isPrivate ? 'This list is private' : 'Couldn\u2019t load this list'}</p>
              <p className="max-w-[240px] text-[13.5px] text-text-mute">{error}</p>
            </div>
          ) : people.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-16 text-center">
              <Users size={22} className="text-text-mute" />
              <p className="text-[13px] font-bold text-text">{title}</p>
              <p className="max-w-[240px] text-[13.5px] text-text-mute">{emptyCopy}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {people.map((person) => (
                <button
                  key={person.id}
                  onClick={() => onSelectPerson(person)}
                  className="flex items-center gap-3 rounded-xl border border-line bg-white p-2.5 text-left"
                >
                  <span className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-box">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={person.avatarUrl || '/images/placeholder.svg'}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-text">{person.displayName}</span>
                    <span className="block truncate text-[12.5px] text-text-mute">{person.username}</span>
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
