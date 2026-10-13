import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { branches, pollState, projects, pullRequests, tasks, type Project, type Task } from "../db/schema.js";
import { touchBranch } from "../mcp/branches.js";
import { addResult } from "../mcp/evidence.js";
import { findTask } from "../mcp/queries.js";
import { recordRelease } from "../mcp/releases.js";
import { SYSTEM_ACTOR, writeTx, type Ctx } from "../mcp/tx.js";
import { setTask, setTaskLinks } from "../mcp/writes.js";
import type { Job } from "./index.js";

// The GitHub poller (R-21, R-12, R-09, R-17). Outbound only: the server is not reachable, so it
// asks GitHub every minute, with ETags, for the repo named in projects.settings.github:
//   pull requests → pull_requests rows, linked to a ticket by pr_url, a "Plania: KEY" line in the
//     body, or a "Plania-Task: KEY" trailer in a commit; a merged PR moves its In review ticket to
//     Merged; the release target env containing the merge commit moves Merged to Released;
//   check runs on open linked PRs → ci results with the run url; a red check on an In review
//     ticket sends it back to Ready with a note (pr.ci_failed);
//   branches → heads (stale_for_head), merges and deletions in the registry.
// Every write is idempotent through request_id, so a tick may repeat without harm.
// The token comes from the env var named in settings.github.token_env (default GITHUB_TOKEN).

export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;

type Pr = {
  number: number;
  html_url: string;
  title: string;
  state: "open" | "closed";
  body: string | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
  updated_at: string;
  head: { sha: string; ref: string };
  base: { ref: string };
};
type CheckRuns = { check_runs: { name: string; status: string; conclusion: string | null; html_url: string; head_sha: string }[] };
type Branch = { name: string; commit: { sha: string } };
type Compare = { status: "ahead" | "behind" | "identical" | "diverged" };

export type GithubDeps = { fetch: Fetch; now?: Date; env?: Record<string, string | undefined> };

const API = "https://api.github.com";
const KEY_LINE = /^\s*Plania(?:-Task)?:\s*([A-Z][A-Z0-9]{1,5}-[A-Z0-9-]+)\s*$/im;

function systemCtx(requestId: string, tool: string): Ctx {
  return { actor: { ...SYSTEM_ACTOR, machine: "poller" }, system: true, requestId, tool };
}

async function gh(deps: GithubDeps, token: string, path: string, etag?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "plania" };
  if (etag) headers["If-None-Match"] = etag;
  const res = await deps.fetch(`${API}${path}`, { headers });
  if (res.status === 304) return { status: 304 as const, data: null, etag };
  if (res.status === 404) return { status: 404 as const, data: null, etag: undefined };
  if (res.status >= 400) throw new Error(`GitHub ${res.status} on ${path}`);
  return { status: 200 as const, data: await res.json(), etag: res.headers.get("etag") ?? undefined };
}

async function cursorOf(db: Db, projectId: string): Promise<Record<string, unknown>> {
  const [row] = await db.select().from(pollState).where(and(eq(pollState.projectId, projectId), eq(pollState.source, "github")));
  return row?.cursor ?? {};
}

async function saveCursor(db: Db, projectId: string, cursor: Record<string, unknown>, error: string | null) {
  await db
    .insert(pollState)
    .values({ projectId, source: "github", cursor, polledAt: sql`now()`, error })
    .onConflictDoUpdate({ target: [pollState.projectId, pollState.source], set: { cursor, polledAt: sql`now()`, error } });
}

// Which ticket a PR belongs to: the row's link, a ticket with that pr_url, or a Plania: KEY line.
async function linkPr(db: Db, p: Project, pr: Pr, current: { taskId: string | null } | undefined): Promise<Task | undefined> {
  if (current?.taskId) {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, current.taskId)).limit(1);
    if (t) return t;
  }
  const [byUrl] = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.prUrl, pr.html_url))).limit(1);
  if (byUrl) return byUrl;
  const m = KEY_LINE.exec(pr.body ?? "");
  if (m) return findTask(db, p.id, m[1]!);
  return undefined;
}

