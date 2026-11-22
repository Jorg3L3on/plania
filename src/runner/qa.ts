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
// AUDIT-6: the review returns two verdicts that are never merged: spec (does the change do what the ticket asked)
// and code (is the change sound). QaReview.verdict stays the overall one (fail when either fails), so every reader
// from before keeps working, and a report in the old one-verdict shape still parses. The brief also carries up to
// three past misses of QA on the project (the owner disagreed with it), and, with settings.qa.browser and a
// settings.capture, how to start the test copy and walk through the change in a browser.
// AUDIT-10: a delivery QA sends back queues one retro (src/runner/retro.ts) when settings.qa.retro is true.
import { spawn } from "node:child_process";
import { killTree, shellCommand } from "../lib/proc-tree.js";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { hostname } from "node:os";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ownerLanguage } from "./owner-language.js";
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
  type QaAxis,
  type QaCapture,
  type QaLane,
  type QaMark,
  type QaReview,
  type QaVerifyItem,
  type Task,
} from "../db/schema.js";
import { runCapture, checkoutEnv, shellExec, type CaptureDeps, type CaptureInput, type CaptureSummary, type Exec } from "../captures/run.js";
import { imageUrl } from "../captures/store.js";
import { workPatternOf } from "../camino/store.js";
import { addResult, type AddResultInput } from "../mcp/evidence.js";
import { ToolError } from "../mcp/errors.js";
import { SYSTEM_ACTOR, type Ctx } from "../mcp/tx.js";
import { setTask } from "../mcp/writes.js";
import { NO_DISPONIBLE, supported } from "../lib/system-support.js";
import { enqueueWake, serviceAgent } from "./events.js";
import { loadSettings } from "./limits.js";
import { modelFor, type QaSettings } from "./qa-settings.js";
import { oneLine, queueRetro } from "./retro.js";
import { canStart, type RunnerDeps } from "./runner.js";
import { velocidadOf } from "./velocidad.js";
import { startBranchOf } from "./start-branch.js";
import { verifyListOf } from "./build-step.js";
import { ALLOWED_BASE, branchFor, defaultGit, ensureWorktree, repoPathOf, worktreeRoot, type GitFn } from "./worktree.js";
import { defineWords, say } from "../words.js";
import { measuredWaits } from "../captures/waits.js"; // PLA-I74-7

