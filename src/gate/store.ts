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
  }
}

// `security -i` reads one command per line and takes `-w`'s value on that same line.
// A second line is another command, so the item is stored empty. argv stays `-i`: the secret
// is only in stdin. Base32 is [A-Z2-7], which needs no quotes and cannot break the command.
const BASE32_ITEM = /^[A-Z2-7]+$/;

export function keychainWriteInvocation(secretBase32: string): { file: string; args: string[]; stdin: string } {
  if (!BASE32_ITEM.test(secretBase32)) throw new Error("keychain write failed");
  const stdin = `add-generic-password -U -T /usr/bin/security -s ${GATE_KEYCHAIN_SERVICE} -a ${GATE_KEYCHAIN_ACCOUNT} -w ${secretBase32}\n`;
  return { file: "security", args: ["-i"], stdin };
}

export function keychainReadArgs(): string[] {
  return ["find-generic-password", "-s", GATE_KEYCHAIN_SERVICE, "-a", GATE_KEYCHAIN_ACCOUNT, "-w"];
}

export type SecurityCall = (args: string[], stdin: string) => Promise<string>;

function defaultSecurity(args: string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("security", args, { encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024 }, (err, stdout) => {
      if (err) reject(err instanceof Error ? err : new Error("keychain command failed"));
      else resolve(stdout ?? "");
    });
    child.stdin?.end(stdin);
  });
}

let securityCall: SecurityCall = defaultSecurity;

// Tests replace the process spawn. Production uses `security`.
export function useSecurityRunner(run: SecurityCall | null): void {
  securityCall = run ?? defaultSecurity;
}

export class KeychainGateSecretStore implements GateSecretStore {
  async get(): Promise<Buffer | null> {
    try {
      const stdout = await securityCall(keychainReadArgs(), "");
      const text = stdout.trim();
      // An empty item (the broken two-line write) is not enrolled.
      if (!BASE32_ITEM.test(text)) return null;
      return base32Decode(text);
    } catch {
      // Missing item, or `security` is not on this machine. Treated as not enrolled.
      return null;
    }
  }

  async set(secret: Buffer): Promise<void> {
    const plan = keychainWriteInvocation(base32Encode(secret));
    try {
      await securityCall(plan.args, plan.stdin);
    } catch {
      // The message from `security` can echo input. Keep it off the error.
      throw new Error("keychain write failed");
    }
    const stored = await this.get();
    if (!stored || !stored.equals(secret)) throw new Error("keychain write failed");
  }
}

let current: GateSecretStore = new KeychainGateSecretStore();

export function gateStore(): GateSecretStore {
  return current;
}

export function useGateStore(store: GateSecretStore): void {
  current = store;
}
