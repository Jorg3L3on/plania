// PLA-I69-5: Marca → Voz y nombre. How the project speaks (four sliders, how it addresses people, words it uses and
// avoids) and its name and short texts. The voice is kept in Plania with versions in
// <captures dir>/_marca/<project>/voice.json and rides in every run of the project as a short guide (src/runner/
// runner.ts), so Taller, Artist and the product owner write the app's texts with it. The guide is written from the
// sliders unless an expert wrote their own. The name and texts go to the repo through a request to Taller.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, ilike, notInArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects, tasks, type Project } from "../db/schema.js";
import { capturesDir } from "../captures/store.js";
import { createTask } from "../mcp/writes.js";
import { serviceAgent } from "../runner/events.js";
import { webCtx } from "../mcp/tx.js";
import { bus } from "../events.js";
import { say } from "../words.js";
import { listTree, readBlob, realGit, startCommit, type LogoDeps } from "./logos.js";
import { repoPathOf } from "../runner/worktree.js";
import { startBranchOf } from "../runner/start-branch.js";
import { LogoError } from "./upload.js";
import { VOZ_WORDS } from "./words.js";

export type Trato = "tu" | "usted" | "vos";
export type Voice = {
  cerca: number; humor: number; breve: number; sencillo: number; trato: Trato;
  yes: string[]; no: string[]; guide: string | null;
  name: string; short: string; desc: string; tag: string;
};
type VoiceFile = { current: number; versions: { v: number; at: string; voice: Voice }[] };
/** The limits the screen counts against (stores and browsers cut past them). */
export const LIMITS = { name: 45, short: 12, desc: 160, tag: 60 } as const;

const fileOf = (slug: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`bad project slug ${slug}`);
  return path.join(capturesDir(), "_marca", slug, "voice.json");
};
function load(slug: string): VoiceFile | null {
  const f = fileOf(slug);
  if (!existsSync(f)) return null;
  try {
    const j = JSON.parse(readFileSync(f, "utf8")) as VoiceFile;
    return Array.isArray(j.versions) && j.versions.length ? j : null;
  } catch {
    return null;
  }
}
function save(slug: string, s: VoiceFile): void {
  const f = fileOf(slug);
  mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, f);
}
export const voiceOf = (slug: string): Voice | null => {
  const f = load(slug);
  return f?.versions.find((v) => v.v === f.current)?.voice ?? null;
};
export const voiceVersions = (slug: string): { v: number; at: string; current: boolean }[] => {
  const f = load(slug);
  return (f?.versions ?? []).map((v) => ({ v: v.v, at: v.at, current: v.v === f!.current })).reverse();
};

const pct = (n: unknown, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) : d);
const line = (v: unknown, max: number, d: string) => (typeof v === "string" ? v.replace(/[\r\n\t]+/g, " ").replace(/<!--|-->/g, "").trim().slice(0, max) : d);
const wordsList = (v: unknown, d: string[]) =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => line(x, 40, "")).filter(Boolean))].slice(0, 20) : d;
/** A voice made whole and safe from what the screen sends. Texts over their limit are kept (the screen warns); a
 * hard cap stops abuse. */
export function soundVoice(input: Partial<Voice>, base: Voice): Voice {
  return {
    cerca: pct(input.cerca, base.cerca),
    humor: pct(input.humor, base.humor),
    breve: pct(input.breve, base.breve),
    sencillo: pct(input.sencillo, base.sencillo),
    trato: (["tu", "usted", "vos"] as const).includes(input.trato as Trato) ? (input.trato as Trato) : base.trato,
    yes: wordsList(input.yes, base.yes),
    no: wordsList(input.no, base.no),
    guide: input.guide === null ? null : typeof input.guide === "string" ? input.guide.replace(/<!--|-->/g, "").trim().slice(0, 1500) || null : base.guide,
    name: line(input.name, 120, base.name),
    short: line(input.short, 60, base.short),
    desc: line(input.desc, 400, base.desc),
    tag: line(input.tag, 160, base.tag),
  };
}

/** The guide every run gets, written from the sliders (or the expert's own). */
export function guideOf(v: Voice, title: string): string {
  if (v.guide) return v.guide;
  return say(VOZ_WORDS).guide({
    title: v.name || title,
    tone: [v.cerca >= 50 ? "cerca" : "formal", v.humor >= 60 ? "humor" : "seria", v.breve >= 50 ? "breve" : "detalle", v.sencillo >= 50 ? "sencillo" : "tecnico"] as const,
    trato: v.trato,
    yes: v.yes,
    no: v.no,
  });
}
/** The block a run of the project gets; empty while the owner has not set a voice. */
export function voiceBlock(slug: string, title: string): string {
  const v = voiceOf(slug);
  if (!v) return "";
  return `${say(VOZ_WORDS).blockTitle}\n${guideOf(v, title)}`;
}

