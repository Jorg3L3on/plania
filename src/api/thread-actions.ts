// PLA-I32-4: what the owner does on a message, from the screen only (POST /api/threads/:id/actions, cookie only).
//   aceptar   a linked ticket In review: Done (a doc, a plan, ops or research work). On a code ticket with a PR
//             (the button says fusionar; both words are accepted) the PR is merged into sandbox with
//             `gh pr merge --merge` through releaseGh (src/mcp/release-ship.ts, the token in
//             ~/.config/plania/github-token), never into another base; pr.merged is recorded with the sha.
//             The GitHub poller then moves the ticket to Merged, as for any merge.
//   cambios   the text goes to the ticket as a note, the ticket goes back to Ready and its owner wakes.
//   responder answers the message's question (the screen's answer, as on Solo tú).
// Each writes action_state {action, at, result} on the message, so the buttons go away. A refusal is 409 with
// a reason and changes nothing; a message already acted on is 409 ALREADY_ACTED.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, projects, pullRequests, questions, results, tasks, threadMessages, type ActionState, type Task, type ThreadMessage } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { answer } from "../mcp/questions.js";
import { releaseGh } from "../mcp/release-ship.js";
import { SYSTEM_ACTOR, webCtx, writeTx } from "../mcp/tx.js";
import { setTask } from "../mcp/writes.js";
import { enqueueWake } from "../runner/events.js";
import { queueRetro } from "../runner/retro.js";
import { DEFAULT_START_BRANCH, startBranchOf } from "../runner/start-branch.js";
import type { ThreadRef } from "../runner/threads.js";
import { ownerEs } from "../owner.js";

// PLA-I2-5: the default; a project's own is startBranchOf(project.settings), the only base Aceptar merges into.
export const MERGE_BASE = DEFAULT_START_BRANCH;
const PR = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/;
const CODE = new Set(["code", "bug", "debt"]);

export type ActionInput = { message_id: string; action: "aceptar" | "fusionar" | "cambios" | "responder"; text?: string };
export type ActionRefusal = { error: string; status: 404 | 409; hint: string; [k: string]: unknown };
export type ActionDone = { ok: true; action_state: ActionState };

const refuse = (error: string, hint: string, extra: Record<string, unknown> = {}, status: 404 | 409 = 409): ActionRefusal => ({ error, status, hint, ...extra });

async function linkedTicket(db: Db, msg: ThreadMessage, ref: ThreadRef): Promise<Task | null> {
  const link = msg.links.find((l) => l.kind === "ticket" || l.kind === "idea");
  if (!link) return null;
  const where = ref.project ? and(eq(tasks.projectId, ref.project.id), eq(tasks.key, link.ref)) : eq(tasks.key, link.ref);
  const rows = await db.select().from(tasks).where(where).limit(2);
  return rows.length === 1 ? rows[0]! : null;
}

async function projectOf(db: Db, t: Task) {
  return (await db.select().from(projects).where(eq(projects.id, t.projectId)).limit(1))[0]!;
}

async function record(db: Db, msg: ThreadMessage, state: ActionState): Promise<ActionDone> {
  await db.update(threadMessages).set({ actionState: state }).where(eq(threadMessages.id, msg.id));
  return { ok: true, action_state: state };
}

const prOf = (msg: ThreadMessage, t: Task): string | null => msg.links.find((l) => l.kind === "pr" && PR.test(l.ref))?.ref ?? (t.prUrl && PR.test(t.prUrl) ? t.prUrl : null);

// PLA-I40-7: who accepts. "screen" is the owner's click; "auto" is the project's switch (src/api/auto-accept.ts).
export type AcceptBy = "screen" | "auto";

