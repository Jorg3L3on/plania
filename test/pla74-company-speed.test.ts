// PLA-74 (F-17): Compañía stayed blank 1–8 s. /api/company reads the projects side by side and says where the time
// went (Server-Timing); /ceo reads the slim /api/projects?for=stream instead of the full 1.3 MB read. Test DB only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { companyRead, serverTiming } = await import("../src/api/company-org.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");

let raw: pg.Client;
const cookie = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}` });
type Json = Record<string, any>;

before(async () => {
  raw = await resetTestDb();
  await seedOrg(makeDb().db);
  const zig = (await raw.query(`select id from projects where slug = 'zigzag'`)).rows[0].id;
  const t = (key: string, kind: string, status: string, extra: Json = {}) =>
    raw.query(`insert into tasks (project_id, key, title, kind, status, stage, promoted_to, summary) values ($1, $2, $3, $4, $5, $6, $7, $8)`, [
      zig, key, `Título ${key}`, kind, status, extra.stage ?? null, extra.promoted_to ?? null, "Un resumen largo que el stream no necesita. ".repeat(20),
    ]);
  await t("ZIG-1", "ticket", "In progress");
  await t("ZIG-2", "ticket", "In review");
  await t("ZIG-3", "ticket", "Done");
  await t("ZIG-4", "ticket", "Released");
  await t("ZIG-5", "ticket", "Won't do");
  await t("ZIG-IDEA1", "idea", "Open", { stage: "design" });
  await t("ZIG-IDEA2", "idea", "Open", { stage: "ready", promoted_to: "ZIG-I1" });
  await t("ZIG-IDEA3", "idea", "Done", { stage: "ready" });
  for (let i = 10; i < 400; i++) await t(`ZIG-${i}`, "ticket", "Done");
});

after(async () => {
  await raw?.end();
});

test("PLA-74 #2: the stream read carries open ideas and open tickets, the counts, and stays small", async () => {
  const full = await app.request("/api/projects", { headers: cookie() });
  const slim = await app.request("/api/projects?for=stream", { headers: cookie() });
  assert.equal(slim.status, 200);
  const fullText = await full.text();
  const text = await slim.text();
  const body = JSON.parse(text) as Json[];
  const zig = body.find((p) => p.slug === "zigzag")!;
  assert.equal(zig.prefix, "ZIG");
  assert.deepEqual(zig.tasks.map((t: Json) => t.key).sort(), ["ZIG-1", "ZIG-2", "ZIG-IDEA1"]);
  assert.deepEqual(Object.keys(zig.tasks[0]).sort(), ["key", "kind", "promoted_to", "stage", "status", "title"]);
  assert.equal(zig.done, 392, "Done, Released and Merged tickets");
  assert.equal(zig.revision, 1);
  assert.ok(text.length * 20 < fullText.length, `slim ${text.length} B vs full ${fullText.length} B`);
});

test("PLA-74 #1: /api/company says where its time went; the read is the same with or without the profile", async () => {
  const res = await app.request("/api/company", { headers: cookie() });
  assert.equal(res.status, 200);
  const st = res.headers.get("server-timing") ?? "";
  assert.match(st, /^total;dur=\d+(, [a-z_]+;dur=\d+){1,8}$/, st);
  const { db } = makeDb();
  const now = new Date("2026-11-18T12:00:00Z");
  const prof = new Map<string, number>();
  const a = await companyRead(db, now, prof);
  const b = await companyRead(db, now);
  assert.deepEqual(a, b);
  assert.ok(prof.has("etapas") && prof.has("decisions") && prof.has("team"), [...prof.keys()].join(","));
  assert.ok(a.projects.length >= 4);
  assert.deepEqual(a.projects.map((p) => p.slug), [...a.projects.map((p) => p.slug)].sort(), "projects stay in slug order");
});

test("PLA-74: serverTiming keeps the total and the eight slowest steps, names only", () => {
  const prof = new Map(Object.entries({ a: 5, b: 50, "c-x": 1, d: 2, e: 3, f: 4, g: 6, h: 7, i: 8, j: 9 }));
  assert.equal(serverTiming(prof, 120.4), "total;dur=120, b;dur=50, j;dur=9, i;dur=8, h;dur=7, g;dur=6, a;dur=5, f;dur=4, e;dur=3");
});

test("PLA-74: the last read is kept, used while young, ignored when old or unreadable, forgotten on sign-out", async () => {
  const lr = (await import(new URL("../ui/src/lib/last-read.ts", import.meta.url).href)) as Record<string, any>;
  const mem = new Map<string, string>();
  const s = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  const T = 1_800_000_000_000;
  lr.keepRead("company", { projects: [1] }, T, s);
  assert.deepEqual(lr.lastRead("company", 60_000, T + 30_000, s), { projects: [1] });
  assert.equal(lr.lastRead("company", 60_000, T + 61_000, s), undefined, "too old");
  assert.equal(lr.lastRead("stream", 60_000, T, s), undefined);
  mem.set("plania.last.stream", "{not json");
  assert.equal(lr.lastRead("stream", 60_000, T, s), undefined);
  assert.equal(lr.lastRead("company", 60_000, T, null), undefined, "no storage");
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => {} };
  assert.equal(lr.lastRead("company", 60_000, T, throwing), undefined);
  lr.keepRead("company", {}, T, throwing);
  lr.forgetReads(s);
  assert.equal(mem.size, 0);
});

test("PLA-74: the stream's lanes and totals read the slim shape (counts, prefix) as well as the full one", async () => {
  const stream = (await import(new URL("../ui/src/lib/corriente-stream.ts", import.meta.url).href)) as Record<string, any>;
  const slim = [{ slug: "zigzag", prefix: "ZIG", done: 392, revision: 1, tasks: [{ key: "ZIG-2", kind: "ticket", title: "t", status: "In review", stage: null, promoted_to: null }] }];
  const p = { work: { open: 3 } };
  assert.deepEqual(stream.totalsOf([p], slim), { revision: 1, open: 3, done: 392 });
  assert.equal(stream.projectOfKey("ZIG-77", slim), "zigzag", "a closed ticket's key finds its project by prefix");
  assert.equal(stream.doneOf({ slug: "a", tasks: [{ key: "A-1", kind: "ticket", status: "Merged" }] }), 1);
});
