// PLA-I36 phase 2: Compañía gives each project a destination. Rumbo (PLA-I36-4): the goal sentence, its delivery
// date and the forecast, or "Sin meta ni fecha · Fijar". Position by calendar (PLA-I36-5): one bar with today and
// the work done; no week bar without a date. Throwaway DB for the payload, server-rendered UI with fake data.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const { calendarOf, forecastOf } = await import("../src/api/company-plan.js");
const { rumboOf } = await import("../src/api/company-org.js");

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const v2 = await load("components/compania/v2.tsx");
const lib = await load("lib/v2.ts");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const card = async (slug: string): Promise<Json> => {
  const res = await app.request("/api/company", { headers: jorge() });
  return ((await res.json()) as Json).projects.find((p: Json) => p.slug === slug);
};
const PO = (slug: string) => ({ actor: { agent: `po-${slug}`, session_id: `s-po-${slug}` } });
const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(MemoryRouter, null, el));
const NOW = new Date("2026-11-10T18:00:00Z").getTime();

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

// ---- PLA-I36-4 (server)

test("I36-4 #2: the seeded placeholder goal is Sin meta ni fecha (missing)", async () => {
  await raw.query(`insert into goals (project_id, title, why) select id, 'Avance del producto (workia)', 'El producto avanza con un rumbo claro.' from projects where slug = 'workia'`);
  const w = await card("workia");
  assert.equal(w.rumbo.missing, true);
  assert.equal(w.rumbo.goal, null, "the placeholder is not shown as a goal");
  assert.ok(w.rumbo.goal_id, "but Fijar edits it");
  assert.equal((await card("filmia")).rumbo.missing, true, "no goal at all");
});

test("I36-4 #1, #3: Fijar saves a sentence and a date; the card shows both and the forecast", async () => {
  const id = (await card("workia")).rumbo.goal_id as string;
  const res = await app.request(`/api/goals/${id}`, { method: "PATCH", headers: jorge(), body: JSON.stringify({ title: "Tienda en línea con pagos", target_on: "2026-12-20" }) });
  assert.equal(res.status, 200, await res.clone().text());
  const w = await card("workia");
  assert.equal(w.rumbo.missing, false);
  assert.deepEqual([w.rumbo.goal, w.rumbo.target_on], ["Tienda en línea con pagos", "2026-12-20"]);
  assert.equal(w.goal, "Tienda en línea con pagos");
  assert.equal(w.rumbo.forecast_on, null, "no Active initiative, no forecast yet");
  // A sentence with no date is still missing.
  assert.equal(rumboOf({ id: "g", title: "Algo real", why: "", target_on: null }, null).missing, true);
});

// ---- PLA-I36-5 (server)

test("I36-5 #2, #3: forty initiatives and no dates never read as week 40: the active one and its tickets, no bar", async () => {
  for (let i = 1; i <= 40; i++) await writes.createTask(db, { project: "micasa", kind: "initiative", key: `MIC-I${i}`, title: `Iniciativa ${i}`, scope: "s" } as never, PO("micasa"));
  await raw.query(`update tasks set status = 'Done' where kind = 'initiative' and key in (${Array.from({ length: 39 }, (_, i) => `'MIC-I${i + 1}'`).join(",")})`);
  await raw.query(`update tasks set status = 'Active' where key = 'MIC-I40'`);
  await writes.createTask(db, { project: "micasa", key: "MIC-I40-1", parent_key: "MIC-I40", title: "Uno", scope: "s", checks: ["c"] } as never, PO("micasa"));
  await writes.createTask(db, { project: "micasa", key: "MIC-I40-2", parent_key: "MIC-I40", title: "Dos", scope: "s", checks: ["c"] } as never, PO("micasa"));
  await raw.query(`update tasks set status = 'Done' where key = 'MIC-I40-1'`);
  const m = await card("micasa");
  assert.deepEqual([m.plan.initiative.key, m.plan.done, m.plan.total], ["MIC-I40", 1, 2]);
  assert.deepEqual([m.plan.weeks, m.plan.today_pct, m.plan.pace], [null, null, null]);
  assert.equal(JSON.stringify(m.plan).includes("40,"), false);
  assert.equal("week" in m.plan, false);
});

test("I36-5 #1: a dated plan behind: today's mark ahead of the fill, weeks behind, and the forecast in Rumbo", async () => {
  await raw.query(`update tasks set created_at = now() - interval '28 days' where key = 'MIC-I40'`);
  await raw.query(`insert into goals (project_id, title, target_on) select id, 'Pagos en línea', current_date + 28 from projects where slug = 'micasa'`);
  const m = await card("micasa");
  assert.equal(m.plan.weeks, 8);
  assert.equal(m.plan.today_pct, 50);
  assert.equal(m.plan.done_pct, 50);
  assert.equal(m.plan.pace, "ok");
  await raw.query(`update tasks set status = 'Ready' where key = 'MIC-I40-1'`);
  const late = await card("micasa");
  assert.ok(late.plan.today_pct > late.plan.done_pct, "today ahead of the fill");
  assert.equal(late.plan.weeks_behind, 4);
  assert.equal(late.plan.pace, "bad");
  assert.equal(late.rumbo.forecast_on, forecastOf(late.rumbo.target_on, 4));
  assert.equal(late.light, "paused", "new projects start paused; the light is not the point here");
});

