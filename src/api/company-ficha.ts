// PLA-I47-1: what La ficha's tabs read for one project (Plan doc of PLA-IDEA13, answer 1).
//   GET /api/company/projects/:slug/ficha → {slug, counts, ideas[], prs[], docs[], designs[]}
//   ideas[]   open ideas, newest first: key, title, stage, waits (ideaWaits), updated_at, docs {Idea, Research, Design, Plan} ids
//   prs[]     the project's pull requests, newest first, at most 20
//   docs[]    the project's docs (task docs and project docs), newest first, at most 30, never the markdown
//   designs[] the lienzo links written in the Design docs of the project's ideas
// Read only; the owner's session like the rest of /api/company. projectDocRead serves one doc of one project.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { tasks } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { screenTz } from "../runner/limits.js";
import { ideaWaits } from "../mcp/ideas.js";
import { ideasWithFrames, unseenByIdea } from "./company-idea.js";
import { factsOf, pedidoOf, type PedidoState, type PedidoStop } from "./company-pedidos.js";

export const FICHA_LIMITS = { ideas: 30, prs: 20, docs: 30, designs: 20 } as const;
// PLA-I64-6: Archivo reads every doc and PR (titles only), so the one opened is always the one clicked.
export const ARCHIVO_LIMITS = { ideas: 30, prs: 1000, docs: 2000, designs: 200 } as const;
const STAGE_DOC_TITLES = ["Idea", "Research", "Design", "Plan"] as const;
// A lienzo is a claude.ai artifact link (claude.ai/artifact/<id> or claude.ai/code/artifact/<uuid>).
const ARTIFACT_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/g;

type Row = Record<string, unknown>;
const rows = async (db: Db, query: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(query)).rows as Row[];
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

export type FichaIdea = {
  key: string;
  title: string;
  stage: string | null;
  waits: string | null;
  updated_at: string;
  docs: Record<(typeof STAGE_DOC_TITLES)[number], string | null>;
  // PLA-I61-3: the summary the PO wrote, the stops it passed (stage index) and what the owner has not opened.
  summary: string;
  unseen: number;
  // PLA-I64-1: the initiative it became (then it is not a row of its own), who asked (jorge: a pedido), and for an
  // idea not promoted yet its stop and state as the tube reads them (src/api/company-pedidos.ts), shelf and question.
  promoted_to: string | null;
  origin: string | null;
  stop: PedidoStop | null;
  state: PedidoState | null;
  guardada: boolean;
  question: { id: string; text: string } | null;
};
// PLA-I61-2: an idea whose design lives in Plania (Artist's frames), for the Diseño tab.
export type FichaLienzo = { key: string; title: string; count: number; thumbs: string[]; unseen: number };
export type FichaPr = {
  number: number;
  title: string;
  url: string;
  state: string;
  ci_state: string | null;
  task_key: string | null;
  merged_at: string | null;
  head_branch: string | null;
};
export type FichaDoc = { id: string; title: string; task_key: string | null; updated_at: string };
export type FichaDesign = { idea_key: string; doc_id: string; url: string };
export type Ficha = {
  slug: string;
  counts: { ideas: number; prs: number; docs: number; designs: number };
  ideas: FichaIdea[];
  prs: FichaPr[];
  docs: FichaDoc[];
  designs: FichaDesign[];
  lienzos: FichaLienzo[];
  // PLA-I64-1: every idea of the project that became an initiative (any status), so an initiative carries its idea.
  promoted: { idea: string; initiative: string }[];
};

export function artifactLinks(markdown: string): string[] {
  return [...new Set(markdown.match(ARTIFACT_URL) ?? [])];
}

async function projectId(db: Db, slug: string): Promise<string> {
  const [p] = await rows(db, sql`select id from projects where slug = ${slug} limit 1`);
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: slug });
  return String(p.id);
}

