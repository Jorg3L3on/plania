// PLA-I30-6/7: the two actions on a project sheet, on the cookie-only company routes (src/api/company.ts).
//   POST /api/company/projects/:slug/ask  {text}  Pedirle al PO: a Ready ticket owned by po-<slug>, origin owner.
//        The event hook (src/runner/events.ts) queues the PO's wake in the same write.
//   POST /api/company/projects/:slug/wake         Despertar ahora: one wake of po-<slug> through wakeAgent,
//        only when the PO has Ready work in this project; otherwise {woke: false, reason: "idle"} and no run.
// Both refuse a paused project or company, and a project without a runner PO, with 409 and a reason.
// PLA-I54-1: ask takes {mode: forma | ya}: forma (default) is an idea the PO shapes in the floor's tube; ya is below.
// PLA-I36-6/8: ask takes {kind: cambio | direccion | idea, now}; now wakes the PO at once (only when it has
//   Ready work, which the new ticket is). The ticket's scope asks the PO for a plan through `propose`.
//   POST /api/company/projects/:slug/next {key}       Cambiar lo siguiente: that Ready ticket goes first.
//   PUT  /api/company/projects/:slug/options {plan_approval?, preview_url?}
import { and, eq, inArray, sql } from "drizzle-orm";
import { ownerName } from "../owner.js";
import { defineWords, say } from "../words.js";
import { placeEn } from "./places.js";
import type { Db } from "../db/client.js";
import { agentRuns, agents, projects, tasks, type Agent } from "../db/schema.js";
import { loadReady, pickReady, wakeAgent, type HeartbeatDeps } from "../jobs/heartbeat.js";
import { WEB_ACTOR } from "../mcp/tx.js";
import { createTask } from "../mcp/writes.js";
import { setProject } from "../mcp/project.js";
import { createPoIdea } from "./company-pedidos.js";
import { answerNote, askConsulta } from "../pedidos/consultas.js";
import { eventWakesEnabled, queueWake } from "../runner/events.js";
import { loadSettings, roleOf } from "../runner/limits.js";
import { startNow } from "../runner/runner.js";
import { ACTIVE_STATUSES, workKeyOf } from "../runner/queue.js";
import { teamOf } from "../runner/team.js";
import { ownerEs } from "../owner.js";
import { ST } from "../state/status.js";

export type ActionRefusal = { error: "PROJECT_NOT_FOUND" | "PROJECT_PAUSED" | "COMPANY_PAUSED" | "NO_PO"; status: 404 | 409; hint: string };

// PLA-I32-2: the PO of a project is the runner agent on its team (project_id) made from the product-owner
// template; a row from before 0041 is still found by po-<slug> or a capability naming the project.
export async function projectPo(db: Db, project: { id: string; slug: string }): Promise<Agent | null> {
  const rows = await db.select().from(agents).where(and(eq(agents.adapter, "claude_code"), sql`${agents.status} <> 'retired'`));
  const pos = rows.filter((a) => roleOf(a) === "product-owner");
  return (
    pos.find((a) => a.projectId === project.id) ??
    pos.find((a) => !a.projectId && (a.slug === `po-${project.slug}` || a.capabilities.includes(project.slug))) ??
    null
  );
}

// PLA-I2-10: the refusals and summaries the owner reads from a sheet's actions, in the install's language; the Spanish
// is unchanged.
export const ACTION_WORDS = defineWords({
  es: {
    companyPaused: "La compañía está detenida.",
    projectPaused: "El proyecto está en pausa: reanúdalo primero.",
    noPo: "Este proyecto no tiene un PO que corra en Claude Code.",
    noTicket: "Ese ticket no está en el proyecto.",
    notReady: "Solo un ticket listo puede ir primero.",
    idle: "Sin trabajo para el PO: pídele algo.",
    noTeammate: "Ese compañero no está en el equipo de este proyecto.",
    notReadyStep: (key: string) => `${key} ya no está lista para empezar: bloqueada, en espera o ya tomada.`,
    noOrder: "Ese pedido no está.",
    orderTaken: "Ese pedido ya no espera a nadie.",
  },
  en: {
    companyPaused: "The company is stopped.",
    projectPaused: "The project is paused: resume it first.",
    noPo: "This project has no PO that runs in Claude Code.",
    noTicket: "That ticket is not in the project.",
    notReady: "Only a ready ticket can go first.",
    idle: "No work for the PO: ask it for something.",
    noTeammate: "That teammate is not on this project's team.",
    notReadyStep: (key: string) => `${key} is no longer ready to start: blocked, on hold or already taken.`,
    noOrder: "That request is not here.",
    orderTaken: "That request no longer waits on anyone.",
  },
});

