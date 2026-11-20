// PLA-I66-3: the owner's own logo. An upload is staged once per content under <captures dir>/_marca/<project>/up/,
// checked (type from its first bytes, an SVG cleaned of scripts, events and outside references, a picture under 512 px
// refused, a non-square one centred), and fitted into the icon with the size and background the owner picks; the
// preview runs the pixel tests (src/brand/pixels.ts) on the result. Using it makes a new version that the owner chose,
// which the detector never replaces. Picking another of the repo's candidates, or going back to an earlier version,
// works the same way. Rendering is sharp's (Apache-2.0), on this machine.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projectLogos, projects, type Actor, type LogoAdjust, type Project, type ProjectLogo } from "../db/schema.js";
import { capturesDir } from "../captures/store.js";
import { say } from "../words.js";
import { inspect, svgIsClean } from "./detect.js";
import { addLogoVersion, activeLogo, putLogoFile, readBlob, realGit, type LogoDeps } from "./logos.js";
import { marcaCandidates, forgetMarcaOf } from "./marca.js";
import { palette, pixelTests, SIZE, type PixelTests } from "./pixels.js";
import { repoPathOf } from "../runner/worktree.js";
import { MARCA_WORDS } from "./words.js";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MIN_SIDE = 512;
export const GOOD_SIDE = 1024;
const TILE = 1024;

export type UploadKind = "svg" | "png" | "jpeg" | "webp";
export class LogoError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409 | 413 | 415,
    message: string,
  ) {
    super(message);
  }
}
// The codes the screen and the tests read; the message is the owner's sentence.
const CODES = { empty: "LOGO_EMPTY", big: "LOGO_TOO_BIG", type: "LOGO_TYPE", unsafe: "LOGO_UNSAFE", unreadable: "LOGO_UNREADABLE", tooSmall: "LOGO_TOO_SMALL", upNotFound: "LOGO_UPLOAD_GONE", adjust: "LOGO_ADJUST", notCandidate: "LOGO_NOT_CANDIDATE", versionNotFound: "LOGO_VERSION_NOT_FOUND" } as const;
const fail = (key: keyof typeof CODES, status: LogoError["status"]) => new LogoError(CODES[key], status, say(MARCA_WORDS).errors[key]);

/** The kind of a file from its first bytes (never its name). */
export function sniff(b: Buffer): UploadKind | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  const head = b.subarray(0, 2048).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "svg";
  return null;
}

/** An SVG without anything that runs or reaches outside: scripts, embedded HTML, event handlers, outside links. */
export function cleanSvg(s: string): { svg: string; changed: boolean } {
  const out = s
    .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, "")
    .replace(/<\?xml-stylesheet[\s\S]*?\?>/gi, "")
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#|data:image\/)[^"]*"|'(?!#|data:image\/)[^']*')/gi, "")
    .replace(/@import[^;]*;?/gi, "");
  return { svg: out, changed: out !== s };
}

export type Staged = {
  up: string;
  name: string;
  kind: UploadKind;
  width: number;
  height: number;
  hasAlpha: boolean;
  /** Check codes the screen words: ok true, false, or "warn". */
  checks: { k: string; ok: boolean | "warn"; v?: Record<string, string | number> }[];
  block: string | null;
  palette: string[];
  /** The colour of its top-left corner: the background a non-square picture is centred on. */
  corner: string;
};

function upDir(slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`bad project slug ${slug}`);
  return path.join(capturesDir(), "_marca", slug, "up");
}
const UP = /^[0-9a-f]{64}\.(svg|png|jpeg|webp)$/;

function readUp(slug: string, up: string): Buffer {
  const p = path.join(upDir(slug), up);
  if (!UP.test(up) || !existsSync(p)) throw fail("upNotFound", 404);
  return readFileSync(p);
}

const density = (kind: UploadKind) => (kind === "svg" ? 384 : undefined);

