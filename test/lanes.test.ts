// Lane derivation for the redesigned screen (ui/src/lib/lanes.ts). Pure functions, no database.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  LOOSE_LANE_ID,
  branchEdges,
  buildLanes,
  firstLine,
  foldLanes,
  projectProgress,
  statements,
  statusCounts,
  yourTurn,
  type LaneTask,
} from "../ui/src/lib/lanes.js";

let clock = 0;
function t(key: string, status: string, extra: Partial<LaneTask> = {}): LaneTask {
  clock += 1;
  return {
    key,
    kind: "ticket",
    title: key,
    summary: "",
    status,
    priority: "P2",
    parent_key: null,
    blocked_note: null,
    pr_url: null,
    updated_at: `2026-10-0${Math.min(7, 1 + Math.floor(clock / 10))}T00:00:${String(clock % 60).padStart(2, "0")}Z`,
    ...extra,
  };
}
const init = (key: string, status = "Active", extra: Partial<LaneTask> = {}) =>
  t(key, status, { kind: "initiative", priority: null, ...extra });
const keys = (ts: { key: string }[]) => ts.map((x) => x.key);

// Shaped like Filmia on 2026-10-07: two active initiatives and loose tickets.
function filmia(): LaneTask[] {
  return [
    init("FIL-01", "Active", { title: "Catalog split", branch: "jl/catalog-split", base_branch: "sandbox" }),
    t("FIL-01-F4", "Done", { parent_key: "FIL-01" }),
    t("FIL-01-F1", "In review", { parent_key: "FIL-01" }),
    t("FIL-01-F2", "In progress", { parent_key: "FIL-01" }),
    t("FIL-01-F3", "Backlog", { parent_key: "FIL-01" }),
    t("FIL-01-F5", "Backlog", { parent_key: "FIL-01" }),
    init("FIL-07", "Active", { title: "Post-QA octubre" }),
    t("FIL-03", "Ready", { parent_key: "FIL-07" }),
    t("FIL-02", "Backlog", { parent_key: "FIL-07", priority: "P1" }),
    t("FIL-04", "Backlog", { parent_key: "FIL-07" }),
    t("FIL-05", "In review"),
    t("FIL-06", "Backlog", { priority: "P3" }),
  ];
}