export async function fichaRead(db: Db, slug: string, opts: { all?: boolean } = {}): Promise<Ficha> {
  const id = await projectId(db, slug);
  const L = opts.all ? ARCHIVO_LIMITS : FICHA_LIMITS;

  const ideaRows = await rows(
    db,
    sql`select t.id, t.key, t.title, t.summary, t.stage, t.updated_at, t.promoted_to, t.origin from tasks t
        where t.project_id = ${id} and t.kind = 'idea' and t.status = 'Open'
        order by (t.promoted_to is not null), t.updated_at desc, t.key limit ${L.ideas}`,
  );
  const [ideaCount] = await rows(db, sql`select count(*)::int as n from tasks where project_id = ${id} and kind = 'idea' and status = 'Open'`);
  const ideaIds = ideaRows.map((r) => String(r.id));
  const stageDocs = ideaIds.length
    ? await rows(
        db,
        sql`select d.id, d.task_id, d.title from docs d
            where d.task_id in (${sql.join(ideaIds.map((x) => sql`${x}`), sql`, `)})
              and d.title in (${sql.join(STAGE_DOC_TITLES.map((t) => sql`${t}`), sql`, `)})`,
      )
    : [];
  const waits = ideaIds.length ? await ideaWaits(db, id) : new Map<string, string>();
  const unseen = await unseenByIdea(db, slug, ideaRows.map((r) => String(r.key)));
  // PLA-I64-1: the tube's stop and state for every open idea not promoted yet (any origin).
  const loose = ideaRows.filter((r) => !r.promoted_to).map((r) => String(r.id));
  const looseTasks = loose.length ? await db.select().from(tasks).where(and(eq(tasks.projectId, id), inArray(tasks.id, loose))) : [];
  const facts = looseTasks.length ? await factsOf(db, id, looseTasks) : null;
  const tube = new Map<string, Awaited<ReturnType<typeof pedidoOf>>>();
  for (const t of looseTasks) tube.set(t.key, await pedidoOf(db, id, t, facts!));
  const promotedRows = await rows(db, sql`select key, promoted_to from tasks where project_id = ${id} and kind = 'idea' and promoted_to is not null order by key`);
  const ideas: FichaIdea[] = ideaRows.map((r) => {
    const mine = stageDocs.filter((d) => String(d.task_id) === String(r.id));
    const docs = Object.fromEntries(
      STAGE_DOC_TITLES.map((t) => {
        const found = mine.find((d) => d.title === t);
        return [t, found ? String(found.id) : null];
      }),
    ) as FichaIdea["docs"];
    return {
      key: String(r.key),
      title: String(r.title),
      stage: (r.stage as string | null) ?? null,
      waits: waits.get(String(r.key)) ?? null,
      updated_at: iso(r.updated_at)!,
      docs,
      summary: String(r.summary ?? ""),
      unseen: unseen[String(r.key)] ?? 0,
      promoted_to: (r.promoted_to as string | null) ?? null,
      origin: (r.origin as string | null) ?? null,
      stop: tube.get(String(r.key))?.stop ?? null,
      state: tube.get(String(r.key))?.state ?? null,
      guardada: tube.get(String(r.key))?.guardada ?? false,
      question: tube.get(String(r.key))?.question ?? null,
    };
  });

  const prRows = await rows(
    db,
    sql`select pr.number, pr.title, pr.url, pr.state, pr.ci_state, pr.merged_at, pr.head_branch, t.key as task_key
        from pull_requests pr left join tasks t on t.id = pr.task_id
        where pr.project_id = ${id}
        order by coalesce(pr.gh_updated_at, pr.updated_at) desc, pr.number desc limit ${L.prs}`,
  );
  const [prCount] = await rows(db, sql`select count(*)::int as n from pull_requests where project_id = ${id}`);
  const prs: FichaPr[] = prRows.map((r) => ({
    number: Number(r.number),
    title: String(r.title),
    url: String(r.url),
    state: String(r.state),
    ci_state: (r.ci_state as string | null) ?? null,
    task_key: (r.task_key as string | null) ?? null,
    merged_at: iso(r.merged_at),
    head_branch: (r.head_branch as string | null) ?? null,
  }));

  const docRows = await rows(
    db,
    sql`select d.id, d.title, d.updated_at, t.key as task_key from docs d left join tasks t on t.id = d.task_id
        where d.project_id = ${id} order by d.updated_at desc, d.title limit ${L.docs}`,
  );
  const [docCount] = await rows(db, sql`select count(*)::int as n from docs where project_id = ${id}`);
  const docs: FichaDoc[] = docRows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    task_key: (r.task_key as string | null) ?? null,
    updated_at: iso(r.updated_at)!,
  }));

  // Every idea of the project (not only open ones): a lienzo stays useful after its idea is promoted.
  const designRows = await rows(
    db,
    sql`select d.id, d.markdown, t.key from docs d join tasks t on t.id = d.task_id
        where d.project_id = ${id} and t.kind = 'idea' and d.title = 'Design'
        order by d.updated_at desc, t.key`,
  );
  const allDesigns: FichaDesign[] = designRows.flatMap((r) =>
    artifactLinks(String(r.markdown)).map((url) => ({ idea_key: String(r.key), doc_id: String(r.id), url })),
  );

  // PLA-I61-2: ideas carrying Artist's frames count as a design too (once per idea, with or without a link).
  const framed = await ideasWithFrames(db, id, slug);
  const lienzos: FichaLienzo[] = framed.map((f) => ({ ...f, unseen: unseen[f.key] ?? 0 }));
  const linkOnly = new Set(allDesigns.map((d) => d.idea_key).filter((k) => !framed.some((f) => f.key === k)));
  return {
    slug,
    counts: { ideas: Number(ideaCount?.n ?? 0), prs: Number(prCount?.n ?? 0), docs: Number(docCount?.n ?? 0), designs: lienzos.length + linkOnly.size },
    lienzos,
    ideas,
    prs,
    docs,
    designs: allDesigns.slice(0, L.designs),
    promoted: promotedRows.map((r) => ({ idea: String(r.key), initiative: String(r.promoted_to) })),
  };
}

