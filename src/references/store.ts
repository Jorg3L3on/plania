// PLA-I67-4: references, the links, images and files the owner gives one agent (sketch PLA-IDEA31 frame 7).
//   A file (PNG, JPEG, WebP or PDF, read from its first bytes; 5 MB) is stored once per content under
//   <captures dir>/references/<project>/<sha256>.<ext>, the capture store's root (src/captures/store.ts), never in a
//   repo. An image is re-encoded without metadata and reduced to a long edge of 2576 px first (src/lib/image-clean.ts);
//   the row keeps its size so the screen can say what it costs a run in tokens.
//   A link is fetched by the server when it is saved (src/lib/safe-fetch.ts): a page keeps its text and the date it was
//   read; a link to an image or a PDF keeps the file the same way as an upload. A fetch that is refused keeps the
//   address with the refusal's code, and retryLink tries again.
// Rules of the Pedir store (src/pedidos/images.ts) apply: type by bytes, generated names, 5 MB. Errors carry a code
// from src/mcp/errors.ts and a sentence in the install's language that the screen shows as it comes.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { capturesDir } from "../captures/store.js";
import type { Db } from "../db/client.js";
import { agentReferences, agents, projects, type Actor, type AgentReference, type ImageMime, type ReferenceMime } from "../db/schema.js";
import { cleanImage, imageTokens, type Reducer } from "../lib/image-clean.js";
import { safeFetch, SafeFetchError, type SafeFetchOptions } from "../lib/safe-fetch.js";
import { ERRORS, type ErrorCode } from "../mcp/errors.js";
import { sniffImage } from "../pedidos/images.js";
import { defineWords, say } from "../words.js";

export const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;
export const MAX_REFERENCES_PER_SEAT = 40;
export const SNAPSHOT_MAX_CHARS = 60_000;
export const NOTE_MAX = 600;

export const REFERENCE_WORDS = defineWords({
  es: {
    FETCH_URL_INVALID: "Eso no parece una dirección web completa.",
    FETCH_SCHEME_REFUSED: "Solo se guardan direcciones http o https.",
    FETCH_NOT_RESOLVED: "No encontré ese sitio.",
    FETCH_ADDRESS_REFUSED: "Esa dirección apunta a esta máquina o a una red privada: no la abro.",
    FETCH_REDIRECT_REFUSED: (to: string | null) => (to ? `El enlace manda a otra dirección (${to}). Pega esa.` : "El enlace manda a otra dirección. Pega la dirección final."),
    FETCH_HTTP_STATUS: (status: number | null) => `El sitio respondió con un error${status ? ` (${status})` : ""}.`,
    FETCH_TYPE_REFUSED: "Ese enlace no es una página, una imagen ni un PDF.",
    FETCH_TOO_LARGE: "Lo que hay en el enlace pesa más de 5 MB.",
    FETCH_TIMEOUT: "El sitio tardó demasiado en responder.",
    FETCH_FAILED: "No pude conectar con el sitio.",
    REFERENCE_INVALID: "Revisa la nota (hasta 600 letras) y las opciones.",
    REFERENCE_FILE_EMPTY: "No llegó ningún archivo.",
    REFERENCE_FILE_TYPE: "Solo sirven imágenes PNG, JPEG o WebP y archivos PDF.",
    REFERENCE_FILE_TOO_LARGE: "El archivo pesa más de 5 MB.",
    REFERENCE_LIMIT: (n: number) => `Este puesto ya guarda ${n} referencias. Quita una antes de agregar otra.`,
    REFERENCE_NOT_FOUND: "No encontré esa referencia.",
    PROJECT_NOT_FOUND: "No encontré ese proyecto.",
    AGENT_NOT_FOUND: "Este puesto ya no está en el equipo.",
    imageTitle: "Imagen",
    pdfTitle: "PDF",
  },
  en: {
    FETCH_URL_INVALID: "That does not look like a full web address.",
    FETCH_SCHEME_REFUSED: "Only http or https addresses are kept.",
    FETCH_NOT_RESOLVED: "I could not find that site.",
    FETCH_ADDRESS_REFUSED: "That address points at this machine or a private network: I do not open it.",
    FETCH_REDIRECT_REFUSED: (to: string | null) => (to ? `The link sends to another address (${to}). Paste that one.` : "The link sends to another address. Paste the final one."),
    FETCH_HTTP_STATUS: (status: number | null) => `The site answered with an error${status ? ` (${status})` : ""}.`,
    FETCH_TYPE_REFUSED: "That link is not a page, an image or a PDF.",
    FETCH_TOO_LARGE: "What the link holds is larger than 5 MB.",
    FETCH_TIMEOUT: "The site took too long to answer.",
    FETCH_FAILED: "I could not connect to the site.",
    REFERENCE_INVALID: "Check the note (up to 600 characters) and the options.",
    REFERENCE_FILE_EMPTY: "No file arrived.",
    REFERENCE_FILE_TYPE: "Only PNG, JPEG or WebP images and PDF files work.",
    REFERENCE_FILE_TOO_LARGE: "The file is larger than 5 MB.",
    REFERENCE_LIMIT: (n: number) => `This seat already keeps ${n} references. Remove one before adding another.`,
    REFERENCE_NOT_FOUND: "I could not find that reference.",
    PROJECT_NOT_FOUND: "I could not find that project.",
    AGENT_NOT_FOUND: "This seat is no longer on the team.",
    imageTitle: "Image",
    pdfTitle: "PDF",
  },
});

