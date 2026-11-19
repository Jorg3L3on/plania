// PLA-I2-5: Plania prepares the product's code from Ajustes («Dónde está el código»). Mounted inside companyRoutes
// (src/api/company.ts), so the screen's cookie alone opens it, as for every settings route:
//   POST /api/company/projects/:slug/settings/code/preparar  {version, repo_path?, github: {name?, private?} | null}
//        the folder, git, an empty first commit, the GitHub repository with the owner's gh login (private unless
//        said otherwise; or a clone of the project's GitHub repository when github is null and one is saved), the
//        push and the working branch (src/runner/repo-setup.ts). Each step is reported; a failure keeps what was done.
//        The folder and the repository are saved to the project's settings with the version the screen read.
//   POST /api/company/projects/:slug/settings/code/rama      {}
//        the working branch on origin, from the default branch (one git push), or on GitHub itself when the project
//        has no folder on this machine yet. The readiness list reads again after it.
// Nothing of Plania's is written into the product repository (ADR 0002). Tests swap git, gh and the filesystem
// (setRepoSetupDeps).
import { Hono, type Context } from "hono";
import { z } from "zod";
import { withDb } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { setProject } from "../mcp/project.js";
import { findProject } from "../mcp/queries.js";
import { createRepo, createStartBranch, createStartBranchOnGithub, defaultRepoSetupDeps, type RepoSetupDeps, type SetupResult } from "../runner/repo-setup.js";
import { repoPathShapeOk } from "../runner/repo-check.js";
import { startBranchOf } from "../runner/start-branch.js";
import { repoPathOf } from "../runner/worktree.js";
import { settingsCtx, settingsRead } from "./project-settings.js";

let deps: RepoSetupDeps = defaultRepoSetupDeps;
export const setRepoSetupDeps = (d: RepoSetupDeps | null): void => {
  deps = d ?? defaultRepoSetupDeps;
};

const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const PrepararBody = z
  .object({
    version: z.number().int().min(1),
    repo_path: z.string().max(500).optional(),
    github: z.object({ name: z.string().max(100).optional(), private: z.boolean().optional() }).strict().nullable(),
  })
  .strict();

export type PrepararAnswer = { setup: SetupResult; saved: boolean; settings: Awaited<ReturnType<typeof settingsRead>> };

/** The steps, then the settings: the folder whenever it exists now, the GitHub repository when one is known. */
export async function preparar(slug: string, input: z.infer<typeof PrepararBody>, d: RepoSetupDeps = deps): Promise<PrepararAnswer | { error: string; status: 400 | 409; field?: string }> {
  const repoPath = input.repo_path?.trim() || undefined;
  if (repoPath !== undefined && !repoPathShapeOk(repoPath)) return { error: "INVALID_BODY", status: 400, field: "repo_path" };
  const name = input.github?.name?.trim() || slug;
  if (input.github && !NAME.test(name)) return { error: "INVALID_BODY", status: 400, field: "github" };
  return withDb(async (db) => {
    const p = await findProject(db, slug);
    if (p.version !== input.version) return { error: "STALE_VERSION", status: 409 as const };
    const folder = repoPathOf(p.slug, repoPath ? { local: { repo_path: repoPath } } : p.settings);
    const saved = p.settings.github?.repo ?? null;
    const setup = await createRepo(
      { folder, start: startBranchOf(p.settings), github: input.github ? { name, private: input.github.private ?? true } : null, clone: input.github ? null : saved },
      d,
    );
    const folderMade = setup.steps.find((s) => s.id === "folder")?.state !== "failed";
    const repo = setup.github_repo ?? saved;
    let wrote = false;
    if (folderMade) {
      await setProject(
        db,
        { project: slug, version: input.version, settings: { local: { repo_path: setup.path }, ...(repo ? { github: { ...(p.settings.github ?? {}), repo } } : {}) } },
        settingsCtx,
      );
      wrote = true;
    }
    return { setup, saved: wrote, settings: await settingsRead(db, slug) };
  });
}

/** The working branch: through the folder's origin when there is a git folder, else on GitHub itself. */
export async function crearRama(slug: string, d: RepoSetupDeps = deps): Promise<{ state: "done" | "already" | "failed"; code: string | null; via: "git" | "github" | null }> {
  return withDb(async (db) => {
    const p = await findProject(db, slug);
    const start = startBranchOf(p.settings);
    const folder = repoPathOf(p.slug, p.settings);
    const listed = d.fs.list(folder);
    if (Array.isArray(listed) && listed.includes(".git")) return { ...(await createStartBranch(folder, start, d.git)), via: "git" as const };
    const repo = p.settings.github?.repo;
    if (repo) return { ...(await createStartBranchOnGithub(repo, start, d.gh, process.cwd())), via: "github" as const };
    return { state: "failed" as const, code: "REPO_NO_ORIGIN", via: null };
  });
}

const fail = (c: Context, e: unknown): Response => {
  if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
  throw e;
};

export const repoSetupRoutes = new Hono();

repoSetupRoutes.post("/projects/:slug/settings/code/preparar", async (c) => {
  const parsed = PrepararBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "INVALID_BODY", issues: parsed.error.issues.map((i) => i.path.join(".")) }, 400);
  try {
    const out = await preparar(c.req.param("slug"), parsed.data);
    if ("error" in out) {
      const { status, ...rest } = out;
      return c.json(rest, status);
    }
    return c.json(out);
  } catch (e) {
    return fail(c, e);
  }
});

repoSetupRoutes.post("/projects/:slug/settings/code/rama", async (c) => {
  try {
    return c.json(await crearRama(c.req.param("slug")));
  } catch (e) {
    return fail(c, e);
  }
});
