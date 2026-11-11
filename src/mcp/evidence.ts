import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { checks, results, tasks, type Project, type Task } from "../db/schema.js";
import { setMetricInTx } from "./blockers.js";
import { ToolError, findProject, requireTask, writeReply } from "./queries.js";
import { iso, writeTx, type Ctx, type Emit, type Q } from "./tx.js";

// Evidence as records. Anyone may add a result (the owner, a QA session, CI); In review needs one
// that fits the ticket's work_type and was recorded during the current claim.

export const RESULT_KINDS = [
  "unit", "integration", "test", "verify", "live", "grep", "subagent", "ci",
  "e2e", "visual", "a11y", "perf", "security", "migration", "scan",
] as const;
export const VERDICTS = ["pass", "warn", "fail"] as const;

// What In review accepts per work_type: a passing result of one of these kinds.
// research also accepts any result or an attached doc; decision-needed never goes to In review.
export const REVIEW_EVIDENCE: Record<string, readonly string[]> = {
  code: ["unit", "integration", "test", "live", "ci", "e2e", "visual", "a11y", "perf", "security"],
  ops: ["live", "verify", "ci", "migration", "security", "perf"],
  bug: ["unit", "integration", "test", "live", "ci", "e2e", "visual"],
  debt: ["unit", "integration", "test", "live", "ci", "grep"],
  research: RESULT_KINDS,
};

type Result = typeof results.$inferSelect;

// stale_for_head: the result's commit is no longer the branch head (the poller tracks heads); null
// when the result names no commit, or the head is unknown.
export function resultShape(r: Result, head: string | null = null) {
  const stale = r.commit && head ? !head.startsWith(r.commit) && !r.commit.startsWith(head) : null;
  return {
    id: r.id,
    kind: r.kind,
    verdict: r.verdict,
    cite: r.cite,
    url: r.url,
    commit: r.commit,
    branch: r.branch,
    env: r.env,
    command: r.command,
    exit_code: r.exitCode,
    counts: r.counts,
    duration_s: r.durationS,
    attachments: r.attachments,
    viewport: r.viewport,
    device: r.device,
    metrics: r.metrics,
    stale_for_head: stale,
    actor: r.actor,
    at: iso(r.createdAt),
  };
}

// The head of a result's branch: what the poller saw, else the newest commit any result reported on it.
export async function headFor(db: Q, t: Pick<Task, "projectId">, branch: string | null): Promise<string | null> {
  if (!branch) return null;
  const { branchHead } = await import("./branches.js");
  const known = await branchHead(db, t.projectId, branch);
  if (known) return known;
  const [latest] = await db
    .select({ commit: results.commit })
    .from(results)
    .innerJoin(tasks, eq(tasks.id, results.taskId))
    .where(and(eq(tasks.projectId, t.projectId), eq(results.branch, branch), sql`${results.commit} is not null`))
    .orderBy(desc(results.createdAt))
    .limit(1);
  return latest?.commit ?? null;
}

// 2.11 (fix d): each result also says which of this task's checks it ticked (checks.evidence_id),
// so the sheet's timeline can show "☑ 2, 3" on the row.
export async function taskResults(db: Q, t: Pick<Task, "id" | "projectId" | "branch">) {
  const rows = await db.select().from(results).where(eq(results.taskId, t.id)).orderBy(asc(results.createdAt));
  const ticked = await db
    .select({ n: checks.n, evidenceId: checks.evidenceId })
    .from(checks)
    .where(and(eq(checks.taskId, t.id), isNotNull(checks.evidenceId)))
    .orderBy(asc(checks.n));
  const heads = new Map<string, string | null>();
  const out = [];
  for (const r of rows) {
    const b = r.branch ?? t.branch ?? null;
    if (b && !heads.has(b)) heads.set(b, await headFor(db, t, b));
    out.push({ ...resultShape(r, b ? (heads.get(b) ?? null) : null), ticked_checks: ticked.filter((c) => c.evidenceId === r.id).map((c) => c.n) });
  }
  return out;
}

