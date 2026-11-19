import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { blockers, events, type Task } from "../db/schema.js";
import { ToolError } from "./errors.js";
import type { WriteWarning } from "./queries.js";
import type { Ctx, Emit, Q } from "./tx.js";
import { OWNER, OWNER_LINE_PARSED, OWNER_LINE_PREFIX, oldSpelling, ownerGivenName, ownerLineWords } from "../owner.js";

// 2.10 (item 1): what waits on the owner, written as free text, becomes a human_action blocker they see
// in the inbox. The parser is conservative on purpose: a line that starts with "Owner:" (any case,
// optional list marker), or a sentence that names the owner together with a waiting cue ("waits on",
// "when the owner says so", "the owner's OK"...). The audit's WAITING_ON_OWNER_FREE_TEXT keeps its broader
// regex and flags what the parser does not catch.
// 2.11 (PLA-01): agents use "human action" / "acción humana" to describe the mechanism, not to ask,
// so neither is a cue, nor "until the owner" alone (a report: "stays until the owner clicks Hecho"); and a note, which has no resync, only yields a blocker from the "Owner:" form.
// A blocker parsed from a note can be withdrawn by the session (or token) that wrote it.
// PLA-I2-14: the owner is named "Owner:", by their display name, or by the first owner's name (read until
// protocol 2.25). A line in either of the last two forms still becomes a blocker; the old name also warns.

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const edge = (re: string) => String.raw`(?<![\p{L}\p{N}_])(?:${re})(?![\p{L}\p{N}_])`;
// Who a sentence may name: "the owner", «el dueño», the display name, the first owner's name.
const whoRe = (name: string | null) => edge(["the owner", "el due[ñn]o", ...ownerLineWords(name).filter((w) => w !== OWNER).map(escapeRe)].join("|"));

// Cues that a sentence naming the owner asks them for something, rather than reporting what they did. W is the owner.
const WAIT_CUE_SRC = String.raw`\bwait(?:s|ing)? (?:on|for)\b|\bespera(?:ndo)? (?:a|por)\b|\bsays so\b|\blo diga\b|(?:W|\bhis|\btheir)'s? (?:ok|go-ahead|approval|turn)\b|\bok de W|\bneeds? W|\bnecesita a W|W (?:has to|must|needs to|should|tiene que|debe)\b|\bhave (?:him|them)\b|\bask W|\bp[ií]dele a W|\ble toca a W|\bte toca\b|W (?:sets|decides|releases|merges|ships|runs|picks|chooses|approves|confirms|creates|installs|signs|tests|adds|puts|rotates|reviews|gives|decide|aprueba|lleva|crea|pone|corre|prueba|confirma|elige|mergea|lanza|instala|revisa|firma)\b`;

/** The regexes for the current display name. Built per call: the name can be set while the server runs. */
function patterns(name: string | null = ownerGivenName()) {
  const who = whoRe(name);
  const words = ownerLineWords(name).map(escapeRe).join("|");
  return {
    prefix: new RegExp(String.raw`^\s*(?:[-*•]|\d+[.)])?\s*\**(${words})\**\s*[:：]\s*(.+)$`, "iu"),
    names: new RegExp(who, "iu"),
    waitCue: new RegExp(WAIT_CUE_SRC.replaceAll("W", () => who), "iu"),
    waiting: new RegExp(String.raw`${who}|\baprob|\bdecid|\bwaiting on\b|\bespera(?:ndo|r)? (?:a|la|el)\b`, "iu"),
  };
}

/** Free-text waits on the owner (es/en) that the inbox cannot see. Broad: the audit's heuristic. */
export const waitingOnOwner = (text: string, name?: string | null): boolean => patterns(name).waiting.test(text);

// Field names as agents write them. A note has no field to resync: its blockers stay until done.
export const PARSED_FIELDS = ["next_action", "in_progress_note", "state_note", "summary", "blocked_note", "note"] as const;
export type ParsedField = (typeof PARSED_FIELDS)[number];

/** word: what the line started with, when it was a prefix line ("owner", the display name or the old name). */
export type OwnerLine = { text: string; hash: string; word?: string };

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

/** The human actions a text asks of the owner, one per line or sentence, deduplicated by hash. prefixOnly: only "Owner:" lines. */
export function parseOwnerLines(text: string | null | undefined, opts: { prefixOnly?: boolean; name?: string | null } = {}): OwnerLine[] {
  if (!text?.trim()) return [];
  const re = patterns(opts.name === undefined ? ownerGivenName() : opts.name);
  const out = new Map<string, OwnerLine>();
  const add = (raw: string, word?: string) => {
    const t = clip(raw.trim().replace(/\s+/g, " "));
    if (t) out.set(lineHash(t), { text: t, hash: lineHash(t), ...(word ? { word } : {}) });
  };
  for (const line of text.split(/\r?\n/)) {
    const prefixed = re.prefix.exec(line);
    if (prefixed) {
      add(prefixed[2]!, prefixed[1]!);
      continue;
    }
    if (opts.prefixOnly) continue;
    for (const s of sentences(line)) if (re.names.test(s) && re.waitCue.test(s)) add(s);
  }
  return [...out.values()];
}

