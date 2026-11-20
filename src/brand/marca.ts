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
import { isVariant, knotOf, surfacesOf } from "./surfaces.js";
import { staleRows } from "./pedido.js";
import { and, desc, gte, ilike, notInArray, or } from "drizzle-orm";
import { appTheme, logoTheme, sameColor } from "./theme.js";
import { styleOf } from "./style.js";
import { latestStills } from "../captures/store.js";
import { tasks } from "../db/schema.js";

export type MarcaCandidate = { path: string; variant: "icon" | "mark"; mime: string; inUse: boolean };
export type MarcaRead = {
  slug: string;
  logo: (LogoRef & { versions: number; chosen: boolean; at: string; theme: string | null }) | null;
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
  /** PLA-I69-3: the extra surfaces switched on (avisos, atajos, capturas, prueba), and whether El Probador has stills. */
  extras: Partial<Record<"avisos" | "atajos" | "capturas" | "prueba", boolean>>;
  stills: { narrow: number; wide: number };
  /** PLA-I66-4: the open ticket that brings icon files, and the rows it carries. */
  pedido: { key: string; status: string; rows: string[] } | null;
  /** PLA-I66-4: the repo shows another logo while the owner's choice leads. */
  drift: { path: string; sha: string } | null;
  checkedAt: string;
  /** PLA-122: the surfaces with their own icon (the tile file, to show on its card). PLA-I69-1: at, when it was made. */
  surfaces: Partial<Record<"iphone" | "android" | "navegador", SurfaceRead>>;
  /** PLA-I69-2: the last icons requests, newest first (a surface's history names the ones that carried it). */
  requests: { key: string; status: string; rows: string[]; at: string; pr: string | null }[];
  /** PLA-I69-1: the icons request in flight, or the last one (14 days): where it is on its way to the repo. */
  trip: Trip | null;
};

// PLA-I69-1: the stations of an icons request, in order. step is the one it waits at (6: every station passed).
export const TRIP_STATIONS = ["armado", "pr", "qa", "aceptas", "rama", "visto"] as const;
// PLA-I69-2: how a surface follows the logo, and whether its own picture predates the logo (knot: it asks).
export type SurfaceRead = { mode: "variante" | "propia"; file: string | null; bg: string | null; scale: number; at: string; logoV: number | null; knot: boolean };
export type Trip = { key: string; status: string; step: number; cancelled: boolean; pr: string | null; rows: string[]; at: string; movedAt: string | null };

type BaseRead = Omit<MarcaRead, "logo" | "pedido" | "surfaces" | "trip" | "requests">;
// PLA-I69-2: the repo part (git tree, the checklist, candidates) is kept per commit; the judgement on top of it (which
// files are from an older logo or colour, the drift question) is kept per logo, surfaces and colour, so changing how a
// surface follows the logo re-judges in a moment instead of reading the repo again.
type Part = { pre: BaseRead; read: ((f: string) => Promise<Buffer | null>) | null; best: { path: string; bytes: Buffer } | null };
type Cached = { commit: string | null; at: number; files: Set<string>; part: Part; judged: { key: string; read: BaseRead } | null; judging?: { key: string; p: Promise<BaseRead> } };

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
const RECENT_MS = 14 * 24 * 3600_000;
/** PLA-I69-3: how many phone and desktop stills El Probador has for the project (install screenshots come from them). */
async function stillCount(db: Db, slug: string): Promise<{ narrow: number; wide: number }> {
  try {
    const r = await latestStills(db, slug);
    const pages = r?.pages ?? [];
    return { narrow: pages.filter((x) => x.phone.still).length, wide: pages.filter((x) => x.desktop.still).length };
  } catch {
    return { narrow: 0, wide: 0 };
  }
}
async function lastRequest(db: Db, projectId: string, now: number): Promise<Omit<Trip, "step"> & { merged: boolean; review: boolean } | null> {
  const [t] = await db
    .select({ key: tasks.key, status: tasks.status, scope: tasks.scope, prUrl: tasks.prUrl, createdAt: tasks.createdAt, movedAt: tasks.statusChangedAt })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), ilike(tasks.scope, "%<!-- plania:marca set=%"), or(notInArray(tasks.status, ["Merged", "Released", "Done", "Won't do"]), gte(tasks.updatedAt, new Date(now - RECENT_MS)))))
    .orderBy(desc(tasks.createdAt))
    .limit(1);
  const m = t?.scope?.match(REQ);
  if (!t || !m) return null;
  return {
    key: t.key,
    status: t.status,
    cancelled: t.status === "Won't do",
    pr: t.prUrl ?? null,
    rows: m[2]!.split(",").filter(Boolean),
    at: t.createdAt.toISOString(),
    movedAt: t.movedAt ? t.movedAt.toISOString() : null,
    merged: ["Merged", "Released", "Done"].includes(t.status),
    review: t.status === "In review",
  };
}
/** Where a request is: built (0 passed), a PR, QA, the owner's acceptance, on the start branch, read back by Plania. */
// A merged request whose files still differ after a while (the rules moved on, or Taller placed something else) is
// seen anyway: the pending reasons say what differs, the trip does not wait forever.
const SEEN_AFTER_MS = 10 * 60_000;
export function tripStep(r: { pr: string | null; merged: boolean; review: boolean; movedAt?: string | null }, rowsNow: Row[], carried: string[], now = Date.now()): number {
  if (r.merged) {
    const seen = carried.every((id) => { const row = rowsNow.find((x) => x.id === id); return !row || row.state === "ok"; });
    const long = !!r.movedAt && now - Date.parse(r.movedAt) > SEEN_AFTER_MS;
    return seen || long ? 6 : 5;
  }
  if (r.review) return 3;
  return r.pr ? 2 : 1;
}