export type ReferenceErrorCode = Extract<ErrorCode, `FETCH_${string}` | `REFERENCE_${string}` | "PROJECT_NOT_FOUND" | "AGENT_NOT_FOUND">;

/** The owner's sentence for a refusal code, with what the detail says (a redirect's location, a status). */
export function referenceMessage(code: string, detail: Record<string, unknown> = {}): string {
  const w = say(REFERENCE_WORDS);
  switch (code) {
    case "FETCH_REDIRECT_REFUSED":
      return w.FETCH_REDIRECT_REFUSED(typeof detail.location === "string" && detail.location ? detail.location : null);
    case "FETCH_HTTP_STATUS":
      return w.FETCH_HTTP_STATUS(typeof detail.status === "number" ? detail.status : null);
    case "REFERENCE_LIMIT":
      return w.REFERENCE_LIMIT(MAX_REFERENCES_PER_SEAT);
    default: {
      const v = (w as Record<string, unknown>)[code];
      return typeof v === "string" ? v : w.FETCH_FAILED;
    }
  }
}

export class ReferenceError extends Error {
  readonly status: 400 | 403 | 404 | 409;
  constructor(
    readonly code: ReferenceErrorCode,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(referenceMessage(code, detail));
    this.status = ERRORS[code][0];
  }
}

// ---- What the bytes are

export function sniffReference(buf: Buffer): ReferenceMime | null {
  const image = sniffImage(buf);
  if (image) return image;
  if (buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

const EXT: Record<ReferenceMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };
const FILE = /^[0-9a-f]{64}\.(png|jpg|webp|pdf)$/;

/** About how many pages a PDF has (its page objects); null when it does not say. */
export function pdfPages(buf: Buffer): number | null {
  const n = buf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? 0;
  return n > 0 ? n : null;
}

// ---- Files

function slugOk(slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`bad project slug ${slug}`);
  return slug;
}

export const referencesDir = (slug: string): string => path.join(capturesDir(), "references", slugOk(slug));

export function referenceFilePath(slug: string, file: string | null): string | null {
  return file && FILE.test(file) ? path.join(referencesDir(slug), file) : null;
}

function putFile(slug: string, buf: Buffer, mime: ReferenceMime): string {
  const name = `${createHash("sha256").update(buf).digest("hex")}.${EXT[mime]}`;
  const dir = referencesDir(slug);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  if (!existsSync(target)) {
    const tmp = path.join(dir, `.${name}.${randomUUID()}.tmp`);
    writeFileSync(tmp, buf, { mode: 0o600 });
    renameSync(tmp, target);
  }
  return name;
}

