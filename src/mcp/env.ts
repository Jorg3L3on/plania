import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { envCommits, envStates, type DeploySource } from "../db/schema.js";
import { ENV_NAME, promoteUnblocked } from "./blockers.js";
import { ToolError } from "./errors.js";
import { markHeadlineStale } from "./project.js";
import { findProject } from "./queries.js";
import { iso, writeTx, type Ctx, type Q } from "./tx.js";

// Environment state as data: which commit and branch run there, the migrations applied, when it
// was last deployed and where that time came from (R-20), plus configuration flags (never secret
// values). Agents, CI and the Vercel poller report it with set_env; blockers and get_project read it.

type EnvRow = typeof envStates.$inferSelect;

export function envShape(e: EnvRow) {
  return {
    env: e.env,
    commit: e.commit,
    branch: e.branch,
    migrations: e.migrations,
    migrations_applied: e.migrationsApplied,
    flags: e.flags,
    deployed_at: iso(e.deployedAt),
    source: e.deploySource,
    by: e.by,
    updated_at: iso(e.updatedAt),
  };
}

export async function projectEnv(db: Q, projectId: string) {
  const rows = await db.select().from(envStates).where(eq(envStates.projectId, projectId)).orderBy(asc(envStates.env));
  return Object.fromEntries(rows.map((e) => [e.env, envShape(e)]));
}

export type FlagValue = string | number | boolean | null;

// Flags say whether something is configured; a value that looks like a credential is refused.
const SECRET_NAME = /(secret|token|password|passwd|api[_-]?key|private[_-]?key|credential)/i;
const SECRET_PREFIX = /^(sk-|sk_|pk_|ghp_|gho_|ghs_|github_pat_|xox[abp]-|AKIA|eyJ|npm_|glpat-|pypi-)/;
const RANDOM_LIKE = /^[A-Za-z0-9+/=_-]{20,}$/;

export function looksLikeSecret(flag: string, value: FlagValue): boolean {
  if (typeof value !== "string") return SECRET_NAME.test(flag) && typeof value !== "boolean";
  if (SECRET_PREFIX.test(value)) return true;
  if (value.length >= 20 && RANDOM_LIKE.test(value) && !/^[a-z][a-z0-9_-]*$/.test(value)) return true;
  return SECRET_NAME.test(flag) && value.length > 12;
}

const MIGRATION_TAG = /^(\d{1,6})(?:[_-].*)?$/;

export type SetEnvInput = {
  project: string;
  env: string;
  commit?: string;
  branch?: string;
  migrations_applied?: number;
  migrations?: string[];
  flags?: Record<string, FlagValue>;
  commits?: string[];
  deployed?: boolean | DeploySource;
};

export async function setEnv(db: Db, input: SetEnvInput, ctx: Ctx) {
  if (!ENV_NAME.test(input.env)) throw new ToolError("INVALID_ENV", { hint: "lowercase, e.g. prod" });
  const shas = [...new Set([...(input.commits ?? []), ...(input.commit ? [input.commit] : [])].map((c) => c.trim().toLowerCase()))];
  if (shas.some((c) => !/^[0-9a-f]{7,40}$/.test(c))) throw new ToolError("INVALID_ENV", { hint: "commits are 7-40 hex" });
  let m = input.migrations_applied;
  if (m !== undefined && (!Number.isInteger(m) || m < 0 || m > 999_999)) throw new ToolError("INVALID_ENV", { field: "migrations_applied" });
  const tags = input.migrations?.map((t) => t.trim()).filter(Boolean);
  if (tags) {
    const bad = tags.find((t) => !MIGRATION_TAG.test(t));
    if (bad) throw new ToolError("INVALID_ENV", { field: "migrations", hint: "tags like 0009_name", bad });
    // The highest leading number keeps migration_gte blockers working.
    m = tags.length ? Math.max(...tags.map((t) => Number(MIGRATION_TAG.exec(t)![1]))) : 0;
  }
  if (input.flags) {
    for (const [flag, value] of Object.entries(input.flags)) {
      if (!/^[a-z][a-z0-9_]{0,59}$/.test(flag)) throw new ToolError("INVALID_ENV", { field: "flags", flag, hint: "lowercase snake_case names" });
      if (value !== null && looksLikeSecret(flag, value)) throw new ToolError("SECRET_LIKE_VALUE", { flag });
      if (typeof value === "string" && value.length > 120) throw new ToolError("INVALID_ENV", { field: "flags", flag, hint: "short values only" });
    }
  }
  let source: DeploySource | undefined;
  if (input.deployed) {
    if (input.deployed === true) throw new ToolError("DEPLOY_SOURCE_REQUIRED");
    const d = input.deployed;
    if (!d.provider?.trim() || !d.deployment_id?.trim()) throw new ToolError("DEPLOY_SOURCE_REQUIRED", { hint: "provider and deployment_id" });
    source = { provider: d.provider.trim(), deployment_id: d.deployment_id.trim(), ...(d.url ? { url: d.url } : {}) };
  }
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const [before] = await tx.select().from(envStates).where(sql`${envStates.projectId} = ${p.id} and ${envStates.env} = ${input.env}`);
    const flags = { ...(before?.flags ?? {}) };
    const flagsChanged: Record<string, FlagValue> = {};
    for (const [flag, value] of Object.entries(input.flags ?? {})) {
      if (value === null) {
        if (flag in flags) {
          delete flags[flag];
          flagsChanged[flag] = null;
        }
      } else if (flags[flag] !== value) {
        flags[flag] = value;
        flagsChanged[flag] = value;
      }
    }
    const changes = {
      ...(input.commit !== undefined ? { commit: input.commit.trim().toLowerCase() } : {}),
      ...(input.branch !== undefined ? { branch: input.branch } : {}),
      ...(m !== undefined ? { migrationsApplied: m } : {}),
      ...(tags ? { migrations: tags } : {}),
      ...(input.flags ? { flags } : {}),
      ...(source ? { deployedAt: sql`now()`, deploySource: source } : {}),
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
      ...(tags ? { migrations: tags } : {}),
      ...(Object.keys(flagsChanged).length ? { flags: flagsChanged } : {}),
      deployed: !!source,
      ...(source ? { source } : {}),
      commits: shas.length,
    });
    // A flag or a deploy may be what a Blocked ticket was waiting for.
    await promoteUnblocked(tx, emit, p.id);
    return { env: envShape(row!) };
  });
}
