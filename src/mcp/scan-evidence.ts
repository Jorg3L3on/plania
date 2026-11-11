// PLA-I38-2: an app-repo code ticket cannot reach Merged without a scan pass on the PR head.
// After a squash the merge commit is new; the pass names the scanned head, which is the PR head.

import { and, eq, sql } from "drizzle-orm";
import { results, type Project, type Task } from "../db/schema.js";
import { ToolError, prRowOf } from "./queries.js";
import type { Q } from "./tx.js";

export const APP_PROJECTS = ["filmia", "micasa", "zigzag", "workia"] as const;

const sameSha = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

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
  if (head && passes.some((row) => sameSha(row.commit!, head))) return;
  throw new ToolError("SCAN_REQUIRED", {
    head: head ? head.slice(0, 7) : null,
    accepts: ["scan pass with commit"],
    hint: head
      ? `a scan pass whose commit is ${head.slice(0, 7)} (the PR head; after a squash that is the scanned head, not the squash commit)`
      : "a scan pass whose commit is the PR head. Run pnpm merge-gate, then add_result kind scan.",
  });
}
