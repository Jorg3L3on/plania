// PLA-I66-2: what the Marca door shows for one project: its original, the checklist of icon files read from the start
// branch (src/brand/check.ts) and the other logo candidates in the repo. The read is kept per commit: the repo is read
// again only when the start branch moves (looked at, at most, once a minute), so a merge that adds a file turns its row
// green on the next look without anyone asking for it.
import { count, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projectLogos, projects, type Project } from "../db/schema.js";
import { repoPathOf } from "../runner/worktree.js";
import { startBranchOf } from "../runner/start-branch.js";
import { detectLogo } from "./detect.js";
import { checkRepo, type Framework, type Row } from "./check.js";
import { activeLogo, filesAt, listTree, readBlob, readLogoFile, realGit, RECHECK_MS, scanProjectLogo, type LogoDeps, type LogoRef } from "./logos.js";
import { createHash } from "node:crypto";
import { looksSame } from "./same.js";
import { surfacesOf } from "./surfaces.js";
import { staleRows } from "./pedido.js";
import { and, desc, ilike, notInArray } from "drizzle-orm";
import { tasks } from "../db/schema.js";

export type MarcaCandidate = { path: string; variant: "icon" | "mark"; mime: string; inUse: boolean };
export type MarcaRead = {
  slug: string;
  logo: (LogoRef & { versions: number; chosen: boolean }) | null;
  repo: "ok" | "none" | "no_code";
  /** PLA-120: the folder Plania reads the repo from (where it looked, when repo is "none"). */
  folder: string;
  branch: string;
  ref: string | null;
  commit: string | null;
  framework: Framework | null;
  root: string;
  rows: Row[];
  candidates: MarcaCandidate[];
  /** One of the launch screens, when the repo has them (the iPhone card shows it). */
  splash: string | null;
  /** PLA-I66-6: the switch that adds the native app icons and the launch screens. */
  native: boolean;
  /** PLA-I66-4: the open ticket that brings icon files, and the rows it carries. */
  pedido: { key: string; status: string; rows: string[] } | null;
  /** PLA-I66-4: the repo shows another logo while the owner's choice leads. */
  drift: { path: string; sha: string } | null;
  checkedAt: string;
  /** PLA-122: the surfaces with their own icon (the tile file, to show on its card). */
  surfaces: Partial<Record<"iphone" | "android" | "navegador", { file: string; bg: string | null; scale: number }>>;
};

type Cached = { commit: string | null; at: number; read: Omit<MarcaRead, "logo" | "pedido" | "surfaces">; files: Set<string> };

// PLA-I66-4: the open ticket bringing icon files (its marker: src/brand/pedido.ts). Kept here so the read needs no cycle.
// PLA-125: Merged or Released is delivered (on a branch-release project Done waits for the release to production).
const REQ = /<!-- plania:marca set=([0-9a-f]{16}) rows=([a-z0-9_,]*) -->/;
async function openRequest(db: Db, projectId: string): Promise<{ key: string; status: string; rows: string[] } | null> {
  const [t] = await db
    .select({ key: tasks.key, status: tasks.status, scope: tasks.scope })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), ilike(tasks.scope, "%<!-- plania:marca set=%"), notInArray(tasks.status, ["Merged", "Released", "Done", "Won't do"])))
    .orderBy(desc(tasks.createdAt))
    .limit(1);
  const m = t?.scope?.match(REQ);
  return t && m ? { key: t.key, status: t.status, rows: m[2]!.split(",").filter(Boolean) } : null;
}
const cache = new Map<string, Cached>();
export const forgetMarca = (): void => cache.clear();

async function logoRef(db: Db, projectId: string): Promise<MarcaRead["logo"]> {
  const l = await activeLogo(db, projectId);
  if (!l) return null;
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(projectLogos).where(eq(projectLogos.projectId, projectId));
  return { v: l.version, file: l.file, mime: l.mime, variant: l.variant, colors: l.colors, source: l.source, path: l.sourcePath, versions: Number(n), chosen: l.chosen };
}

