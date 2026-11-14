// Volver a probar: a delivery whose repo has no CI is held until the ticket has a pass on the PR's latest commit
// (PLA-14). When the pass it has is on an older commit (a commit landed after it, e.g. Plania's own file step),
// the card offers "Que <owner> vuelva a probar": the ticket's owner wakes on that ticket with the exact ask
// (pull, run the project's checks on the head, add_result with that commit, back to In review, no code change).
// While that run is queued or running the card says so; once the pass lands on the head the hold clears.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, projects, type Task } from "../db/schema.js";
import { enqueueWake } from "../runner/events.js";
import { roleOf } from "../runner/limits.js";
import { webCtx, writeTx } from "../mcp/tx.js";

/** The owner as the card says it. */
export const whoWord = (role: string | null | undefined) => (role === "taller" ? "Taller" : role === "product-owner" ? "El PO" : role === "research" ? "Research" : role === "artist" ? "Artist" : "Su dueño");

export type Verifying = { state: "queued" | "running"; since: string; role: string | null };

/** The owner's run on this ticket, while it is queued or running. */
export async function verifyingOf(db: Db, t: Task | null): Promise<Verifying | null> {
  if (!t?.ownerAgent) return null;
  const [run] = await db
    .select({ status: agentRuns.status, queuedAt: agentRuns.queuedAt, startedAt: agentRuns.startedAt, role: agentRuns.role })
    .from(agentRuns)
    .where(and(eq(agentRuns.projectId, t.projectId), eq(agentRuns.taskKey, t.key), inArray(agentRuns.status, ["queued", "running"])))
    .orderBy(desc(agentRuns.queuedAt))
    .limit(1);
  if (!run) return null;
  const state = run.status === "running" ? "running" : "queued";
  return { state, since: (state === "running" ? (run.startedAt ?? run.queuedAt) : run.queuedAt).toISOString(), role: run.role };
}

export const verifyReason = (t: Task, head: string | null, branch: string | null) =>
  `Jorge asks for a fresh test run on ${t.key}, no code change: the pass on record is on an older commit than the PR's head` +
  `${head ? ` (${head.slice(0, 7)})` : ""}. Pull ${branch ?? "the ticket's branch"}, run the ticket's checks on its latest commit, ` +
  "add_result with that commit and the counts, and set the ticket back to In review. If something fails, say what in the thread.";

export type VerifyOut = { ok: true; wake: string; role: string | null } | { error: string; hint: string };

/** Wake the ticket's owner to re-run its checks on the head. Nothing changes on the ticket but a note. */
export async function requestVerify(db: Db, t: Task, head: string | null, branch: string | null): Promise<VerifyOut> {
  if (!t.ownerAgent) return { error: "NO_OWNER", hint: "El ticket no tiene a quién pedírselo." };
  const [owner] = await db.select().from(agents).where(eq(agents.id, t.ownerAgent)).limit(1);
  if (!owner) return { error: "NO_OWNER", hint: "El ticket no tiene a quién pedírselo." };
  const [p] = await db.select().from(projects).where(eq(projects.id, t.projectId)).limit(1);
  if (!p) return { error: "NO_PROJECT", hint: "El proyecto ya no está." };
  if (await verifyingOf(db, t)) return { ok: true, wake: "queued", role: roleOf(owner) ?? owner.role };
  let wake = "none";
  await writeTx(db, p, { ...webCtx, tool: "screen.decision_verify" }, async (tx, emit) => {
    const out = await enqueueWake(tx, { agent: owner, project: { id: p.id, slug: p.slug }, taskKey: t.key, reason: verifyReason(t, head, branch) });
    wake = out.kind === "queued" ? "queued" : out.reason;
    await emit("note", { id: t.id, key: t.key }, { text: `Jorge pidió volver a correr las pruebas en el último commit${head ? ` (${head.slice(0, 7)})` : ""}.` });
  });
  if (wake !== "queued") {
    const hint = /paused/.test(wake)
      ? "El proyecto o la compañía están en pausa: reanúdalos y vuelve a pedirlo."
      : /coalesced/.test(wake)
        ? `${whoWord(roleOf(owner) ?? owner.role)} está en otra corrida: vuelve a pedirlo cuando termine.`
        : `No se pudo despertar (${wake}).`;
    return { error: "NOT_WOKEN", hint };
  }
  return { ok: true, wake, role: roleOf(owner) ?? owner.role };
}
