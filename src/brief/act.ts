// PLA-I49-3: acting on brief rows (POST /api/brief/act, /act/:id/undo) and their live state (GET /api/brief/:id/state).
// The registry (actions.ts) knows the actions; this file stores what happened (brief_actions), replays a retry with
// the same request_id, re-reads the target right before the write (a target that moved answers "stale", not an
// error), and leaves one brief.action event in the target's project, as the owner. Past days are read-only.
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { agentRuns, agents, briefActions, briefChecks, morningBriefs, projects, tasks, type BriefAction, type BriefActionOutcome, type MorningBrief } from "../db/schema.js";
import { webCtx, writeTx } from "../mcp/tx.js";
import { homeSlug } from "../runner/threads.js";
import { ACTION_IDS, ANY_ROW, actionsFor, handledLine, live, REGISTRY, ROW_ACTIONS, undoRun, wakeInfo, type ActionId, type Level, type Live, type WakeInfo } from "./actions.js";
import { localDateIn } from "./pipeline.js";
import { loadBriefSettings, resolveBriefSettings } from "./settings.js";
import { Target, type Item } from "./types.js";

export type RowState = "open" | "handled" | "later" | "dismissed" | "gone";
// wake: for a wake action, who wakes, about how long and whether runs are paused (the cost line before it runs).
export type RowAction = { id: ActionId; level: Level; undo: boolean; target: number | null; wake?: WakeInfo | null };
// live: the main target as it is now (the page's evidence); at and action: when and how the owner handled it here.
export type ItemState = { state: RowState; line: string | null; actions: RowAction[]; action_id: string | null; undo: boolean; until?: string | null; live?: Live | null; at?: string | null; action?: ActionId | null };
export type BriefStateReply = { brief_id: string; read_only: boolean; items: Record<string, ItemState> };

export type ActReply =
  | { status: "done"; action_id: string; line: string; undo: boolean; state: ItemState; replay?: boolean }
  | { status: "stale"; line: string | null; live: Live | null; state: ItemState }
  | { status: "running"; action_id: string; replay: true }
  | { status: "failed"; error: string; hint: string; action_id?: string; replay?: boolean };
export type ActError = { error: string; hint: string; http: 400 | 404 | 409 };

const itemsOf = (b: MorningBrief): Item[] => (Array.isArray(b.data.items) ? (b.data.items as Item[]) : []);
const targetsOf = (i: Item): Target[] => (Array.isArray(i.targets) ? i.targets.filter((t) => Target.safeParse(t).success) : []);

async function todayOf(db: Db, env: NodeJS.ProcessEnv): Promise<string> {
  const s = resolveBriefSettings(await loadBriefSettings(db), env);
  return localDateIn(new Date(), s.timezone);
}
const nextDay = (d: string): string => new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** True when this brief is not of the newest brief's date: past days show outcomes and no buttons. */
async function readOnly(db: Db, b: MorningBrief): Promise<boolean> {
  const [newest] = await db.select({ localDate: morningBriefs.localDate }).from(morningBriefs).orderBy(desc(morningBriefs.generatedAt)).limit(1);
  return !!newest && newest.localDate !== b.localDate;
}

/** The actions that decide a row's state: this brief's, plus Later and Not relevant from any brief (ids are stable). */
async function actionsByItem(db: Db, b: MorningBrief, ids: string[]): Promise<Map<string, BriefAction>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select()
    .from(briefActions)
    .where(and(inArray(briefActions.itemId, ids), isNull(briefActions.undoneAt), or(eq(briefActions.briefId, b.id), inArray(briefActions.action, ["later", "dismiss"]))))
    .orderBy(desc(briefActions.createdAt));
  const out = new Map<string, BriefAction>();
  for (const r of rows) if (!out.has(r.itemId) && r.outcome.status !== "failed") out.set(r.itemId, r);
  return out;
}

