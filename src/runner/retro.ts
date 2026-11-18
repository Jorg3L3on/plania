// AUDIT-10: the retro. A delivery that came back (QA returned it, or the owner asked for changes) is a miss worth one
// look: when the project sets settings.qa.retro, one wake of the company's Asistente is queued on that ticket. Its
// reason starts with "retro:" and says in one line what was sent back and why; the Asistente's role prompt says what
// a retro run does (it proposes one fix). At most one retro per ticket per delivery commit: QA returning a commit
// and the owner then asking for changes on the same commit is one miss, not two. The mark is a retro.queued event
// on the ticket (no table, no migration). Off unless settings.qa.retro is true.
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { events, pullRequests, qaLanes, type Project, type Task } from "../db/schema.js";
import { asistenteAgent, enqueueWake } from "./events.js";

export const RETRO_PREFIX = "retro:";
export const RETRO_EVENT = "retro.queued";
export type RetroCause = "qa_returned" | "owner_changes";

export type RetroInput = {
  project: Pick<Project, "id" | "slug" | "settings">;
  task: Pick<Task, "id" | "key"> & Partial<Pick<Task, "prUrl">>;
  cause: RetroCause;
  // The delivery's commit. Absent: the commit of the ticket's latest QA pass, else its PR's head.
  commit?: string | null;
  // What was wrong, in the words of whoever sent it back (QA's first finding, the owner's text). Cut to one line.
  why?: string | null;
  // Names the delivery when it has no commit (a doc, a plan): the id of the delivery's message.
  delivery?: string | null;
};

export type RetroOut = { kind: "queued"; runId: string; reason: string } | { kind: "none"; reason: string };

// ---- Text that leaves the ticket for another run's prompt (a retro reason, a calibration example)

const SECRETS: [RegExp, string][] = [
  [/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, "[oculto]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[oculto]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [oculto]"],
  [/\b(password|passwd|contraseña|secret|secreto|token|api[_-]?key|clave)(\s*[:=]\s*)(["']?)[^\s"']{4,}\3/gi, "$1$2[oculto]"],
  // A long run of letters and digits that is not a commit (40 hex at most) nor a file path (no slash, no dot): a
  // key, a hash of one, a signed cookie.
  [/\b(?=[A-Za-z0-9+_-]*\d)[A-Za-z0-9+_-]{41,}={0,2}/g, "[oculto]"],
];
// An absolute path on a machine (a home, a system folder, a Windows drive, ~/): never part of the repo.
const OUTSIDE = [
  /(?<![\w.:/-])~[\\/][^\s"'`),;]*/g,
  /(?<![\w.:/-])\/(?:Users|home|root|var|etc|tmp|private|opt|mnt|Volumes|usr)\/[^\s"'`),;]*/g,
  /(?<![A-Za-z0-9])[A-Za-z]:[\\/](?![\\/])[^\s"'`),;]*/g,
];

/** Takes out what must never travel in a prompt: tokens, passwords, and paths outside the repo. */
export function scrub(text: string): string {
  let s = text;
  for (const [re, to] of SECRETS) s = s.replace(re, to);
  for (const re of OUTSIDE) s = s.replace(re, "[ruta]");
  return s;
}

/** One clean line of at most n characters. */
export function oneLine(text: string | null | undefined, n: number): string {
  const s = scrub(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

const short = (sha: string) => (/^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : sha);

async function deliveryCommit(db: Db, input: RetroInput): Promise<string | null> {
  if (input.commit) return input.commit;
  const [lane] = await db.select({ commit: qaLanes.commit }).from(qaLanes).where(eq(qaLanes.taskId, input.task.id)).orderBy(desc(qaLanes.createdAt)).limit(1);
  if (lane?.commit) return lane.commit;
  const [pr] = await db
    .select({ head: pullRequests.headSha })
    .from(pullRequests)
    .where(input.task.prUrl ? eq(pullRequests.url, input.task.prUrl) : eq(pullRequests.taskId, input.task.id))
    .orderBy(desc(pullRequests.updatedAt))
    .limit(1);
  return pr?.head ?? null;
}

export function retroReason(input: { key: string; cause: RetroCause; commit: string | null; why?: string | null }): string {
  const at = input.commit ? ` (${short(input.commit)})` : "";
  const what = input.cause === "qa_returned" ? `QA sent back the delivery of ${input.key}${at}` : `the owner asked for changes on the delivery of ${input.key}${at}`;
  const why = oneLine(input.why, 240);
  return `${RETRO_PREFIX} ${what}${why ? `: ${why}` : ""}`;
}

/** Queues the retro for a delivery that came back, once per ticket and delivery commit. Never throws for a wake
 *  that cannot be queued (company paused, no Asistente): it says why, and a later miss on the same commit may try
 *  again. */
export async function queueRetro(db: Db, input: RetroInput): Promise<RetroOut> {
  if (input.project.settings.qa?.retro !== true) return { kind: "none", reason: "off" };
  const commit = await deliveryCommit(db, input);
  // 7 characters of the commit: the PR row and the QA pass may hold the short and the long form of the same one.
  const delivery = commit ? short(commit) : input.delivery ? `msg:${input.delivery}` : "sin-commit";
  const agent = await asistenteAgent(db);
  if (!agent) return { kind: "none", reason: "no asistente" };
  const reason = retroReason({ key: input.task.key, cause: input.cause, commit, why: input.why });
  return db.transaction(async (tx) => {
    // Two misses on one delivery at the same moment (QA's return and the owner's click) queue one retro.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`retro:${input.task.id}:${delivery}`}))`);
    const [seen] = await tx
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.taskId, input.task.id), eq(events.type, RETRO_EVENT), sql`${events.payload}->>'delivery' = ${delivery}`))
      .limit(1);
    if (seen) return { kind: "none", reason: "already queued for this delivery" } as RetroOut;
    const out = await enqueueWake(tx, { agent, project: { id: input.project.id, slug: input.project.slug }, taskKey: input.task.key, reason });
    // A wake that joined a run the Asistente already has on this ticket carries the reason there: that is the retro.
    const runId = out.kind === "queued" ? out.runId : out.reason === "coalesced" ? (out.existingRunId ?? null) : null;
    if (!runId) return { kind: "none", reason: out.kind === "none" ? out.reason : "not queued" } as RetroOut;
    await tx.insert(events).values({
      projectId: input.project.id,
      taskId: input.task.id,
      taskKey: input.task.key,
      type: RETRO_EVENT,
      actor: { agent: "plania", session_id: "system" },
      payload: { delivery, cause: input.cause, commit, run_id: runId, reason },
    });
    return { kind: "queued", runId, reason } as RetroOut;
  });
}
