'use client';

import { useEffect, useState } from 'react';
import { Check, Download, Link2, Loader2, Mail, Repeat2, Send, Share2, X } from 'lucide-react';
import type { VideoPost } from '@/lib/types';
import { canWatermarkVideo, createWatermarkedVideoBlob } from '@/lib/watermark';
import { canTranscodeToMp4, transcodeWebmToMp4 } from '@/lib/transcode';

interface ShareSheetProps {
  post: VideoPost;
  open: boolean;
  onClose: () => void;
  // Tapping the Share icon used to just flip isShared straight to true
  // (or back to false) with no screen behind it at all — the share was
  // "recorded" but nobody ever saw a place to actually send it anywhere.
  // This sheet is that missing screen; onShare records the share exactly
  // once per post (page.tsx's handleToggleShare, called only while
  // !isShared — see below), same real persisted share count as before,
  // now with an actual destination to pick.
  isShared: boolean;
  onShare: () => void;
  // False only for the signed-in viewer's own post (see page.tsx's
  // canRepostFor) — reposting your own content back into your own feed
  // doesn't do anything the post isn't already doing. Hidden from the
  // grid entirely rather than shown disabled, same as the Follow button
  // never appearing on your own PosterProfileScreen.
  canRepost: boolean;
  isReposted: boolean;
  // Toggles: reposts if not already reposted, removes the repost if it
  // is — see page.tsx's handleToggleRepost for the actual POST/DELETE
  // .../repost call this triggers.
  onRepost: () => void;
}

// Builds a link back to this specific post. There's no per-post route in
// this app (app/page.tsx is a single page driven by view state, not
// Next.js routing) — ?post=<id> is a query param page.tsx reads on
// mount to jump straight into the discover player for that post, same
// idea as handleOpenDiscoverPost already does for the watchlist/search
// case, just fed by a URL instead of an in-memory post.
function buildShareUrl(postId: string): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('post', postId);
  return url.toString();
}