async function rowActions(db: Db, targets: Target[], lives: (Live | null)[], project: string | null): Promise<RowAction[]> {
  const out: RowAction[] = [];
  targets.forEach((t, n) => {
    for (const id of actionsFor(t, lives[n] ?? null)) if (!out.some((a) => a.id === id)) out.push({ id, level: REGISTRY[id].level, undo: REGISTRY[id].undo, target: n });
  });
  // Give to PO fits every open row; Later and Not relevant too.
  if (project) out.push({ id: "give_to_po", level: "wake", undo: false, target: null });
  for (const id of ["later", "dismiss"] as const) out.push({ id, level: REGISTRY[id].level, undo: true, target: null });
  for (const a of out) {
    if (a.level !== "wake") continue;
    const t = a.target === null ? null : (targets[a.target] ?? null);
    a.wake = await wakeInfo(db, a.id, t, a.target === null ? null : (lives[a.target] ?? null), t?.project ?? project ?? "");
  }
  return out;
}

/** The project a row belongs to: its main target's, else its app when that is a project, else the home project. */
async function rowProject(db: Db, t: Target | null, item: Item, env: NodeJS.ProcessEnv): Promise<string | null> {
  return (await eventProject(db, t, item, env))?.slug ?? null;
}

/** For a wake action already taken: where its run is now (queued, working, done, failed with its last line). */
async function followLine(db: Db, act: BriefAction, lang: string): Promise<string | null> {
  const r = act.outcome.result as { key?: string; ticket?: string; keys?: string[]; agent?: string } | undefined;
  const key = r?.key ?? r?.ticket ?? r?.keys?.[0];
  if (!key) return null;
  const [run] = await db
    .select({ status: agentRuns.status, summary: agentRuns.summary, agent: agents.slug })
    .from(agentRuns)
    .innerJoin(agents, eq(agents.id, agentRuns.agentId))
    .where(and(eq(agentRuns.taskKey, key), gte(agentRuns.queuedAt, new Date(act.createdAt.getTime() - 60_000))))
    .orderBy(desc(agentRuns.queuedAt))
    .limit(1);
  const es = lang === "es";
  if (!run) {
    const [t] = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.key, key)).limit(1);
    return t ? `${key}: ${t.status}` : null;
  }
  const word = { queued: es ? "en cola" : "queued", running: es ? "trabajando" : "working", ok: es ? "listo" : "done", fail: es ? "falló" : "failed", skipped: es ? "saltado" : "skipped", stopped: es ? "detenido" : "stopped" }[run.status] ?? run.status;
  const tail = run.status === "fail" || run.status === "ok" ? `: ${run.summary.slice(0, 120)}` : "";
  return `${run.agent} ${word}${tail}`;
}

async function stateOfItem(db: Db, b: MorningBrief, item: Item, act: BriefAction | undefined, checked: boolean, today: string, ro: boolean, lang: string, env: NodeJS.ProcessEnv = process.env): Promise<ItemState> {
  const base = {
    action_id: act?.id ?? null,
    undo: !!act && !ro && (REGISTRY[act.action as ActionId]?.undo ?? false) && act.outcome.status === "done",
    at: act?.createdAt.toISOString() ?? null,
    action: (act?.action as ActionId | undefined) ?? null,
  };
  if (act?.action === "dismiss") return { state: "dismissed", line: act.outcome.line ?? null, actions: [], ...base };
  if (act?.action === "later") {
    const until = (act.input as { until?: string }).until ?? null;
    if (!until || until > today) return { state: "later", line: act.outcome.line ?? null, actions: [], until, ...base };
  } else if (act && act.outcome.status === "done") {
    // A wake action's row follows its run: queued, working, done or failed.
    const follow = REGISTRY[act.action as ActionId]?.level === "wake" ? await followLine(db, act, lang) : null;
    return { state: "handled", line: [act.outcome.line, follow].filter(Boolean).join(" · ") || null, actions: [], ...base };
  }
  if (checked) return { state: "dismissed", line: lang === "es" ? "Marcado" : "Checked", actions: [], action_id: null, undo: false, at: null, action: null };
  const targets = targetsOf(item);
  const lives = await Promise.all(targets.map((t) => live(db, t)));
  const main = lives[0];
  const none = { action_id: null, undo: false, at: null, action: null, live: main ?? null };
  if (main?.kind === "gone") return { state: "gone", line: lang === "es" ? "Ya no está en Plania" : "No longer in Plania", actions: [], ...none };
  const handled = main ? handledLine(main, { itemStatus: item.status, briefAt: b.generatedAt, lang }) : null;
  if (handled) return { state: "handled", line: handled, actions: [], ...none };
  return { state: "open", line: null, actions: ro ? [] : await rowActions(db, targets, lives, await rowProject(db, targets[0] ?? null, item, env)), ...none };
}

