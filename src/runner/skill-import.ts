// PLA-I67-6: «Traer de un enlace». A skill folder fetched from a link the owner pastes, through the safe fetch of
// step 4 (src/lib/safe-fetch.ts: public addresses only, no redirects, size and time limits; tests inject the resolver
// and the connector). What a link may be:
//   - an address that ends in SKILL.md (any host): that one file is the skill
//   - a GitHub folder (github.com/<owner>/<repo>/tree/<ref>/<path>), a GitHub file in it
//     (github.com/…/blob/<ref>/<path>/SKILL.md) or its raw address (raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>/SKILL.md):
//     the folder is listed with GitHub's contents API and every file read from raw.githubusercontent.com, each through
//     the safe fetch. Folders two levels deep at most, FILES_MAX supporting files.
// The same rules as a skill written on screen (validateSkill), and before any file is read: a file that is not .md or
// .txt (a script), a hooks folder or file, an allowed-tools or hooks key in SKILL.md, or a command run at load time is
// SKILL_NOT_ALLOWED. Anything that is not a skill is SKILL_IMPORT_FORMAT.
//
// previewImport shows every file and the content hash (sha256 of SKILL.md and each file) without writing anything.
// importSkill fetches again and saves only when the hash is the one the owner saw (else SKILL_IMPORT_CHANGED): an
// imported skill, off, pinned to that hash. checkUpdate fetches the link again and returns both contents for the
// diff; applyUpdate writes a new version only for the hash the owner confirmed.
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { listPacks, packSlug } from "./packs.js";
import { skills, type SkillFile, type SkillScope } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { SafeFetchError, safeFetch, type SafeFetchOptions } from "../lib/safe-fetch.js";
import { frontmatter } from "./kit.js";
import { FILES_MAX, addVersion, liveBySlug, sameContent, scopeTarget, seatOf, validateSkill, versionsOf, type SkillContent } from "./skills.js";

export type ImportDeps = { fetch?: SafeFetchOptions };

const FILE_BYTES = 200_000;
const LIST_BYTES = 400_000;
const MAX_DEPTH = 2;
const TEXT = /\.(md|txt)$/i;
const SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;

export type SkillLink = { kind: "file"; url: string } | { kind: "github"; owner: string; repo: string; ref: string; dir: string };

const format = (reason: string, extra: Record<string, unknown> = {}) => new ToolError("SKILL_IMPORT_FORMAT", { reason, ...extra });
const notAllowed = (field: string, hint: string) => new ToolError("SKILL_NOT_ALLOWED", { field, hint });

// Which kind of link it is, and for GitHub the folder it names. Throws SKILL_IMPORT_FORMAT (or the fetch's own
// FETCH_URL_INVALID / FETCH_SCHEME_REFUSED for an address that is not one).
export function parseSkillLink(raw: string): SkillLink {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ToolError("FETCH_URL_INVALID");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ToolError("FETCH_SCHEME_REFUSED", { scheme: url.protocol.replace(/:$/, "") });
  const parts = url.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  const host = url.hostname.toLowerCase();
  const safe = (xs: string[]) => xs.every((x) => SEGMENT.test(x) && x !== "." && x !== "..");
  if (host === "github.com" || host === "www.github.com") {
    const [owner, repo, kind, ref, ...rest] = parts;
    if (!owner || !repo || !ref || (kind !== "tree" && kind !== "blob") || !safe([owner, repo, ref, ...rest])) throw format("link");
    if (kind === "blob") {
      if (rest.at(-1)?.toUpperCase() !== "SKILL.MD") throw format("not_skill_md");
      return { kind: "github", owner, repo, ref, dir: rest.slice(0, -1).join("/") };
    }
    return { kind: "github", owner, repo, ref, dir: rest.join("/") };
  }
  if (host === "raw.githubusercontent.com") {
    let [owner, repo, ...rest] = parts;
    // raw.githubusercontent.com/<o>/<r>/refs/heads/<branch>/… is the same file as /<o>/<r>/<branch>/…
    if (rest[0] === "refs" && (rest[1] === "heads" || rest[1] === "tags")) rest = rest.slice(2);
    const [ref, ...file] = rest;
    if (!owner || !repo || !ref || file.at(-1)?.toUpperCase() !== "SKILL.MD" || !safe([owner, repo, ref, ...file])) throw format("not_skill_md");
    return { kind: "github", owner, repo, ref, dir: file.slice(0, -1).join("/") };
  }
  if (parts.at(-1)?.toUpperCase() === "SKILL.MD") return { kind: "file", url: url.toString() };
  throw format("link");
}

// ---- Fetching

async function get(url: string, deps: ImportDeps, accept: readonly string[], maxBytes: number, headers: Record<string, string> = {}): Promise<Buffer> {
  try {
    const r = await safeFetch(url, { accept, maxBytes, ...deps.fetch, headers: { "User-Agent": "Plania/1 (skill import)", ...headers, ...deps.fetch?.headers } });
    return r.bytes;
  } catch (e) {
    if (e instanceof SafeFetchError) throw new ToolError(e.code, e.detail);
    throw e;
  }
}

