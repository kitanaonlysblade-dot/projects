'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatusBadge } from '@/components/StatusBadge';
import {
  listReturnClaims,
  resolveReturnClaim,
  type ApiReturnClaim,
  type ReturnClaimStatus,
} from '@/lib/api';

const TABS: { key: ReturnClaimStatus | 'all'; label: string }[] = [
  { key: 'pending_review', label: 'Pending review' },
  { key: 'refunded', label: 'Refunded' },
  { key: 'denied', label: 'Denied' },
  { key: 'all', label: 'All' },
];

export default function DisputesPage() {
  const [tab, setTab] = useState<ReturnClaimStatus | 'all'>('pending_review');
  const [claims, setClaims] = useState<ApiReturnClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<{ claim: ApiReturnClaim; approve: boolean } | null>(null);

  const load = () => {
    setLoading(true);
    listReturnClaims(tab === 'all' ? undefined : tab)
      .then(setClaims)
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab]);

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
        Buyer-filed defect claims. Approving refunds the buyer immediately; denying leaves the order's
        held funds to release to the merchant normally.
      </p>

      <div className="mb-5 flex gap-2">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-full border px-3.5 py-1.5 text-[12px] font-bold ${
              tab === key ? 'border-hot-pink bg-hot-pink text-white' : 'border-line bg-white text-text-mute'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <p className="text-[13px] text-text-mute">Loading…</p>}
      {!loading && claims.length === 0 && <p className="text-[13px] text-text-mute">Nothing here.</p>}

      <div className="space-y-3">
        {claims.map((claim) => (
          <div key={claim.id} className="rounded-xl border border-line bg-white p-4">
            <div className="mb-2 flex items-start justify-between gap-4">
              <p className="text-[11px] text-text-mute">
                Order id: {claim.order_id} · Filed {new Date(claim.created_at).toLocaleString()}
              </p>
              <StatusBadge status={claim.status} />
            </div>
            {claim.reason && <p className="mb-2 text-[13px] text-text">{claim.reason}</p>}
            <a
              href={claim.video_url}
              target="_blank"
              rel="noreferrer"
              className="mb-3 inline-block text-[12px] font-medium text-hot-pink underline"
            >
              View buyer's proof video
            </a>
            {claim.seller_response && (
              <p className="mb-3 rounded-lg bg-panel p-2.5 text-[12px] text-text">
                <span className="font-bold">Seller's response: </span>
                {claim.seller_response}
              </p>
            )}
            {claim.resolution_note && (
              <p className="mb-3 text-[12px] text-text-mute">Resolution note: {claim.resolution_note}</p>
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
                  className="rounded-lg bg-hot-pink px-3 py-1.5 text-[12px] font-bold text-white"
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
              ? 'This refunds the buyer immediately through Paystack — this cannot be undone from here.'
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
