// PLA-I2-14: the owner has a name of their own. Two things live here and nowhere else.
//
// 1. The neutral values Plania stores and sends for the owner. They never carry a person's name, so an
//    install for someone else reads the same data. Every use imports these; migration 0062 rewrote the
//    rows written before (status, origin, actor and author values, blocker assignees, audit codes).
// 2. The display name: what the screen greets, the brief signs, and the protocol text and tool
//    descriptions call the owner. One stored value (owner_profile.display_name, written at first start
//    through setOwnerName), then the brief's owner_name, then PLANIA_CEO_NAME, then «el dueño» / "the owner".
//
// The first owner's spellings (LEGACY) stay accepted on input for one protocol version, with an
// OLD_SPELLING warning in the result. Protocol 2.24 introduced the neutral values; 2.25 may drop LEGACY.
import { eq } from "drizzle-orm";
import { briefSettings, ownerProfile } from "./db/schema.js";
import type { Q } from "./mcp/tx.js";

/** actor.agent of the screen, a ticket's origin, a thread author, a blocker assignee, who the next step is for. */
export const OWNER = "owner";
/** The ticket status for a question that waits on the owner. */
export const NEEDS_OWNER = "Needs owner";
/** Wire value: counts, digest highlights, a project's light. */
export const NEEDS_OWNER_KEY = "needs_owner";
/** Wire value: a team member waits on the owner. */
export const WAITING_OWNER = "waiting_owner";
/** The evidence an agent sends when the owner told it in chat. */
export const DELEGATED_BY_OWNER = "delegated_by_owner";
/** A line that starts with this becomes a human_action blocker. */
export const OWNER_LINE_PREFIX = "Owner:";
/** Audit code: a wait on the owner written as free text. */
export const WAITING_ON_OWNER_FREE_TEXT = "WAITING_ON_OWNER_FREE_TEXT";
/** Warning code: a text line became a human_action blocker. */
export const OWNER_LINE_PARSED = "OWNER_LINE_PARSED";
/** Warning code: an input used a spelling from before protocol 2.24; it was read as the neutral one. */
export const OLD_SPELLING = "OLD_SPELLING";

/** The first owner's spellings, accepted on input until the next protocol version. Never written. */
export const LEGACY = {
  agent: "jorge",
  status: "Needs Jorge",
  field: "delegated_by_jorge",
  needsKey: "needs_jorge",
  waitingKey: "waiting_jorge",
  auditCode: "WAITING_ON_JORGE_FREE_TEXT",
  lineCode: "JORGE_LINE_PARSED",
} as const;

export type OldSpellingWarning = { code: typeof OLD_SPELLING; used: string; read_as: string; fix_hint: string };
export const oldSpelling = (used: string, readAs: string): OldSpellingWarning => ({
  code: OLD_SPELLING,
  used,
  read_as: readAs,
  fix_hint: `write ${readAs}: ${used} is accepted until the next protocol version`,
});

/** True for the screen's own actor, in its neutral or its old spelling. Agents may write as neither. */
export const isOwnerAgent = (agent: string | null | undefined): boolean => {
  const a = (agent ?? "").trim().toLowerCase();
  return a === OWNER || a === LEGACY.agent;
};

/** A status as an agent may send it: the old spelling reads as the neutral one. */
export const neutralStatus = <T extends string>(status: T): T => (status === LEGACY.status ? (NEEDS_OWNER as T) : status);

// ---- the display name ----

const DEFAULT_NAME = { es: "el dueño", en: "the owner" } as const;
export type OwnerLang = keyof typeof DEFAULT_NAME;

let stored: string | null = null;

/** Trims, drops control characters, collapses spaces, at most 80 characters. Empty is null. */
export function cleanOwnerName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ");
  return name ? name.slice(0, 80) : null;
}

/** The name the owner gave, or null when nobody gave one (neither stored nor PLANIA_CEO_NAME). */
export function ownerGivenName(env: NodeJS.ProcessEnv = process.env): string | null {
  return stored ?? cleanOwnerName(env.PLANIA_CEO_NAME);
}

/** What Plania calls the owner: their name, else «el dueño» (es) or "the owner" (en). capital: for a sentence start. */
export function ownerName(lang: OwnerLang = "es", opts: { capital?: boolean } = {}): string {
  const given = ownerGivenName();
  if (given) return given;
  const word = DEFAULT_NAME[lang];
  return opts.capital ? word[0]!.toUpperCase() + word.slice(1) : word;
}

