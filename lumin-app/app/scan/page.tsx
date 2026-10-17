'use client';

import { BRAND } from '@/lib/brand';
import { useState } from 'react';
import Link from 'next/link';
import { ApiError, type ApiScanMatch } from '@/lib/api';
import { scanRecording, sendRecording } from '@/lib/scanClip';

// Web version of "scan a video": upload a screen recording of a video playing
// somewhere else and see which Lumin video (and products) it is.
export default function ScanPage() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApiScanMatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deeper, setDeeper] = useState<File | null>(null);

  const onFile = async (file: File | undefined, send = false) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setDeeper(null);
    try {
      const res = await (send ? sendRecording(file) : scanRecording(file));
      setResult(res);
      if (res.deeper_check) setDeeper(file);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-panel px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6">
        <h1 className="mb-1 text-[15px] font-bold text-text">Scan a video</h1>
        <p className="mb-4 text-[13.5px] leading-snug text-text-mute">
          Screen-record a video you saw elsewhere (6–8 seconds works best), then choose the recording here to find its products. When your device can, it is checked on the device and the recording is not uploaded.
        </p>
        <input
          type="file"
          accept="video/*"
          disabled={busy}
          onChange={(e) => onFile(e.target.files?.[0])}
          className="block w-full text-[13px]"
        />
        {busy && <p className="mt-3 text-[13.5px] text-text-mute">Looking…</p>}
        {error && <p className="mt-3 text-[13.5px] text-red-600">{error}</p>}
        {result && result.found && result.video_post_id && (
          <div className="mt-4">
            <p className="text-[13.5px] font-semibold text-text">Found it.</p>
            {result.disputed && (
              <p className="mt-1 text-[12.5px] text-text-mute">This video is under review for a possible duplicate.</p>
            )}
            <Link
              href={`/v/${result.video_post_id}`}
              className="mt-2 inline-block rounded-full bg-hot-pink px-4 py-2 text-[13.5px] font-bold text-white"
            >
              See the products
            </Link>
          </div>
        )}
        {result && !result.found && (
          <>
            <p className="mt-4 text-[13.5px] leading-snug text-text-mute">
              {result.message || `We couldn't find this on ${BRAND.name}. That doesn't mean anything is wrong with it — most videos aren't here.`}
            </p>
            {result.suggestion && (
              <div className="mt-3 rounded-xl border border-line p-3">
                <p className="text-[13px] font-semibold text-text">Did you mean this video?</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-text-mute">We&apos;re not sure, so check that it&apos;s the one you saw.</p>
                <Link
                  href={`/v/${result.suggestion.video_post_id}`}
                  className="mt-2 inline-block rounded-full bg-hot-pink px-4 py-2 text-[13px] font-bold text-white"
                >
                  Take a look
                </Link>
              </div>
            )}
            {deeper && (
              <button
                disabled={busy}
                onClick={() => onFile(deeper, true)}
                className="mt-2 rounded-full border border-hot-pink px-4 py-2 text-[13px] font-bold text-hot-pink disabled:opacity-60"
              >
                Send the recording for a deeper check
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