/** GET /api/brief/:id/state: every item's state read from Plania now. null when the brief does not exist. */
export async function briefState(db: Db, briefId: string, env: NodeJS.ProcessEnv = process.env): Promise<BriefStateReply | null> {
  const [b] = await db.select().from(morningBriefs).where(eq(morningBriefs.id, briefId)).limit(1);
  if (!b) return null;
  const items = itemsOf(b).filter((i) => typeof i.id === "string");
  const ids = items.map((i) => i.id);
  const acts = await actionsByItem(db, b, ids);
  const checked = new Set(ids.length ? (await db.select({ id: briefChecks.itemId }).from(briefChecks).where(inArray(briefChecks.itemId, ids))).map((r) => r.id) : []);
  const ro = await readOnly(db, b);
  const today = await todayOf(db, env);
  const lang = String(b.data.language ?? "en");
  const out: Record<string, ItemState> = {};
  for (const i of items) out[i.id] = await stateOfItem(db, b, i, acts.get(i.id), checked.has(i.id), today, ro, lang, env);
  return { brief_id: b.id, read_only: ro, items: out };
}

// ---- Act

export const ActBody = z
  .object({
    brief_id: z.string().uuid(),
    item_id: z.string().min(1).max(200),
    action: z.enum(ACTION_IDS),
    // The index of one of the item's targets (default its main one, 0), or the target itself.
    target: z.union([z.number().int().min(0).max(3), Target]).optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    request_id: z.string().min(8).max(120),
  })
  .strict();
export type ActBody = z.infer<typeof ActBody>;

const same = (a: Target, b: Target) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
// Refusals that mean "someone already did it": the row is refreshed as stale, not shown as a failure.
const STALE_CODES = new Set(["ALREADY_ANSWERED", "ALREADY_ACTED", "NOT_IN_REVIEW", "NOT_READY", "TICKET_CLOSED", "FINDING_NOT_FOUND", "QUESTION_NOT_FOUND", "BLOCKER_NOT_FOUND", "DECISION_NOT_FOUND", "STALE", "PR_NOT_OPEN"]);

/** The project an event goes to: the target's, else the item's app, else the home project. */
async function eventProject(db: Db, t: Target | null, item: Item, env: NodeJS.ProcessEnv) {
  for (const slug of [t?.project, item.app, homeSlug(env)]) {
    if (!slug) continue;
    const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (p) return p;
  }
  return null;
}

async function emitAction(db: Db, row: BriefAction, item: Item, t: Target | null, outcome: BriefActionOutcome, env: NodeJS.ProcessEnv, undone = false) {
  const p = await eventProject(db, t, item, env);
  if (!p) return;
  const [task] = t?.key ? await db.select({ id: tasks.id, key: tasks.key }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, t.key))).limit(1) : [];
  await writeTx(db, p, { ...webCtx, tool: "screen.brief_act" }, async (_tx, emit) => {
    await emit("brief.action", task ?? null, { brief_id: row.briefId, item_id: row.itemId, action: row.action, action_id: row.id, target: t, status: outcome.status, line: outcome.line ?? null, ...(undone ? { undone: true } : {}) });
  });
}

function replayOf(row: BriefAction, state?: ItemState): ActReply {
  const o = row.outcome;
  if (o.status === "running") return { status: "running", action_id: row.id, replay: true };
  if (o.status === "failed") return { status: "failed", error: o.error ?? "FAILED", hint: o.hint ?? "", action_id: row.id, replay: true };
  return { status: "done", action_id: row.id, line: o.line ?? "", undo: (REGISTRY[row.action as ActionId]?.undo ?? false) && !row.undoneAt, state: state ?? { state: "handled", line: o.line ?? null, actions: [], action_id: row.id, undo: false }, replay: true };
}

