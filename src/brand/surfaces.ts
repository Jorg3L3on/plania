// PLA-122: one surface's own icon. The owner likes the logo but wants, say, Android on another background or a simpler
// iPhone icon: that surface (src/brand/generate.ts SURFACE_KEYS) gets its own tile, made like an upload (size and
// background on the picture), and its files come from it; the share image, the manifest and Compañía keep the
// original. Kept next to the logo in <captures dir>/_marca/<project>/surfaces.json, the tile content-addressed like the
// original's versions: no migration and no setting an agent can write.
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Db } from "../db/client.js";
import type { Project } from "../db/schema.js";
import { capturesDir } from "../captures/store.js";
import { bus } from "../events.js";
import { activeLogo, putLogoFile, readLogoFile } from "./logos.js";
import { palette } from "./pixels.js";
import { checkAdjust, compose, kindOf, readUp, stageUpload, type Staged } from "./upload.js";
import type { Original, Surface } from "./generate.js";

export const SURFACES: Surface[] = ["iphone", "android", "navegador"];
export const isSurface = (s: string): s is Surface => (SURFACES as string[]).includes(s);

export type SurfaceIcon = { file: string; scale: number; bg: string | null; name: string; up: string; colors: string[]; at: string };
// PLA-I69-2: a surface follows the logo (no entry), is a variant (a recipe re-applied to whatever the logo is), or has
// its own picture (propia: fixed, made while a given logo version led; a newer logo asks the owner what to do).
export type OwnEntry = SurfaceIcon & { mode?: "propia"; logoV?: number | null };
export type VariantEntry = { mode: "variante"; bg: string | null; scale: number; at: string };
export type SurfaceEntry = OwnEntry | VariantEntry;
export type SurfaceMap = Partial<Record<Surface, SurfaceEntry>>;
export const isVariant = (e: SurfaceEntry | undefined): e is VariantEntry => e?.mode === "variante";
export const isOwn = (e: SurfaceEntry | undefined): e is OwnEntry => !!e && e.mode !== "variante";
/** A picture of its own made under an older logo: the surface asks (follow, keep, another). */
export function knotOf(e: SurfaceEntry | undefined, logo: { version: number; createdAt: Date } | null): boolean {
  if (!isOwn(e) || !logo) return false;
  return e.logoV != null ? e.logoV !== logo.version : e.at < logo.createdAt.toISOString();
}

const fileOf = (slug: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`bad project slug ${slug}`);
  return path.join(capturesDir(), "_marca", slug, "surfaces.json");
};

export function surfacesOf(slug: string): SurfaceMap {
  const f = fileOf(slug);
  if (!existsSync(f)) return {};
  try {
    const m = JSON.parse(readFileSync(f, "utf8")) as SurfaceMap;
    return Object.fromEntries(
      Object.entries(m).filter(([k, v]) => isSurface(k) && v && (isVariant(v) ? typeof v.scale === "number" : /^[0-9a-f]{64}\.png$/.test((v as OwnEntry).file))),
    ) as SurfaceMap;
  } catch {
    return {};
  }
}

function save(slug: string, m: SurfaceMap): void {
  const f = fileOf(slug);
  mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(m, null, 2));
  renameSync(tmp, f);
}

/** The surfaces' icons as the generator takes them (a tile with its own background: an icon). A variant is made now,
 * from the current logo (its raw upload when there is one, so the recipe frames the drawing, not an old tile). */
export async function surfaceOriginals(slug: string, main?: { bytes: Buffer; mime: string; raw?: string | null } | null): Promise<Partial<Record<Surface, Original>>> {
  const out: Partial<Record<Surface, Original>> = {};
  for (const [s, v] of Object.entries(surfacesOf(slug)) as [Surface, SurfaceEntry][]) {
    if (isVariant(v)) {
      if (!main) continue;
      let src = main.bytes, kind: "svg" | "png" | "jpeg" | "webp" = main.mime === "image/svg+xml" ? "svg" : "png";
      if (main.raw) {
        try { src = readUp(slug, main.raw); kind = kindOf(main.raw); } catch { /* the raw upload is gone: the logo itself */ }
      }
      const tile = await compose(src, kind, v.scale, v.bg);
      out[s] = { bytes: tile, mime: "image/png", variant: "icon", colors: v.bg ? [v.bg] : [], bg: v.bg };
      continue;
    }
    const bytes = readLogoFile(slug, v.file);
    if (bytes) out[s] = { bytes, mime: "image/png", variant: "icon", colors: v.colors, bg: v.bg };
  }
  return out;
}

