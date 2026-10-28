// PLA-I17-1: readiness of a project before resuming it. Pure cases per state and reason, then the
// same object on get_resume and GET /api/projects, with the old fields still in place.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";
import {
  CONTEXT_WINDOW_DAYS,
  FOOTPRINT_FRESH_MS,
  readinessOf,
  type Readiness,
  type ReadinessInput,
  type ReadinessTicket,
} from "../src/mcp/readiness.js";
import { QUIET_MIN } from "../src/mcp/watch.js";

useTestEnv();

const NOW = new Date("2026-06-15T12:00:00.000Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    now: NOW,
    lastEventAt: null,
    headlineStale: false,
    nextClaimableKey: null,
    deployFailed: false,
    envBehind: false,
    initiatives: [],
    tickets: [],
    decisions: [],
    ...over,
  };
}

function ticket(over: Partial<ReadinessTicket> = {}): ReadinessTicket {
  return {
    key: "MC-12",
    status: "In progress",
    leaseUntil: new Date(NOW.getTime() + 30 * MIN),
    lastActivityAt: NOW,
    areas: [],
    pr: null,
    unsatisfiedBlocker: false,
    footprint: [{ state: "live", kind: "worktree", dirty: false, lastSeenAt: NOW }],
    ...over,
  };
}

function idle(over: Partial<ReadinessTicket> = {}): ReadinessTicket {
  return ticket({ status: "Ready", leaseUntil: null, lastActivityAt: null, footprint: null, ...over });
}

const codes = (r: Readiness) => r.reasons.map((x) => x.code);

