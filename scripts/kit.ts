// Usage: pnpm kit:status | pnpm kit:export | pnpm kit:sync [--force]
//
// AUDIT-2: the agents' kit is kept in git (kit/, see src/runner/kit.ts). The runner reads the role prompts from the
// Plania docs `Prompt: <role>` (the live copy) and the skills from kit/skills, so the two prompt copies must agree:
//   status   each role prompt: same, only in the repo, only in Plania, or different (and which side moved since the
//            last sync). Each skill in the repo with its version, and the pack docs the repo does not have yet.
//   export   Plania → repo. Writes kit/roles/<role>.md from the live docs, and a kit/skills/<slug>/SKILL.md for every
//            pack doc that has no folder yet. Run it once on the server to bring the live kit into git.
//   sync     repo → Plania. Writes each kit/roles/<role>.md to its doc. A doc that was edited in Plania since the
//            last sync is left alone and reported (drift); --force overwrites it.
// What was last synced is remembered in machine_state `kit.synced` (one sha per role).
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { and, eq, isNull } from "drizzle-orm";
import { withDb, type Db } from "../src/db/client.js";
import { docs, machineState, projects } from "../src/db/schema.js";
import { attachDoc } from "../src/mcp/docs.js";
import type { Ctx } from "../src/mcp/tx.js";
import { kitRoot, repoSkills, roleFile, sha } from "../src/runner/kit.js";
import { PROMPT_DOCS, RUNNER_ROLES, type RunnerRole } from "../src/runner/limits.js";
import { listPacks } from "../src/runner/packs.js";

const STATE_KEY = "kit.synced";
const promptsProject = (env: NodeJS.ProcessEnv) => env.PLANIA_PROMPTS_PROJECT || "plania";
const ctx = (): Ctx => ({ actor: { agent: "plania", session_id: "kit-sync", machine: hostname() }, tool: "kit.sync" });
const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();

export type RoleState = "same" | "repo_only" | "doc_only" | "repo_newer" | "doc_newer" | "both_changed" | "missing";
export type RoleRow = { role: RunnerRole; title: string; state: RoleState; repo: string | null; doc: string | null; doc_version: number | null };

async function liveDocs(db: Db, env: NodeJS.ProcessEnv): Promise<Map<string, { markdown: string; version: number }>> {
  const rows = await db
    .select({ title: docs.title, markdown: docs.markdown, version: docs.version })
    .from(docs)
    .innerJoin(projects, eq(projects.id, docs.projectId))
    .where(and(eq(projects.slug, promptsProject(env)), isNull(docs.taskId)));
  return new Map(rows.map((r) => [r.title, { markdown: r.markdown, version: r.version }]));
}

async function synced(db: Db): Promise<Record<string, string>> {
  const [row] = await db.select().from(machineState).where(eq(machineState.key, STATE_KEY)).limit(1);
  return ((row?.value as { roles?: Record<string, string> } | undefined)?.roles ?? {}) as Record<string, string>;
}

async function remember(db: Db, roles: Record<string, string>): Promise<void> {
  await db
    .insert(machineState)
    .values({ key: STATE_KEY, value: { roles } })
    .onConflictDoUpdate({ target: machineState.key, set: { value: { roles }, updatedAt: new Date() } });
}

