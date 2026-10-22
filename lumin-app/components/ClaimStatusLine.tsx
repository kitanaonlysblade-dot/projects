'use client';

import { useState } from 'react';
import { ApiError, appealClaim, type ApiClaimMine } from '@/lib/api';

// One line about a claim for the person looking at it (buyer or seller) and, when they lost, a one-time Appeal.
export function ClaimStatusLine({ claim, onChanged }: { claim: ApiClaimMine; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outcome: Record<string, string> = {
    upheld: 'The first decision stands.',
    overturned: 'Your appeal was upheld.',
    overturned_manual: 'Your appeal was upheld. Lumin will contact you about compensation.',
  };
  let text: string;
  if (claim.status === 'pending_review') text = claim.role === 'buyer' ? 'Your claim is being reviewed.' : 'The buyer reported a problem. Lumin is reviewing it.';
  else if (claim.status === 'refunded') text = claim.role === 'buyer' ? 'Refunded.' : `The buyer was refunded${claim.auto_resolved ? ' automatically (the live test did not show that part)' : ' after a review'}.`;
  else text = claim.role === 'buyer' ? 'Your claim was reviewed and denied.' : 'The claim was reviewed and denied. You keep the payment.';
  if (claim.appeal_by) text += claim.appeal_outcome ? ` ${outcome[claim.appeal_outcome] ?? ''}` : ' Your appeal is with Lumin.';

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await appealClaim(claim.order_id, note.trim() || undefined);
      setOpen(false);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the appeal.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg bg-panel px-2.5 py-2 text-[12.5px] leading-snug text-text">
      <p>{text}</p>
      {claim.resolution_note && claim.status !== 'pending_review' && <p className="mt-0.5 text-text-mute">{claim.resolution_note}</p>}
      {claim.can_appeal && !open && (
        <button type="button" onClick={() => setOpen(true)} className="mt-1.5 font-bold text-pink-ink">
          Appeal this decision
        </button>
      )}
      {open && (
        <div className="mt-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why should it be looked at again? (optional)" className="w-full rounded-lg border border-line px-2.5 py-1.5 text-[13px] text-text focus:border-hot-pink focus:outline-none" />
          <div className="mt-1.5 flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-line px-3 py-1 text-[12px] font-bold text-text-mute">Cancel</button>
            <button type="button" disabled={busy} onClick={send} className="rounded-full btn-neutral px-3 py-1 text-[12px] font-bold disabled:opacity-50">{busy ? 'Sending…' : 'Send appeal'}</button>
          </div>
          <p className="mt-1 text-[11px] text-text-mute">You can appeal once. A person at Lumin decides.</p>
          {error && <p className="mt-1 text-[12px] text-pink-ink">{error}</p>}
        </div>
      )}
    </div>
  );
}
