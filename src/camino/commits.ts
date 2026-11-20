// PLA-I68-4: what a run gets from Camino's «Commits y propuestas», once the owner chose there (nothing until then):
//   commitInstructions  the text appended to the role prompt's context (the same text the page shows verbatim)
//   commitHooks         the run's own hooks (its settings file in the run's temp folder, never the product repo):
//                       before `git push` and `gh pr create|edit`, every commit since the base branch and the PR title
//                       are checked against the rules (scripts/camino-commit-hook.mjs); a forbidden AI trailer is
//                       always checked when the owner's rule forbids it, whatever the enforcement level.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { camino, type Project } from "../db/schema.js";
import { installLanguage } from "../language.js";
import { instructions, lintRules } from "../../ui/src/lib/camino-commits.js";
import { DEFAULT_COMMITS } from "./config.js";
import type { CommitSettings } from "./types.js";

/** The owner's commit settings, or null while they chose nothing in Camino. */
export async function commitSettingsOf(db: Db, projectId: string): Promise<{ settings: CommitSettings; folders: string[] } | null> {
  const [row] = await db.select({ config: camino.config, discovery: camino.discovery }).from(camino).where(eq(camino.projectId, projectId)).limit(1);
  if (!row?.config.commits) return null;
  return { settings: { ...DEFAULT_COMMITS, ...row.config.commits }, folders: row.discovery?.mac.folders ?? [] };
}

export async function commitInstructions(db: Db, p: Project): Promise<string | null> {
  const c = await commitSettingsOf(db, p.id);
  if (!c?.settings.convention) return null;
  return `## Commits\n\n${instructions(c.settings, c.folders, installLanguage())}`;
}

export const HOOK_SCRIPT = path.resolve(import.meta.dirname, "../../scripts/camino-commit-hook.mjs");
type Hook = { matcher?: string; hooks: { type: "command"; command: string; timeout?: number }[] };

/** Writes the run's commit rules next to its settings and returns the hooks that read them, or null. */
export async function commitHooks(db: Db, p: Project, tmp: string, base: string): Promise<{ PreToolUse?: Hook[]; PostToolUse?: Hook[] } | null> {
  const c = await commitSettingsOf(db, p.id);
  if (!c) return null;
  const all = lintRules(c.settings, installLanguage());
  // «Solo instrucciones» checks nothing but the owner's rule on AI trailers and signatures.
  const rules = c.settings.enforce === "instr" ? all.filter((r) => r.id === "ai" || r.id === "signed") : all;
  if (!rules.length) return null;
  const file = path.join(tmp, "commit-rules.json");
  writeFileSync(file, JSON.stringify({ base, rules, on_commit: c.settings.enforce === "hook" }), { mode: 0o600 });
  const command = `node ${JSON.stringify(HOOK_SCRIPT)} ${JSON.stringify(file)}`;
  const hook: Hook = { matcher: "Bash", hooks: [{ type: "command", command, timeout: 30 }] };
  return { PreToolUse: [hook], ...(c.settings.enforce === "hook" ? { PostToolUse: [hook] } : {}) };
}
