'use client';

import { BRAND } from '@/lib/brand';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getScanVideoPage, recordProductTap, ApiError, type ApiScanVideoPage } from '@/lib/api';

// Public page for one video: the video big on a background carrying its own colours (same look as
// the in-app scan result), who posted it, and the products tagged in it. Reached from a shared link
// (or later the phone app) with no prior app state, so it is a real route like reset-password.
// "Buy" opens the video in the app (`/?post=<id>`), where the product drawer and checkout live.
export default function VideoPage() {
  const id = String(useParams<{ id: string }>().id ?? '');
  const [data, setData] = useState<ApiScanVideoPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getScanVideoPage(id)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : 'Could not load this video.'));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-panel px-4">
        <p className="text-[14px] text-text-mute">{error}</p>
      </div>
    );
  }
  if (!data) return <div className="min-h-screen bg-ink" />;

  const { post, registered_at, disputed } = data;
  const src = post.lite_video_url || post.video_url;
  const open = `/?post=${post.id}`;

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink">
      {post.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.thumbnail_url}
          alt=""
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 h-full w-full scale-150 object-cover opacity-90 blur-3xl saturate-150"
        />
      ) : (
        <div className="brand-gradient pointer-events-none fixed inset-0" />
      )}
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-b from-black/10 via-black/10 to-black/60" />

      {/* Phone: one column. Desktop: the video and who posted it on the left, the products stacked down the right. */}
      <div className="relative z-10 mx-auto w-full max-w-[380px] px-4 py-6 lg:flex lg:max-w-[1000px] lg:items-start lg:gap-12 lg:py-10">
        <div className="lg:w-[380px] lg:shrink-0">
        {src && (
          <video
            src={src}
            poster={post.thumbnail_url ?? undefined}
            controls
            playsInline
            className="mx-auto block aspect-[9/16] max-h-[70vh] w-full rounded-2xl bg-black object-cover shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
          />
        )}

        <div className="mt-4 flex items-center gap-3">
          <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-box">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.poster_avatar_url || '/images/placeholder.svg'} alt="" className="h-full w-full object-cover" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-white">{post.poster_display_name}</p>
            {registered_at && (
              <p className="text-[12px] text-white/70">
                First seen on {BRAND.name}{' '}
                {new Date(registered_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
              </p>
            )}
          </div>
        </div>
        {post.description && <p className="mt-2 text-[13.5px] leading-snug text-white/80">{post.description}</p>}

        {disputed && (
          <p className="mt-3 rounded-xl bg-black/30 p-3 text-[12px] leading-snug text-white/85">
            This video is under review because a similar video was posted by someone else. Purchases stay covered by buyer protection.
          </p>
        )}

        </div>

        <div className="min-w-0 lg:flex-1">
        <h2 className="mb-2 mt-5 text-[13px] font-bold text-white lg:mt-0 lg:text-[15px]">Products in this video</h2>
        <div className="space-y-2">
          {post.products.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3">
              {p.images[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.images[0].url} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-text">{p.name}</p>
                <p className="text-sm font-bold text-hot-pink">${parseFloat(p.price).toFixed(2)}</p>
              </div>
              <a
                href={open}
                onClick={() => {
                  recordProductTap(post.id, p.id).catch(() => {});
                }}
                className="shrink-0 rounded-full bg-hot-pink px-4 py-2 text-[13px] font-bold text-white"
              >
                Buy now
              </a>
            </div>
          ))}
          {post.products.length === 0 && <p className="text-[13px] text-white/70">No products are tagged in this video.</p>}
        </div>
        </div>
      </div>
    </div>
  );
}
