// PLA-I46-9: the QA lane. A code delivery (a ticket In review with a PR) on a project with a QA teammate gets one
// pass before the floor says «te toca»:
//   1. the project's verify list (settings.qa.verify: test, typecheck, lint), run in the delivery's checkout
//   2. captures of the running test copy (settings.capture), the app started on a free port for the pass
//   3. a review by the QA agent in a fresh session (never resumed, so it has not seen Taller's reasoning)
//   4. the PO's check list for the ticket (tasks.po_checklist), each item marked pass or fail by that agent
// Steps 1 and 2 are Plania's own code (no tokens). Step 3 and 4 are one QA run, queued through the runner, so the
// switches, the plan guard (usage hold) and the cap stop it like any other run; a run a hold skipped or stopped
// is queued again once the runner's checks say it would start. A failing pass on attempt 1 sends the ticket back
// to Taller with exact notes (In review → Ready, the delivery card marked devuelta); a later failure stays on the
// floor for the owner with a hold. Results go to the ticket as results (stills are capture_stills rows tied to
// the ticket). Nothing is written to the app repo: the QA run is denied edits, commits and pushes, and the lane
// records the head before and after.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { hostname } from "node:os";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  agentRuns,
  agents,
  events,
  projects,
  pullRequests,
  qaLanes,
  tasks,
  threadMessages,
  threads,
  type Actor,
  type Agent,
  type PoCheck,
  type Project,
  type QaCapture,
  type QaLane,
  type QaMark,
  type QaReview,
  type QaVerifyItem,
  type Task,
} from "../db/schema.js";
import { runCapture, checkoutEnv, shellExec, type CaptureDeps, type CaptureInput, type CaptureSummary, type Exec } from "../captures/run.js";
import { imageUrl } from "../captures/store.js";
import { addResult, type AddResultInput } from "../mcp/evidence.js";
import { ToolError } from "../mcp/errors.js";
import { SYSTEM_ACTOR, type Ctx } from "../mcp/tx.js";
import { setTask } from "../mcp/writes.js";
import { enqueueWake, serviceAgent } from "./events.js";
import { loadSettings } from "./limits.js";
import { modelFor, type QaSettings } from "./qa-settings.js";
import { canStart, type RunnerDeps } from "./runner.js";
import { ALLOWED_BASE, branchFor, defaultGit, ensureWorktree, repoPathOf, worktreeRoot, type GitFn } from "./worktree.js";

export const QA_WORK = new Set(["code", "bug", "debt"]);
export const QA_REASON = "qa lane";
const ACTIVE = ["queued", "checking", "reviewing"] as const;
const MAX_REVIEW_TRIES = 2;
const CHECKLIST_MAX = 3;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const SHA = /^[0-9a-f]{7,40}$/;

export type StartedApp = { ok: boolean; error: string | null; stop: () => Promise<void> };
export type StartApp = (input: { cwd: string; command: string; url: string; port: number; timeoutMs: number }) => Promise<StartedApp>;

export type QaDeps = {
  exec?: Exec;
  git?: GitFn;
  env?: NodeJS.ProcessEnv;
  worktreeRoot?: string;
  startApp?: StartApp;
  capture?: (db: Db, input: CaptureInput, deps?: CaptureDeps) => Promise<CaptureSummary>;
  captureDeps?: CaptureDeps;
  freePort?: () => Promise<number>;
  readLog?: (path: string) => string | null;
  runner?: RunnerDeps;
  // Where the PNGs are served, for result attachments (results take absolute links only).
  publicUrl?: string;
};

const qaActor = (agent: string | null): Actor => ({ agent: agent ?? "qa", session_id: "qa-lane", machine: hostname() });
const qaCtx = (agent: string | null, tool: string): Ctx => ({ actor: qaActor(agent), tool });
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "?");
const sameCommit = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));

// ---- Who and what

/** The project's QA agent when the lane applies to the project: a runner QA on its team (or a company-level one
 *  with settings.qa.enabled true), and settings.qa.enabled not false. */
export async function qaAgentOf(db: Db, p: Project): Promise<Agent | null> {
  if (p.settings.qa?.enabled === false) return null;
  const a = await serviceAgent(db, "qa", { id: p.id, slug: p.slug });
  if (!a) return null;
  if (a.projectId !== p.id && p.settings.qa?.enabled !== true) return null;
  return a;
}

export const qaTicket = (t: Pick<Task, "kind" | "workType" | "title">) => t.kind === "ticket" && QA_WORK.has(t.workType ?? "code") && !t.title.includes("[PRUEBA]");

async function prHead(db: Db, t: Task): Promise<{ url: string | null; head: string | null; branch: string | null }> {
  const [pr] = await db
    .select({ url: pullRequests.url, head: pullRequests.headSha, branch: pullRequests.headBranch })
    .from(pullRequests)
    .where(t.prUrl ? eq(pullRequests.url, t.prUrl) : eq(pullRequests.taskId, t.id))
    .orderBy(desc(pullRequests.updatedAt))
    .limit(1);
  return { url: pr?.url ?? t.prUrl ?? null, head: pr?.head ?? null, branch: pr?.branch ?? null };
}

