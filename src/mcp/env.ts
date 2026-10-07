import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { envCommits, envStates } from "../db/schema.js";
import { ENV_NAME } from "./blockers.js";
import { ToolError } from "./errors.js";
import { markHeadlineStale } from "./project.js";
import { findProject } from "./queries.js";
import { iso, writeTx, type Ctx, type Q } from "./tx.js";

// Environment state as data: which commit and branch run there, the highest migration applied,
// when it was last deployed. Agents and CI report it with set_env; blockers and get_project read it.

type EnvRow = typeof envStates.$inferSelect;

function envShape(e: EnvRow) {
  return {
    env: e.env,
    commit: e.commit,
    branch: e.branch,
    migrations_applied: e.migrationsApplied,
    deployed_at: iso(e.deployedAt),
    by: e.by,
    updated_at: iso(e.updatedAt),
  };
}

export async function projectEnv(db: Q, projectId: string) {
  const rows = await db.select().from(envStates).where(eq(envStates.projectId, projectId)).orderBy(asc(envStates.env));
  return Object.fromEntries(rows.map((e) => [e.env, envShape(e)]));
}

export async function setEnv(
  db: Db,
  input: {
    project: string;
    env: string;
    commit?: string;
    branch?: string;
    migrations_applied?: number;
    commits?: string[];
    deployed?: boolean;
  },
  ctx: Ctx,
) {
  if (!ENV_NAME.test(input.env)) throw new ToolError("INVALID_ENV", { hint: "lowercase, e.g. prod" });
  const shas = [...new Set([...(input.commits ?? []), ...(input.commit ? [input.commit] : [])].map((c) => c.trim().toLowerCase()))];
  if (shas.some((c) => !/^[0-9a-f]{7,40}$/.test(c))) throw new ToolError("INVALID_ENV", { hint: "commits are 7-40 hex" });
  const m = input.migrations_applied;
  if (m !== undefined && (!Number.isInteger(m) || m < 0 || m > 999_999)) throw new ToolError("INVALID_ENV", { field: "migrations_applied" });
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const changes = {
      ...(input.commit !== undefined ? { commit: input.commit.trim().toLowerCase() } : {}),
      ...(input.branch !== undefined ? { branch: input.branch } : {}),
      ...(m !== undefined ? { migrationsApplied: m } : {}),
      ...(input.deployed ? { deployedAt: sql`now()` } : {}),
    };
    const [row] = await tx
      .insert(envStates)
      .values({ projectId: p.id, env: input.env, by: ctx.actor, ...changes })
      .onConflictDoUpdate({
        target: [envStates.projectId, envStates.env],
        set: { ...changes, by: ctx.actor, updatedAt: sql`now()` },
      })
      .returning();
    if (shas.length) {
      await tx
        .insert(envCommits)
        .values(shas.map((sha) => ({ projectId: p.id, env: input.env, sha })))
        .onConflictDoNothing();
    }
    await markHeadlineStale(tx, p.id);
    await emit("env.set", null, {
      env: input.env,
      commit: row!.commit,
      branch: row!.branch,
      migrations_applied: row!.migrationsApplied,
      deployed: !!input.deployed,
      commits: shas.length,
    });
    return { env: envShape(row!) };
  });
}
