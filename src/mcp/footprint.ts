import path from "node:path";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { footprints, tasks, type Task } from "../db/schema.js";
import { bus } from "../events.js";
import { FOOTPRINT_KINDS, type FootprintKind } from "../jobs/machine/infer.js";
import { ToolError } from "./errors.js";
import { footprintShape, sameMachine } from "./footprint-read.js";
import { findProject, findTask } from "./queries.js";
import { iso, writeTx, type Ctx, type Emit, type Q } from "./tx.js";

// Declarations (PLA-I1-4): an agent says what it started that outlives its command, with the command
// that removes it. The `machine` job (src/jobs/machine) sees the same things on the Mac; a declaration
// for something it already sees merges into that row (source `both`), otherwise it is its own row
// (source `declared`) until the job sees it. Plania never runs a teardown: it only shows it.

type Row = typeof footprints.$inferSelect;

const bad = (field: string, hint: string, extra: Record<string, unknown> = {}) => new ToolError("INVALID_FOOTPRINT", { field, hint, ...extra });

// ---- locators

// The same forms the job writes (infer.ts / collect.ts), so a declaration lands on the observed row:
//   server     port:3069        accepts 3069, :3069, localhost:3069
//   db_server  postgres:5433    accepts 5433, :5433 (postgres), redis:6379, mysql:3306
//   database   name@127.0.0.1:5433   accepts name (host 127.0.0.1, port 5432), name@5433, name@localhost:5433
//   worktree   /absolute/path   trailing slashes removed
//   browser, tunnel   pid:N     accepts N
//   service    brew:<formula> or launchagent:<label>   (the prefix is required)
//   container  docker:<name>    accepts the bare name
//   cache      free text (a fixture dir, a Redis db index)
export function normalizeLocator(kind: FootprintKind, raw: string): string {
  const s = raw.trim();
  if (!s) throw bad("locator", "empty");
  const port = (n: string) => {
    const v = Number(n);
    if (!Number.isInteger(v) || v < 1 || v > 65535) throw bad("locator", "port must be 1..65535", { kind });
    return v;
  };
  switch (kind) {
    case "server": {
      const m = /^(?:port:|(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])?:)?(\d{1,5})$/i.exec(s);
      if (!m) throw bad("locator", "a server is port:3069 (or 3069, :3069)", { kind });
      return `port:${port(m[1]!)}`;
    }
    case "db_server": {
      const m = /^(?:(postgres|postgresql|redis|mysql|mariadb|mongodb):)?:?(\d{1,5})$/i.exec(s);
      if (!m) throw bad("locator", "a database server is postgres:5433 (or redis:6379, mysql:3306; a bare port means postgres)", { kind });
      const engine = (m[1] ?? "postgres").toLowerCase();
      return `${engine === "postgresql" ? "postgres" : engine}:${port(m[2]!)}`;
    }
    case "database": {
      const m = /^([A-Za-z0-9_$.-]{1,63})(?:@(.*))?$/.exec(s);
      if (!m) throw bad("locator", "a database is name@host:port (name alone means @127.0.0.1:5432)", { kind });
      let host = "127.0.0.1";
      let at = 5432;
      if (m[2] !== undefined) {
        const h = /^(?:([A-Za-z0-9.-]+|\[::1\])?:)?(\d{1,5})$/.exec(m[2]); // 5433, :5433 or host:5433
        if (!h) throw bad("locator", "a database is name@host:port (name alone means @127.0.0.1:5432)", { kind });
        if (h[1] && !["localhost", "[::1]"].includes(h[1].toLowerCase())) host = h[1];
        at = port(h[2]!);
      }
      return `${m[1]}@${host}:${at}`;
    }
    case "worktree": {
      if (!s.startsWith("/")) throw bad("locator", "a worktree is its absolute path", { kind });
      const p = path.posix.normalize(s).replace(/\/+$/, "");
      if (!p || p === "/") throw bad("locator", "a worktree is its absolute path", { kind });
      return p;
    }
    case "browser":
    case "tunnel": {
      const m = /^(?:pid:)?(\d{1,9})$/i.exec(s);
      if (!m) throw bad("locator", `a ${kind} is pid:N (the process id)`, { kind });
      return `pid:${Number(m[1])}`;
    }
    case "service": {
      const m = /^(brew|launchagent):(\S.*)$/i.exec(s);
      if (!m) throw bad("locator", "a service is brew:<formula> or launchagent:<label>", { kind });
      return `${m[1]!.toLowerCase()}:${m[2]}`;
    }
    case "container": {
      const m = /^(?:docker:)?([A-Za-z0-9][A-Za-z0-9_.-]{0,127})$/.exec(s);
      if (!m) throw bad("locator", "a container is docker:<name>", { kind });
      return `docker:${m[1]}`;
    }
    case "cache":
      return s;
  }
}

