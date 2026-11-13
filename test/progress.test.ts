// PLA-I19-1: day buckets in America/Mexico_City, streak, Won't do and [PRUEBA] excluded,
// a reopen counted once, bearer rejected, year summary under 500ms.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { TEST_BEARER, resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

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
let store: TestStore;
const cookie = `${SESSION_COOKIE}=${createSession()}`;
const actor = { agent: "t", session_id: "s" };

const get = async (path: string, headers: Record<string, string> = {}) => {
  const res = await app.request(path, { headers: { Cookie: cookie, ...headers } });
  const body = (await res.json()) as Json;
  return { status: res.status, body };
};

before(async () => {
  store = await resetTestStore();
  clearProgressCache();
  const id = (slug: string) => store.projectId(slug);
  const filmia = await id("filmia");
  const micasa = await id("micasa");
  const taskOf = async (key: string) => (await store.get("tasks", { key }))!;

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
    const parent = row.parent ? (await taskOf(row.parent)).id : null;
    await store.fix((uow) =>
      uow.insert("tasks", {
        projectId: row.project === "micasa" ? micasa : filmia,
        kind: row.kind ?? "ticket",
        key: row.key,
        title: row.title,
        summary: row.summary ?? "",
        status: row.status ?? "Done",
        workType: row.work === undefined ? "code" : row.work,
        resolvedAt: row.at ? new Date(row.at) : null,
        parentId: parent,
        stage: row.stage ?? null,
      }),
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

  const rid = await taskOf("FIL-R");
  await store.fix(async (uow) => {
    for (const at of ["2026-03-09T18:00:00Z", "2026-03-10T18:00:00Z"]) {
      await uow.insert("events", { projectId: rid.projectId, taskId: rid.id, taskKey: "FIL-R", type: "task.status", actor, payload: { from: "In progress", to: "Done" }, createdAt: new Date(at) });
    }
  });

  const bid = (await taskOf("FIL-B")).id;
  const wid = (await taskOf("FIL-W")).id;
  await store.fix(async (uow) => {
    const pr = (number: number, title: string, taskId: string | null, mergedAt: string) =>
      uow.insert("pullRequests", { projectId: filmia, repo: "example/filmia", number, url: `https://example.com/pull/${number}`, title, taskId, state: "merged", mergedAt: new Date(mergedAt) });
    await pr(20, "Arreglo del login", bid, "2026-03-11T05:59:59Z");
    await pr(21, "Día siguiente", null, "2026-03-11T06:00:00Z");
    await pr(22, "[PRUEBA] no cuenta", null, "2026-03-10T18:00:00Z");
    await pr(23, "De un descarte", wid, "2026-03-10T18:00:00Z");
  });

  await task({ project: "filmia", key: "FIL-EMPTY", title: "Sin resumen", summary: "", work: "bug", at: "2026-09-15T18:00:00Z" });
  await task({ project: "filmia", key: "FIL-B2", title: "Login roto en safari", work: "bug", summary: "La sesión aguanta.", at: "2026-09-15T17:00:00Z" });
  await task({ project: "filmia", key: "FIL-C2", title: "Login de la ficha", work: "code", summary: "Entra con el póster.", at: "2026-09-15T16:00:00Z" });
  await task({ project: "filmia", key: "FIL-X", title: "Otra cosa", work: "bug", summary: "Sin la palabra.", at: "2026-09-15T15:00:00Z" });
  await task({ project: "micasa", key: "MIC-B2", title: "Login del panel", work: "bug", summary: "El panel abre.", at: "2026-09-15T14:00:00Z" });
  const empty = await taskOf("FIL-EMPTY");
  await store.fix(async (uow) => {
    await uow.insert("decisions", { projectId: empty.projectId, taskId: empty.id, line: "Se acepta cualquier cliente registrado", actor });
    await uow.insert("results", { taskId: empty.id, kind: "visual", verdict: "pass", cite: "antes y después", url: "https://example.com/after.png", attachments: ["https://example.com/before.png"], actor });
    await uow.insert("results", { taskId: empty.id, kind: "grep", verdict: "pass", cite: "no es imagen", url: "https://example.com/not-visual.png", attachments: [], actor });
    await uow.insert("pullRequests", {
      projectId: filmia, repo: "example/filmia", number: 293, url: "https://example.com/pull/293", title: "Permitir redirect", taskId: empty.id, state: "merged", mergedAt: new Date("2026-09-15T18:00:00Z"),
    });
  });

  const today = dayInTz(new Date());
  const streakDays = [...[0, 1, 2, 3, 4].map((n) => addDays(today, -n)), ...[6, 7, 8, 9, 10, 11, 12].map((n) => addDays(today, -n))];
  for (const [i, day] of streakDays.entries()) {
    await task({ project: "micasa", key: `MIC-S${i}`, title: `Día activo ${i}`, at: `${day}T18:00:00Z` });
  }
  await task({ project: "micasa", key: "MIC-GAP", title: "[PRUEBA] no llena la racha", at: `${addDays(today, -5)}T18:00:00Z` });
});

after(async () => {
  await store?.end();
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
    const workia = await store.projectId("workia");
    // Midnight of 2026-01-01 + n days in Mexico City, which has kept UTC-6 all year since 2022.
    const mxDay = (n: number) => Date.UTC(2026, 0, 1 + n, 6);
    // In chunks of 500, so no one write carries thousands of rows.
    for (let from = 1; from <= 4000; from += 500) {
      await store.fix(async (uow) => {
        for (let g = from; g < from + 500; g++) {
          await uow.insert("tasks", {
            projectId: workia,
            kind: "ticket",
            key: `PERF-${g}`,
            title: g % 40 === 0 ? `[PRUEBA] lote ${g}` : `Cierre de lote ${g}`,
            summary: "resumen de lote",
            status: "Done",
            workType: g % 5 === 0 ? "bug" : "code",
            resolvedAt: new Date(mxDay(g % 300) + (g % 18) * 3_600_000),
          });
        }
      });
    }
    for (let from = 1; from <= 1500; from += 500) {
      await store.fix(async (uow) => {
        for (let g = from; g < from + 500; g++) {
          await uow.insert("pullRequests", {
            projectId: workia,
            repo: "example/workia",
            number: 10000 + g,
            url: `https://example.com/pull/${g}`,
            title: g % 50 === 0 ? `[PRUEBA] lote ${g}` : `lote ${g}`,
            state: "merged",
            mergedAt: new Date(mxDay(g % 300)),
          });
        }
      });
    }
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
