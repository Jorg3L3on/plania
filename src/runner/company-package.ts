// PLA-I71-6: the whole company in a folder of readable text files, the open agent-companies layout (ADR 0007), the
// same one Paperclip reads:
//   COMPANY.md                     name, schema; a short body
//   teams/<project>/TEAM.md        the project's team: name, manager (its PO's agent slug)
//   agents/<agent>/AGENTS.md       name, title, team, role, reportsTo (an agent slug), skills (by slug); body: the manner
//   skills/<slug>/SKILL.md         the owner's and brought skills (factory ones go by name only)
//   plania.yaml                    Plania's sidecar: motors per agent, roles of the owner's own, and lessons and
//                                  references only when ticked; secrets by NAME (never a value)
// Never in it: a secret or its value, code, tasks, usage, or a path of this machine (free text passes through scrub).
// It travels as one plain tar (readable with any tool). Import reads the same layout (from the tar, or from a list of
// files), shows create / rename / skip per item (rename by default when a name is taken), and only then writes:
// everyone arrives paused; skills arrive off with their review; unknown fields are listed as ignored, not refused.
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import YAML from "yaml";
import type { Db } from "../db/client.js";
import { agents, companyTransfers, lessons, projects, puestos, skillVersions, skills, type TeamSpec } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { frontmatter } from "./kit.js";
import { listPacks } from "./packs.js";
import { addSeat } from "./puestos.js";
import { marksOf } from "./skill-import.js";
import { addVersion } from "./skills.js";
import { isTeamTemplate, teamOf, TEMPLATE_ROWS } from "./team.js";
import { roleKey, specOf } from "./teams.js";
import { scrub } from "../api/scoreboard.js";
import { defineWords, say } from "../words.js";

export type PackageFile = { path: string; content: string };
// The name a package with no COMPANY.md name gets (it becomes a project's title on import).
const PACKAGE_WORDS = defineWords({ es: { company: "Compañía" }, en: { company: "Company" } });
const SAFE = /^[a-z0-9][a-z0-9._-]{0,79}$/;

const fm = (fields: Record<string, unknown>, body = "") => `---\n${YAML.stringify(fields).trimEnd()}\n---\n${body ? `\n${body.trim()}\n` : ""}`;