// Throws EVIDENCE_REQUIRED unless the ticket may enter In review, or EVIDENCE_STALE when every
// fitting pass names a commit the branch has moved past. hasDoc is for research tickets.
export async function assertReviewEvidence(tx: Q, t: Task, hasDoc: (tx: Q, t: Task) => Promise<boolean>): Promise<void> {
  const workType = t.workType ?? "code";
  if (workType === "decision-needed") {
    throw new ToolError("EVIDENCE_REQUIRED", { work_type: workType, hint: "a decision is answered (ask/answer), not reviewed" });
  }
  const accepts = REVIEW_EVIDENCE[workType] ?? REVIEW_EVIDENCE.code!;
  const where = [eq(results.taskId, t.id), inArray(results.kind, [...accepts])];
  if (workType !== "research") where.push(eq(results.verdict, "pass"));
  // Evidence counts from the current claim on; a new session proves its own work.
  if (t.claimedAt) where.push(gte(results.createdAt, t.claimedAt));
  const found = await tx.select().from(results).where(and(...where)).orderBy(desc(results.createdAt));
  if (found.length) {
    const fresh = [];
    for (const r of found) {
      const b = r.branch ?? t.branch ?? null;
      const head = b ? await headFor(tx, t, b) : null;
      if (resultShape(r, head).stale_for_head !== true) fresh.push(r);
    }
    if (fresh.length) return;
    const branch = found[0]!.branch ?? t.branch;
    const head = await headFor(tx, t, branch ?? null);
    const named = [...new Set(found.map((r) => r.commit?.slice(0, 7)).filter(Boolean))].join(", ");
    throw new ToolError("EVIDENCE_STALE", {
      branch,
      head,
      results: found.map((r) => ({ id: r.id, kind: r.kind, commit: r.commit })),
      // 2.13: say what moved, so the fix is obvious: the branch went on past the commit the passes name.
      hint: `${branch} is at ${head?.slice(0, 7) ?? "?"} (what the GitHub poller last saw, else the newest commit a result named), but your passes name ${named}; run the checks again at ${head?.slice(0, 7) ?? "the head"} and add a pass with that commit`,
    });
  }
  if (workType === "research" && (await hasDoc(tx, t))) return;
  throw new ToolError("EVIDENCE_REQUIRED", {
    work_type: workType,
    accepts: workType === "research" ? "any result, or a doc (attach_doc)" : accepts.map((k) => `${k} pass`),
    since: iso(t.claimedAt),
  });
}

// R-14: evidence may come from any task of the project (an initiative check proven by a child's result).
export async function validateEvidence(tx: Q, t: Task, id: string): Promise<{ source: string }> {
  const [r] = await tx
    .select({ id: results.id, key: tasks.key })
    .from(results)
    .innerJoin(tasks, eq(tasks.id, results.taskId))
    .where(and(eq(tasks.projectId, t.projectId), sql`${results.id}::text = ${id}`))
    .limit(1);
  if (!r) throw new ToolError("RESULT_NOT_FOUND", { evidence_id: id });
  return { source: r.key };
}

export type AddResultInput = {
  project: string;
  key: string;
  kind: string;
  verdict: string;
  cite: string;
  url?: string;
  check_ns?: number[];
  commit?: string;
  branch?: string;
  env?: string;
  command?: string;
  exit_code?: number;
  counts?: { pass?: number; fail?: number; skip?: number };
  duration_s?: number;
  attachments?: string[];
  viewport?: string;
  device?: string;
  metrics?: Record<string, number>;
};

const SHA = /^[0-9a-f]{7,40}$/;

