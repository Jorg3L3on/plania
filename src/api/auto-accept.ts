// PLA-I40-7: accepting a delivery without the owner. A project switch (settings.auto_accept), off unless he turns
// it on. With it on, a delivery a teammate made is accepted on the heartbeat tick when every one of these holds:
//   - it is a PR on a ticket In review, and nothing the screen would hold it for applies (no open check, CI not
//     red or still running, the last result not failing);
//   - no check on the ticket was waived;
//   - its latest result is a pass, and a pass stands on the PR's current head;
//   - the PR's base is the test copy (MERGE_BASE), so never main or a release target.
// Accepting is the screen's own merge (thread-actions.ts), recorded as pr.merged with by: "auto" and the evidence
// id. Anything else waits for the owner as before, and autoVerdict says why in one short sentence.
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { checks, events, projects, pullRequests, tasks, threadMessages, type Project } from "../db/schema.js";
import { loadSettings } from "../runner/limits.js";
import { resolveThread } from "../runner/threads.js";
import { decisionsRead, passOnHead, type Decision } from "./company-decisions.js";
import { stackHold } from "../runner/stack.js";
import { velocidadOf } from "../runner/velocidad.js";
import { defaultGit, repoPathOf, type GitFn } from "../runner/worktree.js";
import { readAt, riesgoOf } from "./riesgo.js";
import { startBranchOf } from "../runner/start-branch.js";
import { threadAction } from "./thread-actions.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: why a delivery was not accepted by itself, in the install's language; the Spanish is unchanged.
export const AUTO_ACCEPT_WORDS = defineWords({
  es: {
    notAPr: "Solo una entrega con PR se acepta sola.",
    notTeam: "No la entregó alguien del equipo.",
    notInReview: "La entrega ya no está en revisión.",
    visible: "Cambia lo que se ve: revísala tú.",
    unknownVisible: "No se sabe si cambia la pantalla: revísala tú.",
    waived: "Tiene un punto exento: revísala tú.",
    noPass: "Faltan pruebas que pasen.",
    noPr: "Todavía no se lee el PR.",
    prClosed: "El PR ya no está abierto.",
    wrongBase: "El PR no va a la rama de trabajo.",
    noPassOnHead: "Falta una prueba que pase en el último commit.",
    stackFirst: (title: string) => `Espera a que entre «${title}», que va debajo.`,
  },
  en: {
    notAPr: "Only a delivery with a PR is accepted by itself.",
    notTeam: "It was not delivered by someone on the team.",
    notInReview: "The delivery is no longer in review.",
    visible: "It changes what you see: review it yourself.",
    unknownVisible: "It is unknown whether it changes the screen: review it yourself.",
    waived: "It has a waived check: review it yourself.",
    noPass: "Passing tests are missing.",
    noPr: "The PR cannot be read yet.",
    prClosed: "The PR is no longer open.",
    wrongBase: "The PR does not go to the working branch.",
    noPassOnHead: "A passing test on the latest commit is missing.",
    stackFirst: (title: string) => `Waits for «${title}», which goes under it, to land.`,
  },
});

const UUID = /^m-([0-9a-f-]{36})$/;
const pending = (d: Decision) => d.state === null && d.actions.some((a) => a === "fusionar" || a === "aceptar");

