// PLA-I49-3: the brief's action registry. The only place that knows which action fits which Plania object in its
// live state. Every run() calls the server function behind today's button (Bandeja, Compañía, threads), never a copy:
//   answer          answer (src/mcp/questions.ts)             question, not answered
//   step_done       resolveHumanAction (src/mcp/blockers.ts)  human step, open
//   add_to_pr       actOnDecision "aplicar" (company-decisions, applyFileStep then the step)  file step with a PR
//   publish         shipRelease (src/mcp/release-ship.ts)     release whose plan says ship.ready
//   accept_pr       threadAction "aceptar" (thread-actions)   PR open, its ticket In review, a delivery message
//   request_changes threadAction "cambios"                    same
//   resume_runs     setProjectPaused (src/runner/company.ts)  project whose runs are paused
//   postpone        setTask Ready → Backlog                   Ready ticket
//   put_first       pickNext (src/api/company-actions.ts)     Ready ticket that is not first
//   hold            setTask → On hold                         initiative Planning or Active
//   fix_finding     fixFinding (src/mcp/orden.ts)             finding still there that has a one-click fix
//   later, dismiss  brief state only                          any row
// Three levels: instant (with undo where it can be undone), confirm (the page says exactly what happens first) and
// wake (PLA-I49-5). live() reads Plania now; handledLine() says when a row was already handled elsewhere.
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { agentRuns, agents, auditRuns, blockers, envStates, projects, pullRequests, questions, tasks, threadMessages, type Project } from "../db/schema.js";
import { actOnDecision, type DecisionDone, type DecisionRefusal } from "../api/company-decisions.js";
import { createPoTicket, pickNext, projectPo, startTeammateNow } from "../api/company-actions.js";
import { threadAction } from "../api/thread-actions.js";
import { ToolError } from "../mcp/errors.js";
import { canFixInOneClick, fixFinding } from "../mcp/orden.js";
import { answer } from "../mcp/questions.js";
import { resolveHumanAction } from "../mcp/blockers.js";
import { releasePending, releasePlan } from "../mcp/release-plan.js";
import { shipRelease } from "../mcp/release-ship.js";
import { webCtx, writeTx, WEB_ACTOR } from "../mcp/tx.js";
import { setTask } from "../mcp/writes.js";
import { setProjectPaused } from "../runner/company.js";
import { loadSettings } from "../runner/limits.js";
import { EVENT_SUMMARY } from "../runner/events.js";
import { projectThread, resolveThread } from "../runner/threads.js";
import { serviceAgent } from "../runner/events.js";
import type { HeartbeatDeps } from "../jobs/heartbeat.js";
import { roleOf } from "../runner/limits.js";
import type { Target } from "./types.js";

export type Level = "instant" | "confirm" | "wake";
export const ACTION_IDS = ["answer", "step_done", "add_to_pr", "publish", "accept_pr", "request_changes", "resume_runs", "postpone", "put_first", "hold", "fix_finding", "close_idea", "later", "dismiss", "give_to_po", "start_now", "start_building"] as const;
export type ActionId = (typeof ACTION_IDS)[number];
/** Brief-state actions: they write only brief_actions and fit every row, with or without a target. */
export const ROW_ACTIONS: ReadonlySet<ActionId> = new Set(["later", "dismiss"]);
/** Actions any open row has, about an object or not (PLA-I49-5: Give to PO works on the row's project). */
export const ANY_ROW: ReadonlySet<ActionId> = new Set(["later", "dismiss", "give_to_po"]);
/** What a row is, for actions that act on the row itself rather than its object. */
export type RowCtx = { title: string; detail: string | null; ref: string | null; project: string };

// ---- Live state

export type Live =
  | { kind: "gone" }
  | { kind: "question"; question: string; options: string[]; human_only: boolean; answered: boolean; answer: string | null; key: string | null }
  | { kind: "step"; text: string; satisfied: boolean; file: { path: string } | null; key: string; pr_url: string | null }
  | { kind: "release"; pending: boolean; unknown: boolean; ready: boolean; reason: string | null; ahead: number | null; tickets: string[]; migrations: string[]; before: number; open_checks: number; from: string; into: string; env: string }
  | { kind: "pr"; number: number; state: string; base: string | null; url: string; ticket: { key: string; status: string } | null; message_id: string | null }
  | { kind: "ticket"; key: string; status: string; title: string; first: boolean; paused: boolean; owner: string | null }
  | { kind: "initiative"; key: string; status: string; title: string; paused: boolean; next_phase: { phase: number; keys: string[] } | null }
  | { kind: "idea"; key: string; status: string; stage: string | null }
  | { kind: "runs"; paused: boolean }
  | { kind: "env"; env: string; commit: string | null; updated_at: string }
  | { kind: "finding"; code: string; key: string | null; present: boolean; id: string | null; fixable: boolean; detail: string | null };