export async function latestLane(db: Db, taskId: string): Promise<QaLane | null> {
  const [l] = await db.select().from(qaLanes).where(eq(qaLanes.taskId, taskId)).orderBy(desc(qaLanes.createdAt)).limit(1);
  return l ?? null;
}

// ---- The PO's check list (tasks.po_checklist: the plan writes it on Aceptar plan, the owner may edit it here)

export async function poChecksOf(db: Db, taskId: string): Promise<PoCheck[]> {
  const [t] = await db.select({ list: tasks.poChecklist }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return [...(t?.list ?? [])].sort((a, b) => a.n - b.n);
}

/** Replaces a ticket's check list with up to three items (n = 1..3 in order). An empty list clears it. A line whose
 *  text did not change keeps its done mark. */
export async function setPoChecks(db: Db, input: { project: string; key: string; items: string[] }, actor: Actor): Promise<PoCheck[]> {
  const items = input.items.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (items.length > CHECKLIST_MAX) throw new ToolError("INVALID_FILTER", { field: "items", hint: `at most ${CHECKLIST_MAX} things to verify` });
  if (items.some((s) => s.length > 300)) throw new ToolError("INVALID_FILTER", { field: "items", hint: "300 characters each at most" });
  const [p] = await db.select().from(projects).where(eq(projects.slug, input.project)).limit(1);
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: input.project });
  const [t] = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, input.key))).limit(1);
  if (!t) throw new ToolError("TASK_NOT_FOUND", { key: input.key });
  const old = t.poChecklist ?? [];
  const list: PoCheck[] = items.map((text, i) => {
    const was = old.find((c) => c.n === i + 1 && c.text === text);
    return was ? { ...was } : { n: i + 1, text, done: false, done_at: null, done_by: null };
  });
  await db.transaction(async (tx) => {
    await tx.update(tasks).set({ poChecklist: list }).where(eq(tasks.id, t.id));
    await tx.insert(events).values({ projectId: p.id, taskId: t.id, taskKey: t.key, type: "po_checks.set", actor, payload: { items } });
  });
  return list;
}

// ---- What the floor waits for

export type QaGate = { pending: boolean; hold: string | null };

/** Whether a delivery waits for QA (pending: the floor shows no card yet) or carries a QA hold. */
export async function qaGate(db: Db, p: Project | null, t: Task | null, head: string | null): Promise<QaGate> {
  if (!p || !t || !qaTicket(t) || !(await qaAgentOf(db, p))) return { pending: false, hold: null };
  const lane = await latestLane(db, t.id);
  if (!lane) return { pending: true, hold: null };
  if ((ACTIVE as readonly string[]).includes(lane.status)) return { pending: true, hold: null };
  // A newer commit than the one QA saw: a new pass is due.
  if (head && lane.commit && !sameCommit(head, lane.commit)) return { pending: true, hold: null };
  if (lane.status === "pass") return { pending: false, hold: null };
  if (lane.status === "fail") return lane.returned ? { pending: true, hold: null } : { pending: false, hold: "QA encontró fallas otra vez: revísala tú." };
  return { pending: false, hold: `QA no pudo terminar${lane.hold ? ` (${cut(lane.hold, 80)})` : ""}: revísala tú.` };
}

// ---- Output parsing

export function parseCounts(out: string): { pass: number | null; fail: number | null } {
  const s = out.replace(ANSI, "");
  const node = (k: string) => {
    const m = [...s.matchAll(new RegExp(`^\\s*[#ℹ]\\s*${k}\\s+(\\d+)\\s*$`, "gm"))].at(-1);
    return m ? Number(m[1]) : null;
  };
  const np = node("pass");
  const nf = node("fail");
  if (np !== null || nf !== null) return { pass: np ?? 0, fail: nf ?? 0 };
  const last = s.split("\n").filter((l) => /\b\d+ (passed|failed)\b/.test(l)).at(-1);
  if (!last) return { pass: null, fail: null };
  const p = /(\d+) passed/.exec(last);
  const f = /(\d+) failed/.exec(last);
  return { pass: p ? Number(p[1]) : 0, fail: f ? Number(f[1]) : 0 };
}

const tailOf = (out: string, lines = 15) =>
  cut(
    out
      .replace(ANSI, "")
      .split("\n")
      .map((l) => l.trimEnd())
      .filter(Boolean)
      .slice(-lines)
      .join("\n"),
    1500,
  );

const reportSchema = z.object({
  review: z.object({ verdict: z.enum(["pass", "fail"]), notes: z.string().trim().max(4000).default("") }),
  checklist: z.array(z.object({ n: z.number().int(), mark: z.enum(["pass", "fail"]), note: z.string().trim().max(1000).default("") })).default([]),
});
export type QaReport = { review: { verdict: "pass" | "fail"; notes: string }; marks: QaMark[] };

