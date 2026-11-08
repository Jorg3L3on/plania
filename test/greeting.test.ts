// PLA-09: /ceo greeting by the hour in the dashboard timezone (ui/src/lib/greeting.ts). Pure, no database.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dayPart, greeting, hourIn } from "../ui/src/lib/greeting.js";

describe("dayPart", () => {
  test("05-11 morning, 12-18 afternoon, the rest night", () => {
    const parts = Array.from({ length: 24 }, (_, hour) => dayPart(hour));
    assert.deepEqual(parts.slice(0, 5), Array(5).fill("night"));
    assert.deepEqual(parts.slice(5, 12), Array(7).fill("morning"));
    assert.deepEqual(parts.slice(12, 19), Array(7).fill("afternoon"));
    assert.deepEqual(parts.slice(19), Array(5).fill("night"));
  });
});

describe("greeting", () => {
  const tz = "America/Mexico_City"; // UTC-6 in November
  test("23:00 local is Buenas noches without «mientras dormías»", () => {
    const now = new Date("2026-11-08T05:00:00Z");
    assert.equal(hourIn(tz, now), 23);
    assert.deepEqual(greeting(tz, now), { hello: "Buenas noches", subtitle: "la compañía hoy" });
  });
  test("08:00 local is Buenos días, mientras dormías", () => {
    assert.deepEqual(greeting(tz, new Date("2026-11-08T14:00:00Z")), { hello: "Buenos días", subtitle: "la compañía mientras dormías" });
  });
  test("15:00 local is Buenas tardes", () => {
    assert.deepEqual(greeting(tz, new Date("2026-11-08T21:00:00Z")), { hello: "Buenas tardes", subtitle: "la compañía hoy" });
  });
  test("midnight reads as hour 0, not 24", () => {
    assert.equal(hourIn(tz, new Date("2026-11-08T06:00:00Z")), 0);
  });
});