async function merge(db: Db, msg: ThreadMessage, t: Task, url: string, by: AcceptBy = "screen"): Promise<ActionDone | ActionRefusal> {
  const [, repo, number] = PR.exec(url)!;
  const base = startBranchOf((await projectOf(db, t)).settings);
  const gh = async (step: string, args: string[]) => {
    const r = await releaseGh.run(args);
    if (!r.ok) throw new ToolError("RELEASE_MERGE_FAILED", { step, output: r.stderr.slice(0, 500) });
    return r.stdout.trim();
  };
  try {
    const view = JSON.parse(await gh("view", ["pr", "view", number!, "--repo", repo!, "--json", "baseRefName,state,headRefOid,url"])) as {
      baseRefName: string;
      state: string;
      headRefOid: string;
      url: string;
    };
    // Never main, never anything but sandbox: the runner's deny rules hold for the screen too.
    if (view.baseRefName !== base) return refuse("BASE_NOT_SANDBOX", "El PR no apunta a la rama de trabajo: desde aquí solo se fusiona ahí.", { base: view.baseRefName });
    // Already merged into sandbox (another card or GitHub, before the poller caught up): that is the accept the
    // owner asked for. This message records it; pr.merged is not written twice (the merge already has its event
    // or the poller writes it).
    if (view.state === "MERGED") {
      const done = JSON.parse(await gh("view", ["pr", "view", number!, "--repo", repo!, "--json", "mergeCommit,url"])) as { mergeCommit: { oid: string } | null };
      return record(db, msg, { action: "aceptar", at: new Date().toISOString(), result: { merged: true, already: true, pr: url, base, sha: done.mergeCommit?.oid ?? null, ticket: t.key } });
    }
    if (view.state !== "OPEN") return refuse("PR_NOT_OPEN", `El PR #${number} está cerrado sin fusionar: pide cambios o abre otro.`, { state: view.state });
    // PLA-108 (guided test PLA-86): MIA-I10-5 conflicted with sandbox after MIA-40 was accepted, and Aceptar only said
    // «No se pudo fusionar: revisa el PR», a step the owner cannot take. A conflict goes back to Taller to bring the
    // branch up to date, and the owner is told so.
    const { mergeable } = JSON.parse(await gh("view", ["pr", "view", number!, "--repo", repo!, "--json", "mergeable"])) as { mergeable?: string };
    if (mergeable === "CONFLICTING") return conflictBack(db, t, Number(number), by);
    try {
      await gh("merge", ["pr", "merge", number!, "--repo", repo!, "--merge", "--match-head-commit", view.headRefOid]);
    } catch (e) {
      // PLA-108: right after another PR lands on sandbox GitHub answers mergeable UNKNOWN, and the merge itself is
      // what says «not mergeable: the merge commit cannot be cleanly created». That is the same conflict.
      if (e instanceof ToolError && e.code === "RELEASE_MERGE_FAILED" && NOT_MERGEABLE.test(String((e.detail as { output?: string } | undefined)?.output ?? ""))) {
        return conflictBack(db, t, Number(number), by);
      }
      throw e;
    }
    const after = JSON.parse(await gh("view", ["pr", "view", number!, "--repo", repo!, "--json", "mergeCommit,url"])) as { mergeCommit: { oid: string } | null; url: string };
    const sha = after.mergeCommit?.oid;
    if (!sha) return refuse("MERGE_FAILED", "GitHub no muestra el commit de fusión.", { step: "view" });
    const project = await projectOf(db, t);
    // An automatic accept is the server's write and names the evidence it stood on.
    const auto = by === "auto";
    const [pass] = auto ? await db.select({ id: results.id }).from(results).where(and(eq(results.taskId, t.id), eq(results.verdict, "pass"))).orderBy(desc(results.createdAt)).limit(1) : [];
    const ctx = auto ? { actor: SYSTEM_ACTOR, system: true, tool: "auto.accept" } : { ...webCtx, tool: "screen.thread_merge" };
    await writeTx(db, project, ctx, async (_tx, emit) => {
      await emit("pr.merged", { id: t.id, key: t.key }, { number: Number(number), url: after.url || view.url, base, merge_sha: sha, by, message_id: msg.id, ...(auto ? { evidence_id: pass?.id ?? null } : {}) });
    });
    await mergedNow(db, project, t, { repo: repo!, number: Number(number), url: after.url || view.url, sha });
    return record(db, msg, { action: "aceptar", at: new Date().toISOString(), result: { merged: true, pr: url, base, sha, ticket: t.key, ...(auto ? { by: "auto" } : {}) } });
  } catch (e) {
    if (e instanceof ToolError && e.code === "RELEASE_MERGE_FAILED") return refuse("MERGE_FAILED", "No se pudo fusionar el PR.", e.detail);
    throw e;
  }
}

