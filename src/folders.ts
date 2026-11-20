// PLA-I2-3: where an install keeps its projects, its run copies (worktrees) and its canvases. Asked at first start
// with neutral defaults under the user's home; an environment variable always wins, so an install configured by
// hand is unchanged.
//   projects    PLANIA_PROJECTS_ROOT, else the first-start answer, else ~/plania/projects
//   worktrees   PLANIA_WORKTREES_ROOT, else the first-start answer, else ~/plania/worktrees
//   canvases    PLANIA_CANVASES_ROOT, else ~/plania/canvases
// The first-start answers live in machine_state (key "folders"); loadFolders copies them into process.env at start,
// the way src/install-state.ts does with the time zone, so every reader keeps reading the variable.
import { homedir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { machineState } from "./db/schema.js";
import type { Q } from "./mcp/tx.js";

export const FOLDERS_KEY = "folders";
export type Folders = { projects: string; worktrees: string };

/** The defaults: a "plania" folder in the user's home. */
export function defaultFolders(home: string = homedir()): Folders & { canvases: string } {
  const root = path.join(home, "plania");
  return { projects: path.join(root, "projects"), worktrees: path.join(root, "worktrees"), canvases: path.join(root, "canvases") };
}

/** F5: the folders first start offers, written the way this machine writes paths: a variable set by hand wins,
 * else the default under the home (on Windows C:\Users\<user>\plania\projects). */
export function offeredFolders(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): Folders {
  const d = defaultFolders(home);
  return { projects: env.PLANIA_PROJECTS_ROOT?.trim() || d.projects, worktrees: env.PLANIA_WORKTREES_ROOT?.trim() || d.worktrees };
}

export const expandHome = (p: string, home: string = homedir()): string => p.replace(/^~(?=$|[\\/])/, home);

/** A folder as the owner may type it: absolute, or starting with ~. */
export function validFolder(raw: string | null | undefined): boolean {
  const p = (raw ?? "").trim();
  if (!p || p.length > 500 || /[\u0000-\u001f]/.test(p)) return false;
  return p.startsWith("~") || path.isAbsolute(p);
}

/** Stores the first-start answers. Blank answers are left out (the default applies). */
export async function saveFolders(db: Q, f: Partial<Folders>): Promise<void> {
  const value: Partial<Folders> = {};
  if (f.projects?.trim()) value.projects = f.projects.trim();
  if (f.worktrees?.trim()) value.worktrees = f.worktrees.trim();
  await db
    .insert(machineState)
    .values({ key: FOLDERS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: machineState.key, set: { value, updatedAt: new Date() } });
}

/** Copies the stored answers into env where the variable is unset. Returns what was stored. */
export async function loadFolders(db: Q, env: NodeJS.ProcessEnv = process.env): Promise<Partial<Folders>> {
  const [row] = await db.select({ value: machineState.value }).from(machineState).where(eq(machineState.key, FOLDERS_KEY)).limit(1);
  const f = (row?.value ?? {}) as Partial<Folders>;
  if (typeof f.projects === "string" && f.projects && !env.PLANIA_PROJECTS_ROOT?.trim()) env.PLANIA_PROJECTS_ROOT = f.projects;
  if (typeof f.worktrees === "string" && f.worktrees && !env.PLANIA_WORKTREES_ROOT?.trim()) env.PLANIA_WORKTREES_ROOT = f.worktrees;
  return f;
}