/** «Solo este»: the current original (or the surface's own picture, when it has one) staged like an upload. */
export async function startSurface(db: Db, project: Pick<Project, "id" | "slug">, surface: Surface): Promise<Staged | null> {
  const own = surfacesOf(project.slug)[surface];
  if (isOwn(own)) {
    try {
      return await stageUpload(project.slug, readUp(project.slug, own.up), own.name);
    } catch {
      // its picture is gone from the staging folder: start again from the original
    }
  }
  const l = await activeLogo(db, project.id);
  const bytes = l ? readLogoFile(project.slug, l.file) : null;
  if (!l || !bytes) return null;
  return stageUpload(project.slug, bytes, `original.${l.mime === "image/svg+xml" ? "svg" : "png"}`);
}

/** The surface keeps this picture, fitted at that size on that background, as its own icon. */
export async function setSurface(project: Pick<Project, "id" | "slug">, surface: Surface, input: { up: string; name: string; scale: number; bg: string | null }, logoV: number | null = null): Promise<SurfaceIcon> {
  checkAdjust(input.scale, input.bg);
  const raw = readUp(project.slug, input.up);
  const tile = await compose(raw, kindOf(input.up), input.scale, input.bg);
  const small = await sharp(tile).resize(64, 64).ensureAlpha().raw().toBuffer();
  const colors = palette({ width: 64, height: 64, data: new Uint8Array(small) }, 2);
  const icon: OwnEntry = { mode: "propia", logoV, file: putLogoFile(project.slug, tile, "image/png"), scale: input.scale, bg: input.bg, name: input.name.slice(0, 120), up: input.up, colors: input.bg ? [input.bg, ...colors].slice(0, 2) : colors, at: new Date().toISOString() };
  save(project.slug, { ...surfacesOf(project.slug), [surface]: icon });
  // PLA-I69-2: no forget: the read re-judges because surfaces.json changed (the repo part stays).
  bus.publish({ type: "project", project: project.slug });
  return icon;
}

/** «Volver al original»: the surface's files come from the original again. */
export function clearSurface(project: Pick<Project, "id" | "slug">, surface: Surface): void {
  const m = surfacesOf(project.slug);
  delete m[surface];
  save(project.slug, m);
  // PLA-I69-2: no forget: the read re-judges because surfaces.json changed (the repo part stays).
  bus.publish({ type: "project", project: project.slug });
}

/** PLA-I69-2: the surface becomes a variant: this background and size, applied to whatever the logo is. */
export function setVariant(project: Pick<Project, "id" | "slug">, surface: Surface, input: { bg: string | null; scale: number }): VariantEntry {
  checkAdjust(input.scale, input.bg);
  const v: VariantEntry = { mode: "variante", bg: input.bg ? input.bg.toLowerCase() : null, scale: input.scale, at: new Date().toISOString() };
  save(project.slug, { ...surfacesOf(project.slug), [surface]: v });
  // PLA-I69-2: no forget: the read re-judges because surfaces.json changed (the repo part stays).
  bus.publish({ type: "project", project: project.slug });
  return v;
}

/** PLA-I69-2: «Mantener la mía»: the surface keeps its own picture under the current logo; the question goes away. */
export function keepSurface(project: Pick<Project, "id" | "slug">, surface: Surface, logoV: number): boolean {
  const m = surfacesOf(project.slug);
  const e = m[surface];
  if (!isOwn(e)) return false;
  save(project.slug, { ...m, [surface]: { ...e, mode: "propia", logoV } });
  // PLA-I69-2: no forget: the read re-judges because surfaces.json changed (the repo part stays).
  bus.publish({ type: "project", project: project.slug });
  return true;
}
