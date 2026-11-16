// PLA-I53-2: one stage per ticket (la etapa), computed in one place so the floor (GET /api/company) and the project
// page (GET /api/projects/:slug) say the same thing about where a ticket is and who has it. No migration: every
// fact below already exists.
//   etapaOf       pure: one ticket's facts → {etapa, qa, holder, live, since, ci, reason}
//   projectEtapas reads the facts of every ticket of one project in a fixed number of queries (none per ticket)
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
//     the latest delivery message for the ticket waits on the owner (no action yet) → te_toca
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
import { agentRuns, agents, blockers, envStates, pullRequests, qaLanes, taskBlockers, tasks, threadMessages, threads, type Actor, type Project } from "../db/schema.js";
import { SETTLED_STATUSES, typedBlockerOpen } from "../mcp/blockers.js";
import { roleOf } from "../runner/limits.js";
import { qaAgentOf, qaTicket, sameCommit } from "../runner/qa.js";
import { JORGE } from "../runner/threads.js";
import { byKey } from "./company-plan.js";

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
  if (f.status === "Backlog") return f.postponed ? make("pospuesto", { reason: "Pospuesto a propósito." }) : make("despues");
  // An unknown status reads as not started.
  return make("despues");
}

// What «Ahora» lists: someone is working on it, or it was sent back and is the team's to fix.
export const isAhora = (e: Etapa | null) => !!e && (e.etapa === "construyendo" || e.etapa === "devuelto" || (e.etapa === "en_qa" && e.qa === "running"));

export type AhoraItem = { key: string; title: string; initiative: string | null } & Pick<Etapa, "etapa" | "qa" | "holder" | "live" | "since" | "reason">;

export type ProjectTicket = { key: string; title: string; status: string; phase: number | null; parent_key: string | null; etapa: Etapa };
export type OpenInitiative = { key: string; title: string; status: string; done: number; total: number; tickets: ProjectTicket[] };
export type ProjectEtapas = {
  // Every ticket of the project but Won't do, by key.
  byTicket: Map<string, ProjectTicket>;
  // The open initiatives (Planning, Active, Shipping, On hold) in the plan's order, each with its tickets.
  initiatives: OpenInitiative[];
  // Open tickets under no initiative (and under a closed one); the landed ones are only counted (loose_done).
  loose: ProjectTicket[];
  loose_done: number;
  ahora: AhoraItem[];
};

// A screen row's etapa: the ticket's stage, null on ideas, initiatives and Won't do.
export const etapaRow = (e: ProjectEtapas, t: { kind: string; key: string }): Etapa | null => (t.kind === "ticket" ? (e.byTicket.get(t.key)?.etapa ?? null) : null);

// The board as both reads serve it: the open initiatives with their tickets, the loose ones, and how many loose
// tickets already landed.
export type Tablero = { initiatives: OpenInitiative[]; loose: ProjectTicket[]; loose_done: number };
export const tableroOf = (e: ProjectEtapas): Tablero => ({ initiatives: e.initiatives, loose: e.loose, loose_done: e.loose_done });

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

// Every ticket's stage in one project, in nine queries whatever the number of tickets.
export async function projectEtapas(db: Db, p: Project, now = new Date()): Promise<ProjectEtapas> {
  const all = await db.select().from(tasks).where(sql`${tasks.projectId} = ${p.id} and ${tasks.kind} in ('ticket', 'initiative')`);
  const initiatives = all.filter((t) => t.kind === "initiative");
  const tickets = all.filter((t) => t.kind === "ticket" && t.status !== "Won't do");
  const parentOf = new Map(initiatives.map((i) => [i.id, i]));
  const open = initiatives.filter((t) => OPEN_INITIATIVE.includes(t.status)).sort(byKey);
  const here = open.filter((t) => t.status === "Active").at(-1) ?? null;
  const ids = tickets.map((t) => t.id);
  const empty: ProjectEtapas = { byTicket: new Map(), initiatives: open.map((i) => ({ key: i.key, title: i.title, status: i.status, done: 0, total: 0, tickets: [] })), loose: [], loose_done: 0, ahora: [] };
  if (ids.length === 0) return empty;
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

  const runs = (
    await db.execute(sql`
      select distinct on (r.task_key) r.task_key, r.role, r.started_at, a.slug
      from ${agentRuns} r join ${agents} a on a.id = r.agent_id
      where r.project_id = ${p.id} and r.status = 'running' and r.task_key is not null
      order by r.task_key, r.started_at desc nulls last`)
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
      select tb.task_id, b.title from ${taskBlockers} tb join ${tasks} b on b.id = tb.blocker_id
      where tb.task_id in (${idList}) and b.status not in (${sql.join(SETTLED_STATUSES.map((s) => sql`${s}`), sql`, `)})
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
      where th.project_id = ${p.id} and l->>'kind' = 'ticket' and m.author_agent <> ${JORGE.agent}
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
      lease: actor && t.leaseUntil ? { holder: leaseAgent ? { agent: leaseAgent.slug, role: roleOf(leaseAgent) ?? leaseAgent.role } : { agent: actor.agent, role: owner.role }, since: t.claimedAt ?? null, until: t.leaseUntil } : null,
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
      postponed: !!parent && ((parent.id === here?.id && t.status === "Backlog") || (parent.status === "On hold" && (t.status === "Backlog" || t.status === "Ready"))),
      delivery: d ? { returned: action === "cambios", open: !action, at: date(d.at)! } : null,
    };
    const etapa = etapaOf(facts, now);
    if (etapa) byTicket.set(t.key, { key: t.key, title: t.title, status: t.status, phase: t.phase ?? null, parent_key: parent?.key ?? null, etapa });
  }

  const keyNo = (k: string) => Number(/(\d+)$/.exec(k)?.[1] ?? Number.MAX_SAFE_INTEGER);
  const sorted = [...byTicket.values()].sort((a, b) => (a.phase ?? 999) - (b.phase ?? 999) || keyNo(a.key) - keyNo(b.key) || a.key.localeCompare(b.key));
  const openIds = new Set(open.map((i) => i.id));
  const ticketParent = new Map(tickets.map((t) => [t.key, t.parentId]));
  return {
    byTicket,
    initiatives: open.map((i) => {
      const mine = sorted.filter((t) => ticketParent.get(t.key) === i.id);
      return { key: i.key, title: i.title, status: i.status, done: mine.filter((t) => DONE.includes(t.status)).length, total: mine.length, tickets: mine };
    }),
    loose: sorted.filter((t) => !openIds.has(ticketParent.get(t.key) ?? "") && !DONE.includes(t.status)),
    loose_done: sorted.filter((t) => !openIds.has(ticketParent.get(t.key) ?? "") && DONE.includes(t.status)).length,
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
