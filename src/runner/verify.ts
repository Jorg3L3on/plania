// AUDIT-1: the project's checks (settings.qa.verify: test, typecheck, lint) run where the work is, at the moment the
// builder says it is done. finish calls this before it accepts a delivery, so a failing test comes back to the same
// run, with its context still warm, instead of costing a QA pass and a second run. The QA lane still runs the list
// on the delivered commit (src/runner/qa.ts); this is the earlier, cheaper stop.
// Output is kept short on purpose: a passing check says nothing, a failing one returns its last lines.
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { checkoutEnv, shellExec, type Exec } from "../captures/run.js";
import type { Project, Task } from "../db/schema.js";
import { verifyListOf, type ReadFile } from "./build-step.js";

export const VERIFY_WORK = new Set(["code", "bug", "debt"]);
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const TAIL_LINES = 40;
const TAIL_CHARS = 4000;
// One check may take this long at most inside finish (the QA lane allows the project's own, longer limit).
const MAX_MINUTES = 15;

export type VerifyItem = { name: string; command: string; timeout_minutes?: number };
export type VerifyOutcome = { name: string; command: string; ok: boolean; exit_code: number | null; duration_s: number; tail: string };

export function tailOf(out: string): string {
  const lines = out.replace(ANSI, "").replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  const tail = lines.slice(-TAIL_LINES).join("\n");
  return tail.length > TAIL_CHARS ? tail.slice(-TAIL_CHARS) : tail;
}

// Runs the list in order and stops at the first failure: the builder fixes one thing at a time.
export async function runVerifyList(cwd: string, items: VerifyItem[], exec: Exec = shellExec): Promise<VerifyOutcome[]> {
  const out: VerifyOutcome[] = [];
  for (const v of items) {
    const started = Date.now();
    const r = await exec(v.command, { cwd, timeoutMs: Math.min(v.timeout_minutes ?? 10, MAX_MINUTES) * 60_000, env: checkoutEnv() });
    const ok = r.code === 0;
    out.push({ name: v.name, command: v.command, ok, exit_code: r.code, duration_s: Math.round((Date.now() - started) / 1000), tail: ok ? "" : tailOf(`${r.stdout}\n${r.stderr}`) });
    if (!ok) break;
  }
  return out;
}

export type VerifyPlan = { run: true; cwd: string; items: VerifyItem[] } | { run: false; warning?: string };

// Whether finish runs the checks for this ticket, and where. It does when the ticket is code-like, the project has a
// verify list and has not turned this off, the caller holds the ticket, and its workspace is a folder on this machine.
// PLA-I74-9: the list includes the host's production build, read from the workspace (src/runner/build-step.ts).
export function verifyPlan(p: Pick<Project, "settings">, t: Pick<Task, "kind" | "workType" | "workspace" | "owner">, sessionId: string, exists: (path: string) => boolean = existsSync, read?: ReadFile): VerifyPlan {
  const qa = p.settings?.qa;
  const ws0 = t.workspace?.worktree_path && exists(t.workspace.worktree_path) ? t.workspace.worktree_path : null;
  const items = verifyListOf(p, ws0, read);
  if (t.kind !== "ticket" || !VERIFY_WORK.has(t.workType ?? "code") || items.length === 0 || qa?.verify_on_finish === false) return { run: false };
  if (!t.owner || t.owner.session_id !== sessionId) return { run: false };
  const ws = t.workspace;
  if (!ws?.worktree_path) return { run: false, warning: "checks not run at finish: the ticket has no workspace folder" };
  if (ws.machine && ws.machine !== hostname()) return { run: false, warning: `checks not run at finish: the workspace is on ${ws.machine}` };
  if (!exists(ws.worktree_path)) return { run: false, warning: "checks not run at finish: the workspace folder is not on this machine" };
  return { run: true, cwd: ws.worktree_path, items };
}