const textOf = (b: Buffer) => b.toString("utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
const enc = (p: string) => p.split("/").filter(Boolean).map(encodeURIComponent).join("/");

type Listed = { path: string; type: string; size?: number };

async function listGithub(l: Extract<SkillLink, { kind: "github" }>, dir: string, deps: ImportDeps): Promise<Listed[]> {
  const api = `https://api.github.com/repos/${enc(l.owner)}/${enc(l.repo)}/contents/${enc(dir)}?ref=${encodeURIComponent(l.ref)}`;
  const body = await get(api, deps, ["application/json"], LIST_BYTES, { Accept: "application/vnd.github+json" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(textOf(body));
  } catch {
    throw format("listing");
  }
  if (!Array.isArray(parsed)) throw format("not_a_folder");
  return parsed.map((x: { path?: unknown; type?: unknown; size?: unknown }) => ({ path: String(x.path ?? ""), type: String(x.type ?? ""), size: typeof x.size === "number" ? x.size : undefined }));
}

export type FetchedSkill = { url: string; skillMd: string; files: SkillFile[] };

// The folder's files, refused by name before any of them is read when one is not text.
async function fetchFolder(l: Extract<SkillLink, { kind: "github" }>, deps: ImportDeps): Promise<{ skillMd: string; files: SkillFile[] }> {
  const root = l.dir;
  const rel = (p: string) => (root ? p.slice(root.length + 1) : p);
  const wanted: string[] = [];
  let skillMd: string | null = null;
  const walk = async (dir: string, depth: number) => {
    for (const e of await listGithub(l, dir, deps)) {
      const r = rel(e.path);
      if (!r || (root && !e.path.startsWith(`${root}/`))) throw format("listing");
      if (/(^|\/)hooks(\/|\.json$|$)/i.test(r)) throw notAllowed("files", `${r}: no hooks in a skill`);
      if (e.type === "dir") {
        if (depth >= MAX_DEPTH) throw format("too_deep", { path: r });
        await walk(e.path, depth + 1);
      } else if (e.type === "file") {
        if (r.toUpperCase() === "SKILL.MD") skillMd = e.path;
        else if (!TEXT.test(r)) throw notAllowed("files", `only .md and .txt files: ${r.slice(0, 80)}`);
        else wanted.push(e.path);
        if (wanted.length > FILES_MAX) throw format("too_many_files", { max: FILES_MAX });
      } else throw notAllowed("files", `${r}: not a plain file`);
    }
  };
  await walk(root, 0);
  if (!skillMd) throw format("no_skill_md");
  const raw = (p: string) => `https://raw.githubusercontent.com/${enc(l.owner)}/${enc(l.repo)}/${encodeURIComponent(l.ref)}/${enc(p)}`;
  const md = textOf(await get(raw(skillMd), deps, ["text/"], FILE_BYTES));
  const files: SkillFile[] = [];
  for (const p of wanted.sort()) files.push({ path: rel(p), content: textOf(await get(raw(p), deps, ["text/"], FILE_BYTES)) });
  return { skillMd: md, files };
}

export async function fetchSkill(rawUrl: string, deps: ImportDeps = {}): Promise<FetchedSkill> {
  const l = parseSkillLink(rawUrl);
  if (l.kind === "file") {
    const md = textOf(await get(l.url, deps, ["text/", "application/octet-stream"], FILE_BYTES));
    return { url: l.url, skillMd: md, files: [] };
  }
  const got = await fetchFolder(l, deps);
  return { url: rawUrl.trim(), ...got };
}

// ---- Reading what came back

// The sha256 (64 hex) of SKILL.md as fetched and every file, path and bytes: what the owner saw.
export function sourceHash(f: { skillMd: string; files: SkillFile[] }): string {
  const h = createHash("sha256");
  h.update("SKILL.md\0");
  h.update(f.skillMd);
  for (const x of [...f.files].sort((a, b) => a.path.localeCompare(b.path))) {
    h.update("\0");
    h.update(x.path);
    h.update("\0");
    h.update(x.content);
  }
  return h.digest("hex");
}

// SKILL.md's frontmatter gives the name and the description; it may not grant tools or carry hooks.
export function readSkillMd(f: { skillMd: string; files: SkillFile[] }): SkillContent {
  const md = f.skillMd;
  if (!md.startsWith("---\n")) throw format("frontmatter");
  const end = md.indexOf("\n---", 4);
  if (end < 0) throw format("frontmatter");
  const head = md.slice(4, end);
  if (/^\s*(allowed-tools|hooks)\s*:/im.test(head)) throw notAllowed("frontmatter", "no hooks or allowed-tools: a skill is text");
  if (/!\x60[^\x60\n]+\x60/.test(head)) throw notAllowed("frontmatter", "no command run when the skill loads");
  const { fields, body } = frontmatter(md);
  if (!fields.name?.trim() || !fields.description?.trim()) throw format("frontmatter");
  return validateSkill({ name: fields.name, description: fields.description, body, files: f.files });
}

export type ImportPreview = {
  url: string;
  source_hash: string;
  slug: string;
  name: string;
  description: string;
  body: string;
  // Every file as fetched: SKILL.md first (with its frontmatter), then the supporting files.
  files: SkillFile[];
  taken: boolean;
};

async function slugTaken(db: Db, slug: string): Promise<boolean> {
  return !!(await liveBySlug(db, slug)) || (await listPacks(db)).some((p) => p.slug === slug);
}

const slugOf = (name: string) => {
  const s = packSlug(name);
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(s)) throw new ToolError("SKILL_INVALID", { field: "name", hint: "a name that starts with a letter" });
  return s;
};

export async function previewImport(db: Db, project: string, agent: string, url: string, deps: ImportDeps = {}): Promise<ImportPreview> {
  await seatOf(db, project, agent);
  const f = await fetchSkill(url, deps);
  const c = readSkillMd(f);
  const slug = slugOf(c.name);
  return {
    url: f.url,
    source_hash: sourceHash(f),
    slug,
    name: c.name,
    description: c.description,
    body: c.body,
    files: [{ path: "SKILL.md", content: f.skillMd }, ...f.files],
    taken: await slugTaken(db, slug),
  };
}

// Saved off, pinned to the hash the owner confirmed. Returns the slug.
export async function importSkill(db: Db, project: string, agent: string, input: { url: string; source_hash: string; scope?: SkillScope }, deps: ImportDeps = {}, now: Date = new Date()): Promise<string> {
  const a = await seatOf(db, project, agent);
  const f = await fetchSkill(input.url, deps);
  const c = readSkillMd(f);
  const hash = sourceHash(f);
  if (hash !== input.source_hash) throw new ToolError("SKILL_IMPORT_CHANGED", { source_hash: hash });
  const slug = slugOf(c.name);
  if (await slugTaken(db, slug)) throw new ToolError("SKILL_EXISTS", { slug });
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(skills)
      .values({ slug, origin: "imported", ...scopeTarget(input.scope ?? "agent", a), state: "off", createdBy: "owner", sourceUrl: f.url, sourceHash: hash, sourceCheckedAt: now })
      .returning();
    await addVersion(tx, row!, c, "link", `link:${hash.slice(0, 12)}`);
    return slug;
  });
}