// null: it would be accepted now. Otherwise why not, for the floor.
export async function autoVerdict(db: Db, p: Project, d: Decision, deps: { git?: GitFn } = {}): Promise<string | null> {
  const w = say(AUTO_ACCEPT_WORDS);
  const id = UUID.exec(d.id)?.[1];
  if (d.kind !== "pr" || !id) return w.notAPr;
  if (!d.asker) return w.notTeam;
  if (d.hold) return d.hold;
  const [msg] = await db.select().from(threadMessages).where(eq(threadMessages.id, id)).limit(1);
  const key = msg?.links.find((l) => l.kind === "ticket")?.ref;
  const [t] = key ? await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1) : [];
  if (!msg || !t || t.status !== "In review") return w.notInReview;
  const under = await stackHold(db, t.id);
  if (under) return w.stackFirst(under.title);
  // PLA-I52-7: with only «solo lo que no se ve» on, a delivery that changes the screen (or that finish could not
  // classify) waits for the owner.
  // PLA-I73-3: with one review per module, a visible change is accepted on its photos (the owner sees every step's
  // before and after at Publicar); a risky one still waits.
  const modulo = velocidadOf(p.settings).revision === "por_modulo";
  if (!p.settings.auto_accept && !modulo && t.cambio !== "no_se_ve") return t.cambio ? w.visible : w.unknownVisible;
  if (modulo && !p.settings.auto_accept) {
    if (t.cambio !== "no_se_ve" && !t.muestra) return t.cambio ? w.visible : w.unknownVisible;
    const files = await touchedFiles(db, t.id);
    const branch = t.branch ?? t.workspace?.branch ?? null;
    const risk = await riesgoOf(files, branch ? readAt(deps.git ?? defaultGit, repoPathOf(p.slug, p.settings), branch) : async () => null);
    if (risk) return risk.reason;
  }
  const [waived] = await db.select({ n: sql<number>`count(*)::int` }).from(checks).where(and(eq(checks.taskId, t.id), isNotNull(checks.waivedAt)));
  if (Number(waived?.n ?? 0) > 0) return w.waived;
  if (d.evidence?.verdict !== "pass" || (d.evidence.fail ?? 0) > 0) return w.noPass;
  const url = msg.links.find((l) => l.kind === "pr")?.ref ?? t.prUrl;
  const [pr] = url ? await db.select().from(pullRequests).where(eq(pullRequests.url, url)).orderBy(desc(pullRequests.updatedAt)).limit(1) : [];
  if (!pr) return w.noPr;
  if (pr.state !== "open") return w.prClosed;
  // PLA-I2-5: the project's start branch, never a branch name on the screen.
  if (pr.baseBranch !== startBranchOf(p.settings)) return w.wrongBase;
  if (!(await passOnHead(db, t, pr.headSha, pr.headBranch))) return w.noPassOnHead;
  return null;
}

// What the floor shows under the switch: whether it is on, and why the oldest waiting delivery was not accepted.
export type AutoAccept = { on: boolean; hold: string | null; invisible?: boolean };
export async function autoAcceptOf(db: Db, p: Project, decisions: Decision[]): Promise<AutoAccept> {
  const on = !!p.settings.auto_accept;
  const invisible = !!p.settings.auto_accept_invisible;
  const modulo = velocidadOf(p.settings).revision === "por_modulo";
  if (!on && !invisible && !modulo) return { on, hold: null };
  const d = decisions.filter((x) => x.project === p.slug && x.kind === "pr" && pending(x)).sort((a, b) => a.at.localeCompare(b.at))[0];
  return { on, hold: d ? await autoVerdict(db, p, d) : null, ...(invisible ? { invisible } : {}) };
}

// One pass over the projects with the switch on. Called from the heartbeat tick; never throws for one delivery.
export async function sweepAutoAccept(db: Db, now = new Date()): Promise<{ accepted: string[]; held: { ref: string | null; reason: string }[] }> {
  const out = { accepted: [] as string[], held: [] as { ref: string | null; reason: string }[] };
  if ((await loadSettings(db)).companyPaused) return out;
  const on = (await db.select().from(projects)).filter((p) => (p.settings.auto_accept || p.settings.auto_accept_invisible || velocidadOf(p.settings).revision === "por_modulo") && !p.runsPaused);
  if (on.length === 0) return out;
  const decisions = await decisionsRead(db, now);
  for (const p of on) {
    for (const d of decisions.filter((x) => x.project === p.slug && x.kind === "pr" && pending(x))) {
      const why = await autoVerdict(db, p, d);
      if (why) {
        out.held.push({ ref: d.ref, reason: why });
        continue;
      }
      try {
        const res = await threadAction(db, await resolveThread(db, p.slug), { message_id: UUID.exec(d.id)![1]!, action: "fusionar" }, "auto");
        if ("error" in res) out.held.push({ ref: d.ref, reason: res.hint });
        else if (d.ref) out.accepted.push(d.ref);
      } catch (e) {
        out.held.push({ ref: d.ref, reason: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return out;
}

// PLA-I73-3: every file a delivery touched, from the runner's task.areas_touched events.
async function touchedFiles(db: Db, taskId: string): Promise<string[]> {
  const rows = await db.select({ payload: events.payload }).from(events).where(and(eq(events.taskId, taskId), eq(events.type, "task.areas_touched")));
  return [...new Set(rows.flatMap((r) => ((r.payload as { files?: unknown }).files as string[] | undefined) ?? []))];
}