export async function addResultInTx(tx: Q, emit: Emit, p: Project, input: AddResultInput, ctx: Ctx) {
  if (!(RESULT_KINDS as readonly string[]).includes(input.kind)) throw new ToolError("INVALID_RESULT", { field: "kind", allowed: RESULT_KINDS });
  if (!(VERDICTS as readonly string[]).includes(input.verdict)) throw new ToolError("INVALID_RESULT", { field: "verdict", allowed: VERDICTS });
  if (!input.cite.trim()) throw new ToolError("INVALID_RESULT", { field: "cite" });
  if (input.check_ns?.length && input.verdict !== "pass") throw new ToolError("INVALID_RESULT", { field: "check_ns", hint: "only a pass ticks checks" });
  const commit = input.commit?.trim().toLowerCase();
  if (commit !== undefined && !SHA.test(commit)) throw new ToolError("INVALID_RESULT", { field: "commit", hint: "7-40 hex" });
  if (input.exit_code !== undefined && !Number.isInteger(input.exit_code)) throw new ToolError("INVALID_RESULT", { field: "exit_code" });
  if (input.duration_s !== undefined && (!Number.isInteger(input.duration_s) || input.duration_s < 0)) throw new ToolError("INVALID_RESULT", { field: "duration_s" });
  if (input.counts) {
    for (const [k, v] of Object.entries(input.counts)) {
      if (!["pass", "fail", "skip"].includes(k) || !Number.isInteger(v) || (v as number) < 0) throw new ToolError("INVALID_RESULT", { field: "counts", hint: "{pass, fail, skip} as counts" });
    }
  }
  if (input.attachments?.some((a) => !/^https?:\/\//.test(a))) throw new ToolError("INVALID_RESULT", { field: "attachments", hint: "links only (https://...)" });
  if (input.metrics) {
    for (const [k, v] of Object.entries(input.metrics)) {
      if (!/^[a-z][a-z0-9_-]{0,39}$/.test(k) || !Number.isInteger(v)) throw new ToolError("INVALID_RESULT", { field: "metrics", hint: "{name: integer}" });
    }
  }
  const t = await requireTask(tx, p.id, input.key);
  const [r] = await tx
    .insert(results)
    .values({
      taskId: t.id,
      kind: input.kind,
      verdict: input.verdict,
      cite: input.cite,
      url: input.url ?? null,
      commit: commit ?? null,
      branch: input.branch?.trim() || null,
      env: input.env?.trim() || null,
      command: input.command ?? null,
      exitCode: input.exit_code ?? null,
      counts: input.counts ?? null,
      durationS: input.duration_s ?? null,
      attachments: input.attachments ?? [],
      viewport: input.viewport ?? null,
      device: input.device ?? null,
      metrics: input.metrics ?? null,
      actor: ctx.actor,
    })
    .returning();
  // Reported metrics feed metric_gte blockers.
  for (const [name, value] of Object.entries(input.metrics ?? {})) await setMetricInTx(tx, emit, p.id, name, value, ctx.actor);
  const ticked: number[] = [];
  for (const n of new Set(input.check_ns ?? [])) {
    const [c] = await tx
      .update(checks)
      .set({ done: true, doneAt: sql`now()`, doneBy: ctx.actor, evidenceId: r!.id })
      .where(and(eq(checks.taskId, t.id), eq(checks.n, n)))
      .returning();
    if (!c) throw new ToolError("CHECK_NOT_FOUND", { n });
    ticked.push(n);
  }
  const [u] = (await tx.update(tasks).set({ updatedAt: sql`now()` }).where(eq(tasks.id, t.id)).returning()) as [Task];
  await emit("result.added", u, {
    result_id: r!.id,
    kind: r!.kind,
    verdict: r!.verdict,
    cite: r!.cite,
    url: r!.url,
    ...(commit ? { commit } : {}),
    ...(r!.branch ? { branch: r!.branch } : {}),
    checks: ticked,
  });
  const head = await headFor(tx, t, r!.branch ?? t.branch ?? null);
  return writeReply(tx, u, ctx, ticked.length ? ["results", "checks"] : ["results"], { result: resultShape(r!, head) });
}

export async function addResult(db: Db, input: AddResultInput, ctx: Ctx) {
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, (tx, emit) => addResultInTx(tx, emit, p, input, ctx));
}
