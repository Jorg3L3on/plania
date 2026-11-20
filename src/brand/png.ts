// PLA-I66-1: just enough PNG reading to judge a logo: its size and, for the common 8-bit non-interlaced kinds, its
// pixels as RGBA. No dependency: zlib is in Node. Anything else (16-bit, interlaced) gives the size and no pixels.
import { inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export type Png = { width: number; height: number; rgba: Uint8Array | null };

export const isPng = (b: Buffer): boolean => b.length > 24 && b.subarray(0, 8).equals(SIGNATURE);

export function readPng(b: Buffer): Png | null {
  if (!isPng(b)) return null;
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  const depth = b[24]!;
  const type = b[25]!;
  const interlace = b[28]!;
  if (!width || !height) return null;
  const channels = CHANNELS[type];
  if (depth !== 8 || interlace !== 0 || !channels || width * height > 4096 * 4096) return { width, height, rgba: null };
  const idat: Buffer[] = [];
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  for (let o = 8; o + 8 <= b.length; ) {
    const len = b.readUInt32BE(o);
    const kind = b.toString("latin1", o + 4, o + 8);
    const data = b.subarray(o + 8, o + 8 + len);
    if (kind === "IDAT") idat.push(data);
    else if (kind === "PLTE") palette = data;
    else if (kind === "tRNS") trns = data;
    else if (kind === "IEND") break;
    o += 12 + len;
  }
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return { width, height, rgba: null };
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return { width, height, rgba: null };
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const row = y * stride;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[row + x - channels]! : 0;
      const up = y ? px[row - stride + x]! : 0;
      const c = y && x >= channels ? px[row - stride + x - channels]! : 0;
      const v = raw[src + x]!;
      let p: number;
      if (filter === 0) p = v;
      else if (filter === 1) p = v + a;
      else if (filter === 2) p = v + up;
      else if (filter === 3) p = v + ((a + up) >> 1);
      else if (filter === 4) {
        const e = a + up - c;
        const pa = Math.abs(e - a), pb = Math.abs(e - up), pc = Math.abs(e - c);
        p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
      } else return { width, height, rgba: null };
      px[row + x] = p & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    let r: number, g: number, bl: number, al = 255;
    if (type === 0) r = g = bl = px[s]!;
    else if (type === 4) { r = g = bl = px[s]!; al = px[s + 1]!; }
    else if (type === 2) { r = px[s]!; g = px[s + 1]!; bl = px[s + 2]!; }
    else if (type === 6) { r = px[s]!; g = px[s + 1]!; bl = px[s + 2]!; al = px[s + 3]!; }
    else {
      const k = px[s]!;
      if (!palette || k * 3 + 2 >= palette.length) return { width, height, rgba: null };
      r = palette[k * 3]!; g = palette[k * 3 + 1]!; bl = palette[k * 3 + 2]!;
      if (trns && k < trns.length) al = trns[k]!;
    }
    rgba.set([r, g, bl, al], i * 4);
  }
  return { width, height, rgba };
}