export async function exportCompany(db: Db, opts: { lessons?: boolean; references?: boolean } = {}, env: NodeJS.ProcessEnv = process.env): Promise<PackageFile[]> {
  const files: PackageFile[] = [];
  const projs = (await db.select().from(projects).orderBy(projects.slug)).filter((p) => SAFE.test(p.slug));
  files.push({ path: "COMPANY.md", content: fm({ name: "Plania", schema: "agentcompanies/v1", teams: projs.length }, "Agent teams exported from Plania. Plain text you can read and compare.") });
  const sidecar: { version: number; motors: Record<string, { model: string | null; effort: string | null }>; puestos: { slug: string; title: string; line: string; base: string }[]; lessons?: Record<string, string[]>; references?: Record<string, { title: string; url: string }[]>; secrets: string[] } = { version: 1, motors: {}, puestos: [], secrets: [] };
  const carried = new Set<string>();
  for (const p of projs) {
    const team = await teamOf(db, p.id);
    if (!team.length) continue;
    const spec = await specOf(db, p.slug, opts, env);
    const po = team.find((a) => a.roleTemplate === "product-owner");
    files.push({ path: `teams/${p.slug}/TEAM.md`, content: fm({ name: p.title || p.slug, slug: p.slug, manager: po?.slug ?? null }) });
    const byId = new Map(team.map((a) => [a.id, a]));
    team.forEach((a, i) => {
      const s = spec.seats[i]!;
      s.skills.forEach((k) => carried.add(k));
      files.push({
        path: `agents/${a.slug}/AGENTS.md`,
        content: fm({ name: a.name, title: s.title ?? TEMPLATE_ROWS[a.roleTemplate as keyof typeof TEMPLATE_ROWS]?.title ?? a.title, team: p.slug, role: roleKey(a), reportsTo: a.reportsTo && byId.has(a.reportsTo) ? byId.get(a.reportsTo)!.slug : null, skills: s.skills }, s.manner ?? ""),
      });
      if (s.motor) sidecar.motors[a.slug] = s.motor;
      if (opts.lessons) for (const l of spec.lessons?.filter((x) => x.role === s.role) ?? []) (sidecar.lessons ??= {})[a.slug] = [...(sidecar.lessons[a.slug] ?? []), l.text];
      if (opts.references) for (const r of spec.references?.filter((x) => x.role === s.role) ?? []) (sidecar.references ??= {})[a.slug] = [...(sidecar.references[a.slug] ?? []), { title: r.title, url: r.url }];
    });
    // Keys by name only: the variables the seats' adapters read.
    for (const a of team) for (const v of Object.values(a.adapterConfig ?? {})) if (typeof v === "string" && /^[A-Z][A-Z0-9_]{2,}$/.test(v)) sidecar.secrets.push(v);
  }
  sidecar.secrets = [...new Set(sidecar.secrets)].sort();
  sidecar.puestos = (await db.select().from(puestos)).filter((x) => x.origin === "owner").map((x) => ({ slug: x.slug, title: x.title, line: x.line, base: x.promptRef }));
  const factory = new Set((await listPacks(db, env)).map((x) => x.slug));
  const owned = await db.select().from(skills).where(sql`${skills.state} <> 'archived'`);
  for (const s of owned.filter((x) => carried.has(x.slug) || !factory.has(x.slug))) {
    const [v] = await db.select().from(skillVersions).where(eq(skillVersions.skillId, s.id)).orderBy(sql`${skillVersions.n} desc`).limit(1);
    if (!v || !SAFE.test(s.slug)) continue;
    files.push({ path: `skills/${s.slug}/SKILL.md`, content: fm({ name: v.name, description: v.description, ...(s.origin === "imported" && s.sourceUrl ? { source: s.sourceUrl, pin: s.sourceCommit ?? s.sourceHash } : {}) }, scrub(v.body, 50_000) ?? "") });
  }
  files.push({ path: "plania.yaml", content: YAML.stringify(sidecar) });
  await db.insert(companyTransfers).values({ direction: "export", state: "done", manifest: { files: files.map((f) => f.path) }, counts: { files: files.length, teams: files.filter((f) => f.path.endsWith("TEAM.md")).length, agents: files.filter((f) => f.path.endsWith("AGENTS.md")).length } });
  return files;
}

// ---- a plain tar (ustar), so the package is one file any tool opens

const pad = (n: number, len: number) => n.toString(8).padStart(len - 1, "0") + "\0";
export function tarOf(files: PackageFile[], root = "compania"): Buffer {
  const out: Buffer[] = [];
  const now = Math.floor(Date.now() / 1000);
  for (const f of files) {
    const name = `${root}/${f.path}`;
    const body = Buffer.from(f.content, "utf8");
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 100), 0, "utf8");
    h.write(pad(0o644, 8), 100);
    h.write(pad(0, 8), 108);
    h.write(pad(0, 8), 116);
    h.write(pad(body.length, 12), 124);
    h.write(pad(now, 12), 136);
    h.write("        ", 148);
    h.write("0", 156);
    h.write("ustar\0", 257);
    h.write("00", 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(pad(sum, 7) + " ", 148);
    out.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  out.push(Buffer.alloc(1024));
  return Buffer.concat(out);
}