/** Takes the bytes, checks them and keeps them for the preview and the save. Refuses only what can never work. */
export async function stageUpload(slug: string, bytes: Buffer, name: string): Promise<Staged> {
  if (bytes.length === 0) throw fail("empty", 400);
  if (bytes.length > MAX_UPLOAD_BYTES) throw fail("big", 413);
  const kind = sniff(bytes);
  if (!kind) throw fail("type", 415);
  const checks: Staged["checks"] = [];
  let body = bytes;
  if (kind === "svg") {
    const c = cleanSvg(bytes.toString("utf8"));
    if (!svgIsClean(c.svg)) throw fail("unsafe", 400);
    body = Buffer.from(c.svg);
    checks.push({ k: c.changed ? "svg_cleaned" : "svg_clean", ok: c.changed ? "warn" : true });
  }
  let meta: sharp.Metadata;
  try {
    meta = await sharp(body, { density: density(kind) }).metadata();
  } catch {
    throw fail("unreadable", 400);
  }
  const width = meta.width ?? 0, height = meta.height ?? 0;
  if (!width || !height) throw fail("unreadable", 400);
  const side = Math.max(width, height);
  let block: string | null = null;
  checks.unshift({ k: "format", ok: true, v: { kind: kind.toUpperCase(), w: width, h: height } });
  if (kind !== "svg") {
    if (side < MIN_SIDE) {
      checks.push({ k: "too_small", ok: false, v: { px: side } });
      block = say(MARCA_WORDS).errors.tooSmall;
    } else if (side < GOOD_SIDE) checks.push({ k: "small", ok: "warn", v: { px: side } });
    else checks.push({ k: "big_enough", ok: true });
  }
  const square = Math.abs(width - height) / side < 0.02;
  checks.push(square ? { k: "square", ok: true } : { k: "not_square", ok: "warn", v: { w: width, h: height } });
  const small = await sharp(body, { density: density(kind) }).resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let see = 0;
  for (let i = 3; i < small.data.length; i += 4) if (small.data[i]! < 200) see++;
  const hasAlpha = see > 64 * 64 * 0.05 && square;
  checks.push(hasAlpha ? { k: "transparent", ok: "warn" } : { k: "own_background", ok: true });
  const up = `${createHash("sha256").update(body).digest("hex")}.${kind}`;
  const dir = upDir(slug);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, up);
  if (!existsSync(target)) {
    const tmp = path.join(dir, `.${up}.${randomUUID()}.tmp`);
    writeFileSync(tmp, body);
    renameSync(tmp, target);
  }
  const hex2 = (v: number) => v.toString(16).padStart(2, "0");
  const ci = (2 * 64 + 2) * 4;
  const corner = `#${hex2(small.data[ci]!)}${hex2(small.data[ci + 1]!)}${hex2(small.data[ci + 2]!)}`;
  return { up, name: name.slice(0, 120) || up, kind, width, height, hasAlpha, checks, block, palette: palette({ width: 64, height: 64, data: new Uint8Array(small.data) }), corner };
}

const rgba = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
};
export const HEX = /^#[0-9a-f]{6}$/i;

/** The upload fitted into a square tile: scale % of the side, centred, on the background (null keeps it see-through). */
export async function compose(raw: Buffer, kind: UploadKind, scale: number, bg: string | null, side = TILE): Promise<Buffer> {
  const inner = Math.max(1, Math.round((side * Math.min(100, Math.max(40, scale))) / 100));
  const fitted = await sharp(raw, { density: density(kind) }).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return sharp({ create: { width: side, height: side, channels: 4, background: bg ? rgba(bg) : { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: fitted, gravity: "center" }])
    .png()
    .toBuffer();
}

/** The three pixel tests on a tile (its background, when it has one, alone beside it). */
export async function testTile(png: Buffer, bg: string | null): Promise<PixelTests> {
  const t = await sharp(png).resize(SIZE, SIZE).ensureAlpha().raw().toBuffer();
  const b = bg ? await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: rgba(bg) } }).raw().toBuffer() : null;
  return pixelTests({ width: SIZE, height: SIZE, data: new Uint8Array(t) }, b ? { width: SIZE, height: SIZE, data: new Uint8Array(b) } : null);
}

const kindOf = (up: string) => up.split(".").pop() as UploadKind;
const checkAdjust = (scale: number, bg: string | null) => {
  if (!Number.isFinite(scale) || scale < 40 || scale > 100) throw fail("adjust", 400);
  if (bg !== null && !HEX.test(bg)) throw fail("adjust", 400);
};

/** The fitted tile (512 px) and its tests, for the preview. */
export async function previewUpload(slug: string, up: string, scale: number, bg: string | null): Promise<{ png: Buffer; tests: PixelTests }> {
  checkAdjust(scale, bg);
  const raw = readUp(slug, up);
  const png = await compose(raw, kindOf(up), scale, bg, 512);
  return { png, tests: await testTile(png, bg) };
}

