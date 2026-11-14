// PLA-I43-1: Send to Plania (spec §6.4, §7.2, §7.3, §11, decisions D3 and D7).
// The owner picks idea codes on /brief. The server groups them by project (X ideas go to the home project,
// PLANIA_HOME_PROJECT), finds each project's product-owner bot the way idleProposals() does, and for each group
// posts the rendered po-plan-ideas.md in that project's thread and queues one event wake of its PO with
// enqueueWake(). No claude -p of its own: the PO runs in the runner's single slot with its own role prompt.
// - One brief_plan_requests row per brief: sending more codes from the same brief adds targets to it, so the
//   request id the PO writes with (brief-plan:<request>:<code>:<step>) stays the same on a resend.
// - At most BATCH ideas per run. A project with more gets follow-up targets; the next one is posted and woken
//   only once the earlier run of that project ended (enqueueWake coalesces a busy agent anyway).
// - The message and the wake are one transaction (insertMessage + enqueueWake in one writeTx): neither happens
//   without the other, and never twice.
// - D7: a paused project or a paused company is respected. The target is stored waiting_paused with no message
//   and no wake; resumeWaiting(), called on every asistente tick, posts and wakes it once runs are back on.
//   enqueueWake is unchanged.
// - No PO for the project: the target fails with "no product-owner bot for <slug>". The others go on.
import { hostname } from "node:os";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, briefPlanRequests, morningBriefs, projects, type Agent, type BriefPlanRequest, type BriefPlanStatus, type BriefPlanTarget, type Project } from "../db/schema.js";
import { writeTx, type Q } from "../mcp/tx.js";
import { enqueueWake } from "../runner/events.js";
import { loadSettings, roleOf } from "../runner/limits.js";
import { MAX_BODY, homeSlug, insertMessage, projectThread } from "../runner/threads.js";
import { poPlanIdeasPrompt, type PlanIdea } from "./prompts.js";
import { Idea } from "./types.js";

/** Ideas per PO run (spec §6.4). */
export const BATCH = 3;
/** One full planning run, in minutes (spec §15): the page's "about X–Y min". */
export const RUN_MINUTES = [10, 25] as const;
export const MAX_CODES = 30;
const CODE = /^[A-Z]\d{1,3}$/;
const RUNNER_ADAPTER = "claude_code";
const AUTHOR = { agent: "asistente", role: "asistente" } as const;
const PLAN_ACTOR = { agent: "asistente", session_id: "brief-plan" } as const;
const ENDED_OK = new Set(["ok"]);
const ENDED_BAD = new Set(["fail", "skipped", "stopped"]);
const FINAL = new Set<BriefPlanTarget["state"]>(["done", "failed"]);

export class PlanError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

const ctx = (tool: string) => ({ actor: { ...PLAN_ACTOR, machine: hostname() }, tool });
const stamp = (now: Date) => now.toISOString();

// ---- Grouping

export type PlanGroup = { slug: string; codes: string[]; ideas: Idea[] };

/** Normalizes the chosen codes: trimmed, upper case, deduplicated, in the order given. */
export function normalizeCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new PlanError("INVALID_CODES", 400, { hint: "codes is a list like [\"W1\", \"Z3\"]" });
  const out: string[] = [];
  for (const c of raw) {
    const code = typeof c === "string" ? c.trim().toUpperCase() : "";
    if (!CODE.test(code)) throw new PlanError("INVALID_CODES", 400, { code: String(c).slice(0, 20) });
    if (!out.includes(code)) out.push(code);
  }
  if (!out.length || out.length > MAX_CODES) throw new PlanError("INVALID_CODES", 400, { hint: `1 to ${MAX_CODES} codes` });
  return out;
}

/** The target project of an idea: its app, or the home project for a cross-app (X) idea. */
export const targetSlug = (idea: Pick<Idea, "app">, home: string): string => (idea.app === "cross" ? home : idea.app);

/**
 * Codes grouped by target project, in the order the owner chose them, each group cut into runs of at most BATCH
 * ideas. W1, Z3, W2, X1 with home plania → [workia W1 W2], [zigzag Z3], [plania X1].
 */
