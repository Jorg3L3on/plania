// Usage: pnpm backfill-v2 --stage <name> [--project <slug>] [--map <spec>] [--apply]
//
// Moves v1 data into the v2 shape after the v2 migrations are applied. Dry-run by default: prints
// what would change. With --apply it writes, per project, in one writeTx as the backfill actor, and
// logs a backfill.<stage> event; a project that already has that event is skipped, so reruns are safe.
// tasks.body and the project resume card are read, never changed (they go away in a later cleanup).
import { pathToFileURL } from "node:url";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withDb, type Db } from "../src/db/client.js";
import {
  checks,
  decisions,
  events,
  projects,
  results,
  sequenceReservations,
  sequences,
  tasks,
  type Actor,
  type Project,
} from "../src/db/schema.js";
import { writeTx, type Emit, type Q } from "../src/mcp/tx.js";

export const BACKFILL_ACTOR: Actor = { agent: "backfill", session_id: "v2" };

export type StageOptions = { apply: boolean; project?: string; map?: string };

export type Stage = {
  name: string;
  about: string;
  // Returns human-readable lines describing the change; writes only when apply is true.
  run: (tx: Q, emit: Emit, p: Project, apply: boolean, opts: StageOptions) => Promise<string[]>;
};

// ---- body: v1 kept scope, the Done when checklist and dated notes in one markdown body.
// Done when checkboxes become checks; "- YYYY-MM-DD · note" lines become note events dated that day
// (noon in Mexico City; v1 stored no time); v1 Result lines also become results. Everything else,
// including the "Phase N" line, stays in scope, so nothing is lost.

export const LEGACY_ACTOR: Actor = { agent: "v1", session_id: "legacy" };

const NOTE_LINE = /^- (\d{4}-\d{2}-\d{2}) · (.*)$/;
// v1 Result lines, also when a note carries several mid-sentence: each runs until the next one.
const RESULT_IN_NOTE = /Result: (✓|⚠|✗) (unit|integration|test|live|grep|subagent) — (\S.*?)(?=\s+Result: [✓⚠✗] |$)/g;
const DONE_WHEN = /^##\s*(done when|hecho cuando)\s*$/i;
const CHECKBOX = /^\s*[-*] \[( |x|X)\] (.+)$/;
const PHASE = /^(?:Phase|Fase) (\d+)\b/;
const VERDICT: Record<string, string> = { "✓": "pass", "⚠": "warn", "✗": "fail" };

export type ParsedBody = {
  phase: number | null;
  scope: string;
  checks: { text: string; done: boolean }[];
  notes: { date: string; text: string }[];
  results: { date: string; kind: string; verdict: string; cite: string }[];
};

