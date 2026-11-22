// NEWPROJ-6: the project's settings view on the screen (La corriente's Ajustes door). Reads one project's settings and
// writes them through the functions the MCP tools use, so validation, events and the screen's refresh are the same:
//   GET  /api/company/projects/:slug/settings                 what the view shows (settingsRead)
//   PUT  /api/company/projects/:slug/settings/code    {version, repo_path?, github_repo?, no_code?}   setProject
//   PUT  /api/company/projects/:slug/settings/release {version, release: {from, into, env, mode?} | null}  setProject
//   PUT  /api/company/projects/:slug/settings/verify  {version, commands: string[]}  setProject (settings.qa.verify)
//   PUT  /api/company/projects/:slug/settings/context/:doc {markdown, version?}  attachDoc (a stale version is refused)
//   PUT  /api/company/projects/:slug/settings/docs    {title, markdown, version?}  attachDoc (PLA-135: a library doc)
//   PUT  /api/company/projects/:slug/settings/capture  {version, capture: {start_command, port, …, pages} | null}  setProject
//   PUT  /api/company/projects/:slug/settings/advanced {version, field, value}  setProject (the «Avanzado» section)
// The preview address and plan approval keep their route (PUT …/options, setProjectOptions, also through setProject).
// PLA-I2-6: every key in src/mcp/settings-registry.ts has a control here, in Motores or on the floor. No field takes a
// secret: a token is named by its variable (github_token_env, vercel.token_env) and a value shaped like a secret is
// refused (SECRET_VALUE) before anything is written.
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { docs, type ProjectSettings } from "../db/schema.js";
import { attachDoc } from "../mcp/docs.js";
import { setProject } from "../mcp/project.js";
import { looksSecret, stringsIn } from "../mcp/settings-registry.js";
import { AVANZADO, avanzadoRead, captureForm, captureFrom, type AvanzadoField, type AvanzadoRead, type CaptureForm } from "./settings-avanzado.js";
import { findProject } from "../mcp/queries.js";
import { WEB_ACTOR, type Ctx } from "../mcp/tx.js";
import { kitRoot } from "../runner/kit.js";
import { checkRepoFolder, GITHUB_REPO, repoPathShapeOk, type RepoCheckDeps } from "../runner/repo-check.js";
import { checkGithubRepo } from "../runner/repo-setup.js";
import { startBranchOf } from "../runner/start-branch.js";
import { buildRead, type BuildRead } from "../runner/build-step.js";
import { repoPathOf } from "../runner/worktree.js";
import { CONTEXT_DOCS } from "../runner/runner.js";
import type { QaSettings } from "../runner/qa-settings.js";

export const settingsCtx: Ctx = { actor: WEB_ACTOR, human: true, tool: "screen.settings" };

// The three context docs by the id the readiness list uses (context.<id>), their title and their kit template.
export const CONTEXT_DOC_IDS = ["glossary", "commands", "map"] as const;
export type ContextDocId = (typeof CONTEXT_DOC_IDS)[number];
const CONTEXT_TITLE: Record<ContextDocId, (typeof CONTEXT_DOCS)[number]> = { glossary: "Context: Glossary", commands: "Context: Commands", map: "Context: Map" };
export const contextTitle = (id: ContextDocId) => CONTEXT_TITLE[id];

/** The kit template for a context doc, with the project's name in place of <project>. Empty when the file is gone. */
export function contextTemplate(id: ContextDocId, projectTitle: string, env: NodeJS.ProcessEnv = process.env): string {
  try {
    return readFileSync(path.join(kitRoot(env), "context", `${id}.md`), "utf8").replaceAll("<project>", projectTitle);
  } catch {
    return "";
  }
}