const cache = new Map<string, Cached>();
const reading = new Map<string, Promise<Cached>>();
export const forgetMarca = (): void => cache.clear();

async function logoRef(db: Db, projectId: string): Promise<MarcaRead["logo"]> {
  const l = await activeLogo(db, projectId);
  if (!l) return null;
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(projectLogos).where(eq(projectLogos.projectId, projectId));
  return { v: l.version, file: l.file, mime: l.mime, variant: l.variant, colors: l.colors, source: l.source, path: l.sourcePath, versions: Number(n), chosen: l.chosen, at: l.createdAt.toISOString(), theme: logoTheme(l) };
}

async function readRepo(db: Db, p: Project, deps: LogoDeps): Promise<Cached> {
  const git = deps.git ?? realGit;
  const now = (deps.now ?? Date.now)();
  const branch = startBranchOf(p.settings);
  const base = { slug: p.slug, folder: repoPathOf(p.slug, p.settings, deps.env), native: !!p.settings?.marca?.native, extras: p.settings?.marca?.extras ?? {}, stills: await stillCount(db, p.slug), branch, root: "", candidates: [] as MarcaCandidate[], splash: null as string | null, drift: null as MarcaRead["drift"], checkedAt: new Date(now).toISOString() };
  const scan = await scanProjectLogo(db, p, deps);
  const hasOriginal = !!(await activeLogo(db, p.id));
  if (scan.status === "no_repo" || !scan.commit) {
    const { rows } = await checkRepo({ paths: new Map(), read: async () => null }, { hasOriginal, slug: p.slug });
    return { commit: null, at: now, files: new Set(), judged: null, part: { pre: { ...base, repo: p.settings?.local?.no_code ? "no_code" : "none", ref: null, commit: null, framework: null, rows }, read: null, best: null } };
  }
  const repo = repoPathOf(p.slug, p.settings, deps.env);
  const commit = scan.commit;
  const tree = await listTree(git, repo, commit);
  const view = { paths: tree, read: (f: string) => readBlob(git, repo, commit, f) };
  const check = await checkRepo(view, { hasOriginal, slug: p.slug, native: !!p.settings?.marca?.native, extras: p.settings?.marca?.extras ?? {} });
  const current = await activeLogo(db, p.id);
  const { candidates } = detectLogo(await filesAt(git, repo, commit, p.slug, tree), p.slug);
  const files = new Set<string>([...check.rows.map((r) => r.path).filter((x): x is string => !!x && tree.has(x)), ...candidates.map((c) => c.path)]);
  // Launch screens are a folder: the first image stands for them on the card.
  const splash = [...tree.keys()].find((f) => /apple-splash|startup|launch/i.test(f) && f.endsWith(".png") && f.startsWith(`${check.root}public/`));
  if (splash) files.add(splash);
  return {
    commit,
    at: now,
    files,
    judged: null,
    part: {
      pre: {
        ...base,
        repo: "ok",
        ref: null,
        commit,
        framework: check.framework,
        root: check.root,
        rows: check.rows,
        splash: splash ?? null,
        drift: null,
        candidates: candidates.slice(0, 6).map((c) => ({ path: c.path, variant: c.variant, mime: c.mime, inUse: current?.source === "repo" && current.sourcePath === c.path })),
      },
      read: view.read,
      best: candidates[0] ? { path: candidates[0].path, bytes: candidates[0].bytes } : null,
    },
  };
}

