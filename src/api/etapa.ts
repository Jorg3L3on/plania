// PLA-I53-2: one stage per ticket (la etapa), computed in one place so the floor (GET /api/company) and the project
// page (GET /api/projects/:slug) say the same thing about where a ticket is and who has it. No migration: every
// fact below already exists.
//   etapaOf       pure: one ticket's facts → {etapa, qa, holder, live, since, ci, reason}
//   projectEtapas reads the facts of every ticket of one project in a fixed number of queries (none per ticket)
//   ahoraOf       the tickets someone works on now: construyendo, en_qa while QA runs, devuelto
//
// The rules, first match wins (Design doc of PLA-I53; the initiative's table where the doc says nothing):
//   Done → hecho · Released → publicado · Merged → integrado · Won't do → null (no stage)
//   Needs owner → te_toca
//   Blocked → en_espera when only unfinished tickets hold it, else bloqueado (reason: blocked_note, else the blocker)
//   In review →
//     a QA run is running, or the latest QA lane is checking/reviewing → en_qa running
//     QA applies (the project has QA and the ticket is code/bug/debt) and there is no lane, the lane is queued, or
//       the lane saw an older commit than the PR head → en_qa queued (qaGate's "pending")
//     latest lane fail: returned, or a first attempt (QA sends it back itself) → devuelto; a later attempt → te_toca
//       ("revísala tú", qaGate's hold) · latest lane error → te_toca
//     PR merged → integrado (the poller has not moved the ticket yet)
//     PR open with CI pending or failure → en_revision (ci says which)
//     the latest delivery message for the ticket waits on the owner (no action yet) → te_toca; while El Probador
//       still takes its pictures (PLA-52: the card is not raised yet) → en_revision
//     else → en_revision (PR green or no PR, nothing posted to the owner yet)
//   Any other open status with a sent-back delivery (the latest delivery message was answered «cambios», by the owner's
//     Pedir cambios or QA's return, or the latest QA lane is fail + returned) → devuelto while it is Ready or someone
//     holds it; In progress with nobody holding it stays sin_dueno
//   In progress, or Ready/Backlog with a running run on it → construyendo when a run runs or the lease is live
//   In progress with nobody → sin_dueno
//   Ready → bloqueado (an open typed blocker) · en_espera (an unfinished ticket blocker) · lista
//   Backlog → pospuesto when the ticket is in the leg in course (routeOf's «here», the same rule La fila uses for
//     «Pospuesto a propósito») or its initiative is On hold; else despues. Ready under an On hold initiative → pospuesto.
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, blockers, envStates, pullRequests, qaLanes, taskAliases, taskBlockers, tasks, threadMessages, threads, type Actor, type Project } from "../db/schema.js";
import { SETTLED_STATUSES, typedBlockerOpen } from "../mcp/blockers.js";
import { roleOf } from "../runner/limits.js";
import { qaAgentOf, qaTicket, sameCommit } from "../runner/qa.js";
import { probadorGate } from "../captures/probador.js";
import { OWNER_AUTHOR } from "../runner/threads.js";
import { byKey } from "./company-plan.js";
import { zonasOf, type Zona } from "./zonas.js";
import { failReason, startFailureOf } from "../runner/start-failures.js";
import { SIGNED_OUT } from "../runner/signed-out.js";
import { defineWords, say } from "../words.js";
import { isRunSession, sessionsOf } from "../runner/run-session.js";
import { projectTurns } from "../state/turn-facts.js";
import type { TurnOrNobody } from "../state/turn.js";

export const ETAPAS = ["despues", "lista", "en_espera", "pospuesto", "bloqueado", "construyendo", "devuelto", "sin_dueno", "en_qa", "en_revision", "te_toca", "integrado", "publicado", "hecho"] as const;
export type EtapaId = (typeof ETAPAS)[number];
export type Ci = "pending" | "success" | "failure" | "none";
export type Holder = { agent: string; role: string };
export type Etapa = {
  etapa: EtapaId;
  // Only on en_qa: whether QA is running on it now or it waits in QA's queue.
  qa: "queued" | "running" | null;
  // Who has it: the run or the live lease (construyendo, devuelto, en_qa running), the owner (te_toca), whoever fixes
  // it (devuelto with nobody on it yet), QA (en_qa queued); null where nobody has it (lista, sin_dueno, hecho…).
  holder: Holder | null;
  // True only while a run runs on it or its lease is live: someone works on it this minute.
  live: boolean;
  // ISO time the ticket entered this stage (run start, lease claim, lane start, status change), null when unknown.
  since: string | null;
  // The ticket's PR checks, null when it has no PR.
  ci: Ci | null;
  // One sentence in Spanish when the stage needs a why (bloqueado, en_espera, devuelto, sin_dueno, te_toca…).
  reason: string | null;
};

