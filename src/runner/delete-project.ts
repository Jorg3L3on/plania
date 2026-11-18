// NEWPROJ-7: deleting a project from the screen (DELETE /api/company/projects/:slug, after the owner's code).
// In order:
//   1. Its switch goes off, so nothing new starts while it is being deleted.
//   2. Its live runs are stopped through the runner's own stop path, and waited for (stopProjectRuns).
//   3. Its folders under the worktrees root go: each runner worktree is removed through git in the product repo
//      (`git worktree remove --force`, then `prune`), and <root>/<slug> (scratch folders, the read copy) is deleted.
//      The product repo's own checkout and its branches are never touched.
//   4. In one transaction: its team's agent tokens are revoked, its team (agents.project_id) is deleted, and the
//      project row goes. Run history (agent_runs) cascades with the project, so nothing readable is lost by deleting
//      the agents rather than retiring them, and their slugs (po-<slug>, research-<slug>, ...) are free again. Before
//      this, agents.project_id was set to null on delete and the team stayed as company-level rows that
//      serviceAgent (src/runner/events.ts) could pick as the fallback for another project's work.
// Git, the filesystem, the stop and the worktrees root are injected in tests (deleteProjectDeps).
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentTokens, agents, projects, type Project } from "../db/schema.js";
import { stopProjectRuns } from "./runner.js";
import { carefulGit, defaultGit, isInside, repoPathOf, worktreeRoot, type GitFn } from "./worktree.js";

export type DeleteProjectDeps = {
  stop?: (projectId: string, reason: string) => Promise<number>;
  git?: GitFn;
  env?: NodeJS.ProcessEnv;
  worktreeRoot?: string;
  rm?: (dir: string) => void;
};

// The route's deps; tests assign git, the root and the stop here.
export const deleteProjectDeps: DeleteProjectDeps = {};

export type DeletedProject = { deleted: string; stopped: number; worktrees: number; agents: string[] };

const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export async function removeProjectFolders(project: Pick<Project, "slug" | "settings">, deps: DeleteProjectDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const root = path.resolve(deps.worktreeRoot ?? worktreeRoot(env));
  if (!SAFE_SLUG.test(project.slug)) return 0;
  const dir = path.join(root, project.slug);
  const repo = repoPathOf(project.slug, project.settings, env);
  // Never a folder that is the repo or inside it, never the root itself.
  if (!existsSync(dir) || !isInside(dir, root) || path.resolve(dir) === root || isInside(dir, repo) || isInside(repo, dir)) return 0;
  const git = carefulGit(deps.git ?? defaultGit);
  const hasRepo = existsSync(repo);
  let n = 0;
  for (const name of readdirSync(dir)) {
    const wt = path.join(dir, name);
    if (!existsSync(path.join(wt, ".git"))) continue;
    if (hasRepo && (await git(["worktree", "remove", "--force", wt], repo)).code === 0) n += 1;
  }
  (deps.rm ?? ((d: string) => rmSync(d, { recursive: true, force: true })))(dir);
  if (hasRepo) await git(["worktree", "prune"], repo);
  return n;
}

export async function deleteProject(db: Db, project: Project, deps: DeleteProjectDeps = deleteProjectDeps): Promise<DeletedProject> {
  await db.update(projects).set({ runsPaused: true, runsPausedAt: new Date(), updatedAt: sql`now()` }).where(eq(projects.id, project.id));
  const stopped = await (deps.stop ?? stopProjectRuns)(project.id, `project ${project.slug} deleted`);
  const worktrees = await removeProjectFolders(project, deps);
  const team = await db.transaction(async (tx) => {
    const rows = await tx.select({ id: agents.id, slug: agents.slug }).from(agents).where(eq(agents.projectId, project.id));
    const slugs = rows.map((r) => r.slug);
    if (slugs.length) {
      await tx
        .update(agentTokens)
        .set({ revokedAt: new Date(), revokedReason: `project ${project.slug} deleted` })
        .where(and(inArray(agentTokens.agent, slugs), isNull(agentTokens.revokedAt)));
      await tx.delete(agents).where(inArray(agents.id, rows.map((r) => r.id)));
    }
    await tx.delete(projects).where(eq(projects.id, project.id));
    return slugs;
  });
  return { deleted: project.slug, stopped, worktrees, agents: team };
}
