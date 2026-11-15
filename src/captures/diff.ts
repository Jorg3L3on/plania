// PLA-I52-3: what changed between two stills. A small PNG reader (8-bit RGB/RGBA, not interlaced: what Chrome
// writes) and the box around the pixels that differ, in fractions of the image, so the card can draw it at any size.
import { inflateSync } from "node:zlib";

export type Raster = { width: number; height: number; channels: 3 | 4; data: Buffer };
export type DiffBox = { x: number; y: number; w: number; h: number; ratio: number } | null;

export function decodePng(png: Buffer): Raster | null {
  if (png.length < 33 || png.readUInt32BE(0) !== 0x89504e47) return null;
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels: 3 | 4 = 4;
  const idat: Buffer[] = [];
  while (pos + 8 <= png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString("ascii", pos + 4, pos + 8);
    const body = png.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const color = body[9];
      const interlace = body[12];
      if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) return null;
      channels = color === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!width || !height || !idat.length) return null;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) return null;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const o = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[o + i - channels]! : 0;
      const b = y > 0 ? out[o - stride + i]! : 0;
      const c = y > 0 && i >= channels ? out[o - stride + i - channels]! : 0;
      let v = line[i]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[o + i] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

// The box around every pixel whose color moved more than `tolerance` (0-255, any channel), over the area both
// images share. A taller or wider image counts its extra part as changed. null when nothing changed.
export function diffBox(a: Raster, b: Raster, tolerance = 24, step = 2): DiffBox {
  const W = Math.max(a.width, b.width);
  const H = Math.max(a.height, b.height);
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  let n = 0;
  let seen = 0;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      seen++;
      let diff = false;
      if (x >= a.width || y >= a.height || x >= b.width || y >= b.height) diff = true;
      else {
        const ia = (y * a.width + x) * a.channels;
        const ib = (y * b.width + x) * b.channels;
        for (let ch = 0; ch < 3; ch++) if (Math.abs(a.data[ia + ch]! - b.data[ib + ch]!) > tolerance) diff = true;
      }
      if (!diff) continue;
      n++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return { x: r(x0 / W), y: r(y0 / H), w: r((x1 - x0 + step) / W), h: r((y1 - y0 + step) / H), ratio: r(n / seen) };
}

export function pngDiff(before: Buffer, after: Buffer): DiffBox | "unreadable" {
  const a = decodePng(before);
  const b = decodePng(after);
  if (!a || !b) return "unreadable";
  return diffBox(a, b);
}
