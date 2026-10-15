import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { blockers, type Task } from "../db/schema.js";
import type { WriteWarning } from "./queries.js";
import type { Emit, Q } from "./tx.js";

// 2.10 (item 1): what waits on Jorge, written as free text, becomes a human_action blocker he sees
// in the inbox. The parser is conservative on purpose: a line that starts with "Jorge:" (any case,
// optional list marker), or a sentence that names Jorge together with a waiting cue ("waits on",
// "when Jorge says so", "Jorge's OK", "human action"...). The audit's WAITING_ON_JORGE_FREE_TEXT
// keeps its broader regex and flags what the parser does not catch.

// Free-text waits on Jorge (es/en) that the inbox cannot see. Broad: the audit's heuristic.
export const WAITING_ON_JORGE = /\bjorge\b|\baprob|\bdecid|\bwaiting on\b|\bespera(?:ndo|r)? (?:a|la|el)\b/i;

const JORGE_PREFIX = /^\s*(?:[-*•]|\d+[.)])?\s*\**jorge\**\s*[:：]\s*(.+)$/i;
const NAMES_JORGE = /\bjorge\b/i;
// Cues that a sentence naming Jorge asks him for something, rather than reporting what he did.
const WAIT_CUE =
  /\bwait(?:s|ing)? (?:on|for)\b|\bespera(?:ndo)? (?:a|por)\b|\bhuman action\b|\bacci[oó]n humana\b|\bsays so\b|\blo diga\b|\b(?:jorge|his)'s? (?:ok|go-ahead|approval|turn)\b|\bok de jorge\b|\bneeds? jorge\b|\bnecesita a jorge\b|\bjorge (?:has to|must|needs to|should|tiene que|debe)\b|\bhave him\b|\bask jorge\b|\bp[ií]dele a jorge\b|\b(?:until|hasta que) jorge\b|\ble toca a jorge\b|\bte toca\b|\bjorge (?:sets|decides|releases|merges|ships|runs|picks|chooses|approves|confirms|creates|installs|signs|tests|adds|puts|rotates|reviews|gives|decide|aprueba|lleva|crea|pone|corre|prueba|confirma|elige|mergea|lanza|instala|revisa|firma)\b/i;

// Field names as agents write them. A note has no field to resync: its blockers stay until done.
export const PARSED_FIELDS = ["next_action", "in_progress_note", "state_note", "summary", "blocked_note", "note"] as const;
export type ParsedField = (typeof PARSED_FIELDS)[number];

export type JorgeLine = { text: string; hash: string };

const MAX_TEXT = 300;
export const lineHash = (text: string) => createHash("sha256").update(text.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 12);
const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);

// Sentences of one line: split after . ! ? followed by a space and a capital or digit, so "I21-1…4" and "e.g. x" stay whole.
function sentences(line: string): string[] {
  return line
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The human actions a text asks of Jorge, one per line or sentence, deduplicated by hash. */
export function parseJorgeLines(text: string | null | undefined): JorgeLine[] {
  if (!text?.trim()) return [];
  const out = new Map<string, JorgeLine>();
  const add = (raw: string) => {
    const t = clip(raw.trim().replace(/\s+/g, " "));
    if (t) out.set(lineHash(t), { text: t, hash: lineHash(t) });
  };
  for (const line of text.split(/\r?\n/)) {
    const prefixed = JORGE_PREFIX.exec(line);
    if (prefixed) {
      add(prefixed[1]!);
      continue;
    }
    for (const s of sentences(line)) if (NAMES_JORGE.test(s) && WAIT_CUE.test(s)) add(s);
  }
  return [...out.values()];
}

type ParsedSpec = { assignee: string; text: string; source: "parsed"; field: ParsedField; line_hash: string };

/** A parsed blocker gates claims and keeps a ticket Blocked only when it came from blocked_note. */
export const isGating = (spec: Record<string, unknown>) => spec.source !== "parsed" || spec.field === "blocked_note";

// SQL: the blocker row (alias) gates. Parsed lines from other fields only reach the inbox.
export const gatingSql = (alias: string) => sql.raw(`not (coalesce(${alias}.spec->>'source', '') = 'parsed' and coalesce(${alias}.spec->>'field', '') <> 'blocked_note')`);

/**
 * Resync the parsed blockers of one task after a write. texts maps each field the write set to its
 * new text (null for a cleared one). Per field: lines gone from the text drop their unsatisfied
 * parsed blocker (satisfied ones stay as history); new lines become blockers unless the task
 * already has one with that hash. Returns the warnings for the reply.
 */
export async function syncJorgeLines(tx: Q, emit: Emit, t: Pick<Task, "id" | "key">, texts: Partial<Record<ParsedField, string | null>>): Promise<WriteWarning[]> {
  const entries = Object.entries(texts) as [ParsedField, string | null][];
  if (!entries.length) return [];
  const existing = await tx
    .select()
    .from(blockers)
    .where(and(eq(blockers.taskId, t.id), eq(blockers.type, "human_action"), sql`${blockers.spec}->>'source' = 'parsed'`));
  const warnings: WriteWarning[] = [];
  const known = new Set(existing.map((b) => (b.spec as ParsedSpec).line_hash));
  for (const [field, text] of entries) {
    const lines = parseJorgeLines(text);
    const hashes = new Set(lines.map((l) => l.hash));
    if (field !== "note") {
      for (const b of existing.filter((b) => (b.spec as ParsedSpec).field === field && !b.satisfiedAt && !hashes.has((b.spec as ParsedSpec).line_hash))) {
        await tx.delete(blockers).where(eq(blockers.id, b.id));
        known.delete((b.spec as ParsedSpec).line_hash);
        await emit("blocker.unparsed", t, { blocker_id: b.id, field, text: (b.spec as ParsedSpec).text });
      }
    }
    for (const l of lines) {
      if (known.has(l.hash)) continue;
      const spec: ParsedSpec = { assignee: "jorge", text: l.text, source: "parsed", field, line_hash: l.hash };
      const [row] = await tx.insert(blockers).values({ taskId: t.id, type: "human_action", spec }).returning({ id: blockers.id });
      known.add(l.hash);
      await emit("blocker.parsed", t, { blocker_id: row!.id, field, text: l.text });
      warnings.push({ code: "JORGE_LINE_PARSED", blocker_id: row!.id, field, text: l.text, fix_hint: "use blocked_by human_action next time" });
    }
  }
  return warnings;
}

/** set_project headline: a Jorge line only warns (the headline is generated from 2.11 on). */
export function headlineWarnings(headline: string | undefined): WriteWarning[] {
  return parseJorgeLines(headline).map((l) => ({ code: "JORGE_LINE_PARSED", field: "headline", text: l.text, fix_hint: "the headline makes no blocker: use blocked_by human_action on the ticket" }));
}