// ---- Text of a page

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", laquo: "\u00ab", raquo: "\u00bb", copy: "\u00a9" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** A page's title and readable text: no scripts, styles or tags, one line per block, at most SNAPSHOT_MAX_CHARS. */
export function htmlToText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(p|div|section|article|header|footer|nav|main|aside|h[1-6]|li|ul|ol|tr|table|blockquote|pre|figure|figcaption|dt|dd)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v\r ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, SNAPSHOT_MAX_CHARS);
  return { title: title ? decodeEntities(title).replace(/\s+/g, " ").trim().slice(0, 160) || null : null, text };
}

function decodeText(bytes: Buffer, contentType: string | null): string {
  const charset = /charset=\W?([\w-]+)/i.exec(contentType ?? "")?.[1]?.toLowerCase();
  try {
    return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// ---- The seat

type Seat = { projectId: string; agentId: string; slug: string };

async function seatOf(db: Db, slug: string, agent: string): Promise<Seat> {
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) throw new ReferenceError("PROJECT_NOT_FOUND");
  const [a] = await db
    .select({ id: agents.id, status: agents.status })
    .from(agents)
    .where(and(eq(agents.slug, agent), eq(agents.projectId, p.id)))
    .limit(1);
  if (!a || a.status === "retired") throw new ReferenceError("AGENT_NOT_FOUND");
  return { projectId: p.id, agentId: a.id, slug };
}

// ---- Views

export type ReferenceUse = { runs_carried: number; runs_opened: number; deliveries_carried: number; deliveries_opened: number };
export type ReferenceView = {
  id: string;
  kind: AgentReference["kind"];
  title: string;
  url: string | null;
  host: string | null;
  snapshot_at: string | null;
  snapshot_chars: number;
  fetch_status: "ok" | "failed" | null;
  fetch_error: { code: string; message: string } | null;
  file_url: string | null; // the stored file, behind the screen session
  mime: ReferenceMime | null;
  bytes: number | null;
  original_bytes: number | null;
  width: number | null;
  height: number | null;
  tokens: number | null; // about what an image costs a run
  pages: number | null;
  note: string;
  stance: "follow" | "avoid";
  applies: "always" | "on_topic";
  scope: "agent" | "project";
  state: "on" | "off";
  mine: boolean; // false: another seat's reference shared with the whole project
  created_at: string;
  uses: ReferenceUse;
};

export const referencesPath = (slug: string, agent: string) => `/api/company/projects/${encodeURIComponent(slug)}/team/${encodeURIComponent(agent)}/references`;

const hostOf = (url: string | null): string | null => {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
};

// The fetch's detail rides in fetch_error as "CODE" or "CODE location" so the sentence can name where it sends.
function fetchErrorView(raw: string | null): ReferenceView["fetch_error"] {
  if (!raw) return null;
  const [code, ...rest] = raw.split(" ");
  const location = rest.join(" ") || null;
  const status = /^\d{3}$/.test(location ?? "") ? Number(location) : null;
  return { code: code!, message: referenceMessage(code!, { location, status }) };
}

const NO_USE: ReferenceUse = { runs_carried: 0, runs_opened: 0, deliveries_carried: 0, deliveries_opened: 0 };

function view(seat: Seat, agentSlug: string, r: AgentReference, uses: ReferenceUse = NO_USE, pages: number | null = null): ReferenceView {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    url: r.url,
    host: hostOf(r.url),
    snapshot_at: r.snapshotAt?.toISOString() ?? null,
    snapshot_chars: r.snapshotText?.length ?? 0,
    fetch_status: r.fetchStatus,
    fetch_error: fetchErrorView(r.fetchError),
    file_url: r.file ? `${referencesPath(seat.slug, agentSlug)}/${r.id}/file` : null,
    mime: r.mime,
    bytes: r.bytes,
    original_bytes: r.originalBytes,
    width: r.width,
    height: r.height,
    tokens: r.mime && r.mime !== "application/pdf" ? imageTokens(r.width, r.height) : null,
    pages,
    note: r.note,
    stance: r.stance,
    applies: r.applies,
    scope: r.scope,
    state: r.state,
    mine: r.agentId === seat.agentId,
    created_at: r.createdAt.toISOString(),
    uses,
  };
}

