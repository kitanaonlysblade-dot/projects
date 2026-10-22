'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, CheckCircle2, ShieldCheck, X } from 'lucide-react';
import { ApiError, abandonLiveTest, checkSealBag, sealLiveTest, startLiveTest, type ApiLiveTest } from '@/lib/api';

// The seller's live test of one order, filmed in ONE uncut take and ended by scanning the QR on a tamper-proof bag:
//   1. test the product on camera (the camera is the only source: there is no pause and no file picker);
//   2. put it in the bag and seal it;
//   3. show the bag's QR to the camera. That scan ends the recording and ties the video, the order and the bag together.
// The picture is drawn onto a canvas that is what actually gets recorded, so the order code and the time are burned into
// every frame of the video. The server checks the rest (its own clock, the video's length, the bag's owner and status).

interface Props {
  order: { id: string; productName: string };
  onClose: () => void;
  onSealed: (orderId: string) => void;
}

const CHECKS = ['Screen', 'Sound', 'Buttons', 'Power / battery', 'Camera', 'Fit / size', 'Serial / IMEI', 'Everything works'];
const SERIAL = 'Serial / IMEI';
const QR_PREFIX = 'LSEAL1:';

type Stage = 'intro' | 'starting' | 'live' | 'uploading' | 'done' | 'error';

function pickMime(): { recorder: string; content: string } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const options = [
    { recorder: 'video/webm;codecs=vp9,opus', content: 'video/webm' },
    { recorder: 'video/webm;codecs=vp8,opus', content: 'video/webm' },
    { recorder: 'video/webm', content: 'video/webm' },
    { recorder: 'video/mp4', content: 'video/mp4' },
  ];
  return options.find((o) => MediaRecorder.isTypeSupported(o.recorder)) ?? null;
}

