// PLA-I66-4: bringing the icon files into the repo. Plania makes the set from the original (src/brand/generate.ts) and
// keeps it under <captures dir>/_marca/<project>/sets/<id>/, laid out as the repo will hold it; «Ponerlos en el repo»
// opens a ticket in the project for Taller with that folder, every file, the code to touch and its checks, so Taller
// places and links the files on a branch and opens the PR: it never redraws them. The rows say «en el PR» while that
// ticket is open and turn green when the repo's own check passes after the merge. The .zip has the same set.
// Also here: the repo changing the logo on its own while the owner's choice leads (the drift question).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projectLogos, type Project, type ProjectLogo } from "../db/schema.js";
import { capturesDir } from "../captures/store.js";
import { createTask } from "../mcp/writes.js";
import { webCtx } from "../mcp/tx.js";
import { say } from "../words.js";
import { generate, planFor, setId, zip, type GenFile, type Original, type Plan } from "./generate.js";
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

const themeOf = (r: MarcaRead): string | null => {
  const t = r.rows.find((x) => x.id === "man")?.checks.find((c) => c.k === "man_colors")?.v?.theme;
  return typeof t === "string" && /^#[0-9a-f]{6}$/i.test(t) ? t : null;
};

export type BuiltSet = { id: string; plan: Plan; files: GenFile[]; dir: string };

/** Makes the set for a mode (faltan: what is missing or wrong; todo: every file) and keeps it in the store. */
export async function buildSet(db: Db, project: Project, mode: "faltan" | "todo"): Promise<BuiltSet | null> {
  const r = await marcaRead(db, project.slug);
  if (!r?.logo) return null;
  const [l] = await db.select().from(projectLogos).where(and(eq(projectLogos.projectId, project.id), eq(projectLogos.active, true))).limit(1);
  const o = l ? originalOf(project.slug, l) : null;
  if (!o) return null;
  const plan = planFor(r.rows, { framework: r.framework ?? "static", root: r.root }, mode, o.mime === "image/svg+xml");
  const files = await generate(o, plan, { name: project.title, theme: themeOf(r), rows: r.rows, root: r.root });
  const id = setId(o, plan);
  const dir = path.join(capturesDir(), "_marca", project.slug, "sets", id);
  for (const f of files) {
    const target = path.join(dir, f.path);
    if (!target.startsWith(dir + path.sep)) throw new Error(`a path outside the set: ${f.path}`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, f.bytes);
  }
  return { id, plan, files, dir };
}

export async function zipOf(db: Db, project: Project, mode: "faltan" | "todo"): Promise<Buffer | null> {
  const set = await buildSet(db, project, mode);
  return set ? zip(set.files) : null;
}

/** The ticket that asks Taller to place the set: what goes where, what to link, and its checks. */
export async function requestIcons(db: Db, project: Project, mode: "faltan" | "todo"): Promise<{ key: string; set: BuiltSet }> {
  const set = await buildSet(db, project, mode);
  if (!set) throw new LogoError("LOGO_NONE", 409, say(MARCA_WORDS).errors.noOriginal);
  if (set.files.length === 0) throw new LogoError("LOGO_NOTHING_TO_BRING", 409, say(MARCA_WORDS).errors.nothing);
  const w = say(MARCA_WORDS).pedido;
  const lines = [
    MARKER(set.id, set.plan.items.map((i) => (i.key === "manifest" ? "man" : i.key))),
    w.lead(set.dir),
    "",
    `## ${w.files}`,
    ...set.plan.items.map((i) => `- \`${i.path}\` (${i.op === "+" ? w.add : w.replace})`),
    ...(set.plan.edits.length ? ["", `## ${w.code}`, ...set.plan.edits.map((e) => `- \`${e.path}\`: ${w.edit[e.what]}`)] : []),
    "",
    w.rules,
  ];
  const made = (await createTask(
    db,
    {
      project: project.slug,
      title: w.title,
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