type ParsedSpec = { assignee: string; text: string; source: "parsed"; field: ParsedField; line_hash: string };

/** A parsed blocker holds claims and keeps a ticket Blocked only when it came from blocked_note. */
export const isGating = (spec: Record<string, unknown>) => spec.source !== "parsed" || spec.field === "blocked_note";

// SQL: the blocker row (alias) holds. Parsed lines from other fields only reach the inbox.
export const gatingSql = (alias: string) => sql.raw(`not (coalesce(${alias}.spec->>'source', '') = 'parsed' and coalesce(${alias}.spec->>'field', '') <> 'blocked_note')`);

/**
 * Resync the parsed blockers of one task after a write. texts maps each field the write set to its
 * new text (null for a cleared one). Per field: lines gone from the text drop their unsatisfied
 * parsed blocker (satisfied ones stay as history); new lines become blockers unless the task
 * already has one with that hash. Returns the warnings for the reply.
 */
export async function syncOwnerLines(tx: Q, emit: Emit, t: Pick<Task, "id" | "key">, texts: Partial<Record<ParsedField, string | null>>): Promise<WriteWarning[]> {
  const entries = Object.entries(texts) as [ParsedField, string | null][];
  if (!entries.length) return [];
  const existing = await tx
    .select()
    .from(blockers)
    .where(and(eq(blockers.taskId, t.id), eq(blockers.type, "human_action"), sql`${blockers.spec}->>'source' = 'parsed'`));
  const warnings: WriteWarning[] = [];
  const known = new Set(existing.map((b) => (b.spec as ParsedSpec).line_hash));
  for (const [field, text] of entries) {
    const lines = parseOwnerLines(text, { prefixOnly: field === "note" });
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
      const spec: ParsedSpec = { assignee: OWNER, text: l.text, source: "parsed", field, line_hash: l.hash };
      const [row] = await tx.insert(blockers).values({ taskId: t.id, type: "human_action", spec }).returning({ id: blockers.id });
      known.add(l.hash);
      await emit("blocker.parsed", t, { blocker_id: row!.id, field, text: l.text });
      warnings.push({ code: OWNER_LINE_PARSED, blocker_id: row!.id, field, text: l.text, fix_hint: "use blocked_by human_action next time" });
      if (l.word && l.word.toLowerCase() !== OWNER) warnings.push(oldSpelling(`${l.word}:`, OWNER_LINE_PREFIX));
    }
  }
  return warnings;
}

/**
 * set_task withdraw_blocker (2.11, PLA-01): drop an unsatisfied blocker parsed from a note, when the
 * caller is the session or the agent token that wrote that note (the blocker.parsed event says who),
 * or the owner. Lines from the other fields drop by editing the field, so they are refused here.
 */
export async function withdrawParsedBlocker(tx: Q, emit: Emit, t: Pick<Task, "id" | "key">, blockerId: string, ctx: Ctx): Promise<void> {
  const [b] = await tx
    .select()
    .from(blockers)
    .where(and(eq(blockers.taskId, t.id), sql`${blockers.id}::text = ${blockerId}`))
    .limit(1);
  const spec = b?.spec as Partial<ParsedSpec> | undefined;
  if (!b || b.type !== "human_action" || spec?.source !== "parsed") throw new ToolError("BLOCKER_NOT_WITHDRAWABLE", { blocker_id: blockerId, reason: "no parsed human action with that id on this task" });
  if (b.satisfiedAt) throw new ToolError("BLOCKER_NOT_WITHDRAWABLE", { blocker_id: blockerId, reason: "already done: it stays as history" });
  if (spec.field !== "note") throw new ToolError("BLOCKER_NOT_WITHDRAWABLE", { blocker_id: blockerId, reason: `parsed from ${spec.field}: edit that field and the line drops` });
  if (!ctx.human) {
    const [made] = await tx
      .select({ actor: events.actor, tokenId: events.tokenId })
      .from(events)
      .where(and(eq(events.taskId, t.id), eq(events.type, "blocker.parsed"), sql`${events.payload}->>'blocker_id' = ${blockerId}`))
      .limit(1);
    const mine = !!made && (made.actor.session_id === ctx.actor.session_id || (!!made.tokenId && made.tokenId === ctx.tokenId));
    if (!mine) throw new ToolError("BLOCKER_NOT_WITHDRAWABLE", { blocker_id: blockerId, reason: "only the session or token that wrote the note (or the owner) may withdraw it", written_by: made?.actor ?? null });
  }
  await tx.delete(blockers).where(eq(blockers.id, b.id));
  await emit("blocker.withdrawn", t, { blocker_id: b.id, field: spec.field, text: spec.text });
}

/** set_project headline: an owner line only warns (the headline is generated from 2.11 on). */
export function headlineWarnings(headline: string | undefined): WriteWarning[] {
  return parseOwnerLines(headline).map((l) => ({ code: OWNER_LINE_PARSED, field: "headline", text: l.text, fix_hint: "the headline makes no blocker: use blocked_by human_action on the ticket" }));
}