const CLOSED = new Set(["Done", "Won't do"]);
const SHIPPED = new Set(["Done", "Won't do", "Merged", "Released"]);

async function projectBySlug(db: Db, slug: string): Promise<Project | null> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return p ?? null;
}

async function taskByKey(db: Db, projectId: string, key: string | undefined) {
  if (!key) return null;
  const [t] = await db.select().from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.key, key))).limit(1);
  return t ?? null;
}

/** The newest delivery message in the project's thread that links this ticket and was not acted on. */
async function deliveryMessage(db: Db, projectId: string, key: string): Promise<string | null> {
  const thread = await projectThread(db, projectId);
  const rows = await db
    .select({ id: threadMessages.id, links: threadMessages.links })
    .from(threadMessages)
    .where(and(eq(threadMessages.threadId, thread.id), isNull(threadMessages.actionState), sql`${threadMessages.authorAgent} <> 'jorge'`))
    .orderBy(desc(threadMessages.at))
    .limit(200);
  return rows.find((m) => m.links.some((l) => (l.kind === "ticket" || l.kind === "idea") && l.ref === key))?.id ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PLA-I49-5: an initiative's first open phase (the lowest phase with a ticket not Done or Won't do) and its tickets
 * still in Backlog: what Start building makes Ready. null when that phase has nothing in Backlog.
 */
async function nextPhase(db: Db, initiativeId: string): Promise<{ phase: number; keys: string[] } | null> {
  const kids = await db.select({ key: tasks.key, status: tasks.status, phase: tasks.phase }).from(tasks).where(and(eq(tasks.parentId, initiativeId), eq(tasks.kind, "ticket")));
  const open = kids.filter((k) => !CLOSED.has(k.status) && k.phase !== null);
  if (!open.length) return null;
  const phase = Math.min(...open.map((k) => k.phase!));
  const keys = open.filter((k) => k.phase === phase && k.status === "Backlog").map((k) => k.key).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return keys.length ? { phase, keys } : null;
}