export function groupCodes(ideas: Idea[], codes: string[], home: string): PlanGroup[] {
  const byCode = new Map(ideas.map((i) => [i.code, i]));
  const unknown = codes.filter((c) => !byCode.has(c));
  if (unknown.length) throw new PlanError("UNKNOWN_CODES", 400, { codes: unknown });
  const bySlug = new Map<string, Idea[]>();
  for (const code of codes) {
    const idea = byCode.get(code)!;
    const slug = targetSlug(idea, home);
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), idea]);
  }
  const out: PlanGroup[] = [];
  for (const [slug, list] of bySlug) {
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH);
      out.push({ slug, codes: chunk.map((x) => x.code), ideas: chunk });
    }
  }
  return out;
}

// ---- The product owner

/** A project's PO bot, like idleProposals(): its team's product owner, else a company-level po-<slug> or capability. */
export async function poFor(db: Q, project: Pick<Project, "id" | "slug">): Promise<Agent | null> {
  const rows = await db.select().from(agents).where(and(eq(agents.adapter, RUNNER_ADAPTER), sql`${agents.status} <> 'retired'`)).orderBy(asc(agents.slug));
  const pos = rows.filter((a) => roleOf(a) === "product-owner");
  return pos.find((a) => a.projectId === project.id) ?? pos.find((a) => !a.projectId && (a.slug === `po-${project.slug}` || a.capabilities.includes(project.slug))) ?? null;
}

// ---- The message and the wake reason

const planIdea = (i: Idea): PlanIdea => ({ code: i.code, title: i.title, why: i.why, flags: i.flags, source: i.source });

/** The "Plan these ideas" message (po-plan-ideas.md). Whys are shortened only when the message would not fit a thread message. */
export function planMessage(v: { briefDate: string; requestId: string; projectSlug: string; ideas: Idea[] }): string {
  const render = (ideas: PlanIdea[]) => poPlanIdeasPrompt({ briefDate: v.briefDate, requestId: v.requestId, projectSlug: v.projectSlug, ideas });
  let ideas = v.ideas.map(planIdea);
  let body = render(ideas);
  for (let cap = 300; body.length > MAX_BODY && cap >= 40; cap -= 60) {
    ideas = ideas.map((i) => ({ ...i, why: i.why.length > cap ? `${i.why.slice(0, cap - 1).trimEnd()}…` : i.why }));
    body = render(ideas);
  }
  return body;
}

/** The wake reason (spec §6.4): stored in agent_runs.summary, shown to the PO as "Why you woke: …". */
export function wakeReason(requestId: string, codes: string[]): string {
  return `brief plan ${requestId}: the owner chose ideas ${codes.join(", ")} in the Morning brief. Read your project thread (thread_read) for the message "Plan these ideas" and plan them fully. Planned only: tickets in Backlog, never Ready.`.slice(0, 480);
}

// ---- Request status

export function requestStatus(targets: BriefPlanTarget[]): BriefPlanStatus {
  if (!targets.length || targets.some((t) => !FINAL.has(t.state))) return "open";
  if (targets.every((t) => t.state === "done")) return "done";
  if (targets.every((t) => t.state === "failed")) return "failed";
  return "partial";
}

// ---- Sending

export type SendResult = {
  request_id: string;
  targets: { slug: string; po_agent: string; codes: string[]; state: BriefPlanTarget["state"]; note: string | null }[];
  /** PO runs this send queues or will queue (waiting ones included); 0 when everything was already sent. */
  runs: number;
  estimate_min: [number, number];
  already_sent: string[];
};

export const estimate = (runs: number): [number, number] => [runs * RUN_MINUTES[0], runs * RUN_MINUTES[1]];

/**
 * POST /api/brief/plan. Adds the chosen codes to the brief's request (made on first send), re-queues a failed target
 * whose codes are chosen again (alone: its siblings keep their state), then posts and wakes what can go now.
 * Codes already sent and not failed are left alone (already_sent).
 */