describe("readinessOf", () => {
  test("ready: a healthy live claim", () => {
    const r = readinessOf(input({ tickets: [ticket()] }));
    assert.equal(r.state, "ready");
    assert.deepEqual(r.reasons, []);
    assert.equal(r.line, "MC-12: se puede retomar.");
    const edge = readinessOf(input({ tickets: [ticket({ lastActivityAt: new Date(NOW.getTime() - QUIET_MIN * MIN) })] }));
    assert.equal(edge.state, "ready", "activity exactly at the quiet window is still live");
  });

  test("ready: In review with green checks", () => {
    const r = readinessOf(input({ tickets: [idle({ status: "In review", pr: { ci: "success" } })] }));
    assert.equal(r.state, "ready");
    assert.deepEqual(r.reasons, []);
    assert.equal(r.line, "MC-12: en revisión con los checks en verde.");
  });

  test("ready: only a clear next step", () => {
    const r = readinessOf(input({ nextClaimableKey: "MC-12", tickets: [idle()] }));
    assert.equal(r.state, "ready");
    assert.deepEqual(r.reasons, []);
    assert.equal(r.line, "Siguiente: MC-12.");
    const noted = readinessOf(input({ initiatives: [{ key: "MC-I1", nextAction: "seguir con el corte", stateNoteStale: false }] }));
    assert.equal(noted.state, "ready");
    assert.equal(noted.line, "MC-I1: hay un siguiente paso.");
  });

  test("caution: expired lease", () => {
    const r = readinessOf(input({ tickets: [ticket({ leaseUntil: new Date(NOW.getTime() - MIN) })] }));
    assert.equal(r.state, "caution");
    assert.deepEqual(codes(r), ["LEASE_EXPIRED"]);
    assert.equal(r.reasons[0]!.severity, "caution");
    assert.equal(r.reasons[0]!.task_key, "MC-12");
    assert.equal(r.line, "MC-12: la reserva de trabajo ya venció.");
  });

  test("caution: owner missing from the machine", () => {
    const missing = readinessOf(input({ tickets: [ticket({ footprint: [] })] }));
    assert.equal(missing.state, "caution");
    assert.deepEqual(codes(missing), ["OWNER_ABSENT"]);
    assert.equal(missing.line, "MC-12: el dueño ya no está en la máquina.");
    const old = readinessOf(
      input({
        tickets: [
          ticket({
            footprint: [{ state: "live", kind: "worktree", dirty: false, lastSeenAt: new Date(NOW.getTime() - FOOTPRINT_FRESH_MS - 1) }],
          }),
        ],
      }),
    );
    assert.deepEqual(codes(old), ["OWNER_ABSENT"]);
    const gone = readinessOf(input({ tickets: [ticket({ footprint: [{ state: "gone", kind: "worktree", dirty: false, lastSeenAt: NOW }] })] }));
    assert.deepEqual(codes(gone), ["OWNER_ABSENT"]);
  });

  test("caution: claim quiet past the shared window", () => {
    const r = readinessOf(input({ tickets: [ticket({ lastActivityAt: new Date(NOW.getTime() - QUIET_MIN * MIN - 1) })] }));
    assert.equal(r.state, "caution");
    assert.deepEqual(codes(r), ["CLAIM_QUIET"]);
    assert.equal(r.line, "MC-12: el claim lleva callado.");
    assert.equal(QUIET_MIN, 20);
  });

  test("caution: dirty worktree", () => {
    const r = readinessOf(input({ tickets: [ticket({ footprint: [{ state: "live", kind: "worktree", dirty: true, lastSeenAt: NOW }] })] }));
    assert.equal(r.state, "caution");
    assert.deepEqual(codes(r), ["WORKTREE_DIRTY"]);
    assert.equal(r.line, "MC-12: el worktree tiene cambios sin guardar.");
  });

  test("caution: dirty unknown is never ready", () => {
    const r = readinessOf(input({ tickets: [ticket({ footprint: [{ state: "live", kind: "worktree", dirty: null, lastSeenAt: NOW }] })] }));
    assert.equal(r.state, "caution");
    assert.notEqual(r.state, "ready");
    assert.deepEqual(codes(r), ["DIRTY_UNKNOWN"]);
    assert.equal(r.line, "MC-12: no se sabe si el worktree está limpio.");
    const serverOnly = readinessOf(input({ tickets: [ticket({ footprint: [{ state: "live", kind: "server", dirty: null, lastSeenAt: NOW }] })] }));
    assert.deepEqual(codes(serverOnly), ["DIRTY_UNKNOWN"]);
  });

  test("caution: stale headline or state note", () => {
    const headline = readinessOf(input({ headlineStale: true, nextClaimableKey: "MC-12", tickets: [idle()] }));
    assert.equal(headline.state, "caution");
    assert.deepEqual(codes(headline), ["NOTE_STALE"]);
    assert.equal(headline.reasons[0]!.task_key, null);
    assert.equal(headline.line, "La nota del proyecto está vieja.");
    const note = readinessOf(input({ initiatives: [{ key: "MC-I1", nextAction: "seguir", stateNoteStale: true }] }));
    assert.equal(note.state, "caution");
    assert.deepEqual(codes(note), ["NOTE_STALE"]);
    assert.equal(note.reasons[0]!.task_key, "MC-I1");
    assert.equal(note.line, "MC-I1: la nota de estado está vieja.");
  });

  test("caution: a pull request check still pending", () => {
    const r = readinessOf(input({ tickets: [idle({ status: "In review", pr: { ci: "pending" } })] }));
    assert.equal(r.state, "caution");
    assert.deepEqual(codes(r), ["PR_PENDING"]);
    assert.equal(r.line, "MC-12: un check del PR sigue pendiente.");
  });

  test("caution: an unreadable pull request is never ready", () => {
    const unknown = readinessOf(input({ tickets: [idle({ status: "In review", pr: { ci: "unknown" } })] }));
    assert.equal(unknown.state, "caution");
    assert.deepEqual(codes(unknown), ["PR_UNREADABLE"]);
    assert.equal(unknown.line, "MC-12: no se puede leer el estado del PR.");
    const missing = readinessOf(input({ tickets: [idle({ status: "In review", pr: null })] }));
    assert.deepEqual(codes(missing), ["PR_UNREADABLE"]);
  });

  test("caution: a human decision somewhere else in the project", () => {
    const r = readinessOf(input({ tickets: [ticket()], decisions: [{ task_key: "MC-99" }] }));
    assert.equal(r.state, "caution");
    assert.deepEqual(codes(r), ["DECISION_ELSEWHERE"]);
    assert.equal(r.reasons[0]!.task_key, "MC-99");
    assert.equal(r.line, "MC-99: hay una decisión pendiente en otro ticket.");
  });

  test("caution: a recent event and no step to resume", () => {
    assert.equal(CONTEXT_WINDOW_DAYS, 14);
    const r = readinessOf(input({ lastEventAt: new Date(NOW.getTime() - 13 * DAY) }));
    assert.equal(r.state, "caution");
    assert.deepEqual(codes(r), ["NO_NEXT"]);
    assert.equal(r.line, "Hay movimiento reciente y ningún paso claro.");
  });

  test("blocked: unsatisfied blocker, or the ticket is Blocked", () => {
    const held = readinessOf(input({ tickets: [ticket({ unsatisfiedBlocker: true })] }));
    assert.equal(held.state, "blocked");
    assert.deepEqual(codes(held), ["BLOCKER_OPEN"]);
    assert.equal(held.reasons[0]!.severity, "blocked");
    assert.equal(held.line, "MC-12: tiene un blocker sin cumplir.");
    const status = readinessOf(input({ tickets: [ticket({ status: "Blocked" })] }));
    assert.deepEqual(codes(status), ["BLOCKER_OPEN"]);
    assert.equal(status.line, "MC-12: está bloqueado.");
  });

  test("blocked: pull request ci_state failure", () => {
    const r = readinessOf(input({ tickets: [idle({ status: "In review", pr: { ci: "failure" } })] }));
    assert.equal(r.state, "blocked");
    assert.deepEqual(codes(r), ["CI_FAILURE"]);
    assert.equal(r.line, "MC-12: el PR falló los checks.");
  });

  test("blocked: failed deploy or an environment behind, on a ticket In review", () => {
    const lag = readinessOf(input({ envBehind: true, tickets: [idle({ status: "In review", pr: { ci: "success" } })] }));
    assert.equal(lag.state, "blocked");
    assert.deepEqual(codes(lag), ["DEPLOY_BLOCKED"]);
    assert.equal(lag.line, "MC-12: el entorno va detrás de la rama de integración.");
    const failed = readinessOf(input({ deployFailed: true, tickets: [idle({ status: "In review", pr: { ci: "success" } })] }));
    assert.deepEqual(codes(failed), ["DEPLOY_BLOCKED"]);
    assert.equal(failed.line, "MC-12: el deploy falló.");
  });

  test("blocked: two live claims overlap areas", () => {
    const r = readinessOf(
      input({
        tickets: [ticket({ key: "MC-12", areas: ["src/**"] }), ticket({ key: "MC-13", areas: ["src/lib"] })],
      }),
    );
    assert.equal(r.state, "blocked");
    assert.deepEqual(codes(r), ["AREAS_OVERLAP"]);
    assert.equal(r.reasons[0]!.task_key, "MC-12");
    assert.equal(r.line, "MC-12 y MC-13 trabajan en las mismas áreas.");
  });

  test("blocked: a human decision on the ticket to resume", () => {
    const r = readinessOf(input({ tickets: [ticket()], decisions: [{ task_key: "MC-12" }] }));
    assert.equal(r.state, "blocked");
    assert.deepEqual(codes(r), ["DECISION_PENDING"]);
    assert.equal(r.line, "MC-12: espera una decisión humana.");
  });

  test("no_context: an empty project", () => {
    const r = readinessOf(input());
    assert.equal(r.state, "no_context");
    assert.deepEqual(codes(r), ["NO_CONTEXT"]);
    assert.equal(r.reasons[0]!.severity, "no_context");
    assert.equal(r.reasons[0]!.task_key, null);
    assert.equal(r.line, "No hay contexto reciente para retomar.");
  });

  test("no_context: only an event from 30 days ago", () => {
    const r = readinessOf(input({ lastEventAt: new Date(NOW.getTime() - 30 * DAY) }));
    assert.equal(r.state, "no_context");
    assert.deepEqual(codes(r), ["NO_CONTEXT"]);
  });

  test("precedence: blocked wins over caution", () => {
    const r = readinessOf(
      input({
        tickets: [ticket({ unsatisfiedBlocker: true, footprint: [{ state: "live", kind: "worktree", dirty: true, lastSeenAt: NOW }] })],
      }),
    );
    assert.equal(r.state, "blocked");
    assert.deepEqual(codes(r), ["BLOCKER_OPEN", "WORKTREE_DIRTY"]);
    assert.equal(r.line, "MC-12: tiene un blocker sin cumplir.");
  });

  test("precedence: no_context wins over blocked and caution", () => {
    const r = readinessOf(
      input({
        headlineStale: true,
        lastEventAt: new Date(NOW.getTime() - 30 * DAY),
        tickets: [idle({ status: "Blocked", unsatisfiedBlocker: true })],
        decisions: [{ task_key: "MC-12" }],
      }),
    );
    assert.equal(r.state, "no_context");
    assert.deepEqual(codes(r), ["NO_CONTEXT"]);
    assert.equal(r.line, "No hay contexto reciente para retomar.");
  });
});