/** What the target is in Plania right now. */
export async function live(db: Db, t: Target): Promise<Live> {
  const p = await projectBySlug(db, t.project);
  if (!p) return { kind: "gone" };
  switch (t.kind) {
    case "question": {
      if (!t.id || !UUID.test(t.id)) return { kind: "gone" };
      const [row] = await db.select({ q: questions, key: tasks.key }).from(questions).innerJoin(tasks, eq(tasks.id, questions.taskId)).where(and(eq(questions.id, t.id), eq(questions.projectId, p.id))).limit(1);
      if (!row) return { kind: "gone" };
      return { kind: "question", question: row.q.question, options: row.q.options, human_only: row.q.humanOnly, answered: !!row.q.answeredAt, answer: row.q.answer, key: row.key };
    }
    case "step": {
      if (!t.id || !UUID.test(t.id)) return { kind: "gone" };
      const [row] = await db.select({ b: blockers, t: tasks }).from(blockers).innerJoin(tasks, eq(tasks.id, blockers.taskId)).where(and(eq(blockers.id, t.id), eq(tasks.projectId, p.id), eq(blockers.type, "human_action"))).limit(1);
      if (!row) return { kind: "gone" };
      const spec = row.b.spec as { text?: string; file?: { path?: string } };
      return { kind: "step", text: String(spec.text ?? ""), satisfied: !!row.b.satisfiedAt || CLOSED.has(row.t.status), file: spec.file?.path ? { path: spec.file.path } : null, key: row.t.key, pr_url: row.t.prUrl };
    }
    case "release": {
      const plan = await releasePlan(db, p);
      if (!plan) return { kind: "gone" };
      return {
        kind: "release",
        pending: releasePending(plan),
        // No GitHub data yet: the step still shows, saying so (releaseUnknown), and is not handled.
        unknown: plan.ahead === null,
        ready: plan.ship.ready,
        reason: plan.ship.reason,
        ahead: plan.ahead,
        tickets: plan.tickets.map((x) => x.key),
        migrations: plan.migrations,
        before: plan.before.length,
        open_checks: plan.open_checks,
        from: plan.from.branch,
        into: plan.into.branch,
        env: plan.env,
      };
    }
    case "pr": {
      if (!t.pr) return { kind: "gone" };
      const [pr] = await db.select().from(pullRequests).where(and(eq(pullRequests.projectId, p.id), eq(pullRequests.number, t.pr))).limit(1);
      if (!pr) return { kind: "gone" };
      const ticket = pr.taskId ? (await db.select().from(tasks).where(eq(tasks.id, pr.taskId)).limit(1))[0] : await taskByKey(db, p.id, t.key);
      return {
        kind: "pr",
        number: pr.number,
        state: pr.state,
        base: pr.baseBranch,
        url: pr.url,
        ticket: ticket ? { key: ticket.key, status: ticket.status } : null,
        message_id: ticket && pr.state === "open" && ticket.status === "In review" ? await deliveryMessage(db, p.id, ticket.key) : null,
      };
    }
    case "ticket":
    case "initiative":
    case "idea": {
      const row = await taskByKey(db, p.id, t.key);
      if (!row) return { kind: "gone" };
      if (row.kind === "initiative") return { kind: "initiative", key: row.key, status: row.status, title: row.title, paused: p.runsPaused, next_phase: await nextPhase(db, row.id) };
      if (row.kind === "idea") return { kind: "idea", key: row.key, status: row.status, stage: row.stage };
      const owner = row.ownerAgent ? ((await db.select({ slug: agents.slug }).from(agents).where(eq(agents.id, row.ownerAgent)).limit(1))[0]?.slug ?? null) : null;
      return { kind: "ticket", key: row.key, status: row.status, title: row.title, first: p.settings.next_first === row.key, paused: p.runsPaused, owner };
    }
    case "runs":
      return { kind: "runs", paused: p.runsPaused };
    case "env": {
      if (!t.env) return { kind: "gone" };
      const [e] = await db.select().from(envStates).where(and(eq(envStates.projectId, p.id), eq(envStates.env, t.env))).limit(1);
      if (!e) return { kind: "gone" };
      return { kind: "env", env: e.env, commit: e.commit?.slice(0, 7) ?? null, updated_at: e.updatedAt.toISOString() };
    }
    case "finding": {
      const [row] = await db.select().from(auditRuns).where(eq(auditRuns.projectId, p.id)).limit(1);
      const f = (row?.findings ?? []).find((x) => x.code === t.code && (x.key ?? null) === (t.key ?? null));
      return { kind: "finding", code: t.code ?? "", key: t.key ?? null, present: !!f, id: f?.id ?? null, fixable: !!f?.id && canFixInOneClick(f.code), detail: f?.detail ?? null };
    }
  }
}

/** When the target was handled anywhere (Bandeja, Compañía, GitHub): one line saying how. Else null. */
export function handledLine(l: Live, opts: { itemStatus?: string; briefAt?: Date; lang?: string } = {}): string | null {
  const es = opts.lang === "es";
  switch (l.kind) {
    case "gone":
      return null;
    case "question":
      return l.answered ? (es ? `Respondida: ${l.answer ?? ""}` : `Answered: ${l.answer ?? ""}`).trim() : null;
    case "step":
      return l.satisfied ? (es ? "Paso hecho" : "Step done") : null;
    case "release":
      return l.pending || l.unknown ? null : es ? "Ya no hay nada que publicar" : "Nothing left to publish";
    case "pr":
      return l.state === "merged" ? (es ? `#${l.number} fusionado` : `#${l.number} merged`) : l.state === "closed" ? (es ? `#${l.number} cerrado` : `#${l.number} closed`) : null;
    case "ticket":
      if (SHIPPED.has(l.status)) return `${l.key}: ${l.status}`;
      // A Ready row ("Start", "Put first") is handled once the ticket moved on.
      if (opts.itemStatus === "next" && l.status !== "Ready" && l.status !== "In review") return `${l.key}: ${l.status}`;
      return null;
    case "initiative":
    case "idea":
      return CLOSED.has(l.status) ? `${l.key}: ${l.status}` : null;
    case "runs":
      return l.paused ? null : es ? "Las corridas están activas" : "Runs are on";
    case "env":
      return opts.briefAt && new Date(l.updated_at) > opts.briefAt ? (es ? `Registro actualizado (${l.commit ?? "?"})` : `Record updated (${l.commit ?? "?"})`) : null;
    case "finding":
      return l.present ? null : es ? "La auditoría ya no lo encuentra" : "The audit no longer finds it";
  }
}

// ---- The registry

export type RunOutcome = { line: string; result?: Record<string, unknown>; undo?: Record<string, unknown> };
export type ActionRefusal = { error: string; hint: string };
export type Lang = "en" | "es";
type Run = (db: Db, t: Target, l: Live, input: Record<string, unknown>, lang: Lang, row: RowCtx) => Promise<RunOutcome | ActionRefusal>;

