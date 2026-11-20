// PLA-I46-12: skill packs. A pack is a project doc in Plania titled `Pack: <name>` (in the prompts project,
// PLANIA_PROMPTS_PROJECT, default plania) whose markdown has one line `Cuándo: <when to use it>` and a short
// body. A role on a project (an agents row) carries a list of pack slugs in agents.skill_packs.
// The runner sends each carried pack's one line in the run prompt, and writes the body into the run's
// working folder under PACK_DIR only for the role that carries it; the folder is cleared before every run
// and removed when the run ends, so a role without the pack never sees its body. PACK_DIR ignores itself
// (a `.gitignore` of `*`), and packGuard fails the run if a pack file still shows in the branch diff.
// Nothing here is ever committed to an app repo.
// AUDIT-2/3: a skill folder in this repo (kit/skills/<slug>, src/runner/kit.ts) is a pack too, and wins over a doc
// with the same slug. A seat that lists no packs carries its role's default kit (kit/kits.json) unless
// PLANIA_DEFAULT_KITS=0. By default the runner delivers packs as a plugin in the run's temp folder (kit.ts);
// PLANIA_KIT_MODE=worktree keeps the older delivery below (PACK_DIR in the working folder).
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, isNull, like } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agents, docs, projects, type Agent } from "../db/schema.js";
import type { Q } from "../mcp/tx.js";
import { ALLOWED_BASE, defaultGit, type GitFn } from "./worktree.js";
import { defaultSkills, repoSkills, sha } from "./kit.js";
import { roleOf } from "./limits.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: the API hint for a seat that is not on the team, in the install's language; the Spanish is unchanged.
export const PACK_WORDS = defineWords({
  es: { notOnTeam: (agent: string, project: string) => `${agent} no está en el equipo de ${project}` },
  en: { notOnTeam: (agent: string, project: string) => `${agent} is not on ${project}'s team` },
});

export const PACK_TITLE_PREFIX = "Pack: ";
export const PACK_DIR = ".plania-packs";
export const MAX_PACKS = 10;
// PLA-I67-1: an empty list means "the role's default kit". A seat whose owner turned every skill off stores this one
// value instead, so it carries nothing. It is not a slug, so no pack can have it and no client can send it.
export const NO_SKILLS = "-";
const ownList = (skillPacks: string[] | null | undefined): string[] => (skillPacks ?? []).filter((s) => s !== NO_SKILLS);
const SLUG = /^[a-z][a-z0-9-]{0,39}$/;
const WHEN_LINE = /^\s*(?:\*\*)?(?:cu[aá]ndo|when)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.+?)\s*$/i;

// source kit: a folder in this repo (dir set, doc_id null). source doc: a `Pack: <name>` doc in Plania.
export type Pack = { slug: string; name: string; when: string; doc_id: string | null; markdown: string; source: "kit" | "doc"; dir: string | null; sha: string };
export type PackRef = Omit<Pack, "markdown" | "dir">;

const promptsProject = (env: NodeJS.ProcessEnv = process.env) => env.PLANIA_PROMPTS_PROJECT || "plania";

// "Preguntas antes de construir" → "preguntas-antes-de-construir".
export function packSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

// The first `Cuándo:` (or `When:`) line; null when the doc has none (then it is not a usable pack).
export function whenOf(markdown: string): string | null {
  for (const line of markdown.split("\n")) {
    const m = WHEN_LINE.exec(line);
    if (m && m[1]) return m[1].replace(/\*\*$/, "").trim().slice(0, 240);
  }
  return null;
}

// Every pack doc in the prompts project, by name. Docs without a `Cuándo:` line are left out.
export async function listPacks(db: Db | Q, env: NodeJS.ProcessEnv = process.env): Promise<Pack[]> {
  const rows = await db
    .select({ id: docs.id, title: docs.title, markdown: docs.markdown })
    .from(docs)
    .innerJoin(projects, eq(projects.id, docs.projectId))
    .where(and(eq(projects.slug, promptsProject(env)), isNull(docs.taskId), like(docs.title, `${PACK_TITLE_PREFIX}%`)))
    .orderBy(docs.title);
  // The repo's skills first; a doc whose slug the repo already has is left out.
  const out: Pack[] = repoSkills(env).map((k) => ({ slug: k.slug, name: k.name, when: k.when.slice(0, 240), doc_id: null, markdown: k.markdown, source: "kit" as const, dir: k.dir, sha: k.sha }));
  const inRepo = new Set(out.map((k) => k.slug));
  for (const r of rows) {
    const name = r.title.slice(PACK_TITLE_PREFIX.length).trim();
    const slug = packSlug(name);
    const when = whenOf(r.markdown);
    if (!name || !SLUG.test(slug) || !when || inRepo.has(slug)) continue;
    out.push({ slug, name, when, doc_id: r.id, markdown: r.markdown, source: "doc", dir: null, sha: sha(r.markdown) });
  }
  return out;
}

export const packRef = ({ markdown: _m, dir: _d, ...ref }: Pack): PackRef => ref;

// The packs one role carries, in the order stored; slugs whose doc is gone are skipped. With role given, a seat
// that lists none carries that role's default kit (kit/kits.json).
export async function packsOf(db: Db | Q, agent: { skillPacks?: string[] | null }, env: NodeJS.ProcessEnv = process.env, role?: string | null): Promise<Pack[]> {
  if ((agent.skillPacks ?? []).includes(NO_SKILLS)) return [];
  const own = ownList(agent.skillPacks);
  const wanted = own.length === 0 && role && env.PLANIA_DEFAULT_KITS !== "0" ? defaultSkills(role, env) : own;
  if (wanted.length === 0) return [];
  const bySlug = new Map((await listPacks(db, env)).map((p) => [p.slug, p]));
  return wanted.map((s) => bySlug.get(s)).filter((p): p is Pack => !!p);
}