/** The last ```qa-report block of the run's final text. Every check-list item must be marked. */
export function parseReport(text: string | null, items: number[]): QaReport | null {
  if (!text) return null;
  const blocks = [...text.matchAll(/```qa-report\s*\n([\s\S]*?)```/g)];
  const body = blocks.at(-1)?.[1];
  if (!body) return null;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const r = reportSchema.safeParse(json);
  if (!r.success) return null;
  const marks: QaMark[] = [];
  for (const n of items) {
    const m = r.data.checklist.filter((x) => x.n === n).at(-1);
    if (!m) return null;
    marks.push({ n, mark: m.mark, note: cut(m.note, 1000) });
  }
  return { review: { verdict: r.data.review.verdict, notes: cut(r.data.review.notes, 4000) }, marks };
}

/** The final text of a claude stream-json log: the last result event's result. */
export function resultTextOf(log: string | null): string | null {
  if (!log) return null;
  let out: string | null = null;
  for (const line of log.split("\n")) {
    if (!line.includes('"result"')) continue;
    try {
      const e = JSON.parse(line) as { type?: string; result?: unknown };
      if (e.type === "result" && typeof e.result === "string") out = e.result;
    } catch {
      // a partial line
    }
  }
  return out;
}

const defaultReadLog = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);

// ---- The app for the captures

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address();
      const port = typeof a === "object" && a ? a.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** Starts the test copy in the checkout (its own process group), waits until url answers below 500. */
export const startApp: StartApp = async ({ cwd, command, url, port, timeoutMs }) => {
  const child = spawn("/bin/sh", ["-c", command], { cwd, env: checkoutEnv({ PORT: String(port) }), detached: true, stdio: "ignore" });
  let exited = false;
  child.on("exit", () => (exited = true));
  child.on("error", () => (exited = true));
  const stop = async () => {
    if (exited || !child.pid) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      return;
    }
    const until = Date.now() + 5_000;
    while (!exited && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
    if (!exited) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // gone
      }
    }
  };
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (exited) return { ok: false, error: "La copia de prueba se cerró al arrancar", stop };
    try {
      const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
      if (r.status < 500) return { ok: true, error: null, stop };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return { ok: false, error: "La copia de prueba no arrancó a tiempo", stop };
};

// ---- The sweep (each heartbeat tick)

const checking = new Map<string, Promise<void>>();
/** Tests: resolves once every lane's checks in this process are done. */
export async function waitForQa(): Promise<void> {
  while (checking.size) await Promise.all([...checking.values()]);
}
export const resetQaForTests = () => checking.clear();

export type QaSweep = { opened: number; started: number; reviewing: number; concluded: number; held: number };

export async function sweepQa(db: Db, now = new Date(), deps: QaDeps = {}): Promise<QaSweep> {
  const out: QaSweep = { opened: 0, started: 0, reviewing: 0, concluded: 0, held: 0 };
  // Lanes left mid-checks by an earlier server start over.
  for (const l of await db.select().from(qaLanes).where(eq(qaLanes.status, "checking"))) {
    if (!checking.has(l.id)) await db.update(qaLanes).set({ status: "queued" }).where(eq(qaLanes.id, l.id));
  }
  out.opened = await openLanes(db);
  const settings = await loadSettings(db);
  const lanes = await db.select().from(qaLanes).where(inArray(qaLanes.status, [...ACTIVE])).orderBy(qaLanes.createdAt);
  for (const lane of lanes) {
    const [p] = await db.select().from(projects).where(eq(projects.id, lane.projectId)).limit(1);
    const [t] = await db.select().from(tasks).where(eq(tasks.id, lane.taskId)).limit(1);
    const qa = p ? await qaAgentOf(db, p) : null;
    if (!p || !t || !qa) {
      await endLane(db, lane, "error", "El proyecto ya no tiene QA");
      continue;
    }
    if (t.status !== "In review") {
      await endLane(db, lane, "error", `La entrega ya no está en revisión (${t.status})`);
      continue;
    }
    const paused = settings.companyPaused ? "La compañía está en pausa" : p.runsPaused ? "El proyecto está en pausa" : null;
    if (lane.status === "queued") {
      if (paused || checking.size > 0) {
        if (paused && lane.hold !== paused) await db.update(qaLanes).set({ hold: paused }).where(eq(qaLanes.id, lane.id));
        out.held += Number(!!paused);
        continue;
      }
      await db.update(qaLanes).set({ status: "checking", hold: null, startedAt: now }).where(eq(qaLanes.id, lane.id));
      const job = runChecks(db, lane, p, t, deps)
        .catch(async (e) => endLane(db, lane, "error", `Falló al correr: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`))
        .finally(() => checking.delete(lane.id));
      checking.set(lane.id, job);
      out.started += 1;
      continue;
    }
    if (lane.status === "reviewing") {
      const r = await driveReview(db, lane, p, t, qa, now, deps);
      if (r === "concluded") out.concluded += 1;
      else if (r === "held") out.held += 1;
      else out.reviewing += 1;
    }
  }
  return out;
}

