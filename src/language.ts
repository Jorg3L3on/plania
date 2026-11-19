// PLA-I2-10: the install's language, the one switch for the screen, the morning brief and the server's sentences.
// Spanish ("es") unless the owner chose English ("en") at first start or later in Plomería. Stored in machine_state
// (key "language"), the way src/folders.ts keeps the folders, so no migration is needed; PLANIA_LANGUAGE wins when
// set. Saving it also sets the brief's language, so the brief follows it instead of keeping a switch of its own.
// The screen's twin is ui/src/lib/i18n.ts; the locale for dates and numbers follows it (src/locale.ts).
import { eq } from "drizzle-orm";
import { briefSettings, machineState } from "./db/schema.js";
import type { Q } from "./mcp/tx.js";
import { LANGUAGES, DEFAULT_LANGUAGE, isLanguage, type Language } from "../ui/src/lib/i18n.js";

export { LANGUAGES, DEFAULT_LANGUAGE, isLanguage, type Language };
export const LANGUAGE_KEY = "language";

let cached: Language | null = null;

/** The language now: PLANIA_LANGUAGE, else the stored one, else Spanish. */
export function installLanguage(env: NodeJS.ProcessEnv = process.env): Language {
  const v = env.PLANIA_LANGUAGE?.trim().toLowerCase();
  if (isLanguage(v)) return v;
  return cached ?? DEFAULT_LANGUAGE;
}

/** True when the language was chosen (stored or set in PLANIA_LANGUAGE); false on an install before first start. */
export const languageChosen = (env: NodeJS.ProcessEnv = process.env): boolean => isLanguage(env.PLANIA_LANGUAGE?.trim().toLowerCase()) || cached !== null;

/** Reads the stored language into memory. The server calls it at start (through loadInstallState). */
export async function loadLanguage(db: Q): Promise<Language> {
  const [row] = await db.select({ value: machineState.value }).from(machineState).where(eq(machineState.key, LANGUAGE_KEY)).limit(1);
  const v = (row?.value as { language?: unknown } | undefined)?.language;
  cached = isLanguage(v) ? v : null;
  return cached ?? DEFAULT_LANGUAGE;
}

/** Stores the language and points the brief at it. Takes effect at once (in memory). */
export async function saveLanguage(db: Q, language: Language): Promise<Language> {
  if (!isLanguage(language)) throw new Error(`unknown language: ${String(language)}`);
  const now = new Date();
  await db
    .insert(machineState)
    .values({ key: LANGUAGE_KEY, value: { language }, updatedAt: now })
    .onConflictDoUpdate({ target: machineState.key, set: { value: { language }, updatedAt: now } });
  // The brief follows: its row keeps every other setting; with no row yet the defaults apply with this language.
  await db
    .insert(briefSettings)
    .values({ id: 1, language, updatedAt: now })
    .onConflictDoUpdate({ target: briefSettings.id, set: { language, updatedAt: now } });
  cached = language;
  return language;
}

/** Tests: forget what was loaded. */
export function resetLanguage(): void {
  cached = null;
}
