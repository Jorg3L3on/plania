// PLA-I66-4: bringing the icon files into the repo. Plania makes the set from the original (src/brand/generate.ts) and
// keeps it under <captures dir>/_marca/<project>/sets/<id>/, laid out as the repo will hold it; «Ponerlos en el repo»
// opens a ticket in the project for Taller with that folder, every file, the code to touch and its checks, so Taller
// places and links the files on a branch and opens the PR: it never redraws them. The rows say «en el PR» while that
// ticket is open and turn green when the repo's own check passes after the merge. The .zip has the same set.
// Also here: the repo changing the logo on its own while the owner's choice leads (the drift question).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, ilike, notInArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projectLogos, tasks, type Project, type ProjectLogo } from "../db/schema.js";
import { capturesDir } from "../captures/store.js";
import { createTask } from "../mcp/writes.js";
import { serviceAgent } from "../runner/events.js";
import { webCtx } from "../mcp/tx.js";
import { say } from "../words.js";
import { generate, planFor, setId, SURFACE_KEYS, zip, type GenFile, type GenKey, type Original, type Plan, type Surface } from "./generate.js";
import type { Framework, Row, RowId } from "./check.js";
import { surfaceOriginals } from "./surfaces.js";
import { readLogoFile } from "./logos.js";
import { marcaRead, forgetMarcaOf, type MarcaRead } from "./marca.js";
import { MARCA_WORDS } from "./words.js";
import { LogoError } from "./upload.js";

export const MARKER = (id: string, rows: string[]) => `<!-- plania:marca set=${id} rows=${rows.join(",")} -->`;

/** The original as the generator takes it. */
export function originalOf(slug: string, l: ProjectLogo): Original | null {
  const bytes = readLogoFile(slug, l.file);
  return bytes ? { bytes, mime: l.mime, variant: l.variant, colors: l.colors, bg: l.adjust?.bg ?? null } : null;
}

const themeOfRows = (rows: Row[]): string | null => {
  const t = rows.find((x) => x.id === "man")?.checks.find((c) => c.k === "man_colors")?.v?.theme;
  return typeof t === "string" && /^#[0-9a-f]{6}$/i.test(t) ? t : null;
};
const themeOf = (r: MarcaRead): string | null => themeOfRows(r.rows);

// PLA-128: which icons in the repo come from an older logo. Plania's files are deterministic, so a sound file the repo
// has that differs from the one Plania makes now (from the logo, or a surface's own icon) was made from another one.
// Only for a logo the owner chose (upload, Artist, a version gone back to): one found in the repo leaves its icons be.
// The manifest and code edits are not compared (Taller may format them); the generated set is kept per logo + plan.
const COMPARED: GenKey[] = ["ico", "svg", "apple", "a192", "a512", "mask", "mono", "og", "ios_app"];
const ROW_OF_KEY = (k: GenKey): RowId => (k === "manifest" ? "man" : (k as RowId));
const made = new Map<string, Map<string, Buffer>>();
export async function staleRows(input: { slug: string; title: string; rows: Row[]; framework: Framework; root: string; native: boolean; logo: ProjectLogo; read: (path: string) => Promise<Buffer | null> }): Promise<RowId[]> {
  if (input.logo.source === "repo") return [];
  const o = originalOf(input.slug, input.logo);
  if (!o) return [];
  const own = surfaceOriginals(input.slug);
  const plan = planFor(input.rows, { framework: input.framework, root: input.root }, "todo", o.mime === "image/svg+xml", input.native);
  plan.items = plan.items.filter((i) => COMPARED.includes(i.key));
  const key = `${input.slug}|${setId(o, plan, own)}|${themeOfRows(input.rows) ?? ""}`;
  let files = made.get(key);
  if (!files) {
    const gen = await generate(o, plan, { name: input.title, theme: themeOfRows(input.rows), rows: input.rows, root: input.root }, own);
    files = new Map(gen.map((g) => [g.path, g.bytes]));
    if (made.size > 32) made.clear();
    made.set(key, files);
  }
  const out: RowId[] = [];
  for (const it of plan.items) {
    const row = input.rows.find((r) => r.id === ROW_OF_KEY(it.key));
    if (!row || row.state !== "ok" || row.path !== it.path) continue;
    const want = files.get(it.path);
    const have = want ? await input.read(it.path) : null;
    if (want && have && !want.equals(have)) out.push(row.id);
  }
  return out;
}

export type BuiltSet = { id: string; plan: Plan; files: GenFile[]; dir: string };

