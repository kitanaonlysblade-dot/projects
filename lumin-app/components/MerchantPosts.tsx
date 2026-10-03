'use client';

import { useRef, useState } from 'react';
import { Check, MoreVertical, Plus, Repeat2, Trash2, Upload, Video, X } from 'lucide-react';
import type { Product, VideoPost } from '@/lib/types';
import { ApiError, uploadFile } from '@/lib/api';

import { PostThumbnail, ProductThumbnail } from './Thumbnails';
function emptyPost(): VideoPost {
  return {
    id: `post-${Date.now()}`,
    posterName: 'Your business',
    postedAt: 'Just now',
    description: '',
    // Empty on purpose — a new post starts with no video at all, so the
    // editor's first step (below) genuinely requires picking one rather
    // than silently defaulting to a placeholder.
    videoUrl: '',
    width: 1080,
    height: 1920,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    products: [],
  };
}

// Standard browser technique for a client-side video thumbnail — no
// library needed: load the file into an off-DOM <video>, seek partway
// into the clip (frame 0 is very often a black/blank frame right as
// recording starts), draw the current frame onto a <canvas>, and read
// it back out as a data URL. Works for both the "Record video" and
// "Upload video" paths in VideoUploader below since both ultimately
// hand it a real File object. blob: URLs are same-origin, so the canvas
// is never tainted and toDataURL() works without any CORS handling.
function generateVideoThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    const cleanup = () => URL.revokeObjectURL(objectUrl);

    video.onloadedmetadata = () => {
      // Halfway into the first second, capped to the clip's own length —
      // avoids seeking past a very short clip's actual duration.
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        cleanup();
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      cleanup();
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('Failed to load video for thumbnail generation'));
    };
  });
}

// Reads a video File's real pixel dimensions before it's ever uploaded —
// this is what lets the post it becomes carry an accurate width/height
// from its very first render (see VideoPost.width/height, and
// VideoStage.tsx's own "knownAspect" fast path there), instead of
// guessing 9:16 and having that screen visibly resize once the live
// <video> element reports its actual shape.
//
// Same dual-event technique VideoStage.tsx's own dimension listener uses
// and documents there: some files (screen recordings, phone footage with
// rotation metadata) report a provisional size at loadedmetadata and
// only settle on the real one once decoding starts, signaled by a
// separate `resize` event — so this waits for a short quiet period after
// the *last* dimension-bearing event fires, rather than trusting
// whichever one fires first.
function readVideoDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let best: { width: number; height: number } | null = null;

    const cleanup = () => {
      if (settleTimer) clearTimeout(settleTimer);
      video.removeEventListener('loadedmetadata', capture);
      video.removeEventListener('resize', capture);
      video.removeEventListener('error', onError);
      URL.revokeObjectURL(objectUrl);
    };

    const capture = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      best = { width: video.videoWidth, height: video.videoHeight };
      // Debounced rather than resolved immediately — a later `resize`
      // event reporting a different (more accurate) size replaces
      // `best` and restarts the wait, so this only settles once
      // nothing's changed for a bit.
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        cleanup();
        resolve(best as { width: number; height: number });
      }, 200);
    };

    const onError = () => {
      cleanup();
      reject(new Error('Failed to read video dimensions'));
    };

    video.addEventListener('loadedmetadata', capture);
    video.addEventListener('resize', capture);
    video.addEventListener('error', onError);
  });
}

// generateVideoThumbnail above hands back a data: URL (a canvas can't
// produce anything else) — but that's a base64 string easily over 50KB,
// nowhere close to fitting in thumbnail_url's actual column width
// (String(500) — see the VideoPost model), and it's exactly the same
// "not really persistent" problem a blob: URL has: it only exists in
// this render, never a real file anyone else's browser could fetch.
// Converting it to a File lets it go through the same /uploads endpoint
// as everything else, so what actually gets saved is a real URL.
async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || 'image/jpeg' });
}

