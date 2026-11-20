// PLA-I67-2: skills the owner writes on screen, and «tu manera». ADR 0006.
// The factory kit stays in git (kit/skills, kit/kits.json, Pack: docs; src/runner/kit.ts, packs.ts). What the owner
// writes lives in the skills and skill_versions tables (migration 0068): a version is never updated, the newest one is
// what runs carry, and a roll back writes a new version with an older content. Editing a factory skill makes an owner
// copy (origin factory-copy, version 1 = the factory content, factory_sha = its kit version) and the kit file is never
// touched; the card says when the factory one has changed since.
//
// Who carries an owner skill is its scope: company (every agent), seat (every agent of that role, in every project),
// project (every agent of that project) or agent (that one agent). One deterministic list per agent (resolvedKit):
// the seat's factory list (packsOf) in its order, an owner copy in place of the factory skill it copies (on: the copy;
// off: neither), then every other owner skill in scope that is on, by slug. Above SKILLS_WARN the screen warns.
//
// A skill is text: SKILL.md (Plania writes the frontmatter: name = slug, description) and optional .md/.txt files.
// Scripts, executable files, hooks, allowed-tools and commands run at load time (!`…`) are refused (SKILL_NOT_ALLOWED);
// anything else off the format is SKILL_INVALID. A running run keeps the plugin it was started with.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agents, projects, skillVersions, skills, type Agent, type OwnerSkillRow, type SkillFile, type SkillScope, type SkillVersionRow } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import type { Q } from "../mcp/tx.js";
import { frontmatter } from "./kit.js";
import { roleOf } from "./limits.js";
import { listPacks, packSlug, packsOf, type Pack } from "./packs.js";

export const SKILLS_WARN = 6;
export const ARCHIVE_DAYS = 30;
export const MANNER_MAX = 2000;
export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 1024;
export const BODY_MAX_LINES = 500;
export const BODY_MAX_CHARS = 40_000;
export const FILES_MAX = 10;
export const FILE_MAX_CHARS = 40_000;
const SLUG = /^[a-z][a-z0-9-]{0,39}$/;
const FILE_PATH = /^[a-z0-9][a-z0-9._-]{0,60}(\/[a-z0-9][a-z0-9._-]{0,60}){0,2}$/i;
const TEXT_EXT = /\.(md|txt)$/i;
const FORBIDDEN_KEYS = /^\s*(allowed-tools|hooks)\s*:/im;
// Claude runs `!`command`` in a skill when it loads; a skill here is text only.
const LOAD_COMMAND = /!\x60[^\x60\n]+\x60/;

export type SkillInput = { name: string; description: string; body: string; files?: SkillFile[] };
export type SkillContent = { name: string; description: string; body: string; files: SkillFile[] };

const bad = (field: string, hint: string) => new ToolError("SKILL_INVALID", { field, hint });
const notAllowed = (field: string, hint: string) => new ToolError("SKILL_NOT_ALLOWED", { field, hint });

