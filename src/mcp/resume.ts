import { desc, eq, inArray } from "drizzle-orm";
import { agents, events, tasks, type Project, type Task } from "../db/schema.js";
import { statusByAgentId, type AgentRef } from "./team.js";
import { listDecisions } from "./decisions.js";
import { machineLine } from "./footprint-read.js";
import { liveOwner, nextTask } from "./queries.js";
import { generatedHeadline } from "./headline.js";
import { initiativeState } from "./initiative-state.js";
import { headlineNoteShape } from "./project.js";
import { openQuestions } from "./questions.js";
import { envDriftOf, loadReadiness } from "./readiness.js";
import { openRequests } from "./requests.js";
import { statusBlock } from "./status.js";
import { summarize } from "./summary.js";
import { iso, type Q } from "./tx.js";

// get_resume: generated, never hand-written. One block per open initiative (what is claimed, what is
// next, what must be kept), the standalone tickets, project-wide pinned decisions, questions waiting
// for Jorge and the latest events.
// Initiatives write their part with set_task next_action / in_progress_note; decisions with add_decision pin.

const CLOSED = ["Done", "Won't do"];
const RECENT_EVENTS = 10;

function claimLine(t: Task, owners: Map<string, AgentRef>) {
  return {
    key: t.key,
    kind: t.kind,
    title: t.title,
    owner: t.owner,
    owner_agent: t.ownerAgent ? (owners.get(t.ownerAgent) ?? null) : null,
    lease_until: iso(t.leaseUntil),
    workspace: t.workspace,
  };
}

function statusCounts(children: Task[]) {
  const counts: Record<string, number> = {};
  for (const c of children) counts[c.status] = (counts[c.status] ?? 0) + 1;
  return counts;
}

export async function resumeDigest(db: Q, p: Project) {
  const all = await db.select().from(tasks).where(eq(tasks.projectId, p.id)).orderBy(tasks.key);
  const byId = new Map(all.map((t) => [t.id, t]));
  const openInitiatives = all.filter((t) => t.kind === "initiative" && !CLOSED.includes(t.status));
  const openIds = new Set(openInitiatives.map((i) => i.id));
  const tickets = all.filter((t) => t.kind === "ticket");
  const claimed = tickets.filter((t) => liveOwner(t));
  const ownerIds = [...new Set(all.map((t) => t.ownerAgent).filter((id): id is string => !!id))];
  const ownerRows = ownerIds.length
    ? await db
        .select({ id: agents.id, slug: agents.slug, name: agents.name, role: agents.role, title: agents.title, lastCheckInAt: agents.lastCheckInAt })
        .from(agents)
        .where(inArray(agents.id, ownerIds))
    : [];
  const derived = await statusByAgentId(db, ownerRows);
  const owners = new Map(ownerRows.map((r) => [r.id, { slug: r.slug, name: r.name, role: r.role, title: r.title, status: derived.get(r.id) ?? "idle" } satisfies AgentRef]));
  const line = (t: Task) => claimLine(t, owners);

  // Pinned and not reversed by a later decision.
  const pinnedRows = await listDecisions(db, p.id, { pinned: true, includeSuperseded: false, limit: 500 });
  const keyToId = new Map(all.map((t) => [t.key, t.id]));
  // A pinned decision belongs to the open initiative it is about, directly or through a child ticket.
  const initiativeOf = (taskId: string | null): string | null => {
    const t = taskId ? byId.get(taskId) : undefined;
    if (!t) return null;
    const id = t.kind === "initiative" ? t.id : t.parentId;
    return id && openIds.has(id) ? id : null;
  };
  const pinned = pinnedRows.map((d) => ({
    home: initiativeOf(d.task_key ? (keyToId.get(d.task_key) ?? null) : null),
    shape: d,
  }));

  const initiatives = [];
  for (const i of openInitiatives) {
    const children = tickets.filter((t) => t.parentId === i.id);
    initiatives.push({
      key: i.key,
      title: i.title,
      status: i.status,
      summary: i.summary,
      // 2.11: the derived state first; the notes below are commentary.
      state: await initiativeState(db, i, children),
      state_note: i.stateNote,
      in_progress: { note: i.inProgressNote, claims: children.filter((t) => liveOwner(t)).map(line) },
      next_action: { note: i.nextAction, next_claimable: (await nextTask(db, p.id, i.key)).task },
      must_keep: pinned.filter((d) => d.home === i.id).map((d) => d.shape),
      counts: statusCounts(children),
    });
  }

  const standalone = tickets.filter((t) => !t.parentId || !openIds.has(t.parentId));
  const recent = await db
    .select()
    .from(events)
    .where(eq(events.projectId, p.id))
    .orderBy(desc(events.id))
    .limit(RECENT_EVENTS);

  const status = await statusBlock(db, p);
  const next_claimable = (await nextTask(db, p.id)).task;
  // The status block already resolved heads. A missing commit or head is unknown, not "not behind".
  const drift = envDriftOf(
    status.envs.map((env) => ({ commit: env.commit })),
    status.initiatives.map((initiative) => ({ branch: initiative.integration_branch })),
    status.initiatives.flatMap((initiative) =>
      initiative.integration_branch ? [{ name: initiative.integration_branch, headSha: initiative.head_sha }] : [],
    ),
  );
  const readiness = await loadReadiness(db, p, {
    tasks: all,
    lastEventAt: recent[0]?.createdAt ?? null,
    nextClaimableKey: next_claimable?.key ?? null,
    envBehind: drift.behind,
    envUnknown: drift.unknown,
  });
  const digest = {
    project: p.slug,
    generated_at: new Date().toISOString(),
    // 2.11: generated from the status block; the note is what set_project headline wrote.
    headline: { generated: await generatedHeadline(db, p, { status, next_claimable, claims: claimed.map(line) }), note: headlineNoteShape(p) },
    status,
    // What this project's agents have running on the Mac, in one line (null when nothing is).
    machine: await machineLine(db, p.id),
    claims: claimed.map(line),
    // 2.12: what Jorge asked for on screen, newest first. Read these before the backlog.
    requests: await openRequests(db, p.id),
    next_claimable,
    initiatives,
    standalone: {
      open: standalone.filter((t) => !CLOSED.includes(t.status)).length,
      claims: standalone.filter((t) => liveOwner(t)).map(line),
    },
    must_keep: pinned.filter((d) => d.home === null).map((d) => d.shape),
    open_questions: await openQuestions(db, p.id),
    recent: recent.map((e) => ({ at: iso(e.createdAt), type: e.type, task_key: e.taskKey, agent: e.actor.agent })),
    readiness,
  };
  const last = recent[0];
  return attachMovement(
    digest,
    last
      ? lastMovementLine({
          at: last.createdAt,
          type: last.type,
          task_key: last.taskKey,
          agent: last.actor.agent,
          summary: summarize({ type: last.type, task_key: last.taskKey, actor: last.actor, payload: last.payload ?? {} }),
        })
      : "",
  );
}