// The outcome line a row keeps, in the brief's language.
const OUT = {
  en: {
    answered: (a: string) => `Answered: ${a}`,
    step: (k: string) => `Step done on ${k}`,
    added: (n: number, path: string, branch: string) => `Added ${n} line${n === 1 ? "" : "s"} to ${path} on ${branch}`,
    had: (path: string) => `${path} already had those lines`,
    published: (into: string, n: number) => `Published to ${into} with #${n}`,
    merged: (n: number, base: string) => `#${n} merged into ${base}`,
    status: (k: string, st: string) => `${k}: ${st}`,
    changes: (k: string) => `Changes asked on ${k}`,
    runsOn: "Runs turned on",
    backlog: (k: string) => `${k} back to Backlog`,
    first: (k: string) => `${k} goes first`,
    hold: (k: string) => `${k} on hold`,
    fixed: (c: string, k: string | null) => `Fixed: ${c}${k ? ` on ${k}` : ""}`,
    later: (u: string | null) => (u ? `Later, until ${u}` : "Later"),
    dismissed: (r: string | null) => (r ? `Not relevant: ${r}` : "Not relevant"),
    undone: "Undone",
    paused: "Runs paused again",
    firstAgain: (k: string | null) => (k ? `${k} goes first again` : "No ticket goes first"),
    back: (k: string, st: string) => `${k} back to ${st}`,
    toPo: (po: string, k: string) => `Given to ${po}: ${k}`,
    started: (who: string, k: string | null) => `${who} started${k ? ` on ${k}` : ""}`,
    queued: (who: string, k: string | null) => `${who} queued${k ? ` for ${k}` : ""}`,
    building: (keys: string[]) => `${keys.join(", ")} Ready for Taller`,
  },
  es: {
    answered: (a: string) => `Respondida: ${a}`,
    step: (k: string) => `Paso hecho en ${k}`,
    added: (n: number, path: string, branch: string) => `${n} ${n === 1 ? "línea agregada" : "líneas agregadas"} a ${path} en ${branch}`,
    had: (path: string) => `${path} ya tenía esas líneas`,
    published: (into: string, n: number) => `Publicado a ${into} con #${n}`,
    merged: (n: number, base: string) => `#${n} fusionado en ${base}`,
    status: (k: string, st: string) => `${k}: ${st}`,
    changes: (k: string) => `Cambios pedidos en ${k}`,
    runsOn: "Corridas activadas",
    backlog: (k: string) => `${k} volvió a Backlog`,
    first: (k: string) => `${k} va primero`,
    hold: (k: string) => `${k} en espera`,
    fixed: (c: string, k: string | null) => `Corregido: ${c}${k ? ` en ${k}` : ""}`,
    later: (u: string | null) => (u ? `Después, hasta el ${u}` : "Después"),
    dismissed: (r: string | null) => (r ? `No aplica: ${r}` : "No aplica"),
    undone: "Deshecho",
    paused: "Corridas en pausa otra vez",
    firstAgain: (k: string | null) => (k ? `${k} va primero otra vez` : "Ningún ticket va primero"),
    back: (k: string, st: string) => `${k} volvió a ${st}`,
    toPo: (po: string, k: string) => `Para ${po}: ${k}`,
    started: (who: string, k: string | null) => `${who} arrancó${k ? ` con ${k}` : ""}`,
    queued: (who: string, k: string | null) => `${who} en cola${k ? ` para ${k}` : ""}`,
    building: (keys: string[]) => `${keys.join(", ")} listos para Taller`,
  },
} as const;
export const outLines = (lang: string) => OUT[lang === "es" ? "es" : "en"];

export type ActionDef = {
  id: ActionId;
  level: Level;
  /** Can be undone with POST /api/brief/act/:id/undo. */
  undo: boolean;
  applies: (t: Target | null, l: Live | null) => boolean;
  input: z.ZodType<Record<string, unknown>>;
  run: Run;
};

const none = z.object({}).strict();
const refusal = (e: unknown): ActionRefusal | null =>
  e instanceof ToolError ? { error: e.code, hint: String((e.detail as { hint?: string } | undefined)?.hint ?? e.message ?? e.code) } : null;