describe("buildLanes", () => {
  test("one lane per open initiative plus Sueltos, with the four columns", () => {
    const lanes = buildLanes(filmia());
    assert.deepEqual(lanes.map((l) => l.id), ["FIL-01", "FIL-07", LOOSE_LANE_ID]);

    const [catalog, postQa, loose] = lanes;
    assert.deepEqual(keys(catalog!.done), ["FIL-01-F4"]);
    assert.deepEqual(keys(catalog!.now), ["FIL-01-F2", "FIL-01-F1"], "In progress before In review");
    assert.deepEqual(keys(catalog!.next), ["FIL-01-F3"], "no Ready ticket: the first Backlog one by key");
    assert.deepEqual(keys(catalog!.later), ["FIL-01-F5"]);
    assert.equal(catalog!.state, "moving");

    assert.deepEqual(keys(postQa!.now), []);
    assert.deepEqual(keys(postQa!.next), ["FIL-03"], "Ready wins over Backlog");
    assert.deepEqual(keys(postQa!.later), ["FIL-02", "FIL-04"], "P1 before P2");
    assert.equal(postQa!.state, "waiting");

    assert.equal(loose!.initiative, null);
    assert.deepEqual(keys(loose!.now), ["FIL-05"]);
    assert.deepEqual(keys(loose!.next), ["FIL-06"]);
  });

  test("the initiative line runs done, now, next, later and marks one station as here", () => {
    const catalog = buildLanes(filmia())[0]!;
    assert.deepEqual(keys(catalog.stations.map((s) => s.task)), ["FIL-01-F4", "FIL-01-F2", "FIL-01-F1", "FIL-01-F3", "FIL-01-F5"]);
    assert.deepEqual(catalog.stations.map((s) => s.tone), ["done", "now", "review", "pending", "pending"]);
    assert.deepEqual(catalog.stations.filter((s) => s.here).map((s) => s.task.key), ["FIL-01-F2"]);
    assert.equal(catalog.closed, 1);
    assert.equal(catalog.total, 5);
  });

  test("rows keep their order when only recency changes", () => {
    const a = [init("B-01"), t("B-01-1", "In progress", { parent_key: "B-01", updated_at: "2026-10-01T00:00:00Z" })];
    const b = [init("A-01"), t("A-01-1", "In progress", { parent_key: "A-01", updated_at: "2026-10-09T00:00:00Z" })];
    assert.deepEqual(buildLanes([...a, ...b]).map((l) => l.id), ["A-01", "B-01"]);
    b[1]!.updated_at = "2026-09-01T00:00:00Z";
    assert.deepEqual(buildLanes([...a, ...b]).map((l) => l.id), ["A-01", "B-01"]);
  });

  test("blocked, waiting and paused lanes", () => {
    const lanes = buildLanes([
      init("A-01"),
      t("A-01-1", "Blocked", { parent_key: "A-01", blocked_note: "waiting on bank" }),
      init("B-01"),
      t("B-01-1", "Backlog", { parent_key: "B-01" }),
      init("C-01", "On hold"),
      t("C-01-1", "In progress", { parent_key: "C-01" }),
      init("J-01"),
      t("J-01-1", "Blocked", { parent_key: "J-01", blocked_note: "x" }),
      t("J-01-2", "Needs Jorge", { parent_key: "J-01" }),
    ]);
    const state = Object.fromEntries(lanes.map((l) => [l.id, l.state]));
    assert.deepEqual(state, { "A-01": "blocked", "B-01": "waiting", "C-01": "paused", "J-01": "jorge" });
    const j = lanes.find((l) => l.id === "J-01")!;
    assert.deepEqual(j.now.map((x) => x.key), ["J-01-2", "J-01-1"], "Needs Jorge before Blocked");
    assert.equal(j.stations[0]!.tone, "jorge");
    assert.equal(lanes.find((l) => l.id === "A-01")!.stations[0]!.here, true, "a blocked ticket is still where the lane is");
  });

  test("order: Active and Shipping, then Planning, then On hold; moving lanes, then priority", () => {
    const lanes = buildLanes([
      init("H-01", "On hold"),
      init("P-01", "Planning"),
      init("A-01", "Active"),
      t("A-01-1", "Backlog", { parent_key: "A-01", priority: "P3" }),
      init("S-01", "Shipping"),
      t("S-01-1", "Backlog", { parent_key: "S-01", priority: "P0" }),
      init("M-01", "Active"),
      t("M-01-1", "In progress", { parent_key: "M-01", priority: "P3" }),
    ]);
    assert.deepEqual(lanes.map((l) => l.id), ["M-01", "S-01", "A-01", "P-01", "H-01"]);
    const withJorge = buildLanes([init("W-01"), t("W-01-1", "Ready", { parent_key: "W-01" }), init("X-01"), t("X-01-1", "Needs Jorge", { parent_key: "X-01" })]);
    assert.deepEqual(withJorge.map((l) => l.id), ["X-01", "W-01"], "a lane waiting on Jorge comes before a still one");
  });

  test("closed initiatives get no lane; their open tickets fall into Sueltos; Won't do is hidden", () => {
    const lanes = buildLanes([
      init("D-01", "Done"),
      t("D-01-1", "Ready", { parent_key: "D-01" }),
      t("X-1", "Won't do"),
    ]);
    assert.deepEqual(lanes.map((l) => l.id), [LOOSE_LANE_ID]);
    assert.deepEqual(keys(lanes[0]!.next), ["D-01-1"]);
    assert.equal(lanes[0]!.total, 1);
  });

  test("no Sueltos lane when every loose ticket is closed", () => {
    assert.deepEqual(buildLanes([init("A-01"), t("X-1", "Done")]).map((l) => l.id), ["A-01"]);
    assert.deepEqual(buildLanes([]), []);
  });
});