function kindOf(kind: string): FootprintKind {
  if (!(FOOTPRINT_KINDS as readonly string[]).includes(kind)) throw bad("kind", `one of ${FOOTPRINT_KINDS.join(", ")}`, { kind });
  return kind as FootprintKind;
}

// ---- helpers

// The machine string as the job stored it (os.hostname()), when the caller spells it differently
// ("MacBook-Air-de-Jorge" for "MacBook-Air-de-Jorge.local"): one machine must be one set of rows.
async function canonicalMachine(tx: Q, name: string): Promise<string> {
  const known = await tx.selectDistinct({ machine: footprints.machine }).from(footprints);
  return known.find((k) => sameMachine(k.machine, name))?.machine ?? name;
}

// A session is live while it holds a ticket whose lease has not run out (any project).
async function sessionIsLive(tx: Q, sessionId: string): Promise<boolean> {
  const [t] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(sql`${tasks.owner}->>'session_id' = ${sessionId}`, sql`${tasks.leaseUntil} > now()`))
    .limit(1);
  return !!t;
}

// The ticket a declaration defaults to: the session's one live claim in the project. None or
// several: no guess (a null task is allowed; the agent can pass task_key).
async function soleClaim(tx: Q, projectId: string, sessionId: string): Promise<Task | null> {
  const mine = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), sql`${tasks.owner}->>'session_id' = ${sessionId}`, sql`${tasks.leaseUntil} > now()`))
    .limit(2);
  return mine.length === 1 ? mine[0]! : null;
}

async function taskRef(tx: Q, id: string | null): Promise<{ id: string; key: string } | null> {
  if (!id) return null;
  const [t] = await tx.select({ id: tasks.id, key: tasks.key }).from(tasks).where(eq(tasks.id, id)).limit(1);
  return t ?? null;
}

const isUniqueViolation = (e: unknown) => {
  const c = e as { code?: string; cause?: { code?: string } };
  return c?.code === "23505" || c?.cause?.code === "23505";
};

function replyShape(r: Row, taskKey: string | null) {
  return { id: r.id, ...footprintShape(r), task_key: taskKey, session_id: r.sessionId, holder: r.holder, declared_at: iso(r.declaredAt) };
}

// ---- register_footprint

export type RegisterInput = {
  project: string;
  kind: string;
  locator: string;
  purpose: string;
  teardown: string;
  task_key?: string;
  details?: Record<string, unknown>;
};

export async function registerFootprint(db: Db, input: RegisterInput, ctx: Ctx) {
  const machineName = ctx.actor.machine?.trim();
  if (!machineName) throw bad("machine", "actor.machine is required: set it on the actor, or use an agent token that has a machine");
  const kind = kindOf(input.kind);
  const purpose = input.purpose?.trim();
  const teardown = input.teardown?.trim();
  if (!purpose) throw bad("purpose", "what is it for, in a line");
  if (!teardown) throw bad("teardown", "the command that removes it");
  const locator = normalizeLocator(kind, input.locator);
  const userDetails = input.details && typeof input.details === "object" && !Array.isArray(input.details) ? input.details : undefined;
  const p = await findProject(db, input.project);

  const once = () =>
    writeTx(db, p, ctx, async (tx, emit) => {
      const machine = await canonicalMachine(tx, machineName);
      const sid = ctx.actor.session_id;
      const now = new Date();
      let task: Task | null = null;
      if (input.task_key) {
        task = (await findTask(tx, p.id, input.task_key)) ?? null;
        if (!task) throw new ToolError("TASK_NOT_FOUND");
      } else task = await soleClaim(tx, p.id, sid);

      const [row] = await tx
        .select()
        .from(footprints)
        .where(and(eq(footprints.machine, machine), eq(footprints.kind, kind), eq(footprints.locator, locator), isNull(footprints.releasedAt)))
        .for("update");

      if (row && row.source !== "observed") {
        const holderSession = row.holder?.session_id ?? row.sessionId;
        if (holderSession && holderSession !== sid && (await sessionIsLive(tx, holderSession))) {
          throw new ToolError("FOOTPRINT_HELD", { locator, kind, holder: row.holder, purpose: row.purpose });
        }
      }

      let saved: Row | undefined;
      if (row) {
        const merged = row.source === "observed";
        const details = userDetails ? { ...row.details, declared: userDetails } : row.details;
        [saved] = await tx
          .update(footprints)
          .set({
            projectId: p.id,
            taskId: task?.id ?? row.taskId, // an inferred owner stays when the agent names none
            sessionId: sid,
            holder: ctx.actor,
            source: row.source === "declared" ? "declared" : "both",
            purpose,
            teardown,
            details,
            // gone and self rows keep the job's word; a declaration makes anything else live
            state: row.state === "gone" || row.state === "self" ? row.state : "live",
            declaredAt: now,
            updatedAt: now,
          })
          .where(eq(footprints.id, row.id))
          .returning();
        await emit("footprint.declared", await taskRef(tx, saved!.taskId), {
          footprint_id: saved!.id, machine, kind, locator, purpose, teardown, merged, took_over_from: row.holder && row.holder.session_id !== sid ? row.holder : undefined,
        });
      } else {
        [saved] = await tx
          .insert(footprints)
          .values({
            machine,
            kind,
            locator,
            projectId: p.id,
            taskId: task?.id ?? null,
            sessionId: sid,
            holder: ctx.actor,
            source: "declared",
            purpose,
            teardown,
            details: userDetails ? { ...userDetails, declared: userDetails } : {},
            state: "live",
            declaredAt: now,
          })
          .returning();
        await emit("footprint.declared", await taskRef(tx, saved!.taskId), { footprint_id: saved!.id, machine, kind, locator, purpose, teardown, merged: false });
      }
      const ref = await taskRef(tx, saved!.taskId);
      return { footprint: replyShape(saved!, ref?.key ?? null), merged: !!row && row.source === "observed" };
    });

  // The job inserts rows too: if it won a race for the same (machine, kind, locator), merge into its row.
  let result: Awaited<ReturnType<typeof once>>;
  try {
    result = await once();
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    result = await once();
  }
  bus.publish({ type: "footprint", project: "" });
  return result;
}

