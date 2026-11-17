// PLA-I41-1: the Morning brief tables. Writes and reads each of the five tables through the store on a throwaway test
// store. Main's checks on the migration (0045 applied again, its check constraints, the foreign-key cascade) were
// Postgres's and are gone with it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();

let store: TestStore;

before(async () => {
  store = await resetTestStore();
});

after(async () => {
  await store.end();
});

test("brief_runs and morning_briefs: write and read", async () => {
  const run = await store.fix((uow) =>
    uow.insert("briefRuns", { trigger: "schedule", status: "running", passes: { brief: { status: "ok", turns: 4, tokens: 1200, log_file: "brief-a.log" } } }),
  );
  assert.equal(run.summary, "");
  assert.ok(run.startedAt instanceof Date);
  assert.equal(run.endedAt, null);

  await store.fix((uow) => uow.update("briefRuns", { id: run.id }, { status: "ok", endedAt: new Date(), summary: "2 passes ok" }));
  const readRun = (await store.get("briefRuns", { id: run.id }))!;
  assert.equal(readRun.status, "ok");
  assert.equal(readRun.passes.brief?.log_file, "brief-a.log");

  const data = { version: 1, mode: "full", items: [], ideas: [{ id: "d|workia|abc", code: "W1" }] };
  await store.fix(async (uow) => {
    await uow.insert("morningBriefs", { localDate: "2026-11-13", trigger: "schedule", mode: "full", data, runId: run.id, generatedAt: new Date("2026-11-13T13:04:00Z") });
    await uow.insert("morningBriefs", { localDate: "2026-11-13", trigger: "manual", mode: "partial", data, generatedAt: new Date("2026-11-13T15:00:00Z") });
  });
  const rows = await store.find("morningBriefs", { localDate: "2026-11-13" });
  assert.equal(rows.length, 2, "several briefs a day are fine");
  const sched = rows.find((r) => r.trigger === "schedule")!;
  assert.equal(sched.runId, run.id);
  assert.deepEqual(sched.data, data);
});

test("brief_plan_requests: write and read", async () => {
  const brief = await store.fix((uow) => uow.insert("morningBriefs", { localDate: "2026-11-14", trigger: "cli", mode: "facts_only", data: {} }));
  const req = await store.fix((uow) =>
    uow.insert("briefPlanRequests", {
      briefId: brief.id,
      codes: ["W1", "Z3", "X1"],
      ideas: [{ code: "W1", app: "workia", title: "T", why: "W" }],
      targets: [{ slug: "workia", po_agent: "po-workia", codes: ["W1"], state: "queued", results: [] }],
    }),
  );
  assert.equal(req.status, "open");
  const read = (await store.get("briefPlanRequests", { id: req.id }))!;
  assert.deepEqual(read.codes, ["W1", "Z3", "X1"]);
  assert.equal(read.targets[0]?.state, "queued");
});

test("brief_checks: check, read, uncheck", async () => {
  await store.fix(async (uow) => {
    await uow.insert("briefChecks", { itemId: "i|workia|0123456789ab" });
    await uow.insert("briefChecks", { itemId: "d|cross|ba9876543210" });
  });
  const rows = await store.find("briefChecks");
  assert.deepEqual(rows.map((r) => r.itemId).sort(), ["d|cross|ba9876543210", "i|workia|0123456789ab"]);
  assert.ok(rows[0]?.checkedAt instanceof Date);
  await assert.rejects(
    store.fix((uow) => uow.insert("briefChecks", { itemId: "i|workia|0123456789ab" })),
    (e: { code?: string }) => e.code === "23505",
  );
  await store.fix((uow) => uow.delete("briefChecks", { itemId: "i|workia|0123456789ab" }));
  assert.equal(await store.count("briefChecks"), 1);
});

test("brief_settings: one row with the spec defaults, fallback_at 11:00", async () => {
  const s = await store.fix((uow) => uow.insert("briefSettings", {}));
  assert.equal(s.id, 1);
  assert.equal(s.enabled, true);
  assert.equal(s.runAt, "07:00");
  assert.equal(s.fallbackAt, "11:00");
  assert.equal(s.language, "es", "PLA-I51-1: Spanish by default");
  assert.deepEqual(s.hiddenRefs, []);
  assert.equal(s.maxItemsPerApp, 5);
  assert.equal(s.ideasPerProject, 3);
  assert.equal(s.ideasEnabled, true);
  assert.deepEqual(s.passTimeouts, { brief: 10, ideas: 20, plan: 30 });
  assert.deepEqual(s.projects, {});
  assert.equal(s.githubMode, "poller");
  assert.equal(s.timezone, null);

  await store.fix((uow) =>
    uow.update("briefSettings", { id: 1 }, { fallbackAt: "12:00", language: "es", hiddenRefs: ["MIC-99"], projects: { micasa: { include: true, letter: "C", order: 1 } } }),
  );
  const [read] = await store.find("briefSettings");
  assert.equal(read!.fallbackAt, "12:00");
  assert.equal(read!.language, "es");
  assert.deepEqual(read!.hiddenRefs, ["MIC-99"]);
  assert.equal(read!.projects.micasa?.letter, "C");
  // Row 1 is the only row: a second insert of it is refused.
  await assert.rejects(
    store.fix((uow) => uow.insert("briefSettings", { id: 1 })),
    (e: { code?: string }) => e.code === "23505",
  );
});

// PLA-I49-2: BriefData v2 (targets) and the pass A item's `about`.
test("BriefData: v1 parses without targets, v2 with them; a bad target is refused", async () => {
  const { BriefData, BriefPassOutput, HANDLE } = await import("../src/brief/types.js");
  const v1 = JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8"));
  assert.ok(BriefData.safeParse(v1).success, "the stored v1 sample");
  const v2 = structuredClone(v1);
  v2.version = 2;
  v2.items[0].targets = [{ kind: "step", project: "filmia", key: "FIL-I50-6", id: "b-1" }, { kind: "pr", project: "filmia", pr: 238 }];
  assert.ok(BriefData.safeParse(v2).success);
  v2.items[0].targets = [{ kind: "spaceship", project: "filmia" }];
  assert.equal(BriefData.safeParse(v2).success, false);
  v2.items[0].targets = Array.from({ length: 5 }, () => ({ kind: "runs", project: "filmia" }));
  assert.equal(BriefData.safeParse(v2).success, false, "at most 4");
  v2.version = 3;
  v2.items[0].targets = undefined;
  assert.equal(BriefData.safeParse(v2).success, false);

  const out = BriefPassOutput.parse({ items: [{ app: "workia", status: "next", title: "x", about: ["t:WRK-1", "made up!"], targets: [{ kind: "runs", project: "x" }] }] });
  assert.deepEqual(out.items[0]!.about, ["t:WRK-1", "made up!"], "about is loose here; the merge checks it");
  assert.equal("targets" in out.items[0]!, false, "Claude cannot send targets");
  for (const h of ["q:3f0c", "b:9", "rel:workia", "pr:workia#50", "t:WRK-1", "i:WRK-I14", "idea:WRK-IDEA3", "runs:workia", "env:workia/prod", "f:workia/STALE_NOTE/-"]) assert.match(h, HANDLE, h);
});

test("brief.schema.json: items may carry about, up to 4 strings", () => {
  const schema = JSON.parse(readFileSync(new URL("../prompts/morning-brief/brief.schema.json", import.meta.url), "utf8"));
  const about = schema.properties.items.items.properties.about;
  assert.equal(about.type, "array");
  assert.equal(about.maxItems, 4);
});
