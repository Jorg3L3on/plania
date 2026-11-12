// PLA-I39-2: GET /api/company/history?hours=N (1..72, default 20). What happened in the last hours, for the clock
// of the building (/ceo). Per project:
//   runs    agent_runs that overlap the window (queued and skipped left out). from is clipped to the window's
//           start; a live run has to null.
//   events  oldest first, each with the role that did it:
//             delivered  a teammate's thread message that links a doc, PR or idea
//             asked      a question asked, or a proposal posted (a thread message carrying proposal data)
//             answered   a question answered, or a thread message acted on (action_state)
//             ordered    an order made from the screen (a ticket with origin jorge)
// A fixed number of queries for the whole company (never one per run or per project). Read only, cookie only.
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

export const HISTORY_DEFAULT_HOURS = 20;
export const HISTORY_MAX_HOURS = 72;
const HOUR = 3_600_000;

export type HistoryRun = { agent: string; role: string; ticket: string | null; title: string | null; from: string; to: string | null; status: string };
export type HistoryEventKind = "delivered" | "asked" | "answered" | "ordered";
export type HistoryEvent = { at: string; kind: HistoryEventKind; role: string; title: string };
export type HistoryProject = { slug: string; runs: HistoryRun[]; events: HistoryEvent[] };
export type CompanyHistory = { from: string; to: string; projects: HistoryProject[] };

export function parseHours(v: string | undefined): number | null {
  if (v == null || v === "") return HISTORY_DEFAULT_HOURS;
  if (!/^\d+$/.test(v.trim())) return null;
  const n = Number(v);
  return n >= 1 && n <= HISTORY_MAX_HOURS ? n : null;
}

const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();
const cut = (s: string, n = 140) => {
  const one = s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};
const firstLine = (s: string) => cut(s.split("\n").find((l) => l.trim()) ?? "");

export async function companyHistory(db: Db, hours = HISTORY_DEFAULT_HOURS, now = new Date()): Promise<CompanyHistory> {
  const to = now;
  const from = new Date(now.getTime() - hours * HOUR);
  const f = from.toISOString();
  const t = to.toISOString();

  const all = await db.execute<{ id: string; slug: string }>(sql`select id, slug from projects order by slug`);
  const out = new Map<string, HistoryProject>();
  const slugOf = new Map<string, string>();
  for (const p of all.rows) {
    slugOf.set(String(p.id), p.slug);
    out.set(p.slug, { slug: p.slug, runs: [], events: [] });
  }
  const at = (projectId: unknown) => out.get(slugOf.get(String(projectId)) ?? "");

  // 1. Runs that overlap [from, to].
  const runs = await db.execute<Record<string, unknown>>(sql`
    select r.project_id, a.slug as agent, r.role, r.task_key, tk.title, r.started_at, r.ended_at, r.status
    from agent_runs r
    join agents a on a.id = r.agent_id
    left join tasks tk on tk.project_id = r.project_id and tk.key = r.task_key
    where r.status in ('running', 'ok', 'fail', 'stopped')
      and r.started_at is not null and r.started_at <= ${t}::timestamptz
      and (r.ended_at is null or r.ended_at >= ${f}::timestamptz)
    order by r.started_at, r.id`);
  for (const r of runs.rows) {
    const started = new Date(iso(r.started_at));
    const live = r.status === "running" && r.ended_at == null;
    at(r.project_id)?.runs.push({
      agent: String(r.agent),
      role: String(r.role),
      ticket: (r.task_key as string | null) ?? null,
      title: (r.title as string | null) ?? null,
      from: (started < from ? from : started).toISOString(),
      to: live ? null : r.ended_at ? iso(r.ended_at) : null,
      status: String(r.status),
    });
  }

  const events: { projectId: unknown; e: HistoryEvent }[] = [];

  // 2. Thread messages in project threads: deliveries and proposals posted, and messages acted on.
  const msgs = await db.execute<Record<string, unknown>>(sql`
    select th.project_id, m.author_agent, m.author_role, m.body, m.links, m.proposal, m.at, m.action_state
    from thread_messages m join threads th on th.id = m.thread_id
    where th.kind = 'project' and th.project_id is not null and m.author_agent <> 'jorge'
      and ((m.at >= ${f}::timestamptz and m.at <= ${t}::timestamptz)
        or (m.action_state is not null and (m.action_state->>'at')::timestamptz between ${f}::timestamptz and ${t}::timestamptz))`);
  for (const m of msgs.rows) {
    const when = new Date(iso(m.at));
    const inWindow = when >= from && when <= to;
    const links = (m.links as { kind: string; title: string }[] | null) ?? [];
    const proposal = m.proposal as { title?: string } | null;
    const role = String(m.author_role);
    if (inWindow && proposal) events.push({ projectId: m.project_id, e: { at: when.toISOString(), kind: "asked", role, title: cut(proposal.title ?? firstLine(String(m.body))) } });
    else if (inWindow) {
      const link = links.find((l) => l.kind === "doc" || l.kind === "pr" || l.kind === "idea");
      if (link) events.push({ projectId: m.project_id, e: { at: when.toISOString(), kind: "delivered", role, title: cut(link.title || firstLine(String(m.body))) } });
    }
    const state = m.action_state as { at?: string } | null;
    if (state?.at) {
      const acted = new Date(state.at);
      if (acted >= from && acted <= to) {
        const title = proposal?.title ?? links.find((l) => l.kind !== "question")?.title ?? firstLine(String(m.body));
        events.push({ projectId: m.project_id, e: { at: acted.toISOString(), kind: "answered", role: "jorge", title: cut(title) } });
      }
    }
  }

  // 3. Questions asked and answered (the asker's role from the roster, by the actor's agent slug).
  const qs = await db.execute<Record<string, unknown>>(sql`
    select q.project_id, q.question, q.asked_at, q.answered_at, a.role, a.role_template, a.slug, a.capabilities
    from questions q left join agents a on a.slug = lower(q.asked_by->>'agent')
    where q.asked_at between ${f}::timestamptz and ${t}::timestamptz or q.answered_at between ${f}::timestamptz and ${t}::timestamptz`);
  for (const q of qs.rows) {
    const title = cut(String(q.question));
    const asked = new Date(iso(q.asked_at));
    const role = q.role_template ? String(q.role_template) : q.role ? String(q.role) : "equipo";
    if (asked >= from && asked <= to) events.push({ projectId: q.project_id, e: { at: asked.toISOString(), kind: "asked", role, title } });
    if (q.answered_at) {
      const answered = new Date(iso(q.answered_at));
      if (answered >= from && answered <= to) events.push({ projectId: q.project_id, e: { at: answered.toISOString(), kind: "answered", role: "jorge", title } });
    }
  }

  // 4. Orders from the screen.
  const orders = await db.execute<Record<string, unknown>>(sql`
    select project_id, title, created_at from tasks
    where origin = 'jorge' and created_at between ${f}::timestamptz and ${t}::timestamptz`);
  for (const o of orders.rows) events.push({ projectId: o.project_id, e: { at: iso(o.created_at), kind: "ordered", role: "jorge", title: cut(String(o.title)) } });

  const ORDER: Record<HistoryEventKind, number> = { ordered: 0, asked: 1, answered: 2, delivered: 3 };
  for (const { projectId, e } of events.sort((a, b) => a.e.at.localeCompare(b.e.at) || ORDER[a.e.kind] - ORDER[b.e.kind])) at(projectId)?.events.push(e);
  return { from: from.toISOString(), to: to.toISOString(), projects: [...out.values()] };
}
