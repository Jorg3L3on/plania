// PLA-I2-5: the start branch, a project setting (settings.start_branch) with today's value as its default. Every
// ticket's worktree is cut from origin/<start branch>, the read copy and the test copy sit on it, QA and the pack
// guard diff against it, and Aceptar merges into it alone. Everything reads it through startBranchOf, so the
// rule holds in one place: it is never a protected branch (main, master, production, prod), and a stored value that
// is not a valid branch name falls back to the default instead of widening what a run may target.
import { PROTECTED_BRANCHES } from "./deny.js";

export const DEFAULT_START_BRANCH = "sandbox";

// A conservative subset of git's ref rules: letters, digits, . _ - / ; no "..", no "//", no leading or trailing
// "/" or ".", no ".lock" ending. At most 100 characters.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

/** Why a name cannot be the start branch, or null when it can. */
export function startBranchProblem(name: unknown): string | null {
  if (typeof name !== "string" || !NAME.test(name)) return "a branch name: letters, digits, . _ - /, at most 100 characters";
  if (name.includes("..") || name.includes("//") || name.endsWith("/") || name.endsWith(".") || name.endsWith(".lock")) return "not a valid git branch name";
  if ((PROTECTED_BRANCHES as readonly string[]).includes(name.toLowerCase())) return `never a protected branch (${PROTECTED_BRANCHES.join(", ")})`;
  return null;
}

/** The project's start branch: settings.start_branch when it is valid, else the default. */
export function startBranchOf(settings: { start_branch?: unknown } | null | undefined): string {
  const v = settings?.start_branch;
  return typeof v === "string" && startBranchProblem(v) === null ? v : DEFAULT_START_BRANCH;
}