export type ResumeDigest = Awaited<ReturnType<typeof resumeDigest>>;

// Not a tool field. resumeLine reads it; JSON and Object.keys leave it out.
const LAST_MOVEMENT = Symbol("lastMovement");

function attachMovement<T extends object>(value: T, line: string): T {
  Object.defineProperty(value, LAST_MOVEMENT, { value: line, enumerable: false });
  return value;
}

function movementOf(d: ResumeDigest): string {
  const stored = (d as ResumeDigest & { [LAST_MOVEMENT]?: string })[LAST_MOVEMENT];
  if (typeof stored === "string") return stored;
  const last = d.recent[0];
  return last ? lastMovementLine(last) : "";
}

/** "hace 8 días": full words, so a quiet project can say when it last moved. */
export function movementAgo(at: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (seconds < 90) return "hace un momento";
  if (seconds < 3600) {
    const n = Math.max(1, Math.round(seconds / 60));
    return `hace ${n} ${n === 1 ? "minuto" : "minutos"}`;
  }
  if (seconds < 86400) {
    const n = Math.max(1, Math.round(seconds / 3600));
    return `hace ${n} ${n === 1 ? "hora" : "horas"}`;
  }
  const n = Math.max(1, Math.round(seconds / 86400));
  return `hace ${n} ${n === 1 ? "día" : "días"}`;
}

/** The last event, in one line. Empty when there is no event. `summary` is the Spanish event line. */
export function lastMovementLine(
  event: {
    at: Date | string;
    type?: string | null;
    task_key?: string | null;
    agent?: string | null;
    summary?: string | null;
  } | null | undefined,
  now: Date = new Date(),
): string {
  if (!event) return "";
  const at = event.at instanceof Date ? event.at : new Date(event.at);
  if (Number.isNaN(at.getTime())) return "";
  const summary = event.summary?.trim() ?? "";
  const fallback = [event.task_key, event.type].filter((part): part is string => !!part).join(" · ");
  const who = summary || !event.agent ? "" : ` (${event.agent})`;
  const what = summary || (fallback ? `${fallback}${who}` : "");
  if (!what) return "";
  return `Último movimiento ${movementAgo(at, now)}: ${what}`;
}

// One line per project (list_projects, get_digest, the screen's index): the generated headline,
// else the next step. With nothing to say, that step is the last event, or empty.
export function resumeLine(d: ResumeDigest): string {
  return d.headline.generated || nextStepLine(d);
}

// The next step in one line, for Inicio's tiles: what is claimed, else the next step an initiative
// wrote, else what is next to claim, else the note, else the last event. (The project line before 2.11.)
export function nextStepLine(d: ResumeDigest): string {
  if (d.claims.length) return `En curso: ${d.claims.map((c) => `${c.key} (${c.owner?.agent})`).join(", ")}`;
  const noted = d.initiatives.find((i) => i.next_action.note);
  if (noted) return `${noted.key}: ${noted.next_action.note}`;
  if (d.next_claimable) return `Siguiente: ${d.next_claimable.key} · ${d.next_claimable.title}`;
  if (d.headline.note.text) return d.headline.note.text;
  return movementOf(d);
}
