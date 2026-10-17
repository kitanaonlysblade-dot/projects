'use client';

import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import {
  ApiError,
  getMyTwinChoices,
  twinItForWanted,
  withdrawWantedTwin,
  type ApiTwinChoice,
} from '@/lib/api';
import { MatchTag, ProductThumb, Tag, money } from './TwinBits';
import { TwinIcon } from './TwinBits';

// "Twin it — choose your product": a seller answers a wanted moment with one of their own
// products, best matches first. Shoppers see it as "Offered" until it is confirmed, so a
// loose fit costs the seller nothing but a weak label - and the sheet says so up front.
export function TwinItSheet({
  requestId,
  onClose,
  onDone,
}: {
  requestId: string;
  onClose: () => void;
  // Called after a twin is added; the message is for the screen behind to show.
  onDone: (message: string) => void;
}) {
  const [choices, setChoices] = useState<ApiTwinChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    getMyTwinChoices(requestId)
      .then((rows) => {
        setChoices(rows);
        // Start on the best fit, but only when it really is one.
        setPicked((cur) => cur ?? rows.find((r) => !r.twinned && (r.match === 'strong' || r.match === 'good'))?.product.id ?? null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Couldn’t load your products — try again.'));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  const submit = async () => {
    const choice = choices?.find((c) => c.product.id === picked);
    if (!choice || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await twinItForWanted(requestId, choice.product.id);
      onDone(
        r.notified > 0
          ? `Twinned “${choice.product.name}” — ${r.notified} shopper${r.notified === 1 ? '' : 's'} told.`
          : `Twinned “${choice.product.name}”.`,
      );
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong — try again.');
    } finally {
      setBusy(false);
    }
  };

  const takeBack = async (c: ApiTwinChoice) => {
    setBusy(true);
    try {
      await withdrawWantedTwin(requestId, c.product.id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t take it back — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 lg:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Twin it — choose your product"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-[430px] flex-col rounded-t-3xl bg-white pb-[max(1rem,env(safe-area-inset-bottom))] pt-2.5 lg:rounded-3xl"
      >
        <span className="mx-auto mb-2 h-1 w-10 rounded-full bg-box lg:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between px-5 pb-1">
          <h2 className="flex items-center gap-2 text-[17px] font-extrabold text-text">
            <TwinIcon size={18} />
            Twin it — choose your product
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-text-mute">
            <X size={20} />
          </button>
        </div>
        <p className="px-5 pb-3 text-[13px] leading-relaxed text-text-mute">
          Your products, best matches first. Shoppers see it as “Offered” until it’s confirmed.
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          {choices === null && !error && <p className="py-10 text-center text-[13px] text-text-mute">Loading your products…</p>}
          {choices?.length === 0 && (
            <p className="py-10 text-center text-[13px] text-text-mute">You haven’t listed any products yet. Add one to your shop first.</p>
          )}
          <ul className="space-y-2">
            {choices?.map((c) => {
              const on = picked === c.product.id;
              const detail = [...c.product.colors.slice(0, 2), money(c.product.price)].filter(Boolean).join(' · ');
              return (
                <li key={c.product.id}>
                  <div
                    className={`flex items-center gap-3 rounded-2xl border p-2.5 ${
                      on ? 'border-hot-pink bg-hot-pink/5' : 'border-line'
                    }`}
                  >
                    <button
                      onClick={() => !c.twinned && setPicked(c.product.id)}
                      disabled={c.twinned}
                      aria-pressed={on}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-60"
                    >
                      <ProductThumb product={c.product} size={48} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold text-text">{c.product.name}</span>
                        <span className="block truncate text-[12.5px] text-text-mute">{detail}</span>
                      </span>
                    </button>
                    {c.twinned ? (
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <Tag tone="green">
                          <Check size={10} strokeWidth={3} aria-hidden="true" />
                          Twinned
                        </Tag>
                        <button onClick={() => void takeBack(c)} disabled={busy} className="text-[11px] font-semibold text-text-mute underline">
                          Take back
                        </button>
                      </span>
                    ) : (
                      <MatchTag match={c.match} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {error && <p role="alert" className="px-5 pt-3 text-[12.5px] font-semibold text-hot-pink">{error}</p>}
        <div className="px-5 pt-3">
          <button
            onClick={() => void submit()}
            disabled={!picked || busy}
            className="brand-gradient flex w-full items-center justify-center gap-2 rounded-full py-3 text-[14px] font-bold text-white disabled:opacity-40"
          >
            <TwinIcon size={16} />
            {busy ? 'Twinning…' : 'Twin it'}
          </button>
        </div>
      </div>
    </div>
  );
}
