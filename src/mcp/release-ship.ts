import type { Db } from "../db/client.js";
import { mergeRules, missingChecks, type Rollup } from "../camino/guard.js";
import { runInGroup } from "../jobs/gh-process.js";
import { githubReleaseTokenFilePath, githubTokenFilePath, readTokenFile } from "../jobs/gh-token.js";
import { commandPath } from "../jobs/machine/run.js";
import { ghLoginOn } from "../install-state.js";
import { ToolError, findProject } from "./queries.js";
import { releasePlan, type ReleasePlan } from "./release-plan.js";
import { writeTx, type Ctx } from "./tx.js";

// 2.13 (item 2, phase two): the owner ships the release from the screen. In settings.release.mode "merge"
// the server opens (or reuses) a PR from → into titled "Release: <keys>", merges it with
// `gh pr merge --merge` (a merge commit: history kept, and the pinned decisions hold because the click
// is the owner's), and writes release.merged with the merge sha. The GitHub poller then sees into contain
// from (release.shipped) and the deploy poller moves the tickets to Released. Agents never get here:
// the route is the screen's alone and shipRelease refuses anything but a human ctx.

// gh through runInGroup (no shell, its own process group, the group killed on timeout). GH_TOKEN
// comes from ~/.config/plania/github-release-token, or ~/.config/plania/github-token when that
// file has no token, and GH_PROMPT_DISABLED=1. With no token and gh's login off (ghLoginOn), the call
// throws before any process. Tests replace releaseGh.run so no real gh ever runs against a repo.
export type GhRun = (args: string[]) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

export const RELEASE_GH_TIMEOUT_MS = 60_000;
const RELEASE_GH_MAX_BUFFER = 4 * 1024 * 1024;
const MISSING_RELEASE_TOKEN = "falta token: ~/.config/plania/github-release-token or ~/.config/plania/github-token";
const WRITE_ACCESS_HINT = "hint: the token needs write access to contents and pull requests on this repo";

function releaseToken(env: Record<string, string | undefined>): string | null {
  const release = readTokenFile(githubReleaseTokenFilePath(env), env);
  if (release.token) return release.token;
  return readTokenFile(githubTokenFilePath(env), env).token;
}

function withWriteHint(output: string): string {
  const text = output.trim();
  if (!/\b403\b/.test(text) || text.includes("write access")) return text.slice(0, 500);
  const sep = " — ";
  const room = 500 - WRITE_ACCESS_HINT.length - sep.length;
  return `${text.slice(0, Math.max(0, room))}${sep}${WRITE_ACCESS_HINT}`;
}

function ghChildEnv(token: string | null, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, PATH: commandPath(base.PATH), GH_PROMPT_DISABLED: "1" };
  if (token) env.GH_TOKEN = token;
  else delete env.GH_TOKEN;
  return env;
}

// PLA-I2-5: with no token file, gh's own login (ghLoginOn: an install made by first start, or PLANIA_GH_FALLBACK=1)
// does the merge: gh runs with no GH_TOKEN. env and group are test seams (a fake gh, a fake home).
export async function runReleaseGh(
  args: string[],
  opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv; group?: typeof runInGroup },
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const env = opts?.env ?? process.env;
  const token = releaseToken(env);
  if (!token && !ghLoginOn(env)) throw new ToolError("RELEASE_MERGE_FAILED", { step: "token", output: MISSING_RELEASE_TOKEN });
  const result = await (opts?.group ?? runInGroup)("gh", args, {
    timeoutMs: opts?.timeoutMs ?? RELEASE_GH_TIMEOUT_MS,
    env: ghChildEnv(token, env),
    maxBuffer: RELEASE_GH_MAX_BUFFER,
  });
  if (result.ok) return { ok: true, stdout: result.stdout, stderr: result.stderr };
  const fallback = result.reason === "timeout" ? "gh timed out" : result.reason === "missing" ? "gh is not installed" : "";
  return { ok: false, stdout: result.stdout, stderr: withWriteHint((result.stderr || result.stdout || fallback).trim()) };
}

const ghCli: GhRun = (args) => runReleaseGh(args);

export const releaseGh: { run: GhRun } = { run: ghCli };

async function gh(step: string, args: string[]): Promise<string> {
  // A missing token throws RELEASE_MERGE_FAILED step "token" inside the runner, before a process.
  const r = await releaseGh.run(args);
  if (!r.ok) throw new ToolError("RELEASE_MERGE_FAILED", { step, output: withWriteHint(r.stderr) });
  return r.stdout.trim();
}

export const releaseTitle = (plan: ReleasePlan) => `Release: ${plan.tickets.map((t) => t.key).join(", ")}`;

export function releaseBody(plan: ReleasePlan): string {
  const lines = [
    `${plan.from.branch} → ${plan.into.branch}, for ${plan.env}. Shipped from Plania by the owner.`,
    "",
    ...plan.tickets.map((t) => `- ${t.key} ${t.title}${t.pr_url ? ` (${t.pr_url})` : ""}`),
  ];
  if (plan.migrations.length) lines.push("", `Migrations: ${plan.migrations.join(", ")}`);
  if (plan.migration_files.length) lines.push("", `Migration files: ${plan.migration_files.join(", ")}`);
  return lines.join("\n");
}

