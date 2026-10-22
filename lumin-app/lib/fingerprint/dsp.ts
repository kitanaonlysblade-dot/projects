// Small signal-processing helpers, written to match what the server's matcher (lumin-backend/app/scan_fp.py)
// does with numpy / scipy / OpenCV. Keep them in step with it: a fingerprint only matches if both sides compute
// the same thing. tests/fingerprint.test.ts checks this against values produced by the Python code.

/** In-place iterative radix-2 FFT (size must be a power of two). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** scipy's get_window('hann', n) (periodic). */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Index into 0..n-1 with scipy's default 'reflect' boundary (d c b a | a b c d | d c b a). */
function reflect(i: number, n: number): number {
  if (n === 1) return 0;
  const period = 2 * n;
  i = ((i % period) + period) % period;
  return i < n ? i : period - 1 - i;
}

/** scipy.ndimage.maximum_filter(a, size=(sizeRows, sizeCols)) for an odd-sized window, a stored row-major. */
export function maximumFilter2d(a: Float32Array, rows: number, cols: number, sizeRows: number, sizeCols: number): Float32Array {
  const hr = (sizeRows - 1) >> 1;
  const hc = (sizeCols - 1) >> 1;
  const tmp = new Float32Array(a.length);
  // along the columns (time)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let m = -Infinity;
      for (let k = -hc; k <= hc; k++) {
        const v = a[r * cols + reflect(c + k, cols)];
        if (v > m) m = v;
      }
      tmp[r * cols + c] = m;
    }
  }
  const out = new Float32Array(a.length);
  // along the rows (frequency)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let m = -Infinity;
      for (let k = -hr; k <= hr; k++) {
        const v = tmp[reflect(r + k, rows) * cols + c];
        if (v > m) m = v;
      }
      out[r * cols + c] = m;
    }
  }
  return out;
}

/** numpy.percentile(a, q) with the default linear interpolation. */
export function percentile(a: Float32Array, q: number): number {
  const s = Float32Array.from(a).sort();
  const pos = (q / 100) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Orthonormal DCT-II matrix (what cv2.dct computes), n x n, row k = basis function k. */
const dctTables = new Map<number, Float64Array>();
function dctTable(n: number): Float64Array {
  let t = dctTables.get(n);
  if (!t) {
    t = new Float64Array(n * n);
    for (let k = 0; k < n; k++) {
      const a = k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n);
      for (let i = 0; i < n; i++) t[k * n + i] = a * Math.cos((Math.PI * (2 * i + 1) * k) / (2 * n));
    }
    dctTables.set(n, t);
  }
  return t;
}

/** 2-D DCT of an n x n block (row-major). Returns the n x n coefficients (row-major). */
export function dct2(block: Float64Array, n: number): Float64Array {
  const t = dctTable(n);
  const tmp = new Float64Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += t[k * n + i] * block[r * n + i];
      tmp[r * n + k] = s;
    }
  }
  const out = new Float64Array(n * n);
  for (let c = 0; c < n; c++) {
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += t[k * n + i] * tmp[i * n + c];
      out[k * n + c] = s;
    }
  }
  return out;
}

/** numpy.median for a list of numbers. */
export function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
