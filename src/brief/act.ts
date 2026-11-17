// PLA-I49-3: acting on brief rows (POST /api/brief/act, /act/:id/undo) and their live state (GET /api/brief/:id/state).
// The registry (actions.ts) knows the actions; this file stores what happened (brief_actions), replays a retry with
// the same request_id, re-reads the target right before the write (a target that moved answers "stale", not an
// error), and leaves one brief.action event in the target's project, as the owner. Past days are read-only.
import { z } from "zod";
import type { Db } from "../db/client.js";
import type { BriefAction, BriefActionOutcome, MorningBrief } from "../db/schema.js";
import { webCtx, writeTx } from "../mcp/tx.js";
import { setTask } from "../mcp/writes.js";
import { writeVia } from "../runner/limits.js";
import { homeSlug } from "../runner/threads.js";
import { readerOf } from "../store/port.js";
import { gte } from "../store/types.js";
import { ACTION_IDS, ANY_ROW, actionsFor, handledLine, live, REGISTRY, ROW_ACTIONS, undoRun, wakeInfo, type ActionId, type Level, type Live, type WakeInfo } from "./actions.js";
import { localDateIn } from "./pipeline.js";
import { actionDone, IDEA_ACTIONS, IDEA_INPUT, ideaProject, ideaRecord, ideasInMotion, isIdeaId, runIdea, type IdeaAction, type IdeaInMotion } from "./ideas.js";
import { loadBriefSettings, resolveBriefSettings } from "./settings.js";
import { Target, type Idea as IdeaRow, type Item } from "./types.js";

export type RowState = "open" | "handled" | "later" | "dismissed" | "gone";
// wake: for a wake action, who wakes, about how long and whether runs are paused (the cost line before it runs).
export type RowAction = { id: ActionId; level: Level; undo: boolean; target: number | null; wake?: WakeInfo | null };
// live: the main target as it is now (the page's evidence); at and action: when and how the owner handled it here.
export type ItemState = { state: RowState; line: string | null; actions: RowAction[]; action_id: string | null; undo: boolean; until?: string | null; live?: Live | null; at?: string | null; action?: ActionId | null };
// PLA-I49-6: an idea card's fate and the Plania idea it became.
export type IdeaFate = "open" | "kept" | "discarded" | "research" | "sketch" | "planned";
export type IdeaCardState = { state: IdeaFate; line: string | null; key: string | null; action_id: string | null; undo: boolean; at: string | null; project: string; paused: boolean };
export type BriefStateReply = { brief_id: string; read_only: boolean; items: Record<string, ItemState>; ideas: Record<string, IdeaCardState>; in_motion: IdeaInMotion[] };

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
  const [newest] = await readerOf(db).find("morningBriefs", {}, { orderBy: [{ column: "generatedAt", desc: true }], limit: 1 });
  return !!newest && newest.localDate !== b.localDate;
}

/** The newest-first actions on these items that are not undone. */
const liveActions = (db: Db, where: { itemId: string | string[] }) => readerOf(db).find("briefActions", { ...where, undoneAt: null }, { orderBy: [{ column: "createdAt", desc: true }] });
const actionByRequest = (db: Db, requestId: string) => readerOf(db).get("briefActions", { requestId });
const briefById = (db: Db, id: string) => readerOf(db).get("morningBriefs", { id });
const isChecked = async (db: Db, itemId: string) => !!(await readerOf(db).get("briefChecks", { itemId }));

