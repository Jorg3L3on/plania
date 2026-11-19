// NEWPROJ-4: is a project ready to work? One list, one item per thing a run needs or uses, each ready, missing or
// not_needed, and marked when its absence stops a run from starting (the runner fails before Claude starts). The
// sheet «Nuevo proyecto», the Reanudar sheet and the project page read it (GET /api/company/projects/:slug/readiness).
// Reads only. The checks are the runner's own: the role prompt lookup (./prompts.ts), the token and Claude binary the
// runner resolves (./runner.ts start and claudeCommand), the folder checks of ./repo-check.ts, and the context docs
// projectContext reads. The brief doctor (src/brief/doctor.ts) checks the same token and binary for the brief; its
// checks print lines for a terminal, so this list shares the helpers underneath, not the lines.
// Environment, git and the filesystem are injected; tests never touch the real machine.
import { existsSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { docs, tasks, type ProjectSettings } from "../db/schema.js";
import { findProject } from "../mcp/queries.js";
import { roleOf, type RunnerRole } from "./limits.js";
import { rolePrompts } from "./prompts.js";
import { checkRepoFolder, defaultRepoCheckDeps, type RepoCheckCode, type RepoCheckDeps } from "./repo-check.js";
import { CONTEXT_DOCS, claudeCommand } from "./runner.js";
import { teamOf } from "./team.js";
import { repoPathOf } from "./worktree.js";

export type ReadinessState = "ready" | "missing" | "not_needed";

// Every id the list can carry. The screen has a sentence for each (ui/src/lib/listo.ts); a test fails when one is
// added here without one. A seat's prompt is prompt.<role>.
export const READINESS_IDS = [
  "prompt.product-owner",
  "prompt.taller",
  "prompt.research",
  "prompt.artist",
  "prompt.asistente",
  "prompt.qa",
  "prompt.copy",
  "prompt.seguridad",
  "prompt.marketing",
  "prompt.data",
  "prompt.unknown",
  "runner_token",
  "claude_bin",
  "code",
  "github",
  "capture",
  "verify",
  "context.glossary",
  "context.commands",
  "context.map",
] as const;
export type ReadinessId = (typeof READINESS_IDS)[number];

// why: what exactly is missing or not needed (a repo check code, "no_code", "no_folder"...). seat: the agent's slug
// for a prompt item. path and branch: the folder the code item checked.
export type ReadinessItem = {
  id: ReadinessId;
  state: ReadinessState;
  blocks: boolean;
  why?: RepoCheckCode | "no_code" | "not_found";
  seat?: string;
  path?: string;
  branch?: string;
};
export type Readiness = { slug: string; title: string; items: ReadinessItem[]; blocking: number; tasks: number };

export type ReadinessDeps = { env?: NodeJS.ProcessEnv; repoCheck?: RepoCheckDeps; exists?: (p: string) => boolean };

const CONTEXT_IDS: Record<(typeof CONTEXT_DOCS)[number], ReadinessId> = {
  "Context: Glossary": "context.glossary",
  "Context: Commands": "context.commands",
  "Context: Map": "context.map",
};

// The command the runner spawns: a path is looked at directly, a bare name is looked for on PATH (with PATHEXT on
// Windows), the way the shell would find it. The binary is never run.
export function claudeFound(env: NodeJS.ProcessEnv, exists: (p: string) => boolean): boolean {
  const cmd = claudeCommand(null, env);
  if (cmd.includes("/") || cmd.includes("\\")) return exists(cmd);
  const exts = process.platform === "win32" ? ["", ...(env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)] : [""];
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) for (const ext of exts) if (exists(path.join(dir, cmd + ext))) return true;
  return false;
}

export async function projectReadiness(db: Db, slug: string, deps: ReadinessDeps = {}): Promise<Readiness> {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const project = await findProject(db, slug);
  const settings: ProjectSettings = project.settings ?? {};
  const items: ReadinessItem[] = [];

  // Each seat's prompt: the runner fails a seat with no prompt («fail: no prompt doc») before Claude starts.
  const team = await teamOf(db, project.id);
  const roles = team.map((a) => roleOf(a));
  const prompts = await rolePrompts(db, [...new Set(roles.filter((r): r is RunnerRole => !!r))], env);
  team.forEach((a, i) => {
    const role = roles[i];
    if (!role) return void items.push({ id: "prompt.unknown", state: "missing", blocks: true, seat: a.slug });
    items.push({ id: `prompt.${role}`, state: prompts.has(role) ? "ready" : "missing", blocks: true, seat: a.slug });
  });

  // The runner refuses every run without its token, and spawns the Claude binary for every run.
  items.push({ id: "runner_token", state: env.PLANIA_RUNNER_TOKEN?.trim() ? "ready" : "missing", blocks: true });
  items.push({ id: "claude_bin", state: claudeFound(env, exists) ? "ready" : "missing", blocks: true });

  // The code: none on purpose, or the folder every ticket's worktree is cut from (origin/<start branch>).
  const noCode = settings.local?.no_code === true;
  if (noCode) items.push({ id: "code", state: "not_needed", blocks: false, why: "no_code" });
  else {
    const check = await checkRepoFolder(repoPathOf(project.slug, settings, env), deps.repoCheck ?? defaultRepoCheckDeps);
    items.push(check.ok ? { id: "code", state: "ready", blocks: false, path: check.path, branch: check.branch } : { id: "code", state: "missing", blocks: true, why: check.failed!, path: check.path, branch: check.branch });
  }

  // What a project with code uses: none of these stops a run, each makes the team's work weaker without it.
  const withCode = (id: ReadinessId, have: boolean) => items.push(noCode ? { id, state: "not_needed", blocks: false, why: "no_code" } : { id, state: have ? "ready" : "missing", blocks: false });
  withCode("github", !!settings.github?.repo?.trim());
  withCode("capture", !!settings.capture);
  withCode("verify", (settings.qa?.verify?.length ?? 0) > 0);

  // The context docs appended to a session's first prompt (projectContext in ./runner.ts).
  const ctx = await db
    .select({ title: docs.title, markdown: docs.markdown })
    .from(docs)
    .where(and(eq(docs.projectId, project.id), isNull(docs.taskId), inArray(docs.title, [...CONTEXT_DOCS])));
  for (const title of CONTEXT_DOCS) items.push({ id: CONTEXT_IDS[title], state: ctx.some((d) => d.title === title && d.markdown.trim()) ? "ready" : "missing", blocks: false });

  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.projectId, project.id));
  return { slug: project.slug, title: project.title, items, blocking: items.filter((i) => i.state === "missing" && i.blocks).length, tasks: n?.n ?? 0 };
}
