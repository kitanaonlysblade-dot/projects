'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { getCreatorImpact, getCreatorTwins, type ApiCreatorImpact } from '@/lib/api';
import { compactCount } from '@/lib/wanted';
import { TwinItSheet } from './TwinItSheet';
import { TwinIcon } from './TwinBits';

// "Your impact": what the creator's own videos make people ask for, and the twins sellers
// have put on them. "Tag it" lets a creator who has a shop twin their own product to a
// moment first. Only real counts are shown: no sales or earnings numbers, because nothing
// here measures them yet.
export function CreatorImpact({
  username,
  onBack,
  onOpenTwins,
  onOpenRequest,
}: {
  username: string;
  onBack: () => void;
  onOpenTwins: () => void;
  onOpenRequest: (id: string) => void;
}) {
  const [data, setData] = useState<ApiCreatorImpact | null>(null);
  const [toReview, setToReview] = useState(0);
  const [error, setError] = useState(false);
  const [tagging, setTagging] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(false);
    getCreatorImpact().then(setData).catch(() => setError(true));
    getCreatorTwins('review').then((r) => setToReview(r.review)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const stat = (n: number, label: string) => (
    <div className="rounded-2xl bg-panel p-3.5">
      <p className="text-[24px] font-extrabold leading-none text-text">{compactCount(n)}</p>
      <p className="mt-1.5 text-[12.5px] leading-snug text-text-mute">{label}</p>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white">
      <div className="flex shrink-0 items-center gap-3 px-4 py-4">
        <button onClick={onBack} aria-label="Back" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line">
          <ArrowLeft size={18} className="text-text" />
        </button>
        <h1 className="flex-1 truncate text-center text-[18px] font-extrabold text-text">Your impact</h1>
        <span className="h-10 w-10 shrink-0" aria-hidden="true" />
      </div>

      {error && <p className="py-14 text-center text-[13px] text-text-mute">Couldn&apos;t load this right now.</p>}
      {!error && !data && <p className="py-14 text-center text-[13px] text-text-mute">Loading…</p>}

      {data && (
        <div className="px-4 pb-10">
          <div className="flex items-center gap-3 pb-4">
            <span className="brand-gradient flex h-12 w-12 items-center justify-center rounded-full text-[18px] font-extrabold text-white">
              {username.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <p className="text-[16px] font-extrabold text-text">@{username}</p>
              <p className="text-[12.5px] text-text-mute">Creator</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {stat(data.wanted, 'shoppers asked about your videos')}
            {stat(data.twins_offered, 'twins offered on your videos')}
            {stat(data.twins_approved, 'twins approved')}
            {stat(toReview, 'waiting for your review')}
          </div>

          <button
            onClick={onOpenTwins}
            className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-line p-3.5 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-bold text-text">Twins on your videos</span>
              <span className="block text-[12.5px] text-text-mute">
                {toReview > 0 ? `${toReview} to review` : 'Approve or hide what sellers add'}
              </span>
            </span>
            <ChevronRight size={17} className="text-text-mute" aria-hidden="true" />
          </button>

          <h2 className="mb-2 mt-6 text-[15px] font-extrabold text-text">Most-wanted moments in your videos</h2>
          {note && (
            <p role="status" className="mb-2 text-[12.5px] font-semibold text-text">
              {note}
            </p>
          )}
          {data.moments.length === 0 && (
            <p className="rounded-2xl bg-panel p-4 text-[13px] leading-relaxed text-text-mute">
              Nothing yet. When shoppers scan a moment in one of your videos and others want it too, it shows up here.
            </p>
          )}
          <ul className="space-y-2">
            {data.moments.map((m) => (
              <li key={m.request_id} className="flex items-center gap-3 rounded-2xl border border-line p-2.5">
                <button onClick={() => onOpenRequest(m.request_id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  {m.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.thumbnail_url} alt="" className="h-14 w-14 shrink-0 rounded-xl bg-box object-cover" />
                  ) : (
                    <span className="h-14 w-14 shrink-0 rounded-xl bg-box" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block text-[14px] font-bold leading-snug text-text">{m.query}</span>
                    <span className="block text-[12.5px] text-text-mute">
                      {compactCount(m.wants)} want it · {m.twinned} twinned
                    </span>
                  </span>
                </button>
                {data.can_tag &&
                  (m.mine ? (
                    <span className="shrink-0 text-[12px] font-bold text-emerald-700">Tagged</span>
                  ) : (
                    <button
                      onClick={() => setTagging(m.request_id)}
                      className="brand-gradient flex shrink-0 items-center gap-1 rounded-full px-3.5 py-2 text-[12.5px] font-bold text-white"
                    >
                      <TwinIcon size={13} />
                      Tag it
                    </button>
                  ))}
              </li>
            ))}
          </ul>
          {!data.can_tag && data.moments.length > 0 && (
            <p className="mt-3 text-[12px] leading-relaxed text-text-mute">
              Open a shop to tag your own products on these moments before anyone else.
            </p>
          )}
        </div>
      )}

      {tagging && (
        <TwinItSheet
          requestId={tagging}
          onClose={() => setTagging(null)}
          onDone={(m) => {
            setNote(m);
            load();
          }}
        />
      )}
    </div>
  );
}
