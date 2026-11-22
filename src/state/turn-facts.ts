// PLA-I74-5: the facts turnOf reads, for every open ticket of one project, in a fixed number of queries: the tickets
// (with the workable rule's parts), live and queued runs, leases and whether the run behind one ended, open
// questions, blockers, and the board's stage of each ticket (projectEtapas, passed in).
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, blockers, envStates, questions, taskBlockers, tasks, type Actor, type Agent, type Project } from "../db/schema.js";
import { typedBlockerOpen } from "../mcp/blockers.js";
import { loadSettings, roleOf } from "../runner/limits.js";
import { isRunSession, sessionsOf } from "../runner/run-session.js";
import { serviceAgent } from "../runner/events.js";
import { ST, SETTLED, sqlNotIn } from "./status.js";
import { turnOf, type TurnInput, type TurnOrNobody } from "./turn.js";
import { notPersonOwned, parentNotOnHold, workable } from "./workable.js";

const TALLER_WORK = new Set(["code", "bug", "debt", "ops"]);
export const LIVE_RUN = ["starting", "running"] as const;

// What the board already knows of each ticket (src/api/etapa.ts ProjectTicket), by key.
export type BoardRow = { etapa: { etapa: string; qa: string | null; ci: string | null }; arranque: { summary: string } | null };

export type ItemTurn = { key: string; id: string; title: string; status: string; statusChangedAt: Date | null; turn: TurnOrNobody; worker: Agent | null };