export function untar(buf: Buffer): PackageFile[] {
  const files: PackageFile[] = [];
  for (let off = 0; off + 512 <= buf.length; ) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.toString("utf8", 0, 100).replace(/\0.*$/s, "");
    const prefix = h.toString("utf8", 345, 500).replace(/\0.*$/s, "");
    const size = parseInt(h.toString("utf8", 124, 136).replace(/\0.*$/s, "").trim() || "0", 8);
    const type = h.toString("utf8", 156, 157);
    off += 512;
    if ((type === "0" || type === "\0" || type === "") && size >= 0) files.push({ path: (prefix ? `${prefix}/${name}` : name).replace(/^[^/]+\//, ""), content: buf.toString("utf8", off, off + size) });
    off += Math.ceil(size / 512) * 512;
    if (files.length > 2000) throw new ToolError("SKILL_IMPORT_FORMAT", { reason: "too_many_files" });
  }
  return files;
}

// ---- reading the layout

type Parsed = {
  company: string;
  teams: { slug: string; name: string; manager: string | null }[];
  agents: { slug: string; name: string; title: string; team: string | null; role: string; reportsTo: string | null; skills: string[]; manner: string }[];
  skills: { slug: string; name: string; description: string; body: string; source: string | null }[];
  sidecar: { motors: Record<string, { model: string | null; effort: string | null }>; puestos: { slug: string; title: string; line: string; base: string }[]; lessons: Record<string, string[]>; secrets: string[] };
  ignored: string[];
};
const KNOWN_AGENT = new Set(["name", "title", "team", "role", "reportsTo", "skills"]);
const KNOWN_TEAM = new Set(["name", "slug", "manager"]);
const slugish = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
/** A role from a title another tool wrote (Paperclip's «CTO», «Designer»…): the nearest factory role, else a role of
 *  the owner's own named by its slug. */
export function roleFrom(fields: Record<string, string>, fallback: string): string {
  const r = (fields.role ?? "").trim();
  if (r && (isTeamTemplate(r) || /^[a-z][a-z0-9-]{0,39}$/.test(r))) return r;
  const t = `${fields.title ?? ""} ${fields.name ?? ""}`.toLowerCase();
  if (/product|\bpo\b|ceo|manager|lead/.test(t)) return "product-owner";
  if (/research|investig/.test(t)) return "research";
  if (/design|artist|ux|ui\b/.test(t)) return "artist";
  if (/qa|test|quality/.test(t)) return "qa";
  if (/secur|segur/.test(t)) return "seguridad";
  if (/market/.test(t)) return "marketing";
  if (/copy|writ|escrit/.test(t)) return "copy";
  if (/data|analy/.test(t)) return "data";
  if (/engineer|develop|cto|build|taller|code/.test(t)) return "taller";
  return slugish(fields.title || fields.name || fallback) || "taller";
}

/** Frontmatter read as YAML (lists and null stay what they are); a field that is not text, a list or null is kept as text. */
function yfm(content: string): { fields: Record<string, unknown>; body: string } {
  const text = content.replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return { fields: {}, body: text };
  const end = text.indexOf("\n---", 4);
  if (end < 0) return { fields: {}, body: text };
  let fields: Record<string, unknown> = {};
  try {
    const y = YAML.parse(text.slice(4, end));
    fields = y && typeof y === "object" && !Array.isArray(y) ? (y as Record<string, unknown>) : {};
  } catch {
    fields = frontmatter(text).fields;
  }
  return { fields, body: text.slice(text.indexOf("\n", end + 4) + 1).replace(/^\n+/, "") };
}
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export function parsePackage(files: PackageFile[]): Parsed {
  const ignored: string[] = [];
  const by = (re: RegExp) => files.filter((f) => re.test(f.path));
  const company = (() => {
    const c = files.find((f) => /(^|\/)COMPANY\.md$/i.test(f.path));
    return (c && str(yfm(c.content).fields.name)) || say(PACKAGE_WORDS).company;
  })();
  const teams = by(/(^|\/)teams\/[^/]+\/TEAM\.md$/i).map((f) => {
    const { fields } = yfm(f.content);
    for (const k of Object.keys(fields)) if (!KNOWN_TEAM.has(k)) ignored.push(`${f.path}: ${k}`);
    const dir = f.path.split("/").at(-2)!;
    return { slug: slugish(str(fields.slug) || dir) || "equipo", name: str(fields.name) || dir, manager: str(fields.manager) || null };
  });
  const agentsOut = by(/(^|\/)agents\/[^/]+\/AGENTS\.md$/i).map((f) => {
    const { fields, body } = yfm(f.content);
    for (const k of Object.keys(fields)) if (!KNOWN_AGENT.has(k)) ignored.push(`${f.path}: ${k}`);
    const dir = f.path.split("/").at(-2)!;
    const list = Array.isArray(fields.skills) ? (fields.skills as unknown[]).map(String) : [];
    // A team folder nesting its agents (teams/<t>/agents/<a>/AGENTS.md) names the team by its place.
    const nested = /(^|\/)teams\/([^/]+)\/agents\//i.exec(f.path)?.[2];
    const text = { role: str(fields.role), title: str(fields.title), name: str(fields.name) };
    return { slug: slugish(dir) || "agente", name: text.name || dir, title: text.title || text.name || dir, team: str(fields.team) || nested || null, role: roleFrom(text, dir), reportsTo: str(fields.reportsTo) || null, skills: list.filter((x) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(x)), manner: body.trim() };
  });
  const skillsOut = by(/(^|\/)skills\/[^/]+\/SKILL\.md$/i).map((f) => {
    const { fields, body } = yfm(f.content);
    return { slug: slugish(f.path.split("/").at(-2)!) || "habilidad", name: str(fields.name) || f.path.split("/").at(-2)!, description: str(fields.description), body, source: str(fields.source) || null };
  });
  // A team with no PO (another tool's): its manager, else its top agent, is the PO here.
  const teamKeys = new Set(agentsOut.map((a) => a.team));
  for (const key of teamKeys) {
    const members = agentsOut.filter((a) => a.team === key);
    if (members.some((a) => a.role === "product-owner")) continue;
    const manager = teams.find((t) => t.slug === key)?.manager;
    const top = members.find((a) => manager && a.slug === slugish(manager)) ?? members.find((a) => !a.reportsTo || !members.some((b) => b.slug === slugish(a.reportsTo!)));
    if (top) top.role = "product-owner";
  }
  const side = files.find((f) => /(^|\/)(plania\.yaml|\.paperclip\.yaml)$/i.test(f.path));
  const y = (side ? (YAML.parse(side.content) as Record<string, unknown> | null) : null) ?? {};
  for (const k of Object.keys(y)) if (!["version", "motors", "puestos", "lessons", "references", "secrets"].includes(k)) ignored.push(`${side!.path}: ${k}`);
  return {
    company,
    teams,
    agents: agentsOut,
    skills: skillsOut,
    sidecar: { motors: (y.motors as Parsed["sidecar"]["motors"]) ?? {}, puestos: (y.puestos as Parsed["sidecar"]["puestos"]) ?? [], lessons: (y.lessons as Parsed["sidecar"]["lessons"]) ?? {}, secrets: ((y.secrets as string[]) ?? []).filter((s) => /^[A-Z][A-Z0-9_]{2,}$/.test(s)) },
    ignored,
  };
}

// ---- import: the preview (no writes), then the chosen actions

export type ImportAction = "create" | "rename" | "skip";
export type ImportItem = { key: string; kind: "team" | "skill"; name: string; action: ImportAction; to: string; taken: boolean; agents?: number; marks?: number };
export type ImportPreview = { company: string; items: ImportItem[]; agents: number; ignored: string[]; secrets: string[] };

async function freeSlug(db: Db, table: "projects" | "skills", base: string): Promise<string> {
  for (let n = 2; n < 100; n++) {
    const s = `${base.slice(0, 34)}-${n}`;
    const taken = table === "projects" ? (await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, s)).limit(1)).length : (await db.select({ id: skills.id }).from(skills).where(and(eq(skills.slug, s), sql`${skills.state} <> 'archived'`)).limit(1)).length;
    if (!taken) return s;
  }
  throw new ToolError("SEAT_TAKEN", { name: base });
}

