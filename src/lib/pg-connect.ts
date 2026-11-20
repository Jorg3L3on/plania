// B3, B4: what a Postgres address answers. One reading for the machine check (src/machine-check/) and the install
// command (scripts/install.ts): the server's version and, when the server runs on this machine, the folder of its
// own programs (pg_config's BINDIR, so pg_dump matches the server); or why it said no. Connection refused is not
// the same failure as a wrong password, a missing role or a missing database, and each has its own fix
// (ui/src/lib/falta.ts).
import pg from "pg";

/** Why an address did not connect. unreachable: refused, timed out or unknown host (not running, not installed). */
export type PgFailure = "unreachable" | "bad_password" | "auth_refused" | "no_database";

export type PgReading = { ok: true; versionNum: number; binDir?: string | null } | { ok: false; reason?: PgFailure; message?: string };

/** The failure a connection error stands for. */
export function pgFailureOf(e: unknown): PgFailure {
  const code = (e as { code?: unknown } | null)?.code;
  const message = e instanceof Error ? e.message : String(e);
  if (code === "28P01") return "bad_password";
  // The server asked for a password and the address has none: node-postgres stops before sending anything.
  if (/client password must be a string|no password supplied|password authentication failed/i.test(message)) return "bad_password";
  if (code === "28000") return "auth_refused";
  if (code === "3D000") return "no_database";
  return "unreachable";
}

/** The user an address names, decoded; undefined when it names none (Postgres then uses the system user). */
export function userOf(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.username ? decodeURIComponent(u.username) : undefined;
  } catch {
    return undefined;
  }
}

/** The address with this user and password (an empty password leaves none). */
export function withCredentials(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = encodeURIComponent(user);
  u.password = password ? encodeURIComponent(password) : "";
  return u.toString();
}

const LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1", "[::1]", "::1"]);

/** True when the address's server runs on this machine: a local host name or a Unix socket. */
export function isLocalAddress(url: string): boolean {
  try {
    const u = new URL(url);
    const socket = u.searchParams.get("host");
    if (socket) return socket.startsWith("/");
    return LOCAL_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * B4: the folder of the server's own programs. pg_config is readable by superusers only, and its folder is only
 * worth anything on this machine, so a remote server or a plain user gives null.
 */
export async function serverBinDir(client: pg.Client, url: string): Promise<string | null> {
  if (!isLocalAddress(url)) return null;
  try {
    const r = await client.query<{ setting: string }>("select setting from pg_config where name = 'BINDIR'");
    return r.rows[0]?.setting?.trim() || null;
  } catch {
    return null;
  }
}

/** Connects, reads the version and the server's program folder, and closes. Never throws. */
export async function readPg(url: string): Promise<PgReading> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
  } catch (e) {
    await client.end().catch(() => undefined);
    return { ok: false, reason: pgFailureOf(e), message: e instanceof Error ? e.message : String(e) };
  }
  try {
    const r = await client.query<{ server_version_num: string }>("show server_version_num");
    return { ok: true, versionNum: Number(r.rows[0]?.server_version_num ?? 0), binDir: await serverBinDir(client, url) };
  } catch (e) {
    return { ok: false, reason: pgFailureOf(e), message: e instanceof Error ? e.message : String(e) };
  } finally {
    await client.end().catch(() => undefined);
  }
}
