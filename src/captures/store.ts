// PLA-I46-6: the capture store. Plania's evidence attachments are links only (results.attachments), so stills
// get the smallest local store that fits: PNG files under PLANIA_CAPTURES_DIR (default ~/plania-captures),
// one folder per project, each file named by its sha256 (the same image twice is one file); the rows in
// capture_stills say what each one is (page, viewport, commit, branch, ticket, time). Never in an app repo.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { captureStills, projects, tasks, type Actor, type CaptureStill } from "../db/schema.js";
import { VIEWPORT_NAMES, VIEWPORTS, type CaptureSettings, type ViewportName } from "./settings.js";

// Untied stills (no ticket) kept per page and viewport; stills tied to a ticket stay as its evidence.
export const KEEP_UNTIED = 5;
// Error rows older than this go; the latest error of a page and viewport always stays.
const ERROR_DAYS = 30;
const FILE = /^[0-9a-f]{64}\.png$/;

export function capturesDir(): string {
  return process.env.PLANIA_CAPTURES_DIR || path.join(homedir(), "plania-captures");
}

function projectDir(slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`bad project slug ${slug}`);
  return path.join(capturesDir(), slug);
}

// Writes the PNG once (content-addressed) and returns its file name.
export function putFile(slug: string, png: Buffer): string {
  const name = `${createHash("sha256").update(png).digest("hex")}.png`;
  const dir = projectDir(slug);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  if (!existsSync(target)) {
    const tmp = path.join(dir, `.${name}.${randomUUID()}.tmp`);
    writeFileSync(tmp, png);
    renameSync(tmp, target);
  }
  return name;
}

export function readFile(slug: string, file: string): Buffer | null {
  if (!FILE.test(file)) return null;
  const p = path.join(projectDir(slug), file);
  return existsSync(p) ? readFileSync(p) : null;
}

export type StillInput = {
  projectId: string;
  taskId: string | null;
  runId: string;
  pageKey: string;
  pageLabel: string;
  path: string;
  viewport: ViewportName;
  width: number;
  height: number | null;
  commit: string | null;
  branch: string | null;
  actor: Actor;
} & ({ ok: true; png: Buffer; url: string | null } | { ok: false; error: string; url: string | null });

export async function recordStill(db: Db, slug: string, s: StillInput): Promise<CaptureStill> {
  const file = s.ok ? putFile(slug, s.png) : null;
  const [row] = await db
    .insert(captureStills)
    .values({
      projectId: s.projectId,
      taskId: s.taskId,
      runId: s.runId,
      pageKey: s.pageKey,
      pageLabel: s.pageLabel,
      path: s.path,
      viewport: s.viewport,
      width: s.width,
      height: s.height,
      status: s.ok ? "ok" : "error",
      error: s.ok ? null : s.error.slice(0, 2000),
      file,
      bytes: s.ok ? s.png.length : null,
      url: s.url,
      commit: s.commit,
      branch: s.branch,
      actor: s.actor,
    })
    .returning();
  return row!;
}

// Drops old untied stills and old errors, then the files no row points at.
export async function prune(db: Db, projectId: string, slug: string): Promise<{ rows: number; files: number }> {
  const gone = await db.execute<{ id: string }>(sql`
    delete from capture_stills c using (
      select id,
        row_number() over (partition by page_key, viewport, status order by taken_at desc) as n,
        status, task_id, taken_at
      from capture_stills where project_id = ${projectId}
    ) r
    where c.id = r.id and (
      (r.status = 'ok' and r.task_id is null and r.n > ${KEEP_UNTIED})
      or (r.status = 'error' and r.n > 1 and r.taken_at < now() - make_interval(days => ${ERROR_DAYS}))
    )
    returning c.id`);
  const kept = new Set(
    (await db.selectDistinct({ file: captureStills.file }).from(captureStills).where(eq(captureStills.projectId, projectId))).map((r) => r.file),
  );
  let files = 0;
  const dir = projectDir(slug);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (FILE.test(f) && !kept.has(f)) {
        rmSync(path.join(dir, f), { force: true });
        files++;
      }
    }
  }
  return { rows: gone.rows.length, files };
}

// ---- The API read (GET /api/projects/:slug/captures)

export type Still = {
  id: string;
  image_url: string; // the PNG, behind the screen session
  width: number;
  height: number | null;
  url: string | null;
  commit: string | null;
  branch: string | null;
  task_key: string | null;
  taken_at: string;
};
export type StillError = { message: string; commit: string | null; task_key: string | null; taken_at: string };
export type Shot = { still: Still | null; error: StillError | null };
export type CapturePageRead = { key: string; label: string; path: string; session: boolean } & Record<ViewportName, Shot>;
export type CapturesRead = {
  project: string;
  configured: boolean;
  start: { command: string; port: number; url: string } | null;
  viewports: Record<ViewportName, { width: number; height: number }>;
  pages: CapturePageRead[];
  // The newest good still of any page, and when the last run (good or not) happened.
  last_ok_at: string | null;
  last_run_at: string | null;
};