export async function previewCompany(db: Db, files: PackageFile[], env: NodeJS.ProcessEnv = process.env): Promise<ImportPreview> {
  const pk = parsePackage(files);
  const items: ImportItem[] = [];
  const teamsSeen = pk.teams.length ? pk.teams : [{ slug: slugish(pk.company) || "equipo", name: pk.company, manager: null }];
  for (const t of teamsSeen) {
    const taken = !!(await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, t.slug)).limit(1)).length;
    const n = pk.agents.filter((a) => (a.team ?? teamsSeen[0]!.slug) === t.slug).length;
    items.push({ key: `team:${t.slug}`, kind: "team", name: t.name, action: taken ? "rename" : "create", to: taken ? await freeSlug(db, "projects", t.slug) : t.slug, taken, agents: n });
  }
  const factory = new Set((await listPacks(db, env)).map((x) => x.slug));
  for (const s of pk.skills) {
    if (factory.has(s.slug)) continue;
    const taken = !!(await db.select({ id: skills.id }).from(skills).where(and(eq(skills.slug, s.slug), sql`${skills.state} <> 'archived'`)).limit(1)).length;
    items.push({ key: `skill:${s.slug}`, kind: "skill", name: s.name, action: taken ? "rename" : "create", to: taken ? await freeSlug(db, "skills", s.slug) : s.slug, taken, marks: marksOf({ skillMd: s.body, files: [] }).length });
  }
  await db.insert(companyTransfers).values({ direction: "import", state: "previewed", manifest: { items, ignored: pk.ignored }, counts: { items: items.length } });
  return { company: pk.company, items, agents: pk.agents.length, ignored: pk.ignored, secrets: pk.sidecar.secrets };
}