type Guard = { project: { id: string; slug: string }; po: Agent };

async function guard(db: Db, slug: string): Promise<Guard | ActionRefusal> {
  const [project] = await db.select({ id: projects.id, slug: projects.slug, paused: projects.runsPaused }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!project) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  if ((await loadSettings(db)).companyPaused) return { error: "COMPANY_PAUSED", status: 409, hint: say(ACTION_WORDS).companyPaused };
  if (project.paused) return { error: "PROJECT_PAUSED", status: 409, hint: say(ACTION_WORDS).projectPaused };
  const po = await projectPo(db, project);
  if (!po) return { error: "NO_PO", status: 409, hint: say(ACTION_WORDS).noPo };
  return { project: { id: project.id, slug: project.slug }, po };
}

export const firstLine = (text: string) => {
  const line = text.trim().split("\n")[0]!.trim();
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
};

export type OrderKind = "cambio" | "direccion" | "idea";
const KIND_WORD: Record<OrderKind, string> = { cambio: "un cambio", direccion: "una dirección", idea: "una idea" };
const KIND_WORD_EN: Record<OrderKind, string> = { cambio: "a change", direccion: "a direction", idea: "an idea" };

// PLA-I2-10: the order's scope in the install's language; the Spanish is unchanged. The owner's words are also the
// task's owner_words field, so nothing parses this line back (orderText reads the field).
export const ORDER_WORDS = defineWords({
  es: {
    scope: (sentence: string, from: string, kind: OrderKind | null, approval: boolean) =>
      [
        `Pedido ${ownerEs("de")} desde ${from}${kind ? ` (${KIND_WORD[kind]})` : ""}: "${sentence}"`,
        "",
        "Para el PO: escribe el alcance real y los checks de este ticket antes de empezar, y una nota `Entendí: …` con lo que entendiste en una línea.",
        approval
          ? `Este proyecto aprueba planes: no crees tickets para Taller. Propón el plan con \`propose\` (kind plan, order: la clave de este ticket): lo que entendiste, los pasos con lo que significa hecho y el costo. Plania crea los tickets cuando alguien diga "Sí, empiecen".`
          : "Si es trabajo de PO (docs, plan, ideas), hazlo aquí. Si hace falta código, propón el plan con `propose` (kind plan) o crea tickets Listos para Taller, y cierra este con lo que dejaste.",
      ].join("\n"),
    check: "El PO reescribió alcance y checks, y lo hizo o lo partió en tickets para Taller",
  },
  en: {
    scope: (sentence: string, from: string, kind: OrderKind | null, approval: boolean) =>
      [
        `Request from ${ownerName("en")} via ${placeEn(from)}${kind ? ` (${KIND_WORD_EN[kind]})` : ""}: "${sentence}"`,
        "",
        "For the PO: write this ticket's real scope and checks before you start, and a note `Understood: …` with what you understood, in one line.",
        approval
          ? `This project approves plans: do not create tickets for Taller. Propose the plan with \`propose\` (kind plan, order: this ticket's key): what you understood, the steps with what done means, and the cost. Plania creates the tickets when someone says "Yes, go ahead".`
          : "If it is PO work (docs, plan, ideas), do it here. If it needs code, propose the plan with `propose` (kind plan) or create Ready tickets for Taller, and close this one with what you left.",
      ].join("\n"),
    check: "The PO rewrote scope and checks, and did it or split it into tickets for Taller",
  },
});
// PLA-I54-1: mode forma makes an idea for the PO to shape (company-pedidos.ts); ya is the Ready ticket plus the wake.
export type AskMode = "forma" | "ya" | "pregunta";
// PLA-I57-1: mode pregunta keeps a question (consulta) and creates no task: key is "" and consulta is its id.
export type AskResult = { key: string; title: string; po: string; mode: AskMode; wake: "queued" | "busy" | "off"; woke: WakeOutcome | null; consulta?: string };