/** The actions that decide a row's state: this brief's, plus Later and Not relevant from any brief (ids are stable). */
async function actionsByItem(db: Db, b: MorningBrief, ids: string[]): Promise<Map<string, BriefAction>> {
  if (!ids.length) return new Map();
  const rows = (await liveActions(db, { itemId: ids })).filter((a) => a.briefId === b.id || a.action === "later" || a.action === "dismiss");
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
  const reader = readerOf(db);
  // The newest run for that key whose agent still exists (the inner join to agents).
  const runs = await reader.find("agentRuns", { taskKey: key, queuedAt: gte(new Date(act.createdAt.getTime() - 60_000)) }, { orderBy: [{ column: "queuedAt", desc: true }] });
  let run: { status: string; summary: string; agent: string } | null = null;
  for (const x of runs) {
    const a = await reader.get("agents", { id: x.agentId });
    if (a) {
      run = { status: x.status, summary: x.summary, agent: a.slug };
      break;
    }
  }
  const es = lang === "es";
  if (!run) {
    const t = await reader.get("tasks", { key });
    return t ? `${key}: ${t.status}` : null;
  }
  const word = ({ queued: es ? "en cola" : "queued", running: es ? "trabajando" : "working", ok: es ? "listo" : "done", fail: es ? "falló" : "failed", skipped: es ? "saltado" : "skipped", stopped: es ? "detenido" : "stopped" } as Record<string, string>)[run.status] ?? run.status;
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
  const b = await briefById(db, briefId);
  if (!b) return null;
  const items = itemsOf(b).filter((i) => typeof i.id === "string");
  const ids = items.map((i) => i.id);
  const acts = await actionsByItem(db, b, ids);
  const checked = new Set(ids.length ? (await readerOf(db).find("briefChecks", { itemId: ids })).map((r) => r.itemId) : []);
  const ro = await readOnly(db, b);
  const today = await todayOf(db, env);
  const lang = String(b.data.language ?? "en");
  const out: Record<string, ItemState> = {};
  for (const i of items) out[i.id] = await stateOfItem(db, b, i, acts.get(i.id), checked.has(i.id), today, ro, lang, env);
  const ideas: Record<string, IdeaCardState> = {};
  for (const idea of ideasOf(b)) ideas[idea.id] = await ideaCardState(db, b, idea, ro, env);
  const slugs = [...new Set((Array.isArray(b.data.apps) ? (b.data.apps as { id: string }[]) : []).map((a) => (a.id === "cross" ? homeSlug(env) : a.id)))];
  // Ideas in motion: Open Plania ideas of the brief's projects, except the ones this brief's cards already show.
  const shown = new Set(Object.values(ideas).map((x) => x.key).filter(Boolean));
  const in_motion = (await ideasInMotion(db, slugs)).filter((m) => !shown.has(m.key));
  return { brief_id: b.id, read_only: ro, items: out, ideas, in_motion };
}

const ideasOf = (b: MorningBrief): IdeaRow[] => (Array.isArray(b.data.ideas) ? (b.data.ideas as IdeaRow[]).filter((i) => typeof i?.id === "string") : []);
const FATE: Record<IdeaAction, IdeaFate> = { keep: "kept", discard: "discarded", research: "research", sketch: "sketch", plan: "planned" };

async function ideaCardState(db: Db, b: MorningBrief, idea: IdeaRow, ro: boolean, env: NodeJS.ProcessEnv): Promise<IdeaCardState> {
  const [act] = (await liveActions(db, { itemId: idea.id })).filter(actionDone);
  const project = ideaProject(idea, env);
  const pr = await readerOf(db).get("projects", { slug: project });
  const paused = !!pr?.runsPaused;
  if (!act) return { state: "open", line: null, key: null, action_id: null, undo: false, at: null, project, paused };
  const r = (act.outcome.result ?? {}) as { key?: string | null };
  const record = r.key ? await ideaRecord(db, idea, env) : null;
  const where = record ? ` · ${record.key}${record.stage ? ` · ${record.stage}` : ""}${record.status !== "Open" ? ` · ${record.status}` : ""}` : "";
  return {
    state: FATE[act.action as IdeaAction] ?? "kept",
    line: `${act.outcome.line ?? ""}${where}`,
    key: r.key ?? null,
    action_id: act.id,
    undo: !ro && (act.action === "keep" || act.action === "discard"),
    at: act.createdAt.toISOString(),
    project,
    paused,
  };
}

