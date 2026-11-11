// PLA-I35-1: Te toca. The rows of GET /api/company decisions[] and POST /api/company/decisions/:id (screen only).
// A decision lives in one place; the card and Asistente only point to it. Rows, newest first:
//   proposal     the PO's latest message in its project thread when it carries numbered options ("1." "2." …)
//                and Jorge has not written after it. Options parsed with the recommended one ("recomiendo …").
//                elegir {option: n | [n, m]} posts "Elijo n: <label>" in the project thread as Jorge, through the
//                same path as his own message (jorgePosts): the PO's Ready ticket is made and the PO wakes.
//                responder {text} posts the text the same way. Either writes action_state on the PO's message.
//   pr | deliverable  a thread message with Fusionar / Aceptar · Pedir cambios: the thread action, reused.
//   action       a Ready ticket owned by ceo: hecho moves it to Done, aplazar to Backlog.
//   question     an open question (with its options when it has them): elegir {option} or responder {text}
//                answers it. Questions of paused projects show only when human_only.
// PLA-I36-2: Te toca holds everything Bandeja calls a paso, and a row carries its evidence.
//   step         a human_action a ticket is blocked on: hecho {note?} resolves it (as Bandeja does).
//   release      a project's release step (from → into): commits ahead, the tickets it ships, open checks.
//                Publishing stays behind the owner's code (PLA-I36-11): the row opens it in Bandeja.
//   Every row carries links (doc, PR, ticket of its message or ticket), body (the full message, for a
//   proposal or a delivery) and checks ({open, ci}: a ticket's open checks and its PR's CI).
// Acted rows stay 24 hours with their state so the screen can show the result in place. Acting twice is 409
// ALREADY_ACTED: a message's action_state is claimed before anything is posted, a ticket must still be Ready,
// a question still open.
import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { checks, projects, pullRequests, questions, tasks, threadMessages, threads, type ActionState, type Project, type Task, type ThreadLink } from "../db/schema.js";
import { inboxFor, type InboxItem } from "../mcp/inbox.js";
import { resolveHumanAction } from "../mcp/blockers.js";
import { writeTx } from "../mcp/tx.js";
import { ToolError } from "../mcp/errors.js";
import type { ReleasePlan } from "../mcp/release-plan.js";
import { setCheck } from "../mcp/checks.js";
import { answer } from "../mcp/questions.js";
import { webCtx } from "../mcp/tx.js";
import { setTask } from "../mcp/writes.js";
import { loadSettings } from "../runner/limits.js";
import { JORGE, actionsFor, resolveThread, type MessageAction } from "../runner/threads.js";
import { ceoAgentId } from "./company-plan.js";
import { threadAction } from "./thread-actions.js";
import { jorgePosts } from "./threads.js";

const HOUR = 3_600_000;
const KEEP_ACTED = 24 * HOUR;
const RANK: Record<DecisionKind, number> = { proposal: 0, question: 1, pr: 2, deliverable: 3, step: 4, action: 5, release: 6 };

export type DecisionKind = "proposal" | "action" | "question" | "deliverable" | "pr" | "step" | "release";
export type DecisionAction = "elegir" | "responder" | "hecho" | "aplazar" | "aceptar" | "fusionar" | "cambios";
export type DecisionOption = { n: number; label: string; recommended: boolean };
export type DecisionState = { action: string; at: string; result: Record<string, unknown> };
export type DecisionLink = { kind: "doc" | "pr" | "ticket" | "idea"; ref: string; title: string };
export type DecisionChecks = { open: number; ci: "pending" | "success" | "failure" | null };
export type DecisionRelease = { from: string; into: string; env: string; ahead: number | null; tickets: { key: string; title: string }[]; open_checks: number; before: number };
export type Decision = {
  id: string;
  project: string | null;
  title: string;
  kind: DecisionKind;
  options: DecisionOption[] | null;
  actions: DecisionAction[];
  state: DecisionState | null;
  at: string;
  ref: string | null;
  detail: string | null;
  links: DecisionLink[];
  body: string | null;
  checks: DecisionChecks | null;
  release: DecisionRelease | null;
};

// ---- parsing a PO's proposal

