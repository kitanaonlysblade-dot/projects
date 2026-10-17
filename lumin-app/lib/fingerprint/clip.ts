// Turns a short recording (a Blob/File from the camera, screen capture or file picker) into the compact fingerprint
// the server matches against, entirely in the browser / app web view. The recording is never uploaded.
import { audioHashes, SAMPLE_RATE, type AudioHashes } from './audio';
import { cellHashes, mirror, phash, type Gray } from './image';
import { b64, int32le, WIRE_ALGO, type WireFeatures } from './wire';

const FRAMES_PER_SECOND = 4; // same as the server (read_frames(path, 4))
const FRAME_HEIGHT = 480;
export const MAX_SECONDS = 20;
export const MIN_SECONDS = 2;

export class FingerprintError extends Error {
  // fatal: the recording itself is the problem (too short): say so. Not fatal: this device couldn't do the
  // fingerprinting, so the caller may fall back to sending the recording as before.
  constructor(message: string, readonly fatal = false) {
    super(message);
  }
}

/** Whether this browser has what the fingerprinting needs. */
export function fingerprintSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof (window as unknown as { OfflineAudioContext?: unknown }).OfflineAudioContext !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function once(el: HTMLMediaElement, ok: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new FingerprintError("The video didn't load in time.")), timeoutMs);
    const onOk = () => done();
    const onErr = () => done(new FingerprintError("This video couldn't be read."));
    const done = (e?: Error) => {
      clearTimeout(timer);
      el.removeEventListener(ok, onOk);
      el.removeEventListener('error', onErr);
      e ? reject(e) : resolve();
    };
    el.addEventListener(ok, onOk, { once: true });
    el.addEventListener('error', onErr, { once: true });
  });
}

async function loadVideo(url: string): Promise<{ video: HTMLVideoElement; duration: number }> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  await once(video, 'loadedmetadata', 15000);
  let duration = video.duration;
  if (!Number.isFinite(duration)) {
    // A browser's own MediaRecorder writes WebM with no length: asking for a time far past the end makes the
    // browser work out the real length.
    video.currentTime = 1e7;
    await once(video, 'durationchange', 15000).catch(() => undefined);
    await once(video, 'seeked', 5000).catch(() => undefined);
    duration = video.duration;
  }
  if (!Number.isFinite(duration) || duration <= 0) throw new FingerprintError("This video couldn't be read.");
  return { video, duration };
}

async function decodeAudio(blob: Blob, seconds: number): Promise<Float32Array> {
  const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const Off = (window as unknown as { OfflineAudioContext: typeof OfflineAudioContext }).OfflineAudioContext;
  try {
    const bytes = await blob.arrayBuffer();
    // A throw-away context only to decode; decoded audio comes out at that context's rate.
    const probe = new Off(1, 1, SAMPLE_RATE);
    const decoded = await probe.decodeAudioData(bytes.slice(0));
    const length = Math.min(Math.ceil(decoded.duration * SAMPLE_RATE), Math.ceil(seconds * SAMPLE_RATE));
    const off = new Off(1, Math.max(1, length), SAMPLE_RATE); // mono, 22050 Hz: the browser does the mix-down and resampling
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    void Ctx;
    return rendered.getChannelData(0);
  } catch {
    return new Float32Array(0); // no sound track (or one this browser can't decode): the picture still matches
  }
}

function grayFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, w: number, h: number): Gray {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = Math.round(0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]);
  return { data, w, h };
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new FingerprintError("The video didn't respond.")), 10000);
    video.addEventListener(
      'seeked',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    video.currentTime = t;
  });
}

export interface FingerprintOptions {
  onProgress?: (fraction: number) => void;
}

/** Fingerprint a recording. Throws FingerprintError (with a plain-language message) when it can't. */
export async function fingerprintClip(blob: Blob, opts: FingerprintOptions = {}): Promise<WireFeatures> {
  if (!fingerprintSupported()) throw new FingerprintError("This browser can't check recordings on the device.");
  const url = URL.createObjectURL(blob);
  try {
    const { video, duration } = await loadVideo(url);
    if (duration < MIN_SECONDS) throw new FingerprintError(`That video is too short. It needs at least ${MIN_SECONDS} seconds.`, true);
    const seconds = Math.min(duration, MAX_SECONDS);

    const audioPromise = decodeAudio(blob, seconds);
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) throw new FingerprintError("This video couldn't be read.");
    const w = Math.max(2, Math.round((vw * FRAME_HEIGHT) / vh / 2) * 2);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = FRAME_HEIGHT;

    const count = Math.max(1, Math.min(MAX_SECONDS * FRAMES_PER_SECOND, Math.floor(seconds * FRAMES_PER_SECOND)));
    const times: number[] = [];
    const hashes: Record<'0' | '1', number[]> = { '0': [], '1': [] };
    const cells: Record<'0' | '1', number[]> = { '0': [], '1': [] };
    const ok: Record<'0' | '1', number[]> = { '0': [], '1': [] };
    for (let i = 0; i < count; i++) {
      const t = i / FRAMES_PER_SECOND;
      await seek(video, Math.min(t, duration - 0.01));
      const g = grayFrame(video, canvas, w, FRAME_HEIGHT);
      times.push(t);
      for (const [key, frame] of [['0', g], ['1', mirror(g)]] as const) {
        hashes[key].push(...phash(frame));
        const c = cellHashes(frame);
        cells[key].push(...c.cells);
        ok[key].push(...c.ok);
      }
      opts.onProgress?.((i + 1) / (count + 1));
      await tick(); // keep the page responsive
    }

    const audio: AudioHashes = audioHashes(await audioPromise);
    opts.onProgress?.(1);
    const enc = (m: Record<'0' | '1', number[]>) => ({ '0': b64(Uint8Array.from(m['0'])), '1': b64(Uint8Array.from(m['1'])) });
    return {
      algo: WIRE_ALGO,
      clip_s: Math.round(seconds * 10) / 10,
      audio: { hash: b64(int32le(audio.hash)), t: b64(int32le(audio.t)) },
      times,
      hashes: enc(hashes),
      cells: enc(cells),
      ok: enc(ok),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
