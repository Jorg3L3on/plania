import type { Db } from "../db/client.js";
import type { Project, Task } from "../db/schema.js";
import { readerOf } from "../store/pg.js";
import { CLAIMABLE_BUT_WAITING, auditProject, canonicalAuditCode, runAudit, type Finding } from "./audit.js";
import { retireDecision } from "./decisions.js";
import { setEnv } from "./env.js";
import { ToolError } from "./errors.js";
import { iso, webCtx, type Q } from "./tx.js";

// 2.11 (item 4): Orden, the audit on screen. The audit job keeps its last run per project
// (audit_runs, every ten minutes); this file says which findings Jorge can clear with one click or a
// copied command, runs those fixes as him through the existing tool functions, and picks the chores
// get_next offers an agent when nothing is claimable.

export type CanFix = "retire_decision" | "copy" | "mark_deployed" | "open";

const ONE_CLICK: Record<string, CanFix> = {
  DECISION_STALE_REF: "retire_decision",
  DECISION_CONTRADICTS_DONE: "retire_decision",
  BRANCH_MERGED_NOT_DELETED: "copy",
  WORKTREE_MERGED_NOT_REMOVED: "copy",
  BRANCH_WITHOUT_TICKET: "copy",
  ENV_DEPLOYED_AT_MISSING: "mark_deployed",
};

// Findings an agent clears with a tool (the fix hint names it), offered by get_next as chores.
// STATE_NOTE_STALE is not an audit finding (2.11 demoted it to a flag on the note); it is a chore only.
export const AGENT_CHORES = new Set([
  "TASK_MISSING_PR_URL",
  "BLOCKED_BUT_SATISFIED",
  CLAIMABLE_BUT_WAITING,
  "INITIATIVE_SCOPE_HAS_STATUS",
  "WAITING_ON_JORGE_FREE_TEXT",
  "STATE_NOTE_STALE",
]);

export type OrdenFinding = Finding & { can_fix: CanFix; owner: "jorge" | "agents" };

export function canFix(f: Finding): CanFix {
  const fix = ONE_CLICK[f.code] ?? "open";
  // Runs stored before 2.11 have no id: those fall back to "open" until the job runs again.
  if (fix === "copy") return f.command ? "copy" : "open";
  return fix !== "open" && !f.id ? "open" : fix;
}

// Review, not a chore: the owner reads the quote. get_next does not offer it (not in AGENT_CHORES).
const OWNER_REVIEW = new Set(["DELEGATED_ANSWER"]);

export const ordenShape = (f: Finding): OrdenFinding => {
  const code = canonicalAuditCode(f.code);
  const normalized = code === f.code ? f : { ...f, code };
  const can_fix = canFix(normalized);
  return { ...normalized, can_fix, owner: OWNER_REVIEW.has(normalized.code) || can_fix !== "open" ? "jorge" : "agents" };
};

/** GET /api/projects/:slug/audit: the latest stored run (one is made if the project has none yet). */
export async function projectAudit(db: Db, p: Project) {
  const r = readerOf(db);
  let row = await r.get("auditRuns", { projectId: p.id });
  if (!row) {
    await runAudit(db, p);
    row = await r.get("auditRuns", { projectId: p.id });
  }
  const findings = (row?.findings ?? []).map(ordenShape);
  return { project: p.slug, at: iso(row?.at ?? null), count: findings.length, findings };
}

/** The stored count per project, for the home tiles. */
export async function auditCounts(db: Q): Promise<Map<string, number>> {
  // One row per project: every project's tile needs its count.
  const rows = await readerOf(db).find("auditRuns");
  return new Map(rows.map((r) => [r.projectId, r.count]));
}

export type FixInput = { code: string; key?: string | null; id: string };

/**
 * POST /api/projects/:slug/audit/fix, as Jorge. The finding must still be there (a fresh audit),
 * then the matching tool runs: retire_decision, or set_env deployed with a screen source. Copy-only
 * findings have nothing to run: the screen shows the command. The audit is stored again afterwards.
 */
export async function fixFinding(db: Db, p: Project, input: FixInput) {
  const fix = ONE_CLICK[input.code];
  if (!fix || fix === "copy") throw new ToolError("FINDING_NOT_FIXABLE", { code: input.code, hint: fix === "copy" ? "copy the command and run it" : "fix it with the tool its fix_hint names" });
  const live = (await auditProject(db, p)).find((f) => f.code === input.code && f.id === input.id && (input.key === undefined || f.key === input.key));
  if (!live) throw new ToolError("FINDING_NOT_FOUND", { code: input.code, id: input.id });
  if (fix === "retire_decision") {
    await retireDecision(db, { project: p.slug, decision_id: input.id, reason: `Retirada desde Orden: ${live.detail}` }, webCtx);
  } else {
    await setEnv(db, { project: p.slug, env: input.id, deployed: { provider: "jorge", deployment_id: `orden:${new Date().toISOString().slice(0, 10)}` } }, webCtx);
  }
  await runAudit(db, p);
  return projectAudit(db, p);
}

/**
 * get_next's chore when nothing is claimable: the first finding an agent can fix, from the last
 * stored run, else an open initiative whose state_note predates its last move. null when the
 * project is in order.
 */
export async function choreFor(db: Q, p: Project): Promise<Finding | null> {
  const r = readerOf(db);
  const row = await r.get("auditRuns", { projectId: p.id });
  const fromAudit = (row?.findings ?? []).find((f) => AGENT_CHORES.has(canonicalAuditCode(f.code)));
  if (fromAudit) return fromAudit;
  // Open initiatives with a state_note, in key order (sorted by the store, so text order stays the database's).
  const open = (await r.find("tasks", { projectId: p.id, kind: "initiative" }, { orderBy: [{ column: "key" }] })).filter(
    (t) => t.status !== "Done" && t.status !== "Won't do" && t.stateNote !== "" && t.stateNoteAt !== null,
  );
  // The last move of one: its own status change or a child's (wherever the child lives), null when none has one.
  const children = open.length ? await r.find("tasks", { parentId: open.map((t) => t.id) }) : [];
  const lastMove = (t: Task): number | null => {
    const times = [t, ...children.filter((c) => c.parentId === t.id)].flatMap((c) => (c.statusChangedAt ? [c.statusChangedAt.getTime()] : []));
    return times.length ? Math.max(...times) : null;
  };
  const stale = open.find((t) => {
    const last = lastMove(t);
    return last !== null && t.stateNoteAt!.getTime() < last;
  });
  if (stale) {
    return {
      code: "STATE_NOTE_STALE",
      key: stale.key,
      detail: `state_note from ${iso(stale.stateNoteAt)} predates the last move; the derived state (get_task state) already says where it stands`,
      fix_hint: "set_task state_note with what the data cannot say, or an empty string to drop it",
    };
  }
  return null;
}

/** get_context: the stored count, and the findings on the caller's tickets. */
export async function auditForKeys(db: Q, p: Project, keys: Set<string>) {
  const row = await readerOf(db).get("auditRuns", { projectId: p.id });
  const findings = row?.findings ?? [];
  return { count: findings.length, at: iso(row?.at ?? null), on_my_tickets: findings.filter((f) => f.key && keys.has(f.key)) };
}
