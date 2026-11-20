// PLA-I68-2: where Camino's keys live. Never in Plania's database, git, an event, a log or an agent run: the OS keychain
// on macOS (a generic password, service `plania-camino`, account `<project>:<provider>`), else a file only the user can
// read ($XDG_CONFIG_HOME/plania/camino-keys/<project>/<provider>, folder 0700, file 0600), as src/auth/owner-store.ts
// does for the owner's secret. The key goes to `security` on stdin in interactive mode, never in argv, so it never shows
// in the process list. No API route and no MCP tool returns a key: the camino row keeps only its last 4 characters.
// Plania's own calls (Probar, discovery, F3+ changes) read it here, in the server process.
import { execFile } from "node:child_process";
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ProviderId } from "./types.js";

export const CAMINO_KEYCHAIN_SERVICE = "plania-camino";
// What a key may hold: the characters API tokens use. No spaces or quotes, so `security -i` needs no quoting, and a
// pasted key with a stray newline or a label in front is refused instead of stored wrong.
export const KEY_SHAPE = /^[A-Za-z0-9._~+/=:-]{8,600}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface CaminoKeyStore {
  readonly kind: "keychain" | "file" | "memory";
  get(slug: string, provider: ProviderId): Promise<string | null>;
  set(slug: string, provider: ProviderId, value: string): Promise<void>;
  delete(slug: string, provider: ProviderId): Promise<void>;
}

const account = (slug: string, provider: ProviderId) => {
  if (!SLUG.test(slug) || !/^[a-z_]+$/.test(provider)) throw new Error("camino key: bad name");
  return `${slug}:${provider}`;
};

export class MemoryCaminoKeyStore implements CaminoKeyStore {
  readonly kind = "memory" as const;
  readonly items = new Map<string, string>();
  async get(slug: string, provider: ProviderId) {
    return this.items.get(account(slug, provider)) ?? null;
  }
  async set(slug: string, provider: ProviderId, value: string) {
    if (!KEY_SHAPE.test(value)) throw new Error("camino key write failed");
    this.items.set(account(slug, provider), value);
  }
  async delete(slug: string, provider: ProviderId) {
    this.items.delete(account(slug, provider));
  }
}

// ---- keychain
export type SecurityCall = (args: string[], stdin: string, timeoutMs: number) => Promise<string>;
const defaultSecurity: SecurityCall = (args, stdin, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = execFile("security", args, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 }, (err, stdout) => {
      if (err) reject(err instanceof Error ? err : new Error("keychain command failed"));
      else resolve(stdout ?? "");
    });
    child.stdin?.end(stdin);
  });

/** The `security -i` lines that replace one item (delete, then add without -U, which would hang on SecurityAgent). */
export function keychainWriteLines(slug: string, provider: ProviderId, value: string): { del: string; add: string } {
  if (!KEY_SHAPE.test(value)) throw new Error("camino key write failed");
  const acct = account(slug, provider);
  return {
    del: `delete-generic-password -s ${CAMINO_KEYCHAIN_SERVICE} -a ${acct}\n`,
    add: `add-generic-password -T /usr/bin/security -s ${CAMINO_KEYCHAIN_SERVICE} -a ${acct} -w ${value}\n`,
  };
}

const missing = (err: unknown) => /could not be found|item not found/i.test(`${err instanceof Error ? err.message : String(err)}\n${String((err as { stderr?: unknown } | null)?.stderr ?? "")}`);

export class KeychainCaminoKeyStore implements CaminoKeyStore {
  readonly kind = "keychain" as const;
  constructor(private readonly call: SecurityCall = defaultSecurity) {}
  async get(slug: string, provider: ProviderId) {
    try {
      const out = (await this.call(["find-generic-password", "-s", CAMINO_KEYCHAIN_SERVICE, "-a", account(slug, provider), "-w"], "", 3_000)).trim();
      return KEY_SHAPE.test(out) ? out : null;
    } catch {
      return null;
    }
  }
  async set(slug: string, provider: ProviderId, value: string) {
    const lines = keychainWriteLines(slug, provider, value);
    try {
      await this.call(["-i"], lines.del, 15_000);
    } catch (err) {
      if (!missing(err)) throw new Error("camino key write failed");
    }
    try {
      await this.call(["-i"], lines.add, 15_000);
    } catch {
      // The message from `security` can echo the key: never pass it on.
      throw new Error("camino key write failed");
    }
    if ((await this.get(slug, provider)) !== value) throw new Error("camino key write failed");
  }
  async delete(slug: string, provider: ProviderId) {
    try {
      await this.call(["-i"], `delete-generic-password -s ${CAMINO_KEYCHAIN_SERVICE} -a ${account(slug, provider)}\n`, 15_000);
    } catch (err) {
      if (!missing(err)) throw new Error("camino key delete failed");
    }
  }
}

// ---- file
export function caminoKeysDir(env: NodeJS.ProcessEnv = process.env): string {
  const named = env.PLANIA_CAMINO_KEYS_DIR?.trim();
  if (named) return named;
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(env.HOME || homedir(), ".config");
  return path.join(base, "plania", "camino-keys");
}
const checksMode = (platform: NodeJS.Platform) => platform !== "win32";

export class FileCaminoKeyStore implements CaminoKeyStore {
  readonly kind = "file" as const;
  constructor(
    readonly dir: string = caminoKeysDir(),
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}
  private file(slug: string, provider: ProviderId) {
    account(slug, provider);
    return path.join(this.dir, slug, provider);
  }
  async get(slug: string, provider: ProviderId) {
    try {
      const f = this.file(slug, provider);
      // A file the group or others can read is not trusted.
      if (checksMode(this.platform) && (statSync(f).mode & 0o077) !== 0) return null;
      const text = readFileSync(f, "utf8").trim();
      return KEY_SHAPE.test(text) ? text : null;
    } catch {
      return null;
    }
  }
  async set(slug: string, provider: ProviderId, value: string) {
    if (!KEY_SHAPE.test(value)) throw new Error("camino key write failed");
    const f = this.file(slug, provider);
    const tmp = `${f}.${process.pid}.tmp`;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
      rmSync(tmp, { force: true });
      const fd = openSync(tmp, "wx", 0o600);
      try {
        writeSync(fd, `${value}\n`);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      if (checksMode(this.platform)) chmodSync(tmp, 0o600);
      renameSync(tmp, f);
    } catch {
      if (existsSync(tmp)) rmSync(tmp, { force: true });
      throw new Error("camino key write failed");
    }
    if ((await this.get(slug, provider)) !== value) throw new Error("camino key write failed");
  }
  async delete(slug: string, provider: ProviderId) {
    rmSync(this.file(slug, provider), { force: true });
  }
}

/** The store for this system: the keychain on macOS (when `security` is there), the 0600 file everywhere else. */
export function systemCaminoKeyStore(o: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; exists?: (p: string) => boolean } = {}): CaminoKeyStore {
  const platform = o.platform ?? process.platform;
  if (platform === "darwin" && (o.exists ?? existsSync)("/usr/bin/security")) return new KeychainCaminoKeyStore();
  return new FileCaminoKeyStore(caminoKeysDir(o.env ?? process.env), platform);
}

let current: CaminoKeyStore | null = null;
export const caminoKeys = (): CaminoKeyStore => (current ??= systemCaminoKeyStore());
/** Tests use a memory store. */
export function useCaminoKeyStore(store: CaminoKeyStore | null): void {
  current = store;
}

/** What the screen may see of a key: its last 4 characters. */
export const last4 = (value: string): string => value.slice(-4);