export async function act(db: Db, body: ActBody, env: NodeJS.ProcessEnv = process.env): Promise<ActReply | ActError> {
  // A retry (or a second tab, or a double click) with the same request_id gets the first answer.
  const [prior] = await db.select().from(briefActions).where(eq(briefActions.requestId, body.request_id)).limit(1);
  if (prior) return replayOf(prior);

  const [b] = await db.select().from(morningBriefs).where(eq(morningBriefs.id, body.brief_id)).limit(1);
  if (!b) return { error: "BRIEF_NOT_FOUND", hint: "That brief does not exist.", http: 404 };
  if (await readOnly(db, b)) return { error: "READ_ONLY", hint: "A past day's brief shows what happened; act on today's.", http: 409 };
  const item = itemsOf(b).find((i) => i.id === body.item_id);
  if (!item) return { error: "ITEM_NOT_FOUND", hint: "That row is not in this brief.", http: 404 };
  const def = REGISTRY[body.action];
  const targets = targetsOf(item);
  let t: Target | null;
  if (typeof body.target === "number") t = targets[body.target] ?? null;
  else if (body.target) t = targets.find((x) => same(x, body.target as Target)) ?? null;
  else t = targets[0] ?? null;
  if (body.target !== undefined && !t) return { error: "TARGET_NOT_IN_ROW", hint: "That object is not one this row is about.", http: 400 };
  if (!t && !ANY_ROW.has(body.action)) return { error: "NO_TARGET", hint: "This row is about nothing Plania can act on.", http: 409 };
  const parsed = def.input.safeParse(body.input ?? {});
  if (!parsed.success) return { error: "INVALID_INPUT", hint: parsed.error.issues.map((i) => i.message).join("; "), http: 400 };
  const input = { ...parsed.data };
  if (body.action === "later" && !input.until) input.until = nextDay(await todayOf(db, env));

  const lang = String(b.data.language ?? "en");
  const refresh = async () => {
    const acts = await actionsByItem(db, b, [item.id]);
    const [chk] = await db.select().from(briefChecks).where(eq(briefChecks.itemId, item.id)).limit(1);
    return stateOfItem(db, b, item, acts.get(item.id), !!chk, await todayOf(db, env), false, lang, env);
  };

  // Re-check against Plania now: a target that moved meanwhile is "stale", with what it is now.
  const l = t ? await live(db, t) : null;
  if (!ANY_ROW.has(body.action) && !def.applies(t, l)) return { status: "stale", line: l ? handledLine(l, { itemStatus: item.status, briefAt: b.generatedAt, lang }) : null, live: l, state: await refresh() };

  // Claim the request first: of two concurrent calls with the same request_id, one inserts and the other replays.
  const [row] = await db
    .insert(briefActions)
    .values({ briefId: b.id, itemId: item.id, action: body.action, target: t as Record<string, unknown> | null, input, requestId: body.request_id, outcome: { status: "running" } })
    .onConflictDoNothing({ target: briefActions.requestId })
    .returning();
  if (!row) {
    const [other] = await db.select().from(briefActions).where(eq(briefActions.requestId, body.request_id)).limit(1);
    return replayOf(other!);
  }

  let outcome: BriefActionOutcome;
  try {
    const project = (await rowProject(db, t, item, env)) ?? "";
    const out = await def.run(db, t as Target, l as Live, input, lang === "es" ? "es" : "en", { title: item.title, detail: item.detail ?? null, ref: item.ref ?? null, project });
    outcome = "error" in out ? { status: "failed", error: out.error, hint: out.hint } : { status: "done", line: out.line, ...(out.result ? { result: out.result } : {}), ...(out.undo ? { undo: out.undo } : {}) };
  } catch (e) {
    outcome = { status: "failed", error: "ACTION_FAILED", hint: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300) };
  }
  await db.update(briefActions).set({ outcome }).where(eq(briefActions.id, row.id));
  await emitAction(db, row, item, t, outcome, env);

  if (outcome.status === "failed") {
    if (STALE_CODES.has(outcome.error ?? "")) {
      const now = t ? await live(db, t) : null;
      return { status: "stale", line: now ? handledLine(now, { itemStatus: item.status, briefAt: b.generatedAt, lang }) : null, live: now, state: await refresh() };
    }
    return { status: "failed", error: outcome.error ?? "FAILED", hint: outcome.hint ?? "", action_id: row.id };
  }
  return { status: "done", action_id: row.id, line: outcome.line ?? "", undo: def.undo, state: await refresh() };
}

