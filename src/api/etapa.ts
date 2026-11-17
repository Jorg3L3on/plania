// PLA-I53-2: one stage per ticket (la etapa), computed in one place so the floor (GET /api/company) and the project
// page (GET /api/projects/:slug) say the same thing about where a ticket is and who has it. No migration: every
// fact below already exists.
//   etapaOf       pure: one ticket's facts → {etapa, qa, holder, live, since, ci, reason}
//   projectEtapas reads the facts of every ticket of one project in a fixed number of reads (none per ticket)
//   ahoraOf       the tickets someone works on now: construyendo, en_qa while QA runs, devuelto
//
// The rules, first match wins (Design doc of PLA-I53; the initiative's table where the doc says nothing):
//   Done → hecho · Released → publicado · Merged → integrado · Won't do → null (no stage)
//   Needs Jorge → te_toca
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
import { isDeepStrictEqual } from "node:util";
import type { Db } from "../db/client.js";
import type { Actor, Agent, Project, QaLane } from "../db/schema.js";
import { SETTLED_STATUSES } from "../mcp/blockers.js";
import { isGating } from "../mcp/jorge-lines.js";
import { roleOf } from "../runner/limits.js";
import { readerOf } from "../store/port.js";
import { ne, notNull, type Reader, type Row } from "../store/types.js";
import { qaAgentOf, qaTicket, sameCommit } from "../runner/qa.js";
import { probadorGate } from "../captures/probador.js";
import { JORGE } from "../runner/threads.js";
import { byKey } from "./company-plan.js";
import { zonasOf, type Zona } from "./zonas.js";

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
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const quoted = (s: string, n = 60) => `«${s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s}»`;
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
    case "Needs Jorge":
      return make("te_toca", { holder: { ...JORGE }, reason: "Necesita tu decisión." });
    case "Blocked":
      if (!f.held && f.waitsOn.length > 0) return make("en_espera", { reason: `Espera a ${quoted(f.waitsOn[0]!)}` });
      return make("bloqueado", { reason: f.blockedNote || f.held || (f.waitsOn[0] ? `Espera a ${quoted(f.waitsOn[0])}` : null) });
    case "In review": {
      if ((f.run && f.run.holder.role === "qa") || (lane && QA_RUNNING.includes(lane.status))) {
        return make("en_qa", { qa: "running", holder: f.run?.holder ?? { agent: "qa", role: "qa" }, live: true, since: iso(f.run?.since ?? lane?.startedAt ?? lane?.createdAt) ?? at });
      }
      const stale = !!lane && !!f.pr?.head && !!lane.commit && !sameCommit(f.pr.head, lane.commit);
      if (f.qa.applies && (!lane || lane.status === "queued" || stale)) {
        return make("en_qa", { qa: "queued", holder: { agent: "qa", role: "qa" }, since: iso(lane && !stale ? lane.createdAt : null) ?? at, reason: "En la cola de QA." });
      }
      if (lane?.status === "fail") {
        if (lane.returned || lane.attempt === 1) return make("devuelto", { holder: worker?.holder ?? f.owner, live: !!worker, since: iso(lane.endedAt) ?? at, reason: "QA encontró fallas y la devolvió." });
        return make("te_toca", { holder: { ...JORGE }, since: iso(lane.endedAt) ?? at, reason: "QA encontró fallas otra vez: revísala tú." });
      }
      if (lane?.status === "error") return make("te_toca", { holder: { ...JORGE }, since: iso(lane.endedAt) ?? at, reason: "QA no pudo terminar: revísala tú." });
      if (f.pr?.state === "merged") return make("integrado");
      if (f.pr?.state === "open" && (ci === "pending" || ci === "failure")) {
        return make("en_revision", { reason: ci === "failure" ? "Las pruebas del PR fallan." : "Las pruebas del PR corren." });
      }
      // PLA-52: no card is raised before the pictures exist, so it is not the owner's turn yet either.
      if (f.delivery?.open && f.photos) return make("en_revision", { since: iso(f.delivery.at) ?? at, reason: "Plania toma las fotos de la entrega." });
      if (f.delivery?.open) return make("te_toca", { holder: { ...JORGE }, since: iso(f.delivery.at) ?? at, reason: "Entregada: espera que la aceptes." });
      return make("en_revision", { reason: f.pr?.state === "closed" ? "El PR se cerró sin fusionar." : null });
    }
  }

  // Backlog, Ready, In progress.
  const sentBack = !!f.delivery?.returned || (!!lane && lane.status === "fail" && lane.returned);
  const sentAt = iso(f.delivery?.returned ? f.delivery.at : lane?.endedAt) ?? at;
  if (f.status === "In progress" && !worker) {
    return make("sin_dueno", { since: iso(f.lease?.until) ?? at, reason: sentBack ? "La devolvieron y nadie la está arreglando: la reserva venció." : "Nadie la tiene: la reserva venció y no corre ningún paso." });
  }
  if (sentBack && (f.status === "Ready" || worker)) {
    return make("devuelto", { holder: worker?.holder ?? f.owner, live: !!worker, since: worker?.since ?? sentAt, reason: worker ? null : "La devolvieron: espera que la arreglen." });
  }
  if (worker) return make("construyendo", { holder: worker.holder, live: true, since: worker.since });
  if (f.status === "Ready") {
    if (f.postponed) return make("pospuesto", { reason: "Pospuesto a propósito." });
    if (f.held) return make("bloqueado", { reason: f.held });
    if (f.waitsOn.length > 0) return make("en_espera", { reason: `Espera a ${quoted(f.waitsOn[0]!)}` });
    return make("lista");
  }
  // PLA-47: a ticket left for later says why it waits, so the floor can name what is next.
  if (f.status === "Backlog") {
    // A postponed step that waits on another says so: that is what is next, not the postponing.
    if (f.postponed) return make("pospuesto", { reason: f.waitsOn.length > 0 ? `Espera a ${quoted(f.waitsOn[0]!)}` : "Pospuesto a propósito." });
    return make("despues", { reason: f.waitsOn.length > 0 ? `Espera a ${quoted(f.waitsOn[0]!)}` : "Está en Backlog: nadie la pasó a Lista." });
  }
  // An unknown status reads as not started.
  return make("despues");
}