export async function kitStatus(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<RoleRow[]> {
  const live = await liveDocs(db, env);
  const last = await synced(db);
  return RUNNER_ROLES.map((role) => {
    const file = roleFile(role, env);
    const doc = live.get(PROMPT_DOCS[role]) ?? null;
    const repo = file ? sha(norm(file), 12) : null;
    const d = doc ? sha(norm(doc.markdown), 12) : null;
    let state: RoleState;
    if (!repo && !d) state = "missing";
    else if (!d) state = "repo_only";
    else if (!repo) state = "doc_only";
    else if (repo === d) state = "same";
    else if (last[role] === d) state = "repo_newer";
    else if (last[role] === repo) state = "doc_newer";
    else state = "both_changed";
    return { role, title: PROMPT_DOCS[role], state, repo, doc: d, doc_version: doc?.version ?? null };
  });
}

// Plania → repo. Returns what it wrote.
export async function kitExport(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<{ roles: string[]; skills: string[] }> {
  const live = await liveDocs(db, env);
  const root = kitRoot(env);
  const wrote = { roles: [] as string[], skills: [] as string[] };
  const last: Record<string, string> = {};
  mkdirSync(path.join(root, "roles"), { recursive: true });
  for (const role of RUNNER_ROLES) {
    const doc = live.get(PROMPT_DOCS[role]);
    if (!doc) continue;
    const text = `${norm(doc.markdown)}\n`;
    last[role] = sha(norm(doc.markdown), 12);
    if (roleFile(role, env) && norm(roleFile(role, env)!) === norm(doc.markdown)) continue;
    writeFileSync(path.join(root, "roles", `${role}.md`), text);
    wrote.roles.push(role);
  }
  for (const pack of await listPacks(db, env)) {
    if (pack.source !== "doc") continue;
    const dir = path.join(root, "skills", pack.slug);
    if (existsSync(dir)) continue;
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${pack.slug}\ndescription: ${JSON.stringify(pack.when)}\n---\n\n${norm(pack.markdown)}\n`);
    wrote.skills.push(pack.slug);
  }
  await remember(db, { ...(await synced(db)), ...last });
  return wrote;
}

// repo → Plania. Returns the roles written and the ones left alone because their doc moved.
export async function kitSync(db: Db, opts: { force?: boolean } = {}, env: NodeJS.ProcessEnv = process.env): Promise<{ written: string[]; drift: string[]; same: string[] }> {
  const rows = await kitStatus(db, env);
  const live = await liveDocs(db, env);
  const last = await synced(db);
  const out = { written: [] as string[], drift: [] as string[], same: [] as string[] };
  for (const r of rows) {
    const file = roleFile(r.role, env);
    if (!file) continue;
    if (r.state === "same") {
      last[r.role] = r.repo!;
      out.same.push(r.role);
      continue;
    }
    if ((r.state === "doc_newer" || r.state === "both_changed") && !opts.force) {
      out.drift.push(r.role);
      continue;
    }
    const doc = live.get(r.title);
    await attachDoc(db, { project: promptsProject(env), title: r.title, markdown: `${norm(file)}\n`, ...(doc ? { version: doc.version } : {}) }, ctx());
    last[r.role] = r.repo!;
    out.written.push(r.role);
  }
  await remember(db, last);
  return out;
}

const WORDS: Record<RoleState, string> = {
  same: "same",
  repo_only: "only in the repo (sync writes it)",
  doc_only: "only in Plania (export writes it)",
  repo_newer: "repo changed since the last sync (sync writes it)",
  doc_newer: "edited in Plania since the last sync (export pulls it)",
  both_changed: "changed on both sides (export, merge by hand, sync --force)",
  missing: "missing on both sides",
};

async function main(argv: string[]): Promise<number> {
  const [cmd, ...flags] = argv;
  return withDb(async (db) => {
    if (cmd === "export") {
      const w = await kitExport(db);
      console.log(`roles written: ${w.roles.join(", ") || "none"}\nskills written: ${w.skills.join(", ") || "none"}`);
      return 0;
    }
    if (cmd === "sync") {
      const r = await kitSync(db, { force: flags.includes("--force") });
      console.log(`written: ${r.written.join(", ") || "none"}\nsame: ${r.same.join(", ") || "none"}`);
      if (r.drift.length) console.log(`left alone, edited in Plania since the last sync: ${r.drift.join(", ")} (pnpm kit:export, then sync; or sync --force)`);
      return r.drift.length ? 1 : 0;
    }
    if (cmd === "status" || !cmd) {
      for (const r of await kitStatus(db)) console.log(`${r.role.padEnd(14)} ${WORDS[r.state]}${r.doc_version ? `  (doc v${r.doc_version})` : ""}`);
      const packs = await listPacks(db);
      console.log(`\nskills in the repo: ${repoSkills().map((s) => `${s.slug}@${s.sha}`).join(", ") || "none"}`);
      console.log(`pack docs not in the repo: ${packs.filter((p) => p.source === "doc").map((p) => p.slug).join(", ") || "none"}`);
      return 0;
    }
    console.error("usage: kit.ts status | export | sync [--force]");
    return 2;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