export type SettingsRead = {
  slug: string;
  title: string;
  version: number;
  code: { repo_path: string | null; github_repo: string | null; no_code: boolean };
  release: { from: string; into: string; env: string; mode: "command" | "merge"; prod_migrations: "deploy" | "owner" | "none" | null } | null;
  verify: { name: string; command: string }[];
  // PLA-I74-9: the host's production build the verify list runs by default, and the owner's reason when removed.
  build: BuildRead;
  preview_url: string | null;
  plan_approval: boolean;
  context: { id: ContextDocId; title: string; doc_id: string | null; version: number | null; markdown: string; template: string; updated_at: string | null }[];
  // PLA-135: the project's library, its own docs other than the three context notes and the kit's prompts and packs,
  // newest first. The team reads them when a task asks (get_memory); the context notes go into every run.
  library: LibraryDoc[];
  // PLA-I2-6: how the app starts, as its form edits it, and the «Avanzado» fields.
  capture: CaptureForm | null;
  avanzado: AvanzadoRead[];
};

export type LibraryDoc = { id: string; title: string; version: number; updated_at: string; first: string };

/** PLA-135: titles the library leaves out: the context notes (their own group) and the kit's prompts and packs. */
export const notLibrary = (title: string): boolean => (CONTEXT_DOCS as readonly string[]).includes(title) || /^(Prompt|Pack): /.test(title);

