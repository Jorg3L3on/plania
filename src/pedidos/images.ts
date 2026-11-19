// PLA-I54-2: pictures on a request. The owner pastes, drops or picks a screenshot on Pedir; it is stored once per
// content under <captures dir>/pedidos/<project>/<sha256>.<ext> (the capture store's root, src/captures/store.ts,
// default ~/plania-captures; never in an app repo) and a task_images row says which request it belongs to.
// The type comes from the file's first bytes, never its name. 5 MB each, 6 per request. Errors are in Spanish:
// the screen shows them as they come.
import { createHash, randomUUID } from "node:crypto";
import { defineWords, say } from "../words.js";

// PLA-I2-10: the refusals the owner reads, in the install's language (Spanish unchanged).
export const IMAGE_WORDS = defineWords({
  es: { empty: "No llegó ninguna imagen.", type: "Solo se aceptan imágenes PNG, JPEG o WebP.", big: "La imagen pesa más de 5 MB.", many: (n: number) => `Un pedido admite hasta ${n} imágenes.`, task: "No encontré ese pedido.", image: "No encontré esa imagen." },
  en: { empty: "No image arrived.", type: "Only PNG, JPEG or WebP images are accepted.", big: "The image is larger than 5 MB.", many: (n: number) => `A request takes up to ${n} images.`, task: "I could not find that request.", image: "I could not find that image." },
});
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { capturesDir } from "../captures/store.js";
import { projects, taskImages, tasks, type Actor, type ImageMime, type TaskImage } from "../db/schema.js";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_TASK = 6;
const EXT: Record<ImageMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const FILE = /^[0-9a-f]{64}\.(png|jpg|webp)$/;

export class ImageError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409 | 413 | 415,
    message: string,
  ) {
    super(message);
  }
}

export const imageErrors = {
  empty: () => new ImageError("IMAGEN_VACIA", 400, say(IMAGE_WORDS).empty),
  type: () => new ImageError("TIPO_NO_ADMITIDO", 415, say(IMAGE_WORDS).type),
  big: () => new ImageError("IMAGEN_GRANDE", 413, say(IMAGE_WORDS).big),
  many: () => new ImageError("DEMASIADAS_IMAGENES", 409, say(IMAGE_WORDS).many(MAX_IMAGES_PER_TASK)),
  task: () => new ImageError("PEDIDO_NO_ENCONTRADO", 404, say(IMAGE_WORDS).task),
  image: () => new ImageError("IMAGEN_NO_ENCONTRADA", 404, say(IMAGE_WORDS).image),
};

// ---- What the bytes are

export function sniffImage(buf: Buffer): ImageMime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

// Width and height when the header says them cheaply; null otherwise (never a reason to refuse).
export function imageSize(buf: Buffer, mime: ImageMime): { width: number; height: number } | null {
  try {
    if (mime === "image/png") {
      if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return null;
        const marker = buf[i + 1]!;
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
          i += 2;
          continue;
        }
        const len = buf.readUInt16BE(i + 2);
        // SOF0..SOF15 except DHT (c4), JPG (c8) and DAC (cc).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
      return null;
    }
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X" && buf.length >= 30) return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === "VP8 " && buf.length >= 30) return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L" && buf.length >= 25) {
      const b = buf.readUInt32LE(21);
      return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
    return null;
  } catch {
    return null;
  }
}

// ---- Files

function slugOk(slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`bad project slug ${slug}`);
  return slug;
}

export function pedidosDir(slug: string): string {
  return path.join(capturesDir(), "pedidos", slugOk(slug));
}

export function imagePath(slug: string, file: string): string | null {
  return FILE.test(file) ? path.join(pedidosDir(slug), file) : null;
}

// Writes the picture once (content-addressed) and returns its file name.
export function putImageFile(slug: string, buf: Buffer, mime: ImageMime): string {
  const name = `${createHash("sha256").update(buf).digest("hex")}.${EXT[mime]}`;
  const dir = pedidosDir(slug);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  if (!existsSync(target)) {
    const tmp = path.join(dir, `.${name}.${randomUUID()}.tmp`);
    writeFileSync(tmp, buf, { mode: 0o600 });
    renameSync(tmp, target);
  }
  return name;
}

export function readImageFile(slug: string, file: string): Buffer | null {
  const p = imagePath(slug, file);
  return p && existsSync(p) ? readFileSync(p) : null;
}

// ---- Rows

export type StoredImage = {
  id: string;
  url: string; // the bytes, behind the screen session
  mime: ImageMime;
  bytes: number;
  width: number | null;
  height: number | null;
  created_at: string;
};

