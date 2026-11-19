// PLA-I2-2: what an install keeps in its database instead of .env (migration 0063, one row). The server reads it
// once at start and the first-start screen refreshes it, so a value made there works at once, with no restart.
// Every reader asks here; a value set in .env always wins, so an install configured by hand is unchanged.
//   password    PLANIA_PASSWORD_HASH, else install_state.password_hash
//   runner      PLANIA_RUNNER_TOKEN, else install_state.runner_token
//   brief       PLANIA_BRIEF_TOKEN, else install_state.brief_token (the brief still falls back to MCP_READ_TOKEN)
//   time zone   PLANIA_TZ, else install_state.time_zone (copied into process.env at load, for the many readers)
//   wakes       PLANIA_JOBS=1 turns them on, PLANIA_JOBS=0 off; unset is on only for an install made by first start
// This module imports nothing from the runner or the API, so any of them can import it.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { installState } from "./db/schema.js";
import type { Q } from "./mcp/tx.js";

export type InstallState = typeof installState.$inferSelect;

let cached: InstallState | null = null;
const wakeListeners: Array<() => void> = [];

/** Reads the row into memory (null when there is none). The server calls it at start; first start after its write. */
export async function loadInstallState(db: Q, env: NodeJS.ProcessEnv = process.env): Promise<InstallState | null> {
  const [row] = await db.select().from(installState).where(eq(installState.id, 1)).limit(1);
  const wasOn = wakesOn(env);
  cached = row ?? null;
  if (cached?.timeZone && !env.PLANIA_TZ?.trim()) env.PLANIA_TZ = cached.timeZone;
  if (!wasOn && wakesOn(env)) for (const fn of wakeListeners) fn();
  return cached;
}

/** Tests: forget what was loaded. */
export function resetInstallState(): void {
  cached = null;
}

export const storedPasswordHash = (env: NodeJS.ProcessEnv = process.env): string => env.PLANIA_PASSWORD_HASH?.trim() || cached?.passwordHash || "";
export const storedRunnerToken = (env: NodeJS.ProcessEnv = process.env): string => env.PLANIA_RUNNER_TOKEN?.trim() || cached?.runnerToken || "";
export const storedBriefToken = (env: NodeJS.ProcessEnv = process.env): string => env.PLANIA_BRIEF_TOKEN?.trim() || cached?.briefToken || "";

/** True when the owner exists: a password in .env or one made at first start. First start is closed for good then. */
export const ownerExists = (env: NodeJS.ProcessEnv = process.env): boolean => storedPasswordHash(env) !== "";

/** Wakes (heartbeats and event wakes): PLANIA_JOBS=1 on, any other value off, unset on only after first start. */
export function wakesOn(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PLANIA_JOBS === "1") return true;
  if (env.PLANIA_JOBS !== undefined && env.PLANIA_JOBS !== "") return false;
  return !!cached?.firstStartAt;
}

/** Called once when wakes turn on while the process runs (first start finished): the jobs add the heartbeat. */
export function onWakesOn(fn: () => void): () => void {
  wakeListeners.push(fn);
  return () => {
    const i = wakeListeners.indexOf(fn);
    if (i >= 0) wakeListeners.splice(i, 1);
  };
}

// ---- the one-time setup code

// No 0/O, 1/I/L: the owner reads it off a terminal and types it. 12 characters ≈ 60 bits, in three groups.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newSetupCode(): string {
  const chars = Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}

/** Spaces, dashes and case do not matter to the person typing it. */
export const normalizeSetupCode = (code: string): string => code.replace(/[\s-]/g, "").toUpperCase();
export const hashSetupCode = (code: string): string => createHash("sha256").update(normalizeSetupCode(code)).digest("hex");

export function setupCodeMatches(storedHash: string | null | undefined, code: string): boolean {
  if (!storedHash || !code) return false;
  const a = Buffer.from(storedHash);
  const b = Buffer.from(hashSetupCode(code));
  return a.length === b.length && timingSafeEqual(a, b);
}