// Throws SKILL_NOT_ALLOWED or SKILL_INVALID; returns the content trimmed the way it is stored.
export function validateSkill(input: SkillInput): SkillContent {
  const name = (input.name ?? "").replace(/\s+/g, " ").trim();
  const description = (input.description ?? "").replace(/\s+/g, " ").trim();
  const body = (input.body ?? "").replace(/\r\n/g, "\n").trim();
  const files = input.files ?? [];
  // What is not text is refused first, whatever else is wrong.
  if (FORBIDDEN_KEYS.test(body) || FORBIDDEN_KEYS.test(description)) return fail(notAllowed("body", "no hooks or allowed-tools: a skill is text"));
  if (LOAD_COMMAND.test(body)) return fail(notAllowed("body", "no command run when the skill loads"));
  for (const f of files) {
    if (!TEXT_EXT.test(f.path ?? "")) return fail(notAllowed("files", `only .md and .txt files: ${String(f.path).slice(0, 80)}`));
    if (/^#!/.test(f.content ?? "") || FORBIDDEN_KEYS.test(f.content ?? "") || LOAD_COMMAND.test(f.content ?? "")) return fail(notAllowed("files", `${f.path} is not plain text`));
  }
  if (!name || name.length > NAME_MAX) return fail(bad("name", `1 to ${NAME_MAX} characters`));
  if (!description || description.length > DESCRIPTION_MAX) return fail(bad("description", `1 to ${DESCRIPTION_MAX} characters`));
  if (/[<>]/.test(description)) return fail(bad("description", "no angle brackets"));
  if (!body || body.length > BODY_MAX_CHARS || body.split("\n").length > BODY_MAX_LINES) return fail(bad("body", `1 to ${BODY_MAX_LINES} lines`));
  if (body.startsWith("---\n")) return fail(bad("body", "Plania writes the frontmatter: send the body only"));
  if (files.length > FILES_MAX) return fail(bad("files", `at most ${FILES_MAX} files`));
  const seen = new Set<string>();
  for (const f of files) {
    if (!FILE_PATH.test(f.path) || f.path.split("/").includes("..") || f.path.toUpperCase() === "SKILL.MD" || seen.has(f.path)) return fail(bad("files", `bad path: ${f.path.slice(0, 80)}`));
    if ((f.content ?? "").length > FILE_MAX_CHARS) return fail(bad("files", `${f.path} is over ${FILE_MAX_CHARS} characters`));
    seen.add(f.path);
  }
  return { name, description, body, files: [...files].map((f) => ({ path: f.path, content: f.content.replace(/\r\n/g, "\n") })).sort((a, b) => a.path.localeCompare(b.path)) };
}
function fail(e: ToolError): never {
  throw e;
}

// SKILL.md as the run's plugin holds it: the same text writeKitPlugin writes for a skill without a folder.
export const renderSkillMd = (slug: string, description: string, body: string): string =>
  `---\nname: ${slug}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.endsWith("\n") ? body : `${body}\n`}`;

// The version hash: SKILL.md and every file, path and bytes. The run stamp is "slug@hash".
export function skillHash(slug: string, c: { description: string; body: string; files: SkillFile[] }): string {
  const h = createHash("sha256");
  h.update(renderSkillMd(slug, c.description, c.body));
  for (const f of [...c.files].sort((a, b) => a.path.localeCompare(b.path))) {
    h.update("\0");
    h.update(f.path);
    h.update("\0");
    h.update(f.content);
  }
  return h.digest("hex").slice(0, 8);
}

// ---- Scope

type SeatLike = { id: string; projectId: string | null; slug: string; role: string; capabilities: string[]; roleTemplate?: string | null };

export function inScope(s: Pick<OwnerSkillRow, "scope" | "role" | "projectId" | "agentId">, a: SeatLike): boolean {
  switch (s.scope) {
    case "company":
      return true;
    case "seat":
      return !!s.role && s.role === roleOf(a);
    case "project":
      return !!s.projectId && s.projectId === a.projectId;
    case "agent":
      return s.agentId === a.id;
  }
}

export function scopeTarget(scope: SkillScope, a: SeatLike): Pick<OwnerSkillRow, "scope" | "role" | "projectId" | "agentId"> {
  return {
    scope,
    role: scope === "seat" ? (roleOf(a) ?? a.role) : null,
    projectId: scope === "project" ? a.projectId : null,
    agentId: scope === "agent" ? a.id : null,
  };
}

// ---- Reads

export type OwnerSkill = { row: OwnerSkillRow; version: SkillVersionRow; versions: number };

async function withLatest(db: Db | Q, rows: OwnerSkillRow[]): Promise<OwnerSkill[]> {
  if (rows.length === 0) return [];
  const vs = await db
    .select()
    .from(skillVersions)
    .where(inArray(skillVersions.skillId, rows.map((r) => r.id)))
    .orderBy(desc(skillVersions.n));
  const out: OwnerSkill[] = [];
  for (const row of rows) {
    const mine = vs.filter((v) => v.skillId === row.id);
    if (mine[0]) out.push({ row, version: mine[0], versions: mine.length });
  }
  return out.sort((a, b) => a.row.slug.localeCompare(b.row.slug));
}

// Every live (not deleted) owner skill this agent is in scope of, on or off.
export async function ownerSkillsFor(db: Db | Q, a: SeatLike): Promise<OwnerSkill[]> {
  const rows = await db.select().from(skills).where(ne(skills.state, "archived"));
  return withLatest(db, rows.filter((r) => inScope(r, a)));
}

export type ResolvedSkill = Omit<Pack, "source"> & { source: "kit" | "doc" | "owner"; files?: SkillFile[]; skill_id?: string; n?: number };

export const ownerEntry = (o: OwnerSkill): ResolvedSkill => ({
  slug: o.row.slug,
  name: o.version.name,
  when: o.version.description,
  doc_id: null,
  // The body only: writeKitPlugin adds the frontmatter, so the plugin's SKILL.md is renderSkillMd's text.
  markdown: o.version.body,
  source: "owner",
  dir: null,
  sha: o.version.hash,
  files: o.version.files,
  skill_id: o.row.id,
  n: o.version.n,
});

// What the agent's next run carries, in order (see the top of the file).
export async function resolvedKit(db: Db | Q, a: Agent, env: NodeJS.ProcessEnv = process.env, role: string | null = roleOf(a)): Promise<ResolvedSkill[]> {
  const base = await packsOf(db, a, env, role);
  const mine = await ownerSkillsFor(db, a);
  const bySlug = new Map(mine.map((m) => [m.row.slug, m]));
  const done = new Set<string>();
  const out: ResolvedSkill[] = [];
  for (const p of base) {
    const m = bySlug.get(p.slug);
    if (!m) out.push(p);
    else if (m.row.state === "on") out.push(ownerEntry(m));
    done.add(p.slug);
  }
  for (const m of mine) if (!done.has(m.row.slug) && m.row.state === "on") out.push(ownerEntry(m));
  return out;
}

// ---- The seat a route names

export async function seatOf(db: Db | Q, project: string, agent: string): Promise<Agent> {
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, project)).limit(1);
  if (!p) throw new ToolError("PROJECT_NOT_FOUND");
  const [a] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.slug, agent), eq(agents.projectId, p.id)))
    .limit(1);
  if (!a || a.status === "retired") throw new ToolError("AGENT_NOT_FOUND", { agent });
  return a;
}