export function parseV1Body(body: string, kind: string): ParsedBody {
  const out: ParsedBody = { phase: null, scope: "", checks: [], notes: [], results: [] };
  const scope: string[] = [];
  const leftover: string[] = [];
  let inDoneWhen = false;
  for (const line of body.split("\n")) {
    const note = line.match(NOTE_LINE);
    if (note) {
      out.notes.push({ date: note[1]!, text: note[2]! });
      for (const r of note[2]!.matchAll(RESULT_IN_NOTE)) {
        out.results.push({ date: note[1]!, verdict: VERDICT[r[1]!]!, kind: r[2]!, cite: r[3]!.trim() });
      }
      continue;
    }
    if (line.startsWith("## ")) inDoneWhen = DONE_WHEN.test(line);
    if (inDoneWhen) {
      const box = line.match(CHECKBOX);
      if (box) out.checks.push({ text: box[2]!.trim(), done: box[1] !== " " });
      else if (line.trim() && !DONE_WHEN.test(line)) leftover.push(line);
      continue;
    }
    scope.push(line);
  }
  if (kind === "ticket") {
    const first = scope.find((l) => l.trim());
    const phase = first?.match(PHASE);
    if (phase) out.phase = Number(phase[1]);
  }
  if (leftover.length) scope.push("", "## Done when (v1 notes)", ...leftover);
  out.scope = scope.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

// A v1 date carries no time: noon in Mexico City.
const legacyAt = (date: string) => new Date(`${date}T18:00:00.000Z`);

const body: Stage = {
  name: "body",
  about: "Split v1 bodies into scope, phase, checks, note events and results (body itself is kept)",
  async run(tx, emit, p, apply) {
    const rows = await tx.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.scope, ""))).orderBy(tasks.key);
    const out: string[] = [];
    for (const t of rows.filter((r) => r.body.trim())) {
      const parsed = parseV1Body(t.body, t.kind);
      const done = parsed.checks.filter((c) => c.done).length;
      out.push(
        `${t.key}: ${parsed.phase !== null ? `phase ${parsed.phase}, ` : ""}scope ${parsed.scope.length} chars, ` +
          `${parsed.checks.length} checks (${done} done), ${parsed.notes.length} notes, ${parsed.results.length} results`,
      );
      if (!apply) continue;
      await tx
        .update(tasks)
        .set({
          scope: parsed.scope,
          ...(t.kind === "ticket" && t.phase === null ? { phase: parsed.phase } : {}),
          version: sql`${tasks.version} + 1`,
        })
        .where(eq(tasks.id, t.id));
      for (const [position, c] of parsed.checks.entries()) {
        await tx.insert(checks).values({
          taskId: t.id,
          n: position + 1,
          position,
          text: c.text,
          done: c.done,
          ...(c.done ? { doneBy: LEGACY_ACTOR } : {}),
        });
      }
      for (const n of parsed.notes) {
        await tx.insert(events).values({
          projectId: p.id,
          taskId: t.id,
          taskKey: t.key,
          type: "note",
          actor: LEGACY_ACTOR,
          payload: { text: n.text, legacy: true, date: n.date },
          createdAt: legacyAt(n.date),
        });
      }
      for (const r of parsed.results) {
        await tx.insert(results).values({
          taskId: t.id,
          kind: r.kind,
          verdict: r.verdict,
          cite: r.cite,
          actor: LEGACY_ACTOR,
          createdAt: legacyAt(r.date),
        });
      }
      await emit("task.migrated", t, {
        phase: parsed.phase,
        checks: parsed.checks.length,
        notes: parsed.notes.length,
        results: parsed.results.length,
      });
    }
    return out;
  },
};

// ---- decisions: v1 lines started with a typed date ("2026-10-07 · ..."). The date moves to
// decided_on; a decision naming exactly one existing key is tied to that task; a typed date that is
// not the local day it was written on is flagged for Jorge. --map new:old,... (id prefixes) marks
// existing decisions as reversing older ones, which v1 could only say in prose.

const DATED = /^(\d{4}-\d{2}-\d{2}) · ([\s\S]*)$/;
const KEY = /\b[A-Z]{2,5}-(?:B-)?\d{2}(?:-F\d+)?\b/g;
const localDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: process.env.PLANIA_TZ || "America/Mexico_City" }).format(d);

const decisionsStage: Stage = {
  name: "decisions",
  about: "Move typed dates to decided_on, tie decisions to the one task they name; --map new:old links reversals",
  async run(tx, emit, p, apply, opts) {
    const rows = await tx.select().from(decisions).where(eq(decisions.projectId, p.id)).orderBy(decisions.createdAt);
    const keys = new Map((await tx.select({ id: tasks.id, key: tasks.key }).from(tasks).where(eq(tasks.projectId, p.id))).map((t) => [t.key, t.id]));
    const out: string[] = [];
    for (const d of rows) {
      const dated = d.decidedOn ? null : d.line.match(DATED);
      const mentioned = [...new Set(d.line.match(KEY) ?? [])].filter((k) => keys.has(k));
      const taskId = !d.taskId && mentioned.length === 1 ? keys.get(mentioned[0]!)! : null;
      if (!dated && !taskId) continue;
      const id = d.id.slice(0, 8);
      if (dated) {
        const written = localDay(d.createdAt);
        out.push(`${id}: decided_on ${dated[1]}${dated[1] !== written ? ` (FLAG: written on ${written} local)` : ""}`);
      }
      if (taskId) out.push(`${id}: task ${mentioned[0]}`);
      if (mentioned.length > 1 && !d.taskId) out.push(`${id}: names ${mentioned.join(", ")}; left without a task`);
      if (!apply) continue;
      await tx
        .update(decisions)
        .set({ ...(dated ? { line: dated[2]!, decidedOn: dated[1]! } : {}), ...(taskId ? { taskId } : {}) })
        .where(eq(decisions.id, d.id));
    }
    if (opts.map && !opts.project) throw new Error("--map needs --project");
    for (const pair of opts.map?.split(",").filter(Boolean) ?? []) {
      const [newer, older] = pair.split(":").map((x) => x.trim());
      const find = (prefix: string | undefined) => rows.find((r) => prefix && prefix.length >= 8 && r.id.startsWith(prefix));
      const a = find(newer);
      const b = find(older);
      if (!a || !b) throw new Error(`--map needs two decision id prefixes (8+ chars) of this project: ${pair}`);
      out.push(`${a.id.slice(0, 8)} supersedes ${b.id.slice(0, 8)}`);
      if (!apply) continue;
      await tx.update(decisions).set({ supersedesId: b.id }).where(eq(decisions.id, a.id));
      await emit("decision.superseded", null, { decision_id: b.id, superseded_by: a.id, legacy: true });
    }
    return out;
  },
};