// ---- release_footprint

// Marks the row released (it leaves the inventory) and logs footprint.released. The caller has already
// checked who may. Shared with whoever releases rows later (a screen action, ghost cleanup).
export async function releaseRow(tx: Q, emit: Emit, row: Row, reason: string): Promise<Row> {
  const now = new Date();
  const [saved] = await tx.update(footprints).set({ releasedAt: now, state: "released", updatedAt: now }).where(eq(footprints.id, row.id)).returning();
  await emit("footprint.released", await taskRef(tx, row.taskId), { footprint_id: row.id, machine: row.machine, kind: row.kind, locator: row.locator, holder: row.holder, reason });
  return saved!;
}

// machine: only for Jorge's screen (its actor machine is "screen"); agents release on their own machine.
export type ReleaseInput = { project: string; locator: string; kind?: string; machine?: string };

export async function releaseFootprint(db: Db, input: ReleaseInput, ctx: Ctx) {
  const machineName = (ctx.human ? input.machine : undefined)?.trim() || ctx.actor.machine?.trim();
  if (!machineName) throw bad("machine", "actor.machine is required: set it on the actor, or use an agent token that has a machine");
  const kinds = input.kind ? [kindOf(input.kind)] : [...FOOTPRINT_KINDS];
  // Without a kind, the locator is read as every kind it fits; more than one match is ambiguous.
  const wanted = new Map<string, FootprintKind>();
  let firstError: ToolError | undefined;
  for (const k of kinds) {
    try {
      wanted.set(`${k}\0${normalizeLocator(k, input.locator)}`, k);
    } catch (e) {
      firstError ??= e as ToolError;
    }
  }
  if (!wanted.size) throw firstError ?? bad("locator", "does not fit any kind");
  const p = await findProject(db, input.project);

  const result = await writeTx(db, p, ctx, async (tx, emit) => {
    const machine = await canonicalMachine(tx, machineName);
    const locators = [...new Set([...wanted.keys()].map((k) => k.split("\0")[1]!))];
    const found = (
      await tx
        .select()
        .from(footprints)
        .where(and(eq(footprints.machine, machine), inArray(footprints.locator, locators), isNull(footprints.releasedAt)))
        .for("update")
    ).filter((r) => wanted.has(`${r.kind}\0${r.locator}`));
    if (found.length > 1) throw bad("kind", "the locator matches several kinds: pass kind", { kinds: found.map((r) => r.kind) });
    const row = found[0];
    if (!row) return { locator: input.locator, released: false };
    // Observed rows have no holder: anyone in their project (or in none) may say it is gone.
    const holderSession = row.holder?.session_id;
    const mine = holderSession ? holderSession === ctx.actor.session_id : !row.projectId || row.projectId === p.id;
    if (!ctx.human && !mine) throw new ToolError("FOOTPRINT_HELD", { locator: row.locator, kind: row.kind, holder: row.holder, purpose: row.purpose });
    const saved = await releaseRow(tx, emit, row, ctx.human ? "released by Jorge" : "released by its holder");
    const ref = await taskRef(tx, saved.taskId);
    return { locator: saved.locator, kind: saved.kind, released: true, footprint: replyShape(saved, ref?.key ?? null) };
  });
  bus.publish({ type: "footprint", project: "" });
  return result;
}