export const liveBySlug = async (db: Db | Q, slug: string): Promise<OwnerSkillRow | null> =>
  (await db.select().from(skills).where(and(eq(skills.slug, slug), ne(skills.state, "archived"))).limit(1))[0] ?? null;

export const versionsOf = (db: Db | Q, id: string) => db.select().from(skillVersions).where(eq(skillVersions.skillId, id)).orderBy(desc(skillVersions.n));

// ---- The card

export type SkillCardVersion = { n: number; hash: string; at: string; author: string; note: string | null; name: string; description: string; body: string };
export type SkillCard = {
  slug: string;
  name: string;
  when: string;
  body: string;
  files: SkillFile[];
  source: "owner" | "kit" | "doc";
  origin: OwnerSkillRow["origin"] | null;
  scope: SkillScope | null;
  state: OwnerSkillRow["state"] | null;
  on: boolean;
  version: string;
  n: number | null;
  versions: SkillCardVersion[];
  factory_changed: boolean;
  archived_at: string | null;
  carried: number;
  // PLA-I67-6: an imported skill's link, the hash of the content it is pinned to, and when the link was last read.
  link: { url: string; hash: string; checked_at: string | null } | null;
};

const factoryBody = (p: Pack): string => (p.source === "kit" ? frontmatter(p.markdown).body : p.markdown).trim();