const OPEN_INITIATIVE = ["Planning", "Active", "Shipping", "On hold"];
const QA_RUNNING = ["checking", "reviewing"];

export type EtapaFacts = {
  status: string;
  statusChangedAt: Date | null;
  // Whose the ticket is when nobody holds it: its owner agent, else code → taller, else product-owner (routeOf's rule).
  owner: Holder;
  lease: { holder: Holder; since: Date | null; until: Date | null } | null;
  // A running agent_run on this ticket.
  run: { holder: Holder; since: Date | null } | null;
  qa: {
    applies: boolean;
    lane: { status: string; returned: boolean; attempt: number; commit: string | null; createdAt: Date; startedAt: Date | null; endedAt: Date | null } | null;
  };
  pr: { state: string; ci: string | null; head: string | null } | null;
  // Titles of the unfinished tickets it waits on (blocker not In review or later).
  waitsOn: string[];
  // The text of an open typed blocker (human action, env, flag, time, metric), null when none holds it.
  held: string | null;
  blockedNote: string | null;
  postponed: boolean;
  // The latest delivery message that links this ticket: answered «cambios» (sent back), or still waiting (open).
  delivery: { returned: boolean; open: boolean; at: Date } | null;
  // PLA-52: El Probador has not finished the delivery's pictures (probadorGate, the rule the delivery card reads).
  photos?: boolean;
  // PLA-158 (F-27): what that pass waits on (probador.waiting), so the board line says it instead of only «toma las fotos».
  photosWaiting?: string | null;
};

