// PLA-I61-2 (La idea abierta): Artist's frames on an idea. Artist draws a canvas on the machine (by default
// ~/plania/canvases/<KEY>/), exports one image per frame and calls attach_frames with each file's path and
// what the frame does and why. Plania copies the bytes into its own store (the request pictures' folder, named by
// sha256) so the screen can show them; it never reads a path outside the canvases folder. A new call replaces the set.
import { realpathSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { ideaFrames, projects, tasks, type IdeaFrame, type ImageMime } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { findProject, requireTask } from "../mcp/queries.js";
import { writeTx, type Ctx } from "../mcp/tx.js";
import { MAX_IMAGE_BYTES, imageSize, putImageFile, readImageFile, sniffImage } from "./images.js";
import { defaultFolders } from "../folders.js";

export const MAX_FRAMES = 40;
export const FRAMES_ATTACHED = "frames.attached";

export const canvasesRoot = (): string => process.env.PLANIA_CANVASES_ROOT || defaultFolders(os.homedir()).canvases;

export type FrameInput = { id: string; name: string; group?: string; hace?: string; porque?: string; path: string };
export type FrameView = { id: string; frame: string; name: string; group: string | null; hace: string | null; porque: string | null; url: string; width: number | null; height: number | null };

const bad = (frame: string, hint: string) => new ToolError("FRAME_INVALID", { frame, hint });
const FRAME_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/;

// The file's real path, only when it sits inside the canvases folder (after symlinks).
function inside(file: string, frame: string): string {
  let root: string;
  try {
    root = realpathSync(canvasesRoot());
  } catch {
    throw bad(frame, `no existe la carpeta de lienzos ${canvasesRoot()}`);
  }
  const expanded = file.startsWith("~/") ? path.join(os.homedir(), file.slice(2)) : file;
  let real: string;
  try {
    real = realpathSync(path.resolve(root, expanded));
  } catch {
    throw bad(frame, `no encontré ${file}`);
  }
  if (real !== root && !real.startsWith(root + path.sep)) throw bad(frame, `${file} está fuera de ${canvasesRoot()}`);
  if (!statSync(real).isFile()) throw bad(frame, `${file} no es un archivo`);
  return real;
}

export function frameUrl(slug: string, key: string, id: string): string {
  return `/api/company/projects/${encodeURIComponent(slug)}/ideas/${encodeURIComponent(key)}/frames/${id}`;
}
const view = (slug: string, key: string, r: IdeaFrame): FrameView => ({
  id: r.id,
  frame: r.frameId,
  name: r.name,
  group: r.grupo,
  hace: r.hace,
  porque: r.porque,
  url: frameUrl(slug, key, r.id),
  width: r.width,
  height: r.height,
});

export async function attachFrames(db: Db, input: { project: string; key: string; frames: FrameInput[] }, ctx: Ctx) {
  const frames = input.frames ?? [];
  if (frames.length === 0) throw bad("", "manda al menos un marco");
  if (frames.length > MAX_FRAMES) throw bad("", `máximo ${MAX_FRAMES} marcos`);
  const seen = new Set<string>();
  const files: { f: FrameInput; file: string; mime: ImageMime; bytes: number; size: { width: number; height: number } | null }[] = [];
  const p = await findProject(db, input.project);
  for (const f of frames) {
    if (!FRAME_ID.test(f.id ?? "")) throw bad(String(f.id), "el id del marco es corto: letras, números, punto o guion (T, A1, B3)");
    if (seen.has(f.id)) throw bad(f.id, "ese id se repite");
    seen.add(f.id);
    if (!f.name?.trim()) throw bad(f.id, "falta el nombre del marco");
    const real = inside(f.path ?? "", f.id);
    const buf = readFileSync(real);
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) throw bad(f.id, "la imagen está vacía o pesa más de 5 MB");
    const mime = sniffImage(buf);
    if (!mime) throw bad(f.id, "solo PNG, JPEG o WebP");
    files.push({ f, file: putImageFile(p.slug, buf, mime), mime, bytes: buf.length, size: imageSize(buf, mime) });
  }
  return writeTx(db, p, ctx, async (tx, emit) => {
    const t = await requireTask(tx, p.id, input.key);
    if (t.kind !== "idea") throw bad("", `${t.key} no es una idea`);
    await tx.delete(ideaFrames).where(eq(ideaFrames.taskId, t.id));
    const rows = await tx
      .insert(ideaFrames)
      .values(
        files.map((x, i) => ({
          projectId: p.id,
          taskId: t.id,
          frameId: x.f.id,
          name: x.f.name.trim(),
          grupo: x.f.group?.trim() || null,
          hace: x.f.hace?.trim() || null,
          porque: x.f.porque?.trim() || null,
          position: i,
          file: x.file,
          mime: x.mime,
          bytes: x.bytes,
          width: x.size?.width ?? null,
          height: x.size?.height ?? null,
          actor: ctx.actor,
        })),
      )
      .returning();
    await emit(FRAMES_ATTACHED, { id: t.id, key: t.key }, { count: rows.length });
    rows.sort((a, b) => a.position - b.position);
    return { key: t.key, frames: rows.map((r) => view(p.slug, t.key, r)) };
  });
}

export async function listFrames(db: Db, slug: string, taskId: string, key: string): Promise<FrameView[]> {
  const rows = await db.select().from(ideaFrames).where(eq(ideaFrames.taskId, taskId)).orderBy(asc(ideaFrames.position));
  return rows.map((r) => view(slug, key, r));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function frameBytes(db: Db, slug: string, key: string, id: string): Promise<{ bytes: Buffer; mime: ImageMime } | null> {
  if (!UUID.test(id)) return null;
  const [r] = await db
    .select({ file: ideaFrames.file, mime: ideaFrames.mime })
    .from(ideaFrames)
    .innerJoin(tasks, eq(tasks.id, ideaFrames.taskId))
    .innerJoin(projects, eq(projects.id, ideaFrames.projectId))
    .where(and(eq(ideaFrames.id, id), eq(projects.slug, slug), eq(tasks.key, key)))
    .limit(1);
  if (!r) return null;
  const bytes = readImageFile(slug, r.file);
  return bytes ? { bytes, mime: r.mime } : null;
}