export type Proposal = { title: string; options: DecisionOption[]; note: string | null };

const OPTION = /^\s*(?:[-*]\s*)?(?:\*\*)?(\d{1,2})[.)](?:\*\*)?\s+(.+?)\s*$/;
const ORDINAL: Record<string, number> = { primer: 1, primero: 1, primera: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3, tercer: 3, cuarto: 4, cuarta: 4, quinto: 5, quinta: 5 };
const RECOMMEND_IN_LINE = /\s*[·(—–-]*\s*\(?\s*(?:recomendad[oa]|recomiendo(?: est[ae])?)\s*\)?\s*\.?$/i;
const clean = (s: string) => s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function parseProposal(body: string): Proposal | null {
  const lines = body.split("\n");
  const found: { n: number; text: string; line: number }[] = [];
  lines.forEach((l, i) => {
    const m = OPTION.exec(l);
    if (m) found.push({ n: Number(m[1]), text: m[2]!, line: i });
  });
  // One list 1, 2, 3 … from the first "1.".
  const start = found.findIndex((f) => f.n === 1);
  if (start < 0) return null;
  const list: typeof found = [];
  for (const f of found.slice(start)) {
    if (f.n !== list.length + 1) break;
    list.push(f);
  }
  if (list.length < 2) return null;

  let recommended: number | null = null;
  const options = list.map((f) => {
    const text = clean(f.text);
    const marked = RECOMMEND_IN_LINE.test(text) || /\brecomend/i.test(text);
    if (marked && recommended == null) recommended = f.n;
    return { n: f.n, label: cut(text.replace(RECOMMEND_IN_LINE, "").replace(/\s*[·—–-]\s*$/, "").trim(), 200), recommended: false };
  });
  const outside = [...lines.slice(0, list[0]!.line), ...lines.slice(list.at(-1)!.line + 1)].join(" ");
  if (recommended == null) {
    const m = /recomiendo\s+(?:la\s+|el\s+)?(?:opci[oó]n\s+)?(\d{1,2}|primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa])\b/i.exec(outside) ?? /(\d{1,2}|primer[oa]?|segund[oa]|tercer[oa]?)[^.\n]{0,20}\brecomend/i.exec(outside);
    if (m) {
      const word = m[1]!.toLowerCase();
      const n = /^\d+$/.test(word) ? Number(word) : ORDINAL[word];
      if (n && n <= options.length) recommended = n;
    }
  }
  for (const o of options) o.recommended = o.n === recommended;

  const intro = clean(lines.slice(0, list[0]!.line).join(" ")).replace(/:$/, "");
  const sentences = intro.split(/(?<=[.!?])\s+/).filter(Boolean);
  const lastIntro = sentences.at(-1)?.replace(/[.:]$/, "") ?? "";
  const title = lastIntro && lastIntro.length <= 120 ? lastIntro : `El PO propone ${options.length} opciones`;
  const after = lines
    .slice(list.at(-1)!.line + 1)
    .map(clean)
    .filter(Boolean)
    .filter((l) => !/^recomiendo\b/i.test(l));
  return { title, options, note: after[0] ? cut(after[0], 160) : null };
}

// ---- reading

const firstLine = (s: string, n = 140) => cut(clean(s.trim().split("\n").find((l) => l.trim()) ?? ""), n);
const stateOf = (s: ActionState | null | undefined): DecisionState | null => (s ? { action: s.action, at: s.at, result: s.result ?? {} } : null);
const NO_EVIDENCE = { links: [] as DecisionLink[], body: null, checks: null, release: null };
const linksOf = (links: ThreadLink[]): DecisionLink[] =>
  links.filter((l): l is ThreadLink & { kind: DecisionLink["kind"] } => l.kind !== "question").map((l) => ({ kind: l.kind, ref: l.ref, title: l.title }));
const CI = new Set(["pending", "success", "failure"]);