// PLA-I2-10: each stage's reason in the install's language; the Spanish is unchanged.
export const ETAPA_WORDS = defineWords({
  es: {
    quote: (s: string) => `«${s}»`,
    needsDecision: "Necesita tu decisión.",
    waitsFor: (q: string) => `Espera a ${q}`,
    qaQueued: "En la cola de QA.",
    qaReturned: "QA encontró fallas y la devolvió.",
    qaAgain: "QA encontró fallas otra vez: revísala tú.",
    qaError: "QA no pudo terminar: revísala tú.",
    ciFail: "Las pruebas del PR fallan.",
    ciRun: "Las pruebas del PR corren.",
    photos: "Plania toma las fotos de la entrega.",
    delivered: "Entregada: espera que la aceptes.",
    prClosed: "El PR se cerró sin fusionar.",
    returnedLapsed: "La devolvieron y nadie la está arreglando: la reserva venció.",
    nobody: "Nadie la tiene: la reserva venció y no corre ningún paso.",
    returned: "La devolvieron: espera que la arreglen.",
    postponed: "Pospuesto a propósito.",
    backlog: "Está en Backlog: nadie la pasó a Lista.",
    humanAction: "Espera una acción tuya.",
    until: (at: string) => `Espera hasta ${at}`,
    env: (env: string, cond: string, value: string) => `Espera a ${env}: ${cond} ${value}`,
    envFlag: (flag: string, env: string) => `Espera la bandera ${flag} en ${env}`,
    metric: (name: string, value: string) => `Espera que ${name} llegue a ${value}`,
    blocked: "Bloqueado.",
  },
  en: {
    quote: (s: string) => `“${s}”`,
    needsDecision: "Needs your decision.",
    waitsFor: (q: string) => `Waits for ${q}`,
    qaQueued: "In the QA queue.",
    qaReturned: "QA found failures and sent it back.",
    qaAgain: "QA found failures again: review it yourself.",
    qaError: "QA could not finish: review it yourself.",
    ciFail: "The PR's tests fail.",
    ciRun: "The PR's tests are running.",
    photos: "Plania is taking the delivery's pictures.",
    delivered: "Delivered: waits for you to accept it.",
    prClosed: "The PR was closed without merging.",
    returnedLapsed: "It was sent back and nobody is fixing it: the hold expired.",
    nobody: "Nobody has it: the hold expired and no step is running.",
    returned: "It was sent back: waits to be fixed.",
    postponed: "Postponed on purpose.",
    backlog: "It is in Backlog: nobody moved it to Ready.",
    humanAction: "Waits for an action of yours.",
    until: (at: string) => `Waits until ${at}`,
    env: (env: string, cond: string, value: string) => `Waits for ${env}: ${cond} ${value}`,
    envFlag: (flag: string, env: string) => `Waits for the flag ${flag} in ${env}`,
    metric: (name: string, value: string) => `Waits for ${name} to reach ${value}`,
    blocked: "Blocked.",
  },
});
const ew = () => say(ETAPA_WORDS);

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const quoted = (s: string, n = 60) => ew().quote(s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const ciOf = (pr: EtapaFacts["pr"]): Ci | null => {
  if (!pr) return null;
  const c = pr.ci;
  return c === "pending" || c === "success" || c === "failure" || c === "none" ? c : "none";
};

// Pure: the stage of one ticket. Won't do has none (null).
export function etapaOf(f: EtapaFacts, now: Date): Etapa | null {
  const ci = ciOf(f.pr);
  const at = iso(f.statusChangedAt);
  const make = (etapa: EtapaId, rest: Partial<Etapa> = {}): Etapa => ({ etapa, qa: null, holder: null, live: false, since: at, ci, reason: null, ...rest });
  const leaseLive = !!f.lease && !!f.lease.until && f.lease.until.getTime() > now.getTime();
  // Who works on it this minute: a running run first, then the live lease.
  const worker = f.run ? { holder: f.run.holder, since: iso(f.run.since) ?? at } : leaseLive ? { holder: f.lease!.holder, since: iso(f.lease!.since) ?? at } : null;
  const lane = f.qa.lane;

  switch (f.status) {
    case "Done":
      return make("hecho");
    case "Released":
      return make("publicado");
    case "Merged":
      return make("integrado");
    case "Won't do":
      return null;
    case "Needs owner":
      return make("te_toca", { holder: { ...OWNER_AUTHOR }, reason: ew().needsDecision });
    case "Blocked":
      if (!f.held && f.waitsOn.length > 0) return make("en_espera", { reason: ew().waitsFor(quoted(f.waitsOn[0]!)) });
      return make("bloqueado", { reason: f.blockedNote || f.held || (f.waitsOn[0] ? ew().waitsFor(quoted(f.waitsOn[0])) : null) });
    case "In review": {
      if ((f.run && f.run.holder.role === "qa") || (lane && QA_RUNNING.includes(lane.status))) {
        return make("en_qa", { qa: "running", holder: f.run?.holder ?? { agent: "qa", role: "qa" }, live: true, since: iso(f.run?.since ?? lane?.startedAt ?? lane?.createdAt) ?? at });
      }
      const stale = !!lane && !!f.pr?.head && !!lane.commit && !sameCommit(f.pr.head, lane.commit);
      if (f.qa.applies && (!lane || lane.status === "queued" || stale)) {
        return make("en_qa", { qa: "queued", holder: { agent: "qa", role: "qa" }, since: iso(lane && !stale ? lane.createdAt : null) ?? at, reason: ew().qaQueued });
      }
      if (lane?.status === "fail") {
        if (lane.returned || lane.attempt === 1) return make("devuelto", { holder: worker?.holder ?? f.owner, live: !!worker, since: iso(lane.endedAt) ?? at, reason: ew().qaReturned });
        return make("te_toca", { holder: { ...OWNER_AUTHOR }, since: iso(lane.endedAt) ?? at, reason: ew().qaAgain });
      }
      if (lane?.status === "error") return make("te_toca", { holder: { ...OWNER_AUTHOR }, since: iso(lane.endedAt) ?? at, reason: ew().qaError });
      if (f.pr?.state === "merged") return make("integrado");
      if (f.pr?.state === "open" && (ci === "pending" || ci === "failure")) {
        return make("en_revision", { reason: ci === "failure" ? ew().ciFail : ew().ciRun });
      }
      // PLA-52: no card is raised before the pictures exist, so it is not the owner's turn yet either.
      if (f.delivery?.open && f.photos) return make("en_revision", { since: iso(f.delivery.at) ?? at, reason: f.photosWaiting ? `${ew().photos} ${f.photosWaiting}` : ew().photos });
      if (f.delivery?.open) return make("te_toca", { holder: { ...OWNER_AUTHOR }, since: iso(f.delivery.at) ?? at, reason: ew().delivered });
      return make("en_revision", { reason: f.pr?.state === "closed" ? ew().prClosed : null });
    }
  }

  // Backlog, Ready, In progress.
  const sentBack = !!f.delivery?.returned || (!!lane && lane.status === "fail" && lane.returned);
  const sentAt = iso(f.delivery?.returned ? f.delivery.at : lane?.endedAt) ?? at;
  if (f.status === "In progress" && !worker) {
    return make("sin_dueno", { since: iso(f.lease?.until) ?? at, reason: sentBack ? ew().returnedLapsed : ew().nobody });
  }
  if (sentBack && (f.status === "Ready" || worker)) {
    return make("devuelto", { holder: worker?.holder ?? f.owner, live: !!worker, since: worker?.since ?? sentAt, reason: worker ? null : ew().returned });
  }
  if (worker) return make("construyendo", { holder: worker.holder, live: true, since: worker.since });
  if (f.status === "Ready") {
    if (f.postponed) return make("pospuesto", { reason: ew().postponed });
    if (f.held) return make("bloqueado", { reason: f.held });
    if (f.waitsOn.length > 0) return make("en_espera", { reason: ew().waitsFor(quoted(f.waitsOn[0]!)) });
    return make("lista");
  }
  // PLA-47: a ticket left for later says why it waits, so the floor can name what is next.
  if (f.status === "Backlog") {
    // A postponed step that waits on another says so: that is what is next, not the postponing.
    if (f.postponed) return make("pospuesto", { reason: f.waitsOn.length > 0 ? ew().waitsFor(quoted(f.waitsOn[0]!)) : ew().postponed });
    return make("despues", { reason: f.waitsOn.length > 0 ? ew().waitsFor(quoted(f.waitsOn[0]!)) : ew().backlog });
  }
  // An unknown status reads as not started.
  return make("despues");
}

// What «Ahora» lists: someone is working on it, or it was sent back and is the team's to fix.
export const isAhora = (e: Etapa | null) => !!e && (e.etapa === "construyendo" || e.etapa === "devuelto" || (e.etapa === "en_qa" && e.qa === "running"));

export type AhoraItem = { key: string; title: string; initiative: string | null } & Pick<Etapa, "etapa" | "qa" | "holder" | "live" | "since" | "reason">;

// zonas (PLA-I53-6): what part of the app the ticket touches, from its areas (src/api/zonas.ts); [] with no areas.
// NEWPROJ-5: arranque, when the step's newest run failed before its process started (src/runner/start-failures.ts):
// the run's summary and when it ended. Null otherwise, and once a newer run is queued, runs or ends.
export type Arranque = { summary: string; at: string | null };
// PLA-I3-1: what the runner measured on a ticket or an initiative (agent_runs, never the self-reported token_usage).
// used is input + output, the figure the screen shows; the prompt cache is kept apart (cache_read, cache_write) since
// it costs a fraction of fresh tokens. runs counts the runs summed, of any status.
export type Tokens = { used: number; cache_read: number; cache_write: number; runs: number };
export const NO_TOKENS: Tokens = Object.freeze({ used: 0, cache_read: 0, cache_write: 0, runs: 0 }) as Tokens;
export const addTokens = (a: Tokens, b: Tokens): Tokens => ({ used: a.used + b.used, cache_read: a.cache_read + b.cache_read, cache_write: a.cache_write + b.cache_write, runs: a.runs + b.runs });
// PLA-I74-5: turn, whose turn the step is (src/state/turn.ts); the board's working/queued/waiting text reads it.
export type ProjectTicket = { key: string; title: string; status: string; phase: number | null; parent_key: string | null; etapa: Etapa; zonas: Zona[]; arranque: Arranque | null; tokens: Tokens; turn?: TurnOrNobody };
// A completed initiative (Done), for the board's folded line: no tickets.
export type DoneInitiative = { key: string; title: string; done_at: string | null };
// PLA-I56-1: done counts landed tickets (Merged, Released, Done); closed only Done. can_close: every ticket is Done,
// so the owner's Cerrar is accepted (the server refuses an initiative with an open ticket). version for that write.
// PLA-I3-1: tokens rolls up every ticket under it (Won't do too: those tokens were spent), the runs on the initiative's
// own key, and the runs on the ideas promoted to it (tokensOfInitiative).
export type OpenInitiative = { key: string; title: string; status: string; done: number; total: number; closed: number; can_close: boolean; version: number; tokens: Tokens; tickets: ProjectTicket[] };
export type ProjectEtapas = {
  // Every ticket of the project but Won't do, by key.
  byTicket: Map<string, ProjectTicket>;
  // The open initiatives (Planning, Active, Shipping, On hold) in the plan's order, each with its tickets.
  initiatives: OpenInitiative[];
  // Open tickets under no initiative (and under a closed one); the landed ones are only counted (loose_done).
  loose: ProjectTicket[];
  loose_done: number;
  // PLA-I53-6: the newest landed loose ticket's title (the Sueltos Hecho stack shows it), and the completed
  // initiatives, newest first.
  loose_done_title: string | null;
  done_initiatives: DoneInitiative[];
  ahora: AhoraItem[];
};

// A screen row's etapa: the ticket's stage, null on ideas, initiatives and Won't do.
export const etapaRow = (e: ProjectEtapas, t: { kind: string; key: string }): Etapa | null => (t.kind === "ticket" ? (e.byTicket.get(t.key)?.etapa ?? null) : null);
// A screen row's zonas: the ticket's zone tags, [] on ideas, initiatives and Won't do.
export const zonasRow = (e: ProjectEtapas, t: { kind: string; key: string }): Zona[] => (t.kind === "ticket" ? (e.byTicket.get(t.key)?.zonas ?? []) : []);

// The board as both reads serve it: the open initiatives with their tickets, the loose ones, and how many loose
// tickets already landed. PLA-I53-6 adds the newest landed loose ticket's title and the completed initiatives.
export type Tablero = { initiatives: OpenInitiative[]; loose: ProjectTicket[]; loose_done: number; loose_done_title: string | null; done_initiatives: DoneInitiative[] };
export const tableroOf = (e: ProjectEtapas): Tablero => ({ initiatives: e.initiatives, loose: e.loose, loose_done: e.loose_done, loose_done_title: e.loose_done_title, done_initiatives: e.done_initiatives });

// ahora's order: building first, then QA, then sent back; the oldest since first in each.
const AHORA_ORDER: Record<string, number> = { construyendo: 0, en_qa: 1, devuelto: 2 };
export function ahoraOf(rows: (Pick<ProjectTicket, "key" | "title" | "parent_key" | "etapa">)[]): AhoraItem[] {
  return rows
    .filter((r) => isAhora(r.etapa))
    .map((r) => ({ key: r.key, title: r.title, initiative: r.parent_key, etapa: r.etapa.etapa, qa: r.etapa.qa, holder: r.etapa.holder, live: r.etapa.live, since: r.etapa.since, reason: r.etapa.reason }))
    .sort((a, b) => AHORA_ORDER[a.etapa]! - AHORA_ORDER[b.etapa]! || (a.since ?? "").localeCompare(b.since ?? "") || a.key.localeCompare(b.key));
}

const DONE = ["Done", "Merged", "Released"];
type Row = Record<string, unknown>;
const date = (v: unknown) => (v == null ? null : v instanceof Date ? v : new Date(String(v)));

// PLA-I3-1: the measured tokens of every task of one project (tickets, initiatives, ideas), by task id, in one query.
// A run counts toward the task its task_key names, through the task's key or a former key (task_aliases). Only runs
// whose work key is task:<KEY> count: a run keyed general (Asistente, the PO's cadence) or consulta:<id> (a question
// the owner asked, even one about a ticket) belongs to no ticket and is left out of every sum.
export async function projectTokens(db: Db, projectId: string): Promise<Map<string, Tokens>> {
  const rows = (
    await db.execute(sql`
      select coalesce(t.id, al.task_id) as task_id,
        coalesce(sum(r.input_tokens + r.output_tokens), 0)::bigint as used,
        coalesce(sum(r.cache_read_tokens), 0)::bigint as cache_read,
        coalesce(sum(r.cache_create_tokens), 0)::bigint as cache_write,
        count(*)::int as runs
      from ${agentRuns} r
      left join ${tasks} t on t.project_id = r.project_id and t.key = r.task_key
      left join ${taskAliases} al on al.project_id = r.project_id and al.alias = r.task_key
      where r.project_id = ${projectId} and r.task_key is not null and r.work_key like 'task:%'
      group by 1`)
  ).rows as Row[];
  const out = new Map<string, Tokens>();
  for (const r of rows) {
    if (r.task_id == null) continue; // a key no task has (a deleted ticket): nothing to show it on
    out.set(String(r.task_id), { used: Number(r.used), cache_read: Number(r.cache_read), cache_write: Number(r.cache_write), runs: Number(r.runs) });
  }
  return out;
}

// PLA-I3-1: an initiative's tokens: its own key's runs, every ticket under it, and every idea promoted to it.
export function tokensOfInitiative(byId: Map<string, Tokens>, initiativeId: string, ticketIds: string[], ideaIds: string[]): Tokens {
  return [initiativeId, ...ticketIds, ...ideaIds].reduce((acc, id) => addTokens(acc, byId.get(id) ?? NO_TOKENS), NO_TOKENS);
}

// Every ticket's stage in one project, in eleven queries whatever the number of tickets.
export async function projectEtapas(db: Db, p: Project, now = new Date()): Promise<ProjectEtapas> {
  const all = await db.select().from(tasks).where(sql`${tasks.projectId} = ${p.id} and ${tasks.kind} in ('ticket', 'initiative')`);
  const initiatives = all.filter((t) => t.kind === "initiative");
  const tickets = all.filter((t) => t.kind === "ticket" && t.status !== "Won't do");
  // PLA-I3-1: tokens by task id, and which ideas were promoted to which initiative (by the initiative's key).
  const tokensBy = await projectTokens(db, p.id);
  const promotedIdeas = await db
    .select({ id: tasks.id, to: tasks.promotedTo })
    .from(tasks)
    .where(sql`${tasks.projectId} = ${p.id} and ${tasks.kind} = 'idea' and ${tasks.promotedTo} is not null`);
  const initiativeTokens = (i: (typeof all)[number]) =>
    tokensOfInitiative(
      tokensBy,
      i.id,
      all.filter((t) => t.kind === "ticket" && t.parentId === i.id).map((t) => t.id),
      promotedIdeas.filter((d) => d.to === i.key).map((d) => d.id),
    );
  const parentOf = new Map(initiatives.map((i) => [i.id, i]));
  const open = initiatives.filter((t) => OPEN_INITIATIVE.includes(t.status)).sort(byKey);
  const here = open.filter((t) => t.status === "Active").at(-1) ?? null;
  const ids = tickets.map((t) => t.id);
  // When a task landed: resolved_at, else the last status change.
  const landedAt = (t: (typeof all)[number]) => (t.resolvedAt ?? t.statusChangedAt ?? t.updatedAt)?.getTime() ?? 0;
  const done_initiatives: DoneInitiative[] = initiatives
    .filter((i) => i.status === "Done")
    .sort((a, b) => landedAt(b) - landedAt(a) || a.key.localeCompare(b.key))
    .map((i) => ({ key: i.key, title: i.title, done_at: iso(i.resolvedAt ?? i.statusChangedAt) }));
  const empty: ProjectEtapas = { byTicket: new Map(), initiatives: open.map((i) => ({ key: i.key, title: i.title, status: i.status, done: 0, total: 0, closed: 0, can_close: false, version: i.version, tokens: initiativeTokens(i), tickets: [] })), loose: [], loose_done: 0, loose_done_title: null, done_initiatives, ahora: [] };
  if (ids.length === 0) return empty;
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

  const runs = (
    await db.execute(sql`
      select distinct on (r.task_key) r.task_key, r.role, r.started_at, a.slug
      from ${agentRuns} r join ${agents} a on a.id = r.agent_id
      where r.project_id = ${p.id} and r.status = 'running' and r.task_key is not null
      order by r.task_key, r.started_at desc nulls last`)
  ).rows as Row[];
  // PLA-I74-5 (PLA-167): a lease a runner run holds is live only while that run is; one an ended run left is nobody's.
  const liveSessions = new Set(
    ((await db.execute(sql`select r.id from ${agentRuns} r where r.status in ('starting', 'running')`)).rows as Row[]).flatMap((r) => sessionsOf(String(r.id))),
  );
  // NEWPROJ-5: each step's newest run of any state, to tell a step whose run could not start.
  const newest = (
    await db.execute(sql`
      select distinct on (r.task_key) r.task_key, r.status, r.summary, r.ended_at
      from ${agentRuns} r
      where r.project_id = ${p.id} and r.task_key is not null
      order by r.task_key, coalesce(r.ended_at, r.started_at, r.queued_at) desc, r.queued_at desc`)
  ).rows as Row[];
  const lanes = (
    await db.execute(sql`
      select distinct on (l.task_id) l.task_id, l.status, l.returned, l.attempt, l.commit, l.created_at, l.started_at, l.ended_at
      from ${qaLanes} l where l.project_id = ${p.id} order by l.task_id, l.created_at desc`)
  ).rows as Row[];
  const prs = (
    await db.execute(sql`
      select distinct on (pr.task_id) pr.task_id, pr.state, pr.ci_state, pr.head_sha
      from ${pullRequests} pr where pr.project_id = ${p.id} and pr.task_id is not null
      order by pr.task_id, (pr.state = 'open') desc, pr.updated_at desc`)
  ).rows as Row[];
  const waits = (
    await db.execute(sql`
      select tb.task_id, b.title from ${taskBlockers} tb join ${tasks} b on b.id = tb.blocker_id join ${tasks} w on w.id = tb.task_id
      where tb.task_id in (${idList})
        and (b.status not in (${sql.join(SETTLED_STATUSES.map((s) => sql`${s}`), sql`, `)})
          -- PLA-54: a Backlog step moves to Lista once the step before lands, so an In review blocker still holds it.
          or (w.status = 'Backlog' and b.status = 'In review'))
      order by b.phase nulls last, b.key`)
  ).rows as Row[];
  const typed = (
    await db.execute(sql`
      select bl.task_id, bl.type, bl.spec from ${blockers} bl
      join ${tasks} bt on bt.id = bl.task_id
      left join ${envStates} es on es.project_id = bt.project_id and es.env = bl.spec->>'env'
      where bl.task_id in (${idList}) and ${typedBlockerOpen()}
      order by bl.created_at`)
  ).rows as Row[];
  // The latest message to the owner that links each ticket (deliveries; questions and proposals are not).
  const deliveries = (
    await db.execute(sql`
      select distinct on (l->>'ref') l->>'ref' as ref, m.action_state, m.at
      from ${threadMessages} m join ${threads} th on th.id = m.thread_id
      cross join lateral jsonb_array_elements(m.links) l
      where th.project_id = ${p.id} and l->>'kind' = 'ticket' and m.author_agent <> ${OWNER_AUTHOR.agent}
        and m.question_id is null and m.proposal is null
      order by l->>'ref', m.at desc`)
  ).rows as Row[];
  const ownerIds = [...new Set(tickets.map((t) => t.ownerAgent).filter((x): x is string => !!x))];
  const leaseSlugs = [...new Set(tickets.map((t) => (t.owner as Actor | null)?.agent?.trim().toLowerCase()).filter((x): x is string => !!x))];
  const roster =
    ownerIds.length || leaseSlugs.length
      ? await db
          .select()
          .from(agents)
          .where(
            sql`${ownerIds.length ? sql`${agents.id} in (${sql.join(ownerIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql`false`} or ${
              leaseSlugs.length ? sql`${agents.slug} in (${sql.join(leaseSlugs.map((s) => sql`${s}`), sql`, `)})` : sql`false`
            }`,
          )
      : [];
  const qaOn = !!(await qaAgentOf(db, p));

  const byIdAgent = new Map(roster.map((a) => [a.id, a]));
  const bySlug = new Map(roster.map((a) => [a.slug, a]));
  const runBy = new Map(runs.map((r) => [String(r.task_key), r]));
  const arranqueBy = new Map<string, Arranque>();
  // PLA-I2-16: Claude signed out on this machine also waits on the owner (the run started but did nothing), so it shows
  // the same way, with its own words (ui/src/lib/arranque.ts).
  for (const r of newest) if (r.status === "fail" && (startFailureOf(String(r.summary ?? "")) || failReason(String(r.summary ?? "")) === SIGNED_OUT)) arranqueBy.set(String(r.task_key), { summary: String(r.summary), at: iso(date(r.ended_at)) });
  const laneBy = new Map(lanes.map((r) => [String(r.task_id), r]));
  const prBy = new Map(prs.map((r) => [String(r.task_id), r]));
  const waitBy = new Map<string, string[]>();
  for (const w of waits) waitBy.set(String(w.task_id), [...(waitBy.get(String(w.task_id)) ?? []), String(w.title)]);
  const heldBy = new Map<string, string>();
  for (const b of typed) if (!heldBy.has(String(b.task_id))) heldBy.set(String(b.task_id), heldText(String(b.type), (b.spec ?? {}) as Record<string, unknown>));
  const deliveryBy = new Map(deliveries.map((d) => [String(d.ref), d]));

  const byTicket = new Map<string, ProjectTicket>();
  for (const t of tickets) {
    const ownerAgent = t.ownerAgent ? byIdAgent.get(t.ownerAgent) : undefined;
    const owner: Holder = ownerAgent ? { agent: ownerAgent.slug, role: roleOf(ownerAgent) ?? ownerAgent.role } : (t.workType ?? "code") === "code" ? { agent: "taller", role: "taller" } : { agent: "product-owner", role: "product-owner" };
    const actor = t.owner as Actor | null;
    const leaseAgent = actor?.agent ? bySlug.get(actor.agent.trim().toLowerCase()) : undefined;
    const run = runBy.get(t.key);
    const lane = laneBy.get(t.id);
    const pr = prBy.get(t.id);
    const d = deliveryBy.get(t.key);
    const action = (d?.action_state as { action?: string } | null | undefined)?.action ?? null;
    const parent = t.parentId ? parentOf.get(t.parentId) : undefined;
    const facts: EtapaFacts = {
      status: t.status,
      statusChangedAt: t.statusChangedAt ?? t.createdAt,
      owner,
      lease: actor && t.leaseUntil && !(isRunSession(actor.session_id) && !liveSessions.has(actor.session_id)) ? { holder: leaseAgent ? { agent: leaseAgent.slug, role: roleOf(leaseAgent) ?? leaseAgent.role } : { agent: actor.agent, role: owner.role }, since: t.claimedAt ?? null, until: t.leaseUntil } : null,
      run: run ? { holder: { agent: String(run.slug), role: String(run.role) }, since: date(run.started_at) } : null,
      qa: {
        applies: qaOn && qaTicket(t),
        lane: lane
          ? { status: String(lane.status), returned: !!lane.returned, attempt: Number(lane.attempt), commit: (lane.commit as string | null) ?? null, createdAt: date(lane.created_at)!, startedAt: date(lane.started_at), endedAt: date(lane.ended_at) }
          : null,
      },
      pr: pr ? { state: String(pr.state), ci: (pr.ci_state as string | null) ?? null, head: (pr.head_sha as string | null) ?? null } : null,
      waitsOn: waitBy.get(t.id) ?? [],
      held: heldBy.get(t.id) ?? null,
      blockedNote: t.blockedNote ?? null,
      // PLA-54: a step filed in Backlog that never moved is waiting its turn in the chain, not postponed; only one
      // someone put back in Backlog (its status moved), or under an On hold initiative, is postponed on purpose.
      postponed:
        !!parent &&
        ((parent.id === here?.id && t.status === "Backlog" && t.statusChangedAt !== null) || (parent.status === "On hold" && (t.status === "Backlog" || t.status === "Ready"))),
      delivery: d ? { returned: action === "cambios", open: !action, at: date(d.at)! } : null,
      photos: !!pr && probadorGate(p, t, (pr.head_sha as string | null) ?? null).pending,
      photosWaiting: t.probador?.state === "tomando" ? (t.probador.waiting ?? null) : null,
    };
    const etapa = etapaOf(facts, now);
    if (etapa) byTicket.set(t.key, { key: t.key, title: t.title, status: t.status, phase: t.phase ?? null, parent_key: parent?.key ?? null, etapa, zonas: zonasOf(t.areas), arranque: arranqueBy.get(t.key) ?? null, tokens: tokensBy.get(t.id) ?? NO_TOKENS });
  }

  // PLA-I74-5: whose turn each step is.
  for (const it of await projectTurns(db, p, byTicket, now)) {
    const row = byTicket.get(it.key);
    if (row) row.turn = it.turn;
  }

  const keyNo = (k: string) => Number(/(\d+)$/.exec(k)?.[1] ?? Number.MAX_SAFE_INTEGER);
  const sorted = [...byTicket.values()].sort((a, b) => (a.phase ?? 999) - (b.phase ?? 999) || keyNo(a.key) - keyNo(b.key) || a.key.localeCompare(b.key));
  const openIds = new Set(open.map((i) => i.id));
  const ticketParent = new Map(tickets.map((t) => [t.key, t.parentId]));
  const looseLanded = tickets.filter((t) => !openIds.has(t.parentId ?? "") && DONE.includes(t.status)).sort((a, b) => landedAt(b) - landedAt(a) || a.key.localeCompare(b.key));
  return {
    byTicket,
    initiatives: open.map((i) => {
      const mine = sorted.filter((t) => ticketParent.get(t.key) === i.id);
      const closed = mine.filter((t) => t.status === "Done").length;
      return { key: i.key, title: i.title, status: i.status, done: mine.filter((t) => DONE.includes(t.status)).length, total: mine.length, closed, can_close: mine.length > 0 && closed === mine.length, version: i.version, tokens: initiativeTokens(i), tickets: mine };
    }),
    loose: sorted.filter((t) => !openIds.has(ticketParent.get(t.key) ?? "") && !DONE.includes(t.status)),
    loose_done: looseLanded.length,
    loose_done_title: looseLanded[0]?.title ?? null,
    done_initiatives,
    ahora: ahoraOf(sorted),
  };
}

// One line for an open typed blocker.
function heldText(type: string, spec: Record<string, unknown>): string {
  if (type === "human_action") return String(spec.text ?? ew().humanAction);
  if (type === "time_after") return ew().until(String(spec.at ?? "")).trim();
  if (type === "env") return ew().env(String(spec.env ?? ""), String(spec.condition ?? ""), String(spec.value ?? "")).trim();
  if (type === "env_flag") return ew().envFlag(String(spec.flag ?? ""), String(spec.env ?? ""));
  if (type === "metric_gte") return ew().metric(String(spec.name ?? ""), String(spec.value ?? ""));
  return ew().blocked;
}