/** Makes the set for a mode (faltan: what is missing or wrong; todo: every file) and keeps it in the store. */
// PLA-122: surface, one surface's files only (each made from its own icon when it has one).
export async function buildSet(db: Db, project: Project, mode: "faltan" | "todo", surface?: Surface | null): Promise<BuiltSet | null> {
  const r = await marcaRead(db, project.slug);
  if (!r?.logo) return null;
  const [l] = await db.select().from(projectLogos).where(and(eq(projectLogos.projectId, project.id), eq(projectLogos.active, true))).limit(1);
  const o = l ? originalOf(project.slug, l) : null;
  if (!o) return null;
  const plan = planFor(r.rows, { framework: r.framework ?? "static", root: r.root }, mode, o.mime === "image/svg+xml", r.native, surface ? SURFACE_KEYS[surface] : undefined);
  const own = surfaceOriginals(project.slug);
  const files = await generate(o, plan, { name: project.title, theme: themeOf(r), rows: r.rows, root: r.root }, own);
  const id = setId(o, plan, own);
  const dir = path.join(capturesDir(), "_marca", project.slug, "sets", id);
  for (const f of files) {
    const target = path.join(dir, f.path);
    if (!target.startsWith(dir + path.sep)) throw new Error(`a path outside the set: ${f.path}`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, f.bytes);
  }
  return { id, plan, files, dir };
}

export async function zipOf(db: Db, project: Project, mode: "faltan" | "todo", surface?: Surface | null): Promise<Buffer | null> {
  const set = await buildSet(db, project, mode, surface);
  return set ? zip(set.files) : null;
}

/** The ticket that asks Taller to place the set: what goes where, what to link, and its checks. */
export async function requestIcons(db: Db, project: Project, mode: "faltan" | "todo", surface?: Surface | null): Promise<{ key: string; set: BuiltSet }> {
  // PLA-124: one icons ticket at a time; a second one would open another PR on the same files.
  const [open] = await db
    .select({ key: tasks.key })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), ilike(tasks.scope, "%<!-- plania:marca set=%"), notInArray(tasks.status, ["Merged", "Released", "Done", "Won't do"])))
    .limit(1);
  if (open) throw new LogoError("LOGO_PEDIDO_OPEN", 409, say(MARCA_WORDS).errors.pedidoOpen(open.key));
  const set = await buildSet(db, project, mode, surface);
  if (!set) throw new LogoError("LOGO_NONE", 409, say(MARCA_WORDS).errors.noOriginal);
  if (set.files.length === 0) throw new LogoError("LOGO_NOTHING_TO_BRING", 409, say(MARCA_WORDS).errors.nothing);
  const w = say(MARCA_WORDS).pedido;
  const lines = [
    MARKER(set.id, set.plan.items.map((i) => (i.key === "manifest" ? "man" : i.key))),
    w.lead(set.dir),
    ...(surface ? ["", w.surfaceLead(w.surface[surface]!)] : []),
    "",
    `## ${w.files}`,
    ...set.plan.items.map((i) => `- \`${i.path}\` (${i.op === "+" ? w.add : w.replace})`),
    ...(set.plan.edits.length ? ["", `## ${w.code}`, ...set.plan.edits.map((e) => `- \`${e.path}\`: ${w.edit[e.what]}`)] : []),
    "",
    w.rules,
  ];
  // PLA-121: given to the project's Taller, so its creation wakes Taller (PLA-103); unowned, it waited for a move forever.
  const taller = await serviceAgent(db, "taller", project);
  const made = (await createTask(
    db,
    {
      project: project.slug,
      ...(taller ? { owner_agent: taller.slug } : {}),
      title: surface ? w.titleSurface(w.surface[surface]!) : w.title,
      summary: w.summary(set.files.length),
      scope: lines.join("\n"),
      checks: [w.checkFiles, ...(set.plan.edits.length ? [w.checkLinks] : []), w.checkVerify],
      status: "Ready",
      work_type: "code",
      priority: "P2",
    } as never,
    { ...webCtx, tool: "screen.marca" },
  )) as { key: string };
  forgetMarcaOf(project.id);
  return { key: made.key, set };
}



/** Keeps the owner's logo over the one the repo now shows (the drift question answered «Mantener el mío»). */
export async function keepOver(db: Db, project: Pick<Project, "id">, sha: string): Promise<void> {
  const [l] = await db.select().from(projectLogos).where(and(eq(projectLogos.projectId, project.id), eq(projectLogos.active, true))).limit(1);
  if (!l) return;
  await db.update(projectLogos).set({ adjust: { ...(l.adjust ?? {}), keptOver: sha } }).where(eq(projectLogos.id, l.id));
  forgetMarcaOf(project.id);
}