export function LiveTestScreen({ order, onClose, onSealed }: Props) {
  const [stage, setStage] = useState<Stage>('intro');
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [minSeconds, setMinSeconds] = useState(20);
  const [code, setCode] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [serial, setSerial] = useState<string | null>(null);
  const [needSerial, setNeedSerial] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);
  const testRef = useRef<ApiLiveTest | null>(null);
  const mimeRef = useRef<{ recorder: string; content: string } | null>(null);
  const t0Ref = useRef(0);
  const minRef = useRef(20);
  const needSerialRef = useRef(false);
  const lastScanRef = useRef(0);
  const busyRef = useRef(false);
  const badCodes = useRef<Map<string, number>>(new Map());
  const checkedRef = useRef<string[]>([]);
  const finishedRef = useRef<{ blob: Blob; duration: number; code: string } | null>(null);
  checkedRef.current = checked;
  needSerialRef.current = needSerial;

  const stopAll = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    } catch {
      /* already stopped */
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // The camera is released the moment this screen goes away, whatever the reason.
  useEffect(() => () => stopAll(), [stopAll]);

  const abort = useCallback(
    (message: string) => {
      stopAll();
      const t = testRef.current;
      if (t) abandonLiveTest(t.id).catch(() => {});
      testRef.current = null;
      setError(message);
      setStage('error');
    },
    [stopAll],
  );

  // A test cannot carry on in the background: if the page is hidden the take is no longer continuous, so it is dropped.
  useEffect(() => {
    if (stage !== 'live') return;
    const onHide = () => {
      if (document.hidden) abort('The live test was interrupted because the app left the screen. Start it again.');
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [stage, abort]);

  const upload = async (blob: Blob, duration: number, scanned: string) => {
    const test = testRef.current;
    const mime = mimeRef.current;
    if (!test || !mime || !test.upload_url) throw new Error('Live test not open.');
    setStage('uploading');
    const put = await fetch(test.upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': mime.content } });
    if (!put.ok) throw new Error("The video didn't upload. Check your connection and try again.");
    const sealed = await sealLiveTest(test.id, { code: scanned, duration_s: duration, checklist: checkedRef.current });
    setSerial(sealed.serial);
    setStage('done');
    onSealed(order.id);
  };

  const finish = (scanned: string) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const duration = (performance.now() - t0Ref.current) / 1000;
    setCode(scanned);
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeRef.current?.content ?? 'video/webm' });
      finishedRef.current = { blob, duration, code: scanned };
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      upload(blob, duration, scanned).catch((e) => {
        setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.');
        setStage('error');
      });
    };
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    recorder.stop();
  };

  const handleScan = async (raw: string) => {
    if (busyRef.current) return;
    const now = performance.now();
    const seen = badCodes.current.get(raw);
    if (seen && now - seen < 4000) return;
    const elapsed = (now - t0Ref.current) / 1000;
    if (elapsed < minRef.current) {
      setBanner(`Keep testing. You can seal in ${Math.ceil(minRef.current - elapsed)}s.`);
      return;
    }
    if (needSerialRef.current && !checkedRef.current.includes(SERIAL)) {
      setBanner('This order is valuable: show the serial number / IMEI to the camera and tick "Serial / IMEI" first.');
      return;
    }
    busyRef.current = true;
    try {
      const res = await checkSealBag(raw);
      setBanner(null);
      setSerial(res.serial);
      finish(raw);
    } catch (e) {
      badCodes.current.set(raw, performance.now());
      setBanner(e instanceof ApiError ? e.message : "Couldn't check that bag. Check your connection.");
    } finally {
      busyRef.current = false;
    }
  };

  const draw = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const test = testRef.current;
    if (!video || !canvas || !test) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.drawImage(video, 0, 0, w, h);
    // Burned into every frame: the order's code for this attempt and the time.
    const bar = Math.round(h * 0.05);
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(bar * 0.6)}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(`LUMIN LIVE TEST  CODE ${test.order_code}`, 12, bar / 2);
    ctx.font = `${Math.round(bar * 0.5)}px monospace`;
    ctx.fillText(`${test.order_id.slice(0, 8)}  ${new Date().toISOString()}`, 12, h - bar / 2);

    const now = performance.now();
    setSeconds(Math.floor((now - t0Ref.current) / 1000));
    if (now - lastScanRef.current > 250) {
      lastScanRef.current = now;
      let s = scanRef.current;
      if (!s) s = scanRef.current = document.createElement('canvas');
      const sw = 640;
      const sh = Math.round((h / w) * sw);
      s.width = sw;
      s.height = sh;
      const sctx = s.getContext('2d', { willReadFrequently: true });
      if (sctx) {
        sctx.drawImage(video, 0, 0, sw, sh);
        const img = sctx.getImageData(0, 0, sw, sh);
        const hit = jsQR(img.data, sw, sh, { inversionAttempts: 'dontInvert' });
        if (hit?.data && hit.data.toUpperCase().startsWith(QR_PREFIX)) void handleScan(hit.data);
      }
    }
    rafRef.current = requestAnimationFrame(draw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    setError(null);
    setBanner(null);
    setStage('starting');
    const mime = pickMime();
    if (!mime || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't record the live test. Open Lumin in Chrome or Safari on your phone.");
      setStage('error');
      return;
    }
    mimeRef.current = mime;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
    } catch {
      setError('Lumin needs the camera and microphone for the live test. Allow them in your phone settings and try again.');
      setStage('error');
      return;
    }
    streamRef.current = stream;
    try {
      const test = await startLiveTest(order.id, mime.content);
      testRef.current = test;
      minRef.current = test.min_seconds ?? 20;
      setNeedSerial(!!test.require_serial);
      setMinSeconds(minRef.current);
      const video = videoRef.current!;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      const canvas = canvasRef.current!;
      const scale = Math.min(1, 1280 / (video.videoWidth || 1280));
      canvas.width = Math.round((video.videoWidth || 1280) * scale);
      canvas.height = Math.round((video.videoHeight || 720) * scale);
      const out = canvas.captureStream(30);
      stream.getAudioTracks().forEach((t) => out.addTrack(t));
      chunksRef.current = [];
      const recorder = new MediaRecorder(out, { mimeType: mime.recorder, videoBitsPerSecond: 2_500_000 });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = recorder;
      t0Ref.current = performance.now();
      lastScanRef.current = 0;
      badCodes.current = new Map();
      recorder.start(1000);
      setSeconds(0);
      setStage('live');
      rafRef.current = requestAnimationFrame(draw);
    } catch (e) {
      stopAll();
      setError(e instanceof ApiError ? e.message : "Couldn't start the live test. Try again.");
      setStage('error');
    }
  };

  const retryUpload = () => {
    const f = finishedRef.current;
    if (!f) {
      setStage('intro');
      return;
    }
    setError(null);
    upload(f.blob, f.duration, f.code).catch((e) => {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setStage('error');
    });
  };

  const toggle = (c: string) => setChecked((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  const canClose = stage !== 'live' && stage !== 'uploading';

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label="Live test">
      <video ref={videoRef} className="hidden" playsInline muted />
      <div className="flex items-center justify-between px-4 pt-4">
        <p className="text-[13px] font-bold">Live test · {order.productName}</p>
        {canClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
            <X size={18} />
          </button>
        )}
      </div>

      {stage === 'intro' && (
        <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-6 pt-4">
          <ShieldCheck size={34} className="text-white/90" />
          <h2 className="mt-3 text-[20px] font-extrabold leading-tight">Prove it works, then seal it</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-white/80">
            This protects you and the buyer. You film one continuous take that shows the product working, then seal it in a Lumin
            tamper-proof bag. The buyer can only dispute things your video didn&apos;t show.
          </p>
          <ol className="mt-4 space-y-3 text-[14px]">
            {[
              'Tap Go live test. The camera starts recording and you can’t pause it.',
              'Show the product working and tick off what you showed (screen, sound, buttons…).',
              'Put it in the tamper-proof bag and seal it, still in the same video.',
              'Hold the bag’s QR code up to the camera. The scan ends the test and links this video to the bag.',
            ].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15 text-[12px] font-bold">{i + 1}</span>
                <span className="text-white/90">{t}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 rounded-xl bg-white/10 p-3 text-[12.5px] leading-snug text-white/80">
            Each bag works once. A code on the video and the time are added to every frame, and the test must last at least 20
            seconds. Leaving the app during the test cancels it.
          </p>
          <button type="button" onClick={start} className="brand-gradient mt-5 flex items-center justify-center gap-2 rounded-full px-5 py-3.5 text-[15px] font-bold text-white">
            <Camera size={18} /> Go live test
          </button>
        </div>
      )}

      {stage === 'starting' && <p className="flex flex-1 items-center justify-center text-[14px] text-white/80">Starting the camera…</p>}

      <div className={`relative flex-1 ${stage === 'live' ? '' : 'hidden'}`}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-contain" />
        <div className="absolute inset-x-0 top-12 flex justify-center">
          <span className="rounded-full bg-red-600 px-3 py-1 text-[12px] font-bold">● REC {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-6 pt-16">
          {banner && <p className="mb-2 rounded-lg bg-white/15 px-3 py-2 text-[13px] font-semibold">{banner}</p>}
          <p className="mb-2 text-[13px] font-semibold text-white/90">
            {seconds < minSeconds
              ? `Show it working. Sealing unlocks in ${Math.max(0, minSeconds - seconds)}s.`
              : 'Seal the bag, then hold its QR code up to the camera.'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {CHECKS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggle(c)}
                aria-pressed={checked.includes(c)}
                className={`rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${checked.includes(c) ? 'border-white bg-white text-black' : 'border-white/40 text-white'}`}
              >
                {checked.includes(c) ? '✓ ' : ''}
                {c}
                {c === SERIAL && needSerial ? ' *' : ''}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-white/60">
            Tick what you showed on camera. It&apos;s what the buyer can&apos;t dispute.
            {needSerial ? ' * Required for this order: hold the serial number / IMEI up to the camera.' : ''}
          </p>
        </div>
      </div>

      {stage === 'uploading' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-[16px] font-bold">Saving your live test…</p>
          <p className="text-[13px] text-white/70">Bag {serial ?? code ?? ''} scanned. Keep this open until it finishes.</p>
        </div>
      )}

      {stage === 'done' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <CheckCircle2 size={46} className="text-green-400" />
          <p className="text-[18px] font-extrabold">Sealed and recorded</p>
          <p className="max-w-[300px] text-[13.5px] text-white/80">
            Bag {serial} is now tied to this order and your video. It can&apos;t be used again. Hand the sealed bag to the courier.
          </p>
          <button type="button" onClick={onClose} className="brand-gradient mt-2 rounded-full px-6 py-3 text-[14px] font-bold text-white">Done</button>
        </div>
      )}

      {stage === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-[16px] font-bold">That didn&apos;t finish</p>
          <p className="max-w-[320px] text-[13.5px] text-white/80">{error}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={onClose} className="rounded-full border border-white/40 px-5 py-2.5 text-[13.5px] font-bold">Close</button>
            <button type="button" onClick={finishedRef.current && testRef.current ? retryUpload : () => setStage('intro')} className="brand-gradient rounded-full px-5 py-2.5 text-[13.5px] font-bold text-white">
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