// A lane for every QA delivery whose head QA has not seen.
async function openLanes(db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.kind, "ticket"), eq(tasks.status, "In review"), inArray(tasks.workType, [...QA_WORK]), sql`${tasks.prUrl} is not null`));
  let n = 0;
  for (const t of rows) {
    if (!qaTicket(t)) continue;
    const [p] = await db.select().from(projects).where(eq(projects.id, t.projectId)).limit(1);
    if (!p || !(await qaAgentOf(db, p))) continue;
    const pr = await prHead(db, t);
    const last = await latestLane(db, t.id);
    if (last && (ACTIVE as readonly string[]).includes(last.status)) continue;
    if (last) {
      const seen = pr.head ? sameCommit(pr.head, last.commit) : last.createdAt.getTime() >= (t.statusChangedAt ?? t.updatedAt).getTime();
      if (seen) continue;
    }
    const [{ returned } = { returned: 0 }] = await db
      .select({ returned: sql<number>`count(*)::int` })
      .from(qaLanes)
      .where(and(eq(qaLanes.taskId, t.id), eq(qaLanes.returned, true)));
    await db.insert(qaLanes).values({
      projectId: p.id,
      taskId: t.id,
      taskKey: t.key,
      commit: pr.head,
      branch: pr.branch ?? t.branch ?? branchFor(t.key),
      prUrl: pr.url,
      attempt: Number(returned) + 1,
    });
    n += 1;
  }
  return n;
}

async function endLane(db: Db, lane: QaLane, status: "error", hold: string): Promise<void> {
  await db.update(qaLanes).set({ status, hold: cut(hold, 300), endedAt: new Date() }).where(eq(qaLanes.id, lane.id));
}

// Steps 1 and 2: the verify list and the captures, in the delivery's checkout. Then the review is due.
async function runChecks(db: Db, lane: QaLane, p: Project, t: Task, deps: QaDeps): Promise<void> {
  const env = deps.env ?? process.env;
  const git = deps.git ?? defaultGit;
  const exec = deps.exec ?? shellExec;
  const s: QaSettings | undefined = p.settings.qa;
  const repo = repoPathOf(p.slug, p.settings, env);
  const branch = lane.branch ?? t.branch ?? branchFor(t.key);
  const made = await ensureWorktree({ repo, root: deps.worktreeRoot ?? worktreeRoot(env), project: p.slug, key: t.key, branch }, git);
  if (!made.ok) return endLane(db, lane, "error", `Sin copia de trabajo (${made.summary.replace(/^fail:\s*/, "")})`);
  const cwd = made.path;
  const rev = async () => {
    const r = await git(["rev-parse", "HEAD"], cwd);
    return r.code === 0 ? r.stdout.trim() : null;
  };
  let head = await rev();
  if (lane.commit && !sameCommit(head, lane.commit)) {
    // The PR moved past this checkout: catch up, fast-forward only (never rewrites anything).
    await git(["fetch", "origin", made.branch], cwd);
    await git(["merge", "--ff-only", "FETCH_HEAD"], cwd);
    head = await rev();
  }
  if (!head) return endLane(db, lane, "error", "No se pudo leer el commit de la entrega");
  if (lane.commit && !sameCommit(head, lane.commit)) return endLane(db, lane, "error", `La copia de trabajo no llega al commit del PR (${short(lane.commit)})`);
  const stat = await git(["diff", "--shortstat", `origin/${ALLOWED_BASE}...HEAD`], cwd);
  const diffLines = stat.code === 0 ? [...stat.stdout.matchAll(/(\d+) (?:insertion|deletion)/g)].reduce((a, m) => a + Number(m[1]), 0) : null;

  const verify: QaVerifyItem[] = [];
  for (const v of s?.verify ?? []) {
    const started = Date.now();
    const r = await exec(v.command, { cwd, timeoutMs: (v.timeout_minutes ?? 15) * 60_000, env: checkoutEnv() });
    const output = `${r.stdout}\n${r.stderr}`;
    const counts = parseCounts(output);
    verify.push({
      name: v.name,
      command: v.command,
      exit_code: r.code,
      ok: r.code === 0 && (counts.fail ?? 0) === 0,
      pass: counts.pass,
      fail: counts.fail,
      duration_s: Math.round((Date.now() - started) / 1000),
      tail: tailOf(output),
    });
  }

  let capture: QaCapture | null = null;
  const cs = p.settings.capture;
  if (cs) {
    const port = await (deps.freePort ?? freePort)();
    const base = `http://localhost:${port}`;
    let app: StartedApp | null = null;
    try {
      app = await (deps.startApp ?? startApp)({ cwd, command: cs.start_command.replaceAll("{port}", String(port)), url: base + (cs.ready_path ?? "/"), port, timeoutMs: 180_000 });
      const sum = await (deps.capture ?? runCapture)(db, { project: p.slug, checkout: cwd, base_url: base, commit: head, branch: made.branch, task_key: t.key, actor: qaActor("qa") }, deps.captureDeps);
      const firstError = sum.stills.find((x) => x.error)?.error ?? null;
      capture = { run_id: sum.run_id, ok: sum.ok, failed: sum.failed, still_ids: sum.stills.filter((x) => x.status === "ok").map((x) => x.id), error: app.ok ? firstError : (app.error ?? firstError) };
    } catch (e) {
      capture = { run_id: null, ok: 0, failed: 0, still_ids: [], error: cut(e instanceof Error ? e.message : String(e), 300) };
    } finally {
      await app?.stop().catch(() => undefined);
    }
  }

  const model = modelFor(s, diffLines);
  const failed = verify.some((v) => !v.ok);
  await db.update(qaLanes).set({ commit: head, branch: made.branch, verify, capture, diffLines, model, status: failed ? "checking" : "reviewing", hold: null }).where(eq(qaLanes.id, lane.id));
  // A failing verify list needs no review to go back: the notes are the failing commands. No tokens spent.
  if (failed) {
    const [fresh] = await db.select().from(qaLanes).where(eq(qaLanes.id, lane.id)).limit(1);
    await finalize(db, fresh!, p, t, null, deps);
  }
}