export async function projectTurns(db: Db, p: Pick<Project, "id" | "slug" | "runsPaused">, board: Map<string, BoardRow>, now = new Date()): Promise<ItemTurn[]> {
  const rows = await db
    .select({
      id: tasks.id,
      key: tasks.key,
      title: tasks.title,
      status: tasks.status,
      statusChangedAt: tasks.statusChangedAt,
      createdAt: tasks.createdAt,
      owner: tasks.owner,
      leaseUntil: tasks.leaseUntil,
      claimedAt: tasks.claimedAt,
      ownerAgent: tasks.ownerAgent,
      workType: tasks.workType,
      workable: sql<boolean>`${workable}`,
      onHold: sql<boolean>`not ${parentNotOnHold}`,
      personOwned: sql<boolean>`not ${notPersonOwned}`,
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, p.id), eq(tasks.kind, "ticket"), sql`${tasks.status} not in (${ST.done}, ${ST.wontDo})`));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const runs = await db
    .select({ id: agentRuns.id, status: agentRuns.status, taskKey: agentRuns.taskKey, startedAt: agentRuns.startedAt, agentId: agentRuns.agentId, slug: agents.slug })
    .from(agentRuns)
    .innerJoin(agents, eq(agents.id, agentRuns.agentId))
    .where(and(eq(agentRuns.projectId, p.id), inArray(agentRuns.status, ["queued", ...LIVE_RUN])));
  // Agents busy anywhere (a teammate shared across projects runs one thing at a time), and the sessions live runs write as.
  const busyRows = await db.select({ id: agentRuns.id, agentId: agentRuns.agentId }).from(agentRuns).where(inArray(agentRuns.status, [...LIVE_RUN]));
  const busy = new Set(busyRows.map((r) => r.agentId));
  const liveSessions = new Set(busyRows.flatMap((r) => sessionsOf(r.id)));
  const asked = new Set(
    (await db.select({ taskId: questions.taskId }).from(questions).where(and(eq(questions.projectId, p.id), isNull(questions.answeredAt), inArray(questions.taskId, ids)))).map((q) => q.taskId),
  );
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const typed = (
    await db.execute<{ task_id: string; type: string; spec: Record<string, unknown> }>(sql`
      select bl.task_id, bl.type, bl.spec from ${blockers} bl
      join ${tasks} bt on bt.id = bl.task_id
      left join ${envStates} es on es.project_id = bt.project_id and es.env = bl.spec->>'env'
      where bl.task_id in (${idList}) and ${typedBlockerOpen()}
      order by bl.created_at`)
  ).rows;
  const waits = (
    await db.execute<{ task_id: string; title: string }>(sql`
      select tb.task_id, b.title from ${taskBlockers} tb join ${tasks} b on b.id = tb.blocker_id join ${tasks} w on w.id = tb.task_id
      where tb.task_id in (${idList})
        and (${sqlNotIn(sql`b.status`, SETTLED)} or (w.status = ${ST.backlog} and b.status = ${ST.inReview}))
      order by b.phase nulls last, b.key`)
  ).rows;
  const ownerIds = [...new Set(rows.map((r) => r.ownerAgent).filter((x): x is string => !!x))];
  const owners = new Map((ownerIds.length ? await db.select().from(agents).where(inArray(agents.id, ownerIds)) : []).map((a) => [a.id, a]));
  const taller = await serviceAgent(db, "taller", p);
  const po = await serviceAgent(db, "product-owner", p);
  const paused = p.runsPaused || (await loadSettings(db)).companyPaused;

  const live = new Map<string, (typeof runs)[number]>();
  const queued = new Map<string, (typeof runs)[number]>();
  for (const r of runs) {
    if (!r.taskKey) continue;
    if ((LIVE_RUN as readonly string[]).includes(r.status)) live.set(r.taskKey, r);
    else if (!queued.has(r.taskKey)) queued.set(r.taskKey, r);
  }
  const typedBy = new Map<string, (typeof typed)[number]>();
  for (const b of typed) if (!typedBy.has(String(b.task_id))) typedBy.set(String(b.task_id), b);
  const waitBy = new Map<string, string>();
  for (const w of waits) if (!waitBy.has(String(w.task_id))) waitBy.set(String(w.task_id), String(w.title));

  return rows.flatMap((t): ItemTurn[] => {
    const ownerAgent = t.ownerAgent ? owners.get(t.ownerAgent) : undefined;
    const runnerOwner = ownerAgent && ownerAgent.kind !== "human" && ownerAgent.slug !== "ceo" && !!roleOf(ownerAgent) ? ownerAgent : null;
    const worker = runnerOwner ?? (TALLER_WORK.has(t.workType ?? "code") ? taller : po);
    const actor = t.owner as Actor | null;
    const leaseLive = !!actor && !!t.leaseUntil && t.leaseUntil.getTime() > now.getTime();
    const runner = isRunSession(actor?.session_id);
    const b = board.get(t.key);
    const tb = typedBy.get(t.id);
    const run = live.get(t.key);
    const q = queued.get(t.key);
    const input: TurnInput = {
      key: t.key,
      status: t.status,
      statusChangedAt: t.statusChangedAt ?? t.createdAt,
      paused,
      liveRun: run ? { id: run.id, agent: run.slug, since: run.startedAt } : null,
      queuedRun: q ? { id: q.id, agent: q.slug } : null,
      lease: leaseLive ? { agent: actor?.agent ?? null, runner, runnerEnded: runner && !liveSessions.has(actor!.session_id), since: t.claimedAt } : null,
      question: asked.has(t.id),
      couldNotStart: b?.arranque?.summary ?? null,
      onHold: !!t.onHold,
      personOwned: !!t.personOwned,
      workable: !!t.workable,
      waitsOnStep: waitBy.get(t.id) ?? null,
      typed: tb ? { type: String(tb.type), at: typeof tb.spec?.at === "string" ? tb.spec.at : null, text: typeof tb.spec?.text === "string" ? tb.spec.text : null } : null,
      etapa: b?.etapa.etapa ?? null,
      qa: b?.etapa.qa ?? null,
      ci: b?.etapa.ci ?? null,
      worker: worker?.slug ?? null,
      workerBusy: !!worker && busy.has(worker.id),
    };
    const turn = turnOf(input, now);
    return turn ? [{ key: t.key, id: t.id, title: t.title, status: t.status, statusChangedAt: input.statusChangedAt, turn, worker }] : [];
  });
}
