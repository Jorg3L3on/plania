import { execFile } from "node:child_process";
import type { Db } from "../db/client.js";
import { commandPath } from "../jobs/machine/run.js";
import { ToolError, findProject } from "./queries.js";
import { releasePlan, type ReleasePlan } from "./release-plan.js";
import { writeTx, type Ctx } from "./tx.js";

// 2.13 (item 2, phase two): Jorge ships the release from the screen. In settings.release.mode "merge"
// the server opens (or reuses) a PR from → into titled "Release: <keys>", merges it with
// `gh pr merge --merge` (a merge commit: history kept, and the pinned decisions hold because the click
// is Jorge's), and writes release.merged with the merge sha. The GitHub poller then sees into contain
// from (release.shipped) and the deploy poller moves the tickets to Released. Agents never get here:
// the route is the screen's alone and shipRelease refuses anything but a human ctx.

// gh through execFile (no shell), with the gh CLI's own login (Jorge's keyring). Tests replace
// releaseGh.run so no real gh ever runs against a repo.
export type GhRun = (args: string[]) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

const ghCli: GhRun = (args) =>
  new Promise((resolve) => {
    execFile("gh", args, { env: { ...process.env, PATH: commandPath() }, timeout: 60_000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout ?? "", stderr: (stderr || (err ? err.message : "")).trim() });
    });
  });

export const releaseGh: { run: GhRun } = { run: ghCli };

async function gh(step: string, args: string[]): Promise<string> {
  const r = await releaseGh.run(args);
  if (!r.ok) throw new ToolError("RELEASE_MERGE_FAILED", { step, output: r.stderr.slice(0, 500) });
  return r.stdout.trim();
}

export const releaseTitle = (plan: ReleasePlan) => `Release: ${plan.tickets.map((t) => t.key).join(", ")}`;

export function releaseBody(plan: ReleasePlan): string {
  const lines = [
    `${plan.from.branch} → ${plan.into.branch}, for ${plan.env}. Shipped from Plania by Jorge.`,
    "",
    ...plan.tickets.map((t) => `- ${t.key} ${t.title}${t.pr_url ? ` (${t.pr_url})` : ""}`),
  ];
  if (plan.migrations.length) lines.push("", `Migrations: ${plan.migrations.join(", ")}`);
  return lines.join("\n");
}

export async function shipRelease(db: Db, slug: string, ctx: Ctx) {
  if (!ctx.human) throw new ToolError("HUMAN_ONLY", { hint: "only Jorge ships a release, from the screen" });
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

  // --match-head-commit: merge exactly the head the plan showed Jorge, never one that moved since.
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
  await writeTx(db, p, ctx, async (_tx, emit) => {
    await emit("release.merged", null, record);
  });
  return { merged: true, ...record };
}