// Step 3 and 4: one QA run through the runner. Its holds are the runner's.
async function driveReview(db: Db, lane: QaLane, p: Project, t: Task, qa: Agent, now: Date, deps: QaDeps): Promise<"waiting" | "held" | "concluded"> {
  if (!lane.runId) {
    const ok = await canStart(db, qa, p.id, t.key, now, deps.runner);
    if (!ok.ok) {
      if (lane.hold !== ok.summary) await db.update(qaLanes).set({ hold: cut(ok.summary, 300) }).where(eq(qaLanes.id, lane.id));
      return "held";
    }
    const out = await enqueueWake(db, { agent: qa, project: { id: p.id, slug: p.slug }, taskKey: t.key, reason: `${QA_REASON} ${lane.id}`, now });
    if (out.kind !== "queued") {
      await db.update(qaLanes).set({ hold: cut(out.reason, 300) }).where(eq(qaLanes.id, lane.id));
      return "held";
    }
    await db.update(qaLanes).set({ runId: out.runId, hold: null }).where(eq(qaLanes.id, lane.id));
    return "waiting";
  }
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, lane.runId)).limit(1);
  if (!run) {
    await db.update(qaLanes).set({ runId: null }).where(eq(qaLanes.id, lane.id));
    return "waiting";
  }
  if (run.status === "queued" || run.status === "running") return "waiting";
  if (run.status === "skipped" || run.status === "stopped") {
    // A hold (usage, a switch, the cap) dropped or stopped it: wait, and queue it again once it would start.
    await db.update(qaLanes).set({ runId: null, hold: cut(run.summary, 300) }).where(eq(qaLanes.id, lane.id));
    return "held";
  }
  const items = (await poChecksOf(db, t.id)).map((c) => c.n);
  const text = resultTextOf(run.logPath ? (deps.readLog ?? defaultReadLog)(run.logPath) : null);
  const report = run.status === "ok" ? parseReport(text, items) : null;
  if (!report) {
    const tries = lane.reviewTries + 1;
    const why = run.status === "ok" ? "QA terminó sin su informe" : `La revisión falló (${cut(run.summary, 80)})`;
    if (tries < MAX_REVIEW_TRIES) {
      await db.update(qaLanes).set({ reviewTries: tries, runId: null, hold: why }).where(eq(qaLanes.id, lane.id));
      return "waiting";
    }
    await db.update(qaLanes).set({ reviewTries: tries }).where(eq(qaLanes.id, lane.id));
    await endLane(db, lane, "error", why);
    return "concluded";
  }
  await finalize(db, { ...lane, reviewTries: lane.reviewTries + 1 }, p, t, { ...report, model: lane.model }, deps);
  return "concluded";
}

// ---- The verdict, the results, and the way back to Taller

export function notesOf(lane: Pick<QaLane, "verify" | "capture" | "review" | "marks" | "commit">, items: PoCheck[]): string {
  const lines: string[] = [];
  for (const v of lane.verify.filter((x) => !x.ok)) {
    const counts = v.fail ? `: ${v.fail} de ${(v.pass ?? 0) + v.fail} fallan` : v.exit_code === null ? ": no terminó a tiempo" : ` (código ${v.exit_code})`;
    lines.push(`- ${v.name} falló${counts}. \`${v.command}\`${v.tail ? `\n  Últimas líneas:\n${v.tail.split("\n").map((l) => `    ${l}`).join("\n")}` : ""}`);
  }
  if (lane.review?.verdict === "fail") lines.push(`- Revisión aparte: ${lane.review.notes || "falla sin detalle"}`);
  for (const m of lane.marks.filter((x) => x.mark === "fail")) {
    const item = items.find((c) => c.n === m.n);
    lines.push(`- Check list ${m.n}${item ? ` «${item.text}»` : ""}: no se cumple. ${m.note}`.trim());
  }
  if (lane.capture?.error) lines.push(`- Capturas (aviso, no cuenta como falla): ${lane.capture.error}`);
  return lines.join("\n");
}

