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
import { forgetMarcaOf } from "./marca.js";
import { palette } from "./pixels.js";
import { checkAdjust, compose, kindOf, readUp, stageUpload, type Staged } from "./upload.js";
import type { Original, Surface } from "./generate.js";

export const SURFACES: Surface[] = ["iphone", "android", "navegador"];
export const isSurface = (s: string): s is Surface => (SURFACES as string[]).includes(s);

export type SurfaceIcon = { file: string; scale: number; bg: string | null; name: string; up: string; colors: string[]; at: string };
export type SurfaceMap = Partial<Record<Surface, SurfaceIcon>>;

const fileOf = (slug: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`bad project slug ${slug}`);
  return path.join(capturesDir(), "_marca", slug, "surfaces.json");
};

export function surfacesOf(slug: string): SurfaceMap {
  const f = fileOf(slug);
  if (!existsSync(f)) return {};
  try {
    const m = JSON.parse(readFileSync(f, "utf8")) as SurfaceMap;
    return Object.fromEntries(Object.entries(m).filter(([k, v]) => isSurface(k) && v && /^[0-9a-f]{64}\.png$/.test(v.file))) as SurfaceMap;
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

/** The surfaces' icons as the generator takes them (a tile with its own background: an icon). */
export function surfaceOriginals(slug: string): Partial<Record<Surface, Original>> {
  const out: Partial<Record<Surface, Original>> = {};
  for (const [s, v] of Object.entries(surfacesOf(slug)) as [Surface, SurfaceIcon][]) {
    const bytes = readLogoFile(slug, v.file);
    if (bytes) out[s] = { bytes, mime: "image/png", variant: "icon", colors: v.colors, bg: v.bg };
  }
  return out;
}

/** «Solo este»: the current original (or the surface's own picture, when it has one) staged like an upload. */
export async function startSurface(db: Db, project: Pick<Project, "id" | "slug">, surface: Surface): Promise<Staged | null> {
  const own = surfacesOf(project.slug)[surface];
  if (own) {
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
export async function setSurface(project: Pick<Project, "id" | "slug">, surface: Surface, input: { up: string; name: string; scale: number; bg: string | null }): Promise<SurfaceIcon> {
  checkAdjust(input.scale, input.bg);
  const raw = readUp(project.slug, input.up);
  const tile = await compose(raw, kindOf(input.up), input.scale, input.bg);
  const small = await sharp(tile).resize(64, 64).ensureAlpha().raw().toBuffer();
  const colors = palette({ width: 64, height: 64, data: new Uint8Array(small) }, 2);
  const icon: SurfaceIcon = { file: putLogoFile(project.slug, tile, "image/png"), scale: input.scale, bg: input.bg, name: input.name.slice(0, 120), up: input.up, colors: input.bg ? [input.bg, ...colors].slice(0, 2) : colors, at: new Date().toISOString() };
  save(project.slug, { ...surfacesOf(project.slug), [surface]: icon });
  forgetMarcaOf(project.id);
  bus.publish({ type: "project", project: project.slug });
  return icon;
}

/** «Volver al original»: the surface's files come from the original again. */
export function clearSurface(project: Pick<Project, "id" | "slug">, surface: Surface): void {
  const m = surfacesOf(project.slug);
  delete m[surface];
  save(project.slug, m);
  forgetMarcaOf(project.id);
  bus.publish({ type: "project", project: project.slug });
}