// Same real-file pattern as the Products tab's photo uploader — a blob:
// URL the browser can actually play, not a simulated upload. Record and
// Upload are separate inputs (not one generic picker) for the same reason
// the photo uploader splits Camera/Gallery: `capture` forces the device
// camera open directly on mobile, but only makes sense for one video at a
// time, so it can't share an input with a plain multi-purpose file picker.
//
// The blob: URL only ever drives the local <video> preview below — the
// value actually reported via onChange (and so the value that ends up in
// video_url once this gets saved) is the real, persistent URL from
// POST /uploads, not the blob. onChange('') while an upload is in flight
// is what keeps the editor's "Continue" step disabled until there's a
// real URL to move forward with (see PostEditor's canSave/`disabled`
// below, both of which already just check videoUrl is non-empty).
export function VideoUploader({
  videoUrl,
  onChange,
  onThumbnailChange,
  onDimensionsChange,
  destinationLabel = 'the shop feed',
}: {
  videoUrl: string;
  onChange: (url: string) => void;
  // Optional — callers that don't care about a thumbnail (there aren't
  // any left in this codebase, but the prop stays optional rather than
  // required so VideoUploader doesn't force every future caller to wire
  // it up even if they genuinely don't need one) can simply omit it.
  onThumbnailChange?: (url: string) => void;
  // Fires once readVideoDimensions above resolves for whatever file was
  // just picked — callers use this to keep the post's own width/height
  // in sync with the real file, instead of leaving them at whatever
  // placeholder the post started with. Optional for the same reason
  // onThumbnailChange is, though both current callers (PostEditor,
  // UploadDiscoverPostModal) do wire it up.
  onDimensionsChange?: (width: number, height: number) => void;
  destinationLabel?: string;
}) {
  const recordInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  // Separate from the videoUrl prop on purpose — this is only ever a
  // blob: URL for the local preview, while videoUrl is the real,
  // submitted value. Initialized from videoUrl so editing an existing
  // post (which already has a real URL, perfectly valid as a preview
  // src too) shows its current video immediately.
  const [previewSrc, setPreviewSrc] = useState(videoUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setError(null);

    if (previewSrc.startsWith('blob:')) URL.revokeObjectURL(previewSrc);
    setPreviewSrc(URL.createObjectURL(file));
    onChange(''); // real value not ready yet — see the note above this component
    setUploading(true);

    // Runs in parallel with the actual upload below, not after it — this
    // only ever reads the local file's own metadata, no network involved,
    // so it typically resolves well before the upload (or even the
    // thumbnail capture) finishes.
    if (onDimensionsChange) {
      readVideoDimensions(file)
        .then(({ width, height }) => onDimensionsChange(width, height))
        // A file the browser can't introspect (rare — a container format
        // it can demux but not report metadata for) shouldn't block
        // posting the video itself, same reasoning the thumbnail catch
        // below uses. The post just keeps whatever width/height it
        // already had, which is the same "guess and let VideoStage
        // correct itself" behavior every post had before this existed.
        .catch((err) => console.warn('Reading video dimensions failed:', err));
    }

    if (onThumbnailChange) {
      generateVideoThumbnail(file)
        .then((dataUrl) => dataUrlToFile(dataUrl, 'thumbnail.jpg'))
        .then((thumbnailFile) => uploadFile(thumbnailFile))
        .then(({ url }) => onThumbnailChange(url))
        // A thumbnail failing to generate OR upload (an unsupported
        // codec in this browser, a zero-frame file, a flaky network,
        // etc.) should never block posting the video itself — the grid
        // tiles already have a solid-color fallback for exactly this
        // case, so this just logs and moves on.
        .catch((err) => console.warn('Thumbnail generation/upload failed:', err));
    }

    try {
      const { url } = await uploadFile(file);
      onChange(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed — check your connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <span className="mb-1 block text-[12.5px] font-bold text-text">Video</span>
      <p className="mb-2 text-[11.5px] text-text-mute">
        Record a new video or upload one from your device — this is what plays in {destinationLabel}.
      </p>

      {previewSrc ? (
        <video src={previewSrc} controls muted className="max-h-64 w-full rounded-xl bg-black" />
      ) : (
        <div className="flex aspect-[9/13] max-h-52 w-full items-center justify-center rounded-xl border border-dashed border-line bg-panel">
          <p className="text-[12.5px] text-text-mute">No video selected yet</p>
        </div>
      )}

      {uploading && <p className="mt-2 text-[12.5px] text-text-mute">Uploading…</p>}
      {error && <p className="mt-2 text-[12.5px] text-hot-pink">{error}</p>}

      <div className="mt-2.5 flex gap-2">
        <button
          onClick={() => recordInputRef.current?.click()}
          disabled={uploading}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line py-2 text-[12.5px] font-bold text-text disabled:opacity-40"
        >
          <Video size={16} />
          Record video
        </button>
        <button
          onClick={() => uploadInputRef.current?.click()}
          disabled={uploading}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line py-2 text-[12.5px] font-bold text-text disabled:opacity-40"
        >
          <Upload size={16} />
          Upload video
        </button>
      </div>

      {/* `capture="environment"` opens the rear camera directly on a
          phone/tablet; desktop browsers without a camera just ignore it
          and fall back to a normal file picker, so nothing breaks there. */}
      <input
        ref={recordInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        onChange={(e) => {
          handleFile(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />
      <input
        ref={uploadInputRef}
        type="file"
        accept="video/*"
        onChange={(e) => {
          handleFile(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />
    </div>
  );
}

// Two steps: video first, then caption + product selection — you can't
// reach the second step without a video, matching the same "step one has
// to exist before step two" rule already enforced between the Products
// and Posts tabs. Multi-select against the merchant's own product
// listings — there's no way to type in a new product here; a product has
// to already exist (created in the Products tab) before it can be
// attached to a video.
function PostEditor({
  post,
  isNew,
  merchantProducts,
  onSave,
  onCancel,
}: {
  post: VideoPost;
  isNew: boolean;
  merchantProducts: Product[];
  onSave: (post: VideoPost) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<'video' | 'details'>('video');
  const [videoUrl, setVideoUrl] = useState(post.videoUrl ?? '');
  const [thumbnailUrl, setThumbnailUrl] = useState(post.thumbnailUrl);
  // Starts at whatever the post already had (1080x1920 for a brand-new
  // one — see emptyPost above) and gets replaced the moment a real video
  // file is picked, via VideoUploader's onDimensionsChange below — so a
  // saved post's width/height always reflect the actual file, not a
  // placeholder guess.
  const [width, setWidth] = useState(post.width ?? 1080);
  const [height, setHeight] = useState(post.height ?? 1920);
  const [description, setDescription] = useState(post.description);
  const [selectedIds, setSelectedIds] = useState<string[]>((post.products ?? []).map((p) => p.id));

  const toggleProduct = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((pid) => pid !== id) : [...prev, id]));
  };

  const canSave = videoUrl.length > 0 && selectedIds.length > 0;

  const handleSave = () => {
    const products = merchantProducts.filter((p) => selectedIds.includes(p.id));
    onSave({ ...post, videoUrl, thumbnailUrl, width, height, description: description.trim(), products });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 lg:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[14px] font-bold text-text">
            {isNew ? 'New post' : 'Edit post'} · {step === 'video' ? 'Step 1 of 2' : 'Step 2 of 2'}
          </p>
          <button onClick={onCancel} aria-label="Close">
            <X size={18} className="text-text-mute" />
          </button>
        </div>

        {step === 'video' ? (
          <>
            <VideoUploader
              videoUrl={videoUrl}
              onChange={setVideoUrl}
              onThumbnailChange={setThumbnailUrl}
              onDimensionsChange={(w, h) => {
                setWidth(w);
                setHeight(h);
              }}
            />
            <button
              onClick={() => videoUrl && setStep('details')}
              disabled={!videoUrl}
              className="brand-gradient mt-4 w-full rounded-full py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
            >
              Continue
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setStep('video')} className="mb-3 text-[12.5px] font-bold text-hot-pink">
              ← Back to video
            </button>

            <label className="mb-4 block">
              <span className="mb-1 block text-[12.5px] font-bold text-text">
                Caption <span className="font-normal text-text-mute">(optional)</span>
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Describe this video..."
                className="w-full resize-none rounded-lg border border-line px-3 py-2 text-[13.5px] text-text focus:border-hot-pink focus:outline-none"
              />
            </label>

            <span className="mb-2 block text-[12.5px] font-bold text-text">
              Products featured ({selectedIds.length} selected)
            </span>
            {merchantProducts.length === 0 ? (
              <p className="rounded-lg bg-panel px-3 py-4 text-center text-[12.5px] text-text-mute">
                You don&apos;t have any products yet — create one in the Products tab first.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {merchantProducts.map((product) => {
                  const selected = selectedIds.includes(product.id);
                  return (
                    <button
                      key={product.id}
                      onClick={() => toggleProduct(product.id)}
                      aria-pressed={selected}
                      className={`flex items-center gap-2.5 rounded-lg border p-2.5 text-left ${
                        selected ? 'border-hot-pink bg-hot-pink/5' : 'border-line'
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${
                          selected ? 'brand-gradient' : 'border border-line'
                        }`}
                      >
                        {selected && <Check size={13} className="text-white" />}
                      </span>
                      <span className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-box">
                        <ProductThumbnail product={product} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-bold text-text">{product.name}</span>
                        <span className="text-[12.5px] text-text-mute">${product.price.toFixed(2)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => canSave && handleSave()}
              disabled={!canSave}
              className="brand-gradient mt-4 w-full rounded-full py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
            >
              Save post
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface MerchantPostsProps {
  posts: VideoPost[];
  merchantProducts: Product[];
  onAddPost: (post: VideoPost) => void;
  onUpdatePost: (post: VideoPost) => void;
  onDeletePost: (post: VideoPost) => void;
  onOpenPost: (post: VideoPost) => void;
  onGoToProducts: () => void;
}

// This manages the same `shopPosts` the consumer shop feed swipes through
// — in this single-merchant prototype there's only one seller, so "the
// shop feed" and "this merchant's catalog" are the same pool. Editing or
// deleting here shows up immediately if you switch back to Shop.
export function MerchantPosts({
  posts,
  merchantProducts,
  onAddPost,
  onUpdatePost,
  onDeletePost,
  onOpenPost,
  onGoToProducts,
}: MerchantPostsProps) {
  const [editing, setEditing] = useState<VideoPost | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const startNew = () => {
    setIsNew(true);
    setEditing(emptyPost());
  };
  const startEdit = (post: VideoPost) => {
    setIsNew(false);
    setEditing(post);
    setOpenMenuId(null);
  };
  const handleSave = (post: VideoPost) => {
    if (isNew) onAddPost(post);
    else onUpdatePost(post);
    setEditing(null);
  };

  return (
    <div className="flex-1 px-4 py-5 lg:px-8 lg:py-8">
      {openMenuId && (
        <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} aria-hidden="true" />
      )}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-[13px] font-bold text-text">
          {posts.length} post{posts.length === 1 ? '' : 's'}
        </p>
        {merchantProducts.length === 0 ? (
          <button
            onClick={onGoToProducts}
            className="rounded-full border border-line px-3.5 py-1.5 text-[12.5px] font-bold text-text-mute"
          >
            Create a product first
          </button>
        ) : (
          <button
            onClick={startNew}
            className="brand-gradient flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold text-white"
          >
            <Plus size={15} />
            New post
          </button>
        )}
      </div>

      {posts.length === 0 ? (
        <p className="py-16 text-center text-[13.5px] text-text-mute">
          {merchantProducts.length === 0
            ? 'List a product in the Products tab, then come back here to make a video about it.'
            : 'No posts yet — create your first one to start selling.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {posts.map((post) => {
            const firstProduct = post.products?.[0];
            const extraCount = (post.products?.length ?? 0) - 1;
            return (
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
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                  <p className="line-clamp-2 text-[11.5px] text-white">{post.description}</p>
                  {firstProduct && (
                    <p className="mt-0.5 text-[12.5px] font-bold text-white">
                      ${firstProduct.price.toFixed(2)}
                      {extraCount > 0 ? ` +${extraCount} more` : ''}
                    </p>
                  )}
                </div>

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
                    {/* A repost's own row carries no real content of its
                        own to edit (see PostThumbnail/description above —
                        both resolve through the original), so editing is
                        only offered for posts this account actually
                        authored. */}
                    {!post.repostId && (
                      <button
                        onClick={() => startEdit(post)}
                        className="block w-full whitespace-nowrap px-3 py-2 text-left text-[12.5px] font-medium text-text"
                      >
                        Edit post
                      </button>
                    )}
                    <button
                      onClick={() => {
                        onDeletePost(post);
                        setOpenMenuId(null);
                      }}
                      className="flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[12.5px] font-medium text-hot-pink"
                    >
                      <Trash2 size={14} />
                      {post.repostId ? 'Remove repost' : 'Delete post'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <PostEditor
          post={editing}
          isNew={isNew}
          merchantProducts={merchantProducts}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
