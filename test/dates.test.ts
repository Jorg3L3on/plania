// 2.10 fix c: due dates on screen. GET /api/projects carries upcoming and overdue per project, the
// task rows carry due_on and time_after, and Inicio's Próximo puts overdue first.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { datesOf } = await import("../src/api/routes.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { createTask } = await import("../src/mcp/writes.js");
const { dayText, dueText, isOverdue, proximoOf } = await import("../ui/src/lib/due.js");

type Json = Record<string, any>;
let raw: pg.Client;
const cookie = `${SESSION_COOKIE}=${createSession()}`;
const ctx = { actor: { agent: "t", session_id: "s1", machine: "ci" } };
const get = async (path: string) => (await (await app.request(path, { headers: { Cookie: cookie } })).json()) as Json;
const day = (offset: number) => new Intl.DateTimeFormat("en-CA", { timeZone: process.env.PLANIA_TZ || "America/Mexico_City" }).format(new Date(Date.now() + offset * 86_400_000));

before(async () => {
  raw = await resetTestDb();
  const { db, close } = makeDb();
  try {
    const T = { project: "filmia", scope: "s", checks: ["c"], status: "Ready" };
    await createTask(db, { ...T, title: "Compare reco_open_rate with the queue", due_on: day(9) }, ctx); // FIL-01
    await createTask(db, { ...T, title: "Rotate the TMDB key", due_on: day(-2) }, ctx); // FIL-02
    await createTask(db, { ...T, title: "After the trial", blocked_by: [{ time_after: new Date(Date.now() + 3 * 86_400_000).toISOString() }] }, ctx); // FIL-03
    await createTask(db, { ...T, title: "Far away", due_on: day(40) }, ctx); // FIL-04
    await createTask(db, { ...T, title: "Closed late", due_on: day(-5) }, ctx); // FIL-05
  } finally {
    await close();
  }
  await raw.query("update tasks set status = 'Done' where key = 'FIL-05'");
});

after(async () => {
  await raw?.end();
});

describe("dates in the API", () => {
  test("GET /api/projects: upcoming in the next 14 days, date order, and overdue keys", async () => {
    const filmia = (await get("/api/projects")).find((p: Json) => p.slug === "filmia");
    assert.deepEqual(filmia.upcoming.map((u: Json) => [u.key, u.kind]), [["FIL-03", "time_after"], ["FIL-01", "due"]]);
    assert.equal(filmia.upcoming[1].on, day(9));
    assert.deepEqual(filmia.overdue, ["FIL-02"], "a closed ticket is never overdue");
    const zigzag = (await get("/api/projects")).find((p: Json) => p.slug === "zigzag");
    assert.deepEqual([zigzag.upcoming, zigzag.overdue], [[], []]);
  });

  test("GET /api/projects/:slug: every row carries due_on and time_after", async () => {
    const rows = (await get("/api/projects/filmia")).tasks as Json[];
    const by = Object.fromEntries(rows.map((t) => [t.key, t]));
    assert.equal(by["FIL-01"].due_on, day(9));
    assert.equal(by["FIL-01"].time_after, null);
    assert.match(by["FIL-03"].time_after, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(by["FIL-03"].held, true);
  });

  test("datesOf ignores merged work and passed time_after", () => {
    const now = new Date("2026-10-15T18:00:00Z");
    const out = datesOf(
      [
        { key: "A", title: "a", status: "Merged", due_on: "2026-10-10", time_after: null },
        { key: "B", title: "b", status: "Ready", due_on: "2026-10-24", time_after: null },
        { key: "C", title: "c", status: "Backlog", due_on: null, time_after: "2026-10-16T00:00:00.000Z" },
      ],
      now,
    );
    assert.deepEqual(out.upcoming.map((u) => u.key), ["C", "B"]);
    assert.deepEqual(out.overdue, []);
  });
});

describe("dates on screen (ui/src/lib/due.ts)", () => {
  const now = new Date("2026-10-15T12:00:00").getTime();
  test("vence 24 oct; venció once past; nothing for closed work", () => {
    assert.equal(dayText("2026-10-24", now), "24 oct");
    assert.equal(dueText({ due_on: "2026-10-24", status: "Ready" }, now), "vence 24 oct");
    assert.equal(dueText({ due_on: "2026-10-12", status: "In progress" }, now), "venció 12 oct");
    assert.equal(isOverdue({ due_on: "2026-10-12", status: "In progress" }, now), true);
    assert.equal(dueText({ due_on: "2026-10-12", status: "Done" }, now), null);
    assert.equal(dayText("2027-01-03", now), "3 ene 2027");
  });

  test("Próximo: overdue first, then by date across projects", () => {
    const lines = proximoOf([
      { slug: "filmia", tasks: [{ key: "FIL-02", title: "Rotate", status: "Ready", due_on: "2026-10-13" }], upcoming: [{ key: "FIL-01", title: "Compare", on: "2026-10-24", kind: "due" }], overdue: ["FIL-02"] },
      { slug: "zigzag", tasks: [], upcoming: [{ key: "ZIG-03", title: "Trial", on: "2026-10-18T06:00:00.000Z", kind: "time_after" }], overdue: [] },
    ]);
    assert.deepEqual(lines.map((l) => [l.key, l.overdue]), [["FIL-02", true], ["ZIG-03", false], ["FIL-01", false]]);
  });
});