async function actOnIdea(db: Db, b: MorningBrief, body: ActBody, env: NodeJS.ProcessEnv): Promise<ActReply | ActError> {
  const idea = ideasOf(b).find((i) => i.id === body.item_id);
  if (!idea) return { error: "ITEM_NOT_FOUND", hint: "That idea is not in this brief.", http: 404 };
  if (!(IDEA_ACTIONS as readonly string[]).includes(body.action)) return { error: "INVALID_ACTION", hint: "Ideas take keep, discard, research, sketch or plan.", http: 400 };
  const action = body.action as IdeaAction;
  const parsed = IDEA_INPUT[action].safeParse(body.input ?? {});
  if (!parsed.success) return { error: "INVALID_INPUT", hint: parsed.error.issues.map((i) => i.message).join("; "), http: 400 };
  const lang = String(b.data.language ?? "en");
  const ro = false;
  const now = await ideaCardState(db, b, idea, ro, env);
  // A card already decided is stale; keep on a kept idea is a no-op answered as stale too.
  if (now.state !== "open" && !(now.state === "kept" && action !== "keep")) return { status: "stale", line: now.line, live: null, state: ideaAsItemState(now) };
  const row = await claimRequest(db, { briefId: b.id, itemId: idea.id, action, target: null, input: parsed.data, requestId: body.request_id });
  if (!row) return replayOf((await actionByRequest(db, body.request_id))!);
  let outcome: BriefActionOutcome;
  try {
    const out = await runIdea(db, b, idea, action, parsed.data, lang, env);
    outcome = "error" in out ? { status: "failed", error: out.error, hint: out.hint } : { status: "done", line: out.line, result: out.result };
  } catch (e) {
    outcome = { status: "failed", error: "ACTION_FAILED", hint: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300) };
  }
  await setOutcome(db, row.id, outcome);
  const asItem = { id: idea.id, app: idea.app, status: "next", title: idea.title } as Item;
  const key = (outcome.result as { key?: string } | undefined)?.key;
  await emitAction(db, row, asItem, { kind: "idea", project: ideaProject(idea, env), ...(key ? { key } : {}) }, outcome, env);
  if (outcome.status === "failed") return { status: "failed", error: outcome.error ?? "FAILED", hint: outcome.hint ?? "", action_id: row.id };
  const st = await ideaCardState(db, b, idea, false, env);
  return { status: "done", action_id: row.id, line: outcome.line ?? "", undo: action === "keep" || action === "discard", state: ideaAsItemState(st) };
}

const ideaAsItemState = (s: IdeaCardState): ItemState => ({ state: s.state === "open" ? "open" : "handled", line: s.line, actions: [], action_id: s.action_id, undo: s.undo, at: s.at, action: null });

/**
 * Claims a request id: inserts the action as running, or returns null when that request id is already stored (the
 * caller replays it). Read and insert are one serialized write, so of two concurrent calls one inserts.
 */
async function claimRequest(db: Db, row: Pick<BriefAction, "briefId" | "itemId" | "action" | "target" | "input" | "requestId">): Promise<BriefAction | null> {
  return writeVia(db, async (uow) => ((await uow.get("briefActions", { requestId: row.requestId })) ? null : uow.insert("briefActions", { ...row, outcome: { status: "running" } })));
}

const setOutcome = (db: Db, id: string, outcome: BriefActionOutcome) => writeVia(db, (uow) => uow.update("briefActions", { id }, { outcome }));

/** Marks an action undone unless it already is. False when another undo got there first. */
const markUndone = (db: Db, id: string) => writeVia(db, async (uow) => (await uow.update("briefActions", { id, undoneAt: null }, { undoneAt: uow.now })).length > 0);