// A ticket's open checks and its PR's CI (the PR by url, else the newest PR on the ticket).
async function evidenceOf(db: Db, t: Task | null, prUrl: string | null): Promise<DecisionChecks | null> {
  if (!t && !prUrl) return null;
  let open = 0;
  if (t) {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(checks).where(and(eq(checks.taskId, t.id), eq(checks.done, false), isNull(checks.waivedAt)));
    open = Number(row?.n ?? 0);
  }
  const url = prUrl ?? t?.prUrl ?? null;
  const prs = await db
    .select({ ci: pullRequests.ciState })
    .from(pullRequests)
    .where(url ? eq(pullRequests.url, url) : eq(pullRequests.taskId, t!.id))
    .orderBy(desc(pullRequests.updatedAt))
    .limit(1);
  const ci = prs[0]?.ci && CI.has(prs[0].ci) ? (prs[0].ci as DecisionChecks["ci"]) : null;
  return { open, ci };
}

async function ticketByKey(db: Db, projectId: string | null | undefined, key: string | null | undefined): Promise<Task | null> {
  if (!projectId || !key) return null;
  const [t] = await db.select().from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.key, key))).limit(1);
  return t ?? null;
}

async function proposalRows(db: Db, since: Date, slugById: Map<string, Project>): Promise<Decision[]> {
  const out: Decision[] = [];
  const rows = await db.select().from(threads).where(and(eq(threads.kind, "project"), isNotNull(threads.projectId)));
  for (const th of rows) {
    const p = slugById.get(th.projectId!);
    if (!p) continue;
    const msgs = await db.select().from(threadMessages).where(eq(threadMessages.threadId, th.id)).orderBy(desc(threadMessages.at), desc(threadMessages.id)).limit(40);
    // The PO's latest message; nothing from Jorge after it unless it is his choice on it.
    const idx = msgs.findIndex((m) => m.authorRole === "product-owner");
    if (idx < 0) continue;
    const m = msgs[idx]!;
    const parsed = parseProposal(m.body);
    if (!parsed) continue;
    if (!m.actionState && msgs.slice(0, idx).some((x) => x.authorAgent === JORGE.agent)) continue;
    if (m.actionState && Date.parse(m.actionState.at) < since.getTime()) continue;
    if (!m.actionState && (await actionsFor(db, m, p.id)).length > 0) continue; // a message with buttons is its own row
    out.push({
      id: `m-${m.id}`,
      project: p.slug,
      title: parsed.title,
      kind: "proposal",
      options: parsed.options,
      actions: m.actionState ? [] : ["elegir", "responder"],
      state: stateOf(m.actionState),
      at: m.at.toISOString(),
      ref: null,
      detail: parsed.note,
      links: linksOf(m.links),
      body: m.body,
      checks: null,
      release: null,
    });
  }
  return out;
}

async function messageRows(db: Db, since: Date, slugById: Map<string, Project>, skip: Set<string>): Promise<Decision[]> {
  const out: Decision[] = [];
  const rows = await db
    .select({ m: threadMessages, projectId: threads.projectId })
    .from(threadMessages)
    .innerJoin(threads, eq(threads.id, threadMessages.threadId))
    .where(
      and(
        ne(threadMessages.authorAgent, JORGE.agent),
        isNull(threadMessages.questionId),
        sql`(${threadMessages.links} @> '[{"kind":"ticket"}]'::jsonb or ${threadMessages.links} @> '[{"kind":"idea"}]'::jsonb)`,
        or(isNull(threadMessages.actionState), sql`(${threadMessages.actionState}->>'at')::timestamptz >= ${since.toISOString()}::timestamptz`),
      ),
    )
    .orderBy(desc(threadMessages.at))
    .limit(200);
  for (const { m, projectId } of rows) {
    if (skip.has(m.id)) continue;
    const p = projectId ? slugById.get(projectId) : undefined;
    let actions: MessageAction[] = [];
    if (!m.actionState) {
      actions = await actionsFor(db, m, projectId ?? null);
      if (actions.length === 0) continue;
    } else if (!["aceptar", "cambios"].includes(m.actionState.action)) continue;
    const link = m.links.find((l) => l.kind === "ticket" || l.kind === "idea");
    const pr = m.actionState ? m.links.some((l) => l.kind === "pr") || !!m.actionState.result?.merged : actions.includes("fusionar");
    out.push({
      id: `m-${m.id}`,
      project: p?.slug ?? null,
      title: link?.title || firstLine(m.body),
      kind: pr ? "pr" : "deliverable",
      options: null,
      actions: actions as DecisionAction[],
      state: stateOf(m.actionState),
      at: m.at.toISOString(),
      ref: link?.ref ?? null,
      detail: firstLine(m.body, 200),
      links: linksOf(m.links),
      body: m.body,
      checks: await evidenceOf(db, link?.kind === "ticket" ? await ticketByKey(db, projectId, link.ref) : null, m.links.find((l) => l.kind === "pr")?.ref ?? null),
      release: null,
    });
  }
  return out;
}