export async function sendToPlania(db: Db, input: { briefId: string; codes: unknown }, opts: { env?: NodeJS.ProcessEnv; now?: Date } = {}): Promise<SendResult> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const codes = normalizeCodes(input.codes);
  if (!/^[0-9a-f-]{36}$/i.test(input.briefId)) throw new PlanError("BRIEF_NOT_FOUND", 404);
  const [brief] = await db.select().from(morningBriefs).where(eq(morningBriefs.id, input.briefId)).limit(1);
  if (!brief) throw new PlanError("BRIEF_NOT_FOUND", 404);
  const ideas = (Array.isArray(brief.data.ideas) ? (brief.data.ideas as unknown[]) : []).flatMap((r) => {
    const p = Idea.safeParse(r);
    return p.success ? [p.data] : [];
  });
  const home = homeSlug(env);
  groupCodes(ideas, codes, home); // throws UNKNOWN_CODES before anything is written

  const touched: number[] = [];
  const alreadySent: string[] = [];
  const requestId = await db.transaction(async (tx) => {
    // One request per brief, even when two sends race.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`brief_plan:${brief.id}`}))`);
    const [existing] = await tx.select().from(briefPlanRequests).where(eq(briefPlanRequests.briefId, brief.id)).orderBy(asc(briefPlanRequests.createdAt)).limit(1);
    const targets: BriefPlanTarget[] = existing ? structuredClone(existing.targets) : [];
    const fresh: string[] = [];
    for (const code of codes) {
      const i = targets.findIndex((t) => t.codes.includes(code));
      if (i < 0) fresh.push(code);
      else if (targets[i]!.state === "failed") {
        if (!touched.includes(i)) {
          targets[i] = { ...targets[i]!, state: "queued", wake_run_id: null, message_id: null, note: null, results: [], updated_at: stamp(now) };
          touched.push(i);
        }
      } else alreadySent.push(code);
    }
    for (const g of groupCodes(ideas, fresh, home)) {
      touched.push(targets.length);
      targets.push({ slug: g.slug, po_agent: "", codes: g.codes, wake_run_id: null, message_id: null, state: "queued", note: null, results: [], updated_at: stamp(now) });
    }
    const allCodes = [...new Set([...(existing?.codes ?? []), ...codes])];
    const chosen = ideas.filter((i) => allCodes.includes(i.code)).map((i) => ({ ...i }));
    if (existing) {
      await tx.update(briefPlanRequests).set({ codes: allCodes, ideas: chosen, targets, status: requestStatus(targets), updatedAt: now }).where(eq(briefPlanRequests.id, existing.id));
      return existing.id;
    }
    const [row] = await tx.insert(briefPlanRequests).values({ briefId: brief.id, codes: allCodes, ideas: chosen, targets, status: "open", createdAt: now, updatedAt: now }).returning({ id: briefPlanRequests.id });
    return row!.id;
  });

  const after = await advanceRequest(db, requestId, { now });
  const sent = touched.map((i) => after.targets[i]!);
  const runs = sent.filter((t) => t.state !== "failed").length;
  return {
    request_id: requestId,
    targets: sent.map((t) => ({ slug: t.slug, po_agent: t.po_agent, codes: t.codes, state: t.state, note: t.note ?? null })),
    runs,
    estimate_min: estimate(runs),
    already_sent: alreadySent,
  };
}

// ---- Moving targets along (on send and on every asistente tick)

type Advance = { posted: number; failed: number; finished: number };

