import { hash, verify, type Algorithm } from "@node-rs/argon2";

// Handoff §7: argon2id, memory 19456 KiB, time 2, parallelism 1.
// Algorithm is a const enum with no runtime value, so Argon2id is spelled as 2.
const ARGON2ID = 2 as Algorithm;
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    // Malformed hash in env: treat as a failed login, never as a crash.
    return false;
  }
}