// A Ready ticket owned by the project's PO, origin owner; the event hook queues the PO's wake in the same
// write. wake says what happened: queued (on this ticket), busy (the PO already has a run), off (no wakes).
export async function createPoTicket(
  db: Db,
  project: { slug: string },
  po: Agent,
  text: string,
  from = "Compañía",
  kind: OrderKind | null = null,
): Promise<{ key: string; title: string; wake: "queued" | "busy" | "off" }> {
  const sentence = text.trim();
  const [proj] = await db.select({ settings: projects.settings }).from(projects).where(eq(projects.slug, project.slug)).limit(1);
  const approval = !!proj?.settings.plan_approval;
  const out = (await createTask(
    db,
    {
      project: project.slug,
      title: firstLine(sentence),
      status: ST.ready,
      origin: "owner",
      work_type: "ops",
      priority: "P2",
      owner_agent: po.slug,
      owner_words: sentence,
      scope: say(ORDER_WORDS).scope(sentence, from, kind, approval),
      checks: [say(ORDER_WORDS).check],
    },
    { actor: WEB_ACTOR, human: true, tool: "company.ask" },
  )) as { key: string };
  // PLA-I60-1: the event hook queued a run on this ticket's work key unless the PO already had one there.
  const [run] = await db
    .select({ id: agentRuns.id, taskKey: agentRuns.taskKey })
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, po.id), inArray(agentRuns.status, [...ACTIVE_STATUSES])))
    .orderBy(sql`(${agentRuns.workKey} = ${workKeyOf(out.key)}) desc`)
    .limit(1);
  const wake = !eventWakesEnabled() ? "off" : run?.taskKey === out.key ? "queued" : run ? "busy" : "off";
  return { key: out.key, title: firstLine(sentence), wake };
}

// PLA-I54-1: mode forma creates an idea and wakes the PO on it (company-pedidos.ts); ya is the ticket with the wake at
// once (what «Que empiece ya» did). Without a mode it is the ticket as before, woken only with now. On the route a body
// with neither mode nor now (the new side page always sends a mode) is forma; an old client's {now} keeps its ticket.
export const askMode = (input: { mode?: AskMode; now?: boolean }): AskMode | undefined => input.mode ?? (input.now === undefined ? "forma" : undefined);

export async function askPo(db: Db, slug: string, text: string, opts: { kind?: OrderKind; now?: boolean; mode?: AskMode; consulta?: string } = {}, deps?: HeartbeatDeps): Promise<AskResult | ActionRefusal> {
  const g = await guard(db, slug);
  if ("error" in g) return g;
  if (opts.mode === "pregunta") {
    const made = await askConsulta(db, g.project, g.po, text);
    return { key: "", title: firstLine(text), po: g.po.slug, mode: "pregunta", wake: made.wake, woke: null, consulta: made.id };
  }
  // PLA-I57-1: «Pedirlo» from an answer: the answer travels with the request.
  const note = opts.consulta ? await answerNote(db, g.project.id, opts.consulta) : null;
  if (note) text = `${text}\n\n---\n${note}`.slice(0, 3800);
  if (opts.mode === "forma") {
    const made = await createPoIdea(db, g.project.slug, g.po, text);
    return { key: made.key, title: made.title, po: g.po.slug, mode: "forma", wake: made.wake, woke: null };
  }
  const made = await createPoTicket(db, g.project, g.po, text, "Compañía", opts.kind ?? null);
  // NEWPROJ-5: the answer leaves as soon as the ticket exists. Starting the PO's run (a worktree, the prompt, the
  // process) took eleven seconds in the new-project trial, and a run that cannot start ends on its own run row, which
  // the step's row on the project page reads. The wake itself is the same call as before, only not awaited here.
  const woke: WakeOutcome | null = opts.now || opts.mode === "ya" ? { woke: false, reason: "starting", ticket: made.key, summary: "" } : null;
  if (woke) wakeInBackground(wakePo(db, slug, deps), slug);
  return { key: made.key, title: made.title, po: g.po.slug, mode: "ya", wake: made.wake, woke };
}