const attachUrl = (deps: QaDeps, slug: string, id: string) => `${(deps.publicUrl ?? deps.env?.PLANIA_PUBLIC_URL ?? process.env.PLANIA_PUBLIC_URL ?? "http://127.0.0.1:3737").replace(/\/$/, "")}${imageUrl(slug, id)}`;

export function testsOf(verify: QaVerifyItem[]): { pass: number; total: number } {
  let pass = 0;
  let total = 0;
  for (const v of verify) {
    if (v.pass === null && v.fail === null) continue;
    pass += v.pass ?? 0;
    total += (v.pass ?? 0) + (v.fail ?? 0);
  }
  return { pass, total };
}

async function finalize(db: Db, lane: QaLane, p: Project, t: Task, report: (QaReport & { model: string | null }) | null, deps: QaDeps): Promise<void> {
  const items = await poChecksOf(db, t.id);
  const review: QaReview | null = report ? { verdict: report.review.verdict, notes: report.review.notes, model: report.model } : null;
  const marks = report?.marks ?? [];
  const verifyOk = lane.verify.every((v) => v.ok);
  const pass = verifyOk && review?.verdict === "pass" && marks.every((m) => m.mark === "pass");
  const status = pass ? "pass" : "fail";
  const done = { ...lane, review, marks };
  const notes = pass ? null : notesOf(done, items);

  // HEAD after the lane: QA never moves the delivery's branch.
  const env = deps.env ?? process.env;
  const git = deps.git ?? defaultGit;
  const made = await ensureWorktree({ repo: repoPathOf(p.slug, p.settings, env), root: deps.worktreeRoot ?? worktreeRoot(env), project: p.slug, key: t.key, branch: lane.branch ?? branchFor(t.key) }, git);
  const after = made.ok ? (await git(["rev-parse", "HEAD"], made.path)).stdout.trim() || null : null;

  await db.update(qaLanes).set({ review, marks, notes, status, headAfter: after, endedAt: new Date(), hold: null }).where(eq(qaLanes.id, lane.id));

  // The results on the ticket, the summary last (the floor reads the newest result).
  const ctx = qaCtx("qa", "qa.lane");
  const commit = lane.commit && SHA.test(lane.commit) ? lane.commit : undefined;
  const base = { project: p.slug, key: t.key, commit, branch: lane.branch ?? undefined };
  const add = (r: Omit<AddResultInput, "project" | "key">) => addResult(db, { ...base, ...r }, ctx).catch(() => undefined);
  const tests = testsOf(lane.verify);
  if (lane.verify.length) {
    await add({
      kind: "test",
      verdict: verifyOk ? "pass" : "fail",
      cite: cut(`QA · ${lane.verify.map((v) => `${v.name} ${v.pass !== null || v.fail !== null ? `${v.pass ?? 0} de ${(v.pass ?? 0) + (v.fail ?? 0)}` : v.ok ? "ok" : "falla"}`).join(" · ")}`, 500),
      command: cut(lane.verify.map((v) => v.command).join(" && "), 500),
      exit_code: lane.verify.find((v) => !v.ok)?.exit_code ?? 0,
      counts: { pass: tests.pass, fail: tests.total - tests.pass },
      duration_s: lane.verify.reduce((a, v) => a + v.duration_s, 0),
    });
  }
  if (lane.capture) {
    await add({
      kind: "visual",
      verdict: lane.capture.failed > 0 || lane.capture.ok === 0 ? "warn" : "pass",
      cite: cut(`QA · ${lane.capture.ok} capturas a 1280 y 390${lane.capture.failed ? `, ${lane.capture.failed} fallaron` : ""}${lane.capture.error ? ` (${lane.capture.error})` : ""}`, 500),
      attachments: lane.capture.still_ids.slice(0, 24).map((id) => attachUrl(deps, p.slug, id)),
    });
  }
  if (review) await add({ kind: "subagent", verdict: review.verdict, cite: cut(`QA · revisión aparte${review.model ? ` (${review.model})` : ""}: ${review.notes || (review.verdict === "pass" ? "pasa" : "falla")}`, 1000) });
  const checkedOk = marks.filter((m) => m.mark === "pass").length;
  await add({
    kind: "verify",
    verdict: status,
    cite: cut(
      [
        `QA ${pass ? "pasa" : "falla"} (intento ${lane.attempt})`,
        `pruebas ${tests.pass} de ${tests.total}`,
        review ? `revisión ${review.verdict === "pass" ? "pasa" : "falla"}` : "sin revisión (fallaron las pruebas)",
        items.length ? `check list ${checkedOk} de ${items.length}` : "sin check list",
        lane.capture ? `${lane.capture.ok} capturas` : "sin capturas",
      ].join(" · "),
      500,
    ),
    counts: { pass: tests.pass, fail: tests.total - tests.pass },
  });
  await db.insert(events).values({
    projectId: p.id,
    taskId: t.id,
    taskKey: t.key,
    type: pass ? "qa.passed" : "qa.failed",
    actor: qaActor("qa"),
    payload: { lane_id: lane.id, attempt: lane.attempt, commit: lane.commit, tests, review: review?.verdict ?? null, marks: marks.map((m) => ({ n: m.n, mark: m.mark })) },
  });
  if (!pass && lane.attempt === 1) await returnToTaller(db, { ...done, notes, status }, p, t);
}

