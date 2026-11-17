// PLA-I47-1: what La ficha's tabs read for one project (Plan doc of PLA-IDEA13, answer 1).
//   GET /api/company/projects/:slug/ficha → {slug, counts, ideas[], prs[], docs[], designs[]}
//   ideas[]   open ideas, newest first: key, title, stage, waits (ideaWaits), updated_at, docs {Idea, Research, Design, Plan} ids
//   prs[]     the project's pull requests, newest first, at most 20
//   docs[]    the project's docs (task docs and project docs), newest first, at most 30, never the markdown
//   designs[] the lienzo links written in the Design docs of the project's ideas
// Read only; the owner's session like the rest of /api/company. projectDocRead serves one doc of one project.
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { ideaWaits } from "../mcp/ideas.js";
import { ideasWithFrames, unseenByIdea } from "./company-idea.js";

export const FICHA_LIMITS = { ideas: 30, prs: 20, docs: 30, designs: 20 } as const;
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
};

export function artifactLinks(markdown: string): string[] {
  return [...new Set(markdown.match(ARTIFACT_URL) ?? [])];
}

async function projectId(db: Db, slug: string): Promise<string> {
  const [p] = await rows(db, sql`select id from projects where slug = ${slug} limit 1`);
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: slug });
  return String(p.id);
}

export async function fichaRead(db: Db, slug: string): Promise<Ficha> {
  const id = await projectId(db, slug);

  const ideaRows = await rows(
    db,
    sql`select t.id, t.key, t.title, t.summary, t.stage, t.updated_at from tasks t
        where t.project_id = ${id} and t.kind = 'idea' and t.status = 'Open'
        order by t.updated_at desc, t.key limit ${FICHA_LIMITS.ideas}`,
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
    };
  });

  const prRows = await rows(
    db,
    sql`select pr.number, pr.title, pr.url, pr.state, pr.ci_state, pr.merged_at, pr.head_branch, t.key as task_key
        from pull_requests pr left join tasks t on t.id = pr.task_id
        where pr.project_id = ${id}
        order by coalesce(pr.gh_updated_at, pr.updated_at) desc, pr.number desc limit ${FICHA_LIMITS.prs}`,
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
        where d.project_id = ${id} order by d.updated_at desc, d.title limit ${FICHA_LIMITS.docs}`,
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
    designs: allDesigns.slice(0, FICHA_LIMITS.designs),
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