/** The first line of text a reader sees: no heading marks, list marks or emphasis, at most 140 characters. */
export function firstLine(markdown: string): string {
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line || /^#{1,6}\s/.test(line) || /^(---|```)/.test(line)) continue;
    const text = line.replace(/^([-*+]|\d+\.)\s+/, "").replace(/[*_`]/g, "").trim();
    if (text) return text.length > 140 ? `${text.slice(0, 139)}…` : text;
  }
  return "";
}

export async function settingsRead(db: Db, slug: string): Promise<SettingsRead> {
  const p = await findProject(db, slug);
  const s: ProjectSettings = p.settings ?? {};
  const own = await db
    .select()
    .from(docs)
    .where(and(eq(docs.projectId, p.id), isNull(docs.taskId)))
    .orderBy(desc(docs.updatedAt), asc(docs.title));
  const rows = own.filter((d) => (CONTEXT_DOCS as readonly string[]).includes(d.title));
  return {
    slug: p.slug,
    title: p.title,
    version: p.version,
    code: { repo_path: s.local?.repo_path ?? null, github_repo: s.github?.repo ?? null, no_code: s.local?.no_code === true },
    release: s.release ? { from: s.release.from, into: s.release.into, env: s.release.env, mode: s.release.mode ?? "command", prod_migrations: s.release.prod_migrations ?? null } : null,
    verify: (s.qa?.verify ?? []).map((v) => ({ name: v.name, command: v.command })),
    build: buildRead(p, repoPathOf(p.slug, s, process.env)),
    preview_url: s.preview_url ?? null,
    plan_approval: !!s.plan_approval,
    context: CONTEXT_DOC_IDS.map((id) => {
      const d = rows.find((r) => r.title === CONTEXT_TITLE[id]);
      return { id, title: CONTEXT_TITLE[id], doc_id: d?.id ?? null, version: d?.version ?? null, markdown: d?.markdown ?? "", template: contextTemplate(id, p.title), updated_at: d?.updatedAt.toISOString() ?? null };
    }),
    library: own.filter((d) => !notLibrary(d.title)).map((d) => ({ id: d.id, title: d.title, version: d.version, updated_at: d.updatedAt.toISOString(), first: firstLine(d.markdown) })),
    capture: captureForm(s.capture),
    avanzado: avanzadoRead(s),
  };
}

export type SettingsRefusal = { error: string; status: 400 | 404 | 409; [k: string]: unknown };

/** Where the code is: a folder on this machine (checked first; a failing folder saves nothing), a GitHub repo, both,
 * or no code yet. A GitHub repo keeps its token_env (a variable name the screen never shows). */
export async function setCodeLocation(
  db: Db,
  slug: string,
  input: { version: number; repo_path?: string; github_repo?: string; no_code?: boolean },
  repoCheck: RepoCheckDeps,
): Promise<SettingsRead | SettingsRefusal> {
  const repoPath = input.repo_path?.trim() || undefined;
  const githubRepo = input.github_repo?.trim() || undefined;
  if (input.no_code && (repoPath || githubRepo)) return { error: "INVALID_BODY", status: 400, field: "no_code" };
  if (!input.no_code && !repoPath && !githubRepo) return { error: "INVALID_BODY", status: 400, field: "repo_path" };
  if (githubRepo !== undefined && !GITHUB_REPO.test(githubRepo)) return { error: "INVALID_BODY", status: 400, field: "github_repo" };
  if (repoPath !== undefined && !repoPathShapeOk(repoPath)) return { error: "INVALID_BODY", status: 400, field: "repo_path" };
  const p = await findProject(db, slug);
  // PLA-I2-5: the project's working branch, and the GitHub choice runs its own check as the folder choice does.
  const start = startBranchOf(p.settings);
  if (repoPath) {
    const check = await checkRepoFolder(repoPath, repoCheck, start);
    if (check.failed) return { error: check.failed, status: 400, field: "repo_path", path: repoPath, branch: check.branch, checks: check.checks };
  }
  if (githubRepo && repoCheck.gh) {
    const gh = await checkGithubRepo(githubRepo, start, repoCheck.gh, process.cwd());
    if (gh.failed) return { error: gh.failed, status: 400, field: "github_repo", repo: githubRepo, branch: start };
  }
  const github = p.settings.github;
  await setProject(
    db,
    {
      project: slug,
      version: input.version,
      settings: {
        local: repoPath ? { repo_path: repoPath } : input.no_code ? { no_code: true } : null,
        github: githubRepo ? { ...(github ?? {}), repo: githubRepo } : null,
      },
    },
    settingsCtx,
  );
  return settingsRead(db, slug);
}

/** The release step, validated by set_project (checkReleaseSettings); null takes it away. */
export async function setReleaseStep(db: Db, slug: string, input: { version: number; release: { from: string; into: string; env: string; mode?: "command" | "merge"; prod_migrations?: "deploy" | "owner" | "none" } | null }): Promise<SettingsRead> {
  await setProject(db, { project: slug, version: input.version, settings: { release: input.release } }, settingsCtx);
  return settingsRead(db, slug);
}

// A verify item's name, shown on QA's evidence card: the first word of the command that is not a runner or a flag
// ("pnpm test" → test, "pnpm exec tsc --noEmit" → tsc). The same command keeps the name and timeout it had.
const RUNNERS = new Set(["pnpm", "npm", "yarn", "npx", "bun", "bunx", "run", "exec", "node", "python", "python3", "uv", "poetry", "make", "go", "cargo", "sh", "bash", "deno", "dlx"]);
export function verifyName(command: string): string {
  const words = command.trim().split(/\s+/);
  const word = words.find((w) => !w.startsWith("-") && !RUNNERS.has(w.toLowerCase()) && /[a-z0-9]/i.test(w)) ?? words[0] ?? "";
  const name = (word.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 36);
  return name || "paso";
}

export function verifyItems(commands: string[], current: QaSettings["verify"] = []): QaSettings["verify"] {
  const out: QaSettings["verify"] = [];
  const used = new Set<string>();
  for (const raw of commands) {
    const command = raw.trim();
    if (!command) continue;
    const had = current.find((v) => v.command === command);
    let name = had && !used.has(had.name) ? had.name : verifyName(command);
    for (let n = 2; used.has(name); n++) name = `${verifyName(command)} ${n}`;
    used.add(name);
    out.push({ name, command, ...(had?.timeout_minutes ? { timeout_minutes: had.timeout_minutes } : {}) });
  }
  return out;
}

/** QA's verify list, one command per line; the rest of settings.qa stays as it was. Validated by set_project.
 * PLA-I74-9: no_build removes the host's production build with the owner's reason (null puts it back; absent keeps it). */
export async function setVerifyList(db: Db, slug: string, input: { version: number; commands: string[]; no_build?: string | null }): Promise<SettingsRead> {
  const p = await findProject(db, slug);
  const { no_build: was, ...qa } = p.settings.qa ?? { verify: [] };
  const off = input.no_build === undefined ? was : input.no_build === null ? undefined : { reason: input.no_build };
  await setProject(db, { project: slug, version: input.version, settings: { qa: { ...qa, verify: verifyItems(input.commands, qa.verify), ...(off ? { no_build: off } : {}) } } }, settingsCtx);
  return settingsRead(db, slug);
}

/** A context doc: without version it is created (DOC_EXISTS when it is there); with the version read it is replaced,
 * and a version that moved is STALE_VERSION. */
export async function putContextDoc(db: Db, slug: string, id: ContextDocId, input: { markdown: string; version?: number }): Promise<SettingsRead> {
  await attachDoc(db, { project: slug, title: CONTEXT_TITLE[id], markdown: input.markdown, ...(input.version !== undefined ? { version: input.version } : {}) }, settingsCtx);
  return settingsRead(db, slug);
}

/** PLA-135: a library doc. Without version it is created (DOC_EXISTS when the title is taken); with the version read
 * it is replaced, and a version that moved is STALE_VERSION. A context note, a prompt or a pack is not a library doc. */
export async function putLibraryDoc(db: Db, slug: string, input: { title: string; markdown: string; version?: number }): Promise<SettingsRead | SettingsRefusal> {
  const title = input.title.trim();
  if (!title || title.length > 120 || notLibrary(title)) return { error: "INVALID_BODY", status: 400, field: "title" };
  await attachDoc(db, { project: slug, title, markdown: input.markdown, ...(input.version !== undefined ? { version: input.version } : {}) }, settingsCtx);
  return settingsRead(db, slug);
}

/** PLA-I2-6: how the app starts; null takes it away (Máquinas can guess it again). Validated by set_project. */
export async function setCapture(db: Db, slug: string, input: { version: number; capture: CaptureForm | null }): Promise<SettingsRead | SettingsRefusal> {
  if (input.capture && stringsIn(input.capture).some(looksSecret)) return { error: "SECRET_VALUE", status: 400, field: "capture" };
  const p = await findProject(db, slug);
  const capture = input.capture ? captureFrom(input.capture, p.settings.capture) : null;
  await setProject(db, { project: slug, version: input.version, settings: { capture } }, settingsCtx);
  return settingsRead(db, slug);
}

/** PLA-I2-6: one «Avanzado» field; null puts the default back. A value shaped like a secret is refused before any
 * write, and a token field takes a variable's name only. The values themselves are validated by set_project. */
export async function setAdvanced(db: Db, slug: string, input: { version: number; field: AvanzadoField; value: unknown }): Promise<SettingsRead | SettingsRefusal> {
  const { field, value } = input;
  if (stringsIn(value).some(looksSecret)) return { error: "SECRET_VALUE", status: 400, field };
  const p = await findProject(db, slug);
  const s = p.settings;
  const bad: SettingsRefusal = { error: "INVALID_BODY", status: 400, field };
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  let patch: Record<string, unknown>;
  switch (field) {
    case "branch_pattern":
      if (value !== null && (typeof value !== "string" || !value.trim())) return bad;
      patch = { [field]: typeof value === "string" ? value.trim() : null };
      break;
    case "claim_from":
      if (value !== null && !AVANZADO[field].options!.includes(String(value))) return bad;
      patch = { [field]: value };
      break;
    case "auto_done":
      if (value !== null && typeof value !== "boolean") return bad;
      patch = { auto_done: value };
      break;
    case "team":
      if (value !== null && !Number.isInteger(value)) return bad;
      patch = { team: value === null ? null : { ...(s.team ?? {}), idle_minutes: value } };
      break;
    case "identity":
      if (value !== null && !Number.isInteger(value)) return bad;
      patch = { identity: value === null ? null : { ...(s.identity ?? {}), order: value } };
      break;
    case "resources":
    case "quotas":
    case "maquinas":
    case "velocidad":
      if (value !== null && !isObj(value)) return bad;
      patch = { [field]: value };
      break;
    case "qa":
      if (value !== null && (!isObj(value) || "verify" in value)) return bad;
      patch = { qa: { ...(isObj(value) ? value : {}), verify: s.qa?.verify ?? [] } };
      break;
  }
  await setProject(db, { project: slug, version: input.version, settings: patch }, settingsCtx);
  return settingsRead(db, slug);
}
