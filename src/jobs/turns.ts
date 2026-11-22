// PLA-I74-5: the watchdog. Every minute it reads every open step's turn (src/state/turn.ts). A step whose turn has been
// nobody's for over two minutes gets one heal (src/runner/heal.ts): wake the agent the transitions table names, after
// releasing a hold an ended run left. Each heal is logged as turn.healed with its reason, and feeds the run report;
// the bar is zero. A step still nobody's two minutes after its heal raises one owner card: a question only he answers.
// One heal and one card per step within HEAL_WINDOW, so a step that keeps falling back never loops.
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agents, events, projects, tasks, type Project } from "../db/schema.js";
import { projectEtapas } from "../api/etapa.js";
import { ask } from "../mcp/questions.js";
import { SYSTEM_ACTOR } from "../mcp/tx.js";
import { ToolError } from "../mcp/errors.js";
import { eventWakesEnabled } from "../runner/events.js";
import { healStep } from "../runner/heal.js";
import { loadSettings } from "../runner/limits.js";
import type { Nobody } from "../state/turn.js";
import { defineWords, say } from "../words.js";
import type { Job } from "./index.js";

export const NOBODY_GRACE_MS = 2 * 60_000;
export const HEAL_WINDOW_MS = 30 * 60_000;

export const TURN_WORDS = defineWords({
  es: {
    card: (title: string, who: string | null, why: string) =>
      `Nadie mueve «${title}»: ${why}. Plania ${who ? `despertó a ${who}` : "lo intentó"} y el paso sigue quieto. Dile al equipo qué hacer, o muévelo tú.`,
    why: {
      not_woken: "estaba listo y nadie lo tomó",
      held_by_ended_run: "lo retenía un trabajo que ya terminó",
      lease_lapsed: "quien lo tenía lo soltó sin terminar",
      sent_back: "lo devolviste y nadie lo retomó",
      ci_red: "las pruebas fallan y nadie las arregla",
      overdue: "espera algo de fuera que no llega",
    } as Record<string, string>,
  },
  en: {
    card: (title: string, who: string | null, why: string) =>
      `“${title}” has nobody moving it: ${why}. Plania ${who ? `woke ${who}` : "tried"} and it is still stuck. Tell the team what to do, or move it yourself.`,
    why: {
      not_woken: "it was ready and nobody took it",
      held_by_ended_run: "a run that already ended held it",
      lease_lapsed: "whoever had it let go without finishing",
      sent_back: "you sent it back and nobody picked it up",
      ci_red: "the checks fail and nobody fixes them",
      overdue: "it waits on something outside that does not come",
    } as Record<string, string>,
  },
});

// When each step was first seen nobody's (by project and key, with the status it had then). In memory: after a restart
// the two minutes start again, which only delays a heal.
const firstSeen = new Map<string, number>();
export const resetTurnWatchForTests = () => firstSeen.clear();

export type TurnSweep = { projects: number; items: number; nobody: number; healed: number; cards: number };

async function lastOf(db: Db, taskId: string, type: string, since: Date): Promise<{ at: Date } | null> {
  const [e] = await db
    .select({ at: events.createdAt })
    .from(events)
    .where(and(eq(events.taskId, taskId), eq(events.type, type), gte(events.createdAt, since)))
    .orderBy(sql`${events.createdAt} desc`)
    .limit(1);
  return e ?? null;
}

export async function sweepTurns(db: Db, now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<TurnSweep> {
  const out: TurnSweep = { projects: 0, items: 0, nobody: 0, healed: 0, cards: 0 };
  if (!eventWakesEnabled(env) || (await loadSettings(db)).companyPaused) return out;
  const all = await db.select().from(projects).where(eq(projects.runsPaused, false));
  const seen = new Set<string>();
  for (const p of all) {
    out.projects += 1;
    const etapas = await projectEtapas(db, p, now);
    for (const row of etapas.byTicket.values()) {
      if (!row.turn) continue;
      out.items += 1;
      if (row.turn.turn !== "nobody") continue;
      out.nobody += 1;
      const mark = `${p.id}:${row.key}:${row.status}`;
      seen.add(mark);
      const first = firstSeen.get(mark) ?? now.getTime();
      firstSeen.set(mark, first);
      if (now.getTime() - first < NOBODY_GRACE_MS) continue;
      const done = await healOrCard(db, p, row.key, row.title, row.turn, now);
      if (done === "healed") out.healed += 1;
      if (done === "card") out.cards += 1;
    }
  }
  for (const k of [...firstSeen.keys()]) if (!seen.has(k)) firstSeen.delete(k);
  return out;
}

async function healOrCard(db: Db, p: Project, key: string, title: string, turn: Nobody, now: Date): Promise<"healed" | "card" | "waiting" | null> {
  const [t] = await db.select({ id: tasks.id, key: tasks.key }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  if (!t) return null;
  const since = new Date(now.getTime() - HEAL_WINDOW_MS);
  const healed = await lastOf(db, t.id, "turn.healed", since);
  if (!healed) {
    const heal = turn.heal.kind === "wake" ? await healStep(db, p, key, { reason: `${turn.heal.reason} (watchdog)`, release: turn.heal.release, from: "turn.watchdog", now }) : null;
    await db.insert(events).values({
      projectId: p.id,
      taskId: t.id,
      taskKey: t.key,
      type: "turn.healed",
      actor: SYSTEM_ACTOR,
      payload: { reason: turn.why, heal: turn.heal.kind === "wake" ? (turn.heal.release ? "release+wake" : "wake") : "none", agent: heal?.agent ?? turn.agent, released: heal?.released ?? false, woke: heal?.woke ?? false, run_id: heal?.run_id ?? null, skipped: heal?.skipped ?? null },
    });
    return "healed";
  }
  // One card per window, raised two minutes after the heal if it did not take.
  if (now.getTime() - healed.at.getTime() < NOBODY_GRACE_MS) return "waiting";
  if (await lastOf(db, t.id, "turn.unhealed", since)) return null;
  const w = say(TURN_WORDS);
  const [last] = await db
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.taskId, t.id), inArray(events.type, ["turn.healed"])))
    .orderBy(sql`${events.createdAt} desc`)
    .limit(1);
  const slug = typeof last?.payload?.agent === "string" ? last.payload.agent : null;
  const who = slug ? ((await db.select({ name: agents.name }).from(agents).where(eq(agents.slug, slug)).limit(1))[0]?.name ?? null) : null;
  try {
    await ask(db, { project: p.slug, key, question: w.card(title, who, w.why[turn.why] ?? w.why.not_woken!), human_only: true, urgency: "soon" }, { actor: SYSTEM_ACTOR, tool: "turn.watchdog" });
  } catch (e) {
    if (!(e instanceof ToolError)) throw e;
    return null;
  }
  await db.insert(events).values({ projectId: p.id, taskId: t.id, taskKey: t.key, type: "turn.unhealed", actor: SYSTEM_ACTOR, payload: { reason: turn.why } });
  return "card";
}

export const turnsJob: Job = {
  name: "turns",
  intervalMs: 60_000,
  runOnce: async (db, now) => sweepTurns(db, now),
};