async function returnToTaller(db: Db, lane: QaLane, p: Project, t0: Task): Promise<void> {
  const [t] = await db.select().from(tasks).where(eq(tasks.id, t0.id)).limit(1);
  if (!t || t.status !== "In review") return;
  const ctx: Ctx = { actor: { ...SYSTEM_ACTOR, machine: hostname() }, tool: "qa.return" };
  const text = `QA devolvió la entrega (${short(lane.commit)}), intento ${lane.attempt}:\n${lane.notes ?? ""}`.slice(0, 4000);
  try {
    await setTask(db, { project: p.slug, key: t.key, status: "Ready", version: t.version, note: text } as never, ctx);
  } catch (e) {
    const why = e instanceof ToolError ? e.code : e instanceof Error ? e.message : String(e);
    await db.update(qaLanes).set({ hold: cut(`No se pudo devolver a Taller (${why})`, 300) }).where(eq(qaLanes.id, lane.id));
    return;
  }
  await db.update(qaLanes).set({ returned: true }).where(eq(qaLanes.id, lane.id));
  // The delivery's card reads as sent back (devuelta), like Pedir cambios, so the floor stops asking for it.
  const at = new Date().toISOString();
  await db
    .update(threadMessages)
    .set({ actionState: { action: "cambios", at, result: { ticket: t.key, status: "Ready", text: lane.notes ?? "", by: "qa", lane_id: lane.id } } as never })
    .where(
      and(
        isNull(threadMessages.actionState),
        sql`${threadMessages.links} @> ${JSON.stringify([{ kind: "ticket", ref: t.key }])}::jsonb`,
        sql`${threadMessages.threadId} in (select ${threads.id} from ${threads} where ${threads.projectId} = ${p.id})`,
      ),
    );
  await db.insert(events).values({ projectId: p.id, taskId: t.id, taskKey: t.key, type: "qa.returned", actor: qaActor("qa"), payload: { lane_id: lane.id, attempt: lane.attempt } });
  // Moving to Ready wakes Taller on a code ticket (the event hook). Any other owner is woken here, like Pedir cambios.
  if (t.ownerAgent) {
    const [owner] = await db.select().from(agents).where(eq(agents.id, t.ownerAgent)).limit(1);
    if (owner) await enqueueWake(db, { agent: owner, project: { id: p.id, slug: p.slug }, taskKey: t.key, reason: "QA returned the delivery: read the QA note on the ticket" }).catch(() => undefined);
  }
}

// ---- What the QA run is told (runner.ts asks for it when it starts a QA run)

export type QaBrief = { prompt: string; model: string | null };

export async function qaBriefFor(db: Db, runId: string, cwd: string): Promise<QaBrief | null> {
  const [lane] = await db.select().from(qaLanes).where(eq(qaLanes.runId, runId)).limit(1);
  if (!lane) return null;
  const [p] = await db.select().from(projects).where(eq(projects.id, lane.projectId)).limit(1);
  const [t] = await db.select().from(tasks).where(eq(tasks.id, lane.taskId)).limit(1);
  if (!p || !t) return null;
  const items = await poChecksOf(db, t.id);
  const tests = testsOf(lane.verify);
  const verify = lane.verify.length
    ? lane.verify.map((v) => `${v.name} (\`${v.command}\`): ${v.ok ? "ok" : "falla"}${v.pass !== null || v.fail !== null ? `, ${v.pass ?? 0} de ${(v.pass ?? 0) + (v.fail ?? 0)}` : ""}`).join("; ")
    : "none configured";
  const lines = [
    `You are the QA reviewer for project ${p.slug} (${p.title}), woken by the Plania runner on the delivery of ${t.key}: ${t.title}.`,
    `Delivery: commit ${short(lane.commit)} on branch ${lane.branch ?? "?"}${lane.prUrl ? `, PR ${lane.prUrl}` : ""}. Workspace: ${cwd} (read-only for you).`,
    "You have not seen how it was built, on purpose. Do not read the project thread, the ticket's notes or its log before your review: judge the change on its own.",
    `Read the ticket's scope and Done when with get_task (project ${p.slug}, key ${t.key}, fields ["title", "scope", "checks"]). Then read the change: git diff origin/${ALLOWED_BASE}...HEAD and the files it touches.`,
    `Already run by Plania on this commit: ${verify}${lane.verify.length ? ` (tests ${tests.pass} of ${tests.total})` : ""}. Captures: ${lane.capture ? `${lane.capture.ok} taken${lane.capture.error ? `, ${lane.capture.error}` : ""}` : "none configured"}.`,
    items.length
      ? `Check list del PO (mark every item pass or fail; run the tests or read the code to check it):\n${items.map((c) => `${c.n}. ${c.text}`).join("\n")}`
      : "There is no check list for this ticket: send an empty checklist.",
    "Never edit files, commit, push, open or edit a PR, or claim, start, finish or move the ticket, and never post in a thread: Plania records your report and acts on it.",
    "Fail only a real defect against the scope, the Done when or the check list (a bug, a missing piece, a broken screen, a check that is not met). Style alone is not a fail. Write the notes in Spanish, exact: file:line, what is wrong, what would fix it.",
    "End your run with exactly one block, the last thing you write:",
    "```qa-report",
    `{"review": {"verdict": "pass", "notes": "..."}, "checklist": [${items.map((c) => `{"n": ${c.n}, "mark": "pass", "note": "..."}`).join(", ")}]}`,
    "```",
    'verdict and each mark are "pass" or "fail".',
  ];
  return { prompt: lines.join("\n"), model: lane.model };
}