async function ticketRows(db: Db, since: Date, slugById: Map<string, Project>): Promise<Decision[]> {
  const ceo = await ceoAgentId(db);
  if (!ceo) return [];
  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerAgent, ceo),
        eq(tasks.kind, "ticket"),
        or(eq(tasks.status, "Ready"), and(inArray(tasks.status, ["Done", "Backlog"]), gt(tasks.statusChangedAt, since))),
      ),
    );
  const out: Decision[] = [];
  for (const t of rows) {
    const p = slugById.get(t.projectId);
    if (!p) continue;
    const acted = t.status !== "Ready";
    out.push({
      id: `t-${t.id}`,
      project: p.slug,
      title: t.title,
      kind: "action",
      options: null,
      actions: acted ? [] : ["hecho", "aplazar"],
      state: acted ? { action: t.status === "Done" ? "hecho" : "aplazar", at: (t.statusChangedAt ?? t.updatedAt).toISOString(), result: { ticket: t.key, status: t.status } } : null,
      at: t.createdAt.toISOString(),
      ref: t.key,
      detail: t.summary ? firstLine(t.summary, 200) : t.scope ? firstLine(t.scope, 200) : null,
      ...NO_EVIDENCE,
      links: t.prUrl ? [{ kind: "pr", ref: t.prUrl, title: "PR" }] : [],
    });
  }
  return out;
}

async function questionRows(db: Db, since: Date, slugById: Map<string, Project>, companyPaused: boolean): Promise<Decision[]> {
  const rows = await db
    .select({ q: questions, key: tasks.key })
    .from(questions)
    .innerJoin(tasks, eq(tasks.id, questions.taskId))
    .where(or(isNull(questions.answeredAt), gt(questions.answeredAt, since)));
  const out: Decision[] = [];
  for (const { q, key } of rows) {
    const p = slugById.get(q.projectId);
    if (!p) continue;
    if (!q.answeredAt && (companyPaused || p.runsPaused) && !q.humanOnly) continue;
    out.push({
      id: `q-${q.id}`,
      project: p.slug,
      title: firstLine(q.question, 200),
      kind: "question",
      options: q.options.length ? q.options.map((label, i) => ({ n: i + 1, label, recommended: false })) : null,
      actions: q.answeredAt ? [] : q.options.length ? ["elegir", "responder"] : ["responder"],
      state: q.answeredAt ? { action: "responder", at: q.answeredAt.toISOString(), result: { answer: q.answer } } : null,
      at: q.askedAt.toISOString(),
      ref: key,
      detail: q.humanOnly ? "solo tú" : null,
      ...NO_EVIDENCE,
    });
  }
  return out;
}