export type UpdateCheck = {
  url: string;
  saved_hash: string;
  source_hash: string;
  changed: boolean;
  current: { name: string; description: string; body: string; files: SkillFile[] };
  fetched: { name: string; description: string; body: string; files: SkillFile[] };
};

async function importedRow(db: Db, slug: string) {
  const row = await liveBySlug(db, slug);
  if (!row) throw new ToolError("SKILL_NOT_FOUND", { skill: slug });
  if (row.origin !== "imported" || !row.sourceUrl || !row.sourceHash) throw new ToolError("SKILL_NOT_IMPORTED", { skill: slug });
  return row;
}

// Looks at the link again; writes nothing but the time it looked.
export async function checkUpdate(db: Db, project: string, agent: string, slug: string, deps: ImportDeps = {}, now: Date = new Date()): Promise<UpdateCheck> {
  await seatOf(db, project, agent);
  const row = await importedRow(db, slug);
  const f = await fetchSkill(row.sourceUrl!, deps);
  const c = readSkillMd(f);
  const hash = sourceHash(f);
  const v = (await versionsOf(db, row.id))[0]!;
  await db.update(skills).set({ sourceCheckedAt: now }).where(eq(skills.id, row.id));
  return {
    url: row.sourceUrl!,
    saved_hash: row.sourceHash!,
    source_hash: hash,
    changed: hash !== row.sourceHash,
    current: { name: v.name, description: v.description, body: v.body, files: v.files },
    fetched: { name: c.name, description: c.description, body: c.body, files: c.files },
  };
}

// The owner confirmed the diff for source_hash: that content becomes the newest version. The skill stays on or off.
export async function applyUpdate(db: Db, project: string, agent: string, slug: string, input: { source_hash: string }, deps: ImportDeps = {}, now: Date = new Date()): Promise<void> {
  await seatOf(db, project, agent);
  const row = await importedRow(db, slug);
  const f = await fetchSkill(row.sourceUrl!, deps);
  const c = readSkillMd(f);
  const hash = sourceHash(f);
  if (hash !== input.source_hash) throw new ToolError("SKILL_IMPORT_CHANGED", { source_hash: hash });
  await db.transaction(async (tx) => {
    const latest = (await versionsOf(tx, row.id))[0]!;
    if (!sameContent(latest, c)) await addVersion(tx, row, c, "link", `link:${hash.slice(0, 12)}`);
    await tx.update(skills).set({ sourceHash: hash, sourceCheckedAt: now, updatedAt: now }).where(eq(skills.id, row.id));
  });
}
