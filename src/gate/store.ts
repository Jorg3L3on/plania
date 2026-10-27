import { execFile } from "node:child_process";
import { base32Decode, base32Encode } from "./totp.js";

// Where the authenticator secret lives. The database and .env never see it.
// Keychain: a generic password, service `plania-gate`, written and read through the `security`
// binary (execFile, no shell). The secret goes on stdin in interactive mode, never in argv,
// so it does not show up in the process list. Tests use the memory store.

export const GATE_KEYCHAIN_SERVICE = "plania-gate";
export const GATE_KEYCHAIN_ACCOUNT = "plania";

export interface GateSecretStore {
  get(): Promise<Buffer | null>;
  set(secret: Buffer): Promise<void>;
}

export class MemoryGateSecretStore implements GateSecretStore {
  private secret: Buffer | null = null;

  async get(): Promise<Buffer | null> {
    return this.secret ? Buffer.from(this.secret) : null;
  }

  async set(secret: Buffer): Promise<void> {
    this.secret = Buffer.from(secret);
    invalidateGateEnrolledCache();
  }
}

// `security -i` reads one command per line and takes `-w`'s value on that same line.
// argv stays `-i`: the secret is only in stdin. Base32 is [A-Z2-7], which needs no quotes.
// Update (`-U`) on an item that already exists asks SecurityAgent and hangs, so a replace
// deletes the item and adds it again, without `-U`.
const BASE32_ITEM = /^[A-Z2-7]+$/;

// A missing item is not enrolled. A read that sits on a stuck keychain must give up quickly.
export const GATE_READ_TIMEOUT_MS = 3_000;
const GATE_WRITE_TIMEOUT_MS = 15_000;
export const GATE_ENROLLED_TTL_MS = 5_000;

export function keychainDeleteInvocation(): { file: string; args: string[]; stdin: string } {
  const stdin = `delete-generic-password -s ${GATE_KEYCHAIN_SERVICE} -a ${GATE_KEYCHAIN_ACCOUNT}\n`;
  return { file: "security", args: ["-i"], stdin };
}

export function keychainWriteInvocation(secretBase32: string): { file: string; args: string[]; stdin: string } {
  if (!BASE32_ITEM.test(secretBase32)) throw new Error("keychain write failed");
  const stdin = `add-generic-password -T /usr/bin/security -s ${GATE_KEYCHAIN_SERVICE} -a ${GATE_KEYCHAIN_ACCOUNT} -w ${secretBase32}\n`;
  return { file: "security", args: ["-i"], stdin };
}

export function keychainReadArgs(): string[] {
  return ["find-generic-password", "-s", GATE_KEYCHAIN_SERVICE, "-a", GATE_KEYCHAIN_ACCOUNT, "-w"];
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

export class KeychainGateSecretStore implements GateSecretStore {
  async get(): Promise<Buffer | null> {
    try {
      const stdout = await securityCall(keychainReadArgs(), "", GATE_READ_TIMEOUT_MS);
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
        await securityCall(del.args, del.stdin, GATE_WRITE_TIMEOUT_MS);
      } catch (err) {
        // A missing item is the first enrolment. Any other delete error leaves the old item in place.
        if (!keychainItemMissing(err)) throw new Error("keychain write failed");
      }
      try {
        await securityCall(plan.args, plan.stdin, GATE_WRITE_TIMEOUT_MS);
      } catch {
        // Delete already ran. The message from `security` can echo the secret. Do not report success.
        throw new Error("keychain write failed");
      }
      const stored = await this.get();
      if (!stored || !stored.equals(secret)) throw new Error("keychain write failed");
    } finally {
      invalidateGateEnrolledCache();
    }
  }
}

// GET /gate must not spawn `security` on every poll. The bit is enough; the secret stays in the keychain.
let enrolledCache: { at: number; enrolled: boolean } | null = null;
export const gateEnrolledClock = { now: () => Date.now() };

export function invalidateGateEnrolledCache(): void {
  enrolledCache = null;
}

export async function gateEnrolled(): Promise<boolean> {
  const now = gateEnrolledClock.now();
  if (enrolledCache && now - enrolledCache.at < GATE_ENROLLED_TTL_MS) return enrolledCache.enrolled;
  const enrolled = !!(await gateStore().get());
  enrolledCache = { at: gateEnrolledClock.now(), enrolled };
  return enrolled;
}

let current: GateSecretStore = new KeychainGateSecretStore();

export function gateStore(): GateSecretStore {
  return current;
}

export function useGateStore(store: GateSecretStore): void {
  current = store;
}