// ---- claims: v1 claims were a "claimed by <agent>" note on an In progress ticket.

// "claimed by <agent> (<detail>)", possibly followed by more text on the same line.
const CLAIM_LINE = /^- \d{4}-\d{2}-\d{2} · claimed by ([^(.\n]+)(?:\(([^)\n]*)\))?/gm;
const LEGACY_LEASE_HOURS = 24;

export function parseLegacyClaim(body: string): { agent: string; detail: string | null; worktree: string | null } | null {
  const matches = [...body.matchAll(CLAIM_LINE)];
  const last = matches.at(-1);
  if (!last) return null;
  const detail = last[2] ?? null;
  const worktree = detail?.match(/worktree\s+([\w./-]+)/)?.[1] ?? null;
  return { agent: last[1]!.trim(), detail, worktree };
}

const claims: Stage = {
  name: "claims",
  about: `In progress tickets with no owner get a ${LEGACY_LEASE_HOURS}h lease from their last 'claimed by' note`,
  async run(tx, emit, p, apply) {
    const rows = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, p.id), eq(tasks.kind, "ticket"), eq(tasks.status, "In progress"), isNull(tasks.owner)));
    const out: string[] = [];
    for (const t of rows) {
      const legacy = parseLegacyClaim(t.body);
      const owner: Actor = { agent: legacy?.agent ?? "unknown", session_id: "legacy" };
      const workspace = { ...(t.branch ? { branch: t.branch } : {}), ...(legacy?.worktree ? { worktree_path: legacy.worktree } : {}) };
      out.push(`${t.key}: owner ${owner.agent} (legacy), ${LEGACY_LEASE_HOURS}h lease, workspace ${JSON.stringify(workspace)}`);
      if (!apply) continue;
      await tx
        .update(tasks)
        .set({
          owner,
          claimedAt: sql`now()`,
          leaseUntil: sql`now() + make_interval(hours => ${LEGACY_LEASE_HOURS})`,
          workspace: Object.keys(workspace).length ? workspace : t.workspace,
          version: sql`${tasks.version} + 1`,
        })
        .where(eq(tasks.id, t.id));
      await emit("claim.acquired", t, { legacy: true, owner, note: legacy?.detail ?? null, workspace });
    }
    return out;
  },
};

// ---- resume: the v1 card stays readable as legacy_card; its must_keep_decision becomes a pinned
// project decision (an existing decision with the same text is pinned instead of duplicated).

const resume: Stage = {
  name: "resume",
  about: "Pin the v1 card's must_keep_decision as a project decision; the card stays as legacy_card",
  async run(tx, emit, p, apply) {
    const text = p.resumeMustKeepDecision.trim();
    if (!text) return [];
    const [existing] = await tx
      .select()
      .from(decisions)
      .where(and(eq(decisions.projectId, p.id), eq(decisions.line, text)))
      .limit(1);
    if (existing?.pinned) return [];
    if (!apply) return [`${existing ? "pin existing" : "add pinned"} decision: ${text}`];
    if (existing) {
      await tx.update(decisions).set({ pinned: true }).where(eq(decisions.id, existing.id));
      await emit("decision.pinned", null, { decision_id: existing.id, text });
      return [`pinned existing decision: ${text}`];
    }
    const [d] = await tx.insert(decisions).values({ projectId: p.id, line: text, pinned: true, actor: BACKFILL_ACTOR }).returning();
    await emit("decision.added", null, { decision_id: d!.id, text, pinned: true });
    return [`added pinned decision: ${text}`];
  },
};

// ---- sequences: v1 reserved numbers in prose ("0009 reservada para FIL-01"). The prose is too
// ambiguous to parse, so Jorge passes the mapping: --project filmia --map migration:0008=FIL-02,0009=FIL-01-F1
// Without --map the stage lists the 4-digit numbers each ticket mentions, to help write it.