describe("summaries", () => {
  test("progress and counts ignore initiatives and Won't do", () => {
    const tasks = [...filmia(), t("FIL-99", "Won't do")];
    assert.deepEqual(projectProgress(tasks), { closed: 1, total: 10 });
    assert.deepEqual(projectProgress([...tasks, t("FIL-98", "Needs Jorge")]), { closed: 1, total: 11 });
    assert.deepEqual(statusCounts([...tasks, t("FIL-98", "Needs Jorge")]), { inProgress: 1, inReview: 2, ready: 1, needsJorge: 1, blocked: 0 });
  });

  test("yourTurn lists Needs Jorge tickets, best priority first", () => {
    const items = yourTurn([
      t("A", "Needs Jorge", { title: "¿Aplicar 0009 ya?", priority: "P2" }),
      t("B", "Blocked", { blocked_note: "esperando al banco" }),
      t("C", "Needs Jorge", { title: "¿sandbox → main?", priority: "P1" }),
      init("D", "Active"),
    ]);
    assert.deepEqual(items.map((i) => [i.task.key, i.ask]), [
      ["C", "¿sandbox → main?"],
      ["A", "¿Aplicar 0009 ya?"],
    ]);
  });

  test("foldLanes keeps everything up to four initiatives, then folds stale, still lanes", () => {
    const now = Date.parse("2026-10-20T00:00:00Z");
    const few = buildLanes(filmia());
    assert.deepEqual(foldLanes(few, now).folded, []);

    const many = buildLanes([
      ...["A", "B", "C", "D"].map((k) => init(`${k}-01`, "Active", { updated_at: "2026-10-01T00:00:00Z" })),
      init("E-01", "Active", { updated_at: "2026-10-18T00:00:00Z" }),
      init("F-01", "Active", { updated_at: "2026-10-01T00:00:00Z" }),
      t("F-01-1", "In progress", { parent_key: "F-01", updated_at: "2026-10-01T00:00:00Z" }),
      t("loose", "Ready", { updated_at: "2026-10-01T00:00:00Z" }),
    ]);
    const { visible, folded } = foldLanes(many, now);
    assert.deepEqual(visible.map((l) => l.id).sort(), ["E-01", "F-01", LOOSE_LANE_ID].sort());
    assert.deepEqual(folded.map((l) => l.id).sort(), ["A-01", "B-01", "C-01", "D-01"]);
  });

  test("branchEdges links each open initiative's branches to its base", () => {
    const edges = branchEdges([
      ...filmia(),
      t("FIL-01-F6", "In progress", { parent_key: "FIL-01", branch: "jl/catalog-f6" }),
      init("OLD", "Done", { branch: "jl/old", base_branch: "main" }),
    ]);
    assert.deepEqual(edges, [
      { branch: "jl/catalog-f6", base: "sandbox", lanes: ["Catalog split"] },
      { branch: "jl/catalog-split", base: "sandbox", lanes: ["Catalog split"] },
    ]);
  });

  test("firstLine and statements shorten resume fields", () => {
    assert.equal(firstLine("FIL-01 Catalog split, Active. F4 Done (#121). F1 In review"), "FIL-01 Catalog split, Active");
    assert.equal(firstLine("main (prod); sandbox un commit adelante"), "main (prod)");
    assert.equal(firstLine(""), "");
    assert.deepEqual(statements("Plania es la fuente del plan. 0008 solo después del deploy. «Ya en Filmia» no se muestra."), [
      "Plania es la fuente del plan",
      "0008 solo después del deploy",
      "«Ya en Filmia» no se muestra",
    ]);
    assert.deepEqual(statements("- uno\n- dos"), ["uno", "dos"]);
  });
});