/** Undo Keep (the idea it made closes, Won't do) or Discard (a record it closed opens again). */
async function undoIdea(db: Db, row: BriefAction, b: MorningBrief, env: NodeJS.ProcessEnv): Promise<{ status: "undone"; line: string; state: ItemState } | ActError> {
  const r = (row.outcome.result ?? {}) as { key?: string | null; project?: string; created?: boolean };
  const lang = String(b.data.language ?? "en");
  const es = lang === "es";
  const idea = ideasOf(b).find((i) => i.id === row.itemId);
  const project = r.project ?? (idea ? ideaProject(idea, env) : null);
  if (r.key && project) {
    const t = await readerOf(db).get("tasks", { key: r.key });
    const tool = { ...webCtx, tool: "screen.brief_undo_idea" };
    if (row.action === "keep" && r.created && t?.status === "Open") await setTask(db, { project, key: r.key, status: "Won't do", version: t.version, reason: "Deshecho desde el brief." } as never, tool);
    if (row.action === "discard" && t?.status === "Won't do") await setTask(db, { project, key: r.key, status: "Open", version: t.version, reason: "Descarte deshecho desde el brief." } as never, tool);
  }
  if (!(await markUndone(db, row.id))) return { error: "ALREADY_UNDONE", hint: "That was already undone.", http: 409 };
  const line = es ? "Deshecho" : "Undone";
  const st = idea ? await ideaCardState(db, b, idea, false, env) : null;
  return { status: "undone", line, state: st ? ideaAsItemState(st) : { state: "open", line: null, actions: [], action_id: null, undo: false } };
}

// ---- Act

export const ActBody = z
  .object({
    brief_id: z.string().uuid(),
    item_id: z.string().min(1).max(200),
    action: z.enum([...ACTION_IDS, ...IDEA_ACTIONS]),
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
    const p = await readerOf(db).get("projects", { slug });
    if (p) return p;
  }
  return null;
}