export function parseSequenceMap(map: string): { name: string; value: number; key: string }[] {
  return map.split(";").flatMap((group) => {
    const [name, pairs] = group.split(":");
    if (!name || !pairs) throw new Error(`bad --map group: ${group}`);
    return pairs.split(",").map((pair) => {
      const [value, key] = pair.split("=");
      if (!value || !/^\d+$/.test(value) || !key) throw new Error(`bad --map pair: ${pair}`);
      return { name: name.trim(), value: Number(value), key: key.trim() };
    });
  });
}

const sequencesStage: Stage = {
  name: "sequences",
  about: "Reserve sequence numbers named in prose: --project <slug> --map migration:0008=FIL-02,0009=FIL-01-F1",
  async run(tx, emit, p, apply, opts) {
    const all = await tx.select().from(tasks).where(eq(tasks.projectId, p.id)).orderBy(tasks.key);
    // Applying without a mapping would mark the stage done having reserved nothing.
    if (!opts.map && apply) throw new Error("--apply needs --map (and --project)");
    if (!opts.map) {
      return all
        .map((t) => [t.key, [...new Set([...t.body.matchAll(/\b(\d{4})\b/g)].map((m) => m[1]))].filter((n) => !n!.startsWith("20"))] as const)
        .filter(([, nums]) => nums.length)
        .map(([key, nums]) => `${key} mentions ${nums.join(", ")}`);
    }
    if (!opts.project) throw new Error("--map needs --project");
    const byKey = new Map(all.map((t) => [t.key, t]));
    const out: string[] = [];
    for (const m of parseSequenceMap(opts.map)) {
      const t = byKey.get(m.key);
      if (!t) throw new Error(`unknown key in --map: ${m.key}`);
      const value = String(m.value).padStart(4, "0");
      out.push(`${m.name} ${value} → ${m.key}`);
      if (!apply) continue;
      await tx.insert(sequences).values({ projectId: p.id, name: m.name, nextValue: m.value + 1, width: 4 }).onConflictDoUpdate({
        target: [sequences.projectId, sequences.name],
        set: { nextValue: sql`greatest(${sequences.nextValue}, ${m.value + 1})` },
      });
      await tx.insert(sequenceReservations).values({ projectId: p.id, name: m.name, value: m.value, taskId: t.id, actor: BACKFILL_ACTOR });
      await emit("sequence.reserved", t, { name: m.name, value, legacy: true });
    }
    return out;
  },
};

// In this order: notes from bodies land in the log before the events the later stages write.
export const STAGES: Stage[] = [body, decisionsStage, resume, sequencesStage, claims];

async function alreadyRan(db: Q, projectId: string, stage: string): Promise<boolean> {
  const [row] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.projectId, projectId), eq(events.type, `backfill.${stage}`)))
    .limit(1);
  return !!row;
}

export async function runStage(db: Db, stage: Stage, opts: StageOptions) {
  const report: { project: string; skipped: boolean; lines: string[] }[] = [];
  const rows = await db.select().from(projects).orderBy(projects.slug);
  for (const p of rows.filter((r) => !opts.project || r.slug === opts.project)) {
    if (await alreadyRan(db, p.id, stage.name)) {
      report.push({ project: p.slug, skipped: true, lines: [] });
      continue;
    }
    const lines = await writeTx(db, p, { actor: BACKFILL_ACTOR }, async (tx, emit) => {
      const out = await stage.run(tx, emit, p, opts.apply, opts);
      if (opts.apply) await emit(`backfill.${stage.name}`, null, { changes: out.length });
      return out;
    });
    report.push({ project: p.slug, skipped: false, lines });
  }
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const stage = STAGES.find((s) => s.name === arg("--stage"));
  if (!stage) {
    console.error(`--stage is one of: ${STAGES.map((s) => `\n  ${s.name}: ${s.about}`).join("")}`);
    process.exit(1);
  }
  const apply = args.includes("--apply");
  await withDb(async (db) => {
    for (const r of await runStage(db, stage, { apply, project: arg("--project"), map: arg("--map") })) {
      if (r.skipped) console.log(`${r.project}: already done, skipped`);
      else console.log(`${r.project}: ${r.lines.length ? "\n  " + r.lines.join("\n  ") : "nothing to do"}`);
    }
  });
  console.log(apply ? "Applied." : "Dry run. Rerun with --apply to write.");
}