// PLA-108: the delivery's PR conflicts with sandbox. The ticket goes back to Ready with a note saying why, and its owner
// (Taller) gets one wake whose reason is the instruction; a wake already queued for it takes the reason too.
const NOT_MERGEABLE = /not mergeable|cannot be cleanly created|merge conflict/i;
export const conflictWake = (base: string) =>
  `The PR conflicts with ${base} (work accepted after this branch was cut). Merge origin/${base} into the branch, resolve the conflict keeping both changes, run the tests, push and finish again with the same muestra.`;
async function conflictBack(db: Db, t: Task, number: number, by: AcceptBy): Promise<ActionRefusal> {
  const project = await projectOf(db, t);
  const base = startBranchOf(project.settings);
  const ctx = by === "auto" ? { actor: SYSTEM_ACTOR, system: true, tool: "auto.accept" } : { ...webCtx, tool: "screen.thread_merge" };
  await setTask(db, { project: project.slug, key: t.key, status: "Ready", version: t.version, note: `El PR #${number} choca con la rama de trabajo: vuelve a Taller para ponerlo al día con lo último aceptado.` } as never, ctx);
  if (t.ownerAgent) {
    const [owner] = await db.select().from(agents).where(eq(agents.id, t.ownerAgent)).limit(1);
    if (owner) await enqueueWake(db, { agent: owner, project, taskKey: t.key, reason: conflictWake(base), appendReason: true }).catch(() => undefined);
  }
  return refuse("MERGE_CONFLICT", "Choca con lo último que aceptaste: volvió a Taller para ponerla al día y te llega otra vez.", { key: t.key, pr: number });
}

// PLA-82 (F-31): the merge Plania just made is known now; the floor read «Publicar 4 cambios» with the step still
// «en revisión» for ~40 s until the GitHub poller saw it. The stored PR becomes merged (so the poller does not say
// pr.merged twice) and the In review tickets it carries move to Merged, as the poller would.
async function mergedNow(db: Db, project: typeof projects.$inferSelect, t: Task, pr: { repo: string; number: number; url: string; sha: string }): Promise<void> {
  await db
    .update(pullRequests)
    .set({ state: "merged", mergeSha: pr.sha, mergedAt: new Date(), baseBranch: startBranchOf(project.settings) })
    .where(and(eq(pullRequests.projectId, project.id), eq(pullRequests.repo, pr.repo), eq(pullRequests.number, pr.number)));
  const sharing = await db.select().from(tasks).where(and(eq(tasks.projectId, project.id), eq(tasks.prUrl, pr.url), eq(tasks.status, "In review")));
  const moving = [t, ...sharing.filter((x) => x.id !== t.id)];
  for (const m of moving) {
    await setTask(
      db,
      { project: project.slug, key: m.key, status: "Merged", note: `PR #${pr.number} merged into ${startBranchOf(project.settings)} (${pr.sha.slice(0, 7)})` } as never,
      { actor: SYSTEM_ACTOR, system: true, requestId: `accept:${pr.repo}#${pr.number}:merged:${pr.sha}:${m.key}`, tool: "screen.thread_merge" },
    ).catch((e) => console.log(`[accept] ${m.key} stays for the poller: ${e instanceof Error ? e.message : String(e)}`));
  }
}

async function accept(db: Db, msg: ThreadMessage, ref: ThreadRef, by: AcceptBy = "screen"): Promise<ActionDone | ActionRefusal> {
  const t = await linkedTicket(db, msg, ref);
  if (!t) return refuse("NO_TICKET", "El mensaje no enlaza un ticket de este hilo.");
  if (t.status !== "In review") return refuse("NOT_IN_REVIEW", `${t.key} está en ${t.status}, no En revisión.`, { key: t.key, status: t.status });
  const pr = prOf(msg, t);
  if (pr && CODE.has(t.workType ?? "code")) return merge(db, msg, t, pr, by);
  // Only a PR is accepted automatically: a doc or a plan is the owner's to read.
  if (by === "auto") return refuse("NOT_A_PR", "Solo una entrega con PR se acepta sola.");
  const project = await projectOf(db, t);
  await setTask(db, { project: project.slug, key: t.key, status: "Done", version: t.version } as never, { ...webCtx, tool: "screen.thread_accept" });
  return record(db, msg, { action: "aceptar", at: new Date().toISOString(), result: { ticket: t.key, status: "Done" } });
}

