'use client';

import { useCallback, useEffect, useState } from 'react';
import { getWantedLeads, type ApiTwinMatch, type ApiWantedLead } from '@/lib/api';
import { StillFrame } from './MomentMedia';
import { TwinItSheet } from './TwinItSheet';

const FIT: Record<ApiTwinMatch, string> = {
  strong: 'Strong fit',
  good: 'Good fit',
  partial: 'Partial fit',
  weak: 'Weak fit',
};

// "Requests you can answer": open requests on the Wanted wall that one of the seller's own
// products already fits, best fit first. Shoppers are already asking, so this is the
// shortest path from demand to a sale: one tap opens the usual Twin it sheet. Free for
// every seller (the paid keyword insights below are a different thing: they are about what
// to add to a store, this is about what is already in it).
export function SellerLeads() {
  const [leads, setLeads] = useState<ApiWantedLead[] | null>(null);
  const [error, setError] = useState(false);
  const [twinning, setTwinning] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(false);
    getWantedLeads()
      .then(setLeads)
      .catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  return (
    <section className="mb-6">
      <h2 className="text-[17px] font-bold text-text">Requests you can answer</h2>
      <p className="mb-3 text-[12.5px] text-text-mute">
        Shoppers are asking for these, and something in your store already fits.
      </p>

      {error && <p className="py-4 text-[13px] text-text-mute">Couldn&apos;t load these right now.</p>}
      {!error && leads === null && <p className="py-4 text-[13px] text-text-mute">Loading…</p>}
      {leads && leads.length === 0 && (
        <p className="rounded-xl border border-line bg-white px-3.5 py-3 text-[13px] text-text-mute">
          Nothing open fits your products right now. New requests appear here as shoppers make them.
        </p>
      )}
      {note && <p className="mb-2 text-[12.5px] font-semibold text-text">{note}</p>}

      {leads && leads.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {leads.map((l) => (
            <li key={l.request.id} className="flex items-center gap-3 px-3.5 py-3">
              {l.request.video_url && l.request.start_ms != null ? (
                <StillFrame
                  url={l.request.video_url}
                  startMs={l.request.start_ms}
                  poster={l.request.thumbnail_url}
                  className="h-14 w-14 shrink-0 rounded-lg bg-black object-cover"
                />
              ) : (
                <span className="h-14 w-14 shrink-0 rounded-lg bg-box" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[13.5px] font-bold leading-snug text-text">{l.request.query}</p>
                <p className="text-[11.5px] text-text-mute">
                  {l.request.count} want this
                  {l.request.twinned > 0 ? ` · ${l.request.twinned} twinned already` : ''}
                </p>
                <p className="truncate text-[11.5px] text-text-mute">
                  Your {l.product.name} · {FIT[l.match]}
                </p>
              </div>
              <button
                onClick={() => setTwinning(l.request.id)}
                className="brand-gradient shrink-0 rounded-full px-4 py-2 text-[12.5px] font-bold text-white"
              >
                Twin it
              </button>
            </li>
          ))}
        </ul>
      )}

      {twinning && (
        <TwinItSheet
          requestId={twinning}
          onClose={() => setTwinning(null)}
          onDone={(m) => {
            setNote(m);
            load();
          }}
        />
      )}
    </section>
  );
}