async function trailerKey(deps: GithubDeps, token: string, repo: string, pr: Pr): Promise<string | undefined> {
  const r = await gh(deps, token, `/repos/${repo}/pulls/${pr.number}/commits?per_page=50`);
  if (r.status !== 200) return undefined;
  for (const c of r.data as { commit: { message: string } }[]) {
    const m = KEY_LINE.exec(c.commit.message);
    if (m) return m[1];
  }
  return undefined;
}

export async function pollGithubProject(db: Db, p: Project, deps: GithubDeps): Promise<Record<string, number>> {
  const cfg = p.settings.github;
  if (!cfg?.repo) return {};
  const token = (deps.env ?? process.env)[cfg.token_env ?? "GITHUB_TOKEN"];
  const summary: Record<string, number> = { prs: 0, linked: 0, merged: 0, released: 0, ci: 0, branches: 0 };
  if (!token) {
    await saveCursor(db, p.id, await cursorOf(db, p.id), `no token in ${cfg.token_env ?? "GITHUB_TOKEN"}`);
    return summary;
  }
  const cursor = await cursorOf(db, p.id);
  try {
    // 1. Pull requests, newest change first.
    const pulls = await gh(deps, token, `/repos/${cfg.repo}/pulls?state=all&sort=updated&direction=desc&per_page=50`, cursor.pulls_etag as string | undefined);
    if (pulls.status === 200) {
      cursor.pulls_etag = pulls.etag;
      for (const pr of pulls.data as Pr[]) {
        const [current] = await db
          .select()
          .from(pullRequests)
          .where(and(eq(pullRequests.projectId, p.id), eq(pullRequests.repo, cfg.repo), eq(pullRequests.number, pr.number)))
          .limit(1);
        if (current && current.ghUpdatedAt && current.ghUpdatedAt.getTime() >= new Date(pr.updated_at).getTime() && current.taskId) continue;
        let task = await linkPr(db, p, pr, current);
        if (!task && pr.state === "open" && !current) {
          const key = await trailerKey(deps, token, cfg.repo, pr);
          if (key) task = await findTask(db, p.id, key);
        }
        const state = pr.merged_at ? "merged" : pr.state === "open" ? "open" : "closed";
        await db
          .insert(pullRequests)
          .values({
            projectId: p.id,
            repo: cfg.repo,
            number: pr.number,
            url: pr.html_url,
            title: pr.title,
            taskId: task?.id ?? null,
            state,
            headSha: pr.head.sha,
            headBranch: pr.head.ref,
            baseBranch: pr.base.ref,
            mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
            mergeSha: pr.merge_commit_sha,
            ghUpdatedAt: new Date(pr.updated_at),
          })
          .onConflictDoUpdate({
            target: [pullRequests.projectId, pullRequests.repo, pullRequests.number],
            set: {
              title: pr.title,
              taskId: task?.id ?? null,
              state,
              headSha: pr.head.sha,
              headBranch: pr.head.ref,
              baseBranch: pr.base.ref,
              mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
              mergeSha: pr.merge_commit_sha,
              ghUpdatedAt: new Date(pr.updated_at),
              updatedAt: sql`now()`,
            },
          });
        summary.prs!++;
        // 2.7: the feed hears a PR open, merge or close once. A first poll that meets an already
        // merged or closed PR says nothing, so history does not flood the digest.
        const prEvent = !current ? (state === "open" ? "pr.opened" : null) : current.state !== state && state !== "open" ? (state === "merged" ? "pr.merged" : "pr.closed") : null;
        if (prEvent) {
          const linked = task ? { id: task.id, key: task.key } : null;
          await writeTx(db, p, systemCtx(`gh:${cfg.repo}#${pr.number}:${state}`, "jobs.github"), async (_tx, emit) => {
            await emit(prEvent, linked, {
              repo: cfg.repo,
              number: pr.number,
              url: pr.html_url,
              title: pr.title,
              head_branch: pr.head.ref,
              base_branch: pr.base.ref,
              task_key: task?.key ?? null,
            });
          });
          summary.pr_events = (summary.pr_events ?? 0) + 1;
        }
        await touchBranch(db, p.id, pr.head.ref, { headSha: pr.head.sha, headAt: new Date(pr.updated_at), prNumber: pr.number, ...(pr.merged_at ? { mergedAt: new Date(pr.merged_at) } : {}) });
        if (!task) continue;
        if (!task.prUrl || task.branch !== pr.head.ref) {
          await setTaskLinks(db, { project: p.slug, key: task.key, pr_url: pr.html_url, ...(task.kind === "ticket" ? { branch: pr.head.ref } : {}) }, systemCtx(`gh:${cfg.repo}#${pr.number}:links:${pr.updated_at}`, "jobs.github"));
          summary.linked!++;
        }
        if (state === "merged" && task.status === "In review") {
          await setTask(
            db,
            { project: p.slug, key: task.key, status: "Merged", note: `PR #${pr.number} merged into ${pr.base.ref} (${pr.merge_commit_sha?.slice(0, 7)})` },
            systemCtx(`gh:${cfg.repo}#${pr.number}:merged:${pr.merge_commit_sha}`, "jobs.github"),
          );
          summary.merged!++;
        }
        // 2. Check runs on open linked PRs.
        if (state === "open") {
          const runs = await gh(deps, token, `/repos/${cfg.repo}/commits/${pr.head.sha}/check-runs?per_page=50`);
          if (runs.status === 200) {
            const list = (runs.data as CheckRuns).check_runs;
            const failed = list.find((r) => r.status === "completed" && ["failure", "timed_out", "cancelled", "action_required"].includes(r.conclusion ?? ""));
            const allGreen = list.length > 0 && list.every((r) => r.status === "completed" && ["success", "neutral", "skipped"].includes(r.conclusion ?? ""));
            const ciState = failed ? "failure" : allGreen ? "success" : "pending";
            const [row] = await db.select({ ciState: pullRequests.ciState }).from(pullRequests).where(and(eq(pullRequests.projectId, p.id), eq(pullRequests.repo, cfg.repo), eq(pullRequests.number, pr.number)));
            if (row?.ciState !== ciState || !current) {
              await db
                .update(pullRequests)
                .set({ ciState, ciUrl: (failed ?? list[0])?.html_url ?? null })
                .where(and(eq(pullRequests.projectId, p.id), eq(pullRequests.repo, cfg.repo), eq(pullRequests.number, pr.number)));
              if (ciState !== "pending") {
                await addResult(
                  db,
                  {
                    project: p.slug,
                    key: task.key,
                    kind: "ci",
                    verdict: ciState === "success" ? "pass" : "fail",
                    cite: failed ? `${failed.name}: ${failed.conclusion}` : `${list.length} checks green`,
                    url: (failed ?? list[0])?.html_url,
                    commit: pr.head.sha,
                    branch: pr.head.ref,
                  },
                  systemCtx(`gh:${cfg.repo}#${pr.number}:ci:${pr.head.sha}:${ciState}`, "jobs.github"),
                );
                summary.ci!++;
                if (ciState === "failure" && task.status === "In review") {
                  await writeTx(db, p, systemCtx(`gh:${cfg.repo}#${pr.number}:ci_failed:${pr.head.sha}`, "jobs.github"), async (_tx, emit) => {
                    await emit("pr.ci_failed", task!, { pr: pr.html_url, sha: pr.head.sha, url: failed!.html_url, check: failed!.name });
                  });
                  await setTask(
                    db,
                    { project: p.slug, key: task.key, status: "Ready", note: `CI red on PR #${pr.number} (${failed!.name}); back from review` },
                    systemCtx(`gh:${cfg.repo}#${pr.number}:ci_back:${pr.head.sha}`, "jobs.github"),
                  );
                }
              }
            }
          }
        }
      }
    }

    // 3. Branch heads and deletions for the branches the project knows.
    const known = await db.select().from(branches).where(eq(branches.projectId, p.id));
    if (known.length) {
      const list = await gh(deps, token, `/repos/${cfg.repo}/branches?per_page=100`, cursor.branches_etag as string | undefined);
      if (list.status === 200) {
        cursor.branches_etag = list.etag;
        const remote = new Map((list.data as Branch[]).map((b) => [b.name, b.commit.sha]));
        for (const b of known) {
          const sha = remote.get(b.name);
          if (sha && sha !== b.headSha) {
            await touchBranch(db, p.id, b.name, { headSha: sha, headAt: deps.now ?? new Date(), deletedAt: null });
            summary.branches!++;
          } else if (!sha && !b.deletedAt && (b.headSha || b.prNumber)) {
            await touchBranch(db, p.id, b.name, { deletedAt: deps.now ?? new Date() });
            await writeTx(db, p, systemCtx(`gh:${cfg.repo}:branch_deleted:${b.name}`, "jobs.github"), async (_tx, emit) => {
              await emit("branch.deleted", null, { branch: b.name });
            });
          }
        }
      }
    }

    // 4. Merged tickets whose merge commit the release target now contains.
    summary.released = await releaseMerged(db, p, async (merge, env) => {
      const cacheKey = `cmp:${merge}:${env}`;
      const cache = (cursor.compare as Record<string, boolean> | undefined) ?? {};
      if (cacheKey in cache) return cache[cacheKey]!;
      const r = await gh(deps, token, `/repos/${cfg.repo}/compare/${merge}...${env}`);
      const contains = r.status === 200 && ["ahead", "identical"].includes((r.data as Compare).status);
      cursor.compare = { ...cache, [cacheKey]: contains };
      return contains;
    });
    await saveCursor(db, p.id, cursor, null);
  } catch (e) {
    await saveCursor(db, p.id, cursor, e instanceof Error ? e.message : String(e));
    throw e;
  }
  return summary;
}