async function emitAction(db: Db, row: BriefAction, item: Item, t: Target | null, outcome: BriefActionOutcome, env: NodeJS.ProcessEnv, undone = false) {
  const p = await eventProject(db, t, item, env);
  if (!p) return;
  const found = t?.key ? await readerOf(db).get("tasks", { projectId: p.id, key: t.key }) : undefined;
  const task = found ? { id: found.id, key: found.key } : undefined;
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
  const prior = await actionByRequest(db, body.request_id);
  if (prior) return replayOf(prior);

  const b = await briefById(db, body.brief_id);
  if (!b) return { error: "BRIEF_NOT_FOUND", hint: "That brief does not exist.", http: 404 };
  if (await readOnly(db, b)) return { error: "READ_ONLY", hint: "A past day's brief shows what happened; act on today's.", http: 409 };
  if (isIdeaId(body.item_id)) return actOnIdea(db, b, body, env);
  const item = itemsOf(b).find((i) => i.id === body.item_id);
  if (!item) return { error: "ITEM_NOT_FOUND", hint: "That row is not in this brief.", http: 404 };
  if (!(ACTION_IDS as readonly string[]).includes(body.action)) return { error: "INVALID_ACTION", hint: "That action is for ideas.", http: 400 };
  const actionId = body.action as ActionId;
  const def = REGISTRY[actionId];
  const targets = targetsOf(item);
  let t: Target | null;
  if (typeof body.target === "number") t = targets[body.target] ?? null;
  else if (body.target) t = targets.find((x) => same(x, body.target as Target)) ?? null;
  else t = targets[0] ?? null;
  if (body.target !== undefined && !t) return { error: "TARGET_NOT_IN_ROW", hint: "That object is not one this row is about.", http: 400 };
  if (!t && !ANY_ROW.has(actionId)) return { error: "NO_TARGET", hint: "This row is about nothing Plania can act on.", http: 409 };
  const parsed = def.input.safeParse(body.input ?? {});
  if (!parsed.success) return { error: "INVALID_INPUT", hint: parsed.error.issues.map((i) => i.message).join("; "), http: 400 };
  const input = { ...parsed.data };
  if (body.action === "later" && !input.until) input.until = nextDay(await todayOf(db, env));

  const lang = String(b.data.language ?? "en");
  const refresh = async () => {
    const acts = await actionsByItem(db, b, [item.id]);
    return stateOfItem(db, b, item, acts.get(item.id), await isChecked(db, item.id), await todayOf(db, env), false, lang, env);
  };

  // Re-check against Plania now: a target that moved meanwhile is "stale", with what it is now.
  const l = t ? await live(db, t) : null;
  if (!ANY_ROW.has(actionId) && !def.applies(t, l)) return { status: "stale", line: l ? handledLine(l, { itemStatus: item.status, briefAt: b.generatedAt, lang }) : null, live: l, state: await refresh() };

  // Claim the request first: of two concurrent calls with the same request_id, one inserts and the other replays.
  const row = await claimRequest(db, { briefId: b.id, itemId: item.id, action: body.action, target: t as Record<string, unknown> | null, input, requestId: body.request_id });
  if (!row) return replayOf((await actionByRequest(db, body.request_id))!);

  let outcome: BriefActionOutcome;
  try {
    const project = (await rowProject(db, t, item, env)) ?? "";
    const out = await def.run(db, t as Target, l as Live, input, lang === "es" ? "es" : "en", { title: item.title, detail: item.detail ?? null, ref: item.ref ?? null, project });
    outcome = "error" in out ? { status: "failed", error: out.error, hint: out.hint } : { status: "done", line: out.line, ...(out.result ? { result: out.result } : {}), ...(out.undo ? { undo: out.undo } : {}) };
  } catch (e) {
    outcome = { status: "failed", error: "ACTION_FAILED", hint: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300) };
  }
  await setOutcome(db, row.id, outcome);
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
  const row = await readerOf(db).get("briefActions", { id: actionId });
  if (!row) return { error: "ACTION_NOT_FOUND", hint: "No such action.", http: 404 };
  if (row.undoneAt) return { error: "ALREADY_UNDONE", hint: "That was already undone.", http: 409 };
  if (isIdeaId(row.itemId)) {
    if (!["keep", "discard"].includes(row.action) || row.outcome.status !== "done") return { error: "NOT_UNDOABLE", hint: "This action cannot be undone.", http: 409 };
    const ib = await briefById(db, row.briefId);
    if (!ib) return { error: "BRIEF_NOT_FOUND", hint: "That brief does not exist.", http: 404 };
    if (await readOnly(db, ib)) return { error: "READ_ONLY", hint: "A past day's brief is read-only.", http: 409 };
    return undoIdea(db, row, ib, env);
  }
  const def = REGISTRY[row.action as ActionId];
  if (!def?.undo || row.outcome.status !== "done") return { error: "NOT_UNDOABLE", hint: "This action cannot be undone.", http: 409 };
  const b = await briefById(db, row.briefId);
  if (!b) return { error: "BRIEF_NOT_FOUND", hint: "That brief does not exist.", http: 404 };
  if (await readOnly(db, b)) return { error: "READ_ONLY", hint: "A past day's brief is read-only.", http: 409 };
  const t = row.target ? (Target.safeParse(row.target).data ?? null) : null;
  const lang = String(b.data.language ?? "en");
  const out = await undoRun(db, row.action as ActionId, t, row.outcome.undo, lang === "es" ? "es" : "en");
  if ("error" in out) return { error: out.error, hint: out.hint, http: 409 };
  // Only one undo wins.
  if (!(await markUndone(db, row.id))) return { error: "ALREADY_UNDONE", hint: "That was already undone.", http: 409 };
  const item = itemsOf(b).find((i) => i.id === row.itemId) ?? ({ id: row.itemId, app: "cross", status: "next", title: "" } as Item);
  await emitAction(db, row, item, t, { status: "done", line: out.line }, env, true);
  const acts = await actionsByItem(db, b, [item.id]);
  return { status: "undone", line: out.line, state: await stateOfItem(db, b, item, acts.get(item.id), await isChecked(db, item.id), await todayOf(db, env), false, lang, env) };
}

/** For the pipeline: rows the owner set aside. Not relevant stays out; Later stays out until its date. */
export async function setAsideItems(db: Db, today: string): Promise<Set<string>> {
  const rows = (await readerOf(db).find("briefActions", { undoneAt: null, action: ["later", "dismiss"] })).filter(actionDone);
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