// ---- The evidence read for the floor card (GET /api/projects/:slug/qa/:key)

export type QaEvidence = {
  project: string;
  key: string;
  enabled: boolean;
  state: "off" | "none" | "waiting" | "checking" | "reviewing" | "pass" | "fail" | "returned" | "error";
  lane: {
    id: string;
    attempt: number;
    status: string;
    commit: string | null;
    branch: string | null;
    pr_url: string | null;
    hold: string | null;
    model: string | null;
    diff_lines: number | null;
    head_after: string | null;
    returned: boolean;
    created_at: string;
    started_at: string | null;
    ended_at: string | null;
  } | null;
  tests: { pass: number; total: number; verdict: "pass" | "fail" | null; items: { name: string; command: string; ok: boolean; exit_code: number | null; pass: number | null; fail: number | null; duration_s: number }[] };
  review: { verdict: "pass" | "fail"; notes: string; model: string | null } | null;
  checklist: { n: number; text: string; mark: "pass" | "fail" | null; note: string | null }[];
  captures: { ids: string[]; image_urls: string[]; ok: number; failed: number; error: string | null } | null;
  notes: string | null;
  history: { id: string; attempt: number; status: string; commit: string | null; returned: boolean; ended_at: string | null }[];
};

export async function qaEvidence(db: Db, p: Project, t: Task, opts: { commit?: string } = {}): Promise<QaEvidence> {
  const enabled = qaTicket(t) && !!(await qaAgentOf(db, p));
  const all = await db.select().from(qaLanes).where(eq(qaLanes.taskId, t.id)).orderBy(desc(qaLanes.createdAt));
  const lane = (opts.commit ? all.find((l) => sameCommit(l.commit, opts.commit!)) : all[0]) ?? null;
  const items = await poChecksOf(db, t.id);
  const tests = testsOf(lane?.verify ?? []);
  const ran = !!lane && !["queued", "checking"].includes(lane.status);
  const state: QaEvidence["state"] = !enabled && !lane
    ? "off"
    : !lane
      ? "none"
      : lane.status === "queued"
        ? "waiting"
        : lane.status === "fail" && lane.returned
          ? "returned"
          : lane.status;
  return {
    project: p.slug,
    key: t.key,
    enabled,
    state,
    lane: lane
      ? {
          id: lane.id,
          attempt: lane.attempt,
          status: lane.status,
          commit: lane.commit,
          branch: lane.branch,
          pr_url: lane.prUrl,
          hold: lane.hold,
          model: lane.model,
          diff_lines: lane.diffLines,
          head_after: lane.headAfter,
          returned: lane.returned,
          created_at: lane.createdAt.toISOString(),
          started_at: lane.startedAt?.toISOString() ?? null,
          ended_at: lane.endedAt?.toISOString() ?? null,
        }
      : null,
    tests: {
      pass: tests.pass,
      total: tests.total,
      verdict: ran && lane!.verify.length ? (lane!.verify.every((v) => v.ok) ? "pass" : "fail") : null,
      items: (lane?.verify ?? []).map((v) => ({ name: v.name, command: v.command, ok: v.ok, exit_code: v.exit_code, pass: v.pass, fail: v.fail, duration_s: v.duration_s })),
    },
    review: lane?.review ?? null,
    checklist: items.map((c) => {
      const m = lane?.marks.find((x) => x.n === c.n);
      return { n: c.n, text: c.text, mark: m?.mark ?? null, note: m?.note ?? null };
    }),
    captures: lane?.capture
      ? { ids: lane.capture.still_ids, image_urls: lane.capture.still_ids.map((id) => imageUrl(p.slug, id)), ok: lane.capture.ok, failed: lane.capture.failed, error: lane.capture.error }
      : null,
    notes: lane?.notes ?? null,
    history: all.map((l) => ({ id: l.id, attempt: l.attempt, status: l.status, commit: l.commit, returned: l.returned, ended_at: l.endedAt?.toISOString() ?? null })),
  };
}