/** Writes what the preview listed, with the owner's actions (rename is the default for a taken name). */
export async function applyCompany(db: Db, files: PackageFile[], choices: Record<string, ImportAction> = {}, env: NodeJS.ProcessEnv = process.env): Promise<{ created: string[]; renamed: string[]; skipped: string[]; agents: string[] }> {
  const pk = parsePackage(files);
  const pv = await previewCompany(db, files, env);
  const out = { created: [] as string[], renamed: [] as string[], skipped: [] as string[], agents: [] as string[] };
  const act = (it: ImportItem): ImportAction => (it.taken && choices[it.key] === "create" ? "rename" : (choices[it.key] ?? it.action));
  // Roles of the owner's own.
  for (const r of pk.sidecar.puestos) if (/^[a-z][a-z0-9-]{0,39}$/.test(r.slug) && isTeamTemplate(r.base)) await db.insert(puestos).values({ slug: r.slug, title: r.title.slice(0, 60), line: (r.line ?? "").slice(0, 200), origin: "owner", promptRef: r.base }).onConflictDoNothing();
  // Skills: arrive off, with the same review a brought skill gets.
  const skillTo = new Map<string, string>();
  for (const it of pv.items.filter((x) => x.kind === "skill")) {
    const a = act(it);
    const s = pk.skills.find((x) => `skill:${x.slug}` === it.key)!;
    if (a === "skip") {
      out.skipped.push(it.key);
      continue;
    }
    const slug = a === "rename" ? it.to : s.slug;
    const marks = marksOf({ skillMd: s.body, files: [] });
    const hash = createHash("sha256").update(s.body).digest("hex");
    const [row] = await db
      .insert(skills)
      .values({ slug, origin: s.source ? "imported" : "owner", scope: "company", state: "off", createdBy: "owner", sourceUrl: s.source, sourceHash: s.source ? hash : null, sourceKind: s.source ? "link" : null, review: { words: s.body.split(/\s+/).filter(Boolean).length, dropped: [], marks, pinned: hash } })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      out.skipped.push(it.key);
      continue;
    }
    await addVersion(db, row, { name: s.name.slice(0, 80), description: s.description.slice(0, 400), body: s.body, files: [] }, "owner", "import");
    skillTo.set(s.slug, slug);
    (a === "rename" ? out.renamed : out.created).push(`${it.key}→${slug}`);
  }
  const factory = new Set((await listPacks(db, env)).map((x) => x.slug));
  const teamsSeen = pk.teams.length ? pk.teams : [{ slug: slugish(pk.company) || "equipo", name: pk.company, manager: null }];
  for (const it of pv.items.filter((x) => x.kind === "team")) {
    const a = act(it);
    const t = teamsSeen.find((x) => `team:${x.slug}` === it.key)!;
    if (a === "skip") {
      out.skipped.push(it.key);
      continue;
    }
    const slug = a === "rename" ? it.to : t.slug;
    const prefix = (slug.replace(/[^a-z]/g, "").slice(0, 3) || "IMP").toUpperCase();
    const [p] = await db.insert(projects).values({ slug, title: t.name.slice(0, 80), keyPrefix: prefix } as never).onConflictDoNothing().returning();
    if (!p) {
      out.skipped.push(it.key);
      continue;
    }
    (a === "rename" ? out.renamed : out.created).push(`${it.key}→${slug}`);
    const members = pk.agents.filter((x) => (x.team ?? teamsSeen[0]!.slug) === t.slug);
    // The PO first, so the others can report to it.
    members.sort((x, y) => Number(y.role === "product-owner") - Number(x.role === "product-owner"));
    const made = new Map<string, string>();
    for (const m of members.slice(0, 8)) {
      const role = isTeamTemplate(m.role) ? m.role : (await db.select().from(puestos).where(eq(puestos.slug, m.role)).limit(1))[0] ? m.role : await ownRole(db, m);
      let seat;
      try {
        seat = await addSeat(db, slug, role, { paused: true });
      } catch (e) {
        if (e instanceof ToolError) continue;
        throw e;
      }
      made.set(m.slug, seat.id);
      const motor = pk.sidecar.motors[m.slug];
      const packs = m.skills.map((x) => skillTo.get(x) ?? x).filter((x) => factory.has(x)).slice(0, 10);
      await db.update(agents).set({ skillPacks: packs, motorModel: motor?.model ?? null, motorEffort: motor?.effort ?? null, manner: m.manner ? scrub(m.manner, 2000) : seat.manner, updatedAt: new Date() }).where(eq(agents.id, seat.id));
      for (const text of pk.sidecar.lessons[m.slug] ?? []) await db.insert(lessons).values({ projectId: p.id, agentId: seat.id, scope: "agent", text: text.slice(0, 600), state: "active", proposedBy: "owner" });
      out.agents.push(seat.slug);
    }
    for (const m of members) {
      const id = made.get(m.slug);
      const boss = m.reportsTo ? made.get(slugish(m.reportsTo)) : null;
      if (id && boss && boss !== id) await db.update(agents).set({ reportsTo: boss }).where(eq(agents.id, id));
    }
  }
  await db.insert(companyTransfers).values({ direction: "import", state: "done", manifest: { ...out, ignored: pk.ignored }, counts: { created: out.created.length, renamed: out.renamed.length, skipped: out.skipped.length, agents: out.agents.length } });
  return out;
}