// PLA-I67-1: packs is what the seat's next run carries (its role's default kit when it lists none); own says whether
// the seat has its own list (false: it follows the default kit).
export type RolePacks = { project: string; agent: string; packs: PackRef[]; own: boolean };
export type RolePacksError = { error: "PROJECT_NOT_FOUND" | "AGENT_NOT_FOUND" | "UNKNOWN_PACK" | "TOO_MANY_PACKS"; status: 400 | 404; hint: string; packs?: string[] };

async function memberOf(db: Db | Q, project: string, agent: string): Promise<{ agent: Agent } | RolePacksError> {
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, project)).limit(1);
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  const [a] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.slug, agent), eq(agents.projectId, p.id)))
    .limit(1);
  if (!a || a.status === "retired") return { error: "AGENT_NOT_FOUND", status: 404, hint: say(PACK_WORDS).notOnTeam(agent, project) };
  return { agent: a };
}

export async function rolePacks(db: Db | Q, project: string, agent: string, env: NodeJS.ProcessEnv = process.env): Promise<RolePacks | RolePacksError> {
  const m = await memberOf(db, project, agent);
  if ("error" in m) return m;
  return { project, agent, packs: (await packsOf(db, m.agent, env, roleOf(m.agent))).map(packRef), own: (m.agent.skillPacks ?? []).length > 0 };
}

// Replaces the role's list (deduplicated, order kept). Every slug must name an existing pack. An empty list puts the
// seat back on its role's default kit, unless opts.own: then the seat carries none (PLA-I67-1, La estantería).
export async function setRolePacks(db: Db | Q, project: string, agent: string, slugs: string[], env: NodeJS.ProcessEnv = process.env, opts: { own?: boolean } = {}): Promise<RolePacks | RolePacksError> {
  const m = await memberOf(db, project, agent);
  if ("error" in m) return m;
  const list = [...new Set(slugs.map((s) => s.trim()))];
  if (list.length > MAX_PACKS) return { error: "TOO_MANY_PACKS", status: 400, hint: `at most ${MAX_PACKS} packs per role` };
  const known = new Set((await listPacks(db, env)).map((p) => p.slug));
  const unknown = list.filter((s) => !known.has(s));
  if (unknown.length) return { error: "UNKNOWN_PACK", status: 400, hint: `no pack doc for ${unknown.join(", ")}`, packs: unknown };
  const stored = list.length === 0 && opts.own ? [NO_SKILLS] : list;
  const [updated] = await db.update(agents).set({ skillPacks: stored }).where(eq(agents.id, m.agent.id)).returning();
  return { project, agent, packs: (await packsOf(db, updated!, env, roleOf(updated!))).map(packRef), own: stored.length > 0 };
}

// ---- The run's working folder

export const packFile = (slug: string) => `${PACK_DIR}/${slug}.md`;

export function clearPacks(cwd: string): void {
  rmSync(path.join(cwd, PACK_DIR), { recursive: true, force: true });
}

// Clears what an earlier run left, then writes this role's packs. Returns the relative file of each.
export function writePacks(cwd: string, packs: Pack[]): { slug: string; name: string; when: string; file: string }[] {
  clearPacks(cwd);
  if (packs.length === 0) return [];
  const dir = path.join(cwd, PACK_DIR);
  mkdirSync(dir, { recursive: true });
  // The folder ignores itself, so `git add -A` in the worktree never picks a pack up.
  writeFileSync(path.join(dir, ".gitignore"), "*\n", { mode: 0o644 });
  return packs.map((p) => {
    writeFileSync(path.join(cwd, packFile(p.slug)), p.markdown.endsWith("\n") ? p.markdown : `${p.markdown}\n`, { mode: 0o644 });
    return { slug: p.slug, name: p.name, when: p.when, file: packFile(p.slug) };
  });
}

// The prompt lines: each carried pack's one line, and where its body is.
export function packLines(written: { name: string; when: string; file: string }[]): string[] {
  if (written.length === 0) return [];
  return [
    "Skill packs you carry (read the file before you do that kind of work; never commit it, it is not part of the repo):",
    ...written.map((p) => `- ${p.name} (${p.file}): ${p.when}`),
  ];
}

export const isPackPath = (p: string): boolean => {
  const n = p.trim().replace(/^"|"$/g, "").replace(/^\.\//, "");
  return n === PACK_DIR || n.startsWith(`${PACK_DIR}/`);
};

// The guard: pack files committed on the branch (against origin/sandbox) or staged in the worktree.
// [] when the folder is not a git worktree or git cannot answer.
// PLA-I2-5: base is the project's start branch (startBranchOf).
export async function packsInDiff(cwd: string, git: GitFn = defaultGit, base: string = ALLOWED_BASE): Promise<string[]> {
  if (!existsSync(path.join(cwd, ".git"))) return [];
  const found = new Set<string>();
  for (const args of [
    ["diff", "--name-only", `origin/${base}...HEAD`],
    ["diff", "--name-only", "--cached"],
  ]) {
    const out = await git(args, cwd);
    if (out.code !== 0) continue;
    for (const line of out.stdout.split("\n")) if (line.trim() && isPackPath(line)) found.add(line.trim());
  }
  return [...found].sort();
}
