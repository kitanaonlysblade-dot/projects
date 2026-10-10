'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, MoreVertical, Pin, PinOff, Send, Smile, Trash2, X } from 'lucide-react';
import { formatCount, formatRelativeTime } from '@/lib/format';
import type { Comment, CommentReactor, ReactionType, VideoPost } from '@/lib/types';

// A small, curated grid rather than a full emoji-library picker — this
// app has no emoji-picker dependency anywhere else, and a fixed set of
// the reactions people actually use on a comment covers the ask (an
// emoji button on the composer) without pulling in a whole picker
// library + its data file for a prototype comment section.
const QUICK_EMOJIS = [
  '😀', '😂', '🥹', '😍', '😘', '🤩', '😎', '🙃',
  '😢', '😡', '🤔', '👀', '🙌', '👏', '🙏', '💯',
  '🔥', '✨', '🎉', '❤️', '🧡', '💛', '💚', '💙',
  '💜', '🖤', '👍', '👎', '😅', '😭', '🥳', '😴',
];

// Facebook's six reactions plus the plain thumbs-up, in the same order
// Facebook's own picker uses. `color` drives both the emoji-free "Like"
// text (grey when there's no reaction, this color once there is one)
// and the ring around the summary pill.
const REACTIONS: { key: ReactionType; emoji: string; label: string; color: string }[] = [
  { key: 'like', emoji: '👍', label: 'Like', color: '#2078f4' },
  { key: 'love', emoji: '❤️', label: 'Love', color: '#f33e58' },
  { key: 'care', emoji: '🥰', label: 'Care', color: '#f7b125' },
  { key: 'haha', emoji: '😆', label: 'Haha', color: '#f7b125' },
  { key: 'wow', emoji: '😮', label: 'Wow', color: '#f7b125' },
  { key: 'sad', emoji: '😢', label: 'Sad', color: '#f7b125' },
  { key: 'angry', emoji: '😡', label: 'Angry', color: '#e9710f' },
];
const REACTION_BY_KEY = Object.fromEntries(REACTIONS.map((r) => [r.key, r])) as Record<
  ReactionType,
  (typeof REACTIONS)[number]
>;

// One level of replies only, same as the backend model — a reply's
// parentId always points at the top-level comment, never at another
// reply (see add_comment on the backend: replying to a reply still
// files it under that reply's own top-level parent), so this is a
// plain two-tier grouping rather than a real tree.
function groupThreads(comments: Comment[]) {
  const topLevel: Comment[] = [];
  const repliesByParent = new Map<string, Comment[]>();
  for (const c of comments) {
    if (c.parentId) {
      const list = repliesByParent.get(c.parentId) ?? [];
      list.push(c);
      repliesByParent.set(c.parentId, list);
    } else {
      topLevel.push(c);
    }
  }
  // Replies read oldest-first within a thread, same as a real
  // conversation — newest-first would put the most recent reply above
  // the comment it's replying to.
  for (const list of repliesByParent.values()) {
    list.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  }
  return { topLevel, repliesByParent };
}

// Top few distinct reactions present, ordered by how many people picked
// each — what the little emoji-stack summary under a comment shows
// (Facebook shows up to 3 before falling back to just the count).
function topReactionEmojis(counts: Partial<Record<ReactionType, number>> | undefined): string[] {
  if (!counts) return [];
  return Object.entries(counts)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 3)
    .map(([key]) => REACTION_BY_KEY[key as ReactionType]?.emoji ?? '👍');
}

// Roughly the tray's own rendered size (7 buttons at h-7/w-7 + gaps +
// padding) — used only to clamp its position within the viewport before
// it's ever painted, not for actual layout.
const PICKER_WIDTH = 220;
const PICKER_HEIGHT = 40;
const EDGE_MARGIN = 8;

// Given the trigger button's own on-screen rect, works out a `{top,
// left}` for the tray that (a) stays fully inside the viewport
// horizontally regardless of how close to the left/right edge the
// button is (an indented reply on a narrow phone is exactly the case
// that used to push it half off-screen), and (b) opens above the
// button when there's room, or below it when there isn't (e.g. the
// very first comment in a short thread, with nothing above it).
function clampPickerPosition(anchor: DOMRect): { top: number; left: number } {
  const left = Math.min(Math.max(anchor.left, EDGE_MARGIN), window.innerWidth - PICKER_WIDTH - EDGE_MARGIN);
  const spaceAbove = anchor.top - EDGE_MARGIN;
  const top =
    spaceAbove >= PICKER_HEIGHT
      ? anchor.top - PICKER_HEIGHT - 6
      : Math.min(anchor.bottom + 6, window.innerHeight - PICKER_HEIGHT - EDGE_MARGIN);
  return { top, left };
}

