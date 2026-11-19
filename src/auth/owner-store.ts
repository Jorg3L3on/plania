import { execFile } from "node:child_process";
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { base32Decode, base32Encode } from "./owner-totp.js";

// PLA-I36-11: where the owner's authenticator secret lives. The database and .env never see it.
// PLA-I2-4: one store per system (systemOwnerStore, at the end): the macOS keychain, else a 0600 file.
// Keychain: a generic password, service `plania-owner`, written and read through the `security`
// binary (execFile, no shell). The secret goes on stdin in interactive mode, never in argv,
// so it does not show up in the process list. Tests use the memory store.

export const OWNER_KEYCHAIN_SERVICE = "plania-owner";
export const OWNER_KEYCHAIN_ACCOUNT = "plania";

export interface OwnerSecretStore {
  get(): Promise<Buffer | null>;
  set(secret: Buffer): Promise<void>;
}

export class MemoryOwnerSecretStore implements OwnerSecretStore {
  private secret: Buffer | null = null;

  async get(): Promise<Buffer | null> {
    return this.secret ? Buffer.from(this.secret) : null;
  }

  async set(secret: Buffer): Promise<void> {
    this.secret = Buffer.from(secret);
    invalidateOwnerEnrolledCache();
  }
}

// `security -i` reads one command per line and takes `-w`'s value on that same line.
// argv stays `-i`: the secret is only in stdin. Base32 is [A-Z2-7], which needs no quotes.
// Update (`-U`) on an item that already exists asks SecurityAgent and hangs, so a replace
// deletes the item and adds it again, without `-U`.
const BASE32_ITEM = /^[A-Z2-7]+$/;

// A missing item is not enrolled. A read that sits on a stuck keychain must give up quickly.
export const OWNER_READ_TIMEOUT_MS = 3_000;
const OWNER_WRITE_TIMEOUT_MS = 15_000;
export const OWNER_ENROLLED_TTL_MS = 5_000;

export function keychainDeleteInvocation(): { file: string; args: string[]; stdin: string } {
  const stdin = `delete-generic-password -s ${OWNER_KEYCHAIN_SERVICE} -a ${OWNER_KEYCHAIN_ACCOUNT}\n`;
  return { file: "security", args: ["-i"], stdin };
}

export function keychainWriteInvocation(secretBase32: string): { file: string; args: string[]; stdin: string } {
  if (!BASE32_ITEM.test(secretBase32)) throw new Error("keychain write failed");
  const stdin = `add-generic-password -T /usr/bin/security -s ${OWNER_KEYCHAIN_SERVICE} -a ${OWNER_KEYCHAIN_ACCOUNT} -w ${secretBase32}\n`;
  return { file: "security", args: ["-i"], stdin };
}

export function keychainReadArgs(): string[] {
  return ["find-generic-password", "-s", OWNER_KEYCHAIN_SERVICE, "-a", OWNER_KEYCHAIN_ACCOUNT, "-w"];
}

export type SecurityCall = (args: string[], stdin: string, timeoutMs: number) => Promise<string>;

function defaultSecurity(args: string[], stdin: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("security", args, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 }, (err, stdout) => {
      if (err) reject(err instanceof Error ? err : new Error("keychain command failed"));
      else resolve(stdout ?? "");
    });
    child.stdin?.end(stdin);
  });
}

// `security delete-generic-password` exits non-zero when the item is absent. That is a create, not a failure.
function keychainItemMissing(err: unknown): boolean {
  const bits = [err instanceof Error ? err.message : String(err)];
  const stderr = (err as { stderr?: unknown } | null)?.stderr;
  if (typeof stderr === "string") bits.push(stderr);
  return /could not be found|item not found/i.test(bits.join("\n"));
}

let securityCall: SecurityCall = defaultSecurity;

// Tests replace the process spawn. Production uses `security`.
export function useSecurityRunner(run: SecurityCall | null): void {
  securityCall = run ?? defaultSecurity;
}

export class KeychainOwnerSecretStore implements OwnerSecretStore {
  async get(): Promise<Buffer | null> {
    try {
      const stdout = await securityCall(keychainReadArgs(), "", OWNER_READ_TIMEOUT_MS);
      const text = stdout.trim();
      // An empty item is not enrolled.
      if (!BASE32_ITEM.test(text)) return null;
      return base32Decode(text);
    } catch {
      // Missing item, timeout, or `security` is not on this machine. Treated as not enrolled.
      return null;
    }
  }

