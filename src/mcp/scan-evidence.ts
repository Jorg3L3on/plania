// PLA-I38-2: an app-repo code ticket cannot reach Merged without a scan pass on the PR head.
// After a squash the merge commit is new; the pass names the scanned head, which is the PR head.

import { and, eq, sql } from "drizzle-orm";
import { results, type Project, type Task } from "../db/schema.js";
import { ToolError, prRowOf } from "./queries.js";
import type { Q } from "./tx.js";

export const APP_PROJECTS = ["filmia", "micasa", "zigzag", "workia"] as const;

// A scan commit is the whole head. A short prefix, or an empty string, is not a match.
// PLA-I38-3 may also accept or require the GitHub check plania-scan = success on this head.
const SCAN_SHA = /^[0-9a-f]{40}$/;

export function scanCommitMatches(commit: string, head: string): boolean {
  const left = commit.trim().toLowerCase();
  const right = head.trim().toLowerCase();
  return SCAN_SHA.test(left) && SCAN_SHA.test(right) && left === right;
}

export function scanApplies(slug: string, kind: string, workType: string | null): boolean {
  return (APP_PROJECTS as readonly string[]).includes(slug) && kind === "ticket" && (workType ?? "code") === "code";
}

export async function assertScanEvidence(tx: Q, p: Project, t: Task): Promise<void> {
  if (!scanApplies(p.slug, t.kind, t.workType)) return;
  const pr = await prRowOf(tx, t);
  const head = pr?.headSha ?? null;
  const passes = await tx
    .select({ commit: results.commit })
    .from(results)
    .where(and(eq(results.taskId, t.id), eq(results.kind, "scan"), eq(results.verdict, "pass"), sql`${results.commit} is not null`));
  if (head && passes.some((row) => scanCommitMatches(row.commit!, head))) return;
  throw new ToolError("SCAN_REQUIRED", {
    head: head && SCAN_SHA.test(head.trim().toLowerCase()) ? head.trim().toLowerCase() : null,
    accepts: ["scan pass with a 40-hex commit"],
    hint: head
      ? "a scan pass whose commit is exactly the PR head (40 hex, the scanned head after a squash). Run pnpm merge-gate --record."
      : "a scan pass whose commit is the PR head (40 hex). Run pnpm merge-gate --record.",
  });
}