// The floating reaction bar that appears on long-press (touch) or hover
// (mouse) over the Like button — tapping one sets that reaction,
// replacing whatever was there before.
//
// Rendered through a portal straight onto <body>, positioned with
// `fixed` + coordinates already measured and clamped by the caller
// (clampPickerPosition), rather than CSS-anchored (`absolute
// bottom-full left-0`) to the Like button. Two reasons: a CSS anchor
// only knows the button's own position, not how close that puts the
// tray's other edge to the screen edge, which is exactly what ran the
// tray off-screen on a narrow phone or an indented reply; and this
// panel's own mobile sheet animates with a CSS `transform`, which
// creates a new containing block for any `position: fixed` element
// nested inside it — so without the portal, "fixed" would actually
// resolve relative to that sheet, not the viewport, undermining the
// clamped coordinates anyway.
function ReactionPicker({
  onPick,
  onClose,
  position,
  onMouseEnter,
  onMouseLeave,
}: {
  onPick: (reaction: ReactionType) => void;
  onClose: () => void;
  position: { top: number; left: number };
  // The tray is portaled onto <body>, so — unlike a CSS-anchored
  // `position: absolute` child would be — it's no longer a DOM
  // descendant of the Like button's hoverable wrapper. Without these,
  // moving the mouse from the button up onto the tray leaves the
  // wrapper first and closes the tray before the pointer ever reaches
  // it. CommentRow runs both through a short shared grace timer so
  // hovering either one (or the gap between them, briefly) keeps it
  // open — see that timer's own comment.
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      {/* Tapping anywhere else closes the tray — the same convention
          the emoji/reactors overlays elsewhere in this panel use. */}
      <button aria-label="Close reaction picker" onClick={onClose} className="fixed inset-0 z-[65] cursor-default" />
      <div
        className="fixed z-[66] flex items-center gap-0.5 rounded-full bg-white px-1.5 py-1 shadow-[0_4px_16px_rgba(0,0,0,0.22)]"
        style={{ top: position.top, left: position.left }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        // Stop a tap that lands on the bar itself from also bubbling
        // up to the full-screen backdrop right behind it.
        onPointerDown={(e) => e.stopPropagation()}
      >
        {REACTIONS.map((r) => (
          <button
            key={r.key}
            onClick={() => onPick(r.key)}
            aria-label={r.label}
            title={r.label}
            className="flex h-9 w-9 items-center justify-center rounded-full text-base transition-transform hover:-translate-y-1 hover:scale-125"
          >
            {r.emoji}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}

interface CommentRowProps {
  comment: Comment;
  isReply?: boolean;
  isOwn: boolean;
  isPostOwner: boolean;
  onReact: (comment: Comment, reaction: ReactionType) => void;
  onRemoveReaction: (comment: Comment) => void;
  onShowReactors: (commentId: string) => void;
  onReply: (comment: Comment) => void;
  onPin: () => void;
  onUnpin: () => void;
  repliesCount?: number;
  repliesExpanded?: boolean;
  onToggleReplies?: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (text: string) => void;
  onDelete: () => void;
}

function CommentRow({
  comment,
  isReply,
  isOwn,
  isPostOwner,
  onReact,
  onRemoveReaction,
  onShowReactors,
  onReply,
  onPin,
  onUnpin,
  repliesCount,
  repliesExpanded,
  onToggleReplies,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: CommentRowProps) {
  const myReaction = comment.myReaction ?? (comment.likedByMe ? 'like' : null) ?? null;
  const reactionMeta = myReaction ? REACTION_BY_KEY[myReaction] : null;
  const reactionEmojis = topReactionEmojis(comment.reactionCounts);
  const totalReactions = comment.likes;

  // Local draft while editing — separate from comment.text so typing
  // doesn't touch the real comment (and therefore the rest of the
  // thread's optimistic state) until Save actually commits it. Reset
  // fresh each time editing starts, same as CommentComposer clearing
  // itself after a post.
  const [draft, setDraft] = useState(comment.text);
  useEffect(() => {
    if (isEditing) setDraft(comment.text);
  }, [isEditing, comment.text]);

  // Reaction bar: opens on hover (desktop) or a ~380ms long-press
  // (touch), closes on pointer-up-elsewhere or picking one. Position is
  // measured off the Like button itself and clamped to the viewport —
  // see clampPickerPosition's own comment on why a plain CSS anchor
  // isn't enough here.
  const [pickerPosition, setPickerPosition] = useState<{ top: number; left: number } | null>(null);
  const likeButtonRef = useRef<HTMLButtonElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A native `click` fires after *every* completed press-and-release,
  // long or short — so a long-press that opens the tray still gets
  // followed by its own click on the same button a moment later. Without
  // this flag, that trailing click ran handleLikeTap's plain-Like
  // toggle right after the tray opened, which is what made reacting
  // again after clearing a reaction look like it "skipped" the tray
  // and went straight to a plain Like: the tray was there, but the
  // click immediately underneath it had already changed the reaction
  // before anyone could tap an emoji in it.
  const suppressNextClick = useRef(false);

  const openPicker = () => {
    const rect = likeButtonRef.current?.getBoundingClientRect();
    setPickerPosition(rect ? clampPickerPosition(rect) : { top: EDGE_MARGIN, left: EDGE_MARGIN });
  };

  // Short grace period before actually closing on mouse-leave, shared
  // by the Like button's wrapper and the portaled tray itself — see
  // ReactionPicker's own comment on why leaving either one can't just
  // close it immediately. Re-entering either one within the window
  // (e.g. crossing the small gap between the button and the tray above
  // it) cancels the pending close.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelScheduledClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelScheduledClose();
    closeTimer.current = setTimeout(() => setPickerPosition(null), 150);
  };

  useEffect(
    () => () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const startLongPress = () => {
    longPressTimer.current = setTimeout(() => {
      suppressNextClick.current = true;
      openPicker();
    }, 380);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const handleLikeTap = () => {
    if (suppressNextClick.current) {
      // This click is the tail end of the long-press gesture that just
      // opened the tray, not a separate tap — consume it silently and
      // leave the tray open for an actual pick.
      suppressNextClick.current = false;
      return;
    }
    // A quick tap toggles the default "Like" reaction off if any
    // reaction is already set, or on if there wasn't one — same as
    // tapping the Like button (not opening the picker) does on
    // Facebook regardless of which colored reaction was showing.
    if (myReaction) onRemoveReaction(comment);
    else onReact(comment, 'like');
  };

  const canPin = isPostOwner && !isReply;

  return (
    <div className={`flex gap-2.5 ${isReply ? 'pl-[38px]' : ''}`}>
      <span
        className={`shrink-0 rounded-full bg-box bg-cover bg-center ${isReply ? 'h-6 w-6' : 'h-9 w-9'}`}
        style={comment.authorAvatarUrl ? { backgroundImage: `url(${comment.authorAvatarUrl})` } : undefined}
      />
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <>
            <p className="text-[13.5px] font-semibold text-text">{comment.author}</p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              rows={2}
              maxLength={1000}
              className="mt-1 w-full resize-none rounded-lg border border-line px-2.5 py-1.5 text-[13.5px] text-text focus:border-hot-pink focus:outline-none"
            />
            <div className="mt-1.5 flex items-center gap-3">
              <button
                onClick={() => draft.trim() && onSaveEdit(draft.trim())}
                disabled={!draft.trim()}
                className="text-[12px] font-bold text-hot-pink disabled:opacity-40"
              >
                Save
              </button>
              <button onClick={onCancelEdit} className="text-[12px] font-semibold text-text-mute">
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 rounded-2xl bg-panel px-3 py-1.5">
                <div className="flex items-center gap-1.5">
                  <p className="text-[13.5px] font-semibold text-text">{comment.author}</p>
                  {comment.isPinned && (
                    <span className="flex items-center gap-0.5 text-[11px] font-semibold text-text-mute">
                      <Pin size={9} className="fill-current" /> Pinned
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[13.5px] leading-snug text-text-mute">
                  {comment.replyToName && (
                    <span className="mr-1 font-semibold text-[#2078f4]">@{comment.replyToName}</span>
                  )}
                  {comment.text}
                  {comment.pending && <span className="ml-1 text-[11.5px] text-text-mute">Posting…</span>}
                </p>
              </div>
              {(isOwn || canPin) && (
                <div className="relative shrink-0">
                  <button
                    onClick={onToggleMenu}
                    aria-label="Comment options"
                    aria-expanded={menuOpen}
                    className="-mt-0.5 -mr-1 p-1 text-text-mute"
                  >
                    <MoreVertical size={14} />
                  </button>
                  {menuOpen && (
                    <>
                      {/* Same click-outside-closes convention as MerchantPosts/
                          ProfileScreen's own per-row menus. */}
                      <div className="fixed inset-0 z-10" onClick={onCloseMenu} aria-hidden="true" />
                      <div className="absolute right-0 top-5 z-20 overflow-hidden rounded-lg bg-white shadow-[0_4px_16px_rgba(0,0,0,0.25)]">
                        {isOwn && (
                          <button
                            onClick={() => {
                              onStartEdit();
                              onCloseMenu();
                            }}
                            className="block w-full whitespace-nowrap px-3 py-2 text-left text-[12.5px] font-medium text-text"
                          >
                            Edit
                          </button>
                        )}
                        {canPin && (
                          <button
                            onClick={() => {
                              (comment.isPinned ? onUnpin : onPin)();
                              onCloseMenu();
                            }}
                            className="flex w-full items-center gap-1.5 whitespace-nowrap px-3 py-2 text-left text-[12.5px] font-medium text-text"
                          >
                            {comment.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                            {comment.isPinned ? 'Unpin comment' : 'Pin comment'}
                          </button>
                        )}
                        {(isOwn || isPostOwner) && (
                          <button
                            onClick={() => {
                              onDelete();
                              onCloseMenu();
                            }}
                            className="flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[12.5px] font-medium text-hot-pink"
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Inline `style` here (not just the matching Tailwind classes)
                is deliberate belt-and-suspenders: this row's horizontal
                layout must not depend on Tailwind's class generation
                picking up every utility used inside it, so it's forced
                via the style attribute directly, which the browser
                always honors regardless of the CSS build. */}
            <div
              className="mt-1 flex flex-nowrap items-center gap-3 pl-1"
              style={{
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'nowrap',
                alignItems: 'center',
                gap: '12px',
                // Fixes each item's box to the same height regardless of
                // its own content — without this, a button whose text
                // includes an emoji (the reaction label below) can end
                // up a pixel or two taller than a plain-text sibling
                // (emoji glyphs carry their own line-height metrics that
                // differ from the surrounding Latin text), so even
                // `align-items: center` centers it against a slightly
                // different box and the two visibly don't share a
                // baseline. Pinning height + lineHeight here and on
                // every child below removes that source of drift
                // entirely rather than relying on the browser's default
                // per-glyph metrics to happen to agree.
                height: '18px',
                lineHeight: '18px',
              }}
            >
              <span
                className="shrink-0 whitespace-nowrap text-[11.5px] text-text-mute"
                style={{ flexShrink: 0, whiteSpace: 'nowrap', lineHeight: '18px' }}
              >
                {formatRelativeTime(comment.createdAt ?? '')}
              </span>

              <div
                className="relative flex shrink-0 items-center"
                style={{
                  position: 'relative',
                  flexShrink: 0,
                  // This div — not the button inside it — is the row's
                  // actual flex item (it exists to anchor the reaction
                  // tray's position, wrapping the button). Left as a
                  // plain block element, the button inside it rendered
                  // with the browser's own default button box model
                  // (its own padding/line-height) instead of the shared
                  // 18px line every other item in this row is pinned
                  // to — which threw off the plain "Like" text too, not
                  // only the emoji reaction labels. Making this div
                  // itself a flex container with the same fixed height
                  // closes that gap at every level of nesting, not just
                  // the button's own styling.
                  display: 'flex',
                  alignItems: 'center',
                  height: '18px',
                }}
                onMouseEnter={() => {
                  cancelScheduledClose();
                  openPicker();
                }}
                onMouseLeave={scheduleClose}
              >
                {pickerPosition && (
                  <ReactionPicker
                    position={pickerPosition}
                    onClose={() => {
                      cancelScheduledClose();
                      setPickerPosition(null);
                    }}
                    onMouseEnter={cancelScheduledClose}
                    onMouseLeave={scheduleClose}
                    onPick={(reaction) => {
                      cancelScheduledClose();
                      onReact(comment, reaction);
                      setPickerPosition(null);
                    }}
                  />
                )}
                <button
                  ref={likeButtonRef}
                  onClick={handleLikeTap}
                  onPointerDown={startLongPress}
                  onPointerUp={cancelLongPress}
                  onPointerLeave={cancelLongPress}
                  aria-pressed={!!myReaction}
                  aria-label={reactionMeta ? `Remove ${reactionMeta.label} reaction` : 'Like comment'}
                  className="flex items-center whitespace-nowrap text-[12px] font-bold transition-transform active:scale-90"
                  style={{
                    color: reactionMeta ? reactionMeta.color : '#6b6b6b',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    height: '18px',
                    lineHeight: '18px',
                  }}
                >
                  {reactionMeta ? (
                    <>
                      {/* The emoji gets its own line-height/height,
                          separate from the label text next to it — see
                          this row's own comment on why an emoji glyph
                          can't just share a plain-text sibling's box and
                          land on the same visual line by default. */}
                      <span style={{ lineHeight: '18px', height: '18px', display: 'inline-flex', alignItems: 'center' }}>
                        {reactionMeta.emoji}
                      </span>
                      <span style={{ marginLeft: '3px' }}>{reactionMeta.label}</span>
                    </>
                  ) : (
                    'Like'
                  )}
                </button>
              </div>

              <button
                onClick={() => onReply(comment)}
                className="shrink-0 whitespace-nowrap text-[12px] font-bold text-text-mute"
                style={{ flexShrink: 0, whiteSpace: 'nowrap', lineHeight: '18px' }}
              >
                Reply
              </button>

              {totalReactions > 0 && (
                <button
                  onClick={() => onShowReactors(comment.id)}
                  className="ml-auto flex shrink-0 items-center gap-1 overflow-hidden rounded-full bg-panel px-1.5 py-0.5 text-[11.5px] text-text-mute"
                  style={{ marginLeft: 'auto', display: 'flex', flexShrink: 0, alignItems: 'center' }}
                >
                  <span className="flex -space-x-1">
                    {reactionEmojis.map((e, i) => (
                      <span key={i} className="text-[12.5px] leading-none">
                        {e}
                      </span>
                    ))}
                  </span>
                  {formatCount(totalReactions)}
                </button>
              )}
            </div>

            {!isReply && !!repliesCount && (
              <button
                onClick={onToggleReplies}
                className="mt-2 flex items-center gap-1.5 pl-1 text-[12px] font-semibold text-text-mute"
              >
                <span className="h-px w-6 bg-line" />
                {repliesExpanded ? 'Hide replies' : `View ${formatCount(repliesCount)} ${repliesCount === 1 ? 'reply' : 'replies'}`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type SortMode = 'relevant' | 'newest';

function CommentList({
  comments,
  currentUserId,
  isPostOwner,
  onReact,
  onRemoveReaction,
  onShowReactors,
  onReply,
  onPin,
  onUnpin,
  onEditComment,
  onDeleteComment,
  expandedThreads,
  onToggleThread,
}: {
  comments: Comment[];
  currentUserId?: string;
  isPostOwner: boolean;
  onReact: (comment: Comment, reaction: ReactionType) => void;
  onRemoveReaction: (comment: Comment) => void;
  onShowReactors: (commentId: string) => void;
  onReply: (comment: Comment) => void;
  onPin: (commentId: string) => void;
  onUnpin: (commentId: string) => void;
  onEditComment: (commentId: string, text: string) => void;
  onDeleteComment: (commentId: string) => void;
  expandedThreads: Record<string, boolean>;
  onToggleThread: (commentId: string) => void;
}) {
  const [sort, setSort] = useState<SortMode>('relevant');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  // Only one row's ⋮ menu (or edit field) open at a time, same
  // single-id-not-a-set convention MerchantPosts/ProfileScreen use for
  // their own per-tile menus.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { topLevel, repliesByParent, pinned } = useMemo(() => {
    const { topLevel: all, repliesByParent } = groupThreads(comments);
    const pinnedComment = all.find((c) => c.isPinned) ?? null;
    const rest = all.filter((c) => c.id !== pinnedComment?.id);
    const sorted = [...rest].sort((a, b) => {
      if (sort === 'newest') return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
      // "Most relevant": most-reacted first, ties broken by newest —
      // a simple stand-in for Facebook's real relevance ranking.
      const byLikes = b.likes - a.likes;
      return byLikes !== 0 ? byLikes : (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    });
    return { topLevel: sorted, repliesByParent, pinned: pinnedComment };
  }, [comments, sort]);

  if (topLevel.length === 0 && !pinned) {
    return <p className="py-8 text-center text-sm text-text-mute">No comments yet — be the first.</p>;
  }

  const rowProps = (c: Comment) => ({
    isOwn: !!currentUserId && c.authorId === currentUserId,
    isPostOwner,
    onReact,
    onRemoveReaction,
    onShowReactors,
    onPin: () => onPin(c.id),
    onUnpin: () => onUnpin(c.id),
    menuOpen: openMenuId === c.id,
    onToggleMenu: () => setOpenMenuId((prev) => (prev === c.id ? null : c.id)),
    onCloseMenu: () => setOpenMenuId(null),
    isEditing: editingId === c.id,
    onStartEdit: () => setEditingId(c.id),
    onCancelEdit: () => setEditingId(null),
    onSaveEdit: (text: string) => {
      onEditComment(c.id, text);
      setEditingId(null);
    },
    onDelete: () => onDeleteComment(c.id),
  });

  const renderThread = (c: Comment) => {
    const replies = repliesByParent.get(c.id) ?? [];
    // A thread with a reply that's still `pending` (just posted) shows
    // expanded regardless of the saved state — page.tsx also flips
    // expandedThreads[id] true the moment a reply is sent, but this is
    // a belt-and-suspenders fallback so a freshly-posted reply is never
    // hidden behind "View replies" even if that update raced this
    // render.
    const hasPendingReply = replies.some((r) => r.pending);
    const isExpanded = (expandedThreads[c.id] ?? false) || hasPendingReply;
    return (
      <div key={c.id} className="flex flex-col gap-3">
        <CommentRow
          comment={c}
          onReply={onReply}
          // Always the length of whatever's actually loaded, never
          // c.repliesCount from the server — that field can only ever
          // be as fresh as the last full fetch, while this array is
          // updated the instant a reply is optimistically added here,
          // so trusting the stale count instead of what's really in
          // front of us is exactly the kind of gap that makes a toggle
          // look like it disappeared even though a reply is visibly
          // sitting right there.
          repliesCount={replies.length}
          repliesExpanded={isExpanded}
          onToggleReplies={() => onToggleThread(c.id)}
          {...rowProps(c)}
        />
        {isExpanded &&
          replies.map((r) => <CommentRow key={r.id} comment={r} isReply onReply={onReply} {...rowProps(r)} />)}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="relative flex justify-end">
        <button
          onClick={() => setSortMenuOpen((v) => !v)}
          className="flex items-center gap-1 text-[12px] font-semibold text-text-mute"
        >
          {sort === 'relevant' ? 'Most relevant' : 'Newest'}
          <ChevronDown size={13} />
        </button>
        {sortMenuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setSortMenuOpen(false)} aria-hidden="true" />
            <div className="absolute right-0 top-5 z-20 overflow-hidden rounded-lg bg-white shadow-[0_4px_16px_rgba(0,0,0,0.25)]">
              {(['relevant', 'newest'] as SortMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    setSort(mode);
                    setSortMenuOpen(false);
                  }}
                  className={`block w-full whitespace-nowrap px-3 py-2 text-left text-[12.5px] font-medium ${
                    sort === mode ? 'text-hot-pink' : 'text-text'
                  }`}
                >
                  {mode === 'relevant' ? 'Most relevant' : 'Newest'}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {pinned && renderThread(pinned)}
      {topLevel.map(renderThread)}
    </div>
  );
}

interface ReplyTarget {
  id: string;
  author: string;
}

// Pinned to the bottom of whichever container it's in (desktop panel or
// mobile sheet) — same input, same behavior, both places.
function CommentComposer({
  onSubmit,
  replyingTo,
  onCancelReply,
  currentUserAvatarUrl,
}: {
  onSubmit: (text: string) => void;
  replyingTo: ReplyTarget | null;
  onCancelReply: () => void;
  currentUserAvatarUrl?: string;
}) {
  const [value, setValue] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Jumping into "reply" mode should put the cursor straight in the
  // field — mirrors what tapping Reply on any real comment thread does.
  useEffect(() => {
    if (replyingTo) inputRef.current?.focus();
  }, [replyingTo]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue('');
    setEmojiOpen(false);
  };

  // Inserts at the cursor (falling back to the end) rather than always
  // appending, so picking an emoji mid-sentence doesn't shove it to the
  // back of whatever's already typed.
  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + emoji + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el?.focus();
      const caret = start + emoji.length;
      el?.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="relative shrink-0 border-t border-line bg-white">
      {replyingTo && (
        <div className="flex items-center justify-between px-[18px] pt-2 text-[12px] text-text-mute">
          <span>
            Replying to <span className="font-semibold text-text">{replyingTo.author}</span>
          </span>
          <button onClick={onCancelReply} aria-label="Cancel reply" className="p-1">
            <X size={14} />
          </button>
        </div>
      )}

      {emojiOpen && (
        <>
          {/* Transparent, click-anywhere-outside-closes backdrop — sits
              under the panel itself but above everything else, same
              purpose a real picker's outside-click handler serves. */}
          <button
            aria-label="Close emoji picker"
            onClick={() => setEmojiOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute bottom-full left-0 right-0 z-50 max-h-[180px] overflow-y-auto border-t border-line bg-white p-3">
            <div className="grid grid-cols-8 gap-1">
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => insertEmoji(emoji)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-lg hover:bg-panel"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="flex items-center gap-2 px-[18px] py-3">
        <span
          className="h-9 w-9 shrink-0 rounded-full bg-box bg-cover bg-center"
          style={currentUserAvatarUrl ? { backgroundImage: `url(${currentUserAvatarUrl})` } : undefined}
        />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder={replyingTo ? `Reply to ${replyingTo.author}...` : 'Add a comment...'}
          className="min-w-0 flex-1 rounded-full border border-line bg-panel px-3.5 py-2 text-[13.5px] text-text placeholder:text-text-mute focus:border-hot-pink focus:bg-white focus:outline-none"
        />
        <button
          onClick={() => setEmojiOpen((open) => !open)}
          aria-label="Add emoji"
          aria-pressed={emojiOpen}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            emojiOpen ? 'bg-panel text-hot-pink' : 'text-text-mute'
          }`}
        >
          <Smile size={18} />
        </button>
        <button
          onClick={submit}
          disabled={!value.trim()}
          aria-label="Post comment"
          className="brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-40"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}

// The sheet opened by tapping a reaction summary — who reacted, and
// with which emoji. A thin overlay rather than a routed screen, same
// weight as the emoji picker above.
function ReactorsSheet({
  reactors,
  loading,
  onClose,
}: {
  reactors: CommentReactor[];
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 max-h-[70vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-bold text-text">Reactions</p>
          <button onClick={onClose} aria-label="Close" className="p-1 text-text-mute">
            <X size={16} />
          </button>
        </div>
        {loading && <p className="py-6 text-center text-[12.5px] text-text-mute">Loading…</p>}
        {!loading && reactors.length === 0 && (
          <p className="py-6 text-center text-[12.5px] text-text-mute">No reactions yet.</p>
        )}
        <div className="flex flex-col gap-3">
          {reactors.map((r) => (
            <div key={r.id} className="flex items-center gap-2.5">
              <span className="relative shrink-0">
                <span
                  className="block h-9 w-9 rounded-full bg-box bg-cover bg-center"
                  style={r.avatarUrl ? { backgroundImage: `url(${r.avatarUrl})` } : undefined}
                />
                <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[11.5px] shadow">
                  {REACTION_BY_KEY[r.reaction]?.emoji ?? '👍'}
                </span>
              </span>
              <p className="text-[13.5px] font-medium text-text">{r.displayName}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface CommentsPanelProps {
  post: VideoPost;
  comments: Comment[];
  currentUserId?: string;
  currentUserAvatarUrl?: string;
  isPostOwner: boolean;
  onAddComment: (postId: string, text: string, parentId?: string) => void;
  onReactToComment: (comment: Comment, reaction: ReactionType) => void;
  onRemoveCommentReaction: (comment: Comment) => void;
  onShowReactors: (commentId: string) => void;
  reactors: CommentReactor[];
  reactorsLoading: boolean;
  reactorsFor: string | null;
  onCloseReactors: () => void;
  onPinComment: (commentId: string) => void;
  onUnpinComment: (commentId: string) => void;
  onEditComment: (commentId: string, text: string) => void;
  onDeleteComment: (commentId: string) => void;
  expandedThreads: Record<string, boolean>;
  onToggleThread: (commentId: string) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

// Two snap heights for the mobile/tablet sheet, as a fraction of the
// viewport — never the full 100%, so a sliver of video stays visible even
// fully expanded. That's deliberate: it's what keeps this reading as
// "commenting on the video" instead of "left to a comments page." Dragging
// below MIN closes the sheet outright, from either snap.
const DEFAULT_RATIO = 0.65;
const EXPANDED_RATIO = 0.92;
const MIN_RATIO = 0.3;

// Comments are core to discover content (this app already treats it as
// discussion content — shop mode drops the comment icon entirely, discover
// keeps it), so unlike the "You may also like" sidebar we removed earlier,
// this one earns a permanent spot on desktop rather than being tucked
// behind a click. Mobile/tablet still gets it behind a tap, since there's
// no spare width to give it there — same bottom-sheet mechanics as
// ProductDrawer elsewhere in the app, extended with a second snap point so
// a long thread has somewhere to expand to without going full-screen.
//
// This component is remounted per post (page.tsx keys it by post id), so
// switching to a different video correctly shows that video's own
// comments, not a leftover thread from whatever you were just watching.
// `comments` and `expandedThreads` both come from page.tsx's shared state
// (keyed by post id / comment id) rather than local state here — a local
// copy would reset to the seed data every time this component remounts,
// which also happens if you swipe away from a post and back to that
// *same* post later, and a locally-collapsed thread is exactly what made
// a just-posted reply look like it "didn't show" before this was lifted.
//
// Full Facebook-style thread now: seven reactions (long-press/hover the
// Like button), a reaction summary that opens who-reacted, pinned
// comments (post owner only), a Most relevant/Newest sort, and replies
// that can themselves be replied to with an @mention while still nesting
// only one level deep.
export function CommentsPanel({
  post,
  comments,
  currentUserId,
  currentUserAvatarUrl,
  isPostOwner,
  onAddComment,
  onReactToComment,
  onRemoveCommentReaction,
  onShowReactors,
  reactors,
  reactorsLoading,
  reactorsFor,
  onCloseReactors,
  onPinComment,
  onUnpinComment,
  onEditComment,
  onDeleteComment,
  expandedThreads,
  onToggleThread,
  mobileOpen,
  onMobileClose,
}: CommentsPanelProps) {
  const [snap, setSnap] = useState<'default' | 'expanded'>('default');
  // Live height (px) while a drag is in progress; null means "not currently
  // dragging, use the resting snap height instead."
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ clientY: number; startHeight: number } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [replyingTo, setReplyingTo] = useState<ReplyTarget | null>(null);

  // Always reopen collapsed, never stuck expanded from last time — and
  // drop any in-progress reply target, same reasoning: a fresh open of
  // this post's thread shouldn't still be "replying to" whatever was
  // being answered on a previous visit.
  useEffect(() => {
    if (!mobileOpen) {
      setSnap('default');
      setReplyingTo(null);
    }
  }, [mobileOpen]);

  // A different post's thread should never inherit a reply target from
  // whichever comment was being answered on the last one.
  useEffect(() => {
    setReplyingTo(null);
  }, [post.id]);

  const handleAddComment = (text: string) => {
    onAddComment(post.id, text, replyingTo?.id);
    setReplyingTo(null);
  };

  const handleReply = (comment: Comment) => {
    setReplyingTo({ id: comment.id, author: comment.author });
  };

  // Pointer Capture (not plain onPointerMove) so the drag keeps tracking
  // even if the finger moves faster than the handle's small hit area —
  // without it, a quick swipe can outrun the element and silently drop
  // the gesture partway through. Same technique ProductDrawer uses.
  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const startHeight = sheetRef.current?.getBoundingClientRect().height ?? window.innerHeight * DEFAULT_RATIO;
    dragStartRef.current = { clientY: e.clientY, startHeight };
    setIsDragging(true);
  };

  const handlePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    // Finger moving up (clientY decreasing) should make the sheet taller.
    const delta = start.clientY - e.clientY;
    const next = Math.max(0, Math.min(start.startHeight + delta, window.innerHeight * EXPANDED_RATIO));
    setDragHeight(next);
  };

  const handlePointerUp = () => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    setIsDragging(false);
    if (!start || dragHeight === null) return;

    const vh = window.innerHeight;
    if (dragHeight < vh * MIN_RATIO) {
      onMobileClose();
    } else {
      const midpoint = (vh * DEFAULT_RATIO + vh * EXPANDED_RATIO) / 2;
      setSnap(dragHeight > midpoint ? 'expanded' : 'default');
    }
    setDragHeight(null);
  };

  // Tapping (rather than dragging) the handle steps down one level at a
  // time — expanded collapses to default, default closes — mirroring what
  // a short drag in the same direction would do.
  const handleHandleTap = () => {
    if (snap === 'expanded') setSnap('default');
    else onMobileClose();
  };

  const heading = `${formatCount(post.comments)} comment${post.comments === 1 ? '' : 's'}`;

  const listProps = {
    comments,
    currentUserId,
    isPostOwner,
    onReact: onReactToComment,
    onRemoveReaction: onRemoveCommentReaction,
    onShowReactors,
    onReply: handleReply,
    onPin: onPinComment,
    onUnpin: onUnpinComment,
    onEditComment,
    onDeleteComment,
    expandedThreads,
    onToggleThread,
  };

  return (
    <>
      <aside className="hidden w-[320px] shrink-0 flex-col border-l border-line bg-white lg:flex">
        <p className="shrink-0 px-[18px] pb-3 pt-4 text-sm font-bold text-text lg:pt-5">{heading}</p>
        <div className="flex-1 overflow-y-auto px-[18px] pb-4">
          <CommentList {...listProps} />
        </div>
        <CommentComposer
          onSubmit={handleAddComment}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          currentUserAvatarUrl={currentUserAvatarUrl}
        />
      </aside>

      {/* Mobile/tablet: height (not transform) drives the two-snap resize,
          so the drag directly maps to "how tall is the sheet right now" —
          transform is reserved for the separate open/closed toggle, which
          doesn't care about height at all since it's fully off-screen
          either way. Both are inline (not Tailwind classes) so the live
          drag value can override the resting snap height for exactly the
          duration of the gesture. */}
      <div
        ref={sheetRef}
        className={`fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t border-line bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.08)] lg:hidden ${
          mobileOpen ? '' : 'pointer-events-none'
        }`}
        style={{
          height: isDragging && dragHeight !== null ? dragHeight : `${(snap === 'expanded' ? EXPANDED_RATIO : DEFAULT_RATIO) * 100}vh`,
          transform: mobileOpen ? 'translateY(0)' : 'translateY(100%)',
          transition: isDragging ? 'none' : 'height 300ms ease-out, transform 300ms ease-out',
        }}
      >
        <button
          onClick={handleHandleTap}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          aria-expanded={mobileOpen}
          aria-label={snap === 'expanded' ? 'Collapse comments' : 'Close comments'}
          className="flex w-full shrink-0 touch-none flex-col items-center gap-1.5 py-2.5"
        >
          <span className="h-1 w-10 rounded-full bg-box" />
          <span className="text-[11.5px] text-text-mute">
            {snap === 'expanded' ? 'Swipe down to collapse' : 'Swipe up for more'}
          </span>
        </button>
        <p className="shrink-0 px-[18px] pb-2 text-sm font-bold text-text">{heading}</p>
        <div className="flex-1 overflow-y-auto px-[18px] pb-2">
          <CommentList {...listProps} />
        </div>
        <CommentComposer
          onSubmit={handleAddComment}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          currentUserAvatarUrl={currentUserAvatarUrl}
        />
      </div>

      {reactorsFor && <ReactorsSheet reactors={reactors} loading={reactorsLoading} onClose={onCloseReactors} />}
    </>
  );
}