async function readRepo(db: Db, p: Project, deps: LogoDeps): Promise<Cached> {
  const git = deps.git ?? realGit;
  const now = (deps.now ?? Date.now)();
  const branch = startBranchOf(p.settings);
  const base = { slug: p.slug, folder: repoPathOf(p.slug, p.settings, deps.env), native: !!p.settings?.marca?.native, branch, root: "", candidates: [] as MarcaCandidate[], splash: null as string | null, drift: null as MarcaRead["drift"], checkedAt: new Date(now).toISOString() };
  const scan = await scanProjectLogo(db, p, deps);
  const hasOriginal = !!(await activeLogo(db, p.id));
  if (scan.status === "no_repo" || !scan.commit) {
    const { rows } = await checkRepo({ paths: new Map(), read: async () => null }, { hasOriginal, slug: p.slug });
    return { commit: null, at: now, files: new Set(), read: { ...base, repo: p.settings?.local?.no_code ? "no_code" : "none", ref: null, commit: null, framework: null, rows } };
  }
  const repo = repoPathOf(p.slug, p.settings, deps.env);
  const commit = scan.commit;
  const tree = await listTree(git, repo, commit);
  const view = { paths: tree, read: (f: string) => readBlob(git, repo, commit, f) };
  const check = await checkRepo(view, { hasOriginal, slug: p.slug, native: !!p.settings?.marca?.native });
  const current = await activeLogo(db, p.id);
  // PLA-128: a sound icon made from an older logo reads «viejo» («del logo anterior»), so the door offers to redo it.
  if (current && check.framework) {
    const old = await staleRows({ slug: p.slug, title: p.title, rows: check.rows, framework: check.framework, root: check.root, native: !!p.settings?.marca?.native, logo: current, read: view.read });
    if (old.length) check.rows = check.rows.map((r) => (old.includes(r.id) ? { ...r, state: "viejo" as const, checks: [...r.checks, { k: "old_logo", ok: false }] } : r));
  }
  const { candidates } = detectLogo(await filesAt(git, repo, commit, p.slug, tree), p.slug);
  // PLA-I66-4: the owner's choice leads, and the repo's best logo is another picture (not the same logo regenerated).
  let drift: MarcaRead["drift"] = null;
  const best = candidates[0];
  // PLA-122: with a browser icon of its own, the repo's icon.svg is that one, not a logo changed behind the owner's back.
  if (current?.chosen && best && !surfacesOf(p.slug).navegador && !(current.source === "repo" && current.sourcePath === best.path)) {
    const sha = createHash("sha256").update(best.bytes).digest("hex");
    const mine = readLogoFile(p.slug, current.file);
    if (sha !== current.adjust?.keptOver && mine && !(await looksSame(mine, best.bytes))) drift = { path: best.path, sha };
  }
  const files = new Set<string>([...check.rows.map((r) => r.path).filter((x): x is string => !!x && tree.has(x)), ...candidates.map((c) => c.path)]);
  // Launch screens are a folder: the first image stands for them on the card.
  const splash = [...tree.keys()].find((f) => /apple-splash|startup|launch/i.test(f) && f.endsWith(".png") && f.startsWith(`${check.root}public/`));
  if (splash) files.add(splash);
  return {
    commit,
    at: now,
    files,
    read: {
      ...base,
      repo: "ok",
      ref: null,
      commit,
      framework: check.framework,
      root: check.root,
      rows: check.rows,
      splash: splash ?? null,
      drift,
      candidates: candidates.slice(0, 6).map((c) => ({ path: c.path, variant: c.variant, mime: c.mime, inUse: current?.source === "repo" && current.sourcePath === c.path })),
    },
  };
}

/** The Marca door's read for a project, or null when there is no such project. */
export async function marcaRead(db: Db, slug: string, deps: LogoDeps = {}): Promise<MarcaRead | null> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return null;
  const now = (deps.now ?? Date.now)();
  let c = cache.get(p.id);
  if (!c || now - c.at >= RECHECK_MS || deps.fresh) {
    const next = await readRepo(db, p, deps);
    cache.set(p.id, next);
    c = next;
  }
  const req = await openRequest(db, p.id);
  const surfaces = Object.fromEntries(Object.entries(surfacesOf(p.slug)).map(([s, v]) => [s, { file: v!.file, bg: v!.bg, scale: v!.scale }]));
  return { ...c.read, logo: await logoRef(db, p.id), pedido: req ? { key: req.key, status: req.status, rows: req.rows } : null, surfaces };
}

/** A file of the repo that the last read showed (a card's real file), at that read's commit. */
export async function marcaFile(db: Db, slug: string, file: string, deps: LogoDeps = {}): Promise<{ bytes: Buffer; mime: string } | null> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return null;
  const c = cache.get(p.id);
  if (!c?.commit || !c.files.has(file)) return null;
  const mime = file.endsWith(".png") ? "image/png" : file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".ico") ? "image/x-icon" : null;
  if (!mime) return null;
  const bytes = await readBlob(deps.git ?? realGit, repoPathOf(p.slug, p.settings, deps.env), c.commit, file);
  return bytes ? { bytes, mime } : null;
}

/** The candidates the last read listed, and its commit (picking another logo reads only from these). */
export function marcaCandidates(projectId: string): { commit: string; paths: string[] } | null {
  const c = cache.get(projectId);
  return c?.commit ? { commit: c.commit, paths: c.read.candidates.map((x) => x.path) } : null;
}

/** Drops one project's read, so the next one reflects a change made from the screen. */
export const forgetMarcaOf = (projectId: string): void => {
  cache.delete(projectId);
};
