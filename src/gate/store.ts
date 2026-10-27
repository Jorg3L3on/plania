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

// argv is only `-i`. The password is the second line of stdin, after `-w` with no value,
// which is how `security -i` reads it without putting it on the command line.
export function keychainWriteInvocation(secretBase32: string): { file: string; args: string[]; stdin: string } {
  const command = `add-generic-password -U -T /usr/bin/security -s ${GATE_KEYCHAIN_SERVICE} -a ${GATE_KEYCHAIN_ACCOUNT} -w`;
  return { file: "security", args: ["-i"], stdin: `${command}\n${secretBase32}\n` };
}

export function keychainReadArgs(): string[] {
  return ["find-generic-password", "-s", GATE_KEYCHAIN_SERVICE, "-a", GATE_KEYCHAIN_ACCOUNT, "-w"];
}

function execSecurity(args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("security", args, { encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024 }, (err, stdout) => {
      if (err) reject(err instanceof Error ? err : new Error("keychain command failed"));
      else resolve(stdout ?? "");
    });
    child.stdin?.end(stdin ?? "");
  });
}

export class KeychainGateSecretStore implements GateSecretStore {
  async get(): Promise<Buffer | null> {
    try {
      const stdout = await execSecurity(keychainReadArgs());
      const text = stdout.trim();
      if (!text) return null;
      return base32Decode(text);
    } catch {
      // Missing item, or `security` is not on this machine. Treated as not enrolled.
      return null;
    }
  }

  async set(secret: Buffer): Promise<void> {
    const plan = keychainWriteInvocation(base32Encode(secret));
    try {
      await execSecurity(plan.args, plan.stdin);
    } catch {
      // The message from `security` can echo input. Keep it off the error.
      throw new Error("keychain write failed");
    }
  }
}

let current: GateSecretStore = new KeychainGateSecretStore();

export function gateStore(): GateSecretStore {
  return current;
}

export function useGateStore(store: GateSecretStore): void {
  current = store;
}