// PLA-I36-2: Bandeja's pasos. A human_action of a ceo-owned Ready ticket is already that ticket's row.
async function pasoRows(db: Db, all: Project[], inbox: Map<string, InboxItem[]>, ceoTickets: Set<string>): Promise<Decision[]> {
  const out: Decision[] = [];
  for (const p of all) {
    for (const it of inbox.get(p.slug) ?? []) {
      if (it.kind === "human_action") {
        if (it.key && ceoTickets.has(`${p.slug}/${it.key}`)) continue;
        const t = await ticketByKey(db, p.id, it.key);
        out.push({
          id: `b-${it.id}`,
          project: p.slug,
          title: firstLine(it.why, 200),
          kind: "step",
          options: null,
          actions: ["hecho"],
          state: null,
          at: it.waiting_since,
          ref: it.key,
          detail: it.title ? `Lo espera: ${it.title}` : null,
          links: it.pr_url ? [{ kind: "pr", ref: it.pr_url, title: "PR" }] : [],
          body: null,
          checks: await evidenceOf(db, t, it.pr_url),
          release: null,
        });
      } else if (it.kind === "release") {
        const plan = it.target as unknown as ReleasePlan;
        const n = plan.tickets.length;
        out.push({
          id: `r-${p.slug}`,
          project: p.slug,
          title: `${n} ${n === 1 ? "cambio listo" : "cambios listos"} para publicar`,
          kind: "release",
          options: null,
          actions: [],
          state: null,
          at: it.waiting_since,
          ref: null,
          detail: plan.ahead === null ? "Sin datos de GitHub todavía" : null,
          links: plan.tickets.filter((t) => t.pr_url).map((t) => ({ kind: "pr" as const, ref: t.pr_url!, title: t.title })),
          body: null,
          checks: { open: plan.open_checks, ci: null },
          release: {
            from: plan.from.branch,
            into: plan.into.branch,
            env: plan.env,
            ahead: plan.ahead,
            tickets: plan.tickets.map((t) => ({ key: t.key, title: t.title })),
            open_checks: plan.open_checks,
            before: plan.before.length,
          },
        });
      }
    }
  }
  return out;
}

export async function inboxByProject(db: Db, all: Project[]): Promise<Map<string, InboxItem[]>> {
  const out = new Map<string, InboxItem[]>();
  for (const p of all) out.set(p.slug, await inboxFor(db, p));
  return out;
}