  async set(secret: Buffer): Promise<void> {
    const encoded = base32Encode(secret);
    const del = keychainDeleteInvocation();
    const plan = keychainWriteInvocation(encoded);
    try {
      try {
        await securityCall(del.args, del.stdin, OWNER_WRITE_TIMEOUT_MS);
      } catch (err) {
        // A missing item is the first enrolment. Any other delete error leaves the old item in place.
        if (!keychainItemMissing(err)) throw new Error("keychain write failed");
      }
      try {
        await securityCall(plan.args, plan.stdin, OWNER_WRITE_TIMEOUT_MS);
      } catch {
        // Delete already ran. The message from `security` can echo the secret. Do not report success.
        throw new Error("keychain write failed");
      }
      const stored = await this.get();
      if (!stored || !stored.equals(secret)) throw new Error("keychain write failed");
    } finally {
      invalidateOwnerEnrolledCache();
    }
  }
}

// GET /api/company/owner-code must not spawn `security` on every poll. The bit is enough; the secret stays in the keychain.
let enrolledCache: { at: number; enrolled: boolean } | null = null;
export const ownerEnrolledClock = { now: () => Date.now() };

export function invalidateOwnerEnrolledCache(): void {
  enrolledCache = null;
}

export async function ownerEnrolled(): Promise<boolean> {
  const now = ownerEnrolledClock.now();
  if (enrolledCache && now - enrolledCache.at < OWNER_ENROLLED_TTL_MS) return enrolledCache.enrolled;
  const enrolled = !!(await ownerStore().get());
  enrolledCache = { at: ownerEnrolledClock.now(), enrolled };
  return enrolled;
}

// ---- PLA-I2-4: a file only the user can read, for Linux and for a Mac without the `security` binary.
// One line, the secret in base32, in $XDG_CONFIG_HOME/plania/owner-secret (default ~/.config/plania/owner-secret;
// PLANIA_OWNER_SECRET_FILE names another). The folder is made 0700 and the file 0600, written to a temporary file
// in the same folder and renamed over the old one, so a crash never leaves half a secret. A file that the group or
// others can read is not trusted: it reads as not enrolled, and enrolling again writes a fresh one at 0600.

export function ownerSecretFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const named = env.PLANIA_OWNER_SECRET_FILE?.trim();
  if (named) return named;
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(env.HOME || homedir(), ".config");
  return path.join(base, "plania", "owner-secret");
}

// Mode bits mean nothing on native Windows (not a supported system; the check is skipped there).
const modeChecked = (platform: NodeJS.Platform) => platform !== "win32";

export class FileOwnerSecretStore implements OwnerSecretStore {
  constructor(
    readonly file: string = ownerSecretFilePath(),
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async get(): Promise<Buffer | null> {
    try {
      if (modeChecked(this.platform) && (statSync(this.file).mode & 0o077) !== 0) return null;
      const text = readFileSync(this.file, "utf8").trim();
      if (!BASE32_ITEM.test(text)) return null;
      return base32Decode(text);
    } catch {
      // Missing or unreadable: not enrolled.
      return null;
    }
  }

  async set(secret: Buffer): Promise<void> {
    const dir = path.dirname(this.file);
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      rmSync(tmp, { force: true });
      // 0600 from the first byte: the mode is given at creation, not after the secret is in.
      const fd = openSync(tmp, "wx", 0o600);
      try {
        writeSync(fd, `${base32Encode(secret)}
`);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      if (modeChecked(this.platform)) chmodSync(tmp, 0o600); // a umask can only remove bits; this states the intent
      renameSync(tmp, this.file);
      const stored = await this.get();
      if (!stored || !stored.equals(secret)) throw new Error("owner secret write failed");
    } catch {
      if (existsSync(tmp)) rmSync(tmp, { force: true });
      // The error can carry the path and nothing else; still, never echo what was being written.
      throw new Error("owner secret write failed");
    } finally {
      invalidateOwnerEnrolledCache();
    }
  }
}

// The store for this system: the keychain on macOS (when `security` is there), the file everywhere else.
export function systemOwnerStore(o: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; exists?: (p: string) => boolean } = {}): OwnerSecretStore {
  const platform = o.platform ?? process.platform;
  const exists = o.exists ?? existsSync;
  if (platform === "darwin" && exists("/usr/bin/security")) return new KeychainOwnerSecretStore();
  return new FileOwnerSecretStore(ownerSecretFilePath(o.env ?? process.env), platform);
}

let current: OwnerSecretStore = systemOwnerStore();

export function ownerStore(): OwnerSecretStore {
  return current;
}

export function useOwnerStore(store: OwnerSecretStore): void {
  current = store;
}
