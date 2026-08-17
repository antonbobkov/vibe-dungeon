/**
 * 32-bit FNV-1a state hash — spec/05-data-formats.md §4.
 *
 * `h = 2166136261; h = (h ^ byte) * 16777619 >>> 0` is normative, but the multiplication
 * must be `Math.imul`: a 32-bit `h` times 16777619 reaches ~7.2e16, past the 2^53 where
 * float64 stops being exact, and the low bits — the ones the hash keeps — are what would
 * be lost.
 */

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

export function newHash(): number {
  return FNV_OFFSET;
}

export function writeByte(h: number, byte: number): number {
  return Math.imul(h ^ (byte & 0xff), FNV_PRIME) >>> 0;
}

/** One value of the canonical stream: little-endian int32. */
export function writeInt32(h: number, value: number): number {
  const v = value | 0;
  let out = writeByte(h, v & 0xff);
  out = writeByte(out, (v >>> 8) & 0xff);
  out = writeByte(out, (v >>> 16) & 0xff);
  out = writeByte(out, (v >>> 24) & 0xff);
  return out;
}

/** FNV of a string's UTF-16 code units, low byte first — used for persistent-flag ids (05 §4). */
export function hashString(s: string): number {
  let h = newHash();
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    h = writeByte(h, code & 0xff);
    h = writeByte(h, (code >>> 8) & 0xff);
  }
  return h;
}
