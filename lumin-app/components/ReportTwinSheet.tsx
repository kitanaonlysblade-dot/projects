'use client';

import { useState } from 'react';
import { Flag, X } from 'lucide-react';
import { ApiError, reportWantedTwin, type ApiTwinOption, type ApiTwinReportReason } from '@/lib/api';

const REASONS: { value: ApiTwinReportReason; title: string; sub: string }[] = [
  { value: 'counterfeit', title: 'Counterfeit or fake', sub: 'Passes itself off as a brand' },
  { value: 'likeness', title: 'Uses a likeness without permission', sub: 'A person is shown selling it' },
  { value: 'mismatch', title: 'Doesn’t match the moment', sub: 'Wrong item for what’s shown' },
  { value: 'ownership', title: 'I’m the brand or creator', sub: 'Tell us who you are; our team will ask for proof' },
];

// "Report this twin": goes into the same admin Reports queue as every other report. A
// single report never hides anything; when several different shoppers report the same
// twin it is hidden from compare lists until the team has looked at it.
export function ReportTwinSheet({
  requestId,
  option,
  onClose,
}: {
  requestId: string;
  option: ApiTwinOption;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ApiTwinReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reportWantedTwin(requestId, option.product.id, reason, detail.trim() || undefined);
      setSent(true);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? 'Log in to report a twin.'
          : e instanceof ApiError
            ? e.message
            : 'Couldn’t send this report — try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 lg:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Report this twin"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[430px] flex-col overflow-y-auto rounded-t-3xl bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2.5 lg:rounded-3xl"
      >
        <span className="mx-auto mb-2 h-1 w-10 rounded-full bg-box lg:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between pb-1">
          <h2 className="flex items-center gap-2 text-[17px] font-extrabold text-text">
            <Flag size={17} aria-hidden="true" />
            {sent ? 'Report sent' : 'Report this twin'}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-text-mute">
            <X size={20} />
          </button>
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-[14px] leading-relaxed text-text-mute">
              Thanks for letting us know. Our team will take a look.
            </p>
            <button onClick={onClose} className="brand-gradient w-full rounded-full py-3 text-[14px] font-bold text-white">
              Done
            </button>
          </div>
        ) : (
          <>
            <p className="pb-3 text-[13px] text-text-mute">
              {option.product.name}
              {option.seller_name ? ` · ${option.seller_name}` : ''}
            </p>
            <ul className="space-y-2">
              {REASONS.map((r) => (
                <li key={r.value}>
                  <button
                    onClick={() => setReason(r.value)}
                    aria-pressed={reason === r.value}
                    className={`w-full rounded-2xl border p-3 text-left ${
                      reason === r.value ? 'border-hot-pink bg-hot-pink/5' : 'border-line'
                    }`}
                  >
                    <span className="block text-[14px] font-bold text-text">{r.title}</span>
                    <span className="block text-[12.5px] text-text-mute">{r.sub}</span>
                  </button>
                </li>
              ))}
            </ul>
            {reason && (
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="Anything we should know? (optional)"
                aria-label="Details (optional)"
                className="mt-3 w-full resize-none rounded-xl border border-line p-3 text-[13.5px] text-text outline-none focus:border-hot-pink"
              />
            )}
            {error && <p role="alert" className="pt-2 text-[12.5px] font-semibold text-hot-pink">{error}</p>}
            <button
              onClick={() => void send()}
              disabled={!reason || busy}
              className="brand-gradient mt-4 w-full rounded-full py-3 text-[14px] font-bold text-white disabled:opacity-40"
            >
              {busy ? 'Sending…' : 'Send report'}
            </button>
            <p className="pt-2.5 text-center text-[12px] leading-relaxed text-text-mute">
              Reviewed by our team. When several people report a twin it’s hidden until it’s checked.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
