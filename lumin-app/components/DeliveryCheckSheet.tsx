'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { ApiError, getMyShipments, scanDelivery, uploadFile } from '@/lib/api';

// The buyer at the door with the sealed bag in hand:
//   1. is the bag still sealed and untouched? (if not, refuse it and say what you see: nothing is paid out);
//   2. scan the QR on the bag (or type the code under it);
//   3. the app shows a 6-digit code: read it to the driver. The driver's code entry completes the delivery.
// A delivered bag's QR can never be used again (the server keeps its status).

interface Props {
  order: { id: string; productName: string };
  onClose: () => void;
  onDelivered: () => void;
}

type Step = 'ask' | 'scan' | 'code' | 'refused' | 'delivered';

export function DeliveryCheckSheet({ order, onClose, onDelivered }: Props) {
  const [step, setStep] = useState<Step>('ask');
  const [intact, setIntact] = useState(true);
  const [note, setNote] = useState('');
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState<string | null>(null);
  const [expires, setExpires] = useState<number | null>(null);
  const [camError, setCamError] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const photoRef = useRef<File | null>(null);
  photoRef.current = photo;

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const intactRef = useRef(true);
  const noteRef = useRef('');
  intactRef.current = intact;
  noteRef.current = note;

  const stopCamera = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  useEffect(() => () => stopCamera(), []);

  const submit = async (code: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      let photo_url: string | undefined;
      if (!intactRef.current && photoRef.current) {
        try {
          photo_url = (await uploadFile(photoRef.current)).url;
        } catch {
          /* the photo is optional: refuse the delivery anyway */
        }
      }
      const res = await scanDelivery(order.id, { code, seal_intact: intactRef.current, note: noteRef.current.trim() || undefined, photo_url });
      stopCamera();
      if (res.refused) {
        setStep('refused');
      } else {
        setOtp(res.otp);
        setExpires(res.expires_at ? new Date(res.expires_at).getTime() : null);
        setStep('code');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't check the bag. Check your connection.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const startScan = async () => {
    setStep('scan');
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      const canvas = document.createElement('canvas');
      let last = 0;
      const tick = () => {
        rafRef.current = requestAnimationFrame(tick);
        const now = performance.now();
        if (now - last < 250 || busyRef.current || !video.videoWidth) return;
        last = now;
        const w = 640;
        const h = Math.round((video.videoHeight / video.videoWidth) * w);
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, w, h);
        const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        if (hit?.data && hit.data.toUpperCase().startsWith('LSEAL1:')) void submit(hit.data);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setCamError(true);
    }
  };

  // While the code is showing, watch for the driver's confirmation.
  useEffect(() => {
    if (step !== 'code') return;
    const id = setInterval(() => {
      getMyShipments()
        .then((m) => {
          if (m[order.id] === 'delivered') {
            setStep('delivered');
            onDelivered();
          }
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(id);
  }, [step, order.id, onDelivered]);

  const minsLeft = expires ? Math.max(0, Math.ceil((expires - Date.now()) / 60000)) : null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Check your delivery">
      <button type="button" aria-label="Close" onClick={() => { stopCamera(); onClose(); }} className="absolute inset-0 cursor-default bg-black/55" />
      <div className="relative max-h-[90vh] w-full max-w-[520px] overflow-y-auto rounded-t-3xl bg-surface px-5 pb-6 pt-3" style={{ animation: 'sheetUp 260ms cubic-bezier(0.22,1,0.36,1)' }}>
        <div className="mb-2 flex items-center justify-between">
          <span className="mx-auto h-1.5 w-11 rounded-full bg-line" />
          <button type="button" onClick={() => { stopCamera(); onClose(); }} aria-label="Close" className="absolute right-4 top-3 text-text-mute"><X size={18} /></button>
        </div>
        <p className="text-[12.5px] text-text-mute">{order.productName}</p>

        {step === 'ask' && (
          <>
            <h2 className="mt-1 text-[18px] font-extrabold text-text">Check the bag before you accept it</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-text-mute">
              Look at the tamper-proof seal. If it has been opened, torn or looks different, don&apos;t accept the delivery.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button type="button" onClick={() => { setIntact(true); void startScan(); }} className="brand-gradient flex items-center justify-center gap-2 rounded-full py-3 text-[14px] font-bold text-white">
                <ShieldCheck size={18} /> The bag is sealed and untouched
              </button>
              <button type="button" onClick={() => { setIntact(false); setStep('scan'); void startScan(); }} className="flex items-center justify-center gap-2 rounded-full border border-line py-3 text-[14px] font-bold text-text">
                <ShieldAlert size={18} /> It looks opened or damaged
              </button>
            </div>
          </>
        )}

        {step === 'scan' && (
          <>
            <h2 className="mt-1 text-[18px] font-extrabold text-text">Scan the QR code on the bag</h2>
            {!intact && (
              <label className="mt-2 block">
                <span className="mb-1 block text-[12.5px] font-bold text-text">What do you see? (optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. seal torn, bag cut open" className="w-full rounded-lg border border-line px-2.5 py-1.5 text-[13px] text-text focus:border-hot-pink focus:outline-none" />
              </label>
            )}
            {!intact && (
              <label className="mt-2 block text-[12.5px] font-bold text-text">
                Photo of the opened bag (optional)
                <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-[12px] font-normal text-text-mute" />
              </label>
            )}
            <div className="mt-3 overflow-hidden rounded-2xl bg-black">
              <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full object-cover" />
            </div>
            {camError && <p className="mt-2 text-[12.5px] text-text-mute">The camera isn&apos;t available. Type the code printed under the QR instead.</p>}
            <div className="mt-3 flex gap-2">
              <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Or type the code under the QR" className="min-w-0 flex-1 rounded-lg border border-line px-2.5 py-2 text-[13px] text-text focus:border-hot-pink focus:outline-none" />
              <button type="button" disabled={busy || manual.trim().length < 10} onClick={() => void submit(manual)} className="rounded-lg btn-neutral px-3.5 text-[13px] font-bold disabled:opacity-40">Use</button>
            </div>
            {busy && <p className="mt-2 text-[12.5px] text-text-mute">Checking…</p>}
            {error && <p className="mt-2 text-[12.5px] font-semibold text-pink-ink">{error}</p>}
          </>
        )}

        {step === 'code' && (
          <>
            <h2 className="mt-1 text-[18px] font-extrabold text-text">Give this code to the driver</h2>
            <p className="mt-1.5 text-[13.5px] text-text-mute">The driver types it in to finish the delivery. Don&apos;t share it with anyone else.</p>
            <p className="my-5 text-center font-mono text-[44px] font-extrabold tracking-[0.3em] text-text">{otp}</p>
            <p className="text-center text-[12px] text-text-mute">
              {minsLeft !== null ? `Valid for about ${minsLeft} more minutes. ` : ''}This screen updates by itself when the driver confirms.
            </p>
          </>
        )}

        {step === 'delivered' && (
          <div className="py-6 text-center">
            <ShieldCheck size={42} className="mx-auto text-green-600" />
            <h2 className="mt-2 text-[18px] font-extrabold text-text">Delivered</h2>
            <p className="mx-auto mt-1.5 max-w-[320px] text-[13.5px] text-text-mute">This bag can&apos;t be used again. You have 48 hours to report a problem, or you can confirm now that it&apos;s what you ordered.</p>
            <button type="button" onClick={onClose} className="brand-gradient mt-4 rounded-full px-6 py-2.5 text-[13.5px] font-bold text-white">Done</button>
          </div>
        )}

        {step === 'refused' && (
          <div className="py-6 text-center">
            <ShieldAlert size={42} className="mx-auto text-pink-ink" />
            <h2 className="mt-2 text-[18px] font-extrabold text-text">Delivery refused</h2>
            <p className="mx-auto mt-1.5 max-w-[320px] text-[13.5px] text-text-mute">Tell the driver you&apos;re not accepting it. Nobody is paid and Lumin will review what happened.</p>
            <button type="button" onClick={onClose} className="mt-4 rounded-full border border-line px-6 py-2.5 text-[13.5px] font-bold text-text">Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
