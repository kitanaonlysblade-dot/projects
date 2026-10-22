'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { ApiError, listVerifications, reviewVerification, type ApiVerification } from '@/lib/api';

const DOC_LABEL: Record<string, string> = {
  national_id: 'National ID',
  passport: 'Passport',
  drivers_license: "Driver's licence",
  business_registration: 'Business registration',
};

// Seller identity checks. The photos are private and their links expire after a few minutes (reload to get fresh
// ones); they are deleted the moment you approve or reject. Check that the name matches the document, the photo is
// readable, and the selfie shows the same person holding it.
export default function VerificationsPage() {
  const [items, setItems] = useState<ApiVerification[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    listVerifications('pending')
      .then(setItems)
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    setError(null);
    try {
      await reviewVerification(id, approve, approve ? undefined : note);
      setItems((cur) => (cur ?? []).filter((i) => i.id !== id));
      setRejecting(null);
      setNote('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminShell>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold text-text">Seller verification</h1>
        <button onClick={load} className="rounded-full bg-white px-3 py-1 text-[13px] font-medium text-text-mute">
          Refresh
        </button>
      </div>
      {failed && <p className="text-[13px] text-red-600">Couldn&apos;t load the queue.</p>}
      {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}
      {!items && !failed && <p className="text-[13px] text-text-mute">Loading…</p>}
      {items && items.length === 0 && <p className="text-[13px] text-text-mute">Nothing waiting for review.</p>}
      <div className="space-y-4">
        {items?.map((v) => (
          <div key={v.id} className="rounded-xl border border-line bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[15px] font-bold text-text">{v.business_name}</p>
              <p className="text-[12px] text-text-mute">{new Date(v.created_at).toLocaleString()}</p>
            </div>
            <p className="text-[13px] text-text-mute">{v.owner_email}</p>
            <p className="mt-2 text-[13.5px] text-text">
              Legal name given: <b>{v.legal_name}</b> · {DOC_LABEL[v.doc_type] ?? v.doc_type}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {[
                { label: 'Document', url: v.document_url },
                { label: 'Selfie', url: v.selfie_url },
              ].map((p) => (
                <div key={p.label}>
                  <p className="mb-1 text-[12px] font-medium text-text-mute">{p.label}</p>
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.label} className="max-h-72 w-full rounded-lg border border-line object-contain" />
                    </a>
                  ) : (
                    <p className="text-[12.5px] text-text-mute">Not available</p>
                  )}
                </div>
              ))}
            </div>
            {rejecting === v.id ? (
              <div className="mt-4">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={300}
                  placeholder="Why? The seller will see this, e.g. “Photo is blurry”"
                  className="w-full rounded-lg border border-line px-3 py-2 text-[14px] outline-none focus:border-hot-pink"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => decide(v.id, false)}
                    disabled={busy === v.id || note.trim().length === 0}
                    className="rounded-lg bg-danger px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button onClick={() => setRejecting(null)} className="px-3 py-2 text-[13px] text-text-mute">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => decide(v.id, true)}
                  disabled={busy === v.id}
                  className="rounded-lg bg-ink px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50"
                >
                  Approve
                </button>
                <button onClick={() => setRejecting(v.id)} className="rounded-lg border border-line px-4 py-2 text-[13px] font-bold text-text">
                  Reject…
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </AdminShell>
  );
}