export async function decisionsRead(db: Db, now = new Date(), inboxed?: Map<string, InboxItem[]>): Promise<Decision[]> {
  const since = new Date(now.getTime() - KEEP_ACTED);
  const all = await db.select().from(projects);
  const byId = new Map(all.map((p) => [p.id, p]));
  const settings = await loadSettings(db);
  const inbox = inboxed ?? (await inboxByProject(db, all));
  const proposals = await proposalRows(db, since, byId);
  const skip = new Set(proposals.map((d) => d.id.slice(2)));
  const tickets = await ticketRows(db, since, byId);
  const ceoTickets = new Set(tickets.filter((d) => !d.state).map((d) => `${d.project}/${d.ref}`));
  const rows = [
    ...proposals,
    ...(await messageRows(db, since, byId, skip)),
    ...tickets,
    ...(await questionRows(db, since, byId, settings.companyPaused)),
    ...(await pasoRows(db, all, inbox, ceoTickets)),
  ];
  // What unblocks the team first (a proposal, a question, a delivery), then Jorge's own tickets; newest first.
  return rows.sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

// ---- acting

export type DecisionInput = { action: DecisionAction; option?: number | number[]; text?: string };
export type DecisionRefusal = { error: string; status: 400 | 404 | 409; hint: string; [k: string]: unknown };
export type DecisionDone = { ok: true; state: DecisionState; decision: Decision | null; created?: { kind: string; key: string } | null; wake?: string };

const refuse = (error: string, hint: string, status: 400 | 404 | 409 = 409, extra: Record<string, unknown> = {}): DecisionRefusal => ({ ...extra, error, status, hint });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function chosen(options: DecisionOption[], option: number | number[] | undefined): DecisionOption[] | DecisionRefusal {
  const ns = option == null ? [] : Array.isArray(option) ? option : [option];
  if (ns.length === 0) return refuse("OPTION_REQUIRED", "Elige una opción.", 400);
  const picked = [...new Set(ns)].sort((a, b) => a - b).map((n) => options.find((o) => o.n === n));
  if (picked.some((o) => !o)) return refuse("INVALID_OPTION", `Opciones: ${options.map((o) => o.n).join(", ")}.`, 400);
  return picked as DecisionOption[];
}

async function after(db: Db, id: string, state: DecisionState, extra: Partial<DecisionDone> = {}): Promise<DecisionDone> {
  const decision = (await decisionsRead(db)).find((d) => d.id === id) ?? null;
  return { ok: true, state, decision, ...extra };
}

async function actOnMessage(db: Db, id: string, msgId: string, input: DecisionInput): Promise<DecisionDone | DecisionRefusal> {
  const [m] = await db.select().from(threadMessages).where(eq(threadMessages.id, msgId)).limit(1);
  if (!m) return refuse("DECISION_NOT_FOUND", "Esa decisión ya no está.", 404);
  if (m.actionState) return refuse("ALREADY_ACTED", "Ya actuaste sobre esto.", 409, { state: stateOf(m.actionState) });
  const ref = await resolveThread(db, m.threadId);
  const proposal = m.authorRole === "product-owner" ? parseProposal(m.body) : null;

  if (proposal && (input.action === "elegir" || input.action === "responder")) {
    let body: string;
    let result: Record<string, unknown>;
    if (input.action === "elegir") {
      const picked = chosen(proposal.options, input.option);
      if (!Array.isArray(picked)) return picked;
      const ns = picked.map((o) => o.n).join(" + ");
      body = `Elijo ${ns}: ${picked.map((o) => o.label).join(" + ")}`;
      result = { option: picked.length === 1 ? picked[0]!.n : picked.map((o) => o.n), label: picked.map((o) => o.label).join(" + ") };
    } else {
      const text = input.text?.trim() ?? "";
      if (!text) return refuse("TEXT_REQUIRED", "Escribe tu respuesta.", 409);
      body = text;
      result = { text };
    }
    // Claim the message first: a second click finds action_state set and is refused.
    const at = new Date().toISOString();
    const claimed = await db
      .update(threadMessages)
      .set({ actionState: { action: input.action, at, result } as unknown as ActionState })
      .where(and(eq(threadMessages.id, m.id), isNull(threadMessages.actionState)))
      .returning({ id: threadMessages.id });
    if (claimed.length === 0) return refuse("ALREADY_ACTED", "Ya actuaste sobre esto.");
    try {
      const posted = await jorgePosts(db, ref, body);
      const full = { ...result, message_id: posted.message.id, ticket: posted.created?.key ?? null, wake: posted.wake };
      const state = { action: input.action, at, result: full };
      await db.update(threadMessages).set({ actionState: state as unknown as ActionState }).where(eq(threadMessages.id, m.id));
      return after(db, id, state, { created: posted.created, wake: posted.wake });
    } catch (e) {
      await db.update(threadMessages).set({ actionState: null }).where(eq(threadMessages.id, m.id));
      throw e;
    }
  }

  if (!["aceptar", "fusionar", "cambios", "responder"].includes(input.action)) return refuse("INVALID_ACTION", "Esa acción no aplica aquí.", 400);
  const out = await threadAction(db, ref, { message_id: m.id, action: input.action as "aceptar" | "fusionar" | "cambios" | "responder", text: input.text });
  if ("error" in out) return { ...out, status: out.status } as DecisionRefusal;
  return after(db, id, stateOf(out.action_state)!);
}

async function actOnTicket(db: Db, id: string, taskId: string, input: DecisionInput): Promise<DecisionDone | DecisionRefusal> {
  const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!t) return refuse("DECISION_NOT_FOUND", "Esa decisión ya no está.", 404);
  if (input.action !== "hecho" && input.action !== "aplazar") return refuse("INVALID_ACTION", "Aquí: Hecho o Aplazar.", 400);
  if (t.status !== "Ready") return refuse("ALREADY_ACTED", `${t.key} ya está en ${t.status}.`, 409, { ticket_status: t.status });
  const [p] = await db.select().from(projects).where(eq(projects.id, t.projectId)).limit(1);
  const status = input.action === "hecho" ? "Done" : "Backlog";
  const ctx = { ...webCtx, tool: `screen.decision_${input.action}` };
  try {
    // Hecho is Jorge's word that it is done: his own ticket's open checks are ticked with it.
    if (input.action === "hecho") {
      const open = await db.select({ n: checks.n }).from(checks).where(and(eq(checks.taskId, t.id), eq(checks.done, false), isNull(checks.waivedAt)));
      for (const c of open) await setCheck(db, { project: p!.slug, key: t.key, n: c.n, done: true } as never, ctx);
    }
    const [fresh] = await db.select({ version: tasks.version }).from(tasks).where(eq(tasks.id, t.id)).limit(1);
    await setTask(db, { project: p!.slug, key: t.key, status, version: fresh!.version, ...(input.action === "aplazar" ? { note: "Jorge lo aplazó desde Te toca." } : {}) } as never, ctx);
  } catch (e) {
    if (e instanceof ToolError) return refuse(e.code, "Plania no dejó moverlo.", 409, e.detail);
    throw e;
  }
  return after(db, id, { action: input.action, at: new Date().toISOString(), result: { ticket: t.key, status } });
}