async function guarded(fn: () => Promise<RunOutcome | ActionRefusal>): Promise<RunOutcome | ActionRefusal> {
  try {
    return await fn();
  } catch (e) {
    const r = refusal(e);
    if (r) return r;
    throw e;
  }
}
const ctxOf = (tool: string) => ({ ...webCtx, tool: `screen.brief_${tool}` });

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const REGISTRY: Record<ActionId, ActionDef> = {
  answer: {
    id: "answer",
    level: "instant",
    undo: false,
    applies: (_t, l) => l?.kind === "question" && !l.answered,
    input: z.union([z.object({ option: z.number().int().min(1).max(20) }).strict(), z.object({ text: z.string().trim().min(1).max(2000) }).strict()]),
    run: (db, t, l, input, lang) =>
      guarded(async () => {
        if (l.kind !== "question") return { error: "STALE", hint: "not a question" };
        const text = typeof input.option === "number" ? l.options[input.option - 1] : String(input.text ?? "");
        if (!text) return { error: "INVALID_OPTION", hint: "That option is not on the question." };
        await answer(db, { project: t.project, question_id: t.id!, answer: text }, ctxOf("answer"));
        return { line: OUT[lang].answered(text), result: { answer: text } };
      }),
  },
  step_done: {
    id: "step_done",
    level: "instant",
    // A resolved step may already have moved its ticket to Ready: there is no safe way back.
    undo: false,
    applies: (_t, l) => l?.kind === "step" && !l.satisfied,
    input: z.object({ note: z.string().trim().max(2000).optional() }).strict(),
    run: (db, t, _l, input, lang) =>
      guarded(async () => {
        const p = (await projectBySlug(db, t.project))!;
        const note = typeof input.note === "string" && input.note ? input.note : undefined;
        const out = await writeTx(db, p, ctxOf("step"), (tx, emit) => resolveHumanAction(tx, emit, p.id, t.id!, WEB_ACTOR, note));
        return { line: OUT[lang].step(out.key), result: out };
      }),
  },
  add_to_pr: {
    id: "add_to_pr",
    level: "confirm",
    undo: false,
    applies: (_t, l) => l?.kind === "step" && !l.satisfied && !!l.file && !!l.pr_url,
    input: none,
    run: async (db, t, _l, _i, lang) => {
      const out = await actOnDecision(db, `b-${t.id}`, { action: "aplicar" });
      if (out.ok !== true) {
        const no = out as DecisionRefusal;
        return { error: no.error, hint: no.hint };
      }
      const done = out as DecisionDone;
      const r = done.state.result as { path?: string; added?: number; branch?: string };
      return { line: r.added ? OUT[lang].added(r.added, String(r.path), String(r.branch)) : OUT[lang].had(String(r.path)), result: done.state.result };
    },
  },
  publish: {
    id: "publish",
    level: "confirm",
    undo: false,
    applies: (_t, l) => l?.kind === "release" && l.pending && l.ready,
    input: none,
    run: (db, t, _l, _i, lang) =>
      guarded(async () => {
        const out = await shipRelease(db, t.project, ctxOf("publish"));
        return { line: OUT[lang].published(out.into.branch, out.pr.number), result: { pr: out.pr, merge_sha: out.merge_sha, tickets: out.tickets } };
      }),
  },
  accept_pr: {
    id: "accept_pr",
    level: "confirm",
    undo: false,
    applies: (_t, l) => l?.kind === "pr" && l.state === "open" && l.ticket?.status === "In review" && !!l.message_id,
    input: none,
    run: (db, t, l, _i, lang) =>
      guarded(async () => {
        if (l.kind !== "pr" || !l.message_id) return { error: "STALE", hint: "no delivery to accept" };
        const out = await threadAction(db, await resolveThread(db, t.project), { message_id: l.message_id, action: "aceptar" });
        if ("error" in out) return { error: out.error, hint: out.hint };
        const r = out.action_state.result as { merged?: boolean; base?: string; status?: string; ticket?: string };
        return { line: r.merged ? OUT[lang].merged(l.number, r.base ?? "sandbox") : OUT[lang].status(String(r.ticket ?? l.ticket?.key), r.status ?? "Done"), result: out.action_state.result };
      }),
  },
  request_changes: {
    id: "request_changes",
    level: "confirm",
    undo: false,
    applies: (_t, l) => l?.kind === "pr" && l.state === "open" && !!l.ticket && !SHIPPED.has(l.ticket.status) && !!l.message_id,
    input: z.object({ text: z.string().trim().min(1).max(2000) }).strict(),
    run: (db, t, l, input, lang) =>
      guarded(async () => {
        if (l.kind !== "pr" || !l.message_id) return { error: "STALE", hint: "no delivery" };
        const out = await threadAction(db, await resolveThread(db, t.project), { message_id: l.message_id, action: "cambios", text: String(input.text) });
        if ("error" in out) return { error: out.error, hint: out.hint };
        return { line: OUT[lang].changes(String(l.ticket?.key)), result: out.action_state.result };
      }),
  },
  resume_runs: {
    id: "resume_runs",
    level: "confirm",
    undo: true,
    // A paused project's ticket or initiative offers it too (D7: "Waiting: <Project> runs are paused").
    applies: (_t, l) => (l?.kind === "runs" && l.paused) || ((l?.kind === "ticket" || l?.kind === "initiative") && l.paused && !CLOSED.has(l.status)),
    input: none,
    run: (db, t, _l, _i, lang) =>
      guarded(async () => {
        await setProjectPaused(db, t.project, false);
        return { line: OUT[lang].runsOn, undo: { paused: true } };
      }),
  },
  postpone: {
    id: "postpone",
    level: "instant",
    undo: true,
    applies: (_t, l) => l?.kind === "ticket" && l.status === "Ready",
    input: none,
    run: (db, t, _l, _i, lang) =>
      guarded(async () => {
        const p = (await projectBySlug(db, t.project))!;
        const row = (await taskByKey(db, p.id, t.key))!;
        await setTask(db, { project: t.project, key: row.key, status: "Backlog", version: row.version, note: "Jorge lo aplazó desde el brief." } as never, ctxOf("postpone"));
        return { line: OUT[lang].backlog(row.key), undo: { status: "Ready" } };
      }),
  },
  put_first: {
    id: "put_first",
    level: "instant",
    undo: true,
    applies: (_t, l) => l?.kind === "ticket" && l.status === "Ready" && !l.first,
    input: none,
    run: async (db, t, _l, _i, lang) => {
      const p = (await projectBySlug(db, t.project))!;
      const before = p.settings.next_first ?? null;
      const out = await pickNext(db, t.project, t.key!);
      if ("error" in out) return { error: out.error, hint: out.hint };
      return { line: OUT[lang].first(String(t.key)), undo: { next_first: before } };
    },
  },
  hold: {
    id: "hold",
    level: "instant",
    undo: true,
    applies: (_t, l) => l?.kind === "initiative" && (l.status === "Planning" || l.status === "Active"),
    input: none,
    run: (db, t, l, _i, lang) =>
      guarded(async () => {
        const p = (await projectBySlug(db, t.project))!;
        const row = (await taskByKey(db, p.id, t.key))!;
        await setTask(db, { project: t.project, key: row.key, status: "On hold", version: row.version, note: "Jorge lo puso en espera desde el brief." } as never, ctxOf("hold"));
        return { line: OUT[lang].hold(row.key), undo: { status: l.kind === "initiative" ? l.status : "Planning" } };
      }),
  },
  fix_finding: {
    id: "fix_finding",
    level: "confirm",
    undo: false,
    applies: (_t, l) => l?.kind === "finding" && l.present && l.fixable,
    input: none,
    run: (db, t, l, _i, lang) =>
      guarded(async () => {
        if (l.kind !== "finding" || !l.id) return { error: "STALE", hint: "the finding is gone" };
        const p = (await projectBySlug(db, t.project))!;
        await fixFinding(db, p, { code: l.code, key: l.key, id: l.id });
        return { line: OUT[lang].fixed(l.code, l.key) };
      }),
  },
  // PLA-I49-6: a Plania idea (its sketch or research came back) discarded from the brief: Won't do, with the reason.
  close_idea: {
    id: "close_idea",
    level: "instant",
    undo: false,
    applies: (_t, l) => l?.kind === "idea" && l.status === "Open",
    input: z.object({ reason: z.string().trim().min(1).max(300).optional() }).strict(),
    run: (db, t, _l, input, lang) =>
      guarded(async () => {
        const p = (await projectBySlug(db, t.project))!;
        const row = (await taskByKey(db, p.id, t.key))!;
        const why = typeof input.reason === "string" ? input.reason : "not now";
        await setTask(db, { project: t.project, key: row.key, status: "Won't do", version: row.version, reason: `Descartada desde el brief: ${why}` } as never, ctxOf("close_idea"));
        return { line: lang === "es" ? `${row.key} descartada: ${why}` : `${row.key} discarded: ${why}` };
      }),
  },
  later: {
    id: "later",
    level: "instant",
    undo: true,
    applies: () => true,
    input: z.object({ until: z.string().regex(DATE).optional() }).strict(),
    run: async (_db, _t, _l, input, lang) => ({ line: OUT[lang].later(typeof input.until === "string" ? input.until : null), result: { until: input.until ?? null } }),
  },
  dismiss: {
    id: "dismiss",
    level: "instant",
    undo: true,
    applies: () => true,
    input: z.object({ reason: z.string().trim().max(300).optional() }).strict(),
    run: async (_db, _t, _l, input, lang) => ({ line: OUT[lang].dismissed(typeof input.reason === "string" ? input.reason : null), result: { reason: input.reason ?? null } }),
  },
  // ---- PLA-I49-5: actions that wake a bot. Each shows who wakes and about how long before it runs (wakeInfo).
  give_to_po: {
    id: "give_to_po",
    level: "wake",
    undo: false,
    applies: () => true,
    input: z.object({ note: z.string().trim().max(1000).optional() }).strict(),
    run: (db, _t, _l, input, lang, row) =>
      guarded(async () => {
        const p = await projectBySlug(db, row.project);
        if (!p) return { error: "PROJECT_NOT_FOUND", hint: "The row's project is gone." };
        const po = await projectPo(db, p);
        if (!po) return { error: "NO_PO", hint: `${p.title} has no product owner that runs in Claude Code.` };
        const text = [row.title, row.detail, row.ref ? `(${row.ref})` : null, typeof input.note === "string" && input.note ? `Nota de Jorge: ${input.note}` : null].filter(Boolean).join("\n");
        // A Ready ticket owned by the PO, origin jorge; the event hook queues the PO's wake in the same write. A
        // busy PO is not lost: when its run ends, wakePoIfWaiting takes its oldest Ready ticket. A paused project
        // keeps the ticket and wakes the PO once when its runs are turned on (project.runs_resumed).
        const made = await createPoTicket(db, p, po, text, "el brief de la mañana");
        await reasonOnQueued(db, po.id, made.key, `order from the morning brief: ${row.title}`);
        return { line: OUT[lang].toPo(po.slug, made.key), result: { key: made.key, agent: po.slug, wake: made.wake, project: p.slug } };
      }),
  },
  start_now: {
    id: "start_now",
    level: "wake",
    undo: false,
    applies: (_t, l) => l?.kind === "ticket" && l.status === "Ready" && !l.paused,
    input: none,
    run: (db, t, l, _i, lang) =>
      guarded(async () => {
        if (l.kind !== "ticket") return { error: "STALE", hint: "not a ticket" };
        const who = await ownerOf(db, t.project, l.owner);
        if (!who) return { error: "AGENT_NOT_FOUND", hint: "Nobody on this project's team takes this ticket." };
        const out = await startTeammateNow(db, t.project, who, { reason: `started from the morning brief: ${l.key}` }, wakeDeps.heartbeat);
        if ("error" in out) return { error: out.error, hint: out.hint };
        if (out.reason === "started") return { line: OUT[lang].started(who, out.ticket), result: { agent: who, run_id: out.run_id, ticket: out.ticket, reason: out.reason } };
        if (out.reason === "queued" || out.reason === "busy") return { line: OUT[lang].queued(who, out.ticket ?? l.key), result: { agent: who, run_id: out.run_id, ticket: out.ticket ?? l.key, reason: out.reason } };
        return { error: out.reason.toUpperCase(), hint: out.summary || out.reason };
      }),
  },
  start_building: {
    id: "start_building",
    level: "wake",
    undo: false,
    applies: (_t, l) => l?.kind === "initiative" && !CLOSED.has(l.status) && l.status !== "On hold" && !!l.next_phase,
    input: none,
    run: (db, t, l, _i, lang) =>
      guarded(async () => {
        if (l.kind !== "initiative" || !l.next_phase) return { error: "STALE", hint: "nothing waits in Backlog" };
        const p = (await projectBySlug(db, t.project))!;
        // Only the first open phase, nothing else: moving it to Ready wakes Taller through the event hook.
        for (const key of l.next_phase.keys) {
          const row = (await taskByKey(db, p.id, key))!;
          await setTask(db, { project: t.project, key, status: "Ready", version: row.version, note: "Jorge lo empezó desde el brief." } as never, ctxOf("start_building"));
        }
        return { line: OUT[lang].building(l.next_phase.keys), result: { keys: l.next_phase.keys, phase: l.next_phase.phase } };
      }),
  },
};

