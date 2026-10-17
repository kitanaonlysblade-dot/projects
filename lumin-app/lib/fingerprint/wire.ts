// The compact message the app sends to POST /scan/match-features (parsed by scan_fp.query_from_wire on the server).
export const WIRE_ALGO = 1;

export interface WireFeatures {
  algo: number;
  clip_s: number;
  audio: { hash: string; t: string };
  times: number[];
  hashes: Record<'0' | '1', string>;
  cells: Record<'0' | '1', string>;
  ok: Record<'0' | '1', string>;
}

export function b64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

/** Little-endian int32s, whatever the machine. */
export function int32le(a: Int32Array): Uint8Array {
  const out = new Uint8Array(a.length * 4);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < a.length; i++) dv.setInt32(i * 4, a[i], true);
  return out;
}
