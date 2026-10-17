'use client';

import { useEffect, useState } from 'react';
import { BadgeCheck, Clock, ShieldAlert } from 'lucide-react';
import { ApiError, getMyVerification, submitVerification, type ApiVerificationStatus } from '@/lib/api';

const DOC_TYPES = [
  { value: 'national_id', label: 'National ID card' },
  { value: 'passport', label: 'Passport' },
  { value: 'drivers_license', label: "Driver's licence" },
  { value: 'business_registration', label: 'Business registration certificate' },
];
const MAX_MB = 8;

// Seller verification (backend app/routers/verification.py): legal name, a photo of an ID and a selfie, reviewed by
// an admin. The photos are kept privately and deleted once the review is decided. Shows nothing when the server has
// no private storage set up.
export function SellerVerificationCard() {
  const [info, setInfo] = useState<ApiVerificationStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [legalName, setLegalName] = useState('');
  const [docType, setDocType] = useState(DOC_TYPES[0].value);
  const [doc, setDoc] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getMyVerification()
      .then((v) => live && setInfo(v))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!info || !info.available) return null;

  const tooBig = (f: File | null) => !!f && f.size > MAX_MB * 1024 * 1024;
  const ready = legalName.trim().length >= 2 && !!doc && !!selfie && !tooBig(doc) && !tooBig(selfie) && !busy;

  const submit = async () => {
    if (!ready || !doc || !selfie) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('legal_name', legalName.trim());
      form.append('doc_type', docType);
      form.append('document', doc);
      form.append('selfie', selfie);
      setInfo(await submitVerification(form));
      setOpen(false);
      setDoc(null);
      setSelfie(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send your documents — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const box = 'mx-4 mt-5 max-w-sm rounded-xl border border-line bg-white p-4 lg:mx-8';
  const input = 'mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-[14px] font-normal text-text focus:border-hot-pink focus:outline-none';

  if (info.verified) {
    return (
      <div className={box}>
        <div className="flex items-center gap-1.5 text-green-600">
          <BadgeCheck size={18} />
          <span className="text-[13.5px] font-bold">Verified seller</span>
        </div>
        <p className="mt-1.5 text-[12.5px] text-text-mute">Your store is verified. The badge shows on your videos.</p>
      </div>
    );
  }

  if (info.status === 'pending') {
    return (
      <div className={box}>
        <div className="flex items-center gap-1.5 text-text">
          <Clock size={18} />
          <span className="text-[13.5px] font-bold">Verification under review</span>
        </div>
        <p className="mt-1.5 text-[12.5px] text-text-mute">We&apos;re checking your documents. You&apos;ll get a notification when it&apos;s done.</p>
      </div>
    );
  }

  return (
    <div className={box}>
      <div className="flex items-center gap-1.5 text-text">
        <ShieldAlert size={18} />
        <span className="text-[13.5px] font-bold">Verify your store</span>
      </div>
      {info.status === 'rejected' && info.note && (
        <p className="mt-2 rounded-lg bg-panel px-3 py-2 text-[12.5px] text-text">Not approved yet: {info.note}</p>
      )}
      <p className="mt-1.5 text-[12.5px] text-text-mute">
        Get a Verified seller badge so shoppers trust you
        {info.required_for_payout ? ', and to receive payouts' : ''}. Your photos are stored privately, only an admin sees them, and
        they are deleted as soon as we&apos;ve decided.
      </p>
      {!open ? (
        <button onClick={() => setOpen(true)} className="brand-gradient mt-3 w-full rounded-full py-2.5 text-[13.5px] font-bold text-white">
          {info.status === 'rejected' ? 'Send new documents' : 'Start verification'}
        </button>
      ) : (
        <div className="mt-3">
          <label className="block text-[13px] font-bold text-text">
            Full legal name (as on the document)
            <input value={legalName} onChange={(e) => setLegalName(e.target.value)} maxLength={150} className={input} />
          </label>
          <label className="mt-3 block text-[13px] font-bold text-text">
            Document
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className={input}>
              {DOC_TYPES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-[13px] font-bold text-text">
            Photo of the document
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setDoc(e.target.files?.[0] ?? null)} className="mt-1.5 block w-full text-[12.5px] font-normal" />
          </label>
          <label className="mt-3 block text-[13px] font-bold text-text">
            A selfie of you holding it
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={(e) => setSelfie(e.target.files?.[0] ?? null)} className="mt-1.5 block w-full text-[12.5px] font-normal" />
          </label>
          {(tooBig(doc) || tooBig(selfie)) && <p className="mt-2 text-[12.5px] font-semibold text-hot-pink">Each photo must be under {MAX_MB} MB.</p>}
          {error && <p className="mt-2 text-[13px] font-semibold text-hot-pink">{error}</p>}
          <button onClick={submit} disabled={!ready} className="brand-gradient mt-4 w-full rounded-full py-2.5 text-[13.5px] font-bold text-white disabled:opacity-40">
            {busy ? 'Sending…' : 'Send for review'}
          </button>
          <button onClick={() => setOpen(false)} className="mt-2 w-full py-1.5 text-[12.5px] font-semibold text-text-mute">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
