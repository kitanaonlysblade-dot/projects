// Sound fingerprint: "constellation" hashes, a port of audio_hashes() in lumin-backend/app/scan_fp.py.
// Input: mono samples at 22050 Hz in -1..1. Output: parallel arrays (hash, anchor frame), each frame being 512 samples.
import { fft, hann, maximumFilter2d, percentile } from './dsp';

export const SAMPLE_RATE = 22050;
const NPERSEG = 1024;
const STEP = 512;
const BIN_LO = 8;
const BIN_HI = 260;

export interface AudioHashes {
  hash: Int32Array; // (f1 << 18) | (f2 << 7) | dt : always below 2^31, so int32 is enough
  t: Int32Array;
}

export function audioHashes(y: Float32Array): AudioHashes {
  const empty = { hash: new Int32Array(0), t: new Int32Array(0) };
  if (y.length < SAMPLE_RATE >> 1) return empty;
  let peak = 0;
  for (let i = 0; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]));
  if (peak < 1e-3) return empty;

  // scipy.signal.stft(y, SR, nperseg=1024, noverlap=512): 512 zeros each side, then zeros to fill the last segment
  const nadd = ((-y.length % STEP) + STEP) % STEP;
  const total = y.length + 2 * (NPERSEG >> 1) + nadd;
  const x = new Float64Array(total);
  for (let i = 0; i < y.length; i++) x[(NPERSEG >> 1) + i] = y[i];
  const nseg = (total - NPERSEG) / STEP + 1;
  const win = hann(NPERSEG);
  const scale = 1 / win.reduce((a, b) => a + b, 0);

  const bins = BIN_HI - BIN_LO;
  const S = new Float32Array(bins * nseg); // rows = frequency bins, cols = time
  const re = new Float64Array(NPERSEG);
  const im = new Float64Array(NPERSEG);
  for (let s = 0; s < nseg; s++) {
    for (let i = 0; i < NPERSEG; i++) {
      re[i] = x[s * STEP + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bins; b++) {
      const k = BIN_LO + b;
      const mag = Math.fround(Math.hypot(re[k], im[k]) * scale);
      S[b * nseg + s] = Math.fround(Math.log1p(Math.fround(mag * 50)));
    }
  }

  const mx = maximumFilter2d(S, bins, nseg, 17, 11);
  const thr = percentile(S, 92);
  const fi: number[] = [];
  const ti: number[] = [];
  // numpy.nonzero order is row-major (frequency, then time); the sort below is stable on time
  for (let b = 0; b < bins; b++) {
    for (let s = 0; s < nseg; s++) {
      const v = S[b * nseg + s];
      if (v === mx[b * nseg + s] && v > thr) {
        fi.push(b + BIN_LO);
        ti.push(s);
      }
    }
  }
  const order = fi.map((_, i) => i).sort((a, b) => ti[a] - ti[b] || a - b);
  const F = order.map((i) => fi[i]);
  const T = order.map((i) => ti[i]);

  const H: number[] = [];
  const TT: number[] = [];
  const n = T.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < Math.min(n, i + 8); j++) {
      const dt = T[j] - T[i];
      if (dt < 3) continue;
      if (dt > 90) break;
      H.push((F[i] << 18) | (F[j] << 7) | dt);
      TT.push(T[i]);
    }
  }
  return { hash: Int32Array.from(H), t: Int32Array.from(TT) };
}