test("I36-5 #4: the forecast is delivery plus the weeks behind (pure)", () => {
  const c = calendarOf({ startOn: "2026-11-01", dueOn: "2026-12-27", today: new Date("2026-11-29T12:00:00Z"), done: 1, total: 4 });
  assert.equal(c.weeks, 8);
  assert.deepEqual([c.today_pct, c.done_pct], [50, 25]);
  assert.equal(c.weeks_behind, 2);
  assert.equal(c.forecast_on, "2027-01-10");
  assert.equal(forecastOf("2026-12-27", 2), "2027-01-10");
  const ahead = calendarOf({ startOn: "2026-11-01", dueOn: "2026-12-27", today: new Date("2026-11-29T12:00:00Z"), done: 3, total: 4 });
  assert.deepEqual([ahead.weeks_behind, ahead.pace, ahead.forecast_on], [0, "ok", "2026-12-27"]);
});

// ---- the card (UI)

const project = (patch: Record<string, unknown> = {}) => ({
  slug: "workia",
  title: "Workia",
  paused: false,
  light: "ok",
  light_reason: null,
  goal: null,
  rumbo: { goal_id: "g1", goal: null, why: "", target_on: null, forecast_on: null, weeks_behind: null, missing: true },
  budget: { used: 100_000, limit: 5_000_000, pct: 2, state: "ok", reason: null },
  team: [],
  thread: { id: "t", unread: 0, last: null },
  plan: null,
  this_week: { done: 0, docs: 0, prs: 0, last_at: "2026-11-10T17:00:00Z" },
  next: null,
  work: { open: 0, in_progress: 0 },
  orders: [],
  ...patch,
});
const render = (p: Json, onFijar: unknown = () => {}) => html(h(v2.ProjectReport, { project: p, decisions: [], now: NOW, companyPaused: false, onFijar }));

test("I36-4 #1 (UI): Rumbo opens the card with the goal, Entrega and the forecast", () => {
  const out = render(project({ rumbo: { goal_id: "g1", goal: "Tienda en línea con pagos", why: "", target_on: "2026-12-20", forecast_on: "2027-01-03", weeks_behind: 2, missing: false } }));
  assert.ok(out.includes('data-rumbo="set"') && out.includes("Tienda en línea con pagos") && out.includes("Entrega 20 dic"));
  assert.ok(out.includes("pronóstico 3 ene") && out.includes("text-ink-blocked"));
  assert.ok(out.indexOf("data-rumbo") < out.indexOf("data-this-week"), "Rumbo is the first block");
});

test("I36-4 #2, #3 (UI): the placeholder shows Sin meta ni fecha and Fijar; the page opens the goal dialog in place", async () => {
  const out = render(project());
  assert.ok(out.includes('data-rumbo="missing"') && out.includes("Sin meta ni fecha") && out.includes('data-control="fijar"'));
  assert.ok(out.includes("text-ink-now"), "amber");
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("<GoalDialog") && page.includes('invalidateQueries({ queryKey: ["company"] })'));
  const dialog = readFileSync(new URL("../ui/src/components/goals/goal-dialog.tsx", import.meta.url), "utf8");
  assert.ok(dialog.includes('type="date"'), "the dialog has the date field");
});

test("I36-4 #4 (UI): a long goal wraps to three lines at most, the full text in a title", () => {
  const long = "Una meta muy larga ".repeat(20).trim();
  const out = render(project({ rumbo: { goal_id: "g1", goal: long, why: "", target_on: "2026-12-20", forecast_on: null, weeks_behind: null, missing: false } }));
  const tag = /<p class="([^"]*)" title="([^"]*)" data-goal/.exec(out)!;
  assert.ok(tag[1]!.includes("line-clamp-3") && tag[1]!.includes("break-words"));
  assert.equal(tag[2], long);
});

test("I36-5 #1, #2 (UI): a dated plan draws one bar with today and the fill and says the gap; undated draws no bar", () => {
  const dated = { initiative: { key: "X-I1", title: "Pagos" }, done: 1, total: 4, start_on: "2026-11-01", due_on: "2026-12-27", weeks: 8, today_pct: 50, done_pct: 25, pace: "bad", weeks_behind: 2, forecast_on: "2027-01-10" };
  const out = render(project({ plan: dated }));
  assert.ok(out.includes('data-plan="calendar"') && out.includes('data-today="50"') && out.includes('data-fill="25"'));
  assert.ok(out.includes("Hoy va al 50% del tiempo y la obra al 25%: 2 semanas atrás"));
  const undated = render(project({ plan: { ...dated, start_on: null, due_on: null, weeks: null, today_pct: null, done_pct: null, pace: null, weeks_behind: null, forecast_on: null } }));
  assert.ok(undated.includes('data-plan="initiative"') && undated.includes("Pagos") && undated.includes("1 de 4 hechos"));
  assert.equal(undated.includes("data-today"), false);
  assert.equal(/Semana \d+ de/.test(undated), false);
  assert.equal(lib.calendarBar({ ...dated, weeks: null }), null);
});
