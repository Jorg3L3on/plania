import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { auditRuns, tasks, type Project } from "../db/schema.js";
import { auditProject, runAudit, type Finding } from "./audit.js";
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
  "CLAIMABLE_BUT_GATED",
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

export const ordenShape = (f: Finding): OrdenFinding => {
  const can_fix = canFix(f);
  return { ...f, can_fix, owner: can_fix === "open" ? "agents" : "jorge" };
};

/** GET /api/projects/:slug/audit: the latest stored run (one is made if the project has none yet). */
export async function projectAudit(db: Db, p: Project) {
  let [row] = await db.select().from(auditRuns).where(eq(auditRuns.projectId, p.id)).limit(1);
  if (!row) {
    await runAudit(db, p);
    [row] = await db.select().from(auditRuns).where(eq(auditRuns.projectId, p.id)).limit(1);
  }
  const findings = (row?.findings ?? []).map(ordenShape);
  return { project: p.slug, at: iso(row?.at ?? null), count: findings.length, findings };
}

/** The stored count per project, for the home tiles. */
export async function auditCounts(db: Q): Promise<Map<string, number>> {
  const rows = await db.select({ projectId: auditRuns.projectId, count: auditRuns.count }).from(auditRuns);
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
  const [row] = await db.select().from(auditRuns).where(eq(auditRuns.projectId, p.id)).limit(1);
  const fromAudit = (row?.findings ?? []).find((f) => AGENT_CHORES.has(f.code));
  if (fromAudit) return fromAudit;
  const stale = await db
    .select({ key: tasks.key, at: tasks.stateNoteAt })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, p.id),
        eq(tasks.kind, "initiative"),
        sql`${tasks.status} not in ('Done', 'Won''t do')`,
        sql`${tasks.stateNote} <> ''`,
        sql`${tasks.stateNoteAt} < (select max(c.status_changed_at) from tasks c where c.parent_id = ${tasks.id} or c.id = ${tasks.id})`,
      ),
    )
    .orderBy(asc(tasks.key))
    .limit(1);
  if (stale[0]) {
    return {
      code: "STATE_NOTE_STALE",
      key: stale[0].key,
      detail: `state_note from ${iso(stale[0].at)} predates the last move; the derived state (get_task state) already says where it stands`,
      fix_hint: "set_task state_note with what the data cannot say, or an empty string to drop it",
    };
  }
  return null;
}

/** get_context: the stored count, and the findings on the caller's tickets. */
export async function auditForKeys(db: Q, p: Project, keys: Set<string>) {
  const [row] = await db.select().from(auditRuns).where(eq(auditRuns.projectId, p.id)).limit(1);
  const findings = row?.findings ?? [];
  return { count: findings.length, at: iso(row?.at ?? null), on_my_tickets: findings.filter((f) => f.key && keys.has(f.key)) };
}
