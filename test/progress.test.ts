// PLA-I19-1: day buckets in America/Mexico_City, streak, Won't do and [PRUEBA] excluded,
// a reopen counted once, bearer rejected, year summary under 500ms.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_TZ = "America/Mexico_City";

const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const {
  addDays,
  clearProgressCache,
  dayInTz,
  deltaPct,
  isoWeek,
  isPruebaTitle,
  pairImages,
  progressItem,
  progressLog,
  progressSummary,
  streakOf,
  weekRange,
} = await import("../src/mcp/progress.js");

type Json = Record<string, any>;
let raw: pg.Client;
const cookie = `${SESSION_COOKIE}=${createSession()}`;
const actor = JSON.stringify({ agent: "t", session_id: "s" });

const get = async (path: string, headers: Record<string, string> = {}) => {
  const res = await app.request(path, { headers: { Cookie: cookie, ...headers } });
  const body = (await res.json()) as Json;
  return { status: res.status, body };
};

before(async () => {
  raw = await resetTestDb();
  clearProgressCache();
  const id = async (slug: string) => (await raw.query("select id from projects where slug = $1", [slug])).rows[0].id as string;
  const filmia = await id("filmia");
  const micasa = await id("micasa");

  const task = async (row: {
    project: string;
    key: string;
    title: string;
    status?: string;
    kind?: string;
    work?: string | null;
    at?: string | null;
    summary?: string;
    parent?: string | null;
    stage?: string | null;
  }) => {
    const parent = row.parent ? (await raw.query("select id from tasks where key = $1", [row.parent])).rows[0].id : null;
    await raw.query(
      `insert into tasks (project_id, kind, key, title, summary, status, work_type, resolved_at, parent_id, stage)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        row.project === "micasa" ? micasa : filmia,
        row.kind ?? "ticket",
        row.key,
        row.title,
        row.summary ?? "",
        row.status ?? "Done",
        row.work === undefined ? "code" : row.work,
        row.at ?? null,
        parent,
        row.stage ?? null,
      ],
    );
  };

  // 05:59Z is still the 10th in Mexico City; 06:00Z is the 11th.
  await task({ project: "filmia", key: "FIL-EDGE", title: "Borde de la noche", at: "2026-03-11T05:59:59Z" });
  await task({ project: "filmia", key: "FIL-EDGE2", title: "Ya es otro día", at: "2026-03-11T06:00:00Z" });
  await task({ project: "filmia", key: "FIL-W", title: "No se hará", status: "Won't do", at: "2026-03-10T18:00:00Z" });
  await task({ project: "filmia", key: "FIL-P", title: "[PRUEBA] ruido", at: "2026-03-10T18:00:00Z" });
  await task({ project: "filmia", key: "FIL-R", title: "Reabierto y cerrado", summary: "Quedó cerrado una sola vez", at: "2026-03-10T18:00:00Z" });
  await task({ project: "filmia", key: "FIL-B", title: "El login se cae", work: "bug", summary: "Ya entra.", at: "2026-03-10T18:00:00Z" });
  await task({ project: "filmia", key: "FIL-I1", title: "Pagos por encima", kind: "initiative", work: null, summary: "El saldo cierra en cero.", at: "2026-03-10T16:00:00Z" });
  await task({ project: "filmia", key: "FIL-I1-1", title: "Permitir monto mayor", parent: "FIL-I1", at: "2026-03-10T15:00:00Z" });
  await task({ project: "filmia", key: "FIL-I1-2", title: "Todavía abierto", parent: "FIL-I1", status: "Ready", at: null });
  await task({ project: "filmia", key: "FIL-I1-3", title: "Descartado", parent: "FIL-I1", status: "Won't do", at: "2026-03-10T12:00:00Z" });
  await task({ project: "filmia", key: "FIL-I1-4", title: "[PRUEBA] hijo", parent: "FIL-I1", at: "2026-03-10T12:00:00Z" });
  await task({ project: "filmia", key: "FIL-IDEA", title: "Una idea suelta", kind: "idea", work: null, stage: "idea", at: "2026-03-10T11:00:00Z" });

  const rid = (await raw.query("select id, project_id from tasks where key = 'FIL-R'")).rows[0];
  await raw.query(
    `insert into events (project_id, task_id, task_key, type, actor, payload, created_at) values
     ($1, $2, 'FIL-R', 'task.status', $3, '{"from":"In progress","to":"Done"}', '2026-03-09T18:00:00Z'),
     ($1, $2, 'FIL-R', 'task.status', $3, '{"from":"In progress","to":"Done"}', '2026-03-10T18:00:00Z')`,
    [rid.project_id, rid.id, actor],
  );

  const bid = (await raw.query("select id from tasks where key = 'FIL-B'")).rows[0].id;
  const wid = (await raw.query("select id from tasks where key = 'FIL-W'")).rows[0].id;
  await raw.query(
    `insert into pull_requests (project_id, repo, number, url, title, task_id, state, merged_at) values
     ($1, 'example/filmia', 20, 'https://example.com/pull/20', 'Arreglo del login', $2, 'merged', '2026-03-11T05:59:59Z'),
     ($1, 'example/filmia', 21, 'https://example.com/pull/21', 'Día siguiente', null, 'merged', '2026-03-11T06:00:00Z'),
     ($1, 'example/filmia', 22, 'https://example.com/pull/22', '[PRUEBA] no cuenta', null, 'merged', '2026-03-10T18:00:00Z'),
     ($1, 'example/filmia', 23, 'https://example.com/pull/23', 'De un descarte', $3, 'merged', '2026-03-10T18:00:00Z')`,
    [filmia, bid, wid],
  );

  await task({ project: "filmia", key: "FIL-EMPTY", title: "Sin resumen", summary: "", work: "bug", at: "2026-09-15T18:00:00Z" });
  await task({ project: "filmia", key: "FIL-B2", title: "Login roto en safari", work: "bug", summary: "La sesión aguanta.", at: "2026-09-15T17:00:00Z" });
  await task({ project: "filmia", key: "FIL-C2", title: "Login de la ficha", work: "code", summary: "Entra con el póster.", at: "2026-09-15T16:00:00Z" });
  await task({ project: "filmia", key: "FIL-X", title: "Otra cosa", work: "bug", summary: "Sin la palabra.", at: "2026-09-15T15:00:00Z" });
  await task({ project: "micasa", key: "MIC-B2", title: "Login del panel", work: "bug", summary: "El panel abre.", at: "2026-09-15T14:00:00Z" });
  const empty = (await raw.query("select id, project_id from tasks where key = 'FIL-EMPTY'")).rows[0];
  await raw.query("insert into decisions (project_id, task_id, line, actor) values ($1, $2, $3, $4)", [
    empty.project_id,
    empty.id,
    "Se acepta cualquier cliente registrado",
    actor,
  ]);
  await raw.query(
    `insert into results (task_id, kind, verdict, cite, url, attachments, actor) values
     ($1, 'visual', 'pass', 'antes y después', 'https://example.com/after.png', array['https://example.com/before.png'], $2),
     ($1, 'grep', 'pass', 'no es imagen', 'https://example.com/not-visual.png', '{}', $2)`,
    [empty.id, actor],
  );
  await raw.query(
    "insert into pull_requests (project_id, repo, number, url, title, task_id, state, merged_at) values ($1, 'example/filmia', 293, 'https://example.com/pull/293', 'Permitir redirect', $2, 'merged', '2026-09-15T18:00:00Z')",
    [filmia, empty.id],
  );

  const today = dayInTz(new Date());
  const streakDays = [...[0, 1, 2, 3, 4].map((n) => addDays(today, -n)), ...[6, 7, 8, 9, 10, 11, 12].map((n) => addDays(today, -n))];
  for (const [i, day] of streakDays.entries()) {
    await task({ project: "micasa", key: `MIC-S${i}`, title: `Día activo ${i}`, at: `${day}T18:00:00Z` });
  }
  await task({ project: "micasa", key: "MIC-GAP", title: "[PRUEBA] no llena la racha", at: `${addDays(today, -5)}T18:00:00Z` });
});

after(async () => {
  await raw?.end();
});

describe("pure day math", () => {
  test("Mexico City midnight and ISO week 44", () => {
    assert.equal(dayInTz(new Date("2026-03-11T05:59:59Z")), "2026-03-10");
    assert.equal(dayInTz(new Date("2026-03-11T06:00:00Z")), "2026-03-11");
    assert.equal(dayInTz(new Date("2026-11-04T05:59:59Z")), "2026-11-03");
    assert.equal(dayInTz(new Date("2026-11-04T06:00:00Z")), "2026-11-04");
    assert.deepEqual(weekRange("2026-10-26"), { from: "2026-10-26", to: "2026-11-01" });
    assert.deepEqual(isoWeek("2026-10-26"), { week: 44, weekYear: 2026 });
    assert.equal(isPruebaTitle("[PRUEBA] ruido"), true);
    assert.equal(isPruebaTitle("un arreglo de verdad"), false);
    assert.equal(deltaPct(31, 21), 48);
    assert.equal(deltaPct(2, 0), null);
    assert.deepEqual(pairImages(["file:///x", "https://example.com/a.png"]), { before: null, after: "https://example.com/a.png", all: ["https://example.com/a.png"] });
  });

  test("streak holds through today, and through yesterday when today is still empty", () => {
    const days = ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-05", "2026-03-06"];
    assert.equal(streakOf(days, "2026-03-06", 2026).current, 2);
    assert.equal(streakOf(days, "2026-03-07", 2026).current, 2);
    assert.equal(streakOf(days, "2026-03-08", 2026).current, 0);
    assert.equal(streakOf(["2026-03-01", "2026-03-02", "2026-03-03", "2026-01-01", "2026-01-02"], "2026-03-03", 2026).bestYear, 3);
  });
});

describe("progress API", () => {
  test("midnight boundary, Won't do and [PRUEBA] excluded, reopen counted once", async () => {
    const tenth = await get("/api/progress/summary?range=day&date=2026-03-10");
    assert.equal(tenth.status, 200);
    assert.equal(tenth.body.finished, 5);
    assert.equal(tenth.body.bugs, 1);
    assert.equal(tenth.body.initiatives, 1);
    assert.equal(tenth.body.tickets, 4);
    assert.equal(tenth.body.prs, 1);
    assert.equal(tenth.body.biggest_win.key, "FIL-I1");
    assert.equal(tenth.body.biggest_win.tickets, 1);
    const keys = new Set(tenth.body.year.highlights.map((h: Json) => h.key));
    assert.equal(keys.has("FIL-P"), false);
    assert.equal(keys.has("FIL-W"), false);

    const eleventh = await get("/api/progress/summary?range=day&date=2026-03-11");
    assert.equal(eleventh.body.finished, 1);
    assert.equal(eleventh.body.prs, 1);
    assert.equal(eleventh.body.buckets[0].total, 1);

    const { db, close } = makeDb();
    try {
      const direct = await progressSummary(db, { range: "day", date: "2026-03-10" });
      assert.equal(direct.finished, 5);
    } finally {
      await close();
    }
  });

  test("streak ignores a [PRUEBA] day in the gap", async () => {
    const today = dayInTz(new Date());
    const summary = await get(`/api/progress/summary?range=day&date=${today}`);
    assert.equal(summary.body.streak.current, 5);
    const { bestYear } = streakOf(
      [...[0, 1, 2, 3, 4].map((n) => addDays(today, -n)), ...[6, 7, 8, 9, 10, 11, 12].map((n) => addDays(today, -n))],
      today,
      Number(today.slice(0, 4)),
    );
    assert.equal(summary.body.streak.best_year, bestYear);
    assert.equal(summary.body.streak.week.filter((d: Json) => d.date === today)[0].active, true);
  });

  test("week label is SEMANA 44", async () => {
    const summary = await get("/api/progress/summary?range=week&date=2026-10-26");
    assert.equal(summary.body.label, "SEMANA 44 · 26 OCT – 1 NOV");
    assert.equal(summary.body.buckets.length, 7);
    assert.equal(summary.body.heatmap.length, 53 * 7);
  });

  test("log filters combine, and an idea is listed but not counted as a cosa", async () => {
    const log = await get("/api/progress/log?from=2026-09-15&to=2026-09-15&project=filmia&type=bug&q=login");
    assert.equal(log.status, 200);
    assert.deepEqual(log.body.days[0].entries.map((e: Json) => e.key), ["FIL-B2"]);
    // Chips ignore the type filter, so the same project and search still show the feature.
    assert.equal(log.body.counts.bug, 1);
    assert.equal(log.body.counts.code, 1);
    assert.equal(log.body.counts.all, 2);

    const byNumber = await get("/api/progress/log?from=2026-09-15&to=2026-09-15&q=%23293");
    assert.equal(byNumber.body.days[0].entries.some((e: Json) => e.key === "FIL-EMPTY"), true);

    const march = await get("/api/progress/log?from=2026-03-10&to=2026-03-10");
    const marchKeys = march.body.days.flatMap((d: Json) => d.entries.map((e: Json) => e.key ?? e.title));
    assert.equal(marchKeys.includes("FIL-IDEA"), true);
    assert.equal(marchKeys.includes("FIL-P"), false);
    assert.equal(marchKeys.includes("FIL-W"), false);
    assert.equal(march.body.days[0].total, 5);
    const initiative = march.body.days[0].entries.find((e: Json) => e.key === "FIL-I1");
    assert.deepEqual(initiative.children.map((c: Json) => c.key), ["FIL-I1-1", "FIL-I1-2"]);
    assert.equal(initiative.child_done, 1);
  });

  test("item uses the decision when the summary is empty, and only visual links", async () => {
    const item = await get("/api/progress/item/filmia/FIL-EMPTY");
    assert.equal(item.status, 200);
    assert.equal(item.body.change, "Se acepta cualquier cliente registrado");
    assert.equal(item.body.images.before, "https://example.com/before.png");
    assert.equal(item.body.images.after, "https://example.com/after.png");
    assert.equal(item.body.images.all.includes("https://example.com/not-visual.png"), false);
    assert.equal(item.body.prs[0].number, 293);
    assert.equal(item.body.type, "bug");

    const hidden = await get("/api/progress/item/filmia/FIL-P");
    assert.equal(hidden.status, 404);
    const missing = await get("/api/progress/item/nope/FIL-1");
    assert.equal(missing.status, 404);

    const { db, close } = makeDb();
    try {
      const direct = await progressItem(db, "filmia", "FIL-EMPTY");
      assert.equal(direct.images.all.length, 2);
      const listed = await progressLog(db, { from: "2026-09-15", to: "2026-09-15", project: "micasa", type: "bug", q: "login" });
      assert.deepEqual(listed.days[0]?.entries.map((e) => e.key), ["MIC-B2"]);
    } finally {
      await close();
    }
  });

  test("a bearer is 401 with or without the screen cookie", async () => {
    const withBoth = await get("/api/progress/summary?range=week", { Authorization: `Bearer ${TEST_BEARER}` });
    assert.equal(withBoth.status, 401);
    const bearerOnly = await app.request("/api/progress/log", { headers: { Authorization: `Bearer ${TEST_BEARER}` } });
    assert.equal(bearerOnly.status, 401);
    const item = await app.request("/api/progress/item/filmia/FIL-B", { headers: { Authorization: `Bearer ${TEST_BEARER}`, Cookie: cookie } });
    assert.equal(item.status, 401);
    const none = await app.request("/api/progress/summary?range=day");
    assert.equal(none.status, 401);
    const bad = await get("/api/progress/summary?range=hour");
    assert.equal(bad.status, 400);
  });

  test("year summary stays under 500ms", async () => {
    await raw.query(`
      insert into tasks (project_id, kind, key, title, summary, status, work_type, resolved_at)
      select (select id from projects where slug = 'workia'),
             'ticket',
             'PERF-' || g,
             case when g % 40 = 0 then '[PRUEBA] lote ' || g else 'Cierre de lote ' || g end,
             'resumen de lote',
             'Done',
             case when g % 5 = 0 then 'bug' else 'code' end,
             ((date '2026-01-01' + (g % 300))::timestamp at time zone 'America/Mexico_City')
               + ((g % 18) || ' hours')::interval
      from generate_series(1, 4000) g`);
    await raw.query(`
      insert into pull_requests (project_id, repo, number, url, title, state, merged_at)
      select (select id from projects where slug = 'workia'),
             'example/workia',
             10000 + g,
             'https://example.com/pull/' || g,
             case when g % 50 = 0 then '[PRUEBA] lote ' || g else 'lote ' || g end,
             'merged',
             (date '2026-01-01' + (g % 300))::timestamp at time zone 'America/Mexico_City'
      from generate_series(1, 1500) g`);
    clearProgressCache();
    const { db, close } = makeDb();
    try {
      const t0 = performance.now();
      const summary = await progressSummary(db, { range: "year", date: "2026-06-15" });
      const ms = performance.now() - t0;
      console.log(`progress year summary: ${ms.toFixed(1)} ms, finished=${summary.finished}, days=${summary.year.active_days}`);
      assert.ok(ms < 500, `year summary took ${ms.toFixed(1)} ms`);
      assert.ok(summary.finished > 1000);
      assert.equal(summary.year.highlights.some((h) => h.title.includes("[PRUEBA]")), false);
    } finally {
      await close();
    }
  });
});
