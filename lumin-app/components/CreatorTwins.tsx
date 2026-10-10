'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, X } from 'lucide-react';
import {
  ApiError,
  getCreatorTwins,
  reviewMomentLink,
  type ApiCreatorTwin,
  type ApiCreatorTwins,
  type ApiCreatorTwinState,
} from '@/lib/api';
import { MatchTag, ProductThumb, Tag, money } from './TwinBits';

const TABS: { id: ApiCreatorTwinState; label: string }[] = [
  { id: 'review', label: 'To review' },
  { id: 'approved', label: 'Approved' },
  { id: 'hidden', label: 'Hidden' },
];

// "Twins on your videos": the inbox where a creator approves or hides products other
// sellers have twinned to moments of their videos. The creator knows what is in their own
// video, so their call wins over the crowd: Approve makes it confirmed, Hide removes it from
// the compare list and stops it coming back for that moment.
export function CreatorTwins({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<ApiCreatorTwinState>('review');
  const [data, setData] = useState<ApiCreatorTwins | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    getCreatorTwins(tab)
      .then(setData)
      .catch(() => setError('Couldn’t load this right now.'));
  }, [tab]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const decide = async (t: ApiCreatorTwin, decision: 'confirm' | 'reject' | 'clear') => {
    setBusy(t.link_id);
    try {
      await reviewMomentLink(t.video_post_id, t.link_id, decision);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong — try again.');
    } finally {
      setBusy(null);
    }
  };

  const count = (id: ApiCreatorTwinState) => (data ? data[id] : 0);

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex shrink-0 items-center gap-3 px-4 py-4">
        <button onClick={onBack} aria-label="Back" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line">
          <ArrowLeft size={18} className="text-text" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[18px] font-extrabold text-text">Twins on your videos</h1>
      </div>

      <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-3" role="tablist" aria-label="Review state">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${
              tab === t.id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-text'
            }`}
          >
            {t.label}
            {t.id === 'review' && count('review') > 0 ? ` ${count('review')}` : ''}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 pb-10">
        {error && <p role="alert" className="py-4 text-center text-[13px] font-semibold text-hot-pink">{error}</p>}
        {!data && !error && <p className="py-14 text-center text-[13px] text-text-mute">Loading…</p>}
        {data?.items.length === 0 && (
          <p className="py-14 text-center text-[13px] leading-relaxed text-text-mute">
            {tab === 'review' ? 'Nothing waiting for your review.' : tab === 'approved' ? 'Nothing approved yet.' : 'Nothing hidden.'}
          </p>
        )}
        {data?.items.map((t) => (
          <div key={t.link_id} className="rounded-2xl border border-line p-3">
            <div className="flex gap-3">
              <ProductThumb product={t.product} size={52} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-bold text-text">
                  {t.product.name} · {money(t.product.price)}
                </p>
                <p className="truncate text-[12.5px] text-text-mute">
                  {[t.seller_name, t.for_query ? `for “${t.for_query}”` : null].filter(Boolean).join(' · ')}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {t.new_seller && <Tag tone="gray">New seller</Tag>}
                  {t.match && <MatchTag match={t.match} />}
                  {t.kept > 0 && <Tag tone="green">{t.kept} kept</Tag>}
                </div>
              </div>
            </div>
            <div className="mt-2.5 flex gap-2">
              {t.state !== 'approved' && t.state !== 'hidden' && (
                <>
                  <button
                    onClick={() => void decide(t, 'confirm')}
                    disabled={busy === t.link_id}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-50 py-2.5 text-[13px] font-bold text-emerald-700 disabled:opacity-50"
                  >
                    <Check size={15} aria-hidden="true" />
                    Approve
                  </button>
                  <button
                    onClick={() => void decide(t, 'reject')}
                    disabled={busy === t.link_id}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-box py-2.5 text-[13px] font-bold text-text disabled:opacity-50"
                  >
                    <X size={15} aria-hidden="true" />
                    Hide
                  </button>
                </>
              )}
              {t.state === 'approved' && (
                <button
                  onClick={() => void decide(t, 'reject')}
                  disabled={busy === t.link_id}
                  className="flex-1 rounded-xl bg-box py-2.5 text-[13px] font-bold text-text disabled:opacity-50"
                >
                  Hide
                </button>
              )}
              {t.state === 'hidden' && (
                <button
                  onClick={() => void decide(t, 'clear')}
                  disabled={busy === t.link_id}
                  className="flex-1 rounded-xl bg-box py-2.5 text-[13px] font-bold text-text disabled:opacity-50"
                >
                  Unhide
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