export function imageUrl(slug: string, key: string, id: string): string {
  return `/api/company/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(key)}/images/${id}`;
}

const view = (slug: string, key: string, r: TaskImage): StoredImage => ({
  id: r.id,
  url: imageUrl(slug, key, r.id),
  mime: r.mime,
  bytes: r.bytes,
  width: r.width,
  height: r.height,
  created_at: r.createdAt.toISOString(),
});

async function taskOf(db: Db, slug: string, key: string): Promise<{ projectId: string; taskId: string }> {
  const [r] = await db
    .select({ projectId: projects.id, taskId: tasks.id })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(projects.slug, slug), eq(tasks.key, key)));
  if (!r) throw imageErrors.task();
  return r;
}

// Checks the bytes, writes the file and adds the row. The same picture twice on one request is the row it already
// has (created: false). The count is checked under a lock on the task, so two uploads at once never make a seventh.
export async function addTaskImage(
  db: Db,
  input: { slug: string; key: string; bytes: Buffer; actor: Actor },
): Promise<{ image: StoredImage; created: boolean }> {
  const buf = input.bytes;
  if (!buf || buf.length === 0) throw imageErrors.empty();
  if (buf.length > MAX_IMAGE_BYTES) throw imageErrors.big();
  const mime = sniffImage(buf);
  if (!mime) throw imageErrors.type();
  const { projectId, taskId } = await taskOf(db, input.slug, input.key);
  const file = putImageFile(input.slug, buf, mime);
  const size = imageSize(buf, mime);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from tasks where id = ${taskId} for update`);
    const rows = await tx.select().from(taskImages).where(eq(taskImages.taskId, taskId));
    const same = rows.find((r) => r.file === file);
    if (same) return { image: view(input.slug, input.key, same), created: false };
    if (rows.length >= MAX_IMAGES_PER_TASK) throw imageErrors.many();
    const [row] = await tx
      .insert(taskImages)
      .values({ projectId, taskId, file, mime, bytes: buf.length, width: size?.width ?? null, height: size?.height ?? null, actor: input.actor })
      .returning();
    return { image: view(input.slug, input.key, row!), created: true };
  });
}

export async function listTaskImages(db: Db, slug: string, key: string): Promise<StoredImage[]> {
  const { taskId } = await taskOf(db, slug, key);
  const rows = await db.select().from(taskImages).where(eq(taskImages.taskId, taskId)).orderBy(asc(taskImages.createdAt), asc(taskImages.id));
  return rows.map((r) => view(slug, key, r));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function rowOf(db: Db, slug: string, key: string, id: string): Promise<TaskImage> {
  if (!UUID.test(id)) throw imageErrors.image();
  const { taskId } = await taskOf(db, slug, key);
  const [r] = await db.select().from(taskImages).where(and(eq(taskImages.id, id), eq(taskImages.taskId, taskId)));
  if (!r) throw imageErrors.image();
  return r;
}

export async function taskImageBytes(db: Db, slug: string, key: string, id: string): Promise<{ bytes: Buffer; mime: ImageMime }> {
  const r = await rowOf(db, slug, key, id);
  const bytes = readImageFile(slug, r.file);
  if (!bytes) throw imageErrors.image();
  return { bytes, mime: r.mime };
}

// Removes the row, and the file when no other request of the project points at it.
export async function deleteTaskImage(db: Db, slug: string, key: string, id: string): Promise<{ file_removed: boolean }> {
  const r = await rowOf(db, slug, key, id);
  await db.delete(taskImages).where(eq(taskImages.id, r.id));
  const [other] = await db
    .select({ id: taskImages.id })
    .from(taskImages)
    .where(and(eq(taskImages.projectId, r.projectId), eq(taskImages.file, r.file)))
    .limit(1);
  if (other) return { file_removed: false };
  const p = imagePath(slug, r.file);
  if (p) rmSync(p, { force: true });
  return { file_removed: true };
}

// The runner's read: absolute paths of a task's pictures that are on disk, oldest first.
export async function taskImagePaths(db: Db, projectId: string, key: string): Promise<string[]> {
  const rows = await db
    .select({ file: taskImages.file, slug: projects.slug })
    .from(taskImages)
    .innerJoin(tasks, eq(tasks.id, taskImages.taskId))
    .innerJoin(projects, eq(projects.id, taskImages.projectId))
    .where(and(eq(taskImages.projectId, projectId), eq(tasks.key, key)))
    .orderBy(asc(taskImages.createdAt), asc(taskImages.id));
  return rows.map((r) => imagePath(r.slug, r.file)).filter((p): p is string => !!p && existsSync(p));
}