async function usesOf(db: Db, agentId: string, ids: string[]): Promise<Map<string, ReferenceUse>> {
  if (ids.length === 0) return new Map();
  const rows = (
    await db.execute<{ reference_id: string; runs_carried: number; runs_opened: number; deliveries_carried: number; deliveries_opened: number } & Record<string, unknown>>(sql`
      select u.reference_id,
             count(*)::int as runs_carried,
             (count(*) filter (where u.opened))::int as runs_opened,
             count(distinct r.task_key)::int as deliveries_carried,
             (count(distinct r.task_key) filter (where u.opened))::int as deliveries_opened
      from agent_reference_uses u
      join agent_runs r on r.id = u.run_id
      where r.agent_id = ${agentId} and u.reference_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      group by u.reference_id`)
  ).rows;
  return new Map(rows.map((r) => [r.reference_id, { runs_carried: r.runs_carried, runs_opened: r.runs_opened, deliveries_carried: r.deliveries_carried, deliveries_opened: r.deliveries_opened }]));
}

function pagesOf(seat: Seat, r: AgentReference): number | null {
  if (r.mime !== "application/pdf") return null;
  const p = referenceFilePath(seat.slug, r.file);
  return p && existsSync(p) ? pdfPages(readFileSync(p)) : null;
}

async function viewOne(db: Db, seat: Seat, agentSlug: string, r: AgentReference): Promise<ReferenceView> {
  const uses = await usesOf(db, seat.agentId, [r.id]);
  return view(seat, agentSlug, r, uses.get(r.id), pagesOf(seat, r));
}

// What a seat sees: its own references, then the ones other seats share with the whole project. Newest first.
const visible = (seat: Seat) => or(eq(agentReferences.agentId, seat.agentId), and(eq(agentReferences.projectId, seat.projectId), eq(agentReferences.scope, "project")));

export async function listReferences(db: Db, slug: string, agent: string): Promise<ReferenceView[]> {
  const seat = await seatOf(db, slug, agent);
  const rows = await db.select().from(agentReferences).where(visible(seat)).orderBy(sql`${agentReferences.createdAt} desc`, asc(agentReferences.id));
  const uses = await usesOf(db, seat.agentId, rows.map((r) => r.id));
  return rows.map((r) => view(seat, agent, r, uses.get(r.id), pagesOf(seat, r)));
}

// ---- Fields

export type ReferenceFields = { title?: string; note?: string; stance?: "follow" | "avoid"; applies?: "always" | "on_topic"; scope?: "agent" | "project"; state?: "on" | "off" };

function fields(input: ReferenceFields): Partial<AgentReference> {
  const out: Partial<AgentReference> = {};
  if (input.title !== undefined) {
    const t = input.title.replace(/\s+/g, " ").trim();
    if (!t || t.length > 160) throw new ReferenceError("REFERENCE_INVALID", { field: "title" });
    out.title = t;
  }
  if (input.note !== undefined) {
    const n = input.note.trim();
    if (n.length > NOTE_MAX) throw new ReferenceError("REFERENCE_INVALID", { field: "note" });
    out.note = n;
  }
  if (input.stance !== undefined) {
    if (input.stance !== "follow" && input.stance !== "avoid") throw new ReferenceError("REFERENCE_INVALID", { field: "stance" });
    out.stance = input.stance;
  }
  if (input.applies !== undefined) {
    if (input.applies !== "always" && input.applies !== "on_topic") throw new ReferenceError("REFERENCE_INVALID", { field: "applies" });
    out.applies = input.applies;
  }
  if (input.scope !== undefined) {
    if (input.scope !== "agent" && input.scope !== "project") throw new ReferenceError("REFERENCE_INVALID", { field: "scope" });
    out.scope = input.scope;
  }
  if (input.state !== undefined) {
    if (input.state !== "on" && input.state !== "off") throw new ReferenceError("REFERENCE_INVALID", { field: "state" });
    out.state = input.state;
  }
  return out;
}

async function roomFor(db: Db, seat: Seat): Promise<void> {
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(agentReferences).where(eq(agentReferences.agentId, seat.agentId));
  if ((n?.n ?? 0) >= MAX_REFERENCES_PER_SEAT) throw new ReferenceError("REFERENCE_LIMIT", { max: MAX_REFERENCES_PER_SEAT });
}

