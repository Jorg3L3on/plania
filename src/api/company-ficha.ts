// PLA-I47-1: what La ficha's tabs read for one project (Plan doc of PLA-IDEA13, answer 1).
//   GET /api/company/projects/:slug/ficha → {slug, counts, ideas[], prs[], docs[], designs[]}
//   ideas[]   open ideas, newest first: key, title, stage, waits (ideaWaits), updated_at, docs {Idea, Research, Design, Plan} ids
//   prs[]     the project's pull requests, newest first, at most 20
//   docs[]    the project's docs (task docs and project docs), newest first, at most 30, never the markdown
//   designs[] the lienzo links written in the Design docs of the project's ideas
// Read only; the owner's session like the rest of /api/company. projectDocRead serves one doc of one project.
import type { Db } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { ideaWaits } from "../mcp/ideas.js";
import { readerOf } from "../store/port.js";
import { ideasWithFrames, unseenByIdea } from "./company-idea.js";

export const FICHA_LIMITS = { ideas: 30, prs: 20, docs: 30, designs: 20 } as const;
const STAGE_DOC_TITLES = ["Idea", "Research", "Design", "Plan"] as const;
// A lienzo is a claude.ai artifact link (claude.ai/artifact/<id> or claude.ai/code/artifact/<uuid>).
const ARTIFACT_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/g;

const iso = (v: Date | null): string | null => (v == null ? null : v.toISOString());
// Text compared by code unit, as the store orders it.
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

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
  const p = slug == null ? undefined : await readerOf(db).get("projects", { slug });
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: slug });
  return p.id;
}

// The keys of the tasks a set of rows points at (for a left join on tasks).
async function keysOf(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  const ts = wanted.length ? await readerOf(db).find("tasks", { id: wanted }) : [];
  return new Map(ts.map((t) => [t.id, t.key]));
}

export async function fichaRead(db: Db, slug: string): Promise<Ficha> {
  const id = await projectId(db, slug);
  const r = readerOf(db);

  const openIdeas = await r.find("tasks", { projectId: id, kind: "idea", status: "Open" }, { orderBy: [{ column: "updatedAt", desc: true }, { column: "key" }] });
  const ideaRows = openIdeas.slice(0, FICHA_LIMITS.ideas);
  const ideaIds = ideaRows.map((t) => t.id);
  const stageDocs = ideaIds.length ? await r.find("docs", { taskId: ideaIds, title: [...STAGE_DOC_TITLES] }) : [];
  const waits = ideaIds.length ? await ideaWaits(db, id) : new Map<string, string>();
  const unseen = await unseenByIdea(db, slug, ideaRows.map((t) => t.key));
  const ideas: FichaIdea[] = ideaRows.map((t) => {
    const mine = stageDocs.filter((d) => d.taskId === t.id);
    const docs = Object.fromEntries(
      STAGE_DOC_TITLES.map((title) => {
        const found = mine.find((d) => d.title === title);
        return [title, found ? found.id : null];
      }),
    ) as FichaIdea["docs"];
    return {
      key: t.key,
      title: t.title,
      stage: t.stage ?? null,
      waits: waits.get(t.key) ?? null,
      updated_at: t.updatedAt.toISOString(),
      docs,
      summary: t.summary ?? "",
      unseen: unseen[t.key] ?? 0,
    };
  });

  // Newest first by GitHub's own clock when known, else the row's.
  const allPrs = (await r.find("pullRequests", { projectId: id })).sort(
    (a, b) => (b.ghUpdatedAt ?? b.updatedAt).getTime() - (a.ghUpdatedAt ?? a.updatedAt).getTime() || b.number - a.number,
  );
  const prRows = allPrs.slice(0, FICHA_LIMITS.prs);
  const prKeys = await keysOf(db, prRows.map((pr) => pr.taskId));
  const prs: FichaPr[] = prRows.map((pr) => ({
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    ci_state: pr.ciState ?? null,
    task_key: (pr.taskId && prKeys.get(pr.taskId)) || null,
    merged_at: iso(pr.mergedAt),
    head_branch: pr.headBranch ?? null,
  }));

  const allDocs = await r.find("docs", { projectId: id }, { orderBy: [{ column: "updatedAt", desc: true }, { column: "title" }] });
  const docRows = allDocs.slice(0, FICHA_LIMITS.docs);
  const docKeys = await keysOf(db, docRows.map((d) => d.taskId));
  const docs: FichaDoc[] = docRows.map((d) => ({
    id: d.id,
    title: d.title,
    task_key: (d.taskId && docKeys.get(d.taskId)) || null,
    updated_at: d.updatedAt.toISOString(),
  }));

  // Every idea of the project (not only open ones): a lienzo stays useful after its idea is promoted.
  const designDocs = await r.find("docs", { projectId: id, title: "Design" });
  const designIdeas = designDocs.length ? await r.find("tasks", { id: [...new Set(designDocs.map((d) => d.taskId).filter((x): x is string => !!x))], kind: "idea" }) : [];
  const ideaKey = new Map(designIdeas.map((t) => [t.id, t.key]));
  const designRows = designDocs
    .filter((d) => d.taskId && ideaKey.has(d.taskId))
    .map((d) => ({ id: d.id, markdown: d.markdown, at: d.updatedAt, key: ideaKey.get(d.taskId!)! }))
    .sort((a, b) => b.at.getTime() - a.at.getTime() || byText(a.key, b.key));
  const allDesigns: FichaDesign[] = designRows.flatMap((d) => artifactLinks(d.markdown).map((url) => ({ idea_key: d.key, doc_id: d.id, url })));

  // PLA-I61-2: ideas carrying Artist's frames count as a design too (once per idea, with or without a link).
  const framed = await ideasWithFrames(db, id, slug);
  const lienzos: FichaLienzo[] = framed.map((f) => ({ ...f, unseen: unseen[f.key] ?? 0 }));
  const linkOnly = new Set(allDesigns.map((d) => d.idea_key).filter((k) => !framed.some((f) => f.key === k)));
  return {
    slug,
    counts: { ideas: openIdeas.length, prs: allPrs.length, docs: allDocs.length, designs: lienzos.length + linkOnly.size },
    lienzos,
    ideas,
    prs,
    docs,
    designs: allDesigns.slice(0, FICHA_LIMITS.designs),
  };
}

// One doc of one project, task doc or project doc, read-only (La ficha's doc detail).
export async function projectDocRead(db: Db, slug: string, docId: string): Promise<{ id: string; title: string; version: number; markdown: string; task_key: string | null }> {
  const r = readerOf(db);
  const doc = docId == null ? undefined : await r.get("docs", { id: docId });
  const p = doc ? await r.get("projects", { id: doc.projectId }) : undefined;
  if (!doc || !p || p.slug !== slug) throw new ToolError("DOC_NOT_FOUND", { doc_id: docId });
  const t = doc.taskId ? await r.get("tasks", { id: doc.taskId }) : undefined;
  return { id: doc.id, title: doc.title, version: doc.version, markdown: doc.markdown, task_key: t?.key ?? null };
}
