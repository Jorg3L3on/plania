// PLA-144: an old plan reading never reads as the current five-hour figure, and the screen says how old it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planView, readingStale } from "../src/runner/limits.js";

const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const { planReadLine } = await load("lib/motores.ts");
const { MOTORES } = await load("lib/motores-words.ts");

const now = new Date("2026-11-21T21:45:00Z");
const reading = (over: Record<string, unknown> = {}) =>
  ({
    id: "r",
    at: new Date("2026-11-21T08:03:24Z"),
    source: "stream",
    status: "allowed_warning",
    fiveHourPct: 83,
    sevenDayPct: 62,
    fiveHourResetsAt: new Date("2026-11-21T10:40:00Z"),
    sevenDayResetsAt: new Date("2026-11-26T18:00:00Z"),
    overageStatus: "rejected",
    runId: null,
    ...over,
  }) as never;

test("a reading whose five-hour reset has passed shows no percentage, with or without the override", () => {
  assert.equal(readingStale(reading(), now), true);
  for (const override of [false, true]) {
    const v = planView(reading(), 70, now, override);
    assert.equal(v.five_hour_pct, null);
    assert.equal(v.seven_day_pct, 62, "the week has not reset, so its figure stays");
    assert.equal(v.read_at, "2026-11-21T08:03:24.000Z");
  }
  assert.equal(planView(reading(), 70, now, false).state, "unknown");
});

test("a fresh reading is shown as it is", () => {
  const fresh = reading({ at: new Date("2026-11-21T21:40:00Z"), fiveHourResetsAt: new Date("2026-11-21T22:50:00Z"), status: null, fiveHourPct: 51 });
  assert.equal(readingStale(fresh, now), false);
  assert.equal(planView(fresh, 70, now, true).five_hour_pct, 51);
});

test("a reading with no reset time goes stale after its TTL", () => {
  const r = reading({ at: new Date("2026-11-21T20:00:00Z"), fiveHourResetsAt: null, status: null });
  assert.equal(readingStale(r, now), true);
  assert.equal(readingStale(null, now), true);
});

test("the line under the meter says how old the reading is", () => {
  const w = MOTORES.es;
  assert.equal(planReadLine({ pct: 51, read_at: "2026-11-21T21:42:00Z" }, now.getTime(), w), "Leído hace 3 min.");
  assert.match(planReadLine({ pct: null, read_at: "2026-11-21T08:03:24Z" }, now.getTime(), w), /^Sin lectura reciente: la última es de hace 14 h/);
  assert.equal(planReadLine({ pct: null, read_at: null }, now.getTime(), w), "Todavía no hay lectura. Plania pide una.");
});