// ---- Files in

export type StoredFile = { file: string; mime: ReferenceMime; bytes: number; width: number | null; height: number | null; originalBytes: number };

/** Checks, cleans and writes one file. Images are re-encoded without metadata and reduced; a PDF is kept as it came. */
export async function storeReferenceFile(slug: string, buf: Buffer, opts: { reduce?: Reducer | null } = {}): Promise<StoredFile> {
  if (!buf || buf.length === 0) throw new ReferenceError("REFERENCE_FILE_EMPTY");
  if (buf.length > MAX_REFERENCE_BYTES) throw new ReferenceError("REFERENCE_FILE_TOO_LARGE", { max_bytes: MAX_REFERENCE_BYTES });
  const mime = sniffReference(buf);
  if (!mime) throw new ReferenceError("REFERENCE_FILE_TYPE");
  if (mime === "application/pdf") return { file: putFile(slug, buf, mime), mime, bytes: buf.length, width: null, height: null, originalBytes: buf.length };
  const clean = await cleanImage(buf, mime as ImageMime, { reduce: opts.reduce });
  if (clean.bytes.length > MAX_REFERENCE_BYTES) throw new ReferenceError("REFERENCE_FILE_TOO_LARGE", { max_bytes: MAX_REFERENCE_BYTES });
  return { file: putFile(slug, clean.bytes, clean.mime), mime: clean.mime, bytes: clean.bytes.length, width: clean.width, height: clean.height, originalBytes: buf.length };
}

const cleanName = (name: string | undefined): string | null => {
  const base = (name ?? "").split(/[\\/]/).pop()!.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim();
  return base ? base.slice(0, 160) : null;
};

export type ReferenceDeps = { reduce?: Reducer | null; fetch?: SafeFetchOptions };

export async function addFileReference(
  db: Db,
  input: { slug: string; agent: string; bytes: Buffer; name?: string; actor: Actor } & ReferenceFields,
  deps: ReferenceDeps = {},
): Promise<ReferenceView> {
  const seat = await seatOf(db, input.slug, input.agent);
  const set = fields(input);
  await roomFor(db, seat);
  const stored = await storeReferenceFile(input.slug, input.bytes, { reduce: deps.reduce });
  const w = say(REFERENCE_WORDS);
  const [row] = await db
    .insert(agentReferences)
    .values({
      projectId: seat.projectId,
      agentId: seat.agentId,
      kind: stored.mime === "application/pdf" ? "file" : "image",
      title: set.title ?? cleanName(input.name) ?? (stored.mime === "application/pdf" ? w.pdfTitle : w.imageTitle),
      file: stored.file,
      mime: stored.mime,
      bytes: stored.bytes,
      width: stored.width,
      height: stored.height,
      originalBytes: stored.originalBytes,
      note: set.note ?? "",
      stance: set.stance ?? "follow",
      applies: set.applies ?? "always",
      scope: set.scope ?? "agent",
      state: set.state ?? "on",
      actor: input.actor,
    })
    .returning();
  return viewOne(db, seat, input.agent, row!);
}

// ---- Links

const LINK_TYPES = ["text/html", "application/xhtml+xml", "text/plain", "text/markdown", "application/json", "image/png", "image/jpeg", "image/webp", "application/pdf", "application/octet-stream"] as const;

type Fetched = { patch: Partial<AgentReference>; error: { code: string; detail: Record<string, unknown> } | null };