export function ShareSheet({ post, open, onClose, isShared, onShare, canRepost, isReposted, onRepost }: ShareSheetProps) {
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      setDownloading(false);
      setWatermarking(false);
      return;
    }
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, [open]);

  // Every channel funnels through here — records the share the first
  // time (matches the old toggle's one persisted call), then does its
  // own thing with the link.
  const recordShare = () => {
    if (!isShared) onShare();
  };

  const shareUrl = buildShareUrl(post.id);
  const shareText = post.description ? `${post.description} — via Lumin` : 'Check this out on Lumin';

  const handleCopyLink = async () => {
    recordShare();
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard permission denied or unavailable (older Safari,
      // non-secure context) — fall back to a manual select so the
      // person can still copy it themselves instead of nothing happening.
      window.prompt('Copy this link:', shareUrl);
    }
  };

  const handleNativeShare = async () => {
    recordShare();
    try {
      await navigator.share({ title: shareText, url: shareUrl });
    } catch {
      // AbortError from the person dismissing the OS sheet, or share
      // unsupported for this payload — either way, nothing else to do.
    }
  };

  const openChannel = (url: string) => {
    recordShare();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Reposting counts as sharing too (recordShare), same as every other
  // channel below — it's still "sending this to more people," just to
  // your own followers/feed instead of an outside app. onRepost is the
  // separate call that actually creates (or removes) the repost itself.
  const handleRepost = () => {
    recordShare();
    onRepost();
  };

  const [watermarking, setWatermarking] = useState(false);
  // Separate from `watermarking` — the two run one after the other
  // (record with the mark burned in, then re-encode what that produced),
  // and the second step is the slower of the two, so "Watermarking..."
  // alone would sit on screen looking stuck for most of the wait if it
  // didn't hand off to its own label partway through.
  const [converting, setConverting] = useState(false);
  // Defaults on — most people saving a video want it recognizably from
  // Lumin, same reasoning TikTok bakes its own mark in by default — but
  // it's a real per-download choice, not forced, via the toggle row
  // below the grid.
  const [includeWatermark, setIncludeWatermark] = useState(true);

  // Saves a blob straight to the person's device via a temporary anchor
  // click — the one bit both the watermarked and plain-fallback paths
  // below share.
  const saveBlob = (blob: Blob, filename: string) => {
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
  };

  // Saving the file itself isn't "sharing to" anywhere, so this
  // deliberately doesn't call recordShare — same reasoning the copy-link/
  // channel buttons use it for doesn't apply here.
  //
  // Re-encodes through lib/watermark.ts's createWatermarkedVideoBlob so
  // the saved copy carries the app's own brand+handle mark (same idea
  // TikTok's own downloads use) rather than a bare copy of the source
  // file — burned in only at this point, once the video is actually
  // leaving the app, not shown anywhere in the normal in-app feed
  // itself. Gated on includeWatermark (the toggle row below the grid),
  // not just canWatermarkVideo() — this is a real per-download choice,
  // not something forced on every save. That re-encode plays out in real
  // time (see that function's own comment on why) and needs the video's
  // host to allow cross-origin canvas reads, so it's wrapped in its own
  // try/catch: if the browser can't do it (canWatermarkVideo) or the
  // re-encode fails for any reason (most likely R2 CORS not configured
  // yet — see lumin-backend's README), this falls back to the same
  // plain fetch+blob download the toggle-off path uses, rather than
  // failing outright. Only if that fallback also fails does this give
  // up and just open the video in a new tab for a manual long-press/
  // right-click save.
  const handleDownload = async () => {
    if (!post.videoUrl || downloading) return;
    setDownloading(true);
    try {
      if (includeWatermark && canWatermarkVideo()) {
        try {
          setWatermarking(true);
          const webmBlob = await createWatermarkedVideoBlob(post.videoUrl, post.posterName);
          setWatermarking(false);

          // MediaRecorder (above) can only ever produce WebM in
          // Chromium/Firefox — VLC plays that fine, but most other
          // players (Windows' default app, QuickTime, phones' native
          // gallery/share sheets) don't, or don't reliably. Re-encoding
          // to MP4/H.264+AAC here is what makes the saved file actually
          // play back like the original everywhere else too.
          if (canTranscodeToMp4()) {
            try {
              setConverting(true);
              const mp4Blob = await transcodeWebmToMp4(webmBlob);
              saveBlob(mp4Blob, `lumin-${post.id}.mp4`);
              return;
            } catch {
              // ffmpeg.wasm failed to load or run (offline, a very old
              // browser, etc.) — better to hand over a working WebM than
              // nothing at all.
              saveBlob(webmBlob, `lumin-${post.id}.webm`);
              return;
            } finally {
              setConverting(false);
            }
          }

          saveBlob(webmBlob, `lumin-${post.id}.webm`);
          return;
        } catch {
          // Falls through to the plain download below.
        } finally {
          setWatermarking(false);
        }
      }
      const response = await fetch(post.videoUrl);
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const extension = post.videoUrl.split('.').pop()?.split(/[?#]/)[0] || 'mp4';
      saveBlob(blob, `lumin-${post.id}.${extension}`);
    } catch {
      // CORS-blocked, offline, or some other fetch failure — fall back
      // to just opening the video in a new tab so the person can still
      // save it manually (long-press / right-click Save Video As),
      // same fallback spirit as handleCopyLink's window.prompt above.
      window.open(post.videoUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading(false);
    }
  };

  const channels = [
    // "Message" (sms:) removed for now — left out rather than deleted
    // from git history, so it's a one-line add-back later if it comes
    // back in scope.
    {
      label: 'WhatsApp',
      Icon: Send,
      onClick: () => openChannel(`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`),
    },
    {
      label: 'Email',
      Icon: Mail,
      onClick: () =>
        openChannel(
          `mailto:?subject=${encodeURIComponent('Check this out on Lumin')}&body=${encodeURIComponent(`${shareText}\n\n${shareUrl}`)}`,
        ),
    },
  ];

  return (
    <>
      {/* Backdrop — same tap-outside-to-dismiss convention as
          ReportVideoSheet/MoreMenu. */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-[70] bg-black/40 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share this video"
        className={`fixed inset-x-0 bottom-0 z-[80] rounded-t-2xl bg-white pb-6 pt-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.15)] transition-transform duration-300 lg:inset-x-auto lg:inset-y-0 lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:w-full lg:max-w-[380px] lg:-translate-x-1/2 lg:rounded-2xl lg:pt-4 lg:shadow-xl ${
          open
            ? 'translate-y-0 lg:-translate-y-1/2'
            : 'pointer-events-none translate-y-full lg:-translate-y-[calc(50%-16px)] lg:opacity-0'
        }`}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="mx-auto mb-2 flex w-full flex-col items-center gap-2 py-2 lg:hidden"
        >
          <span className="h-1 w-10 rounded-full bg-box" />
        </button>

        <div className="flex items-center justify-between px-[18px] lg:pb-3">
          <p className="text-[13px] font-bold text-text">Share to</p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="hidden text-text-mute hover:text-text lg:block"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-[18px] pt-3">
          <div className="grid grid-cols-4 gap-3">
            {canRepost && (
              <button
                onClick={handleRepost}
                className="flex flex-col items-center gap-1.5 text-center"
              >
                <span
                  className={`flex h-12 w-12 items-center justify-center rounded-full ${
                    isReposted ? 'brand-gradient text-white' : 'bg-panel text-text'
                  }`}
                >
                  <Repeat2 size={19} />
                </span>
                <span className={`text-[12px] font-medium ${isReposted ? 'font-bold text-hot-pink' : 'text-text-mute'}`}>
                  {isReposted ? 'Retwinned' : 'Retwin'}
                </span>
              </button>
            )}
            {post.videoUrl && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex flex-col items-center gap-1.5 text-center disabled:opacity-60"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-panel text-text">
                  {downloading ? <Loader2 size={19} className="animate-spin" /> : <Download size={19} />}
                </span>
                <span className="text-[12px] font-medium text-text-mute">
                  {watermarking
                    ? 'Watermarking...'
                    : converting
                      ? 'Converting...'
                      : downloading
                        ? 'Saving...'
                        : 'Save video'}
                </span>
              </button>
            )}
            {channels.map(({ label, Icon, onClick }) => (
              <button
                key={label}
                onClick={onClick}
                className="flex flex-col items-center gap-1.5 text-center"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-panel text-text">
                  <Icon size={19} />
                </span>
                <span className="text-[12px] font-medium text-text-mute">{label}</span>
              </button>
            ))}
            {canNativeShare && (
              <button
                onClick={handleNativeShare}
                className="flex flex-col items-center gap-1.5 text-center"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-panel text-text">
                  <Share2 size={19} />
                </span>
                <span className="text-[12px] font-medium text-text-mute">More</span>
              </button>
            )}
          </div>

          {/* Only meaningful when there's actually a video to save —
              hidden entirely rather than shown disabled, same "don't
              show a control with nothing to control" convention the
              Repost tile above uses for canRepost. */}
          {post.videoUrl && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-text">Include watermark</p>
                <p className="truncate text-[11.5px] text-text-mute">
                  Adds the LUMIN mark + @{post.posterName} to the saved video
                </p>
              </div>
              <button
                onClick={() => setIncludeWatermark((v) => !v)}
                role="switch"
                aria-checked={includeWatermark}
                aria-label="Include watermark on saved video"
                className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
                  includeWatermark ? 'brand-gradient border-transparent' : 'border-line bg-box'
                }`}
              >
                <span
                  className={`absolute top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-md transition-transform ${
                    includeWatermark ? 'translate-x-[22px]' : 'translate-x-0.5'
                  }`}
                >
                  {includeWatermark ? (
                    <Check size={13} strokeWidth={3} className="text-hot-pink" />
                  ) : (
                    <X size={12} strokeWidth={3} className="text-text-mute" />
                  )}
                </span>
              </button>
            </div>
          )}

          <button
            onClick={handleCopyLink}
            className="mt-4 flex w-full items-center gap-3 rounded-xl border border-line px-3.5 py-3 text-left"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel text-text-mute">
              {copied ? <Check size={17} className="text-hot-pink" /> : <Link2 size={17} />}
            </span>
            <span className="flex-1 truncate text-[13px] text-text-mute">{shareUrl}</span>
            <span className="shrink-0 text-[13px] font-bold text-hot-pink">
              {copied ? 'Copied' : 'Copy'}
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
