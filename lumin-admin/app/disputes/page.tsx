'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatusBadge } from '@/components/StatusBadge';
import {
  listReturnClaims,
  resolveReturnClaim,
  ruleOnAppeal,
  ApiError,
  type ApiReturnClaim,
  type ReturnClaimStatus,
} from '@/lib/api';

type Tab = ReturnClaimStatus | 'all' | 'appeals';
const TABS: { key: Tab; label: string }[] = [
  { key: 'pending_review', label: 'Pending review' },
  { key: 'appeals', label: 'Appeals' },
  { key: 'refunded', label: 'Refunded' },
  { key: 'denied', label: 'Denied' },
  { key: 'all', label: 'All' },
];

export default function DisputesPage() {
  const [tab, setTab] = useState<Tab>('pending_review');
  const [msg, setMsg] = useState<string | null>(null);
  const [claims, setClaims] = useState<ApiReturnClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<{ claim: ApiReturnClaim; approve: boolean } | null>(null);

  const load = () => {
    setLoading(true);
    listReturnClaims(tab === 'all' || tab === 'appeals' ? undefined : tab)
      .then((rows) => setClaims(tab === 'appeals' ? rows.filter((c) => c.appeal_by && !c.appeal_outcome) : rows))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab]);

  const act = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'That failed.');
    }
  };

  const handleResolve = (note: string) => {
    if (!resolving) return;
    resolveReturnClaim(resolving.claim.id, { approve: resolving.approve, resolution_note: note || undefined }).then(
      () => {
        setResolving(null);
        load();
      },
    );
  };

  return (
    <AdminShell>
      <p className="mb-1 text-[20px] font-bold text-text">Disputes</p>
      <p className="mb-5 text-[13px] text-text-mute">
        Buyer-filed defect claims. Approving refunds the buyer immediately; denying leaves the order&apos;s
        held funds to release to the merchant normally.
      </p>

      <div className="mb-5 flex gap-2">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-full border px-3.5 py-1.5 text-[12px] font-bold ${
              tab === key ? 'border-hot-pink bg-ink text-white' : 'border-line bg-white text-text-mute'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {msg && <p className="mb-4 rounded-lg bg-panel p-2.5 text-[12.5px] text-text">{msg}</p>}
      {loading && <p className="text-[13px] text-text-mute">Loading…</p>}
      {!loading && claims.length === 0 && <p className="text-[13px] text-text-mute">Nothing here.</p>}

      <div className="space-y-3">
        {claims.map((claim) => (
          <div key={claim.id} className="rounded-xl border border-line bg-white p-4">
            <div className="mb-2 flex items-start justify-between gap-4">
              <p className="text-[11px] text-text-mute">
                Order id: {claim.order_id} · Filed {new Date(claim.created_at).toLocaleString()}
              </p>
              <span className="flex items-center gap-2">
                {claim.auto_resolved && <span className="rounded-full bg-panel px-2 py-0.5 text-[10.5px] font-bold text-text-mute">Decided by the system</span>}
                <StatusBadge status={claim.status} />
              </span>
            </div>
            {claim.reasons && claim.reasons.length > 0 && (
              <p className="mb-1 text-[12.5px] text-text">
                <span className="font-bold">Buyer says:</span> {claim.reasons.map((r) => r.replace(/_/g, ' ')).join(', ')}
              </p>
            )}
            {claim.reason && <p className="mb-2 text-[13px] text-text">{claim.reason}</p>}
            {claim.coverage && (
              <div
                className={`mb-3 rounded-lg border p-2.5 text-[12px] ${
                  claim.coverage.suggestion === 'deny'
                    ? 'border-amber-300 bg-amber-50'
                    : claim.coverage.suggestion === 'refund'
                      ? 'border-green-300 bg-green-50'
                      : 'border-line bg-panel'
                }`}
              >
                <p className="font-bold text-text">
                  Live test says:{' '}
                  {claim.coverage.suggestion === 'deny' ? 'covered, no refund' : claim.coverage.suggestion === 'refund' ? 'buyer likely wins' : 'a person must compare the videos'}
                </p>
                <p className="mt-0.5 text-text">{claim.coverage.summary}</p>
                {claim.coverage.seller_video_url && (
                  <div className="mt-2">
                    <p className="mb-1 text-[11.5px] font-bold text-text">Seller&apos;s live test ({claim.coverage.seller_video_s?.toFixed(0)}s)</p>
                    <video src={claim.coverage.seller_video_url} controls preload="metadata" className="max-h-[260px] rounded-lg bg-black" />
                  </div>
                )}
                <p className="mt-1 text-text-mute">
                  Seller showed: {claim.coverage.seller_showed.length ? claim.coverage.seller_showed.join(', ') : 'nothing'}
                  {claim.coverage.serial ? ` · Bag ${claim.coverage.serial}` : ''}
                  {claim.coverage.seal_intact_at_delivery === true ? ' · Buyer said the seal was intact at the door' : ''}
                </p>
                {claim.coverage.risk_flags && claim.coverage.risk_flags.length > 0 && (
                  <ul className="mt-1.5 list-disc pl-4 text-[11.5px] font-medium text-pink-ink">
                    {claim.coverage.risk_flags.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                )}
                <p className="mt-1 text-[11px] text-text-mute">This is a suggestion. Watch both videos (Sealed bags page has the seller&apos;s) and decide.</p>
              </div>
            )}
            <a
              href={claim.video_url}
              target="_blank"
              rel="noreferrer"
              className="mb-3 inline-block text-[12px] font-medium text-pink-ink underline"
            >
              View buyer&apos;s proof video
            </a>
            {claim.seller_response && (
              <p className="mb-3 rounded-lg bg-panel p-2.5 text-[12px] text-text">
                <span className="font-bold">Seller&apos;s response: </span>
                {claim.seller_response}
              </p>
            )}
            {claim.resolution_note && (
              <p className="mb-3 text-[12px] text-text-mute">Resolution note: {claim.resolution_note}</p>
            )}
            {claim.appeal_by && (
              <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[12px] text-text">
                <p className="font-bold">
                  {claim.appeal_by === 'buyer' ? 'The buyer appealed the denial' : 'The seller appealed the refund'}
                  {claim.appeal_outcome ? ` (${claim.appeal_outcome.replace('_', ' ')})` : ''}
                </p>
                {claim.appeal_note && <p className="mt-0.5">{claim.appeal_note}</p>}
                {!claim.appeal_outcome && (
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => act(() => ruleOnAppeal(claim.id, { overturn: false }))} className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium">Keep the first decision</button>
                    <button onClick={() => act(() => ruleOnAppeal(claim.id, { overturn: true }))} className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-bold text-white">
                      {claim.appeal_by === 'buyer' ? 'Overturn: refund the buyer' : 'Appeal wins: compensate the seller by hand'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {claim.status === 'pending_review' && claim.coverage?.suggestion === 'deny' && (
              <button
                onClick={() => act(() => resolveReturnClaim(claim.id, { approve: false, resolution_note: `Covered by the seller's live test. ${claim.coverage?.summary ?? ''}` }))}
                className="mb-2 rounded-lg bg-text px-3 py-1.5 text-[12px] font-bold text-white"
              >
                I watched it: confirm covered, deny
              </button>
            )}
            {claim.status === 'pending_review' && (
              <div className="flex gap-2">
                <button
                  onClick={() => setResolving({ claim, approve: false })}
                  className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/5"
                >
                  Deny
                </button>
                <button
                  onClick={() => setResolving({ claim, approve: true })}
                  className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-bold text-white"
                >
                  Approve &amp; refund
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {resolving && (
        <ConfirmDialog
          title={resolving.approve ? 'Approve and refund this claim?' : 'Deny this claim?'}
          body={
            resolving.approve
              ? 'This refunds the buyer immediately through the payment gateway — this cannot be undone from here.'
              : 'No refund happens. The order continues toward a normal payout to the merchant.'
          }
          noteLabel="Resolution note (shown to both buyer and seller)"
          confirmLabel={resolving.approve ? 'Approve & refund' : 'Deny claim'}
          danger={!resolving.approve}
          onConfirm={handleResolve}
          onClose={() => setResolving(null)}
        />
      )}
    </AdminShell>
  );
}
