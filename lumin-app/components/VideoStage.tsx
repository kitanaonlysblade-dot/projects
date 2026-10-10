'use client';

import { noteWatched, setPlaybackMs } from '@/lib/playbackTime';
import { useEffect, useRef, useState, type MouseEvent, type WheelEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Bookmark,
  Flag,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Repeat2,
  ScanSearch,
  Search as SearchIcon,
  Sparkles,
  Share2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { Notification, VideoPost } from '@/lib/types';
import { formatCount } from '@/lib/format';
import { MoreMenu } from './MoreMenu';
import { TwinPins } from './TwinPins';
import { ReportVideoSheet } from './ReportVideoSheet';
import { ShareSheet } from './ShareSheet';
import { useLuminLite } from '@/lib/lite';
import { ViewTracker } from '@/lib/viewTracking';

// Must match the section's desktop padding below (lg:p-4 = 16px per side).
// Only used in the desktop sizing branch — mobile/tablet is full-bleed.
const STAGE_PADDING = 32;

interface VideoStageProps {
  post: VideoPost;
  mode: 'shop' | 'discover';
  onBack?: () => void;
  overlayVisible: boolean;
  onToggleOverlay: () => void;
  onVideoEnded: () => void;
  // Move to the next/previous post via swipe (touch) or scroll (desktop
  // wheel), same gesture a TikTok/Reels feed uses — on top of tapping a
  // tile in the discover drawer/sheet. Optional because shop mode didn't
  // always have more than one post to move between; the caller only
  // passes these when there's somewhere to go.
  onSwipeNext?: () => void;
  onSwipePrev?: () => void;
  // Discover mode only — opens CommentsPanel's mobile/tablet sheet when
  // the comment icon is tapped (desktop shows the panel permanently, so
  // this is a no-op there in practice).
  onOpenComments?: () => void;
  onOpenProfile: () => void;
  // Tapping a poster's name/avatar opens *their* profile, not the
  // viewer's own — a distinct callback from onOpenProfile above, which is
  // only ever wired to the current user's own account access (NavBar/
  // MoreMenu). Receives just the three fields page.tsx's handleViewPoster
  // actually needs (name/avatar/id) rather than the full VideoPost — a
  // real post satisfies this structurally either way, but the repost
  // badge below needs to point at the *reposter*, who only ever has
  // these three fields available (see VideoPost.repostedBy), not a
  // whole post.
  onViewPoster: (poster: { posterName: string; posterAvatar?: string; posterId?: string }) => void;
  onOpenSettings: () => void;
  onOpenWatchlist: () => void;
  onOpenCart: () => void;
  onOpenNotifications: () => void;
  onOpenSearch: () => void;
  // Discover only: clip a moment of this video and find the product in it (twin search).
  onVisualSearch?: () => void;
  // Shop only: the Wanted board (what shoppers are asking for that nobody has twinned yet).
  onOpenWanted?: () => void;
  notifications: Notification[];
  unreadNotificationCount: number;
  isSaved: boolean;
  onToggleSave: () => void;
  isLiked: boolean;
  onToggleLike: () => void;
  // Opens the "who's liked this" list (FollowListScreen in app/page.tsx)
  // — a separate tap target from the heart icon itself, same as
  // Instagram: tapping the icon toggles your own like, tapping the
  // count opens the list.
  onOpenLikers: () => void;
  isShared: boolean;
  onToggleShare: () => void;
  // Same undefined-means-hide-it convention as onToggleFollow just
  // below — false only for the viewer's own post (see canRepostFor in
  // page.tsx). Threaded straight through to ShareSheet's own props of
  // the same name.
  canRepost: boolean;
  isReposted: boolean;
  onRepost: () => void;
  defaultMuted: boolean;
  // undefined onToggleFollow means "don't show a Follow button at all" —
  // see followPropsFor in page.tsx for the two cases that means (no real
  // poster id behind this post, or it's the viewer's own).
  isFollowing: boolean;
  onToggleFollow?: () => void;
  // Mobile/tablet only: reports the current pixel height of the bottom
  // poster/caption block so the floating "Shop this video" pill (rendered
  // by ProductDrawer, outside this component) can sit just above it
  // instead of on top of it when the block grows (repost label, two-line
  // caption, "See more"). Only passed for the stage actually on screen.
  onCaptionHeightChange?: (height: number) => void;
  // True while this stage is only the "incoming" neighbour sliding in
  // during a swipe (or otherwise not the one on screen yet). It stays
  // paused — so you never hear the next video while still watching the
  // current one, and a swipe you cancel never played anything — and starts
  // the moment the parent re-renders it as the real, active stage.
  standby?: boolean;
  // Mobile/tablet only: reports whether the "See more" scrim (below, via
  // descExpanded) is open, so the floating "Shop this video" pill
  // (rendered by ProductDrawer, outside this component — same split as
  // onCaptionHeightChange above) can dim out with it instead of sitting
  // on top of the scrim at full brightness while everything behind it
  // dims. Only passed for the stage actually on screen.
  onDescExpandedChange?: (expanded: boolean) => void;
}

const WHEEL_GESTURE_GAP_MS = 180;
const WHEEL_MIN_LOCK_MS = 600;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// null = viewer hasn't touched the volume button yet; use the Settings default.
let viewerMuted: boolean | null = null;
const wheelState = { lastAt: 0, lockedUntil: 0, locked: false };

export function VideoStage({
  post,
  mode,
  onBack,
  overlayVisible,
  onToggleOverlay,
  onVideoEnded,
  onSwipeNext,
  onSwipePrev,
  onOpenComments,
  onOpenProfile,
  onViewPoster,
  onOpenSettings,
  onOpenWatchlist,
  onOpenCart,
  onOpenNotifications,
  onOpenSearch,
  onVisualSearch,
  onOpenWanted,
  notifications,
  unreadNotificationCount,
  isSaved,
  onToggleSave,
  isLiked,
  onToggleLike,
  onOpenLikers,
  isShared,
  onToggleShare,
  canRepost,
  isReposted,
  onRepost,
  defaultMuted,
  isFollowing,
  onToggleFollow,
  onCaptionHeightChange,
  onDescExpandedChange,
  standby = false,
}: VideoStageProps) {
  // Same four icons for discover; shop drops the comment icon since shop
  // posts aren't discussion content — like/share/save still apply there.
  const engagement = (
    [
      { Icon: Heart, count: post.likes, label: 'Like' },
      { Icon: MessageCircle, count: post.comments, label: 'Comment' },
      { Icon: Share2, count: post.shares, label: 'Share' },
      { Icon: Bookmark, count: post.saves, label: 'Save' },
    ] as const
  ).filter((item) => mode === 'discover' || item.label !== 'Comment');

  // Known from upload metadata, if provided — matches how real platforms
  // size a player before any video bytes have loaded.
  const knownAspect = post.width && post.height ? post.width / post.height : null;

  // Was local useState(false) here, no request ever sent — isFollowing/
  // onToggleFollow are now real props, lifted to page.tsx (same reason
  // isSaved/onToggleSave already were: this needs to survive swiping away
  // from a post and back, and needs the auth-gated request to actually go
  // somewhere).
  // Starts muted-by-default per the Settings toggle — but browsers block
  // autoplay-with-sound without prior user interaction regardless, so
  // turning this off doesn't guarantee sound actually plays; it just skips
  // the app forcing silence on top of whatever the browser already allows.
  // A mute/unmute the viewer picks with the volume button carries over to the
  // next and previous videos (each is its own VideoStage instance, so the
  // choice lives at module level, not in per-instance state). Changing the
  // Settings default clears it.
  const [muted, setMutedState] = useState(() => viewerMuted ?? defaultMuted);
  const setMuted = (update: boolean | ((m: boolean) => boolean)) =>
    setMutedState((prev) => {
      const next = typeof update === 'function' ? update(prev) : update;
      viewerMuted = next;
      return next;
    });
  const defaultMutedSeenRef = useRef(defaultMuted);
  useEffect(() => {
    if (defaultMutedSeenRef.current === defaultMuted) return;
    defaultMutedSeenRef.current = defaultMuted;
    viewerMuted = null;
    setMutedState(defaultMuted);
  }, [defaultMuted]);
  const [moreOpen, setMoreOpen] = useState(false);
  // Self-contained here rather than lifted to page.tsx — reporting a
  // video needs no state anything else in the app cares about (unlike
  // watchlist/cart/notifications, which persist across views), so there's
  // no reason to plumb it any further than where the trigger already is.
  const [reportOpen, setReportOpen] = useState(false);
  // Same reasoning as reportOpen just above — the sheet only needs to
  // know which post it's sharing, nothing page.tsx has to track.
  const [shareOpen, setShareOpen] = useState(false);
  // Facebook/Instagram-style caption: clamped to 2 lines with a "See
  // more" trigger, which expands the FULL description as a scrim over
  // the video frame itself rather than navigating anywhere. No reset
  // effect needed — page.tsx keys each VideoStage by post.id (see
  // CommentsPanel's own comment on the same convention), so React
  // remounts this component fresh on every post change and this just
  // starts back at false.
  const [descExpanded, setDescExpanded] = useState(false);
  useEffect(() => {
    onDescExpandedChange?.(descExpanded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descExpanded]);
  // Full-screen avatar viewer — separate from descExpanded (a different
  // overlay, and either one's avatar tap should reach it) and from
  // onViewPoster (tapping the NAME navigates to that poster's profile;
  // tapping the AVATAR stays on this screen and just shows the picture
  // full-size, per the two being distinct actions).
  const [avatarExpanded, setAvatarExpanded] = useState(false);
  // Needed because MoreMenu/ReportVideoSheet are now portaled
  // unconditionally (see the createPortal calls below) — `document`
  // doesn't exist during Next.js's server render pass, so calling
  // createPortal(..., document.body) before the component has actually
  // mounted client-side would crash SSR. avatarExpanded's own portal
  // avoids this for free (it's guarded by `avatarExpanded &&`, which is
  // false server-side by default) — this does the same job explicitly
  // for the two that need to portal regardless of their open state.
  // Lumin Lite (data saver): smaller copy, no look-ahead, no replay loop.
  const lite = useLuminLite();
  const videoSrc = lite && post.liteVideoUrl ? post.liteVideoUrl : post.videoUrl;
  // A retwin plays the original above itself (stacked, same clock): the
  // retwin's own video stays the "main" one (progress, views, ending), and the
  // original follows it. Sound comes from the main video unless the viewer
  // taps the original to listen to that instead.
  const retwinOf = post.tagOnly ? undefined : post.retwinOf;
  const companionSrc = retwinOf ? (lite && retwinOf.liteVideoUrl ? retwinOf.liteVideoUrl : retwinOf.videoUrl) : undefined;
  const syncOffsetMs = retwinOf ? (post.syncOffsetMs ?? 0) : 0;
  const companionRef = useRef<HTMLVideoElement>(null);
  const [companionSound, setCompanionSound] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  // Below lg, the stage presents like TikTok/Reels (full-bleed portrait,
  // full-width letterboxed landscape) instead of the padded, rounded card
  // used on desktop — so sizing needs to know which regime it's in.
  const [isDesktop, setIsDesktop] = useState(false);
  // Uses known metadata immediately if available; otherwise falls back to
  // 9:16 until the live file reports its own shape.
  const [aspect, setAspect] = useState(knownAspect ?? 9 / 16);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  // Ready immediately when dimensions are already known (the normal case)
  // or when there's no video to wait for at all. Only stays unready — and
  // invisible — if we genuinely have to wait on the live file to tell us
  // its shape, which a real platform avoids entirely by storing it upfront.
  const [ready, setReady] = useState(!post.videoUrl || knownAspect !== null);
  const stageRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Drives the thin top-of-frame progress bar below — a plain 0–1
  // fraction rather than raw currentTime/duration, since nothing else
  // here needs the absolute seconds. Naturally resets to 0 for a new
  // post without any manual reset: VideoStage is mounted fresh per post
  // (key={p.id} in page.tsx's renderShopVideoStage/
  // renderDiscoverVideoStage), so this is a brand-new piece of state
  // each time, not one that needs to be told to forget the last video.
  const [progress, setProgress] = useState(0);
  // Needed to place the twin pins along the timeline.
  const [durationMs, setDurationMs] = useState(0);
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (video && video.duration) {
      setProgress(video.currentTime / video.duration);
      const d = Math.round(video.duration * 1000);
      setDurationMs((prev) => (prev === d ? prev : d));
    }
    if (video && !standby) noteWatched(post.id, Math.round(video.currentTime * 1000));
    // Lets the shop pill follow which twinned product is on screen. Only the
    // video actually being watched reports (the standby neighbour is paused).
    if (video && !standby && post.twins && post.twins.length > 0) {
      // Twins are timed on the original's clock; a video retwin's own video
      // may have started later (or earlier), hence the offset.
      setPlaybackMs(Math.max(0, Math.round(video.currentTime * 1000) + syncOffsetMs));
    }
  };

  // Keep the original (companion) in step with the retwin's own video.
  useEffect(() => {
    const main = videoRef.current;
    const comp = companionRef.current;
    if (!main || !comp || !companionSrc) return;
    const off = syncOffsetMs / 1000;
    const follow = () => {
      // original time = retwin time + offset
      const target = main.currentTime + off;
      if (target < 0) {
        comp.pause(); // the original hasn't started yet at this point of the retwin
        if (comp.currentTime > 0.05) comp.currentTime = 0;
        return;
      }
      if (comp.duration && target >= comp.duration) {
        comp.pause(); // the original is shorter: hold its last frame
        return;
      }
      if (comp.paused && !main.paused) void comp.play().catch(() => {});
      if (Math.abs(comp.currentTime - target) > 0.4) comp.currentTime = target;
    };
    const onPlay = () => {
      follow();
    };
    const onPause = () => comp.pause();
    main.addEventListener('play', onPlay);
    main.addEventListener('pause', onPause);
    main.addEventListener('seeked', follow);
    main.addEventListener('timeupdate', follow);
    if (!main.paused) onPlay();
    return () => {
      main.removeEventListener('play', onPlay);
      main.removeEventListener('pause', onPause);
      main.removeEventListener('seeked', follow);
      main.removeEventListener('timeupdate', follow);
    };
  }, [companionSrc, standby, syncOffsetMs]);

  // A new video starts at 0; clear whatever the previous one left behind.
  useEffect(() => {
    if (!standby) setPlaybackMs(0);
  }, [standby, post.id]);

  // Some video files (screen recordings, phone footage with rotation
  // metadata) report a provisional size at loadedmetadata and only settle
  // on the real dimensions once decoding actually starts, signaled by a
  // separate `resize` event. Listening to only loadedmetadata was the bug —
  // this now tracks both, so whatever the browser reports last wins.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const applyDims = () => {
      if (video.videoWidth && video.videoHeight) {
        const liveAspect = video.videoWidth / video.videoHeight;
        setAspect((current) => (Math.abs(current - liveAspect) > 0.01 ? liveAspect : current));
        setReady(true);
      }
    };

    video.addEventListener('loadedmetadata', applyDims);
    video.addEventListener('resize', applyDims);
    applyDims();

    return () => {
      video.removeEventListener('loadedmetadata', applyDims);
      video.removeEventListener('resize', applyDims);
    };
  }, []);

  useEffect(() => {
    if (ready) return;
    const timeout = setTimeout(() => setReady(true), 3000);
    return () => clearTimeout(timeout);
  }, [ready]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
    }
  }, [muted]);

  // Standby -> active is the same mounted element being promoted after a
  // swipe (SwipeStage reuses it by key), so playback has to be started
  // here; the autoPlay attribute only applies at mount. Active -> standby
  // never happens for a live stage, but pausing keeps the two symmetric.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (standby) {
      video.pause();
      return;
    }
    // Browsers (iPhone Safari especially) often refuse to start a video
    // that has sound unless the play call came straight from a tap — which
    // a swipe-to-next never is. Rather than leave the video frozen until
    // the viewer finds the right gesture, retry muted (always allowed),
    // show the speaker as muted, and let them unmute with one tap. Only
    // this video falls back; the viewer's saved sound choice is untouched,
    // so the next video tries with sound again.
    video.play().catch(() => {
      video.muted = true;
      setMutedState(true);
      video.play().catch(() => setIsPaused(true));
    });
  }, [standby]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const fit = () => {
      const clientW = el.clientWidth;
      const clientH = el.clientHeight;
      if (clientW <= 0 || clientH <= 0) return;

      if (isDesktop) {
        const availW = clientW - STAGE_PADDING;
        const availH = clientH - STAGE_PADDING;
        if (availW <= 0 || availH <= 0) return;

        let width = availW;
        let height = width / aspect;
        if (height > availH) {
          height = availH;
          width = height * aspect;
        }
        width = Math.min(width, availW);
        height = Math.min(height, availH);
        setBox({ width: Math.floor(width), height: Math.floor(height) });
        return;
      }

      if (aspect <= 1) {
        setBox({ width: Math.floor(clientW), height: Math.floor(clientH) });
      } else {
        const width = clientW;
        const height = width / aspect;
        setBox({ width: Math.floor(width), height: Math.floor(height) });
      }
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [aspect, isDesktop]);

  // Double-tap/double-click gesture zones — the stage splits into three
  // thirds (left/middle/right). A single tap or click anywhere still
  // just toggles the overlay, exactly as before (mobile only — desktop
  // shows it permanently already); a *second* tap/click landing in the
  // same third within DOUBLE_TAP_WINDOW is a double-tap instead, and
  // never also fires the single-tap's overlay toggle. Left seeks back
  // 10s, right seeks forward 10s, middle toggles play/pause. Built
  // entirely on the onClick already wired to the video element below —
  // a mobile tap's synthesized click event and a real desktop mouse
  // click both fire it identically, so the same zones/thresholds cover
  // both without a separate manual-touch-timing path or onDoubleClick.
  // Entirely separate from the vertical swipe-to-advance gesture, which
  // lives up in SwipeStage now — this is just horizontal-thirds tap
  // zones on a click, that one's raw touch coordinates over the whole
  // stage.
  const DOUBLE_TAP_WINDOW = 300;
  const SEEK_SECONDS = 10;
  const lastTapRef = useRef<{ time: number; zone: 'left' | 'middle' | 'right' } | null>(null);
  const singleTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gestureFlash, setGestureFlash] = useState<'back' | 'play' | 'pause' | 'forward' | 'mute' | 'unmute' | null>(null);

  useEffect(
    () => () => {
      if (singleTapTimeoutRef.current) clearTimeout(singleTapTimeoutRef.current);
      if (gestureFlashTimeoutRef.current) clearTimeout(gestureFlashTimeoutRef.current);
    },
    [],
  );

  const flashGesture = (kind: 'back' | 'play' | 'pause' | 'forward' | 'mute' | 'unmute') => {
    setGestureFlash(kind);
    if (gestureFlashTimeoutRef.current) clearTimeout(gestureFlashTimeoutRef.current);
    gestureFlashTimeoutRef.current = setTimeout(() => setGestureFlash(null), 550);
  };

  const seekBy = (deltaSeconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + deltaSeconds));
  };

  // Tracks the real element state so the desktop play/pause button shows the
  // right icon however playback changed (button, double-click, standby start).
  const [isPaused, setIsPaused] = useState(false);

  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {
        video.muted = true;
        setMutedState(true);
        video.play().catch(() => {});
      });
      flashGesture('play');
    } else {
      video.pause();
      flashGesture('pause');
    }
  };

  const handleStageTap = (e: MouseEvent) => {
    // 🛠️ FIX: on mobile/tablet, a single tap anywhere on a paused video used
    // to resume it instantly, bypassing the zone gesture entirely. That's
    // removed now — a paused video on mobile/tablet follows the exact same
    // rule as a playing one: a single tap toggles the overlay, and a real
    // double-tap in the middle third is what resumes playback (same as
    // pausing already does). Desktop is unaffected — it still has its own
    // explicit play/pause button, this early-return was never load-bearing
    // there anyway.
    const pausedVideo = videoRef.current;
    if (isDesktop && pausedVideo && pausedVideo.paused && !standby) {
      lastTapRef.current = null;
      if (singleTapTimeoutRef.current) {
        clearTimeout(singleTapTimeoutRef.current);
        singleTapTimeoutRef.current = null;
      }
      togglePlayPause();
      return;
    }

    // The video/placeholder element itself (e.currentTarget), not the
    // outer stage section — on desktop that section has its own padding
    // around a possibly letterboxed video (object-contain), so using it
    // instead would compute thirds against empty space, not the actual
    // visible frame someone is tapping on.
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const zone: 'left' | 'middle' | 'right' =
      x >= rect.width / 3 && x <= (rect.width * 2) / 3 ? 'middle' : x < rect.width / 3 ? 'left' : 'right';

    const now = Date.now();
    const last = lastTapRef.current;
    const isDoubleTap = !!last && last.zone === zone && now - last.time < DOUBLE_TAP_WINDOW;

    if (isDoubleTap) {
      // Consume the pair (rather than leaving this tap as the new
      // "last") so a third rapid tap starts a fresh pair instead of
      // chaining — repeated double-tapping still seeks/pauses again
      // each time, just as two separate double-taps, not one long one.
      lastTapRef.current = null;
      if (singleTapTimeoutRef.current) {
        clearTimeout(singleTapTimeoutRef.current);
        singleTapTimeoutRef.current = null;
      }
      if (zone === 'left') {
        seekBy(-SEEK_SECONDS);
        flashGesture('back');
      } else if (zone === 'right') {
        seekBy(SEEK_SECONDS);
        flashGesture('forward');
      } else {
        togglePlayPause();
      }
      return;
    }

    lastTapRef.current = { time: now, zone };
    // Wait out the window before treating this as a genuine single tap,
    // in case a second one is about to land and turn it into the
    // double-tap handled above instead.
    singleTapTimeoutRef.current = setTimeout(() => {
      onToggleOverlay();
      singleTapTimeoutRef.current = null;
    }, DOUBLE_TAP_WINDOW);
  };

  // Swipe up/down to move through the feed (touch) now lives one level up,
  // in SwipeStage — it owns the shared transform all three of
  // current/next/prev slide on, so it's the one place that can make the
  // video visibly track the finger in real time as the gesture happens
  // (see its own comment), rather than this component only finding out
  // about the gesture after it's already over.
  //
  // Desktop: mouse-wheel/trackpad scroll does the same thing. Cooldown so
  // one physical scroll gesture (many wheel events) advances once, not
  // several posts at a time.
  // (State lives at module level, not in refs: the video that receives the
  // tail of the gesture is a different VideoStage instance than the one that
  // started it, so per-instance state would reset mid-gesture.)
  // One physical scroll = one video. A trackpad (or a free-spinning wheel)
  // keeps emitting wheel events for a second or more after the fingers
  // lift (inertia), so a fixed cooldown let the tail of the same gesture
  // trigger the next video again. Instead the gesture counts as ongoing for
  // as long as events keep arriving (gap under WHEEL_GESTURE_GAP_MS), and a
  // new video is only allowed once the stream has gone quiet, and never
  // before the slide animation has had time to finish.
  const handleWheel = (e: WheelEvent) => {
    if (!isDesktop || (!onSwipeNext && !onSwipePrev)) return;
    const now = performance.now();
    const gap = now - wheelState.lastAt;
    wheelState.lastAt = now; // every event, even tiny inertia ones, extends the gesture
    if (wheelState.locked && gap > WHEEL_GESTURE_GAP_MS && now > wheelState.lockedUntil) {
      wheelState.locked = false;
    }
    if (wheelState.locked) return;
    if (Math.abs(e.deltaY) < 20) return;
    wheelState.locked = true;
    wheelState.lockedUntil = now + WHEEL_MIN_LOCK_MS;
    if (e.deltaY > 0) onSwipeNext?.();
    else onSwipePrev?.();
  };

  const handleVideoEnded = () => {
    onVideoEnded();
    const video = videoRef.current;
    // Lite: a finished video just stops (tap to replay) instead of looping
    // and streaming itself again.
    if (video && !lite) {
      video.currentTime = 0;
      video.play();
    }
  };

  // Single tap/click on the video hides or restores the overlay on every
  // screen size (desktop used to keep it permanently shown).
  // View tracking: counts seconds of real playback (playing, tab visible,
  // not on standby) and reports a view after ~3s plus the watch time on the
  // way out. Skipped for sample posts, whose ids aren't server uuids.
  useEffect(() => {
    if (standby || !post.videoUrl || !UUID_RE.test(post.id)) return;
    const tracker = new ViewTracker(post.id);
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended || document.hidden) return;
      const fraction = video.duration ? video.currentTime / video.duration : 0;
      tracker.tick(1, fraction);
    }, 1000);
    const flush = () => tracker.flush();
    const onHide = () => {
      if (document.hidden) flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [standby, post.id, post.videoUrl]);

  // Lite: don't keep downloading a video nobody can see.
  useEffect(() => {
    if (!lite) return;
    const onVisibility = () => {
      const video = videoRef.current;
      if (!video) return;
      if (document.hidden) video.pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [lite]);

  const mobileOverlayHidden = !overlayVisible;

  // Measures just the left caption column (poster row + repost label +
  // description + "See more") — deliberately NOT the row wrapper around
  // it, which also contains the right-side engagement icon rail. That
  // row is `flex items-end`, so its height is whichever side is taller;
  // measuring it would size the floating pill off the icon rail instead
  // of the caption content it's meant to track (see onCaptionHeightChange).
  // Height only changes with its content, so a ResizeObserver on the
  // element is enough; desktop has no floating pill, so it reports 0 there.
  //
  // Only reported at all when there's actually extra content to clear —
  // a repost label, or a caption long enough to trigger "See more" (same
  // length heuristic as that button below, not a real overflow check).
  // A plain one-line caption with no repost label reports 0 unconditionally
  // rather than its real (small) measured height, so the pill always rests
  // at ProductDrawer's normal floor in that case — not a slightly-lower
  // position that just happens to still clear a short caption. Without
  // this, the pill would drift a few px with every caption's exact
  // rendered height instead of sitting at one consistent resting spot for
  // every "nothing to clear" post.
  const needsCaptionClearance = Boolean(post.repostedBy) || post.description.length > 80;
  const captionBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onCaptionHeightChange) return;
    const el = captionBarRef.current;
    if (isDesktop || !el || !needsCaptionClearance) {
      onCaptionHeightChange(0);
      return;
    }
    const report = () => onCaptionHeightChange(el.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, post.id, needsCaptionClearance]);

  const overlay = (
    <>
      <div
        className={`absolute left-3.5 right-3.5 top-3.5 flex items-center justify-between transition-opacity duration-200 ${
          mobileOverlayHidden ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'
        }`}
      >
        {mode === 'discover' || onBack ? (
          <div className={`flex items-center gap-2 ${mode === 'discover' ? 'lg:hidden' : ''}`}>
            <button
              onClick={onBack}
              aria-label="Back"
              className="rounded-full bg-white/85 p-2"
            >
              <ArrowLeft size={18} className="text-text-mute" />
            </button>
            {/* Mobile/tablet only now — desktop gets its own proper
                DiscoverNavBar (fixed corners, off the video card
                entirely), same treatment NavBar already gives shop mode.
                Discover still has no NavBar-equivalent on mobile/tablet
                though (it isn't a shopping context, so cart/search/
                profile don't belong here) — this stays the minimal
                identity + way-back overlay for those breakpoints. */}
            <span className="rounded-full bg-white/85 px-3 py-1.5 text-[13px] font-bold tracking-wide">
              <span className="text-hot-pink">L</span>UMIN
            </span>
          </div>
        ) : (
          // Categories and Discover live in the bottom bar on mobile/tablet now (BottomNav),
          // so this corner just carries the wordmark, same as discover mode.
          <div className="flex items-center gap-2 lg:hidden">
            <span className="rounded-full bg-white/85 px-3 py-1.5 text-[13px] font-bold tracking-wide">
              <span className="text-hot-pink">L</span>UMIN
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={() => setMuted((m) => !m)}
            className="hidden rounded-full bg-white/85 p-2 lg:flex"
          >
            {muted ? (
              <VolumeX size={18} className="text-text-mute" />
            ) : (
              <Volume2 size={18} className="text-text-mute" />
            )}
          </button>
          {/* Shop has NavBar's own search button on desktop, and discover
              now has DiscoverNavBar's — so this only ever needs to show
              on mobile/tablet, at every mode, not just shop. */}
          <button
            onClick={onOpenSearch}
            aria-label="Search"
            className="rounded-full bg-white/85 p-2 lg:hidden"
          >
            <SearchIcon size={18} className="text-text-mute" />
          </button>
          <div className="relative">
            <button
              ref={moreButtonRef}
              onClick={() => {
                if (!moreOpen && moreButtonRef.current) {
                  const rect = moreButtonRef.current.getBoundingClientRect();
                  setDropdownPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
                }
                setMoreOpen((o) => !o);
              }}
              aria-label="More options"
              className="relative rounded-full bg-white/85 p-2"
            >
              <MoreHorizontal size={18} className="text-text-mute" />
              {mode === 'shop' && unreadNotificationCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-hot-pink px-1 text-[11.5px] font-bold leading-none text-white lg:hidden">
                  {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                </span>
              )}
            </button>

            {isDesktop &&
              moreOpen &&
              dropdownPos &&
              createPortal(
                <>
                  <div
                    onClick={() => setMoreOpen(false)}
                    aria-hidden="true"
                    className="fixed inset-0 z-40"
                  />
                  <div
                    style={{ top: dropdownPos.top, right: dropdownPos.right }}
                    className="fixed z-50 w-48 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg"
                  >
                    {onOpenWanted && (
                      <button
                        onClick={() => {
                          setMoreOpen(false);
                          onOpenWanted();
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-text hover:bg-panel"
                      >
                        <Sparkles size={16} className="text-text-mute" />
                        Wanted
                      </button>
                    )}
                    {onVisualSearch && (
                      <button
                        onClick={() => {
                          setMoreOpen(false);
                          onVisualSearch();
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-text hover:bg-panel"
                      >
                        <ScanSearch size={16} className="text-text-mute" />
                        Find a product from this video
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setMoreOpen(false);
                        setReportOpen(true);
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-text hover:bg-panel"
                    >
                      <Flag size={16} className="text-text-mute" />
                      Report this video
                    </button>
                  </div>
                </>,
                document.body,
              )}
          </div>
        </div>
      </div>

      <div
        className={`absolute inset-x-0 bottom-0 flex items-end gap-2 bg-gradient-to-t from-black/60 via-black/20 to-transparent p-3.5 pb-[18px] transition-opacity duration-200 ${
          mobileOverlayHidden ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'
        }`}
      >
        <div ref={captionBarRef} className="min-w-0 flex-1">
          {post.repostedBy && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewPoster({
                  posterName: post.repostedBy!.displayName,
                  posterAvatar: post.repostedBy!.avatarUrl,
                  posterId: post.repostedBy!.id,
                });
              }}
              className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-semibold text-white/75"
            >
              <Repeat2 size={15} />
              Retwinned by {post.repostedBy.displayName}
            </button>
          )}
          <div className="mb-2.5 flex max-w-[250px] items-center gap-2.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setAvatarExpanded(true);
              }}
              aria-label={`View ${post.posterName}'s profile picture`}
              className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white/30"
            >
              <img
                src={post.posterAvatar || '/images/placeholder.svg'}
                alt=""
                className="h-full w-full object-cover"
              />
            </button>
            <div className="min-w-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewPoster(post);
                }}
                className="truncate text-left text-[14px] font-semibold text-white"
              >
                {post.posterName}
              </button>
              <p className="text-[13px] text-white/60">{post.postedAt}</p>
            </div>
            {onToggleFollow && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFollow();
                }}
                className={`ml-auto shrink-0 rounded-full px-3.5 py-1.5 text-[13.5px] font-bold ${
                  isFollowing ? 'bg-white/20 text-white' : 'brand-gradient text-white'
                }`}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            )}
          </div>
          {/* No JS text-measurement — a length heuristic decides whether
              "See more" shows at all, same simplified approach the rest
              of this app already uses for clamped text (ProductTile/
              ProductCarousel just apply line-clamp unconditionally). A
              short caption that already fits within 2 lines gets no
              trigger, matching how Facebook/Instagram only show one when
              the text actually overflows. */}
          <div className="flex items-end gap-2">
            <p className="line-clamp-2 min-w-0 flex-1 text-[14px] leading-snug text-white/75">{post.description}</p>
            {/* Mobile/tablet mute: tucked in right after the caption text
                instead of adding another icon to the crowded top bar or
                the action column (desktop keeps its header button). Same
                height as one caption line, so it adds no extra rows.
                Deliberately small/subtle (not a primary action) — there's
                no way to wire this to the phone's hardware volume buttons
                (browsers never expose physical volume-button presses to a
                webpage, only the OS-level media volume), so this stays the
                one on-screen way to unmute, just kept understated rather
                than a prominent control. */}
            {post.videoUrl && (
              <button
                type="button"
                aria-label={muted ? 'Unmute' : 'Mute'}
                onClick={(e) => {
                  e.stopPropagation();
                  flashGesture(muted ? 'unmute' : 'mute');
                  setMuted((m) => !m);
                }}
                className="mb-px mr-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-white/70 lg:hidden"
              >
                {muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
              </button>
            )}
          </div>
          {post.description.length > 80 && (
            <button
              onClick={() => setDescExpanded(true)}
              className="mt-0.5 text-[14px] font-semibold text-white"
            >
              See more
            </button>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-center gap-4 pb-0.5">
          {engagement.map(({ Icon, count, label }, i) => {
            // Comment is an action (open the panel), not a toggle. The
            // other three are all real, persisted toggles now — Like/
            // Share backed by page.tsx the same way Save (backed by the
            // watchlist) already was; no more local-only optimistic
            // state for any of them.
            const isComment = label === 'Comment';
            const isSave = label === 'Save';
            const isLikeItem = label === 'Like';
            const isShareItem = label === 'Share';
            const isActive = isComment
              ? false
              : isSave
                ? isSaved
                : isLikeItem
                  ? isLiked
                  : isShareItem
                    ? isShared
                    : false;
            const handleClick = () => {
              if (isComment) onOpenComments?.();
              else if (isSave) onToggleSave();
              else if (isLikeItem) onToggleLike();
              // Share used to call onToggleShare() directly here — that
              // flipped the persisted share flag with no screen behind
              // it at all. Now it opens the actual share sheet; the
              // sheet itself calls onToggleShare once a destination is
              // picked (see ShareSheet's onShare prop below).
              else if (isShareItem) setShareOpen(true);
            };
            return (
              <div key={i} className="flex flex-col items-center gap-1">
                <button
                  onClick={handleClick}
                  aria-label={
                    isComment
                      ? 'Open comments'
                      : isSave
                        ? isSaved
                          ? 'Remove from watchlist'
                          : 'Add to watchlist'
                        : isLikeItem
                          ? isLiked
                            ? 'Unlike'
                            : 'Like'
                          : isShareItem
                            ? 'Share'
                            : label
                  }
                  aria-pressed={isComment || isShareItem ? undefined : isActive}
                  className="group flex flex-col items-center transition-transform hover:scale-110 active:scale-95"
                >
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-full shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-colors ${
                      isActive ? 'brand-gradient' : 'bg-white/90 group-hover:bg-white'
                    }`}
                  >
                    <Icon
                      size={22}
                      strokeWidth={2.25}
                      className={isActive ? 'text-white' : 'text-text'}
                    />
                  </span>
                </button>
                {/* The count is its own tap target only for Like, where
                    there's somewhere useful for it to go (the likers
                    list) — every other count is just a number, so it
                    stays plain text exactly like before. */}
                {isLikeItem ? (
                  <button
                    onClick={onOpenLikers}
                    aria-label="See who liked this"
                    className="text-[13.5px] font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
                  >
                    {formatCount(count + (isActive ? 1 : 0))}
                  </button>
                ) : (
                  <span className="text-[13.5px] font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                    {formatCount(count + (isActive ? 1 : 0))}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Facebook/Instagram-style expanded caption: a scrim over the
          WHOLE video frame (not just the bottom gradient strip the
          collapsed caption sits in), tapping anywhere closes it. Lives
          inside this same `overlay` fragment specifically so it inherits
          the exact same bounds the top bar/engagement rail already do —
          contained to the video frame on desktop (rendered inside the
          sized inner div), full-bleed on mobile (rendered via the
          absolute inset-0 wrapper) — see the two `overlay` render sites
          below. z-20 keeps it above every other element in this
          fragment regardless of DOM order. */}
      {descExpanded && (
        <div
          onClick={() => setDescExpanded(false)}
          // pointer-events-auto is required: on mobile this whole fragment
          // is mounted inside a `pointer-events-none absolute inset-0`
          // wrapper (see the overlay render sites below), and
          // pointer-events is inherited. Without it the scrim is
          // click-through, so "See less" and tap-to-close never fired —
          // the taps landed on the video underneath instead.
          className="pointer-events-auto absolute inset-0 z-20 flex flex-col justify-end bg-black/70 p-4 pb-8"
        >
          {post.repostedBy && (
            <p className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-semibold text-white/75">
              <Repeat2 size={15} />
              Retwinned by {post.repostedBy.displayName}
            </p>
          )}
          <div className="mb-2.5 flex max-w-[85%] items-center gap-2.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setAvatarExpanded(true);
              }}
              aria-label={`View ${post.posterName}'s profile picture`}
              className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white/30"
            >
              <img
                src={post.posterAvatar || '/images/placeholder.svg'}
                alt=""
                className="h-full w-full object-cover"
              />
            </button>
            <div className="min-w-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewPoster(post);
                }}
                className="truncate text-left text-[14px] font-semibold text-white"
              >
                {post.posterName}
              </button>
              <p className="text-[13px] text-white/60">{post.postedAt}</p>
            </div>
          </div>
          <p className="max-h-[60%] overflow-y-auto whitespace-pre-wrap pr-2 text-[13px] leading-relaxed text-white">
            {post.description}
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDescExpanded(false);
            }}
            className="mt-3 self-start text-[13.5px] font-semibold text-white/80"
          >
            See less
          </button>
        </div>
      )}
    </>
  );

  return (
    <>
      <section
        ref={stageRef}
        onWheel={handleWheel}
        className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-black p-0 lg:bg-white lg:p-4"
      >
      <div
        className="group relative overflow-hidden bg-black lg:rounded-xl2"
        style={
          ready && box
            ? { width: box.width, height: box.height }
            : { width: 0, height: 0, opacity: 0 }
        }
      >
        {retwinOf && companionSrc && (
          <div
            className="absolute inset-x-0 top-0 h-1/2 overflow-hidden border-b border-white/30 bg-black"
            onClick={(e) => {
              e.stopPropagation();
              setCompanionSound((v) => !v);
            }}
          >
            <video
              ref={companionRef}
              src={companionSrc}
              poster={retwinOf.thumbnailUrl}
              muted={muted || !companionSound}
              playsInline
              preload={lite ? 'metadata' : 'auto'}
              className="h-full w-full object-cover"
            />
            <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white">
              Original · {retwinOf.posterName}
            </span>
            <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-1 text-[11px] font-semibold text-white">
              {companionSound && !muted ? '🔊 original' : '🔇 tap for original'}
            </span>
          </div>
        )}
        {post.videoUrl ? (
          <video
            ref={videoRef}
            src={videoSrc}
            // Shows the post's thumbnail until the first video frame is ready,
            // so a video sliding in during a swipe is a picture, never a black
            // box that pops into the video a moment later.
            poster={post.thumbnailUrl}
            onClick={handleStageTap}
            onEnded={handleVideoEnded}
            onPlay={() => setIsPaused(false)}
            onPause={() => setIsPaused(true)}
            onTimeUpdate={handleTimeUpdate}
            className={
              retwinOf
                ? 'absolute inset-x-0 bottom-0 h-1/2 w-full object-cover'
                : `absolute inset-0 h-full w-full ${!isDesktop && aspect <= 1 ? 'object-cover' : 'object-contain'}`
            }
            autoPlay={!standby}
            preload={lite ? 'metadata' : 'auto'}
            muted={muted || (Boolean(retwinOf) && companionSound)}
            playsInline
          />
        ) : (
          <div
            onClick={handleStageTap}
            className="absolute inset-0 flex items-center justify-center text-sm text-white/40"
          >
            video
          </div>
        )}

        {/* Transient feedback for the double-tap gesture above — plain
            mount/unmount timed by gestureFlash's own setTimeout, no
            enter/exit animation library (none is installed). Pinned to
            the tapped third for a seek, centered for play/pause, same
            left/middle/right split handleStageTap itself uses. */}
        {isPaused && !gestureFlash && !standby && !isDesktop && post.videoUrl && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-full bg-black/45 p-4 text-white">
              <Play size={30} fill="white" />
            </div>
          </div>
        )}

        {gestureFlash && (
          <div
            className={`pointer-events-none absolute inset-y-0 flex items-center justify-center ${
              gestureFlash === 'back' ? 'left-0 w-1/3' : gestureFlash === 'forward' ? 'right-0 w-1/3' : 'inset-x-0'
            }`}
          >
            <div className="flex flex-col items-center gap-1 rounded-full bg-black/55 p-4 text-white">
              {gestureFlash === 'back' && (
                <>
                  <RotateCcw size={26} />
                  <span className="text-[11.5px] font-bold">10s</span>
                </>
              )}
              {gestureFlash === 'forward' && (
                <>
                  <RotateCw size={26} />
                  <span className="text-[11.5px] font-bold">10s</span>
                </>
              )}
              {gestureFlash === 'play' && <Play size={26} fill="white" />}
              {gestureFlash === 'pause' && <Pause size={26} fill="white" />}
              {gestureFlash === 'mute' && <VolumeX size={26} />}
              {gestureFlash === 'unmute' && <Volume2 size={26} />}
            </div>
          </div>
        )}

        {/* Desktop transport controls — same for shop and discover. Hover
            reveals them (always shown while paused so a paused video is
            obviously resumable); mobile keeps the double-tap gestures. */}
        {isDesktop && post.videoUrl && (
          <div
            className={`absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 items-center justify-center gap-5 transition-opacity ${
              isPaused ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'
            }`}
          >
            <button
              type="button"
              aria-label="Back 10 seconds"
              onClick={(e) => {
                e.stopPropagation();
                seekBy(-SEEK_SECONDS);
              }}
              className="pointer-events-auto rounded-full bg-black/55 p-3 text-white hover:bg-black/70"
            >
              <RotateCcw size={22} />
            </button>
            <button
              type="button"
              aria-label={isPaused ? 'Play' : 'Pause'}
              onClick={(e) => {
                e.stopPropagation();
                togglePlayPause();
              }}
              className="pointer-events-auto rounded-full bg-black/55 p-4 text-white hover:bg-black/70"
            >
              {isPaused ? <Play size={26} fill="white" /> : <Pause size={26} fill="white" />}
            </button>
            <button
              type="button"
              aria-label="Forward 10 seconds"
              onClick={(e) => {
                e.stopPropagation();
                seekBy(SEEK_SECONDS);
              }}
              className="pointer-events-auto rounded-full bg-black/55 p-3 text-white hover:bg-black/70"
            >
              <RotateCw size={22} />
            </button>
          </div>
        )}

        {/* Thin watched-so-far meter, pinned to the very top edge of the
            video frame — always visible (unlike the poster-info row just
            below it, which fades out on tap via mobileOverlayHidden) and
            deliberately outside the `overlay` fragment so it renders
            identically for shop and discover without needing its own
            isDesktop/mobile duplication; every other overlay element
            needs that because it's interactive and has to sit inside the
            correctly-clipped container on desktop vs. full-bleed on
            mobile, but this is a plain, non-interactive bar the video
            frame's own bounds already clip correctly either way. */}
        {post.videoUrl && isDesktop && (
          // 🛠️ FIX: a plain white fill on top of the video itself disappears
          // the moment the video frame underneath it is also light/white —
          // there's nothing to separate the two. The track below is NOT part
          // of the video; it's an always-dark (bg-black/45) strip pinned
          // across the full top edge regardless of what's playing, so the
          // white fill is always sitting on a dark backdrop, never directly
          // on the video. The fill also gets its own thin dark outline
          // (the inset box-shadow) as a second line of defense for the
          // sliver of fill width right at the track's own edges.
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 z-10 h-[3px] bg-black/45 shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
          >
            <div
              className="h-full bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.45)]"
              style={{ width: `${Math.min(Math.max(progress, 0), 1) * 100}%` }}
            />
            <TwinPins twins={post.twins} durationMs={durationMs} />
          </div>
        )}

        {isDesktop && overlay}
      </div>

      {!isDesktop && <div className="pointer-events-none absolute inset-0">{overlay}</div>}
      {/* Mobile/tablet: the meter belongs to the SCREEN, not the video frame —
          like a WhatsApp status, it sits across the very top whether the video
          is portrait (fills the screen) or landscape (letterboxed in the
          middle). Pinned inside the safe area so a notch never hides it. */}
      {!isDesktop && post.videoUrl && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-30 px-2 pt-[max(6px,env(safe-area-inset-top))]"
        >
          <div className="relative">
            <div className="h-[3px] overflow-hidden rounded-full bg-black/45 shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
              <div
                className="h-full rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.45)]"
                style={{ width: `${Math.min(Math.max(progress, 0), 1) * 100}%` }}
              />
            </div>
            <TwinPins twins={post.twins} durationMs={durationMs} />
          </div>
        </div>
      )}
      </section>

      {/* 🛠️ FIX: rendered inline before, not portaled — MoreMenu/
          ReportVideoSheet both use `position: fixed`, which is normally
          viewport-relative, EXCEPT when an ancestor has an active CSS
          `transform` (per the CSS Transforms spec, that ancestor becomes
          the containing block for any `fixed` descendant instead).
          SwipeStage applies `style={{ transform: 'translateY(...)' }}`
          directly on the wrapper around EVERY VideoStage instance during
          a swipe — so for that ~300ms, both of these silently stopped
          being viewport-fixed and became positioned relative to the
          sliding wrapper instead, which is a different size/position
          than the viewport (especially on desktop, where the video frame
          is smaller than the full page). That mismatch, recomputed at
          the exact instant a swipe starts and ends, is what produced the
          visible flash/glitch when swiping in both shop and discover
          feeds — not just for Report, MoreMenu had the identical latent
          bug. createPortal(..., document.body) sidesteps this the same
          way avatarExpanded below already correctly does: the element's
          REAL DOM parent becomes <body>, so it's genuinely viewport-fixed
          regardless of any transform on its React-tree ancestors.
          Neither component's own internal CSS needed to change at all —
          the fix is purely about where in the DOM they actually mount. */}
      {mounted &&
        createPortal(
          <MoreMenu
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
            onOpenProfile={onOpenProfile}
            onOpenSettings={onOpenSettings}
            onOpenWatchlist={onOpenWatchlist}
            onOpenCart={onOpenCart}
            onOpenNotifications={onOpenNotifications}
            onOpenReport={() => setReportOpen(true)}
            onVisualSearch={onVisualSearch}
            onOpenWanted={onOpenWanted}
            notifications={notifications}
            unreadNotificationCount={unreadNotificationCount}
          />,
          document.body,
        )}
      {mounted &&
        createPortal(
          <ReportVideoSheet post={post} open={reportOpen} onClose={() => setReportOpen(false)} />,
          document.body,
        )}
      {mounted &&
        createPortal(
          <ShareSheet
            post={post}
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            isShared={isShared}
            onShare={onToggleShare}
            canRepost={canRepost}
            isReposted={isReposted}
            onRepost={onRepost}
          />,
          document.body,
        )}

      {avatarExpanded &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex flex-col bg-black">
            <button
              onClick={() => setAvatarExpanded(false)}
              className="flex items-center gap-1.5 p-4 text-sm font-semibold text-white"
            >
              <ArrowLeft size={20} />
              Back
            </button>
            <div className="flex flex-1 items-center justify-center p-6">
              <img
                src={post.posterAvatar || '/images/placeholder.svg'}
                alt={`${post.posterName}'s profile picture`}
                className="max-h-full max-w-full rounded-xl2 object-contain"
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