async function fetchLink(slug: string, url: string, deps: ReferenceDeps): Promise<Fetched> {
  try {
    const r = await safeFetch(url, { accept: LINK_TYPES, ...deps.fetch });
    const sniffed = sniffReference(r.bytes);
    if (sniffed) {
      const stored = await storeReferenceFile(slug, r.bytes, { reduce: deps.reduce });
      return {
        patch: { file: stored.file, mime: stored.mime, bytes: stored.bytes, width: stored.width, height: stored.height, originalBytes: stored.originalBytes, snapshotText: null, snapshotAt: r.fetchedAt, fetchStatus: "ok", fetchError: null },
        error: null,
      };
    }
    if ((r.contentType ?? "").startsWith("image/") || (r.contentType ?? "") === "application/pdf" || (r.contentType ?? "") === "application/octet-stream") {
      return { patch: { fetchStatus: "failed", fetchError: "FETCH_TYPE_REFUSED" }, error: { code: "FETCH_TYPE_REFUSED", detail: { content_type: r.contentType } } };
    }
    const raw = decodeText(r.bytes, r.contentType);
    const isHtml = /html|xml/.test(r.contentType ?? "") || /^\s*</.test(raw);
    const page = isHtml ? htmlToText(raw) : { title: null, text: raw.slice(0, SNAPSHOT_MAX_CHARS) };
    return { patch: { snapshotText: page.text, snapshotAt: r.fetchedAt, fetchStatus: "ok", fetchError: null, ...(page.title ? { title: page.title } : {}) }, error: null };
  } catch (e) {
    if (e instanceof SafeFetchError) {
      const extra = e.code === "FETCH_REDIRECT_REFUSED" && typeof e.detail.location === "string" && e.detail.location ? ` ${e.detail.location}` : e.code === "FETCH_HTTP_STATUS" ? ` ${e.detail.status}` : "";
      return { patch: { fetchStatus: "failed", fetchError: `${e.code}${extra}`.slice(0, 2100) }, error: { code: e.code, detail: e.detail } };
    }
    if (e instanceof ReferenceError) return { patch: { fetchStatus: "failed", fetchError: e.code }, error: { code: e.code, detail: e.detail } };
    throw e;
  }
}

/**
 * Saves a link and reads it once. An address that is not http(s) or not an address at all is refused outright; a
 * fetch that fails keeps the address with its refusal (fetch_status failed) so the owner sees why and can retry.
 */