// One doc of one project, task doc or project doc, read-only (La ficha's doc detail).
export async function projectDocRead(db: Db, slug: string, docId: string): Promise<{ id: string; title: string; version: number; markdown: string; task_key: string | null }> {
  const [doc] = await rows(
    db,
    sql`select d.id, d.title, d.version, d.markdown, t.key as task_key
        from docs d join projects p on p.id = d.project_id left join tasks t on t.id = d.task_id
        where d.id = ${docId} and p.slug = ${slug}`,
  );
  if (!doc) throw new ToolError("DOC_NOT_FOUND", { doc_id: docId });
  return { id: String(doc.id), title: String(doc.title), version: Number(doc.version), markdown: String(doc.markdown), task_key: (doc.task_key as string | null) ?? null };
}

// PLA-I64-3: el pulso, steps done per day over the last `days` days (default 14) in the screen's time zone, oldest
// first, every day present (0 when nothing landed). A step counts on the day it landed (Merged, Released or Done:
// resolved_at, else its last status change), once. Initiatives and ideas are not steps.
export type Pulso = { days: { day: string; n: number }[]; total: number; tz: string };
export async function pulsoRead(db: Db, slug: string, opts: { days?: number; tz?: string; now?: Date } = {}): Promise<Pulso> {
  const id = await projectId(db, slug);
  const days = Math.min(Math.max(opts.days ?? 14, 1), 90);
  const tz = opts.tz ?? screenTz();
  const now = opts.now ?? new Date();
  const out = await rows(
    db,
    sql`with span as (
          select generate_series((${now}::timestamptz at time zone ${tz})::date - (${days - 1})::int, (${now}::timestamptz at time zone ${tz})::date, interval '1 day')::date as day
        ), landed as (
          select (coalesce(resolved_at, status_changed_at, updated_at) at time zone ${tz})::date as day
          from tasks where project_id = ${id} and kind = 'ticket' and status in ('Merged', 'Released', 'Done')
        )
        select to_char(s.day, 'YYYY-MM-DD') as day, count(l.day)::int as n from span s left join landed l on l.day = s.day group by s.day order by s.day`,
  );
  const list = out.map((r) => ({ day: String(r.day), n: Number(r.n) }));
  return { days: list, total: list.reduce((a, d) => a + d.n, 0), tz };
}

