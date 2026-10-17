import type { ApiScanMatch } from './api';
import { scanRecording } from './scanClip';

// "Scan live": the person shares the tab or window where a video is playing, and every few seconds the
// last few seconds of it are checked against the library, so the answer arrives while the video is still
// playing. Needs screen capture in the browser, which phone browsers don't offer (the Android app will).

export function liveScanSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function'
    && typeof MediaRecorder !== 'undefined';
}

const FIRST_WINDOW_MS = 3000;
const WINDOW_MS = 5000;
const EVERY_MS = 4000;
const MAX_TOTAL_MS = 45000;
const MAX_IN_FLIGHT = 2;

function pickMime(): string | undefined {
  for (const m of ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

// A part of the shared screen, as shares of its width and height (0..1).
export interface ScanArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LiveScanOptions {
  // Called once with a picture of the shared screen; resolves to the part to scan, or null for the whole screen.
  chooseArea?: (picture: string) => Promise<ScanArea | null>;
}

export interface LiveScanHandlers {
  onFound: (match: ApiScanMatch) => void;
  onTick: (elapsedS: number) => void;
  // Ran out of time without a match, or the sharing was stopped from the browser's own bar.
  onEnd: (reason: 'timeout' | 'stopped') => void;
  onError: (message: string) => void;
}

export async function startLiveScan(h: LiveScanHandlers, opts: LiveScanOptions = {}): Promise<{ stop: () => void }> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: true });
  } catch (e) {
    const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError');
    h.onError(denied ? 'Screen sharing was cancelled.' : "Your browser couldn't start screen sharing.");
    return { stop() {} };
  }

  // Which stream is recorded: the whole share, or just the area the person picked (drawn onto a canvas that is
  // recorded instead, with the share's sound).
  let recStream: MediaStream = stream;
  let stopCrop: (() => void) | null = null;
  if (opts.chooseArea) {
    try {
      const src = document.createElement('video');
      src.srcObject = stream;
      src.muted = true;
      src.playsInline = true;
      await src.play();
      await new Promise((r) => setTimeout(r, 400)); // let the first real frame arrive
      const vw = src.videoWidth;
      const vh = src.videoHeight;
      if (vw > 0 && vh > 0) {
        const shot = document.createElement('canvas');
        const k = Math.min(1, 960 / vw);
        shot.width = Math.round(vw * k);
        shot.height = Math.round(vh * k);
        shot.getContext('2d')?.drawImage(src, 0, 0, shot.width, shot.height);
        const area = await opts.chooseArea(shot.toDataURL('image/jpeg', 0.7));
        if (area && area.w > 0.05 && area.h > 0.05) {
          const sx = Math.round(area.x * vw);
          const sy = Math.round(area.y * vh);
          const sw = Math.max(16, Math.round(area.w * vw)) & ~1;
          const sh = Math.max(16, Math.round(area.h * vh)) & ~1;
          const cut = document.createElement('canvas');
          cut.width = sw;
          cut.height = sh;
          const ctx = cut.getContext('2d');
          if (ctx) {
            const draw = () => ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
            draw();
            const timer = setInterval(draw, 66);
            stopCrop = () => clearInterval(timer);
            recStream = new MediaStream([...cut.captureStream(15).getVideoTracks(), ...stream.getAudioTracks()]);
          }
        }
      }
    } catch {
      // picking an area is a convenience: on any problem the whole screen is scanned as before
    }
  }

  const mime = pickMime();
  const started = Date.now();
  let done = false;
  let inFlight = 0;
  const timers: ReturnType<typeof setTimeout | typeof setInterval>[] = [];

  const finish = (reason?: 'timeout' | 'stopped') => {
    if (done) return;
    done = true;
    timers.forEach((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    stopCrop?.();
    stream.getTracks().forEach((t) => t.stop());
    if (reason) h.onEnd(reason);
  };

  const grab = (ms: number) => {
    if (done) return;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
    } catch {
      h.onError("Your browser couldn't record the shared screen.");
      finish();
      return;
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (ev) => ev.data.size > 0 && chunks.push(ev.data);
    rec.onstop = async () => {
      if (done || chunks.length === 0 || inFlight >= MAX_IN_FLIGHT) return;
      inFlight++;
      try {
        const type = rec.mimeType || 'video/webm';
        const file = new File(chunks, 'live.webm', { type });
        const res = await scanRecording(file, true);
        if (!done && res.found && res.video_post_id) {
          finish();
          h.onFound(res);
        }
      } catch {
        // a failed check is just skipped; the next window tries again
      } finally {
        inFlight--;
      }
    };
    rec.start();
    timers.push(setTimeout(() => rec.state !== 'inactive' && rec.stop(), ms));
  };

  grab(FIRST_WINDOW_MS);
  timers.push(setInterval(() => grab(WINDOW_MS), EVERY_MS));
  timers.push(
    setInterval(() => {
      const elapsed = Date.now() - started;
      h.onTick(Math.round(elapsed / 1000));
      if (elapsed >= MAX_TOTAL_MS) finish('timeout');
    }, 1000),
  );
  stream.getVideoTracks()[0]?.addEventListener('ended', () => finish('stopped'));

  return { stop: () => finish('stopped') };
}