/** PLA-82 (F-32): how a release's migrations reach the app's local test copy: auto (Plania runs them there after a
 * backup), manual (Plania has no copy to migrate) or null (the release adds none). PLA-I68-1: this is never
 * production; who migrates production is settings.release.prod_migrations (prodMigrationUnhandled blocks the ship). */
export function migrateMode(p: { settings: { capture?: { database?: unknown } } }, plan: Pick<ReleasePlan, "migrations" | "migration_files">): "auto" | "manual" | null {
  if (!plan.migrations.length && !plan.migration_files.length) return null;
  return p.settings.capture?.database ? "auto" : "manual";
}

// Test seam: the background migration.
export const shipDeps: { migrar?: (db: Db, p: Awaited<ReturnType<typeof findProject>>, into: string, migrations: string[]) => Promise<unknown> } = {};

export async function shipRelease(db: Db, slug: string, ctx: Ctx) {
  if (!ctx.human) throw new ToolError("HUMAN_ONLY", { hint: "only the owner ships a release, from the screen" });
  const p = await findProject(db, slug);
  const plan = await releasePlan(db, p);
  if (!plan) throw new ToolError("RELEASE_NOT_READY", { reason: "no_release", hint: "the project has no settings.release" });
  if (!plan.ship.ready) throw new ToolError("RELEASE_NOT_READY", { reason: plan.ship.reason, before: plan.before.length, open_checks: plan.open_checks });
  const repo = p.settings.github!.repo;

  // An open PR from → into is reused (its title and body brought up to date); otherwise one is opened.
  const listed = JSON.parse(
    (await gh("list", ["pr", "list", "--repo", repo, "--base", plan.into.branch, "--head", plan.from.branch, "--state", "open", "--json", "number,url", "--limit", "1"])) || "[]",
  ) as { number: number; url: string }[];
  const title = releaseTitle(plan);
  const body = releaseBody(plan);
  let pr = listed[0];
  if (pr) {
    await gh("edit", ["pr", "edit", String(pr.number), "--repo", repo, "--title", title, "--body", body]);
  } else {
    const url = (await gh("create", ["pr", "create", "--repo", repo, "--base", plan.into.branch, "--head", plan.from.branch, "--title", title, "--body", body])).split("\n").pop()!.trim();
    const number = Number(url.match(/\/pull\/(\d+)/)?.[1]);
    if (!number) throw new ToolError("RELEASE_MERGE_FAILED", { step: "create", output: url.slice(0, 500) });
    pr = { number, url };
  }

  // PLA-I68-3: Camino's rule for the published branch: its required checks must be green on the release PR.
  const required = (await mergeRules(db, p)).required(plan.into.branch);
  if (required.length) {
    const rv = JSON.parse(await gh("view", ["pr", "view", String(pr.number), "--repo", repo, "--json", "statusCheckRollup"])) as { statusCheckRollup?: Rollup };
    const missing = missingChecks(required, rv.statusCheckRollup);
    if (missing.length) throw new ToolError("CAMINO_RULE_BLOCKS", { base: plan.into.branch, checks: missing });
  }
  // --match-head-commit: merge exactly the head the plan showed the owner, never one that moved since.
  await gh("merge", ["pr", "merge", String(pr.number), "--repo", repo, "--merge", ...(plan.from.head_sha ? ["--match-head-commit", plan.from.head_sha] : [])]);
  const view = JSON.parse(await gh("view", ["pr", "view", String(pr.number), "--repo", repo, "--json", "mergeCommit,url"])) as { mergeCommit: { oid: string } | null; url: string };
  const mergeSha = view.mergeCommit?.oid;
  if (!mergeSha) throw new ToolError("RELEASE_MERGE_FAILED", { step: "view", output: "the PR shows no merge commit" });

  const record = {
    from: plan.from,
    into: plan.into,
    env: plan.env,
    pr: { number: pr.number, url: view.url || pr.url },
    merge_sha: mergeSha,
    tickets: plan.tickets.map((t) => t.key),
    migrations: plan.migrations,
  };
  // PLA-82 (F-32): a release that adds migrations migrates the app's own local database after a backup, in the
  // background (src/captures/publicado.ts); the sheet already said so.
  const migrate = migrateMode(p, plan);
  await writeTx(db, p, ctx, async (_tx, emit) => {
    await emit("release.merged", null, { ...record, migration_files: plan.migration_files, migrate, prod_migrations: plan.prod_migrations });
  });
  if (migrate === "auto") {
    void import("../captures/publicado.js")
      .then(({ migrarBaseDeLaApp }) => (shipDeps.migrar ?? migrarBaseDeLaApp)(db, p, plan.into.branch, [...plan.migrations, ...plan.migration_files]))
      .catch((e) => console.log(`[release] ${p.slug}: migration not run: ${e instanceof Error ? e.message : String(e)}`));
  }
  return { merged: true, ...record, migration_files: plan.migration_files, migrate, prod_migrations: plan.prod_migrations };
}