async function ownRole(db: Db, m: Parsed["agents"][number]): Promise<string> {
  const slug = (m.role && /^[a-z]/.test(m.role) ? m.role : `p-${m.role}`).slice(0, 40);
  await db.insert(puestos).values({ slug, title: m.title.slice(0, 60), line: "", origin: "owner", promptRef: "taller" }).onConflictDoNothing();
  return slug;
}

/** A team in the open layout (one TEAM.md and its agents) read into a template spec. */
export function teamSpecOf(files: PackageFile[]): { name: string; spec: TeamSpec; ignored: string[] } {
  const pk = parsePackage(files);
  const t = pk.teams[0] ?? { slug: "equipo", name: pk.company, manager: null };
  const members = pk.agents.filter((a) => !a.team || a.team === t.slug);
  const roleOfSlug = new Map(members.map((a) => [a.slug, a.role]));
  return {
    name: t.name,
    ignored: pk.ignored,
    spec: {
      seats: members.slice(0, 8).map((a) => ({ role: a.role, ...(isTeamTemplate(a.role) ? {} : { title: a.title, base: "taller" }), reports_to: a.reportsTo ? (roleOfSlug.get(slugish(a.reportsTo)) ?? null) : null, skills: a.skills, motor: pk.sidecar.motors[a.slug] ?? null, manner: a.manner || null })),
      ...(pk.skills.length ? { skills: pk.skills.map((s) => ({ slug: s.slug, name: s.name, description: s.description, body: s.body })) } : {}),
    },
  };
}