/** POST /api/brief/act/:id/undo: an instant action put back; the row is open again. */
export async function undo(db: Db, actionId: string, env: NodeJS.ProcessEnv = process.env): Promise<{ status: "undone"; line: string; state: ItemState } | ActError> {
  if (!z.string().uuid().safeParse(actionId).success) return { error: "ACTION_NOT_FOUND", hint: "No such action.", http: 404 };
  const [row] = await db.select().from(briefActions).where(eq(briefActions.id, actionId)).limit(1);
  if (!row) return { error: "ACTION_NOT_FOUND", hint: "No such action.", http: 404 };
  if (row.undoneAt) return { error: "ALREADY_UNDONE", hint: "That was already undone.", http: 409 };
  const def = REGISTRY[row.action as ActionId];
  if (!def?.undo || row.outcome.status !== "done") return { error: "NOT_UNDOABLE", hint: "This action cannot be undone.", http: 409 };
  const [b] = await db.select().from(morningBriefs).where(eq(morningBriefs.id, row.briefId)).limit(1);
  if (!b) return { error: "BRIEF_NOT_FOUND", hint: "That brief does not exist.", http: 404 };
  if (await readOnly(db, b)) return { error: "READ_ONLY", hint: "A past day's brief is read-only.", http: 409 };
  const t = row.target ? (Target.safeParse(row.target).data ?? null) : null;
  const lang = String(b.data.language ?? "en");
  const out = await undoRun(db, row.action as ActionId, t, row.outcome.undo, lang === "es" ? "es" : "en");
  if ("error" in out) return { error: out.error, hint: out.hint, http: 409 };
  // Only one undo wins.
  const done = await db.update(briefActions).set({ undoneAt: sql`now()` }).where(and(eq(briefActions.id, row.id), isNull(briefActions.undoneAt))).returning({ id: briefActions.id });
  if (!done.length) return { error: "ALREADY_UNDONE", hint: "That was already undone.", http: 409 };
  const item = itemsOf(b).find((i) => i.id === row.itemId) ?? ({ id: row.itemId, app: "cross", status: "next", title: "" } as Item);
  await emitAction(db, row, item, t, { status: "done", line: out.line }, env, true);
  const acts = await actionsByItem(db, b, [item.id]);
  const [chk] = await db.select().from(briefChecks).where(eq(briefChecks.itemId, item.id)).limit(1);
  return { status: "undone", line: out.line, state: await stateOfItem(db, b, item, acts.get(item.id), !!chk, await todayOf(db, env), false, lang, env) };
}

/** For the pipeline: rows the owner set aside. Not relevant stays out; Later stays out until its date. */
export async function setAsideItems(db: Db, today: string): Promise<Set<string>> {
  const rows = await db
    .select({ itemId: briefActions.itemId, action: briefActions.action, input: briefActions.input })
    .from(briefActions)
    .where(and(isNull(briefActions.undoneAt), inArray(briefActions.action, ["later", "dismiss"]), sql`${briefActions.outcome}->>'status' = 'done'`));
  const out = new Set<string>();
  for (const r of rows) {
    if (r.action === "dismiss") out.add(r.itemId);
    else {
      const until = (r.input as { until?: string }).until;
      if (!until || until > today) out.add(r.itemId);
    }
  }
  return out;
}
