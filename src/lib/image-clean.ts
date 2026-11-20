// PLA-I67-4: an image the owner gives an agent is re-encoded without its metadata and reduced to a long edge of
// REFERENCE_MAX_EDGE before it is stored, so a photo carries no place, camera or date, and a run does not pay for
// pixels the model would throw away.
//   reduce   a Reducer re-encodes and scales. The default is macOS's own sips (no package, nothing paid); a Reducer
//            that answers null (no sips on this machine) leaves the size as it is.
//   strip    whatever the reducer gave back is walked chunk by chunk and every metadata block is dropped (PNG text,
//            time and EXIF chunks; JPEG APP1 EXIF/XMP, APP13 IPTC and comments; WebP EXIF and XMP chunks), so the
//            result is clean even when the reducer kept some.
// Tests inject the reducer: nothing here starts a process unless the default runs.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ImageMime } from "../db/schema.js";
import { imageSize } from "../pedidos/images.js";

export const REFERENCE_MAX_EDGE = 2576;

export type Reducer = (input: { bytes: Buffer; mime: ImageMime; maxEdge: number; rotate: 0 | 90 | 180 | 270; resize: boolean }) => Promise<{ bytes: Buffer; mime: ImageMime } | null>;

export type CleanImage = { bytes: Buffer; mime: ImageMime; width: number | null; height: number | null; reduced: boolean; reencoded: boolean };

/** About how many tokens a model spends on an image of this size (width × height / 750). */
export const imageTokens = (width: number | null, height: number | null): number | null => (width && height ? Math.max(1, Math.round((width * height) / 750)) : null);

// ---- Metadata

const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs", "bKGD", "acTL", "fcTL", "fdAT"]);

function stripPng(buf: Buffer): Buffer {
  const out: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("ascii", i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) break;
    if (PNG_KEEP.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  return Buffer.concat(out);
}

// Keeps APP0 (JFIF), APP2 (ICC colour), APP14 (Adobe colour transform); drops APP1 (EXIF, XMP), APP3-13, APP15, COM.
function stripJpeg(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return Buffer.concat([...out, buf.subarray(i)]);
    const marker = buf[i + 1]!;
    if (marker === 0xda) return Buffer.concat([...out, buf.subarray(i)]); // start of scan: the rest is image data
    if (marker === 0xd9) return Buffer.concat([...out, buf.subarray(i, i + 2)]);
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    const end = i + 2 + len;
    if (end > buf.length) return Buffer.concat([...out, buf.subarray(i)]);
    const app = marker >= 0xe0 && marker <= 0xef;
    const keep = app ? marker === 0xe0 || marker === 0xe2 || marker === 0xee : marker !== 0xfe;
    if (keep) out.push(buf.subarray(i, end));
    i = end;
  }
  return Buffer.concat(out);
}

function stripWebp(buf: Buffer): Buffer {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return buf;
  const chunks: Buffer[] = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.toString("ascii", i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    const end = i + 8 + len + (len % 2);
    const chunk = Buffer.from(buf.subarray(i, Math.min(end, buf.length)));
    if (type === "VP8X" && chunk.length >= 9) chunk[8] = chunk[8]! & ~0x0c; // the EXIF and XMP flags
    if (type !== "EXIF" && type !== "XMP ") chunks.push(chunk);
    i = end;
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(4 + body.length, 4);
  head.write("WEBP", 8, "ascii");
  return Buffer.concat([head, body]);
}

export function stripMetadata(buf: Buffer, mime: ImageMime): Buffer {
  try {
    if (mime === "image/png") return stripPng(buf);
    if (mime === "image/jpeg") return stripJpeg(buf);
    return stripWebp(buf);
  } catch {
    return buf;
  }
}

/** The EXIF orientation of a JPEG (1 when it says none), read before the metadata goes so the picture stays upright. */
export function jpegOrientation(buf: Buffer): number {
  try {
    let i = 2;
    while (i + 4 <= buf.length && buf[i] === 0xff) {
      const marker = buf[i + 1]!;
      if (marker === 0xda || marker === 0xd9) return 1;
      const len = buf.readUInt16BE(i + 2);
      if (marker === 0xe1 && buf.toString("ascii", i + 4, i + 10) === "Exif\0\0") {
        const t = i + 10;
        const le = buf.toString("ascii", t, t + 2) === "II";
        const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
        const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
        const ifd = t + u32(t + 4);
        const n = u16(ifd);
        for (let k = 0; k < n; k++) {
          const e = ifd + 2 + k * 12;
          if (u16(e) === 0x0112) return u16(e + 8) || 1;
        }
        return 1;
      }
      i += 2 + len;
    }
  } catch {
    /* no orientation */
  }
  return 1;
}

const ROTATION: Record<number, 0 | 90 | 180 | 270> = { 3: 180, 6: 90, 8: 270 };

// ---- The default reducer: sips, on macOS only

const run = promisify(execFile);

export function sipsReducer(exec: (cmd: string, args: string[]) => Promise<unknown> = (c, a) => run(c, a, { timeout: 20_000 })): Reducer {
  return async ({ bytes, mime, maxEdge, rotate, resize }) => {
    if (process.platform !== "darwin") return null;
    const dir = mkdtempSync(path.join(tmpdir(), "plania-ref-"));
    try {
      // WebP is written back as PNG: sips reads WebP but does not write it everywhere.
      const outMime: ImageMime = mime === "image/jpeg" ? "image/jpeg" : "image/png";
      const src = path.join(dir, `in.${mime.split("/")[1]}`);
      const dst = path.join(dir, outMime === "image/jpeg" ? "out.jpg" : "out.png");
      writeFileSync(src, bytes, { mode: 0o600 });
      const args = ["-s", "format", outMime === "image/jpeg" ? "jpeg" : "png"];
      if (outMime === "image/jpeg") args.push("-s", "formatOptions", "85");
      if (rotate) args.push("-r", String(rotate));
      if (resize) args.push("-Z", String(maxEdge));
      await exec("/usr/bin/sips", [...args, src, "--out", dst]);
      return { bytes: readFileSync(dst), mime: outMime };
    } catch {
      return null;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

/** Re-encodes, reduces and strips one image. A reducer that fails or is absent leaves the bytes, stripped. */
export async function cleanImage(bytes: Buffer, mime: ImageMime, opts: { reduce?: Reducer | null; maxEdge?: number } = {}): Promise<CleanImage> {
  const maxEdge = opts.maxEdge ?? REFERENCE_MAX_EDGE;
  const before = imageSize(bytes, mime);
  // sips -Z also enlarges, so it runs only on a picture known to be larger.
  const resize = !!before && Math.max(before.width, before.height) > maxEdge;
  const rotate = mime === "image/jpeg" ? (ROTATION[jpegOrientation(bytes)] ?? 0) : 0;
  const reduce = opts.reduce === undefined ? sipsReducer() : opts.reduce;
  const out = reduce ? await reduce({ bytes, mime, maxEdge, rotate, resize }).catch(() => null) : null;
  const final = out ?? { bytes, mime };
  const clean = stripMetadata(final.bytes, final.mime);
  const size = imageSize(clean, final.mime);
  return {
    bytes: clean,
    mime: final.mime,
    width: size?.width ?? null,
    height: size?.height ?? null,
    reduced: !!size && Math.max(size.width, size.height) <= maxEdge,
    reencoded: !!out,
  };
}