// PLA-I2-10: what QA writes for the owner and for Taller (holds, lane errors, the notes sent back, the results' lines),
// in the install's language; the Spanish is unchanged.
export const QA_WORDS = defineWords({
  es: {
    failedAgain: "QA encontró fallas otra vez: revísala tú.",
    couldNotFinish: (why: string) => `QA no pudo terminar${why}: revísala tú.`,
    axis: { spec: "Lo que se pidió", code: "El código" } as Record<"spec" | "code", string>,
    verdict: (ok: boolean): string => (ok ? "pasa" : "falla"),
    noFindings: "sin hallazgos",
    failNoDetail: "falla sin detalle",
    copyClosed: "La copia de prueba se cerró al arrancar",
    copyLate: "La copia de prueba no arrancó a tiempo",
    noQa: "El proyecto ya no tiene QA",
    notInReview: (status: string) => `La entrega ya no está en revisión (${status})`,
    companyPaused: "La compañía está en pausa",
    projectPaused: "El proyecto está en pausa",
    crashed: (why: string) => `Falló al correr: ${why}`,
    noWorktree: (why: string) => `Sin copia de trabajo (${why})`,
    noCommit: "No se pudo leer el commit de la entrega",
    behindPr: (commit: string) => `La copia de trabajo no llega al commit del PR (${commit})`,
    noReport: "QA terminó sin su informe",
    reviewFailed: (why: string) => `La revisión falló (${why})`,
    failCount: (fail: number, total: number) => `: ${fail} de ${total} fallan`,
    timedOut: ": no terminó a tiempo",
    exitCode: (code: number) => ` (código ${code})`,
    verifyFailed: (name: string, counts: string, command: string, tail: string | null) =>
      `- ${name} falló${counts}. \`${command}\`${tail !== null ? `\n  Últimas líneas:\n${tail}` : ""}`,
    specFailed: (notes: string) => `- Revisión aparte · lo que se pidió (alcance, Done when, check list): ${notes}`,
    codeFailed: (notes: string) => `- Revisión aparte · el código (errores, casos límite, manejo inseguro): ${notes}`,
    reviewLine: (notes: string) => `- Revisión aparte: ${notes}`,
    checkMissed: (n: number, item: string | null, note: string) => `- Check list ${n}${item !== null ? ` «${item}»` : ""}: no se cumple. ${note}`,
    captureWarn: (error: string) => `- Capturas (aviso, no cuenta como falla): ${error}`,
    of: (pass: number, total: number) => `${pass} de ${total}`,
    captures: (ok: number, failed: number, error: string | null) => `QA · ${ok} capturas a 1440 y 390${failed ? `, ${failed} fallaron` : ""}${error ? ` (${error})` : ""}`,
    reviewCite: (model: string, notes: string) => `QA · revisión aparte${model}: ${notes}`,
    summary: (pass: boolean, attempt: number) => `QA ${pass ? "pasa" : "falla"} (intento ${attempt})`,
    tests: (pass: number, total: number) => `pruebas ${pass} de ${total}`,
    axes: (spec: boolean, code: boolean) => `lo pedido ${spec ? "pasa" : "falla"} · el código ${code ? "pasa" : "falla"}`,
    reviewVerdict: (ok: boolean) => `revisión ${ok ? "pasa" : "falla"}`,
    noReview: "sin revisión (fallaron las pruebas)",
    // PLA-I74-11: why there is no review, from what happened.
    noReviewChecksOnly: "sin revisión aparte (este proyecto solo corre sus comprobaciones)",
    noReviewYet: "sin revisión",
    noTests: "sin pruebas",
    checksRan: (ok: number, total: number) => `comprobaciones ${ok} de ${total}`,
    walked: "recorrió la app",
    checklist: (ok: number, total: number) => `check list ${ok} de ${total}`,
    noChecklist: "sin check list",
    capturesN: (n: number) => `${n} capturas`,
    noCaptures: "sin capturas",
    returned: (commit: string, attempt: number, notes: string) => `QA devolvió la entrega (${commit}), intento ${attempt}:\n${notes}`,
    couldNotReturn: (why: string) => `No se pudo devolver a Taller (${why})`,
  },
  en: {
    failedAgain: "QA found failures again: review it yourself.",
    couldNotFinish: (why: string) => `QA could not finish${why}: review it yourself.`,
    axis: { spec: "What was asked", code: "The code" } as Record<"spec" | "code", string>,
    verdict: (ok: boolean) => (ok ? "passes" : "fails"),
    noFindings: "no findings",
    failNoDetail: "fails with no detail",
    copyClosed: "The test copy closed while starting",
    copyLate: "The test copy did not start in time",
    noQa: "The project no longer has QA",
    notInReview: (status: string) => `The delivery is no longer in review (${status})`,
    companyPaused: "The company is paused",
    projectPaused: "The project is paused",
    crashed: (why: string) => `Failed while running: ${why}`,
    noWorktree: (why: string) => `No working copy (${why})`,
    noCommit: "Could not read the delivery's commit",
    behindPr: (commit: string) => `The working copy does not reach the PR's commit (${commit})`,
    noReport: "QA ended without its report",
    reviewFailed: (why: string) => `The review failed (${why})`,
    failCount: (fail: number, total: number) => `: ${fail} of ${total} fail`,
    timedOut: ": did not finish in time",
    exitCode: (code: number) => ` (code ${code})`,
    verifyFailed: (name: string, counts: string, command: string, tail: string | null) =>
      `- ${name} failed${counts}. \`${command}\`${tail !== null ? `\n  Last lines:\n${tail}` : ""}`,
    specFailed: (notes: string) => `- Separate review · what was asked (scope, Done when, check list): ${notes}`,
    codeFailed: (notes: string) => `- Separate review · the code (errors, edge cases, unsafe handling): ${notes}`,
    reviewLine: (notes: string) => `- Separate review: ${notes}`,
    checkMissed: (n: number, item: string | null, note: string) => `- Check list ${n}${item !== null ? ` "${item}"` : ""}: not met. ${note}`,
    captureWarn: (error: string) => `- Stills (a warning, not a failure): ${error}`,
    of: (pass: number, total: number) => `${pass} of ${total}`,
    captures: (ok: number, failed: number, error: string | null) => `QA · ${ok} stills at 1440 and 390${failed ? `, ${failed} failed` : ""}${error ? ` (${error})` : ""}`,
    reviewCite: (model: string, notes: string) => `QA · separate review${model}: ${notes}`,
    summary: (pass: boolean, attempt: number) => `QA ${pass ? "passes" : "fails"} (attempt ${attempt})`,
    tests: (pass: number, total: number) => `tests ${pass} of ${total}`,
    axes: (spec: boolean, code: boolean) => `what was asked ${spec ? "passes" : "fails"} · the code ${code ? "passes" : "fails"}`,
    reviewVerdict: (ok: boolean) => `review ${ok ? "passes" : "fails"}`,
    noReview: "no review (the tests failed)",
    noReviewChecksOnly: "no separate review (this project only runs its checks)",
    noReviewYet: "no review",
    noTests: "no tests",
    checksRan: (ok: number, total: number) => `checks ${ok} of ${total}`,
    walked: "walked through the app",
    checklist: (ok: number, total: number) => `check list ${ok} of ${total}`,
    noChecklist: "no check list",
    capturesN: (n: number) => `${n} stills`,
    noCaptures: "no stills",
    returned: (commit: string, attempt: number, notes: string) => `QA sent the delivery back (${commit}), attempt ${attempt}:\n${notes}`,
    couldNotReturn: (why: string) => `Could not send it back to Taller (${why})`,
  },
});

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
export const sameCommit = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));

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

/** PLA-I73-2: the verification lane. A project with checks (settings.qa.verify) and no QA seat still gets them run by
 *  Plania on every delivery, in the delivery's checkout, before the owner sees it; with no seat there is no review,
 *  so the checks decide. settings.velocidad.verificar false turns it off. */
