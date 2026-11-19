// PLA-I2-9: migrations written by agents are listed for the owner and never applied by a run (the deny rules in
// src/runner/deny.ts selfDenyRules stop a run of Plania from applying one). For the Plania project only: every
// delivery (a ticket in review or merged with a branch) whose branch carries migration files the live database's
// record (plania_migrations) does not have. Read-only: git ls-tree on the branch already fetched, one select.
import path from "node:path";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects, tasks } from "../db/schema.js";
import { MIGRATIONS_TABLE } from "../db/migrate.js";
import { defaultGit, repoPathOf, type GitFn } from "../runner/worktree.js";
import { isSelfProject, serverRoot } from "./plania-self.js";

export const DELIVERY_STATUSES = ["In review", "Merged"] as const;
export const MIGRATIONS_PATH = "drizzle/migrations";

export type AgentMigration = { key: string; title: string; branch: string; files: string[] };
export type AgentMigrations = { self: boolean; deliveries: AgentMigration[] };

export type AgentMigrationDeps = { git?: GitFn; serverRoot?: string; env?: NodeJS.ProcessEnv };

/** The migration files on a branch (origin/<branch>, else the local branch). Null when neither can be read. */
async function filesOn(git: GitFn, repo: string, branch: string): Promise<string[] | null> {
  for (const ref of [`origin/${branch}`, branch]) {
    const r = await git(["ls-tree", "--name-only", `${ref}:${MIGRATIONS_PATH}`], repo).catch(() => null);
    if (r && r.code === 0) return r.stdout.split(/\r?\n/).map((l) => path.posix.basename(l.trim())).filter((f) => f.endsWith(".sql"));
  }
  return null;
}

export async function agentMigrations(db: Db, slug: string, deps: AgentMigrationDeps = {}): Promise<AgentMigrations | null> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return null;
  const repo = repoPathOf(p.slug, p.settings, deps.env ?? process.env);
  if (!isSelfProject(repo, deps.serverRoot ?? serverRoot())) return { self: false, deliveries: [] };
  const rows = await db
    .select({ key: tasks.key, title: tasks.title, branch: tasks.branch })
    .from(tasks)
    .where(and(eq(tasks.projectId, p.id), inArray(tasks.status, [...DELIVERY_STATUSES]), isNotNull(tasks.branch)));
  const recorded = new Set(
    await db
      .execute<{ name: string }>(sql.raw(`select name from ${MIGRATIONS_TABLE}`))
      .then((r) => r.rows.map((x) => x.name))
      .catch(() => [] as string[]),
  );
  const git = deps.git ?? defaultGit;
  const deliveries: AgentMigration[] = [];
  for (const t of rows) {
    const files = await filesOn(git, repo, t.branch!);
    const fresh = (files ?? []).filter((f) => !recorded.has(f)).sort();
    if (fresh.length) deliveries.push({ key: t.key, title: t.title, branch: t.branch!, files: fresh });
  }
  deliveries.sort((a, b) => a.key.localeCompare(b.key));
  return { self: true, deliveries };
}