/** Tests: a fake runner for Start now. Never set outside tests. */
export const wakeDeps: { heartbeat?: HeartbeatDeps } = {};

/** The team member a ticket goes to: its owner, else the project's Taller. */
async function ownerOf(db: Db, slug: string, owner: string | null): Promise<string | null> {
  if (owner) return owner;
  const p = await projectBySlug(db, slug);
  return p ? ((await serviceAgent(db, "taller", p))?.slug ?? null) : null;
}

/** The event hook queued the wake with a generic reason; the bot reads "Why you woke" from it, so say why. */
async function reasonOnQueued(db: Db, agentId: string, key: string, reason: string): Promise<void> {
  await db
    .update(agentRuns)
    .set({ summary: `${EVENT_SUMMARY} ${reason}`.slice(0, 500) })
    .where(and(eq(agentRuns.agentId, agentId), eq(agentRuns.taskKey, key), eq(agentRuns.status, "queued")));
}

export type WakeInfo = { agent: string | null; role: string | null; low: number; high: number; paused: boolean; company_paused: boolean; busy: boolean };
const MINUTES: Record<string, [number, number]> = { "product-owner": [10, 25], taller: [20, 45], research: [10, 20], artist: [10, 20] };

/** Who a wake action wakes and about how long, for the cost line shown before it runs. */
export async function wakeInfo(db: Db, action: ActionId, t: Target | null, l: Live | null, project: string): Promise<WakeInfo | null> {
  if (REGISTRY[action].level !== "wake") return null;
  const p = await projectBySlug(db, project);
  if (!p) return null;
  let agent: { id: string; slug: string } | null = null;
  if (action === "give_to_po") agent = await projectPo(db, p);
  else if (action === "start_now" && l?.kind === "ticket") {
    const slug = await ownerOf(db, project, l.owner);
    agent = slug ? ((await db.select().from(agents).where(eq(agents.slug, slug)).limit(1))[0] ?? null) : null;
  } else if (action === "start_building") agent = await serviceAgent(db, "taller", p);
  const full = agent ? (await db.select().from(agents).where(eq(agents.id, agent.id)).limit(1))[0] : undefined;
  const role = full ? roleOf(full) : null;
  const [lo, hi] = MINUTES[role ?? ""] ?? [10, 30];
  const [busy] = agent ? await db.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.agentId, agent.id), inArray(agentRuns.status, ["queued", "running"]))).limit(1) : [];
  const companyPaused = (await loadSettings(db)).companyPaused;
  void t;
  return { agent: agent?.slug ?? null, role, low: lo, high: hi, paused: p.runsPaused, company_paused: companyPaused, busy: !!busy };
}