const iso = (d: Date) => d.toISOString();

export function imageUrl(slug: string, id: string): string {
  return `/api/projects/${slug}/captures/${id}.png`;
}

// For each page and viewport: the newest good still, and the newest error if it is newer than that still.
// task_key narrows it to one ticket's stills (a delivery's evidence).
export async function latestStills(db: Db, slug: string, opts: { taskKey?: string } = {}): Promise<CapturesRead | null> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug));
  if (!p) return null;
  const settings: CaptureSettings | undefined = p.settings.capture;
  let taskId: string | undefined;
  if (opts.taskKey) {
    const [t] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, opts.taskKey)));
    if (!t) return null;
    taskId = t.id;
  }
  const rows = await db.execute<{
    id: string;
    page_key: string;
    page_label: string;
    path: string;
    viewport: ViewportName;
    status: "ok" | "error";
    error: string | null;
    width: number;
    height: number | null;
    url: string | null;
    commit: string | null;
    branch: string | null;
    task_key: string | null;
    taken_at: Date;
  }>(sql`
    select distinct on (c.page_key, c.viewport, c.status)
      c.id, c.page_key, c.page_label, c.path, c.viewport, c.status, c.error, c.width, c.height, c.url,
      c.commit, c.branch, t.key as task_key, c.taken_at
    from capture_stills c left join tasks t on t.id = c.task_id
    where c.project_id = ${p.id} ${taskId ? sql`and c.task_id = ${taskId}` : sql``}
    order by c.page_key, c.viewport, c.status, c.taken_at desc`);
  const at = (r: { taken_at: Date | string }) => new Date(r.taken_at);
  const pages = new Map<string, CapturePageRead>();
  const blank = (): Shot => ({ still: null, error: null });
  for (const pg of settings?.pages ?? []) {
    pages.set(pg.key, { key: pg.key, label: pg.label, path: pg.path, session: Boolean(pg.session), desktop: blank(), phone: blank() });
  }
  let lastOk: Date | null = null;
  let lastRun: Date | null = null;
  const errors: typeof rows.rows = [];
  for (const r of rows.rows) {
    // A page taken out of the settings is no longer shown; without settings every page with rows is.
    if (!pages.has(r.page_key)) {
      if (settings) continue;
      pages.set(r.page_key, { key: r.page_key, label: r.page_label, path: r.path, session: false, desktop: blank(), phone: blank() });
    }
    if (!lastRun || at(r) > lastRun) lastRun = at(r);
    if (r.status === "error") {
      errors.push(r);
      continue;
    }
    if (!lastOk || at(r) > lastOk) lastOk = at(r);
    pages.get(r.page_key)![r.viewport].still = {
      id: r.id,
      image_url: imageUrl(slug, r.id),
      width: r.width,
      height: r.height,
      url: r.url,
      commit: r.commit,
      branch: r.branch,
      task_key: r.task_key,
      taken_at: iso(at(r)),
    };
  }
  for (const r of errors) {
    const shot = pages.get(r.page_key)![r.viewport];
    if (shot.still && new Date(shot.still.taken_at) >= at(r)) continue; // fixed since
    shot.error = { message: r.error ?? "", commit: r.commit, task_key: r.task_key, taken_at: iso(at(r)) };
  }
  return {
    project: slug,
    configured: Boolean(settings),
    start: settings ? { command: settings.start_command, port: settings.port, url: `http://localhost:${settings.port}` } : null,
    viewports: Object.fromEntries(VIEWPORT_NAMES.map((v) => [v, { width: VIEWPORTS[v].width, height: VIEWPORTS[v].height }])) as CapturesRead["viewports"],
    pages: [...pages.values()],
    last_ok_at: lastOk ? iso(lastOk) : null,
    last_run_at: lastRun ? iso(lastRun) : null,
  };
}

// One still's file, for the image route. Null when the id is unknown, of another project, or an error row.
export async function stillFile(db: Db, slug: string, id: string): Promise<Buffer | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [r] = await db
    .select({ file: captureStills.file })
    .from(captureStills)
    .innerJoin(projects, eq(projects.id, captureStills.projectId))
    .where(and(eq(captureStills.id, id), eq(projects.slug, slug), eq(captureStills.status, "ok")));
  return r?.file ? readFile(slug, r.file) : null;
}

// The rows one run wrote, newest first (for the CLI's report and the tests).
export async function runRows(db: Db, runId: string): Promise<CaptureStill[]> {
  return db.select().from(captureStills).where(eq(captureStills.runId, runId)).orderBy(desc(captureStills.takenAt));
}
