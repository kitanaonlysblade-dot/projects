'use client';

import { useEffect, useState } from 'react';
import { getKeywordInsights, type ApiKeywordInsights } from '@/lib/api';
import { SellerLeads } from './SellerLeads';

const WINDOWS = [7, 30, 90];

// What shoppers search for through twin search and discovery, and how many of them
// found nothing — the products worth adding to the store. Without a subscription
// the server returns only the top few keywords with no numbers (a locked preview).
export function MerchantInsights() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<ApiKeywordInsights | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setError(false);
    getKeywordInsights(days)
      .then((d) => live && setData(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [days]);

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-8">
      <SellerLeads />
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-bold text-text">What shoppers want</h2>
          <p className="text-[12.5px] text-text-mute">
            Searches from people who couldn&apos;t find a twin. List a product that matches and they&apos;re notified.
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {WINDOWS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={`rounded-full px-3 py-1 text-[12px] font-semibold ${days === d ? 'brand-gradient text-white' : 'bg-box text-text'}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error && <p className="py-10 text-center text-[13px] text-text-mute">Couldn&apos;t load this right now.</p>}
      {!error && !data && <p className="py-10 text-center text-[13px] text-text-mute">Loading…</p>}

      {data && data.items.length === 0 && (
        <p className="py-10 text-center text-[13px] text-text-mute">No searches yet in the last {days} days.</p>
      )}

      {data && data.items.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {data.items.map((it) => (
            <li key={it.keyword} className="flex items-center justify-between gap-3 px-3.5 py-3">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-bold capitalize text-text">{it.example}</p>
                {!data.locked && it.last_searched_at && (
                  <p className="text-[11.5px] text-text-mute">
                    Last searched {new Date(it.last_searched_at).toLocaleDateString()}
                  </p>
                )}
              </div>
              {data.locked ? (
                <span className="shrink-0 rounded-full bg-box px-2.5 py-1 text-[11.5px] font-semibold text-text-mute">🔒 Locked</span>
              ) : (
                <div className="shrink-0 text-right">
                  <p className="text-[13px] font-bold text-text">
                    {it.searchers} {it.searchers === 1 ? 'shopper' : 'shoppers'}
                  </p>
                  {(it.unmet_searchers ?? 0) > 0 && (
                    <p className="text-[11.5px] font-semibold text-hot-pink">{it.unmet_searchers} still waiting</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {data?.locked && (
        <div className="mt-4 rounded-xl bg-panel p-4 text-center">
          <p className="text-[14px] font-bold text-text">See the full picture</p>
          <p className="mt-1 text-[12.5px] text-text-mute">
            Keyword insights are a subscription feature: how many shoppers want each item, and how many are still waiting for it.
          </p>
        </div>
      )}
    </div>
  );
}
