// What a new install's screen needs beyond the plan itself (the first-install audit, 19 Nov 2026):
//   GET  /api/onboarding/github       F2: whether Plania can reach GitHub (gh signed in with write access, or a
//                                      token), read before a project with code is made. gh is no longer required at
//                                      install, so «Nuevo proyecto» asks here when a repository is given.
//   POST /api/onboarding/claude-code  P5: a dedicated agent token for the owner's own Claude Code, and the address it
//                                      connects to. The secret is shown once, like every token (src/auth/tokens.ts);
//                                      MCP_BEARER_TOKEN never leaves .env. Screen cookie only: a Bearer is refused.
// quietHomeSlug: F7, the home project first start makes (Asistente's home) while it holds no work. The project lists
// leave it out (ui/src/lib/proyectos-visibles.ts); reads by slug still find it.
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { issueToken } from "../auth/tokens.js";
import { withDb, type Db } from "../db/client.js";
import { projects, tasks } from "../db/schema.js";
import { WEB_ACTOR } from "../mcp/tx.js";
import { defaultGithubAccess } from "../runner/readiness.js";
import { homeSlug } from "../runner/threads.js";

export const CLAUDE_CODE_AGENT = "claude-code";

/**
 * The address an MCP client on this machine connects to: the port the screen was reached on (the server's own, even
 * when installed with --port, which sets no PLANIA_PORT), else PLANIA_PORT, else 3737.
 */
export const localMcpUrl = (env: NodeJS.ProcessEnv = process.env, requestUrl?: string): string => {
  let port = 0;
  try {
    port = requestUrl ? Number(new URL(requestUrl).port) : 0;
  } catch {
    port = 0;
  }
  return `http://localhost:${port || Number(env.PLANIA_PORT) || 3737}/mcp`;
};

/** The home project's slug while it exists and holds no task; null once it holds work (or is not there). */
export async function quietHomeSlug(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const slug = homeSlug(env);
  const [home] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!home) return null;
  const [work] = await db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.projectId, home.id));
  return (work?.n ?? 0) === 0 ? slug : null;
}

/** Marks the quiet home project in a list of project rows (the lists read `quiet_home`). */
export function markQuietHome<T extends { slug: string }>(rows: T[], quiet: string | null): Array<T & { quiet_home?: true }> {
  return rows.map((r) => (quiet && r.slug === quiet ? { ...r, quiet_home: true as const } : r));
}

export type OnboardingDeps = { env?: NodeJS.ProcessEnv; githubAccess?: () => Promise<string> };

export function onboardingRoutes(deps: OnboardingDeps = {}) {
  const routes = new Hono();
  const env = () => deps.env ?? process.env;
  routes.get("/github", async (c) => c.json({ access: await (deps.githubAccess ?? (() => defaultGithubAccess(env())))() }));
  routes.post("/claude-code", async (c) => {
    if (/^\s*bearer\b/i.test(c.req.header("Authorization") ?? "")) return c.json({ error: "HUMAN_ONLY", hint: "the screen makes this token, with the owner's session" }, 403);
    const { token, secret } = await withDb((db) => issueToken(db, { name: "Claude Code", agent: CLAUDE_CODE_AGENT, scopes: ["read", "write"] }, WEB_ACTOR));
    return c.json({ url: localMcpUrl(env(), c.req.url), secret, token }, 201);
  });
  return routes;
}
