import type { Db } from "../db/client.js";
import { projects } from "../db/schema.js";
import { runAudit } from "../mcp/audit.js";
import type { Job } from "./index.js";

// R-31: the audit runs on a schedule and keeps its last findings per project (audit_runs), so the
// status block shows the count without anyone asking.

export async function auditAll(db: Db): Promise<number> {
  let findings = 0;
  for (const p of await db.select().from(projects)) findings += (await runAudit(db, p)).count;
  return findings;
}

export const auditJob: Job = {
  name: "audit",
  intervalMs: 10 * 60 * 1000,
  runOnce: async (db) => ({ findings: await auditAll(db) }),
};
