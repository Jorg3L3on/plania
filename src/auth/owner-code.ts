// PLA-I36-11: the owner's code. Anyone signed in at the machine can ask, approve a plan, stop a run and accept work
// into the test copy; publishing to main, raising a limit and deleting a project need the owner's code: a TOTP
// from an authenticator app (secret in the macOS keychain, service plania-owner, src/auth/owner-store.ts).
// The code is never stored or logged. A time step once accepted cannot be spent again (machine_state
// "owner.totp" keeps the last steps). No secret enrolled: OWNER_CODE_UNSET, and the screen offers enrolment.
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { machineState } from "../db/schema.js";
import { ownerEnrolled, ownerStore } from "./owner-store.js";
import { base32Encode, matchTotp, otpauthUri, randomSecret } from "./owner-totp.js";
import { verifyPassword } from "./password.js";
import { storedPasswordHash } from "../install-state.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: the owner's code refusals in the install's language; the Spanish is unchanged.
export const OWNER_CODE_WORDS = defineWords({
  es: {
    unset: "Configura el código del dueño en Máquina.",
    required: "Esto pide el código del dueño.",
    invalid: "Ese código no es válido.",
    spent: "Ese código ya se usó; espera el siguiente.",
    badPassword: "Contraseña incorrecta.",
    keychain: "No se pudo guardar el secreto del código.",
  },
  en: {
    unset: "Set up the owner's code in Machine.",
    required: "This needs the owner's code.",
    invalid: "That code is not valid.",
    spent: "That code was already used; wait for the next one.",
    badPassword: "Wrong password.",
    keychain: "The code's secret could not be saved.",
  },
});

const STATE_KEY = "owner.totp";
const KEEP_STEPS = 20;

export type OwnerCodeRefusal = { error: "OWNER_CODE_REQUIRED" | "OWNER_CODE_INVALID" | "OWNER_CODE_UNSET"; status: 403 | 409; hint: string };

async function spentSteps(db: Db): Promise<number[]> {
  const [row] = await db.select({ value: machineState.value }).from(machineState).where(eq(machineState.key, STATE_KEY)).limit(1);
  const steps = (row?.value as { steps?: unknown } | undefined)?.steps;
  return Array.isArray(steps) ? steps.filter((n): n is number => typeof n === "number") : [];
}

async function spend(db: Db, step: number): Promise<boolean> {
  const steps = await spentSteps(db);
  if (steps.includes(step)) return false;
  const next = [...steps, step].slice(-KEEP_STEPS);
  await db
    .insert(machineState)
    .values({ key: STATE_KEY, value: { steps: next } })
    .onConflictDoUpdate({ target: machineState.key, set: { value: { steps: next }, updatedAt: sql`now()` } });
  return true;
}

// null when the code is good (and now spent), else the refusal to send back.
export async function checkOwnerCode(db: Db, code: string | null | undefined): Promise<OwnerCodeRefusal | null> {
  const secret = await ownerStore().get();
  if (!secret) return { error: "OWNER_CODE_UNSET", status: 409, hint: say(OWNER_CODE_WORDS).unset };
  if (!code?.trim()) return { error: "OWNER_CODE_REQUIRED", status: 403, hint: say(OWNER_CODE_WORDS).required };
  const step = matchTotp(secret, code.trim());
  if (step == null) return { error: "OWNER_CODE_INVALID", status: 403, hint: say(OWNER_CODE_WORDS).invalid };
  if (!(await spend(db, step))) return { error: "OWNER_CODE_INVALID", status: 403, hint: say(OWNER_CODE_WORDS).spent };
  return null;
}

export const ownerCodeEnrolled = ownerEnrolled;

// Enrol or replace: the Plania password, and the current code when one is already enrolled.
export async function enrolOwnerCode(db: Db, input: { password: string; code?: string }): Promise<{ secret_base32: string; otpauth_uri: string } | { error: string; status: 401 | 403 | 409 | 500; hint: string }> {
  const stored = storedPasswordHash();
  if (!stored || !(await verifyPassword(stored, input.password))) return { error: "INVALID_PASSWORD", status: 401, hint: say(OWNER_CODE_WORDS).badPassword };
  if (await ownerStore().get()) {
    const refused = await checkOwnerCode(db, input.code);
    if (refused) return refused;
  }
  const secret = randomSecret();
  try {
    await ownerStore().set(secret);
  } catch {
    return { error: "KEYCHAIN_FAILED", status: 500, hint: say(OWNER_CODE_WORDS).keychain };
  }
  const b32 = base32Encode(secret);
  return { secret_base32: b32, otpauth_uri: otpauthUri(b32) };
}
