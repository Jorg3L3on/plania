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
import { ownerEs, ownerName } from "../owner.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: the card's words, the note and the refusals in the install's language; the Spanish is unchanged.
export const VERIFY_WORDS = defineWords({
  es: {
    who: { taller: "Taller", "product-owner": "El PO", research: "Research", artist: "Artist" } as Record<string, string>,
    itsOwner: "Su dueño",
    noOwner: "El ticket no tiene a quién pedírselo.",
    noProject: "El proyecto ya no está.",
    note: (head: string | null) => `${ownerEs(undefined, { capital: true })} pidió volver a correr las pruebas en el último commit${head ? ` (${head})` : ""}.`,
    paused: "El proyecto o la compañía están en pausa: reanúdalos y vuelve a pedirlo.",
    busy: (who: string) => `${who} está en otra corrida: vuelve a pedirlo cuando termine.`,
    notWoken: (why: string) => `No se pudo despertar (${why}).`,
  },
  en: {
    who: { taller: "Taller", "product-owner": "The PO", research: "Research", artist: "Artist" } as Record<string, string>,
    itsOwner: "Its owner",
    noOwner: "The ticket has nobody to ask.",
    noProject: "The project is gone.",
    note: (head: string | null) => `${ownerName("en", { capital: true })} asked to run the tests again on the latest commit${head ? ` (${head})` : ""}.`,
    paused: "The project or the company is paused: resume them and ask again.",
    busy: (who: string) => `${who} is in another run: ask again when it ends.`,
    notWoken: (why: string) => `Could not wake it (${why}).`,
  },
});

/** The owner as the card says it. */
export const whoWord = (role: string | null | undefined) => {
  const w = say(VERIFY_WORDS);
  return role && Object.hasOwn(w.who, role) ? w.who[role]! : w.itsOwner;
};

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
  `The owner asks for a fresh test run on ${t.key}, no code change: the pass on record is on an older commit than the PR's head` +
  `${head ? ` (${head.slice(0, 7)})` : ""}. Pull ${branch ?? "the ticket's branch"}, run the ticket's checks on its latest commit, ` +
  "add_result with that commit and the counts, and set the ticket back to In review. If something fails, say what in the thread.";

export type VerifyOut = { ok: true; wake: string; role: string | null } | { error: string; hint: string };

/** Wake the ticket's owner to re-run its checks on the head. Nothing changes on the ticket but a note. */
export async function requestVerify(db: Db, t: Task, head: string | null, branch: string | null): Promise<VerifyOut> {
  const w = say(VERIFY_WORDS);
  if (!t.ownerAgent) return { error: "NO_OWNER", hint: w.noOwner };
  const [owner] = await db.select().from(agents).where(eq(agents.id, t.ownerAgent)).limit(1);
  if (!owner) return { error: "NO_OWNER", hint: w.noOwner };
  const [p] = await db.select().from(projects).where(eq(projects.id, t.projectId)).limit(1);
  if (!p) return { error: "NO_PROJECT", hint: w.noProject };
  if (await verifyingOf(db, t)) return { ok: true, wake: "queued", role: roleOf(owner) ?? owner.role };
  let wake = "none";
  await writeTx(db, p, { ...webCtx, tool: "screen.decision_verify" }, async (tx, emit) => {
    const out = await enqueueWake(tx, { agent: owner, project: { id: p.id, slug: p.slug }, taskKey: t.key, reason: verifyReason(t, head, branch) });
    // PLA-I60: a run already on this ticket takes the request too (its reason, or one retry after it ends).
    wake = out.kind === "queued" || out.reason === "coalesced" ? "queued" : out.reason;
    await emit("note", { id: t.id, key: t.key }, { text: w.note(head ? head.slice(0, 7) : null) });
  });
  if (wake !== "queued") {
    const hint = /paused/.test(wake)
      ? w.paused
      : /coalesced/.test(wake)
        ? w.busy(whoWord(roleOf(owner) ?? owner.role))
        : w.notWoken(wake);
    return { error: "NOT_WOKEN", hint };
  }
  return { ok: true, wake, role: roleOf(owner) ?? owner.role };
}
