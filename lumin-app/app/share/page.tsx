'use client';

import { BRAND } from '@/lib/brand';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { scanLink, ApiError } from '@/lib/api';
import { scanRecording, sendRecording } from '@/lib/scanClip';

// Where Android's share sheet lands (Lumin installed from Chrome). A shared video file is scanned directly;
// a shared link (or text containing one) is scanned as a link.
const URL_RE = /https?:\/\/[^\s]+/i;

function ShareInner() {
  const router = useRouter();
  const params = useSearchParams();
  const started = useRef(false);
  const [status, setStatus] = useState<'busy' | 'none' | 'error'>('busy');
  const [message, setMessage] = useState('');
  const [deeper, setDeeper] = useState<File | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        let res;
        if (params.get('file')) {
          const cache = await caches.open('lumin-share');
          const hit = await cache.match('/shared-video');
          if (!hit) throw new ApiError(400, 'That shared video is no longer available. Share it again.');
          const blob = await hit.blob();
          await cache.delete('/shared-video');
          const file = new File([blob], 'shared.mp4', { type: blob.type || 'video/mp4' });
          res = await scanRecording(file);
          if (res.deeper_check) setDeeper(file);
        } else {
          const text = [params.get('url'), params.get('text'), params.get('title')].filter(Boolean).join(' ');
          const link = text.match(URL_RE)?.[0];
          if (!link) throw new ApiError(400, `Nothing to scan was shared. Share a video or a video link to ${BRAND.name}.`);
          res = await scanLink(link);
        }
        if (res.found && res.video_post_id) {
          router.replace(`/v/${res.video_post_id}`);
          return;
        }
        setMessage(res.message || `We couldn't find this on ${BRAND.name}. That doesn't mean anything is wrong with it — most videos aren't here.`);
        setSuggestion(res.suggestion?.video_post_id ?? null);
        setStatus('none');
      } catch (e) {
        setMessage(e instanceof ApiError ? e.message : 'Something went wrong — please try again.');
        setStatus('error');
      }
    })();
  }, [params, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-panel px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6 text-center">
        {status === 'busy' ? (
          <p className="text-[15px] font-semibold text-text">Looking for this on {BRAND.name}…</p>
        ) : (
          <>
            <p className={`text-[14px] leading-snug ${status === 'error' ? 'text-red-600' : 'text-text-mute'}`}>{message}</p>
            {suggestion && (
              <Link
                href={`/v/${suggestion}`}
                className="mt-3 block w-full rounded-full border border-hot-pink px-4 py-2 text-[13px] font-bold text-hot-pink"
              >
                Did you mean this video? Take a look
              </Link>
            )}
            {deeper && (
              <button
                onClick={async () => {
                  const file = deeper;
                  setDeeper(null);
                  setStatus('busy');
                  try {
                    const res = await sendRecording(file);
                    if (res.found && res.video_post_id) {
                      router.replace(`/v/${res.video_post_id}`);
                      return;
                    }
                    setMessage(res.message || `We couldn't find this on ${BRAND.name}. That doesn't mean anything is wrong with it — most videos aren't here.`);
                    setSuggestion(res.suggestion?.video_post_id ?? null);
                    setStatus('none');
                  } catch (e) {
                    setMessage(e instanceof ApiError ? e.message : 'Something went wrong — please try again.');
                    setStatus('error');
                  }
                }}
                className="mt-3 block w-full rounded-full border border-hot-pink px-4 py-2 text-[13px] font-bold text-hot-pink"
              >
                Send the recording for a deeper check
              </button>
            )}
            <Link href="/" className="mt-4 inline-block rounded-full bg-hot-pink px-4 py-2 text-[13.5px] font-bold text-white">
              Open {BRAND.name}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function SharePage() {
  return (
    <Suspense fallback={null}>
      <ShareInner />
    </Suspense>
  );
}
