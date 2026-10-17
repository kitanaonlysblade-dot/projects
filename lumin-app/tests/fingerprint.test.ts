// The on-device fingerprint (lib/fingerprint) must agree with the server's matcher (lumin-backend/app/scan_fp.py).
// tests/fixtures/fingerprint.json holds inputs and the numbers the Python code produced for them
// (regenerate with lumin-backend/scripts/make_fingerprint_fixtures.py when scan_fp.py's maths changes).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { audioHashes } from '../lib/fingerprint/audio';
import { cellHashes, phash, resizeArea, trimBorders, mirror } from '../lib/fingerprint/image';
import { b64, int32le } from '../lib/fingerprint/wire';

const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/fingerprint.json', import.meta.url), 'utf8'));
const bytes = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));
const pop = (x: number) => {
  let n = 0;
  while (x) {
    n += x & 1;
    x >>= 1;
  }
  return n;
};
const bitsDiffer = (a: number[], b: number[]) => a.reduce((s, v, i) => s + pop(v ^ b[i]), 0);

test('sound fingerprint reproduces the Python hashes', () => {
  const pcm = new Int16Array(bytes(fx.audio.pcm_b64).buffer);
  const y = Float32Array.from(pcm, (v) => v / 32768);
  const got = audioHashes(y);
  const want = new Set<string>(fx.audio.hash.map((h: number, i: number) => `${h}:${fx.audio.t[i]}`));
  const have = new Set<string>(Array.from(got.hash, (h, i) => `${h}:${got.t[i]}`));
  let common = 0;
  for (const k of want) if (have.has(k)) common++;
  assert.ok(want.size > 100, 'fixture should have plenty of hashes');
  assert.ok(common / want.size >= 0.99, `only ${common} of ${want.size} hashes agree`);
  assert.ok(have.size <= want.size * 1.02, 'no flood of extra hashes');
});

test('silence and very short audio give no hashes', () => {
  assert.equal(audioHashes(new Float32Array(30000)).hash.length, 0);
  assert.equal(audioHashes(new Float32Array(1000).fill(0.5)).hash.length, 0);
});

test('hash values fit in 31 bits (they travel as int32)', () => {
  const pcm = new Int16Array(bytes(fx.audio.pcm_b64).buffer);
  const got = audioHashes(Float32Array.from(pcm, (v) => v / 32768));
  for (const h of got.hash) assert.ok(h >= 0 && h < 2 ** 31);
});

test('picture fingerprints reproduce the Python ones', () => {
  fx.images.forEach((c: { w: number; h: number; data_b64: string; phash: number[]; cells: number[]; ok: number[] }, i: number) => {
    const g = { data: bytes(c.data_b64), w: c.w, h: c.h };
    assert.equal(bitsDiffer(phash(g), c.phash), 0, `whole-picture hash differs in image ${i}`);
    const { cells, ok } = cellHashes(g);
    assert.deepEqual(ok, c.ok, `detail flags differ in image ${i}`);
    // a flat region can flip a bit or two where values tie; matching tolerates that (CELL_HAM)
    const flatOnly = i === 3;
    assert.ok(bitsDiffer(cells, c.cells) <= (flatOnly ? 16 : 0), `cell hashes differ in image ${i}`);
  });
});

test('black bars are trimmed like the server does', () => {
  const w = 40;
  const h = 100;
  const data = new Uint8Array(w * h);
  for (let r = 20; r < 80; r++) for (let c = 0; c < w; c++) data[r * w + c] = (r * 7 + c * 13) % 255;
  const t = trimBorders({ data, w, h });
  assert.equal(t.h, 60);
  assert.equal(t.w, 40);
});

test('area resize averages, and mirroring flips left-right', () => {
  const g = { data: Uint8Array.from([0, 100, 200, 100]), w: 4, h: 1 };
  assert.deepEqual(Array.from(resizeArea(g, 2, 1)), [50, 150]);
  assert.deepEqual(Array.from(mirror({ data: Uint8Array.from([1, 2, 3, 4]), w: 2, h: 2 }).data), [2, 1, 4, 3]);
});

test('wire encoding is little-endian int32 and standard base64', () => {
  const enc = b64(int32le(Int32Array.from([1, 67924363, 0])));
  const raw = Buffer.from(enc, 'base64');
  assert.equal(raw.readInt32LE(0), 1);
  assert.equal(raw.readInt32LE(4), 67924363);
  assert.equal(raw.length, 12);
  assert.equal(b64(new Uint8Array(100000)).length, Math.ceil(100000 / 3) * 4); // large arrays don't overflow the call stack
});
