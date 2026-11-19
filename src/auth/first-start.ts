// PLA-I2-2: first start. On an install with no owner, the screen asks for a name, a password and a time zone,
// and one writeTx makes what a new install needs, so no row is made by hand and nothing is pasted into .env:
//   the home project (Asistente's home, the slug homeSlug() already falls back to), the `ceo` and `asistente` rows
//   (the two company rows scripts/seed-org.ts makes), the owner's display name (src/owner.ts), the company paused
//   (nothing runs until the owner presses resume), the runner and brief tokens (agent_tokens rows, their secrets in
//   install_state), the password hash, the zone, and first_start_at (wakes on while PLANIA_JOBS is unset).
// The door: loopback only (and not through a proxy such as tailscale serve), the one-time code the install
// command printed, and closed for good once an owner exists (a password in .env or one made here).
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { ORG } from "../../scripts/seed-org.js";
import type { Db } from "../db/client.js";
import { agents, installState, projects, runnerSettings } from "../db/schema.js";
import { loadInstallState, ownerExists, setupCodeMatches } from "../install-state.js";
import { WEB_ACTOR, writeTx, type Q } from "../mcp/tx.js";
import { cleanOwnerName, setOwnerName } from "../owner.js";
import { loadSettings } from "../runner/limits.js";
import { homeSlug } from "../runner/threads.js";
import { clearFailures, noteFailure, waitSeconds } from "./login-limit.js";
import { hashPassword } from "./password.js";
import { issueToken } from "./tokens.js";

export const PASSWORD_MIN = 12;
export const SETUP_DOOR = "setup";

export type FirstStartInput = { code: string; name: string; password: string; time_zone: string };
export type FirstStartRefusal = {
  error: "FIRST_START_CLOSED" | "NOT_LOOPBACK" | "SETUP_CODE_INVALID" | "TOO_MANY_TRIES" | "INVALID_BODY";
  status: 400 | 403 | 410 | 429;
  field?: string;
  retry_after?: number;
};

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// A reverse proxy on this machine (tailscale serve) connects from loopback too; these headers give it away.
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "x-real-ip", "tailscale-user-login"];

/** True only for a browser on this machine talking straight to the server. */
export function fromLoopback(remoteAddress: string | undefined, req: Request): boolean {
  if (!remoteAddress || !LOOPBACK.has(remoteAddress)) return false;
  if (PROXY_HEADERS.some((h) => req.headers.has(h))) return false;
  const host = new URL(req.url).hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || LOOPBACK_HOSTS.has(`[${host}]`) || host.endsWith(".localhost");
}

export function validTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Whether the first-start screen should show: no owner yet. */
export const firstStartOpen = (env: NodeJS.ProcessEnv = process.env): boolean => !ownerExists(env);

class Closed extends Error {}

export async function firstStart(
  db: Db,
  input: FirstStartInput,
  opts: { loopback: boolean; env?: NodeJS.ProcessEnv },
): Promise<{ ok: true; home: string } | FirstStartRefusal> {
  const env = opts.env ?? process.env;
  await loadInstallState(db, env);
  if (ownerExists(env)) return { error: "FIRST_START_CLOSED", status: 410 };
  if (!opts.loopback) return { error: "NOT_LOOPBACK", status: 403 };
  const wait = waitSeconds(SETUP_DOOR);
  if (wait != null) return { error: "TOO_MANY_TRIES", status: 429, retry_after: wait };

  const [state] = await db.select().from(installState).where(eq(installState.id, 1)).limit(1);
  if (!setupCodeMatches(state?.setupCodeHash, input.code)) {
    noteFailure(SETUP_DOOR);
    return { error: "SETUP_CODE_INVALID", status: 403 };
  }
  const name = cleanOwnerName(input.name);
  if (!name) return { error: "INVALID_BODY", status: 400, field: "name" };
  if ([...input.password].length < PASSWORD_MIN) return { error: "INVALID_BODY", status: 400, field: "password" };
  if (!validTimeZone(input.time_zone)) return { error: "INVALID_BODY", status: 400, field: "time_zone" };

  const passwordHash = await hashPassword(input.password);
  const slug = homeSlug(env);
  const [existing] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1);
  const home = { id: existing?.id ?? randomUUID(), slug };
  const ctx = { actor: WEB_ACTOR, human: true, tool: "screen.first_start" };

  try {
    await writeTx(db, home, ctx, async (tx, emit) => {
      // The row lock makes two first starts at once one: the second finds the password and is closed.
      const [locked] = await tx.select().from(installState).where(eq(installState.id, 1)).for("update").limit(1);
      if (locked?.passwordHash) throw new Closed();
      if (!existing) {
        await tx.insert(projects).values({ id: home.id, slug, title: "Plania", keyPrefix: "PLA", runsPaused: true, runsPausedAt: new Date() });
        await emit("project.created", null, { slug, title: "Plania", key_prefix: "PLA", template: "home", paused: true });
      }
      await companyRows(tx);
      await loadSettings(tx);
      await tx.update(runnerSettings).set({ companyPaused: true, companyPausedAt: new Date(), updatedAt: sql`now()` }).where(eq(runnerSettings.id, 1));
      await setOwnerName(tx, name);
      const runner = await issueToken(tx, { name: "Runner", agent: "plania-runner", scopes: ["read", "write"] }, WEB_ACTOR);
      const brief = await issueToken(tx, { name: "Morning brief", agent: "morning-brief", scopes: ["read"] }, WEB_ACTOR);
      const values = {
        passwordHash,
        runnerToken: runner.secret,
        briefToken: brief.secret,
        timeZone: input.time_zone,
        firstStartAt: new Date(),
        setupCodeHash: null,
        updatedAt: new Date(),
      };
      await tx.insert(installState).values({ id: 1, ...values }).onConflictDoUpdate({ target: installState.id, set: values });
      await emit("install.first_start", null, { home: slug, company_paused: true, wakes: "on" });
    });
  } catch (e) {
    if (e instanceof Closed) return { error: "FIRST_START_CLOSED", status: 410 };
    throw e;
  }
  clearFailures(SETUP_DOOR);
  // In memory at once: the login, the runner and the jobs see the new values without a restart.
  await loadInstallState(db, env);
  return { ok: true, home: slug };
}

// The two company rows of scripts/seed-org.ts (ORG): the CEO seat and Asistente, with reports_to. Rows that are
// already there are left as they are.
async function companyRows(tx: Q): Promise<void> {
  for (const row of ORG) {
    await tx
      .insert(agents)
      .values({
        slug: row.slug,
        name: row.name,
        role: row.role,
        title: row.title,
        kind: row.kind,
        capabilities: row.capabilities,
        note: row.note ?? "",
        status: "idle",
        adapter: row.adapter,
        adapterConfig: row.adapterConfig,
        heartbeatMinutes: row.heartbeatMinutes,
        roleTemplate: row.slug === "asistente" ? "asistente" : null,
      })
      .onConflictDoNothing({ target: agents.slug });
  }
  for (const row of ORG) {
    if (!row.reportsTo) continue;
    const [parent] = await tx.select({ id: agents.id }).from(agents).where(eq(agents.slug, row.reportsTo)).limit(1);
    if (parent) await tx.update(agents).set({ reportsTo: parent.id }).where(sql`${agents.slug} = ${row.slug} and ${agents.reportsTo} is null`);
  }
}