// NEWPROJ-5: the wakes askPo started and did not wait for. Tests wait on them before they read the run rows.
const askWakes = new Set<Promise<unknown>>();
function wakeInBackground(p: Promise<unknown>, slug: string): void {
  const w = p.catch((e) => console.log(`[ask] ${slug}: the PO's wake failed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`)).finally(() => askWakes.delete(w));
  askWakes.add(w);
}
export async function waitForAskWakes(): Promise<void> {
  while (askWakes.size) await Promise.all([...askWakes]);
}

// PLA-I36-6: Cambiar lo siguiente. The ticket must be Ready in this project.
export async function pickNext(db: Db, slug: string, key: string): Promise<{ next: string } | { error: string; status: 404 | 409; hint: string }> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  const [t] = await db.select({ status: tasks.status, kind: tasks.kind }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  if (!t || t.kind !== "ticket") return { error: "TASK_NOT_FOUND", status: 404, hint: say(ACTION_WORDS).noTicket };
  if (t.status !== ST.ready) return { error: "NOT_READY", status: 409, hint: say(ACTION_WORDS).notReady };
  await db.update(projects).set({ settings: { ...p.settings, next_first: key }, updatedAt: sql`now()` }).where(eq(projects.id, p.id));
  return { next: key };
}

// PLA-I36-8/10: the project's switches that are not limits: plan approval and the preview address.
export async function setProjectOptions(db: Db, slug: string, input: { plan_approval?: boolean; preview_url?: string | null; auto_accept?: boolean; auto_accept_invisible?: boolean }): Promise<{ plan_approval: boolean; preview_url: string | null; auto_accept: boolean; auto_accept_invisible: boolean } | { error: string; status: 404; hint: string }> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  // PLA-I2-6: written through set_project, so these keys are validated, logged and refreshed like the rest. The
  // switches have no version on screen: they write over the version just read.
  const patch: Record<string, unknown> = {};
  if (input.plan_approval !== undefined) patch.plan_approval = input.plan_approval;
  if (input.preview_url !== undefined) patch.preview_url = input.preview_url || null;
  if (input.auto_accept !== undefined) patch.auto_accept = input.auto_accept;
  if (input.auto_accept_invisible !== undefined) patch.auto_accept_invisible = input.auto_accept_invisible;
  const out = Object.keys(patch).length ? await setProject(db, { project: slug, version: p.version, settings: patch }, { actor: WEB_ACTOR, human: true, tool: "screen.options" }) : null;
  const settings = (out?.settings ?? p.settings) as typeof p.settings;
  return { plan_approval: !!settings.plan_approval, preview_url: settings.preview_url ?? null, auto_accept: !!settings.auto_accept, auto_accept_invisible: !!settings.auto_accept_invisible };
}

export type WakeOutcome = { woke: boolean; reason: string; ticket: string | null; summary: string };

export async function wakePo(db: Db, slug: string, deps?: HeartbeatDeps): Promise<WakeOutcome | ActionRefusal> {
  const g = await guard(db, slug);
  if ("error" in g) return g;
  const work = pickReady(g.po, (await loadReady(db)).filter((r) => r.project === g.project.slug));
  if (!work) return { woke: false, reason: "idle", ticket: null, summary: say(ACTION_WORDS).idle };
  const out = await wakeAgent(db, { agent: g.po.slug, taskKey: work.key }, deps);
  return { woke: out.woke, reason: out.reason, ticket: out.run?.task_key ?? work.key, summary: out.run?.summary ?? "" };
}