export async function skillCard(db: Db, project: string, agent: string, slug: string, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): Promise<SkillCard> {
  const a = await seatOf(db, project, agent);
  const carried = await resolvedKit(db, a, env);
  const on = carried.some((c) => c.slug === slug);
  const row = (await liveBySlug(db, slug)) ?? (await archivedWithin(db, slug, now));
  const shelf = await listPacks(db, env);
  const factory = shelf.find((p) => p.slug === slug) ?? null;
  if (row) {
    const vs = await versionsOf(db, row.id);
    const v = vs[0]!;
    return {
      slug,
      name: v.name,
      when: v.description,
      body: v.body,
      files: v.files,
      source: "owner",
      origin: row.origin,
      scope: row.scope,
      state: row.state,
      on,
      version: `${slug}@${v.hash}`,
      n: v.n,
      versions: vs.map((x) => ({ n: x.n, hash: x.hash, at: x.createdAt.toISOString(), author: x.author, note: x.note, name: x.name, description: x.description, body: x.body })),
      factory_changed: row.origin === "factory-copy" && !!factory && !!row.factorySha && factory.sha !== row.factorySha,
      archived_at: row.archivedAt ? row.archivedAt.toISOString() : null,
      carried: carried.length,
      link: row.origin === "imported" && row.sourceUrl && row.sourceHash ? { url: row.sourceUrl, hash: row.sourceHash, checked_at: row.sourceCheckedAt ? row.sourceCheckedAt.toISOString() : null } : null,
    };
  }
  if (!factory) throw new ToolError("SKILL_NOT_FOUND", { skill: slug });
  return {
    slug,
    name: factory.name,
    when: factory.when,
    body: factoryBody(factory),
    files: [],
    source: factory.source,
    origin: null,
    scope: null,
    state: null,
    on,
    version: `${slug}@${factory.sha}`,
    n: null,
    versions: [],
    factory_changed: false,
    archived_at: null,
    carried: carried.length,
    link: null,
  };
}

async function archivedWithin(db: Db | Q, slug: string, now: Date): Promise<OwnerSkillRow | null> {
  const [row] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.slug, slug), eq(skills.state, "archived")))
    .orderBy(desc(skills.archivedAt))
    .limit(1);
  return row?.archivedAt && now.getTime() - row.archivedAt.getTime() < ARCHIVE_DAYS * 86_400_000 ? row : null;
}

// ---- Writes. Every one runs in a transaction; who is "owner" unless a caller says otherwise.

export async function addVersion(tx: Q, row: OwnerSkillRow, c: SkillContent, author: string, note: string | null): Promise<SkillVersionRow> {
  const [last] = await tx.select({ n: skillVersions.n }).from(skillVersions).where(eq(skillVersions.skillId, row.id)).orderBy(desc(skillVersions.n)).limit(1);
  const [v] = await tx
    .insert(skillVersions)
    .values({ skillId: row.id, n: (last?.n ?? 0) + 1, name: c.name, description: c.description, body: c.body, files: c.files, hash: skillHash(row.slug, c), author, note })
    .returning();
  await tx.update(skills).set({ updatedAt: new Date() }).where(eq(skills.id, row.id));
  return v!;
}

export const sameContent = (v: SkillVersionRow, c: SkillContent) => v.name === c.name && v.description === c.description && v.body === c.body && JSON.stringify(v.files) === JSON.stringify(c.files);

export type CreateSkill = SkillInput & { slug?: string; scope?: SkillScope };

export async function createSkill(db: Db, project: string, agent: string, input: CreateSkill, env: NodeJS.ProcessEnv = process.env, author = "owner"): Promise<string> {
  const a = await seatOf(db, project, agent);
  const c = validateSkill(input);
  const slug = input.slug ?? packSlug(c.name);
  if (!SLUG.test(slug)) throw bad("slug", "lowercase letters, digits and dashes, starting with a letter");
  if ((await liveBySlug(db, slug)) || (await listPacks(db, env)).some((p) => p.slug === slug)) throw new ToolError("SKILL_EXISTS", { slug });
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(skills)
      .values({ slug, origin: "owner", ...scopeTarget(input.scope ?? "agent", a), state: "on", createdBy: author })
      .returning();
    await addVersion(tx, row!, c, author, null);
    return slug;
  });
}