// PLA-I74-9: the host's build counts as a check (verifyListOf), read from the project's repo.
export const checksOnlyLane = (p: Project, env: NodeJS.ProcessEnv = process.env): boolean =>
  p.settings.qa?.enabled !== false && velocidadOf(p.settings).verificar && verifyListOf(p, repoPathOf(p.slug, p.settings, env)).length > 0;

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

// ---- The PO's check list (tasks.po_checklist: the plan writes it on Aprobar el plan, the owner may edit it here)

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
  if (lane.status === "fail") return lane.returned ? { pending: true, hold: null } : { pending: false, hold: say(QA_WORDS).failedAgain };
  return { pending: false, hold: say(QA_WORDS).couldNotFinish(lane.hold ? ` (${cut(lane.hold, 80)})` : "") };
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

// AUDIT-6: the report as a JSON Schema, for `claude --json-schema` (the runner passes QaBrief.jsonSchema; the brief
// spells the same shape out for a run without it). Two axes, never one merged verdict.
const AXIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "notes"],
  properties: { verdict: { type: "string", enum: ["pass", "fail"] }, notes: { type: "string", maxLength: 4000 } },
} as const;
export const QA_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["spec", "code", "checklist"],
  properties: {
    // Does the change do what the ticket asked: its scope, its Done when, the check list.
    spec: AXIS_SCHEMA,
    // Is the change sound: bugs, broken edge cases, unsafe handling. Style alone never fails.
    code: AXIS_SCHEMA,
    checklist: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "mark", "note"],
        properties: { n: { type: "integer" }, mark: { type: "string", enum: ["pass", "fail"] }, note: { type: "string", maxLength: 1000 } },
      },
    },
    // true when the reviewer started the test copy and walked through the change in a browser.
    walked: { type: "boolean" },
  },
} as const;

const axisSchema = z.object({ verdict: z.enum(["pass", "fail"]), notes: z.string().trim().max(4000).default("") });
const reportSchema = z
  .object({
    // The one-verdict shape from before AUDIT-6: still read.
    review: axisSchema.optional(),
    spec: axisSchema.optional(),
    code: axisSchema.optional(),
    checklist: z.array(z.object({ n: z.number().int(), mark: z.enum(["pass", "fail"]), note: z.string().trim().max(1000).default("") })).default([]),
    walked: z.boolean().optional(),
  })
  .refine((r) => (r.spec && r.code) || r.review, "two axes, or the old single review");
export type QaReport = { review: { verdict: "pass" | "fail"; notes: string; spec?: QaAxis; code?: QaAxis }; marks: QaMark[]; walked?: boolean };

// PLA-I2-10: the axes' names are QA_WORDS.axis, in the install's language (they were AXIS_WORDS, Spanish only).
export const axisWords = (): Record<"spec" | "code", string> => say(QA_WORDS).axis;
const axisLine = (axis: "spec" | "code", a: QaAxis) => {
  const w = say(QA_WORDS);
  return `${w.axis[axis]} (${w.verdict(a.verdict === "pass")}): ${a.notes || (a.verdict === "pass" ? w.noFindings : w.failNoDetail)}`;
};

// The JSON objects a final text may carry, the most deliberate first: the last ```qa-report block, the whole text
// (a run with --json-schema answers with the bare object), then the text from its first { to its last }.
function reportCandidates(text: string): string[] {
  const out: string[] = [];
  const block = [...text.matchAll(/```qa-report\s*\n([\s\S]*?)```/g)].at(-1)?.[1];
  if (block) return [block];
  const whole = text.trim();
  if (whole.startsWith("{")) out.push(whole);
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].at(-1)?.[1];
  if (fenced) out.push(fenced);
  const from = text.indexOf("{");
  const to = text.lastIndexOf("}");
  if (from >= 0 && to > from) out.push(text.slice(from, to + 1));
  return out;
}

/** The run's report: the last ```qa-report block of its final text, or a bare JSON object there. Two axes (spec and
 *  code), or the single review of before. Every check-list item must be marked. */
export function parseReport(text: string | null, items: number[]): QaReport | null {
  if (!text) return null;
  for (const body of reportCandidates(text)) {
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      continue;
    }
    const r = reportSchema.safeParse(json);
    if (!r.success) continue;
    const marks: QaMark[] = [];
    let complete = true;
    for (const n of items) {
      const m = r.data.checklist.filter((x) => x.n === n).at(-1);
      if (!m) {
        complete = false;
        break;
      }
      marks.push({ n, mark: m.mark, note: cut(m.note, 1000) });
    }
    if (!complete) return null;
    const walked = r.data.walked === undefined ? {} : { walked: r.data.walked };
    if (r.data.spec && r.data.code) {
      const spec: QaAxis = { verdict: r.data.spec.verdict, notes: cut(r.data.spec.notes, 4000) };
      const code: QaAxis = { verdict: r.data.code.verdict, notes: cut(r.data.code.notes, 4000) };
      // The overall verdict fails when either axis fails; its notes name each axis (readers from before show them).
      const verdict = spec.verdict === "pass" && code.verdict === "pass" ? "pass" : "fail";
      return { review: { verdict, notes: cut(`${axisLine("spec", spec)}\n${axisLine("code", code)}`, 4000), spec, code }, marks, ...walked };
    }
    return { review: { verdict: r.data.review!.verdict, notes: cut(r.data.review!.notes, 4000) }, marks, ...walked };
  }
  return null;
}