/** The actions that fit a target in its live state, the main one first. Row actions are added by the caller. */
export function actionsFor(t: Target | null, l: Live | null): ActionId[] {
  if (!t || !l || l.kind === "gone") return [];
  const ids = (Object.values(REGISTRY) as ActionDef[]).filter((a) => !ANY_ROW.has(a.id) && a.applies(t, l)).map((a) => a.id);
  // On a paused project's ticket or initiative, Turn on runs comes after the object's own actions.
  return l.kind === "runs" ? ids : [...ids.filter((id) => id !== "resume_runs"), ...ids.filter((id) => id === "resume_runs")];
}

/** Undo an instant action: put back what run() changed. Brief-state actions need nothing here. */
export async function undoRun(db: Db, action: ActionId, t: Target | null, undo: Record<string, unknown> | undefined, lang: Lang = "en"): Promise<RunOutcome | ActionRefusal> {
  const o = OUT[lang];
  if (ROW_ACTIONS.has(action)) return { line: o.undone };
  if (!t || !undo) return { error: "NOT_UNDOABLE", hint: "This action cannot be undone." };
  return guarded(async () => {
    const p = await projectBySlug(db, t.project);
    if (!p) return { error: "PROJECT_NOT_FOUND", hint: "The project is gone." };
    if (action === "resume_runs") {
      await setProjectPaused(db, t.project, true);
      return { line: o.paused };
    }
    if (action === "put_first") {
      const before = typeof undo.next_first === "string" ? undo.next_first : null;
      const settings = { ...p.settings };
      if (before) settings.next_first = before;
      else delete settings.next_first;
      await db.update(projects).set({ settings, updatedAt: sql`now()` }).where(eq(projects.id, p.id));
      return { line: o.firstAgain(before) };
    }
    if (action === "postpone" || action === "hold") {
      const row = await taskByKey(db, p.id, t.key);
      if (!row) return { error: "TASK_NOT_FOUND", hint: "The ticket is gone." };
      await setTask(db, { project: t.project, key: row.key, status: String(undo.status), version: row.version, note: "Jorge deshizo el cambio desde el brief." } as never, ctxOf(`undo_${action}`));
      return { line: o.back(row.key, String(undo.status)) };
    }
    return { error: "NOT_UNDOABLE", hint: "This action cannot be undone." };
  });
}