/** Follows each target's run, and posts + wakes the ones that can go now. Returns the request as stored. */
export async function advanceRequest(db: Db, requestId: string, opts: { now?: Date; counts?: Advance } = {}): Promise<BriefPlanRequest> {
  const now = opts.now ?? new Date();
  const counts = opts.counts ?? { posted: 0, failed: 0, finished: 0 };
  const [first] = await db.select().from(briefPlanRequests).where(eq(briefPlanRequests.id, requestId)).limit(1);
  if (!first) throw new PlanError("PLAN_NOT_FOUND", 404);
  const [brief] = await db.select({ localDate: morningBriefs.localDate }).from(morningBriefs).where(eq(morningBriefs.id, first.briefId)).limit(1);

  for (let i = 0; i < first.targets.length; i += 1) {
    const slug = first.targets[i]!.slug;
    const [project] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (!project) {
      await patchTarget(db, requestId, i, now, (t) => (FINAL.has(t.state) ? null : { ...t, state: "failed", note: `no project ${slug}` }));
      continue;
    }
    // Each target is read and changed under the write lock, so a tick and a send never post or wake it twice.
    await writeTx(db, project, ctx("brief.plan"), async (tx, emit) => {
      const [row] = await tx.select().from(briefPlanRequests).where(eq(briefPlanRequests.id, requestId)).for("update").limit(1);
      if (!row) return;
      const targets = structuredClone(row.targets);
      const t = targets[i]!;
      if (FINAL.has(t.state)) return;
      const save = async (next: BriefPlanTarget) => {
        targets[i] = { ...next, updated_at: stamp(now) };
        await tx.update(briefPlanRequests).set({ targets, status: requestStatus(targets), updatedAt: now }).where(eq(briefPlanRequests.id, requestId));
      };

      // Already woken: follow its run.
      if (t.wake_run_id) {
        const [run] = await tx.select({ status: agentRuns.status, summary: agentRuns.summary }).from(agentRuns).where(eq(agentRuns.id, t.wake_run_id)).limit(1);
        const state: BriefPlanTarget["state"] = !run ? "failed" : ENDED_OK.has(run.status) ? "done" : ENDED_BAD.has(run.status) ? "failed" : run.status === "running" ? "running" : "queued";
        if (state === t.state) return;
        const note = state === "failed" ? (run ? `run ${run.status}: ${run.summary}`.slice(0, 300) : "the run is gone") : t.note ?? null;
        if (FINAL.has(state)) counts.finished += 1;
        await save({ ...t, state, note });
        return;
      }

      // An earlier run for this project goes first: one PO run at a time per project, follow-ups after it.
      const earlier = targets.slice(0, i).some((o) => o.slug === t.slug && !FINAL.has(o.state));
      if (earlier) {
        if (t.state !== "queued" || t.note !== "after the earlier run") await save({ ...t, state: "queued", note: "after the earlier run" });
        return;
      }

      const po = await poFor(tx, project);
      if (!po) {
        counts.failed += 1;
        await save({ ...t, state: "failed", note: `no product-owner bot for ${slug}` });
        return;
      }
      // D7: respect the pause. No message, no wake, until runs are back on.
      const settings = await loadSettings(tx);
      const [p] = await tx.select({ paused: projects.runsPaused }).from(projects).where(eq(projects.id, project.id)).limit(1);
      const paused = settings.companyPaused ? "company runs are paused" : p?.paused ? `${project.title} runs are paused` : null;
      if (paused) {
        if (t.state !== "waiting_paused" || t.note !== paused || t.po_agent !== po.slug) await save({ ...t, po_agent: po.slug, state: "waiting_paused", note: paused });
        return;
      }

      const out = await enqueueWake(tx, { agent: po, project, taskKey: null, reason: wakeReason(requestId, t.codes), now });
      if (out.kind !== "queued") {
        // Coalesced: the PO has a run queued or going; this one is posted and woken once it ends.
        const note = out.reason === "coalesced" ? `waiting for ${po.slug}'s current run` : /paused/.test(out.reason) ? out.reason.replace(/^project (\S+) paused$/, `${project.title} runs are paused`) : out.reason;
        const state: BriefPlanTarget["state"] = out.reason === "coalesced" ? "queued" : /paused/.test(out.reason) ? "waiting_paused" : "failed";
        if (state === "failed") counts.failed += 1;
        if (state !== t.state || note !== t.note || t.po_agent !== po.slug) await save({ ...t, po_agent: po.slug, state, note });
        return;
      }
      const ideaRows = (row.ideas as unknown[]).flatMap((r) => {
        const parsed = Idea.safeParse(r);
        return parsed.success && t.codes.includes(parsed.data.code) ? [parsed.data] : [];
      });
      const ideas = t.codes.map((c) => ideaRows.find((x) => x.code === c)).filter((x): x is Idea => !!x);
      const body = planMessage({ briefDate: brief?.localDate ?? stamp(now).slice(0, 10), requestId, projectSlug: project.slug, ideas });
      const thread = await projectThread(tx, project.id);
      const msg = await insertMessage(tx, emit, { thread, project }, { author: AUTHOR, body, links: [{ kind: "brief_plan", ref: requestId, title: `Plan ${t.codes.join(", ")}` }] });
      await emit("wake.queued", null, { agent: out.agent, role: out.role, reason: out.reason, run_id: out.runId, from_event: "brief.plan" });
      counts.posted += 1;
      await save({ ...t, po_agent: po.slug, state: "queued", wake_run_id: out.runId, message_id: msg.id, note: null });
    });
  }
  const [after] = await db.select().from(briefPlanRequests).where(eq(briefPlanRequests.id, requestId)).limit(1);
  return after!;
}

