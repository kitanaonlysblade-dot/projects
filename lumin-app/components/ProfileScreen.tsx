'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import {
  Briefcase,
  Camera,
  ChevronRight,
  Loader2,
  MessageCircle,
  MoreVertical,
  Package,
  Plus,
  Repeat2,
  Settings,
  Trash2,
} from 'lucide-react';
import { ApiError, uploadFile } from '@/lib/api';
import { formatCount } from '@/lib/format';
import type { Interest, MerchantAccount, UserProfile, VideoPost } from '@/lib/types';
import { PageHeader } from './PageHeader';
import { UploadDiscoverPostModal } from './UploadDiscoverPostModal';

import { AvatarViewer, PostThumbnail } from './Thumbnails';
interface ProfileScreenProps {
  account: UserProfile;
  posts: VideoPost[];
  onAddPost: (post: VideoPost) => void;
  onDeletePost: (post: VideoPost) => void;
  onOpenPost: (post: VideoPost) => void;
  onBack: () => void;
  merchantAccount: MerchantAccount | null;
  onOpenMerchantCreate: () => void;
  onSwitchToMerchant: () => void;
  onOpenSettings: () => void;
  orderCount: number;
  onOpenOrders: () => void;
  // Forwarded straight through to UploadDiscoverPostModal's topic picker.
  interests: Interest[];
  // Real PATCH /users/me now — returns a promise so this component can
  // show its own inline error and stay in edit mode if it fails, rather
  // than silently reverting what was just typed.
  onSaveProfile: (displayName: string, bio: string) => Promise<void>;
  // Same PATCH /users/me, just the avatar_url field alone — a null
  // clears it back to the placeholder (see AvatarPicker's own comment
  // for why this is a separate handler from onSaveProfile rather than
  // one more field bundled into the same save).
  onChangeAvatar: (url: string | null) => Promise<void>;
  onOpenFollowers: () => void;
  onOpenFollowing: () => void;
}

