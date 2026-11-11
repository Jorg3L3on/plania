// PLA-I38-2: allowlist exceptions are written to the same file scan:diff reads.
// Only the screen actor (human plus the screen session) may append one. A bot cannot.

import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Db } from "../db/client.js";
import { allowlistPath } from "../lib/scan/run.js";
import { ToolError, findProject } from "./queries.js";
import { isScreenActor, writeTx, type Ctx } from "./tx.js";

const MAX = 200;

export type AllowEntry = { entry_kind: "path" | "literal" | "pattern"; path?: string; line: string };

export function classifyAllowEntry(raw: string): AllowEntry | null {
  const line = raw.trim();
  if (!line || line.length > MAX || line.startsWith("#")) return null;
  if (line.startsWith("path:")) {
    const body = line.slice("path:".length).trim();
    if (!body || body.length > 160) return null;
    return { entry_kind: "path", path: body, line: `path:${body}` };
  }
  if (/^\/.+\/[a-z]*$/.test(line)) return { entry_kind: "pattern", line };
  if (/\s/.test(line)) return null;
  return { entry_kind: "literal", line };
}

/** Append one exception. Throws HUMAN_ONLY unless the caller is the screen actor. */
export function recordAllowlistException(
  ctx: Ctx,
  entry: string,
  file = allowlistPath(),
): { recorded: true; entry_kind: AllowEntry["entry_kind"]; path?: string } {
  if (!ctx.human || !isScreenActor(ctx.actor)) {
    throw new ToolError("HUMAN_ONLY", { hint: "only Jorge records a scan allowlist exception" });
  }
  const parsed = classifyAllowEntry(entry);
  if (!parsed) throw new ToolError("INVALID_FILTER", { field: "entry", hint: "one path:, /regex/, or literal line" });
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const already = existing.split(/\r?\n/).some((item) => item.trim() === parsed.line);
  if (!already) {
    const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    appendFileSync(file, `${prefix}${parsed.line}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  return { recorded: true as const, entry_kind: parsed.entry_kind, ...(parsed.path ? { path: parsed.path } : {}) };
}

/** Screen-only write. The file is the record; the event names the kind and, for a path, the path. */
export async function setScanAllowlist(db: Db, input: { project: string; entry: string }, ctx: Ctx) {
  const recorded = recordAllowlistException(ctx, input.entry);
  const project = await findProject(db, input.project);
  await writeTx(db, project, ctx, async (_tx, emit) => {
    await emit("scan.allowlist", null, { entry_kind: recorded.entry_kind, ...(recorded.path ? { path: recorded.path } : {}) });
  });
  return { recorded: true, entry_kind: recorded.entry_kind };
}