/** The final text of a claude stream-json log: the last result event's result. */
export function resultTextOf(log: string | null): string | null {
  if (!log) return null;
  let out: string | null = null;
  for (const line of log.split("\n")) {
    if (!line.includes('"result"')) continue;
    try {
      const e = JSON.parse(line) as { type?: string; result?: unknown; structured_output?: unknown };
      if (e.type !== "result") continue;
      // AUDIT-6: a run started with --json-schema carries its report as structured_output; the text may be empty.
      if (e.structured_output && typeof e.structured_output === "object") out = JSON.stringify(e.structured_output);
      else if (typeof e.result === "string") out = e.result;
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
  // PLA-I2-19 (audit B5): cmd.exe and taskkill /T on Windows (src/lib/proc-tree.ts); sh and the group elsewhere.
  const env = checkoutEnv({ PORT: String(port) });
  const sh = shellCommand(command, process.platform, env);
  const child = spawn(sh.file, sh.args, { ...sh.options, cwd, env, detached: true, stdio: "ignore" });
  let exited = false;
  child.on("exit", () => (exited = true));
  child.on("error", () => (exited = true));
  const stop = async () => {
    if (exited || !child.pid) return;
    if (process.platform === "win32") killTree(child.pid, "SIGTERM");
    else
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        return;
      }
    const until = Date.now() + 5_000;
    while (!exited && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
    if (!exited) killTree(child.pid, "SIGKILL");
  };
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (exited) return { ok: false, error: say(QA_WORDS).copyClosed, stop };
    try {
      const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
      if (r.status < 500) return { ok: true, error: null, stop };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return { ok: false, error: say(QA_WORDS).copyLate, stop };
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
    if (!p || !t || (!qa && !checksOnlyLane(p))) {
      await endLane(db, lane, "error", say(QA_WORDS).noQa);
      continue;
    }
    if (t.status !== "In review") {
      await endLane(db, lane, "error", say(QA_WORDS).notInReview(t.status));
      continue;
    }
    const paused = settings.companyPaused ? say(QA_WORDS).companyPaused : p.runsPaused ? say(QA_WORDS).projectPaused : null;
    if (lane.status === "queued") {
      if (paused || checking.size > 0) {
        if (paused && lane.hold !== paused) await db.update(qaLanes).set({ hold: paused }).where(eq(qaLanes.id, lane.id));
        out.held += Number(!!paused);
        continue;
      }
      await db.update(qaLanes).set({ status: "checking", hold: null, startedAt: now }).where(eq(qaLanes.id, lane.id));
      await db.insert(events).values({ projectId: p.id, taskId: t.id, taskKey: t.key, type: "verify.started", actor: qaActor("qa"), payload: { lane_id: lane.id } });
      const job = runChecks(db, lane, p, t, deps)
        .catch(async (e) => endLane(db, lane, "error", say(QA_WORDS).crashed(e instanceof Error ? e.message.split("\n")[0]! : String(e))))
        .finally(() => checking.delete(lane.id));
      checking.set(lane.id, job);
      out.started += 1;
      continue;
    }
    if (lane.status === "reviewing") {
      if (!qa) {
        // PLA-I73-2: checks only, no seat to review: the checks passed, that is the verdict.
        await finalize(db, lane, p, t, null, deps, true);
        out.concluded += 1;
        continue;
      }
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
    if (!p || (!(await qaAgentOf(db, p)) && !checksOnlyLane(p))) continue;
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
      branch: pr.branch ?? t.branch ?? branchFor(t.key, await workPatternOf(db, p.id)),
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
  const branch = lane.branch ?? t.branch ?? branchFor(t.key, await workPatternOf(db, p.id));
  const start = startBranchOf(p.settings);
  const made = await ensureWorktree({ repo, root: deps.worktreeRoot ?? worktreeRoot(env), project: p.slug, key: t.key, branch, base: start }, git);
  if (!made.ok) return endLane(db, lane, "error", say(QA_WORDS).noWorktree(made.summary.replace(/^fail:\s*/, "")));
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
  if (!head) return endLane(db, lane, "error", say(QA_WORDS).noCommit);
  if (lane.commit && !sameCommit(head, lane.commit)) return endLane(db, lane, "error", say(QA_WORDS).behindPr(short(lane.commit)));
  const stat = await git(["diff", "--shortstat", `origin/${start}...HEAD`], cwd);
  const diffLines = stat.code === 0 ? [...stat.stdout.matchAll(/(\d+) (?:insertion|deletion)/g)].reduce((a, m) => a + Number(m[1]), 0) : null;

  const verify: QaVerifyItem[] = [];
  // PLA-I74-9: the owner's list plus the host's production build, read from this checkout.
  for (const v of verifyListOf(p, cwd)) {
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
  // PLA-I2-4: no Chrome on this system: the captures are not available, said as a notice (never a failure).
  if (cs && !supported("stills")) capture = { run_id: null, ok: 0, failed: 0, still_ids: [], error: NO_DISPONIBLE };
  else if (cs) {
    const port = await (deps.freePort ?? freePort)();
    const base = `http://localhost:${port}`;
    let app: StartedApp | null = null;
    try {
      app = await (deps.startApp ?? startApp)({ cwd, command: cs.start_command.replaceAll("{port}", String(port)), url: base + (cs.ready_path ?? "/"), port, timeoutMs: (await measuredWaits(db, p.slug)).qa_start_ms });
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
    const out = await enqueueWake(db, { agent: qa, project: { id: p.id, slug: p.slug }, taskKey: t.key, reason: `${QA_REASON} ${lane.id}`, now, trigger: "qa" });
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
    const why = run.status === "ok" ? say(QA_WORDS).noReport : say(QA_WORDS).reviewFailed(cut(run.summary, 80));
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
  const w = say(QA_WORDS);
  for (const v of lane.verify.filter((x) => !x.ok)) {
    const counts = v.fail ? w.failCount(v.fail, (v.pass ?? 0) + v.fail) : v.exit_code === null ? w.timedOut : w.exitCode(v.exit_code);
    lines.push(w.verifyFailed(v.name, counts, v.command, v.tail ? v.tail.split("\n").map((l) => `    ${l}`).join("\n") : null));
  }
  // AUDIT-6: a two-axis review names the axis that failed, so Taller knows whether it built the wrong thing or
  // built it wrong. A review from before has one verdict and one line.
  const { spec, code } = lane.review ?? {};
  if (spec && code) {
    if (spec.verdict === "fail") lines.push(w.specFailed(spec.notes || w.failNoDetail));
    if (code.verdict === "fail") lines.push(w.codeFailed(code.notes || w.failNoDetail));
  } else if (lane.review?.verdict === "fail") lines.push(w.reviewLine(lane.review.notes || w.failNoDetail));
  for (const m of lane.marks.filter((x) => x.mark === "fail")) {
    const item = items.find((c) => c.n === m.n);
    lines.push(w.checkMissed(m.n, item ? item.text : null, m.note).trim());
  }
  if (lane.capture?.error) lines.push(w.captureWarn(lane.capture.error));
  return lines.join("\n");
}

const attachUrl = (deps: QaDeps, slug: string, id: string) => `${(deps.publicUrl ?? deps.env?.PLANIA_PUBLIC_URL ?? process.env.PLANIA_PUBLIC_URL ?? "http://127.0.0.1:3737").replace(/\/$/, "")}${imageUrl(slug, id)}`;

/** PLA-I74-11: the QA line the screen shows, said from what happened: a pass never reads as failed tests, a project
 * that only runs its checks says why there is no review, and checks with no test counts are counted as checks. */
export function qaSummary(
  r: { pass: boolean; attempt: number; verify: QaVerifyItem[]; review: Pick<QaReview, "verdict" | "spec" | "code" | "walked"> | null; checksOnly: boolean; checklist: { ok: number; total: number }; captures: number | null },
  language?: "es" | "en",
): string {
  const w = language ? say(QA_WORDS, language) : say(QA_WORDS);
  const tests = testsOf(r.verify);
  const verifyOk = r.verify.every((v) => v.ok);
  const testLine = tests.total > 0 ? w.tests(tests.pass, tests.total) : r.verify.length ? w.checksRan(r.verify.filter((v) => v.ok).length, r.verify.length) : w.noTests;
  const reviewLine = r.review?.spec && r.review.code
    ? w.axes(r.review.spec.verdict === "pass", r.review.code.verdict === "pass")
    : r.review
      ? w.reviewVerdict(r.review.verdict === "pass")
      : !verifyOk
        ? w.noReview
        : r.checksOnly
          ? w.noReviewChecksOnly
          : w.noReviewYet;
  return [
    w.summary(r.pass, r.attempt),
    testLine,
    reviewLine,
    ...(r.review?.walked ? [w.walked] : []),
    r.checklist.total ? w.checklist(r.checklist.ok, r.checklist.total) : w.noChecklist,
    r.captures !== null ? w.capturesN(r.captures) : w.noCaptures,
  ].join(" · ");
}

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

async function finalize(db: Db, lane: QaLane, p: Project, t: Task, report: (QaReport & { model: string | null }) | null, deps: QaDeps, checksOnly = false): Promise<void> {
  const items = await poChecksOf(db, t.id);
  // AUDIT-6: the axes are stored when the report has them; walked only when this project asks for the walk-through.
  const review: QaReview | null = report
    ? {
        verdict: report.review.verdict,
        notes: report.review.notes,
        model: report.model,
        ...(report.review.spec && report.review.code ? { spec: report.review.spec, code: report.review.code } : {}),
        ...(browserWalk(p) ? { walked: report.walked === true } : {}),
      }
    : null;
  const marks = report?.marks ?? [];
  const verifyOk = lane.verify.every((v) => v.ok);
  const pass = verifyOk && (checksOnly ? true : review?.verdict === "pass") && marks.every((m) => m.mark === "pass");
  const status = pass ? "pass" : "fail";
  const done = { ...lane, review, marks };
  const notes = pass ? null : notesOf(done, items);

  // HEAD after the lane: QA never moves the delivery's branch.
  const env = deps.env ?? process.env;
  const git = deps.git ?? defaultGit;
  const made = await ensureWorktree({ repo: repoPathOf(p.slug, p.settings, env), root: deps.worktreeRoot ?? worktreeRoot(env), project: p.slug, key: t.key, branch: lane.branch ?? branchFor(t.key, await workPatternOf(db, p.id)), base: startBranchOf(p.settings) }, git);
  const after = made.ok ? (await git(["rev-parse", "HEAD"], made.path)).stdout.trim() || null : null;

  await db.update(qaLanes).set({ review, marks, notes, status, headAfter: after, endedAt: new Date(), hold: null }).where(eq(qaLanes.id, lane.id));

  // The results on the ticket, the summary last (the floor reads the newest result).
  const ctx = qaCtx("qa", "qa.lane");
  const commit = lane.commit && SHA.test(lane.commit) ? lane.commit : undefined;
  const base = { project: p.slug, key: t.key, commit, branch: lane.branch ?? undefined };
  const add = (r: Omit<AddResultInput, "project" | "key">) => addResult(db, { ...base, ...r }, ctx).catch(() => undefined);
  const tests = testsOf(lane.verify);
  const w = say(QA_WORDS);
  if (lane.verify.length) {
    await add({
      kind: "test",
      verdict: verifyOk ? "pass" : "fail",
      cite: cut(`QA · ${lane.verify.map((v) => `${v.name} ${v.pass !== null || v.fail !== null ? w.of(v.pass ?? 0, (v.pass ?? 0) + (v.fail ?? 0)) : v.ok ? "ok" : w.verdict(false)}`).join(" · ")}`, 500),
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
      cite: cut(w.captures(lane.capture.ok, lane.capture.failed, lane.capture.error ?? null), 500),
      attachments: lane.capture.still_ids.slice(0, 24).map((id) => attachUrl(deps, p.slug, id)),
    });
  }
  if (review) await add({ kind: "subagent", verdict: review.verdict, cite: cut(w.reviewCite(review.model ? ` (${review.model})` : "", review.notes || w.verdict(review.verdict === "pass")), 1000) });
  const checkedOk = marks.filter((m) => m.mark === "pass").length;
  await add({
    kind: "verify",
    verdict: status,
    cite: cut(qaSummary({ pass, attempt: lane.attempt, verify: lane.verify, review, checksOnly, checklist: { ok: checkedOk, total: items.length }, captures: lane.capture ? lane.capture.ok : null }), 500),
    counts: { pass: tests.pass, fail: tests.total - tests.pass },
  });
  await db.insert(events).values({ projectId: p.id, taskId: t.id, taskKey: t.key, type: "verify.done", actor: qaActor("qa"), payload: { lane_id: lane.id, pass, checks_only: checksOnly } });
  await db.insert(events).values({
    projectId: p.id,
    taskId: t.id,
    taskKey: t.key,
    type: pass ? "qa.passed" : "qa.failed",
    actor: qaActor("qa"),
    payload: {
      lane_id: lane.id,
      attempt: lane.attempt,
      commit: lane.commit,
      tests,
      review: review?.verdict ?? null,
      ...(review?.spec && review.code ? { spec: review.spec.verdict, code: review.code.verdict } : {}),
      ...(review?.walked !== undefined ? { walked: review.walked } : {}),
      marks: marks.map((m) => ({ n: m.n, mark: m.mark })),
    },
  });
  if (!pass && lane.attempt === 1) await returnToTaller(db, { ...done, notes, status }, p, t);
}

async function returnToTaller(db: Db, lane: QaLane, p: Project, t0: Task): Promise<void> {
  const [t] = await db.select().from(tasks).where(eq(tasks.id, t0.id)).limit(1);
  if (!t || t.status !== "In review") return;
  const ctx: Ctx = { actor: { ...SYSTEM_ACTOR, machine: hostname() }, tool: "qa.return" };
  const text = say(QA_WORDS).returned(short(lane.commit), lane.attempt, lane.notes ?? "").slice(0, 4000);
  try {
    await setTask(db, { project: p.slug, key: t.key, status: "Ready", version: t.version, note: text } as never, ctx);
  } catch (e) {
    const why = e instanceof ToolError ? e.code : e instanceof Error ? e.message : String(e);
    await db.update(qaLanes).set({ hold: cut(say(QA_WORDS).couldNotReturn(why), 300) }).where(eq(qaLanes.id, lane.id));
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
  // AUDIT-10: one retro per ticket and delivery commit (off unless settings.qa.retro). Its why is QA's first finding.
  const first = (lane.notes ?? "").split("\n").find((l) => l.startsWith("- "))?.slice(2) ?? null;
  await queueRetro(db, { project: p, task: t, cause: "qa_returned", commit: lane.commit, why: first }).catch(() => undefined);
}

/** AUDIT-6: whether the QA run of this project is asked to walk through the change in a browser. */
export const browserWalk = (p: Pick<Project, "settings">): boolean => p.settings.qa?.browser === true && !!p.settings.capture;

// ---- What the QA run is told (runner.ts asks for it when it starts a QA run)

// ---- AUDIT-6: calibration. Where QA and the owner disagreed on this project, as short examples in the brief.

export type QaMiss = {
  key: string;
  title: string;
  // passed_then_changes: QA passed it and the owner asked for changes on that delivery.
  // failed_then_accepted: QA failed it twice and the owner accepted it.
  kind: "passed_then_changes" | "failed_then_accepted";
  qa: string; // what QA said, one line
  owner: string; // the owner's words, one line ("" when he only accepted)
  at: string;
};

const MISSES_MAX = 3;

/** Up to three recent deliveries of the project where the owner decided against QA's verdict, newest first. The
 *  texts are one line each, cut, with tokens and paths outside the repo taken out (oneLine in retro.ts). */
export async function qaMisses(db: Db, projectId: string, limit = MISSES_MAX): Promise<QaMiss[]> {
  const acted = await db
    .select({ state: threadMessages.actionState })
    .from(threadMessages)
    .innerJoin(threads, eq(threads.id, threadMessages.threadId))
    .where(and(eq(threads.projectId, projectId), sql`${threadMessages.actionState}->>'action' in ('cambios', 'aceptar')`))
    .orderBy(sql`(${threadMessages.actionState}->>'at')::timestamptz desc`)
    .limit(80);
  if (!acted.length) return [];
  const lanes = await db
    .select()
    .from(qaLanes)
    .where(and(eq(qaLanes.projectId, projectId), inArray(qaLanes.status, ["pass", "fail"])))
    .orderBy(desc(qaLanes.createdAt))
    .limit(300);
  const out: (Omit<QaMiss, "title"> & { laneId: string })[] = [];
  for (const { state } of acted) {
    if (out.length >= Math.min(limit, MISSES_MAX)) break;
    const result = (state?.result ?? {}) as { ticket?: unknown; text?: unknown; by?: unknown };
    // QA's own return and an automatic accept are not the owner's word.
    if (!state || typeof result.ticket !== "string" || result.by === "qa" || result.by === "auto") continue;
    const at = Date.parse(state.at);
    // The pass the owner had in front of him: the ticket's last one that had ended by then.
    const lane = lanes.find((l) => l.taskKey === result.ticket && !!l.endedAt && l.endedAt.getTime() <= at);
    if (!lane || out.some((m) => m.laneId === lane.id)) continue;
    if (state.action === "cambios" && lane.status === "pass") {
      const said = lane.review?.notes ? `"${oneLine(lane.review.notes, 220)}"` : "no findings";
      out.push({ laneId: lane.id, key: lane.taskKey, kind: "passed_then_changes", qa: said, owner: oneLine(typeof result.text === "string" ? result.text : "", 220), at: state.at });
    } else if (state.action === "aceptar" && lane.status === "fail" && lane.attempt >= 2 && !lane.returned) {
      out.push({ laneId: lane.id, key: lane.taskKey, kind: "failed_then_accepted", qa: `"${oneLine((lane.notes ?? "").replace(/^- /gm, ""), 220)}"`, owner: "", at: state.at });
    }
  }
  if (!out.length) return [];
  const titles = await db
    .select({ key: tasks.key, title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.key, out.map((m) => m.key))));
  return out.map(({ laneId: _lane, ...m }) => ({ ...m, title: oneLine(titles.find((t) => t.key === m.key)?.title ?? "", 80) }));
}

/** The misses as brief lines, under their heading. No misses: no lines. */
export function missLines(misses: QaMiss[]): string[] {
  if (!misses.length) return [];
  return [
    "Past misses of QA on this project, to learn from (the owner decided against QA's verdict; look for the same kind of thing here, and do not mention these cases in your report):",
    ...misses.map((m, i) =>
      m.kind === "passed_then_changes"
        ? `${i + 1}. ${m.key}${m.title ? ` «${m.title}»` : ""}: QA passed it (${m.qa}). The owner then asked for changes${m.owner ? `: "${m.owner}"` : "."}`
        : `${i + 1}. ${m.key}${m.title ? ` «${m.title}»` : ""}: QA failed it twice (${m.qa}). The owner accepted it as it was.`,
    ),
  ];
}

export type QaBrief = {
  prompt: string;
  model: string | null;
  // AUDIT-6: the report's JSON Schema, for `claude --json-schema` (the runner passes it).
  jsonSchema?: Record<string, unknown>;
  // AUDIT-6: this run walks through the test copy with a browser (settings.qa.browser and a settings.capture), so the
  // runner adds a browser tool server for it. appCommand starts the copy on appUrl's port.
  browser: boolean;
  appUrl: string | null;
  appCommand: string | null;
};

export async function qaBriefFor(db: Db, runId: string, cwd: string, deps: Pick<QaDeps, "freePort"> = {}): Promise<QaBrief | null> {
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
  const misses = await qaMisses(db, p.id);
  // AUDIT-6: the walk-through, only when the project asks for it and says how its test copy starts.
  const cs = p.settings.capture;
  const walk = browserWalk(p) && !!cs;
  const port = walk ? await (deps.freePort ?? freePort)() : null;
  const appUrl = walk ? `http://localhost:${port}` : null;
  const appCommand = walk ? cs!.start_command.replaceAll("{port}", String(port)) : null;
  const walkLines = walk
    ? [
        "This project asks you to walk through the change in the running app, with the browser tools:",
        `- Start the test copy from the workspace, in the background: \`PORT=${port} ${appCommand}\`. It answers at ${appUrl}${cs!.ready_path ?? "/"} once it is up (give it up to three minutes).`,
        ...(cs!.session
          ? [
              `- Pages behind the login use the test user ${cs!.session.user} (login at ${cs!.session.login_path}). Give it a fresh random password first with \`${cs!.session.password_command.replaceAll("{user}", cs!.session.user)}\` (it reads the new password twice on stdin). Never write that password to a file or to your report.`,
            ]
          : []),
        `- Open ${appUrl} and go through what this ticket changes as a user would: the screens it touches, its Done when, every check-list item that shows on screen. Look at it 1440 and 390 wide when the change is visible.`,
        "- What you see is evidence for both verdicts: a screen or a flow that does not do what the ticket asked fails spec; an error in the console, a failed request or a crash fails code.",
        `- Stop the app before you end (the process you started; nothing left listening on ${port}) and report "walked": true. If it did not start or you could not walk it, report "walked": false and say why in the code notes: that alone is not a fail.`,
      ]
    : [];
  const lines = [
    `You are the QA reviewer for project ${p.slug} (${p.title}), woken by the Plania runner on the delivery of ${t.key}: ${t.title}.`,
    `Delivery: commit ${short(lane.commit)} on branch ${lane.branch ?? "?"}${lane.prUrl ? `, PR ${lane.prUrl}` : ""}. Workspace: ${cwd} (read-only for you).`,
    "You have not seen how it was built, on purpose. Do not read the project thread, the ticket's notes or its log before your review: judge the change on its own.",
    `Read the ticket's scope and Done when with get_task (project ${p.slug}, key ${t.key}, fields ["title", "scope", "checks"]). Then read the change: git diff origin/${startBranchOf(p.settings)}...HEAD and the files it touches.`,
    `Already run by Plania on this commit: ${verify}${lane.verify.length ? ` (tests ${tests.pass} of ${tests.total})` : ""}. Captures: ${lane.capture ? `${lane.capture.ok} taken${lane.capture.error ? `, ${lane.capture.error}` : ""}` : "none configured"}.`,
    items.length
      ? `Check list del PO (mark every item pass or fail; run the tests or read the code to check it):\n${items.map((c) => `${c.n}. ${c.text}`).join("\n")}`
      : "There is no check list for this ticket: send an empty checklist.",
    "Never edit files, commit, push, open or edit a PR, or claim, start, finish or move the ticket, and never post in a thread: Plania records your report and acts on it.",
    "Your review gives two verdicts, and they are never merged: each has its own notes, about that question only.",
    "- spec: does the change do what the ticket asked? Judge it against the scope, the Done when and the check list. Fail it for a missing piece, for behaviour that is wrong against the ticket, or for scope creep (a change the ticket did not ask for).",
    "- code: is the change sound? Fail it for a bug, a broken edge case or unsafe handling (unchecked input, a secret in the code, data that can be lost). Style alone never fails.",
    ...(t.workType === "bug"
      ? ["This ticket fixes a bug: also confirm what must not change. Read the callers and the tests of what the diff touches, and say in the spec notes which behaviour around the fix you confirmed still works. A regression fails code."]
      : []),
    `Fail only a real defect, never a preference. Write the notes in ${ownerLanguage()}, exact: file:line, what is wrong, what would fix it. A verdict that passes gets one line on what you checked.`,
    ...walkLines,
    ...missLines(misses),
    "End your run with exactly one block, the last thing you write:",
    "```qa-report",
    `{"spec": {"verdict": "pass", "notes": "..."}, "code": {"verdict": "pass", "notes": "..."}, "checklist": [${items.map((c) => `{"n": ${c.n}, "mark": "pass", "note": "..."}`).join(", ")}]${walk ? ', "walked": true' : ""}}`,
    "```",
    'Each verdict and each mark is "pass" or "fail".',
  ];
  return { prompt: lines.join("\n"), model: lane.model, jsonSchema: QA_REPORT_SCHEMA, browser: walk, appUrl, appCommand };
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
  // AUDIT-6: spec and code are the two verdicts (absent on a review from before); walked says whether QA went
  // through the app in a browser (absent when the project does not ask for it).
  review: { verdict: "pass" | "fail"; notes: string; model: string | null; spec?: QaAxis; code?: QaAxis; walked?: boolean } | null;
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