// A normal, social-style profile — Discover posts only. There's no
// products/shop content here at all, on purpose: a plain personal account
// can't sell anything in this model, only a merchant page can. `posts`
// comes from GET /video-posts/mine (this account's own poster_id, not a
// filtered slice of whatever the general Discover feed happens to have
// loaded), so it's a complete list — including reposts, which show a
// small "Reposted" badge here since their content is the original
// poster's, not this account's own.
export function ProfileScreen({
  account,
  posts,
  onAddPost,
  onDeletePost,
  onOpenPost,
  onBack,
  merchantAccount,
  onOpenMerchantCreate,
  onSwitchToMerchant,
  onOpenSettings,
  orderCount,
  onOpenOrders,
  interests,
  onSaveProfile,
  onChangeAvatar,
  onOpenFollowers,
  onOpenFollowing,
}: ProfileScreenProps) {
  // No local displayName/bio state anymore — account.displayName/bio
  // (from page.tsx's userAccount, itself now backed by the real PATCH)
  // is the single source of truth, so a save elsewhere (or a session
  // restore) can't disagree with what this screen shows. Only the draft
  // fields and in-flight/error state are genuinely local to the form.
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(account.displayName);
  const [draftBio, setDraftBio] = useState(account.bio);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Same fallback PosterProfileScreen uses for someone else's avatar —
  // whenever account.avatarUrl is unset, which for the viewer's own
  // profile now means they haven't picked one yet (AvatarPicker below),
  // rather than there being no way to. The full-screen viewer works the
  // same either way.
  const [avatarOpen, setAvatarOpen] = useState(false);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Always clear the input's own value, success or not — otherwise
    // picking the exact same file a second time in a row (e.g. retrying
    // after a failed upload) wouldn't fire this handler at all, since
    // the input's value wouldn't have changed.
    e.target.value = '';
    if (!file) return;
    setAvatarError(null);
    setAvatarUploading(true);
    uploadFile(file)
      .then(({ url }) => onChangeAvatar(url))
      .catch((err) => {
        setAvatarError(err instanceof ApiError ? err.message : 'Upload failed — check your connection and try again.');
      })
      .finally(() => setAvatarUploading(false));
  };

  const handleRemoveAvatar = () => {
    setAvatarError(null);
    setAvatarUploading(true);
    onChangeAvatar(null)
      .catch(() => setAvatarError("Couldn't remove your photo — check your connection and try again."))
      .finally(() => setAvatarUploading(false));
  };

  const startEditing = () => {
    setDraftName(account.displayName);
    setDraftBio(account.bio);
    setSaveError(null);
    setIsEditing(true);
  };

  const saveEditing = () => {
    setSaving(true);
    setSaveError(null);
    onSaveProfile(draftName.trim() || account.displayName, draftBio.trim())
      .then(() => setIsEditing(false))
      .catch(() => setSaveError("Couldn't save — check your connection and try again."))
      .finally(() => setSaving(false));
  };

  const deletePost = (post: VideoPost) => {
    onDeletePost(post);
    setOpenMenuId(null);
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader
        title="Profile"
        onBack={onBack}
        backLabel="Back to shop"
        rightSlot={
          <button onClick={onOpenSettings} aria-label="Settings" className="text-text-mute hover:text-text">
            <Settings size={18} />
          </button>
        }
      />

      {/* Closes any open per-tile menu on an outside tap — same convention
          ProductDrawer/MoreMenu use for their own backdrops. */}
      {openMenuId && (
        <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} aria-hidden="true" />
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:px-10 lg:py-8">
          <div className="mb-6 flex items-start gap-4 lg:gap-5">
            {/* The avatar itself still opens the full-screen viewer —
                that's the existing behavior and stays the primary tap
                target — so changing the photo is a separate, smaller
                camera badge overlaid on its corner (same convention
                Instagram/WhatsApp use) rather than repurposing the
                whole circle, which would make "just look at my photo"
                and "replace my photo" the same accidental tap target. */}
            <div className="relative h-16 w-16 shrink-0 lg:h-20 lg:w-20">
              <button
                onClick={() => setAvatarOpen(true)}
                aria-label="View profile picture"
                className="h-full w-full overflow-hidden rounded-full bg-box"
              >
                <img
                  src={account.avatarUrl || '/images/placeholder.svg'}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </button>
              {avatarUploading && (
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                  <Loader2 size={18} className="animate-spin text-white" />
                </span>
              )}
              <input
                ref={avatarFileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarFileChange}
                className="hidden"
              />
              <button
                onClick={() => avatarFileInputRef.current?.click()}
                disabled={avatarUploading}
                aria-label="Change profile picture"
                className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-panel bg-hot-pink text-white disabled:opacity-60 lg:h-7 lg:w-7"
              >
                <Camera size={14} />
              </button>
            </div>
            <div className="min-w-0 flex-1">
              {account.avatarUrl && (
                <button
                  onClick={handleRemoveAvatar}
                  disabled={avatarUploading}
                  className="mb-1 block text-[12px] font-semibold text-text-mute underline decoration-dotted disabled:opacity-60"
                >
                  Remove profile picture
                </button>
              )}
              {avatarError && <p className="mb-1 text-[12px] text-hot-pink">{avatarError}</p>}
              {isEditing ? (
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="Display name"
                    disabled={saving}
                    className="w-full rounded-lg border border-line bg-white px-3 py-1.5 text-[14px] font-bold text-text focus:border-hot-pink focus:outline-none disabled:opacity-60"
                  />
                  <textarea
                    value={draftBio}
                    onChange={(e) => setDraftBio(e.target.value)}
                    placeholder="Add a short bio"
                    rows={2}
                    disabled={saving}
                    className="w-full resize-none rounded-lg border border-line bg-white px-3 py-1.5 text-[13.5px] text-text focus:border-hot-pink focus:outline-none disabled:opacity-60"
                  />
                  {saveError && <p className="text-[12.5px] font-medium text-hot-pink">{saveError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={saveEditing}
                      disabled={saving}
                      className="brand-gradient rounded-full px-3.5 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-60"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setIsEditing(false)}
                      disabled={saving}
                      className="rounded-full bg-white px-3.5 py-1.5 text-[12.5px] font-medium text-text-mute disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="truncate text-[15px] font-bold text-text lg:text-lg">{account.displayName}</p>
                  <p className="text-[13.5px] text-text-mute">{account.username}</p>
                  <p className="mt-1.5 text-[13.5px] leading-snug text-text-mute">{account.bio}</p>
                  <button
                    onClick={startEditing}
                    className="mt-2.5 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] font-bold text-text"
                  >
                    Edit profile
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="mb-6 flex gap-6 border-y border-line py-3 lg:gap-10">
            <div>
              <p className="text-[14px] font-bold text-text">{posts.length}</p>
              <p className="text-[12.5px] text-text-mute">Posts</p>
            </div>
            <button onClick={onOpenFollowers} className="text-left">
              <p className="text-[14px] font-bold text-text">{formatCount(account.followers)}</p>
              <p className="text-[12.5px] text-text-mute">Followers</p>
            </button>
            <button onClick={onOpenFollowing} className="text-left">
              <p className="text-[14px] font-bold text-text">{formatCount(account.following)}</p>
              <p className="text-[12.5px] text-text-mute">Following</p>
            </button>
          </div>

          {/* Buyer-facing counterpart to the merchant row below — what you
              bought, not what you're selling. Always shown, even with zero
              orders, so it doubles as a stable place to check "did that go
              through" rather than only appearing once something exists. */}
          <button
            onClick={onOpenOrders}
            className="mb-2.5 flex w-full items-center gap-3 rounded-xl border border-line bg-white p-3.5 text-left"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel">
              <Package size={18} className="text-text-mute" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-bold text-text">Your orders</span>
              <span className="block text-[12.5px] text-text-mute">
                {orderCount === 0
                  ? 'Nothing purchased yet'
                  : `${orderCount} order${orderCount === 1 ? '' : 's'} · track and manage`}
              </span>
            </span>
            <ChevronRight size={17} className="shrink-0 text-text-mute" />
          </button>

          {/* The seller-facing side lives entirely behind this one entry
              point — a personal profile never shows shop content directly,
              the way a personal Facebook profile doesn't show Page posts
              until you switch into managing the Page. */}
          <button
            onClick={merchantAccount ? onSwitchToMerchant : onOpenMerchantCreate}
            className="mb-6 flex w-full items-center gap-3 rounded-xl border border-line bg-white p-3.5 text-left"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel">
              <Briefcase size={18} className="text-text-mute" />
            </span>
            <span className="min-w-0 flex-1">
              {merchantAccount ? (
                <>
                  <span className="block truncate text-[13.5px] font-bold text-text">
                    {merchantAccount.businessName}
                  </span>
                  <span className="block text-[12.5px] text-text-mute">Switch to your business page</span>
                </>
              ) : (
                <>
                  <span className="block text-[13.5px] font-bold text-text">Create a professional account</span>
                  <span className="block text-[12.5px] text-text-mute">
                    Sell on the shop feed — separate from this profile
                  </span>
                </>
              )}
            </span>
            <ChevronRight size={17} className="shrink-0 text-text-mute" />
          </button>

          <div className="mb-3 flex items-center justify-between">
            <p className="text-[13.5px] font-bold text-text">Your posts</p>
            <button
              onClick={() => setUploading(true)}
              className="brand-gradient flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-bold text-white"
            >
              <Plus size={15} />
              Upload video
            </button>
          </div>

          {posts.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-mute">
              Nothing posted yet — anything you post, or repost, to Discover shows up here.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2 lg:grid-cols-4 xl:grid-cols-5">
              {posts.map((post) => (
                <div
                  key={post.id}
                  onClick={() => onOpenPost(post)}
                  role="button"
                  tabIndex={0}
                  className="relative aspect-[9/13] cursor-pointer overflow-hidden rounded-xl bg-[#2a2a28]"
                >
                  <PostThumbnail post={post} />
                  {post.repostId && (
                    <span className="absolute left-1.5 top-1.5 z-10 flex items-center gap-1 rounded-full bg-black/50 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      <Repeat2 size={13} />
                      Reposted
                    </span>
                  )}
                  <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 text-[11.5px] font-medium text-white">
                    <MessageCircle size={13} />
                    {formatCount(post.comments)}
                  </span>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId((id) => (id === post.id ? null : post.id));
                    }}
                    aria-label="Post options"
                    aria-expanded={openMenuId === post.id}
                    className="absolute right-1.5 top-1.5 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-black/50"
                  >
                    <MoreVertical size={15} className="text-white" />
                  </button>

                  {openMenuId === post.id && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-1.5 top-8 z-20 overflow-hidden rounded-lg bg-white shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
                    >
                      <button
                        onClick={() => deletePost(post)}
                        className="flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[12.5px] font-medium text-hot-pink"
                      >
                        <Trash2 size={14} />
                        {post.repostId ? 'Remove repost' : 'Delete post'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {uploading && (
        <UploadDiscoverPostModal
          posterName={account.displayName}
          interests={interests}
          onCancel={() => setUploading(false)}
          onSave={(post) => {
            onAddPost(post);
            setUploading(false);
          }}
        />
      )}

      {avatarOpen && (
        <AvatarViewer src={account.avatarUrl} name={account.displayName} onClose={() => setAvatarOpen(false)} />
      )}
    </div>
  );
}