/** The judgement on the repo part: files from an older logo or colour, and the drift question. */
async function judge(p: Project, part: Part, current: Awaited<ReturnType<typeof activeLogo>>): Promise<BaseRead> {
  const pre = part.pre;
  if (pre.repo !== "ok" || !part.read) return pre;
  let rows = pre.rows;
  // PLA-128: a sound icon made from an older logo reads «viejo» («del logo anterior»), so the door offers to redo it.
  if (current && pre.framework) {
    const old = await staleRows({ slug: p.slug, title: p.title, rows, framework: pre.framework, root: pre.root, native: pre.native, logo: current, read: part.read });
    if (old.length) rows = rows.map((r) => (old.includes(r.id) ? { ...r, state: "viejo" as const, checks: [...r.checks, { k: "old_logo", ok: false }] } : r));
    // PLA-I69-1: the manifest's colour follows a logo the owner chose; one still on another colour reads old.
    const want = appTheme(styleOf(p.slug), current);
    rows = rows.map((r) => {
      if (r.id !== "man" || r.state !== "ok" || !want) return r;
      const have = r.checks.find((c) => c.k === "man_colors")?.v?.theme;
      return typeof have === "string" && !sameColor(have, want) ? { ...r, state: "viejo" as const, checks: [...r.checks, { k: "old_color", ok: false, v: { have, want } }] } : r;
    });
  }
  // PLA-I66-4: the owner's choice leads, and the repo's best logo is another picture (not the same logo regenerated).
  let drift: MarcaRead["drift"] = null;
  const best = part.best;
  // PLA-122: with a browser icon of its own, the repo's icon.svg is that one, not a logo changed behind the owner's back.
  if (current?.chosen && best && !surfacesOf(p.slug).navegador && !(current.source === "repo" && current.sourcePath === best.path)) {
    const sha = createHash("sha256").update(best.bytes).digest("hex");
    const mine = readLogoFile(p.slug, current.file);
    if (sha !== current.adjust?.keptOver && mine && !(await looksSame(mine, best.bytes))) drift = { path: best.path, sha };
  }
  return { ...pre, rows, drift };
}
const surfacesStamp = (slug: string): string => JSON.stringify(surfacesOf(slug));

/** The Marca door's read for a project, or null when there is no such project. */
export async function marcaRead(db: Db, slug: string, deps: LogoDeps = {}): Promise<MarcaRead | null> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return null;
  const now = (deps.now ?? Date.now)();
  let c = cache.get(p.id);
  if (!c || now - c.at >= RECHECK_MS || deps.fresh) {
    let flight = reading.get(p.id);
    if (!flight || deps.fresh) {
      flight = readRepo(db, p, deps).finally(() => reading.delete(p.id));
      reading.set(p.id, flight);
    }
    const next = await flight;
    cache.set(p.id, next);
    c = next;
  }
  const req = await openRequest(db, p.id);
  const active = await activeLogo(db, p.id);
  const st = styleOf(p.slug);
  const key = `${active?.id ?? ""}|${active?.version ?? 0}|${JSON.stringify(active?.adjust ?? null)}|${surfacesStamp(p.slug)}|${p.title}|${st ? `${st.brandTie}:${st.brand}` : ""}`;
  // Several reads at once (the screen asks for a few images right after a change) share one judgement.
  if (!c.judged || c.judged.key !== key) {
    if (!c.judging || c.judging.key !== key) c.judging = { key, p: judge(p, c.part, active) };
    const read = await c.judging.p;
    c.judged = { key, read };
  }
  const base = c.judged.read;
  const surfaces = Object.fromEntries(
    Object.entries(surfacesOf(p.slug)).map(([s, v]) => [
      s,
      isVariant(v)
        ? ({ mode: "variante", file: null, bg: v.bg, scale: v.scale, at: v.at, logoV: null, knot: false } satisfies SurfaceRead)
        : ({ mode: "propia", file: v!.file, bg: v!.bg, scale: v!.scale, at: v!.at, logoV: v!.logoV ?? null, knot: knotOf(v, active) } satisfies SurfaceRead),
    ]),
  );
  const reqRows = await db
    .select({ key: tasks.key, status: tasks.status, scope: tasks.scope, createdAt: tasks.createdAt, prUrl: tasks.prUrl })
    .from(tasks)
    .where(and(eq(tasks.projectId, p.id), ilike(tasks.scope, "%<!-- plania:marca set=%")))
    .orderBy(desc(tasks.createdAt))
    .limit(8);
  const requests = reqRows.map((t) => ({ key: t.key, status: t.status, rows: t.scope?.match(REQ)?.[2]?.split(",").filter(Boolean) ?? [], at: t.createdAt.toISOString(), pr: t.prUrl ?? null }));
  const last = await lastRequest(db, p.id, now);
  const trip: Trip | null = last ? { key: last.key, status: last.status, cancelled: last.cancelled, pr: last.pr, rows: last.rows, at: last.at, movedAt: last.movedAt, step: last.cancelled ? 0 : tripStep(last, base.rows, last.rows, now) } : null;
  return { ...base, logo: await logoRef(db, p.id), pedido: req ? { key: req.key, status: req.status, rows: req.rows } : null, surfaces, trip, requests };
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
  return c?.commit ? { commit: c.commit, paths: c.part.pre.candidates.map((x) => x.path) } : null;
}

/** Drops one project's read, so the next one reflects a change made from the screen. */
export const forgetMarcaOf = (projectId: string): void => {
  cache.delete(projectId);
};