// PLA-I40-2: Que empiece ya. One teammate's next run starts now: its queued run, else one on its Ready work.
// The rest between runs is skipped once; past_guard also lets it past the plan guard this once. A paused
// company or project refuses, as do the goal, the base branch and the cap (a full cap leaves it queued).
export type StartNowResult = { started: boolean; reason: "started" | "queued" | "busy" | "idle" | "held" | "fail"; ticket: string | null; run_id: string | null; summary: string };
export type StartRefusal = { error: "PROJECT_NOT_FOUND" | "PROJECT_PAUSED" | "COMPANY_PAUSED" | "AGENT_NOT_FOUND" | "NOT_READY"; status: 404 | 409; hint: string };

// PLA-I49-5: reason, when given, is what the bot reads under "Why you woke" (a screen wake had none).
export async function startTeammateNow(db: Db, slug: string, agentSlug: string, opts: { past_guard?: boolean; now?: Date; reason?: string; key?: string } = {}, deps?: HeartbeatDeps): Promise<StartNowResult | StartRefusal> {
  const [project] = await db.select({ id: projects.id, slug: projects.slug, paused: projects.runsPaused }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!project) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  if ((await loadSettings(db)).companyPaused) return { error: "COMPANY_PAUSED", status: 409, hint: say(ACTION_WORDS).companyPaused };
  if (project.paused) return { error: "PROJECT_PAUSED", status: 409, hint: say(ACTION_WORDS).projectPaused };
  const agent = (await teamOf(db, project.id)).find((a) => a.slug === agentSlug);
  if (!agent) return { error: "AGENT_NOT_FOUND", status: 404, hint: say(ACTION_WORDS).noTeammate };
  const ready = (await loadReady(db)).filter((r) => r.project === project.slug);
  // PLA-165: the step the owner pressed «Que empiece ya» on, when the screen names it; never another one in its place.
  const work = opts.key ? pickReady({ ...agent, projectSlug: project.slug }, ready.filter((r) => r.key === opts.key)) : pickReady({ ...agent, projectSlug: project.slug }, ready);
  if (opts.key && !work) return { error: "NOT_READY", status: 409, hint: say(ACTION_WORDS).notReadyStep(opts.key) };
  const out = await startNow(db, { agent, task: work, pastGuard: opts.past_guard, now: opts.now ?? new Date(), reason: opts.reason }, deps?.runner);
  const base = { started: out.kind === "started", reason: out.kind, summary: "summary" in out ? out.summary : "" };
  return "runId" in out ? { ...base, ticket: out.taskKey, run_id: out.runId } : { ...base, ticket: null, run_id: null };
}

// PLA-I40-6: Reenviar. A request of the owner's that nobody took gets its PO's wake queued again.
export async function resendRequest(db: Db, slug: string, key: string): Promise<{ key: string; wake: "queued" | "busy" | "off" } | { error: string; status: 404 | 409; hint: string }> {
  const g = await guard(db, slug);
  if ("error" in g) return g;
  const [t] = await db.select().from(tasks).where(and(eq(tasks.projectId, g.project.id), eq(tasks.key, key))).limit(1);
  if (!t || t.origin !== "owner") return { error: "ORDER_NOT_FOUND", status: 404, hint: say(ACTION_WORDS).noOrder };
  if (t.status !== ST.ready) return { error: "NOT_READY", status: 409, hint: say(ACTION_WORDS).orderTaken };
  if (!eventWakesEnabled()) return { key, wake: "off" };
  const out = await queueWake(db, g.project, { id: t.id, key: t.key }, { agent: g.po, taskKey: t.key, reason: "request resent" }, "screen.resend");
  return { key, wake: out.kind === "queued" ? "queued" : "busy" };
}