// PLA-I64-6: Hecho, what landed day by day. A window of `days` days ending on `until` (default today, screen time
// zone): the steps that landed each day (Merged, Released or Done; at most HECHO_TOP titles per day, the rest
// counted), the initiatives closed that day with their step count and the idea they were, and whether anything
// landed before the window (Ver antes).
export const HECHO_TOP = 6;
export type HechoDay = { day: string; n: number; steps: { key: string; title: string; parent: string | null }[]; more: number; initiatives: { key: string; title: string }[]; prs: number };
export type Hecho = {
  from: string;
  to: string;
  tz: string;
  total: number;
  days: HechoDay[];
  initiatives: { key: string; title: string; done_at: string; steps: number; idea: string | null; origin: string | null }[];
  before: string | null;
};
export async function hechoRead(db: Db, slug: string, opts: { until?: string; days?: number; tz?: string; now?: Date } = {}): Promise<Hecho> {
  const id = await projectId(db, slug);
  const tz = opts.tz ?? screenTz();
  const days = Math.min(Math.max(opts.days ?? 14, 1), 60);
  const now = opts.now ?? new Date();
  const to = String((await rows(db, sql`select to_char(coalesce(${opts.until ?? null}::date, (${now}::timestamptz at time zone ${tz})::date), 'YYYY-MM-DD') as to`))[0]!.to);
  const from = String((await rows(db, sql`select to_char(${to}::date - ${days - 1}::int, 'YYYY-MM-DD') as from`))[0]!.from);
  const landed = sql`(coalesce(t.resolved_at, t.status_changed_at, t.updated_at) at time zone ${tz})::date`;
  const steps = await rows(
    db,
    sql`select to_char(${landed}, 'YYYY-MM-DD') as day, t.key, t.title, p.key as parent
        from tasks t left join tasks p on p.id = t.parent_id
        where t.project_id = ${id} and t.kind = 'ticket' and t.status in ('Merged', 'Released', 'Done') and ${landed} between ${from}::date and ${to}::date
        order by coalesce(t.resolved_at, t.status_changed_at, t.updated_at) desc, t.key`,
  );
  const inis = await rows(
    db,
    sql`select to_char(${landed}, 'YYYY-MM-DD') as day, t.key, t.title, coalesce(t.resolved_at, t.status_changed_at, t.updated_at) as at,
          (select count(*)::int from tasks c where c.parent_id = t.id and c.kind = 'ticket' and c.status <> 'Won''t do') as steps,
          (select i.key from tasks i where i.project_id = t.project_id and i.kind = 'idea' and i.promoted_to = t.key limit 1) as idea,
          (select i.origin from tasks i where i.project_id = t.project_id and i.kind = 'idea' and i.promoted_to = t.key limit 1) as origin
        from tasks t
        where t.project_id = ${id} and t.kind = 'initiative' and t.status = 'Done' and ${landed} between ${from}::date and ${to}::date
        order by at desc, t.key`,
  );
  const prs = await rows(
    db,
    sql`select to_char((merged_at at time zone ${tz})::date, 'YYYY-MM-DD') as day, count(*)::int as n from pull_requests
        where project_id = ${id} and merged_at is not null and (merged_at at time zone ${tz})::date between ${from}::date and ${to}::date group by 1`,
  );
  const [prev] = await rows(
    db,
    sql`select to_char(max(${landed}), 'YYYY-MM-DD') as day from tasks t
        where t.project_id = ${id} and t.kind = 'ticket' and t.status in ('Merged', 'Released', 'Done') and ${landed} < ${from}::date`,
  );
  const byDay = new Map<string, HechoDay>();
  const dayOf = (d: string) => byDay.get(d) ?? (byDay.set(d, { day: d, n: 0, steps: [], more: 0, initiatives: [], prs: 0 }), byDay.get(d)!);
  for (const r of steps) {
    const d = dayOf(String(r.day));
    d.n++;
    if (d.steps.length < HECHO_TOP) d.steps.push({ key: String(r.key), title: String(r.title), parent: (r.parent as string | null) ?? null });
    else d.more++;
  }
  for (const r of inis) dayOf(String(r.day)).initiatives.push({ key: String(r.key), title: String(r.title) });
  for (const r of prs) dayOf(String(r.day)).prs = Number(r.n);
  return {
    from,
    to,
    tz,
    total: steps.length,
    days: [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)),
    initiatives: inis.map((r) => ({ key: String(r.key), title: String(r.title), done_at: iso(r.at)!, steps: Number(r.steps), idea: (r.idea as string | null) ?? null, origin: (r.origin as string | null) ?? null })),
    before: (prev?.day as string | null) ?? null,
  };
}