/** Reads the stored name (then the brief's owner_name) into memory. The server calls it at start. */
export async function loadOwnerName(db: Q): Promise<string | null> {
  const [row] = await db.select({ name: ownerProfile.displayName }).from(ownerProfile).where(eq(ownerProfile.id, 1)).limit(1);
  let name = cleanOwnerName(row?.name);
  if (!name) {
    const [brief] = await db.select({ name: briefSettings.ownerName }).from(briefSettings).where(eq(briefSettings.id, 1)).limit(1);
    name = cleanOwnerName(brief?.name);
  }
  stored = name;
  return name;
}

/** The setter first start calls (PLA-I2-2): stores the display name and uses it from now on. null clears it. */
export async function setOwnerName(db: Q, raw: string | null): Promise<string | null> {
  const name = cleanOwnerName(raw);
  await db
    .insert(ownerProfile)
    .values({ id: 1, displayName: name, updatedAt: new Date() })
    .onConflictDoUpdate({ target: ownerProfile.id, set: { displayName: name, updatedAt: new Date() } });
  return loadOwnerName(db);
}

/** Tests: forget what was loaded. */
export function resetOwnerName(name: string | null = null): void {
  stored = cleanOwnerName(name);
}

/**
 * Agent-facing English text (protocol, tool descriptions) is written with "the owner". With a name
 * given, it reads as that name: "the owner's screen" → "Ana's screen". Without one it stays as written.
 */
export function personalize(text: string, name: string | null = ownerGivenName()): string {
  if (!name) return text;
  return text.replace(/\b[Tt]he owner\b(?![_-])/g, name);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The words a line may start with to become a blocker: "Owner:", the display name, and the old
 * spelling. Returns the regex and whether the matched word is the neutral one.
 */
export function ownerLineWords(name: string | null = ownerGivenName()): string[] {
  const words = [OWNER, LEGACY.agent];
  if (name) words.push(name);
  return [...new Set(words.map((w) => w.toLowerCase()))];
}
export const ownerWordsRe = (name: string | null = ownerGivenName()) => ownerLineWords(name).map(escapeRe).join("|");

/**
 * Old spellings on a tool's input (until protocol 2.25): delegated_by_jorge reads as delegated_by_owner and the
 * status "Needs Jorge" as "Needs owner". Returns the input in neutral spelling and one warning per old one.
 */
export function readOldSpellings<T extends object>(input: T): { input: T; warnings: OldSpellingWarning[] } {
  const warnings: OldSpellingWarning[] = [];
  let out = input as Record<string, unknown>;
  if (out[LEGACY.field] !== undefined) {
    const { [LEGACY.field]: old, ...rest } = out;
    out = { ...rest, [DELEGATED_BY_OWNER]: out[DELEGATED_BY_OWNER] ?? old };
    warnings.push(oldSpelling(LEGACY.field, DELEGATED_BY_OWNER));
  }
  if (out.status === LEGACY.status) {
    out = { ...out, status: NEEDS_OWNER };
    warnings.push(oldSpelling(LEGACY.status, NEEDS_OWNER));
  }
  return { input: out as T, warnings };
}

/** A human_action assignee: empty, the old spelling or the display name all read as OWNER. */
export function neutralAssignee(raw: string | null | undefined): { assignee: string; warning?: OldSpellingWarning } {
  const a = (raw ?? "").trim();
  if (!a || a.toLowerCase() === OWNER) return { assignee: OWNER };
  if (a.toLowerCase() === LEGACY.agent) return { assignee: OWNER, warning: oldSpelling(a, OWNER) };
  const name = ownerGivenName();
  if (name && a.toLowerCase() === name.toLowerCase()) return { assignee: OWNER };
  return { assignee: a };
}

/**
 * The owner in Spanish after a preposition, with the contraction a default name needs: de → «del dueño» / «de Ana»,
 * a → «al dueño» / «a Ana», por → «por el dueño» / «por Ana». No preposition: «el dueño» / «Ana» (capital: «El dueño»).
 */
export function ownerEs(prep?: "de" | "a" | "por", opts: { capital?: boolean } = {}): string {
  const given = ownerGivenName();
  if (given) return prep ? `${prep} ${given}` : given;
  if (prep === "de") return "del dueño";
  if (prep === "a") return "al dueño";
  if (prep === "por") return "por el dueño";
  return opts.capital ? "El dueño" : "el dueño";
}