/** Makes the fitted upload the project's original, as a version the owner chose. */
export async function useUpload(db: Db, project: Pick<Project, "id" | "slug">, input: { up: string; name: string; scale: number; bg: string | null }, actor: Actor): Promise<ProjectLogo> {
  checkAdjust(input.scale, input.bg);
  const raw = readUp(project.slug, input.up);
  const kind = kindOf(input.up);
  const meta = await sharp(raw, { density: density(kind) }).metadata();
  if (kind !== "svg" && Math.max(meta.width ?? 0, meta.height ?? 0) < MIN_SIDE) throw fail("tooSmall", 400);
  // A vector logo kept as it is stays vector; anything fitted or raster becomes a 1024 px tile.
  const keepSvg = kind === "svg" && input.scale === 100 && input.bg === null && Math.abs((meta.width ?? 1) - (meta.height ?? 1)) / Math.max(meta.width ?? 1, meta.height ?? 1) < 0.02;
  const bytes = keepSvg ? raw : await compose(raw, kind, input.scale, input.bg);
  const mime = keepSvg ? "image/svg+xml" : "image/png";
  const small = await sharp(bytes, { density: keepSvg ? 384 : undefined }).resize(64, 64).ensureAlpha().raw().toBuffer();
  const colors = palette({ width: 64, height: 64, data: new Uint8Array(small) }, 2);
  const file = putLogoFile(project.slug, bytes, mime);
  const adjust: LogoAdjust = { raw: input.up, name: input.name.slice(0, 120), scale: input.scale, bg: input.bg };
  const logo = await addLogoVersion(db, project, {
    file,
    mime,
    bytes: bytes.length,
    width: keepSvg ? meta.width ?? null : TILE,
    height: keepSvg ? meta.height ?? null : TILE,
    variant: input.bg ? "icon" : "mark",
    source: "upload",
    sourcePath: input.name.slice(0, 200),
    colors: input.bg ? [input.bg, ...colors].slice(0, 2) : colors,
    chosen: true,
    adjust,
    actor,
  });
  forgetMarcaOf(project.id);
  return logo;
}

/** Makes one of the repo's other candidates the original, chosen by the owner. */
export async function useCandidate(db: Db, project: Project, file: string, actor: Actor, deps: LogoDeps = {}): Promise<ProjectLogo> {
  const c = marcaCandidates(project.id);
  if (!c || !c.paths.includes(file)) throw fail("notCandidate", 404);
  const bytes = await readBlob(deps.git ?? realGit, repoPathOf(project.slug, project.settings, deps.env), c.commit, file);
  const cand = bytes ? inspect({ path: file, bytes }, project.slug) : null;
  if (!cand) throw fail("notCandidate", 404);
  const logo = await addLogoVersion(db, project, {
    file: putLogoFile(project.slug, cand.bytes, cand.mime),
    mime: cand.mime,
    bytes: cand.bytes.length,
    width: cand.width === null ? null : Math.round(cand.width),
    height: cand.height === null ? null : Math.round(cand.height),
    variant: cand.variant,
    source: "repo",
    sourcePath: file,
    sourceCommit: c.commit,
    colors: cand.colors,
    chosen: true,
    actor,
  });
  forgetMarcaOf(project.id);
  return logo;
}

export type VersionRef = { v: number; source: ProjectLogo["source"]; path: string | null; variant: ProjectLogo["variant"]; active: boolean; chosen: boolean; at: string };

export async function listVersions(db: Db, projectId: string): Promise<VersionRef[]> {
  const rows = await db.select().from(projectLogos).where(eq(projectLogos.projectId, projectId)).orderBy(desc(projectLogos.version));
  return rows.map((l) => ({ v: l.version, source: l.source, path: l.sourcePath, variant: l.variant, active: l.active, chosen: l.chosen, at: l.createdAt.toISOString() }));
}

/** Goes back to a version: it becomes the active one again, as the owner's choice. */
export async function activateVersion(db: Db, project: Pick<Project, "id" | "slug">, v: number): Promise<ProjectLogo> {
  const [row] = await db.select().from(projectLogos).where(and(eq(projectLogos.projectId, project.id), eq(projectLogos.version, v))).limit(1);
  if (!row) throw fail("versionNotFound", 404);
  const out = await db.transaction(async (tx) => {
    await tx.update(projectLogos).set({ active: false }).where(and(eq(projectLogos.projectId, project.id), eq(projectLogos.active, true)));
    const [r] = await tx.update(projectLogos).set({ active: true, chosen: true }).where(eq(projectLogos.id, row.id)).returning();
    return r!;
  });
  forgetMarcaOf(project.id);
  const { bus } = await import("../events.js");
  bus.publish({ type: "project", project: project.slug });
  return out;
}

/** Lets the detector choose again: the active version stops being the owner's choice and the repo is read now. */
export async function releaseChoice(db: Db, project: Pick<Project, "id" | "slug">): Promise<void> {
  const cur = await activeLogo(db, project.id);
  if (cur) await db.update(projectLogos).set({ chosen: false }).where(eq(projectLogos.id, cur.id));
  forgetMarcaOf(project.id);
}

/** A version's bytes (the versions list shows each). */
export async function versionBytes(db: Db, slug: string, v: number): Promise<{ bytes: Buffer; mime: string } | null> {
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return null;
  const [row] = await db.select().from(projectLogos).where(and(eq(projectLogos.projectId, p.id), eq(projectLogos.version, v))).limit(1);
  if (!row) return null;
  const p2 = path.join(capturesDir(), "_marca", slug, row.file);
  return existsSync(p2) ? { bytes: readFileSync(p2), mime: row.mime } : null;
}
