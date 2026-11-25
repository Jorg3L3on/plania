// La máquina's warning on Inicio (components/home/parts.tsx): the chips per kind and the total on «Ver la máquina».
// Pure and type-only imports, so the node tests load it (test/avisos-maquina.test.ts).
import type { MachineFinding, MachineTotals } from "./types.js";

/**
 * The findings that repeat an item the totals already count. For every unreleased footprint with no project,
 * footprintFindings (src/mcp/footprint-audit.ts) writes one of these for an orphan or stale row, and machineTotals
 * counts that same row in `orphan` or `stale`. Counted as both, one problem read as two.
 */
export const HALLAZGOS_REPETIDOS = new Set(["FOOTPRINT_ORPHAN", "FOOTPRINT_STALE", "WORKTREE_MERGED_NOT_REMOVED"]);

export type AvisosMaquina = { hallazgos: number; orphan: number; stale: number; total: number; primero: MachineFinding | null };

/**
 * Each problem once: the findings that are not an orphan or stale row (the backup, a test database with no worktree, a
 * second Postgres, a login service), then the orphan and stale rows from the totals. The line's example is the first
 * of those other findings, or the first finding when every one repeats a row.
 */
export function avisosMaquina(m: { totals: Pick<MachineTotals, "orphan" | "stale">; findings: readonly MachineFinding[] }): AvisosMaquina {
  const otros = m.findings.filter((f) => !HALLAZGOS_REPETIDOS.has(f.code));
  const { orphan, stale } = m.totals;
  return { hallazgos: otros.length, orphan, stale, total: otros.length + orphan + stale, primero: otros[0] ?? m.findings[0] ?? null };
}