export type EditSkill = Partial<SkillInput> & { scope?: SkillScope };

// A new version when the content changed; the scope changes in place. A factory skill gets an owner copy first.
export async function editSkill(db: Db, project: string, agent: string, slug: string, input: EditSkill, env: NodeJS.ProcessEnv = process.env, author = "owner"): Promise<void> {
  const a = await seatOf(db, project, agent);
  let row = await liveBySlug(db, slug);
  await db.transaction(async (tx) => {
    let latest: SkillVersionRow | undefined;
    if (!row) {
      const factory = (await listPacks(tx, env)).find((p) => p.slug === slug);
      if (!factory) throw new ToolError("SKILL_NOT_FOUND", { skill: slug });
      // The factory content becomes version 1, so the diff shows exactly what the owner changed.
      const files = factory.dir ? factoryFiles(factory.dir) : [];
      const base = validateSkill({ name: factory.name, description: factory.when, body: factoryBody(factory), files });
      const inserted = await tx
        .insert(skills)
        .values({ slug, origin: "factory-copy", ...scopeTarget(input.scope ?? "agent", a), state: "on", factorySha: factory.sha, createdBy: author })
        .returning();
      row = inserted[0]!;
      latest = await addVersion(tx, row!, base, "factory", "factory");
    } else {
      latest = (await versionsOf(tx, row.id))[0];
      if (input.scope && input.scope !== row.scope) await tx.update(skills).set({ ...scopeTarget(input.scope, a), updatedAt: new Date() }).where(eq(skills.id, row.id));
    }
    const next = validateSkill({
      name: input.name ?? latest!.name,
      description: input.description ?? latest!.description,
      body: input.body ?? latest!.body,
      files: input.files ?? latest!.files,
    });
    if (!sameContent(latest!, next)) await addVersion(tx, row!, next, author, null);
  });
}

// Roll back: version n's content becomes the newest version (history stays whole).
export async function rollbackSkill(db: Db, slug: string, n: number, author = "owner"): Promise<void> {
  const row = await liveBySlug(db, slug);
  if (!row) throw new ToolError("SKILL_NOT_FOUND", { skill: slug });
  const vs = await versionsOf(db, row.id);
  const target = vs.find((v) => v.n === n);
  if (!target) throw new ToolError("SKILL_NOT_FOUND", { skill: slug, version: n });
  if (vs[0]!.n === n) return;
  await db.transaction(async (tx) => {
    await addVersion(tx, row, { name: target.name, description: target.description, body: target.body, files: target.files }, author, "rollback:" + n);
  });
}

export async function duplicateSkill(db: Db, project: string, agent: string, slug: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const card = await skillCard(db, project, agent, slug, env);
  const taken = new Set([...(await listPacks(db, env)).map((p) => p.slug), ...(await db.select({ slug: skills.slug }).from(skills).where(ne(skills.state, "archived"))).map((r) => r.slug)]);
  let n = 2;
  const stem = slug.slice(0, 36).replace(/-+$/, "");
  while (taken.has(stem + "-" + n)) n += 1;
  const name = card.name + " (" + n + ")";
  return createSkill(db, project, agent, { slug: stem + "-" + n, name, description: card.when, body: card.body, files: card.files, scope: card.scope ?? "agent" }, env);
}

export async function setSkillState(db: Db, slug: string, on: boolean): Promise<void> {
  const row = await liveBySlug(db, slug);
  if (!row) throw new ToolError("SKILL_NOT_FOUND", { skill: slug });
  await db.update(skills).set({ state: on ? "on" : "off", updatedAt: new Date() }).where(eq(skills.id, row.id));
}