// What «Ahora» lists: someone is working on it, or it was sent back and is the team's to fix.
export const isAhora = (e: Etapa | null) => !!e && (e.etapa === "construyendo" || e.etapa === "devuelto" || (e.etapa === "en_qa" && e.qa === "running"));

export type AhoraItem = { key: string; title: string; initiative: string | null } & Pick<Etapa, "etapa" | "qa" | "holder" | "live" | "since" | "reason">;

// zonas (PLA-I53-6): what part of the app the ticket touches, from its areas (src/api/zonas.ts); [] with no areas.
export type ProjectTicket = { key: string; title: string; status: string; phase: number | null; parent_key: string | null; etapa: Etapa; zonas: Zona[] };
// A completed initiative (Done), for the board's folded line: no tickets.
export type DoneInitiative = { key: string; title: string; done_at: string | null };
// PLA-I56-1: done counts landed tickets (Merged, Released, Done); closed only Done. can_close: every ticket is Done,
// so the owner's Cerrar is accepted (the server refuses an initiative with an open ticket). version for that write.
export type OpenInitiative = { key: string; title: string; status: string; done: number; total: number; closed: number; can_close: boolean; version: number; tickets: ProjectTicket[] };
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
const textOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const nullsLast = (a: number | null, b: number | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b);

// Whether a typed blocker of the project holds at `now`, read against its environments, commits and metrics.
// The same rules blockers.ts applies to a claim (a condition that cannot be evaluated does not hold).
async function typedHoldsIn(r: Reader, projectId: string, now: Date): Promise<(b: Row<"blockers">) => Promise<boolean>> {
  const envs = new Map((await r.find("envStates", { projectId })).map((e) => [e.env, e]));
  const metrics = new Map((await r.find("projectMetrics", { projectId })).map((m) => [m.name, m.value]));
  const commits = new Map<string, Promise<string[]>>();
  const commitsOf = (env: string) => {
    let hit = commits.get(env);
    if (!hit) commits.set(env, (hit = r.find("envCommits", { projectId, env }).then((rows) => rows.map((c) => c.sha))));
    return hit;
  };
  return async (b) => {
    const spec = b.spec;
    const es = spec.env == null ? undefined : envs.get(String(spec.env));
    switch (b.type) {
      case "env":
        if (spec.condition === "migration_gte") return es?.migrationsApplied != null && es.migrationsApplied >= Number(spec.value);
        if (spec.condition === "deployed_after") return !!es?.deployedAt && spec.value != null && es.deployedAt > new Date(String(spec.value));
        if (spec.condition === "contains_commit") return spec.env != null && spec.value != null && (await commitsOf(String(spec.env))).some((sha) => sha.startsWith(String(spec.value)));
        return false;
      case "human_action":
        return b.satisfiedAt !== null;
      case "env_flag": {
        const flags = es?.flags;
        if (!flags || spec.flag == null || !Object.hasOwn(flags, String(spec.flag)) || spec.equals === undefined) return false;
        return isDeepStrictEqual(flags[String(spec.flag)], spec.equals);
      }
      case "time_after":
        return spec.at != null && now >= new Date(String(spec.at));
      case "metric_gte": {
        const value = spec.name == null ? undefined : metrics.get(String(spec.name));
        return value !== undefined && value >= Number(spec.value);
      }
      default:
        return false;
    }
  };
}