export async function addLinkReference(
  db: Db,
  input: { slug: string; agent: string; url: string; actor: Actor } & ReferenceFields,
  deps: ReferenceDeps = {},
): Promise<{ reference: ReferenceView; error: { code: string; message: string; detail: Record<string, unknown> } | null }> {
  const seat = await seatOf(db, input.slug, input.agent);
  const set = fields(input);
  let url: string;
  try {
    const u = new URL(input.url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new ReferenceError("FETCH_SCHEME_REFUSED", { scheme: u.protocol.replace(/:$/, "") });
    if (u.username || u.password || input.url.trim().length > 2048) throw new ReferenceError("FETCH_URL_INVALID");
    u.hash = "";
    url = u.toString();
  } catch (e) {
    if (e instanceof ReferenceError) throw e;
    throw new ReferenceError("FETCH_URL_INVALID");
  }
  await roomFor(db, seat);
  const got = await fetchLink(input.slug, url, deps);
  const host = hostOf(url) ?? url;
  // PLA-136: the same link saved twice for one seat (a double click) stays one reference.
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ref:${seat.agentId}`}))`);
    const [same] = await tx
      .select()
      .from(agentReferences)
      .where(and(eq(agentReferences.agentId, seat.agentId), eq(agentReferences.kind, "link"), eq(agentReferences.url, url)))
      .limit(1);
    if (same) return same;
    const [made] = await tx
    .insert(agentReferences)
    .values({
      projectId: seat.projectId,
      agentId: seat.agentId,
      kind: "link",
      title: set.title ?? host.slice(0, 160),
      url,
      note: set.note ?? "",
      stance: set.stance ?? "follow",
      applies: set.applies ?? "always",
      scope: set.scope ?? "agent",
      state: set.state ?? "on",
      actor: input.actor,
      ...got.patch,
      ...(set.title ? { title: set.title } : {}),
    })
    .returning();
    return made!;
  });
  return { reference: await viewOne(db, seat, input.agent, row), error: got.error ? { ...got.error, message: referenceMessage(got.error.code, got.error.detail) } : null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Only the seat's own references change from its page; a shared one is changed from the seat that owns it.
async function ownRow(db: Db, seat: Seat, id: string): Promise<AgentReference> {
  if (!UUID.test(id)) throw new ReferenceError("REFERENCE_NOT_FOUND");
  const [r] = await db.select().from(agentReferences).where(and(eq(agentReferences.id, id), eq(agentReferences.agentId, seat.agentId)));
  if (!r) throw new ReferenceError("REFERENCE_NOT_FOUND");
  return r;
}

export async function retryLink(db: Db, slug: string, agent: string, id: string, deps: ReferenceDeps = {}): Promise<{ reference: ReferenceView; error: { code: string; message: string; detail: Record<string, unknown> } | null }> {
  const seat = await seatOf(db, slug, agent);
  const r = await ownRow(db, seat, id);
  if (r.kind !== "link" || !r.url) throw new ReferenceError("REFERENCE_NOT_FOUND");
  const got = await fetchLink(slug, r.url, deps);
  // A title the owner wrote stays; one taken from the page or the host follows the new read.
  const titled = r.title !== (hostOf(r.url) ?? r.url).slice(0, 160);
  const patch = { ...got.patch, ...(titled ? { title: r.title } : {}) };
  const [row] = await db.update(agentReferences).set({ ...patch, updatedAt: new Date() }).where(eq(agentReferences.id, r.id)).returning();
  await dropFileIfUnused(db, slug, r.file);
  return { reference: await viewOne(db, seat, agent, row!), error: got.error ? { ...got.error, message: referenceMessage(got.error.code, got.error.detail) } : null };
}

export async function updateReference(db: Db, slug: string, agent: string, id: string, input: ReferenceFields): Promise<ReferenceView> {
  const seat = await seatOf(db, slug, agent);
  const r = await ownRow(db, seat, id);
  const set = fields(input);
  if (Object.keys(set).length === 0) return viewOne(db, seat, agent, r);
  const [row] = await db.update(agentReferences).set({ ...set, updatedAt: new Date() }).where(eq(agentReferences.id, r.id)).returning();
  return viewOne(db, seat, agent, row!);
}

async function dropFileIfUnused(db: Db, slug: string, file: string | null): Promise<boolean> {
  if (!file) return false;
  const [other] = await db.select({ id: agentReferences.id }).from(agentReferences).where(eq(agentReferences.file, file)).limit(1);
  if (other) return false;
  const p = referenceFilePath(slug, file);
  if (p) rmSync(p, { force: true });
  return true;
}

/** Removes the row (and its use history), and the file when no other reference points at it. */
export async function deleteReference(db: Db, slug: string, agent: string, id: string): Promise<{ file_removed: boolean }> {
  const seat = await seatOf(db, slug, agent);
  const r = await ownRow(db, seat, id);
  await db.delete(agentReferences).where(eq(agentReferences.id, r.id));
  return { file_removed: await dropFileIfUnused(db, slug, r.file) };
}

export async function referenceBytes(db: Db, slug: string, agent: string, id: string): Promise<{ bytes: Buffer; mime: ReferenceMime }> {
  const seat = await seatOf(db, slug, agent);
  if (!UUID.test(id)) throw new ReferenceError("REFERENCE_NOT_FOUND");
  const [r] = await db.select().from(agentReferences).where(and(eq(agentReferences.id, id), visible(seat)));
  const p = r ? referenceFilePath(slug, r.file) : null;
  if (!r || !r.mime || !p || !existsSync(p)) throw new ReferenceError("REFERENCE_NOT_FOUND");
  return { bytes: readFileSync(p), mime: r.mime };
}

// ---- For the runner (src/runner/references.ts)

/** The references a seat's next run carries: on, its own or shared with the project; «always» first, then newest. */
export async function carriedReferences(db: Db, projectId: string, agentId: string, limit: number): Promise<(AgentReference & { slug: string })[]> {
  const rows = await db
    .select({ r: agentReferences, slug: projects.slug })
    .from(agentReferences)
    .innerJoin(projects, eq(projects.id, agentReferences.projectId))
    .where(
      and(
        eq(agentReferences.state, "on"),
        eq(agentReferences.projectId, projectId),
        or(eq(agentReferences.agentId, agentId), eq(agentReferences.scope, "project")),
      ),
    )
    .orderBy(sql`case when ${agentReferences.applies} = 'always' then 0 else 1 end`, sql`${agentReferences.createdAt} desc`)
    .limit(limit);
  return rows.map((x) => ({ ...x.r, slug: x.slug }));
}