// Delete: archived, out of every run at once, back with restoreSkill for ARCHIVE_DAYS.
export async function archiveSkill(db: Db, slug: string, now: Date = new Date()): Promise<void> {
  const row = await liveBySlug(db, slug);
  if (!row) throw new ToolError("SKILL_NOT_FOUND", { skill: slug });
  await db.update(skills).set({ state: "archived", archivedAt: now, updatedAt: now }).where(eq(skills.id, row.id));
}

export async function restoreSkill(db: Db, slug: string, now: Date = new Date()): Promise<void> {
  if (await liveBySlug(db, slug)) throw new ToolError("SKILL_EXISTS", { slug });
  const row = await archivedWithin(db, slug, now);
  if (!row) throw new ToolError("SKILL_NOT_FOUND", { skill: slug });
  await db.update(skills).set({ state: "on", archivedAt: null, updatedAt: now }).where(eq(skills.id, row.id));
}

// Deleted skills still in their 30 days, for the shelf's «Borradas».
export async function archivedSkills(db: Db, a: SeatLike, now: Date = new Date()): Promise<{ slug: string; name: string; archived_at: string }[]> {
  const rows = (await db.select().from(skills).where(eq(skills.state, "archived"))).filter((r) => r.archivedAt && now.getTime() - r.archivedAt.getTime() < ARCHIVE_DAYS * 86_400_000 && inScope(r, a));
  return (await withLatest(db, rows)).map((o) => ({ slug: o.row.slug, name: o.version.name, archived_at: o.row.archivedAt!.toISOString() }));
}

// ---- The kit folder's supporting text files, for a factory copy

function factoryFiles(dir: string): SkillFile[] {
  const out: SkillFile[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = path.join(d, name);
      const rel = path.relative(dir, full).split(path.sep).join("/");
      if (statSync(full).isDirectory()) walk(full);
      else if (rel !== "SKILL.md" && TEXT_EXT.test(rel) && FILE_PATH.test(rel) && out.length < FILES_MAX) out.push({ path: rel, content: readFileSync(full, "utf8").replace(/\r\n/g, "\n") });
    }
  };
  walk(dir);
  return out;
}

// ---- «Tu manera»

export const mannerVersion = (text: string | null | undefined): string | null => (text?.trim() ? createHash("sha256").update(text.trim()).digest("hex").slice(0, 8) : null);

// Appended after the role prompt (and the project's context) on a fresh session.
export const mannerBlock = (text: string | null | undefined): string | null =>
  text?.trim() ? `# Your owner's way for this seat\n\nThe owner wrote this for you. Follow it unless a rule above forbids it.\n\n${text.trim()}` : null;

export async function setManner(db: Db, project: string, agent: string, text: string | null, now: Date = new Date()): Promise<{ manner: string | null; version: string | null }> {
  const a = await seatOf(db, project, agent);
  const clean = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (clean.length > MANNER_MAX) throw new ToolError("TOO_LARGE", { field: "manner", max: MANNER_MAX });
  if (FORBIDDEN_KEYS.test(clean) || LOAD_COMMAND.test(clean)) throw notAllowed("manner", "text only");
  await db.update(agents).set({ manner: clean || null, mannerUpdatedAt: now }).where(eq(agents.id, a.id));
  return { manner: clean || null, version: mannerVersion(clean) };
}

export type Puesto = { project: string; agent: string; role: string; manner: string | null; manner_version: string | null; manner_at: string | null; motor: { model: string | null; effort: string | null } };

export async function puestoRead(db: Db, project: string, agent: string): Promise<Puesto> {
  const a = await seatOf(db, project, agent);
  return {
    project,
    agent: a.slug,
    role: roleOf(a) ?? a.role,
    manner: a.manner ?? null,
    manner_version: mannerVersion(a.manner),
    manner_at: a.mannerUpdatedAt ? a.mannerUpdatedAt.toISOString() : null,
    motor: { model: a.motorModel ?? null, effort: a.motorEffort ?? null },
  };
}
