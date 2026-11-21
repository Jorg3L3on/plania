// PLA-I68-3: what Camino's record changes in Plania's own merges. Aceptar squashes a ticket's PR only once the owner
// chose it in Camino (merge.squash stored; until then a merge commit, as always), and Plania refuses to merge into a
// branch whose Camino rule names checks that are not green on the PR. On a private repo of GitHub's free plan that is
// the only place the rule holds; elsewhere GitHub holds it too, and Plania's refusal only says why first.
import type { Db } from "../db/client.js";
import type { Project } from "../db/schema.js";
import { caminoRow } from "./store.js";

export type Rollup = { name?: string; context?: string; conclusion?: string | null; state?: string | null; status?: string | null }[];

/** The required checks a PR's rollup does not show green, for the base branch's rule. */
export function missingChecks(required: string[], rollup: Rollup | null | undefined): string[] {
  const green = new Set(
    (rollup ?? [])
      .filter((c) => (c.conclusion ?? c.state ?? "").toUpperCase() === "SUCCESS" || (c.conclusion ?? "").toUpperCase() === "NEUTRAL" || (c.conclusion ?? "").toUpperCase() === "SKIPPED")
      .map((c) => c.name ?? c.context ?? ""),
  );
  return required.filter((n) => !green.has(n));
}

export async function mergeRules(db: Db, p: Project) {
  const { config } = await caminoRow(db, p.id);
  return {
    squash: config.merge?.squash === true,
    // PLA-I70-5: a check the owner required holds on Plania's own merges whether or not the branch rule is on (a private repo
    // on the free plan has no rule to turn on).
    required: (base: string): string[] => config.required_checks?.[base] ?? [],
  };
}
