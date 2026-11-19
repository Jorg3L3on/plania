// NEWPROJ-5: La corriente's company read refreshes on a live change, once per burst. Found in the browser walk
// of 2026-11-18: a step whose run could not start kept saying «arranca sola» until the page's 20 s poll.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { coalesce } = (await import(new URL("../ui/src/lib/coalesce.ts", import.meta.url).href)) as typeof import("../ui/src/lib/coalesce.js");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("NEWPROJ-5: a burst of calls runs once; a later call runs again", async () => {
  let runs = 0;
  const refresh = coalesce(() => void (runs += 1), 30);
  for (let i = 0; i < 20; i++) refresh();
  assert.equal(runs, 0, "nothing runs inside the burst");
  await wait(80);
  assert.equal(runs, 1, "the burst cost one run");
  refresh();
  await wait(80);
  assert.equal(runs, 2);
});

test("NEWPROJ-5: cancel drops a pending run", async () => {
  let runs = 0;
  const refresh = coalesce(() => void (runs += 1), 30);
  refresh();
  refresh.cancel();
  await wait(80);
  assert.equal(runs, 0);
});

test("NEWPROJ-5: the live stream refreshes the company query on a change", () => {
  const src = readFileSync(new URL("../ui/src/lib/live.tsx", import.meta.url), "utf8");
  assert.match(src, /coalesce\(\(\) => void queryClient\.invalidateQueries\(\{ queryKey: \["company"\] \}\)/);
  const handler = src.slice(src.indexOf('addEventListener("change"'), src.indexOf("source.onerror"));
  assert.match(handler, /refreshCompany\(\);/, "the change handler asks for it");
  assert.match(src, /refreshCompany\.cancel\(\);/, "and the effect's cleanup drops a pending one");
});
