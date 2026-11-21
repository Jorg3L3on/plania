// PLA-130: Historial folds three or more close Estilo or Voz versions into one row; current and kept ones stand alone.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runs, type Entry } from "../ui/src/lib/historial.js";

const st = (v: number, min: number, o: { current?: boolean; keep?: boolean } = {}): Entry => ({ lane: "estilo", id: `estilo-${v}`, at: new Date(Date.parse("2026-11-20T18:00:00Z") - min * 60_000).toISOString(), current: !!o.current, keep: o.keep, v, style: {} as never });

test("close versions fold; current, kept and far-apart ones stand alone; short runs stay rows", () => {
  const list = [st(9, 0, { current: true }), st(8, 2), st(7, 4), st(6, 5), st(5, 7, { keep: true }), st(4, 9), st(3, 11), st(2, 200), st(1, 203)];
  const out = runs(list);
  assert.deepEqual(out.map((x) => ("run" in x ? `run:${x.items.map((e) => e.id.split("-")[1]).join("")}` : x.id.split("-")[1])), ["9", "run:876", "5", "4", "3", "2", "1"]);
  const r = out[1] as Extract<(typeof out)[number], { run: true }>;
  assert.equal(r.lane, "estilo");
  assert.ok(r.from < r.to, "from the oldest to the newest");
});

test("Trato changes list under the Estilo filter, since «Cómo trata a la gente» lives in Estilo", async () => {
  const { entries } = await import("../ui/src/lib/historial.js");
  const h = { logo: [], requests: [], style: [{ v: 1, at: "2026-11-20T10:00:00Z", current: true, style: {} as never }], voice: [{ v: 1, at: "2026-11-20T11:00:00Z", current: true, voice: { trato: "usted" } as never }] };
  assert.deepEqual(entries(h as never, "estilo").map((e) => e.lane), ["voz", "estilo"]);
  assert.deepEqual(entries(h as never, "logo"), []);
});