// Merged → Released once the release target env runs a commit that contains the merge commit:
// the env's commit is the merge commit, env_commits lists it, or contains() says so (GitHub compare).
export async function releaseMerged(db: Db, p: Project, contains?: (mergeSha: string, envSha: string) => Promise<boolean>): Promise<number> {
  const env = p.settings.release_target ?? "prod";
  const [state] = await db.execute<{ commit: string | null }>(sql`select commit from env_states where project_id = ${p.id} and env = ${env}`).then((r) => r.rows);
  if (!state?.commit) return 0;
  const merged = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.status, "Merged")));
  let released = 0;
  for (const t of merged) {
    const [pr] = await db.select().from(pullRequests).where(eq(pullRequests.taskId, t.id)).orderBy(sql`${pullRequests.updatedAt} desc`).limit(1);
    const merge = pr?.mergeSha;
    if (!merge) continue;
    const [known] = await db
      .execute<{ sha: string }>(sql`select sha from env_commits where project_id = ${p.id} and env = ${env} and (sha like ${merge} || '%' or ${merge} like sha || '%') limit 1`)
      .then((r) => r.rows);
    let ok = !!known || state.commit.startsWith(merge) || merge.startsWith(state.commit);
    if (!ok && contains) ok = await contains(merge, state.commit);
    if (!ok) continue;
    const sys = { actor: { ...SYSTEM_ACTOR, machine: "poller" }, system: true, requestId: `release:${t.key}:${env}:${state.commit}`, tool: "jobs.release" };
    await setTask(
      db,
      { project: p.slug, key: t.key, status: "Released", note: `${env} runs ${state.commit.slice(0, 7)}, which contains the merge commit ${merge.slice(0, 7)}` },
      sys,
    );
    await writeTx(db, p, { ...sys, requestId: `${sys.requestId}:record` }, async (tx, emit) => {
      await recordRelease(tx, p, env, t.key);
      await emit("release.recorded", { id: t.id, key: t.key }, { env, commit: state.commit });
    });
    released++;
  }
  return released;
}

export async function pollGithub(db: Db, deps: GithubDeps): Promise<Record<string, number>> {
  const total: Record<string, number> = {};
  for (const p of await db.select().from(projects)) {
    if (!p.settings.github?.repo) continue;
    try {
      for (const [k, v] of Object.entries(await pollGithubProject(db, p, deps))) total[k] = (total[k] ?? 0) + v;
    } catch (e) {
      total.errors = (total.errors ?? 0) + 1;
      console.error(`[jobs] github ${p.slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return total;
}

export const githubJob: Job = {
  name: "github",
  intervalMs: 60 * 1000,
  runOnce: (db, now) => pollGithub(db, { fetch: (url, init) => fetch(url, init), now }),
};
