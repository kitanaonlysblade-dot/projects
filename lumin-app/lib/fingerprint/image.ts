// Picture fingerprints, ports of trim_borders / phash / cell_hashes in lumin-backend/app/scan_fp.py.
// A "gray frame" is a row-major Uint8Array with its width and height.
import { dct2, median } from './dsp';

export const GRID = 4;
export const CELLS = GRID * GRID;
const CELL_STD = 5.0;

export interface Gray {
  data: Uint8Array;
  w: number;
  h: number;
}

/** Cut bars and borders: rows / columns with almost no variation (numpy std > 6). */
export function trimBorders(g: Gray): Gray {
  const { data, w, h } = g;
  const rowStd = (r: number) => {
    let s = 0;
    for (let c = 0; c < w; c++) s += data[r * w + c];
    const m = s / w;
    let v = 0;
    for (let c = 0; c < w; c++) v += (data[r * w + c] - m) ** 2;
    return Math.sqrt(v / w);
  };
  const colStd = (c: number) => {
    let s = 0;
    for (let r = 0; r < h; r++) s += data[r * w + c];
    const m = s / h;
    let v = 0;
    for (let r = 0; r < h; r++) v += (data[r * w + c] - m) ** 2;
    return Math.sqrt(v / h);
  };
  let r0 = -1;
  let r1 = -1;
  let nRows = 0;
  for (let r = 0; r < h; r++) {
    if (rowStd(r) > 6) {
      if (r0 < 0) r0 = r;
      r1 = r;
      nRows++;
    }
  }
  let c0 = -1;
  let c1 = -1;
  let nCols = 0;
  for (let c = 0; c < w; c++) {
    if (colStd(c) > 6) {
      if (c0 < 0) c0 = c;
      c1 = c;
      nCols++;
    }
  }
  if (nRows < h * 0.3 || nCols < w * 0.3) return g;
  const nw = c1 - c0 + 1;
  const nh = r1 - r0 + 1;
  if (nw === w && nh === h) return g;
  const out = new Uint8Array(nw * nh);
  for (let r = 0; r < nh; r++) out.set(data.subarray((r0 + r) * w + c0, (r0 + r) * w + c0 + nw), r * nw);
  return { data: out, w: nw, h: nh };
}

/** cv2.resize(..., INTER_AREA) for shrinking: exact area averaging with fractional edges, rounded to a byte. */
export function resizeArea(g: Gray, dw: number, dh: number): Float32Array {
  const { data, w, h } = g;
  const sx = w / dw;
  const sy = h / dh;
  // horizontal pass: for each source row, dw averaged values
  const tmp = new Float64Array(h * dw);
  for (let dx = 0; dx < dw; dx++) {
    const x0 = dx * sx;
    const x1 = Math.min((dx + 1) * sx, w);
    const i0 = Math.floor(x0);
    const i1 = Math.min(Math.ceil(x1), w);
    for (let r = 0; r < h; r++) {
      let s = 0;
      for (let i = i0; i < i1; i++) {
        const wt = Math.min(i + 1, x1) - Math.max(i, x0);
        s += data[r * w + i] * wt;
      }
      tmp[r * dw + dx] = s / (x1 - x0);
    }
  }
  const out = new Float32Array(dw * dh);
  for (let dy = 0; dy < dh; dy++) {
    const y0 = dy * sy;
    const y1 = Math.min((dy + 1) * sy, h);
    const j0 = Math.floor(y0);
    const j1 = Math.min(Math.ceil(y1), h);
    for (let dx = 0; dx < dw; dx++) {
      let s = 0;
      for (let j = j0; j < j1; j++) {
        const wt = Math.min(j + 1, y1) - Math.max(j, y0);
        s += tmp[j * dw + dx] * wt;
      }
      // OpenCV stores the result as 8-bit: round to the nearest whole number (halves go to the even one)
      const v = s / (y1 - y0);
      const f = Math.floor(v);
      const d = v - f;
      out[dy * dw + dx] = d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;
    }
  }
  return out;
}

/** np.packbits of booleans (first value = highest bit), padded with zeros to whole bytes. */
function packBits(bits: boolean[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | (bits[i + k] ? 1 : 0);
    out.push(b);
  }
  return out;
}

/** 64-bit whole-picture fingerprint (8 bytes). */
export function phash(g: Gray): number[] {
  const t = trimBorders(g);
  const s = resizeArea(t, 32, 32);
  const d = dct2(Float64Array.from(s), 32);
  const low: number[] = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) low.push(d[r * 32 + c]);
  const med = median(low.slice(1));
  return packBits(low.map((v) => v > med));
}

/** 16 cells x 16 bits, and whether each cell has enough detail to be trusted. */
export function cellHashes(g: Gray): { cells: number[]; ok: number[] } {
  const t = trimBorders(g);
  const side = GRID * 16;
  const s = resizeArea(t, side, side);
  const cells: number[] = [];
  const ok: number[] = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const b = new Float64Array(256);
      let sum = 0;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const v = s[(r * 16 + y) * side + c * 16 + x];
          b[y * 16 + x] = v;
          sum += v;
        }
      }
      const mean = sum / 256;
      let ss = 0;
      for (let i = 0; i < 256; i++) ss += (b[i] - mean) ** 2;
      const d = dct2(b, 16);
      const low: number[] = [];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) low.push(d[y * 16 + x]);
      const med = median(low.slice(1));
      cells.push(...packBits(low.map((v) => v > med)));
      ok.push(Math.sqrt(ss / 256) > CELL_STD ? 1 : 0);
    }
  }
  return { cells, ok };
}

/** The picture flipped left to right (some apps mirror video). */
export function mirror(g: Gray): Gray {
  const out = new Uint8Array(g.data.length);
  for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) out[r * g.w + c] = g.data[r * g.w + (g.w - 1 - c)];
  return { data: out, w: g.w, h: g.h };
}