describe("get_resume and GET /api/projects", () => {
  let raw: pg.Client;
  let client: Client;
  let closeDb: () => Promise<void>;
  let cookie: string;

  const ctx = { actor: { agent: "test-agent", session_id: "s1", machine: "test-mac" } };

  async function call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    const data = JSON.parse(r.content[0]!.text);
    if (r.isError) throw new Error(`${name} ${data.error}`);
    return data;
  }

  before(async () => {
    raw = await resetTestDb();
    const { makeDb } = await import("../src/db/client.js");
    const { createMcpServer } = await import("../src/mcp/register.js");
    const { createTask, claim } = await import("../src/mcp/writes.js");
    const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
    cookie = `${SESSION_COOKIE}=${createSession()}`;
    const made = makeDb();
    closeDb = made.close;
    await createTask(made.db, { project: "zigzag", title: "Corte", scope: "s", checks: ["c"], status: "Ready" }, ctx);
    await claim(made.db, { project: "zigzag", key: "ZIG-01" }, ctx);
    await raw.query(
      `insert into footprints (machine, kind, locator, project_id, task_id, state, details, last_seen_at, first_seen_at, source)
       select 'test-mac', 'worktree', '/tmp/wt-mc', p.id, t.id, 'live', '{"dirty":false}'::jsonb, now(), now(), 'observed'
       from projects p join tasks t on t.project_id = p.id
       where p.slug = 'zigzag' and t.key = 'ZIG-01'`,
    );
    await raw.query(
      `insert into events (project_id, type, actor, payload, created_at)
       select id, 'note', '{"agent":"test","session_id":"s1"}'::jsonb, '{}'::jsonb, now() - interval '30 days'
       from projects where slug = 'workia'`,
    );
    await raw.query("insert into projects (slug, title, key_prefix) values ('alfa', 'Alfa', 'ALF')");
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(made.db).connect(serverSide);
    client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
  });

  after(async () => {
    await client?.close();
    await closeDb?.();
    await raw?.end();
  });

  test("the same readiness, and old consumer fields keep their shape", async () => {
    const { app } = await import("../src/app.js");
    const resume = await call("get_resume", { project: "zigzag" });
    const listed = (await call("list_projects")).projects as Record<string, any>[];
    const digest = (await call("get_digest", { since: 0, project: "zigzag" })).projects.find((p: { slug: string }) => p.slug === "zigzag");
    const res = await app.request("/api/projects", { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    const api = (await res.json()) as Record<string, any>[];
    const zigApi = api.find((p) => p.slug === "zigzag")!;
    const micApi = api.find((p) => p.slug === "micasa")!;
    const zigList = listed.find((p) => p.slug === "zigzag")!;
    const micResume = await call("get_resume", { project: "micasa" });

    assert.equal(resume.readiness.state, "ready");
    assert.equal(resume.readiness.line, "ZIG-01: se puede retomar.");
    assert.deepEqual(zigApi.readiness, resume.readiness);
    assert.deepEqual(zigList.readiness, resume.readiness);
    assert.deepEqual(digest.readiness, resume.readiness);
    assert.equal(micApi.readiness.state, "no_context");
    assert.deepEqual(micApi.readiness, micResume.readiness);
    assert.equal(listed.find((p) => p.slug === "workia")!.readiness.state, "no_context");

    assert.deepEqual(Object.keys(resume).sort(), [
      "claims",
      "generated_at",
      "headline",
      "initiatives",
      "machine",
      "must_keep",
      "next_claimable",
      "open_questions",
      "project",
      "readiness",
      "recent",
      "requests",
      "standalone",
      "status",
    ]);
    assert.deepEqual(Object.keys(resume.headline).sort(), ["generated", "note"]);
    assert.deepEqual(Object.keys(resume.headline.note).sort(), ["at", "stale", "text", "version"]);
    assert.deepEqual(Object.keys(resume.claims[0]).sort(), ["key", "kind", "lease_until", "owner", "title", "workspace"]);
    assert.equal(resume.claims[0].key, "ZIG-01");
    assert.equal(typeof resume.headline.generated, "string");
    assert.ok(Array.isArray(resume.status.envs));
    assert.deepEqual(Object.keys(zigApi).sort(), [
      "activity",
      "audit_count",
      "envs",
      "initiatives",
      "line",
      "next_claimable",
      "next_line",
      "open_questions",
      "overdue",
      "readiness",
      "slug",
      "tasks",
      "title",
      "upcoming",
    ]);
    assert.equal(typeof zigApi.line, "string");
    assert.equal(typeof zigApi.next_line, "string");
    assert.ok(Array.isArray(zigApi.tasks));
    assert.deepEqual(Object.keys(zigList).sort(), [
      "claims",
      "counts",
      "created_at",
      "headline",
      "key_prefix",
      "last_event_at",
      "last_event_id",
      "line",
      "open_questions",
      "readiness",
      "slug",
      "title",
    ]);
    assert.equal(typeof zigList.counts.open, "number");
    assert.equal(typeof zigList.line, "string");
    assert.equal(digest.line, zigList.line);
    assert.ok(Array.isArray(digest.changes));
    assert.equal(typeof digest.quiet, "boolean");
  });

  test("five projects stay inside the list_projects budget", async () => {
    const started = Date.now();
    const listed = await call("list_projects");
    const elapsed = Date.now() - started;
    assert.deepEqual(
      listed.projects.map((p: { slug: string }) => p.slug),
      ["alfa", "filmia", "micasa", "workia", "zigzag"],
    );
    assert.ok(listed.projects.every((p: { readiness: { state: string; line: string } }) => p.readiness.state && p.readiness.line));
    assert.ok(elapsed < 4000, `${elapsed}ms`);
  });
});