async function changes(db: Db, msg: ThreadMessage, ref: ThreadRef, text: string): Promise<ActionDone | ActionRefusal> {
  const t = await linkedTicket(db, msg, ref);
  if (!t) return refuse("NO_TICKET", "El mensaje no enlaza un ticket de este hilo.");
  if (["Done", "Won't do", "Merged", "Released"].includes(t.status)) return refuse("TICKET_CLOSED", `${t.key} ya está cerrado (${t.status}).`, { key: t.key, status: t.status });
  const project = await projectOf(db, t);
  await setTask(db, { project: project.slug, key: t.key, status: "Ready", version: t.version, note: `Cambios que pide ${ownerEs()}: ${text}` } as never, { ...webCtx, tool: "screen.thread_changes" });
  // Moving to Ready wakes a PO-owned ticket's PO, or Taller for code (the event hook). Any other owner is
  // woken here, unless it already has a run queued or running.
  let wake: string = "event";
  if (t.ownerAgent) {
    const [owner] = await db.select().from(agents).where(eq(agents.id, t.ownerAgent)).limit(1);
    // PLA-I60-1: one run per work item; a run already on this ticket takes the request too.
    if (owner) {
      const out = await enqueueWake(db, { agent: owner, project, taskKey: t.key, reason: "changes requested" });
      wake = out.kind === "queued" || out.reason === "coalesced" ? "queued" : out.reason;
    }
  }
  // AUDIT-10: a delivery the owner sent back gets one retro (settings.qa.retro), once per delivery.
  await queueRetro(db, { project, task: t, cause: "owner_changes", why: text, delivery: msg.id }).catch(() => undefined);
  return record(db, msg, { action: "cambios", at: new Date().toISOString(), result: { ticket: t.key, status: "Ready", text, wake } });
}

async function reply(db: Db, msg: ThreadMessage, text: string): Promise<ActionDone | ActionRefusal> {
  if (!msg.questionId) return refuse("NO_QUESTION", "El mensaje no trae una pregunta.");
  const [q] = await db.select().from(questions).where(eq(questions.id, msg.questionId)).limit(1);
  if (!q) return refuse("NO_QUESTION", "La pregunta ya no existe.");
  if (q.answeredAt) return refuse("ALREADY_ANSWERED", "La pregunta ya tiene respuesta.", { answer: q.answer });
  const [project] = await db.select().from(projects).where(eq(projects.id, q.projectId)).limit(1);
  await answer(db, { project: project!.slug, question_id: q.id, answer: text }, { ...webCtx, tool: "screen.thread_answer" });
  return record(db, msg, { action: "responder", at: new Date().toISOString(), result: { question_id: q.id, answer: text } });
}

export async function threadAction(db: Db, ref: ThreadRef, input: ActionInput, by: AcceptBy = "screen"): Promise<ActionDone | ActionRefusal> {
  const [msg] = await db
    .select()
    .from(threadMessages)
    .where(and(eq(threadMessages.id, input.message_id), eq(threadMessages.threadId, ref.thread.id)))
    .limit(1);
  if (!msg) return refuse("MESSAGE_NOT_FOUND", "No hay ese mensaje en este hilo.", {}, 404);
  if (msg.actionState) return refuse("ALREADY_ACTED", "Ya actuaste sobre este mensaje.", { action_state: msg.actionState });
  const text = input.text?.trim() ?? "";
  if (input.action === "aceptar" || input.action === "fusionar") return accept(db, msg, ref, by);
  if (!text) return refuse("TEXT_REQUIRED", input.action === "cambios" ? "Escribe qué cambiar." : "Escribe tu respuesta.");
  if (input.action === "cambios") return changes(db, msg, ref, text);
  return reply(db, msg, text);
}