async function patchTarget(db: Db, requestId: string, i: number, now: Date, fn: (t: BriefPlanTarget) => BriefPlanTarget | null): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(briefPlanRequests).where(eq(briefPlanRequests.id, requestId)).for("update").limit(1);
    if (!row) return;
    const targets = structuredClone(row.targets);
    const next = fn(targets[i]!);
    if (!next) return;
    targets[i] = { ...next, updated_at: stamp(now) };
    await tx.update(briefPlanRequests).set({ targets, status: requestStatus(targets), updatedAt: now }).where(eq(briefPlanRequests.id, requestId));
  });
}

/**
 * D7, on every asistente tick: every open request is moved along. A waiting_paused target whose project (and the
 * company) runs again is posted and woken once; a finished run moves its target to done or failed and lets the
 * project's next batch go.
 */
export async function resumeWaiting(db: Db, now = new Date()): Promise<Advance> {
  const counts: Advance = { posted: 0, failed: 0, finished: 0 };
  const open = await db.select({ id: briefPlanRequests.id }).from(briefPlanRequests).where(eq(briefPlanRequests.status, "open")).orderBy(asc(briefPlanRequests.createdAt));
  for (const r of open) await advanceRequest(db, r.id, { now, counts });
  return counts;
}

// ---- Progress (GET /api/brief/plan/:id)

export type PlanProgress = {
  id: string;
  brief_id: string;
  status: BriefPlanStatus;
  codes: string[];
  created_at: string;
  updated_at: string;
  targets: (BriefPlanTarget & { project: string; run: { status: string; started_at: string | null; ended_at: string | null } | null })[];
  ideas: { code: string; slug: string; project: string; title: string; state: BriefPlanTarget["state"]; note: string | null; result: BriefPlanTarget["results"][number] | null }[];
};

export async function planProgress(db: Q, id: string): Promise<PlanProgress> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new PlanError("PLAN_NOT_FOUND", 404);
  const [row] = await db.select().from(briefPlanRequests).where(eq(briefPlanRequests.id, id)).limit(1);
  if (!row) throw new PlanError("PLAN_NOT_FOUND", 404);
  const slugs = [...new Set(row.targets.map((t) => t.slug))];
  const titles = new Map((slugs.length ? await db.select({ slug: projects.slug, title: projects.title }).from(projects).where(inArray(projects.slug, slugs)) : []).map((p) => [p.slug, p.title]));
  const runIds = row.targets.map((t) => t.wake_run_id).filter((x): x is string => !!x);
  const runs = new Map(
    (runIds.length ? await db.select({ id: agentRuns.id, status: agentRuns.status, startedAt: agentRuns.startedAt, endedAt: agentRuns.endedAt }).from(agentRuns).where(inArray(agentRuns.id, runIds)) : []).map((r) => [
      r.id,
      { status: r.status, started_at: r.startedAt?.toISOString() ?? null, ended_at: r.endedAt?.toISOString() ?? null },
    ]),
  );
  const ideaTitles = new Map((row.ideas as { code?: string; title?: string }[]).map((i) => [String(i.code), String(i.title ?? "")]));
  const targets = row.targets.map((t) => ({ ...t, project: titles.get(t.slug) ?? t.slug, run: t.wake_run_id ? (runs.get(t.wake_run_id) ?? null) : null }));
  const ideas = targets.flatMap((t) =>
    t.codes.map((code) => ({ code, slug: t.slug, project: t.project, title: ideaTitles.get(code) ?? "", state: t.state, note: t.note ?? null, result: t.results.find((r) => r.code === code) ?? null })),
  );
  ideas.sort((a, b) => row.codes.indexOf(a.code) - row.codes.indexOf(b.code));
  return { id: row.id, brief_id: row.briefId, status: row.status, codes: row.codes, created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(), targets, ideas };
}

/** The newest request of a brief, for the page after a reload. */
export async function planOfBrief(db: Q, briefId: string): Promise<string | null> {
  const [row] = await db.select({ id: briefPlanRequests.id }).from(briefPlanRequests).where(eq(briefPlanRequests.briefId, briefId)).orderBy(asc(briefPlanRequests.createdAt)).limit(1);
  return row?.id ?? null;
}