async function actOnQuestion(db: Db, id: string, qid: string, input: DecisionInput): Promise<DecisionDone | DecisionRefusal> {
  const [q] = await db.select().from(questions).where(eq(questions.id, qid)).limit(1);
  if (!q) return refuse("DECISION_NOT_FOUND", "Esa decisión ya no está.", 404);
  if (q.answeredAt) return refuse("ALREADY_ACTED", "La pregunta ya tiene respuesta.", 409, { answer: q.answer });
  let text: string;
  if (input.action === "elegir") {
    const picked = chosen(
      q.options.map((label, i) => ({ n: i + 1, label, recommended: false })),
      input.option,
    );
    if (!Array.isArray(picked)) return picked;
    if (picked.length !== 1) return refuse("INVALID_OPTION", "Una sola opción.", 400);
    text = picked[0]!.label;
  } else if (input.action === "responder") {
    text = input.text?.trim() ?? "";
    if (!text) return refuse("TEXT_REQUIRED", "Escribe tu respuesta.");
  } else return refuse("INVALID_ACTION", "Aquí: Elegir o Responder.", 400);
  const [p] = await db.select().from(projects).where(eq(projects.id, q.projectId)).limit(1);
  try {
    await answer(db, { project: p!.slug, question_id: q.id, answer: text }, { ...webCtx, tool: "screen.decision_answer" });
  } catch (e) {
    if (e instanceof ToolError) return refuse(e.code, "Plania no aceptó la respuesta.", 409, e.detail);
    throw e;
  }
  return after(db, id, { action: input.action, at: new Date().toISOString(), result: { answer: text } });
}

// PLA-I36-2: a manual step, marked done as Bandeja does (the ticket may go back to Ready at once).
async function actOnStep(db: Db, id: string, blockerId: string, input: DecisionInput): Promise<DecisionDone | DecisionRefusal> {
  if (input.action !== "hecho") return refuse("INVALID_ACTION", "Aquí: Hecho.", 400);
  const [row] = await db.execute<{ project_id: string; satisfied_at: Date | null }>(sql`select t.project_id, b.satisfied_at from blockers b join tasks t on t.id = b.task_id where b.id = ${blockerId} and b.type = 'human_action'`).then((r) => r.rows);
  if (!row) return refuse("DECISION_NOT_FOUND", "Ese paso ya no está.", 404);
  if (row.satisfied_at) return refuse("ALREADY_ACTED", "Ese paso ya está hecho.");
  const [p] = await db.select().from(projects).where(eq(projects.id, row.project_id)).limit(1);
  const ctx = { ...webCtx, tool: "screen.decision_step" };
  try {
    await writeTx(db, p!, ctx, (tx, emit) => resolveHumanAction(tx, emit, p!.id, blockerId, webCtx.actor, input.text?.trim() || undefined));
  } catch (e) {
    if (e instanceof ToolError) return refuse(e.code, "Plania no dejó marcarlo.", 409, e.detail);
    throw e;
  }
  const state = { action: "hecho", at: new Date().toISOString(), result: {} };
  return { ok: true, state, decision: null };
}

export async function actOnDecision(db: Db, id: string, input: DecisionInput): Promise<DecisionDone | DecisionRefusal> {
  const m = /^([mtqb])-(.+)$/.exec(id);
  if (/^r-/.test(id)) return refuse("OWNER_CODE", "Publicar se hace en Bandeja, con tu código.", 409);
  if (!m || !UUID.test(m[2]!)) return refuse("DECISION_NOT_FOUND", "Esa decisión no existe.", 404);
  if (m[1] === "m") return actOnMessage(db, id, m[2]!, input);
  if (m[1] === "t") return actOnTicket(db, id, m[2]!, input);
  if (m[1] === "b") return actOnStep(db, id, m[2]!, input);
  return actOnQuestion(db, id, m[2]!, input);
}