// Every ticket's stage in one project, from a fixed number of reads whatever the number of tickets.
export async function projectEtapas(db: Db, p: Project, now = new Date()): Promise<ProjectEtapas> {
  const r = readerOf(db);
  const all = await r.find("tasks", { projectId: p.id, kind: ["ticket", "initiative"] });
  const initiatives = all.filter((t) => t.kind === "initiative");
  const tickets = all.filter((t) => t.kind === "ticket" && t.status !== "Won't do");
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
  const empty: ProjectEtapas = { byTicket: new Map(), initiatives: open.map((i) => ({ key: i.key, title: i.title, status: i.status, done: 0, total: 0, closed: 0, can_close: false, version: i.version, tickets: [] })), loose: [], loose_done: 0, loose_done_title: null, done_initiatives, ahora: [] };
  if (ids.length === 0) return empty;

  // The running run on each ticket: the latest started (never started last), with its agent's slug.
  const running = await r.find("agentRuns", { projectId: p.id, status: "running", taskKey: notNull() });
  const runSlug = new Map((running.length ? await r.find("agents", { id: [...new Set(running.map((x) => x.agentId))] }) : []).map((a) => [a.id, a.slug]));
  const runBy = new Map<string, { slug: string; role: string; startedAt: Date | null }>();
  for (const x of running.sort((a, b) => (a.startedAt ? 0 : 1) - (b.startedAt ? 0 : 1) || (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0))) {
    const slug = runSlug.get(x.agentId);
    if (slug !== undefined && !runBy.has(x.taskKey!)) runBy.set(x.taskKey!, { slug, role: x.role, startedAt: x.startedAt });
  }
  // The latest QA lane of each ticket (two made in the same millisecond: the one written last).
  const laneBy = new Map<string, QaLane>();
  for (const l of await r.find("qaLanes", { projectId: p.id })) {
    const had = laneBy.get(l.taskId);
    if (!had || l.createdAt >= had.createdAt) laneBy.set(l.taskId, l);
  }
  // Each ticket's PR: an open one first, then the latest updated.
  const prBy = new Map<string, Row<"pullRequests">>();
  for (const pr of (await r.find("pullRequests", { projectId: p.id, taskId: notNull() })).sort(
    (a, b) => Number(b.state === "open") - Number(a.state === "open") || b.updatedAt.getTime() - a.updatedAt.getTime(),
  )) {
    if (!prBy.has(pr.taskId!)) prBy.set(pr.taskId!, pr);
  }
  // The unfinished tickets each one waits on, by phase (none last), then key.
  const statusById = new Map(tickets.map((t) => [t.id, t.status]));
  const links = await r.find("taskBlockers", { taskId: ids });
  const blockerTask = new Map((links.length ? await r.find("tasks", { id: [...new Set(links.map((l) => l.blockerId))] }) : []).map((b) => [b.id, b]));
  const waits = links
    .flatMap((l) => {
      const b = blockerTask.get(l.blockerId);
      // PLA-54: a Backlog step moves to Lista once the step before lands, so an In review blocker still holds it.
      const holds = b && (!(SETTLED_STATUSES as readonly string[]).includes(b.status) || (b.status === "In review" && statusById.get(l.taskId) === "Backlog"));
      return b && holds ? [{ taskId: l.taskId, b }] : [];
    })
    .sort((x, y) => nullsLast(x.b.phase, y.b.phase) || textOrder(x.b.key, y.b.key));
  // The open typed blockers, oldest first: gating, and their condition does not hold.
  const holds = await typedHoldsIn(r, p.id, now);
  const typed: Row<"blockers">[] = [];
  for (const b of await r.find("blockers", { taskId: ids }, { orderBy: [{ column: "createdAt" }] })) if (isGating(b.spec) && !(await holds(b))) typed.push(b);
  // The latest message to the owner that links each ticket (deliveries; questions and proposals are not).
  const threadIds = (await r.find("threads", { projectId: p.id })).map((th) => th.id);
  const messages = threadIds.length ? await r.find("threadMessages", { threadId: threadIds, authorAgent: ne(JORGE.agent), questionId: null, proposal: null }) : [];
  const deliveryBy = new Map<string, { actionState: Row<"threadMessages">["actionState"]; at: Date }>();
  for (const m of messages) {
    for (const l of m.links ?? []) {
      if (l.kind !== "ticket") continue;
      const had = deliveryBy.get(l.ref);
      if (!had || m.at >= had.at) deliveryBy.set(l.ref, { actionState: m.actionState, at: m.at });
    }
  }
  const ownerIds = [...new Set(tickets.map((t) => t.ownerAgent).filter((x): x is string => !!x))];
  const leaseSlugs = [...new Set(tickets.map((t) => (t.owner as Actor | null)?.agent?.trim().toLowerCase()).filter((x): x is string => !!x))];
  const roster: Agent[] = [...(ownerIds.length ? await r.find("agents", { id: ownerIds }) : []), ...(leaseSlugs.length ? await r.find("agents", { slug: leaseSlugs }) : [])];
  const qaOn = !!(await qaAgentOf(db, p));

  const byIdAgent = new Map(roster.map((a) => [a.id, a]));
  const bySlug = new Map(roster.map((a) => [a.slug, a]));
  const waitBy = new Map<string, string[]>();
  for (const w of waits) waitBy.set(w.taskId, [...(waitBy.get(w.taskId) ?? []), w.b.title]);
  const heldBy = new Map<string, string>();
  for (const b of typed) if (!heldBy.has(b.taskId)) heldBy.set(b.taskId, heldText(b.type, b.spec ?? {}));

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
    const action = (d?.actionState as { action?: string } | null | undefined)?.action ?? null;
    const parent = t.parentId ? parentOf.get(t.parentId) : undefined;
    const facts: EtapaFacts = {
      status: t.status,
      statusChangedAt: t.statusChangedAt ?? t.createdAt,
      owner,
      lease: actor && t.leaseUntil ? { holder: leaseAgent ? { agent: leaseAgent.slug, role: roleOf(leaseAgent) ?? leaseAgent.role } : { agent: actor.agent, role: owner.role }, since: t.claimedAt ?? null, until: t.leaseUntil } : null,
      run: run ? { holder: { agent: run.slug, role: run.role }, since: run.startedAt } : null,
      qa: {
        applies: qaOn && qaTicket(t),
        lane: lane ? { status: lane.status, returned: lane.returned, attempt: lane.attempt, commit: lane.commit ?? null, createdAt: lane.createdAt, startedAt: lane.startedAt, endedAt: lane.endedAt } : null,
      },
      pr: pr ? { state: pr.state, ci: pr.ciState ?? null, head: pr.headSha ?? null } : null,
      waitsOn: waitBy.get(t.id) ?? [],
      held: heldBy.get(t.id) ?? null,
      blockedNote: t.blockedNote ?? null,
      // PLA-54: a step filed in Backlog that never moved is waiting its turn in the chain, not postponed; only one
      // someone put back in Backlog (its status moved), or under an On hold initiative, is postponed on purpose.
      postponed:
        !!parent &&
        ((parent.id === here?.id && t.status === "Backlog" && t.statusChangedAt !== null) || (parent.status === "On hold" && (t.status === "Backlog" || t.status === "Ready"))),
      delivery: d ? { returned: action === "cambios", open: !action, at: d.at } : null,
      photos: !!pr && probadorGate(p, t, pr.headSha ?? null).pending,
    };
    const etapa = etapaOf(facts, now);
    if (etapa) byTicket.set(t.key, { key: t.key, title: t.title, status: t.status, phase: t.phase ?? null, parent_key: parent?.key ?? null, etapa, zonas: zonasOf(t.areas) });
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
      return { key: i.key, title: i.title, status: i.status, done: mine.filter((t) => DONE.includes(t.status)).length, total: mine.length, closed, can_close: mine.length > 0 && closed === mine.length, version: i.version, tickets: mine };
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
  if (type === "human_action") return String(spec.text ?? "Espera una acción tuya.");
  if (type === "time_after") return `Espera hasta ${String(spec.at ?? "")}`.trim();
  if (type === "env") return `Espera a ${String(spec.env ?? "")}: ${String(spec.condition ?? "")} ${String(spec.value ?? "")}`.trim();
  if (type === "env_flag") return `Espera la bandera ${String(spec.flag ?? "")} en ${String(spec.env ?? "")}`;
  if (type === "metric_gte") return `Espera que ${String(spec.name ?? "")} llegue a ${String(spec.value ?? "")}`;
  return "Bloqueado.";
}