// ---------- the repo's name and texts, as they are ----------
export type RepoNames = { name?: string; short?: string; desc?: string; title?: string; files: string[] };
const str = (t: string, key: string) => t.match(new RegExp(`["']?${key}["']?\\s*:\\s*["'\`]([^"'\`\\n]{1,300})["'\`]`))?.[1];
export async function readRepoNames(view: { paths: Map<string, number>; read: (p: string) => Promise<Buffer | null> }, root: string): Promise<RepoNames> {
  const out: RepoNames = { files: [] };
  const paths = [...view.paths.keys()].filter((p) => p.startsWith(root));
  const man = paths.find((p) => /(^|\/)(src\/)?app\/manifest\.(ts|js)$|(^|\/)public\/(manifest\.json|site\.webmanifest|manifest\.webmanifest)$/.test(p));
  if (man) {
    const t = (await view.read(man))?.toString("utf8") ?? "";
    out.name = str(t, "name");
    out.short = str(t, "short_name");
    out.desc = str(t, "description");
    out.files.push(man);
  }
  const layout = paths.find((p) => /(^|\/)(src\/)?app\/layout\.(tsx|jsx|ts|js)$/.test(p));
  if (layout) {
    const t = (await view.read(layout))?.toString("utf8") ?? "";
    const meta = t.slice(Math.max(0, t.indexOf("metadata")));
    out.title = str(meta, "default") ?? str(meta, "title");
    out.desc ??= str(meta, "description");
    out.files.push(layout);
    // The metadata often reads a site config (title: site.name): read the name and description there.
    if (!out.title) {
      const cfg = paths.find((p) => /(^|\/)(src\/)?(lib|config)\/(site|config|brand)\.(ts|js|mjs)$/.test(p));
      if (cfg) {
        const c = (await view.read(cfg))?.toString("utf8") ?? "";
        out.title = str(c, "name") ?? str(c, "title");
        const d = str(c, "description");
        if (d && !out.desc) out.desc = d;
        if (out.title) out.files.push(cfg);
      }
    }
  } else {
    const html = paths.find((p) => /(^|\/)index\.html$/.test(p) && !p.includes("node_modules"));
    if (html) {
      const t = (await view.read(html))?.toString("utf8") ?? "";
      out.title = t.match(/<title>([^<]{1,200})<\/title>/i)?.[1]?.trim();
      out.desc ??= t.match(/<meta\s+name=["']description["']\s+content=["']([^"']{1,400})["']/i)?.[1];
      out.files.push(html);
    }
  }
  return out;
}

export function startVoice(title: string, repo: RepoNames): Voice {
  return {
    cerca: 70, humor: 30, breve: 65, sencillo: 75, trato: "tu", yes: [], no: [], guide: null,
    name: repo.name ?? repo.title ?? title, short: repo.short ?? (repo.name ?? title).slice(0, 12), desc: repo.desc ?? "", tag: "",
  };
}

export type VoiceRead = { voice: Voice | null; base: Voice; guide: string; repo: RepoNames; names: ("name" | "short" | "desc")[]; versions: number; pedido: { key: string; status: string } | null; limits: typeof LIMITS };
const MARK = "%<!-- plania:marca-nombre set=%";
async function repoNamesOf(p: Project, deps: LogoDeps): Promise<RepoNames> {
  const git = deps.git ?? realGit;
  const repo = repoPathOf(p.slug, p.settings, deps.env);
  const c = await startCommit(git, repo, startBranchOf(p.settings)).catch(() => null);
  if (!c) return { files: [] };
  const tree = await listTree(git, repo, c.sha);
  const { checkRepo } = await import("./check.js");
  const view = { paths: tree, read: (f: string) => readBlob(git, repo, c.sha, f) };
  const ck = await checkRepo(view, { hasOriginal: false, slug: p.slug });
  return readRepoNames(view, ck.root);
}
const cache = new Map<string, { at: number; repo: RepoNames }>();
export const forgetVoice = (slug?: string): void => { if (slug) cache.delete(slug); else cache.clear(); };

export async function voiceRead(db: Db, slug: string, deps: LogoDeps = {}): Promise<VoiceRead | null> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return null;
  const now = (deps.now ?? Date.now)();
  let c = cache.get(slug);
  if (!c || now - c.at > 60_000 || deps.fresh) {
    c = { at: now, repo: await repoNamesOf(p, deps) };
    cache.set(slug, c);
  }
  const current = voiceOf(slug);
  const base = current ?? startVoice(p.title, c.repo);
  const [open] = await db
    .select({ key: tasks.key, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.projectId, p.id), ilike(tasks.scope, MARK), notInArray(tasks.status, ["Merged", "Released", "Done", "Won't do"])))
    .limit(1);
  // Which texts differ from the repo (only when the owner has set them).
  // The name differs when either place the repo names the app (manifest, page title) says something else.
  const names = current
    ? (["name", "short", "desc"] as const).filter((k) =>
        k === "name" ? [c!.repo.name, c!.repo.title].some((n) => (n ?? base.name) !== base.name) || (!c!.repo.name && !c!.repo.title) : (base[k] ?? "") !== (c!.repo[k] ?? ""),
      )
    : [];
  return { voice: current, base, guide: guideOf(base, p.title), repo: c.repo, names: [...names], versions: load(slug)?.versions.length ?? 0, pedido: open ?? null, limits: LIMITS };
}

export async function saveVoice(db: Db, slug: string, patch: Partial<Voice>): Promise<VoiceRead | null> {
  const r = await voiceRead(db, slug);
  if (!r) return null;
  const next = soundVoice(patch, r.base);
  const f = load(slug) ?? { current: 0, versions: [] };
  const last = f.versions.find((v) => v.v === f.current)?.voice;
  if (last && JSON.stringify(last) === JSON.stringify(next)) return r;
  const v = Math.max(0, ...f.versions.map((x) => x.v)) + 1;
  f.versions.push({ v, at: new Date().toISOString(), voice: next });
  if (f.versions.length > 60) f.versions = f.versions.slice(-60);
  f.current = v;
  save(slug, f);
  bus.publish({ type: "project", project: slug });
  return voiceRead(db, slug);
}
export async function goBackVoice(db: Db, slug: string, v: number): Promise<VoiceRead | null> {
  const old = load(slug)?.versions.find((x) => x.v === v)?.voice;
  if (!old) throw new LogoError("LOGO_NOT_FOUND", 404, "version not found");
  return saveVoice(db, slug, old);
}

/** The request: the name and texts into the manifest and the page's metadata, with the voice for any copy it touches. */
export async function requestNames(db: Db, project: Project, deps: LogoDeps = {}): Promise<{ key: string }> {
  const w = say(VOZ_WORDS);
  const [open] = await db
    .select({ key: tasks.key })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), ilike(tasks.scope, MARK), notInArray(tasks.status, ["Merged", "Released", "Done", "Won't do"])))
    .limit(1);
  if (open) throw new LogoError("LOGO_PEDIDO_OPEN", 409, w.errors.open(open.key));
  const r = await voiceRead(db, project.slug, deps);
  if (!r?.voice) throw new LogoError("LOGO_NONE", 409, w.errors.none);
  if (!r.names.length) throw new LogoError("LOGO_NOTHING_TO_BRING", 409, w.errors.nothing);
  const v = r.voice;
  const id = createHash("sha256").update(JSON.stringify([v.name, v.short, v.desc, v.tag])).digest("hex").slice(0, 16);
  const q = (s: string) => `«${s}»`;
  const lines = [
    `<!-- plania:marca-nombre set=${id} -->`,
    w.lead,
    "",
    `## ${w.values}`,
    `- ${w.fields.name}: ${q(v.name)}`,
    `- ${w.fields.short}: ${q(v.short)}`,
    ...(v.desc ? [`- ${w.fields.desc}: ${q(v.desc)}`] : []),
    ...(v.tag ? [`- ${w.fields.tag}: ${q(v.tag)}`] : []),
    "",
    `## ${w.where}`,
    ...(r.repo.files.length ? r.repo.files.map((f) => `- \`${f}\``) : [`- ${w.whereUnknown}`]),
    `- ${w.og}`,
    "",
    `## ${w.voiceTitle}`,
    guideOf(v, project.title),
    "",
    w.rules,
  ];
  const taller = await serviceAgent(db, "taller", project);
  const made = (await createTask(
    db,
    {
      project: project.slug,
      ...(taller ? { owner_agent: taller.slug } : {}),
      title: w.title,
      summary: w.summary,
      scope: lines.join("\n"),
      checks: [w.checkManifest, w.checkMeta, w.checkBuild],
      status: "Ready",
      work_type: "code",
      priority: "P2",
    } as never,
    { ...webCtx, tool: "screen.marca.nombre" },
  )) as { key: string };
  return { key: made.key };
}

/** PLA-I69-6: every version with its values, newest first, for Marca → Historial. */
export const voiceHistory = (slug: string): { v: number; at: string; current: boolean; voice: Voice }[] => {
  const f = load(slug);
  return (f?.versions ?? []).map((v) => ({ ...v, current: v.v === f!.current })).reverse();
};
