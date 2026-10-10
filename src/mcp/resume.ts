import { desc, eq } from "drizzle-orm";
import { events, tasks, type Project, type Task } from "../db/schema.js";
import { listDecisions } from "./decisions.js";
import { machineLine } from "./footprint-read.js";
import { legacyCard, liveOwner, nextTask } from "./queries.js";
import { headlineShape } from "./project.js";
import { openQuestions } from "./questions.js";
import { statusBlock } from "./status.js";
import { iso, type Q } from "./tx.js";

// get_resume: generated, never hand-written. One block per open initiative (what is claimed, what is
// next, what must be kept), the standalone tickets, project-wide pinned decisions, questions waiting
// for Jorge and the latest events.
// Initiatives write their part with set_task next_action / in_progress_note; decisions with add_decision pin.

const CLOSED = ["Done", "Won't do"];
const RECENT_EVENTS = 10;

function claimLine(t: Task) {
  return {
    key: t.key,
    kind: t.kind,
    title: t.title,
    owner: t.owner,
    lease_until: iso(t.leaseUntil),
    workspace: t.workspace,
  };
}

function statusCounts(children: Task[]) {
  const counts: Record<string, number> = {};
  for (const c of children) counts[c.status] = (counts[c.status] ?? 0) + 1;
  return counts;
}

export type ResumeOptions = { includeLegacy?: boolean };

export async function resumeDigest(db: Q, p: Project, opts: ResumeOptions = {}) {
  const all = await db.select().from(tasks).where(eq(tasks.projectId, p.id)).orderBy(tasks.key);
  const byId = new Map(all.map((t) => [t.id, t]));
  const openInitiatives = all.filter((t) => t.kind === "initiative" && !CLOSED.includes(t.status));
  const openIds = new Set(openInitiatives.map((i) => i.id));
  const tickets = all.filter((t) => t.kind === "ticket");
  const claimed = tickets.filter((t) => liveOwner(t));

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
      in_progress: { note: i.inProgressNote, claims: children.filter((t) => liveOwner(t)).map(claimLine) },
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

  const card = legacyCard(p);
  return {
    project: p.slug,
    generated_at: new Date().toISOString(),
    headline: headlineShape(p),
    status: await statusBlock(db, p),
    // What this project's agents have running on the Mac, in one line (null when nothing is).
    machine: await machineLine(db, p.id),
    claims: claimed.map(claimLine),
    next_claimable: (await nextTask(db, p.id)).task,
    initiatives,
    standalone: {
      open: standalone.filter((t) => !CLOSED.includes(t.status)).length,
      claims: standalone.filter((t) => liveOwner(t)).map(claimLine),
    },
    must_keep: pinned.filter((d) => d.home === null).map((d) => d.shape),
    open_questions: await openQuestions(db, p.id),
    recent: recent.map((e) => ({ at: iso(e.createdAt), type: e.type, task_key: e.taskKey, agent: e.actor.agent })),
    // The v1 hand-written card is read-only and hidden by default (R-01); archive_legacy_card retires it.
    legacy_card_present: card !== null,
    ...(opts.includeLegacy ? { legacy_card: card } : {}),
  };
}

export type ResumeDigest = Awaited<ReturnType<typeof resumeDigest>>;
