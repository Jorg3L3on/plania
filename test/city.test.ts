// Inicio's city (ui/src/lib/city.ts): towers per open initiative, windows per ticket. Pure, no database.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addressedToJorge, cityOf, columnsFor, looseInbox, stageLabel, towerLabel, waitingOf, workingCity, type CityProject, type CityTask } from "../ui/src/lib/city.js";
import type { InboxItem } from "../ui/src/lib/types.js";

const init = (key: string, status: string, title = `Iniciativa ${key}`): CityTask => ({ key, kind: "initiative", title, status, parent_key: null });
const ticket = (key: string, parent: string | null, status: string, extra: Partial<CityTask> = {}): CityTask => ({ key, kind: "ticket", title: `Ticket ${key}`, status, parent_key: parent, ...extra });
const agent = (session: string) => ({ claimed_by: { agent: "Claude Code", session_id: session, model: "claude-sonnet-5-5" } });
const item = (id: string, project: string, key: string | null, parent_key: string | null = null, kind: InboxItem["kind"] = "approval"): InboxItem => ({
  id, kind, group: kind === "footprint" ? "limpieza" : kind === "approval" || kind === "question" ? "decisiones" : "pasos", project, key, task_kind: "ticket", parent_key, title: null, why: "porque sí", waiting_since: "2026-10-11T04:00:00Z", wait_s: 60, evidence: null, pr_url: null, action_hint: "",
});

const filmia: CityProject = {
  slug: "filmia",
  title: "Filmia",
  tasks: [
    init("FIL-I6", "Shipping"),
    ticket("FIL-I6-1", "FIL-I6", "Done"),
    ticket("FIL-I6-2", "FIL-I6", "Done"),
    ticket("FIL-I6-5", "FIL-I6", "Blocked"),
    ticket("FIL-I6-9", "FIL-I6", "Won't do"),
    init("FIL-I2", "Active"),
    ticket("FIL-I2-3", "FIL-I2", "Backlog"),
    ticket("FIL-I2-1", "FIL-I2", "Done"),
    init("FIL-I1", "Done"),
    ticket("FIL-12", null, "Ready"),
  ],
  initiatives: [
    { key: "FIL-I6", in_progress: "Fases 1–4 Done.", next_action: "Jorge: llevar sandbox a main y desplegar." },
    { key: "FIL-I2", in_progress: "Solo queda FIL-04.", next_action: "" },
  ],
};
const workia: CityProject = {
  slug: "workia",
  title: "Workia",
  tasks: [
    init("WRK-I3", "Planning"),
    ticket("WRK-I3-2", "WRK-I3", "In progress", agent("s1")),
    ticket("WRK-I3-1", "WRK-I3", "In progress", agent("s1")),
    ticket("WRK-I3-5", "WRK-I3", "Backlog"),
    init("WRK-I10", "Planning"),
    init("WRK-I2", "Active"),
    ticket("WRK-I2-1", "WRK-I2", "In review"),
    ticket("WRK-I2-2", "WRK-I2", "Needs Jorge"),
  ],
  initiatives: [
    { key: "WRK-I3", in_progress: "", next_action: "Jorge to review the plan; T2 and T3 can start first." },
    { key: "WRK-I10", in_progress: "", next_action: "Esperar el OK de Jorge para arrancar." },
    { key: "WRK-I2", in_progress: "", next_action: "" },
  ],
};
const quiet: CityProject = { slug: "micasa", title: "MiCasa", tasks: [init("MIC-I1", "Done"), ticket("MIC-03", null, "Ready")] };

describe("city", () => {
  test("one district per project with open initiatives, slug order, towers in key order", () => {
    const city = cityOf([workia, quiet, filmia], []);
    assert.deepEqual(city.map((d) => d.slug), ["filmia", "workia"]);
    assert.deepEqual(city[0]!.towers.map((t) => t.key), ["FIL-I2", "FIL-I6"]);
    assert.deepEqual(city[1]!.towers.map((t) => t.key), ["WRK-I2", "WRK-I3", "WRK-I10"]);
  });

  test("windows are tickets bottom-up, finished first; Won't do and loose tickets stay out", () => {
    const [fil] = cityOf([filmia], []);
    const i6 = fil!.towers.find((t) => t.key === "FIL-I6")!;
    assert.deepEqual(i6.windows, ["lit", "lit", "blocked"]);
    assert.equal(i6.closed, 2);
    assert.equal(i6.total, 3);
    assert.equal(i6.stage, "shipping");
    assert.equal(stageLabel(i6), "Estreno · 2/3");
    const wrk = cityOf([workia], [])[0]!;
    assert.deepEqual(wrk.towers.find((t) => t.key === "WRK-I2")!.windows, ["review", "jorge"]);
  });

  test("a crane counts the live claims under the initiative", () => {
    const i3 = cityOf([workia], [])[0]!.towers.find((t) => t.key === "WRK-I3")!;
    assert.deepEqual(i3.agents.map((a) => a.key), ["WRK-I3-1", "WRK-I3-2"]);
    assert.equal(i3.agents[0]!.model, "claude-sonnet-5-5");
  });

  test("waits on Jorge: a next step addressed to him with nobody working, a ticket in Needs Jorge, or an inbox item under it", () => {
    const [fil] = cityOf([filmia], []);
    assert.equal(fil!.towers.find((t) => t.key === "FIL-I6")!.waits, true);
    assert.equal(fil!.towers.find((t) => t.key === "FIL-I2")!.waits, false);
    const wrk = cityOf([workia], [])[0]!;
    // Agents are on it, so the plan review is not what holds it.
    assert.equal(wrk.towers.find((t) => t.key === "WRK-I3")!.waits, false);
    assert.equal(wrk.towers.find((t) => t.key === "WRK-I10")!.waits, true);
    assert.equal(wrk.towers.find((t) => t.key === "WRK-I2")!.waits, true);
    // Only a plan nobody has started waits for a go; one with work in review waits for a review.
    assert.equal(wrk.towers.find((t) => t.key === "WRK-I10")!.awaitsGo, true);
    assert.equal(wrk.towers.find((t) => t.key === "WRK-I3")!.awaitsGo, false);
    const reviewed = cityOf([{ ...workia, tasks: [init("WRK-I2", "Planning"), ticket("WRK-I2-1", "WRK-I2", "In review")], initiatives: [{ key: "WRK-I2", in_progress: "", next_action: "Jorge to review PR #45." }] }], [])[0]!;
    assert.equal(reviewed.towers[0]!.waits, true);
    assert.equal(reviewed.towers[0]!.awaitsGo, false);
    // An approval on one of its tickets lights the searchlight too.
    const withItem = cityOf([filmia], [item("a1", "filmia", "FIL-I2-3", "FIL-I2")])[0]!;
    const i2 = withItem.towers.find((t) => t.key === "FIL-I2")!;
    assert.equal(i2.waits, true);
    assert.deepEqual(i2.inbox.map((i) => i.id), ["a1"]);
  });

  test("an idea is not a tower and not a window", () => {
    const withIdea: CityProject = { ...filmia, tasks: [...filmia.tasks, { key: "FIL-IDEA1", kind: "idea", title: "Una idea", status: "Open", parent_key: "FIL-I2" }] };
    const [plain] = cityOf([filmia], []);
    const [extra] = cityOf([withIdea], []);
    assert.deepEqual(extra!.towers.map((t) => t.key), plain!.towers.map((t) => t.key));
    assert.deepEqual(
      extra!.towers.map((t) => t.total),
      plain!.towers.map((t) => t.total),
    );
  });

  test("the note is the next step, else what it is doing", () => {
    const [fil] = cityOf([filmia], []);
    assert.equal(fil!.towers.find((t) => t.key === "FIL-I6")!.note, "Jorge: llevar sandbox a main y desplegar.");
    assert.equal(fil!.towers.find((t) => t.key === "FIL-I2")!.note, "Solo queda FIL-04.");
  });

  test("inbox items outside every tower stay loose", () => {
    const inbox = [item("a1", "filmia", "FIL-I6-5", "FIL-I6"), item("a2", "filmia", "FIL-12"), item("q1", "zigzag", "ZIG-01", null, "question")];
    const city = cityOf([filmia], inbox);
    assert.deepEqual(looseInbox(city, inbox).map((i) => i.id), ["a2", "q1"]);
  });


  test("what waits on Jorge counts the inbox and every tower with a ticket in Needs Jorge outside it", () => {
    const inbox = [item("a1", "filmia", "FIL-I6-5", "FIL-I6"), item("q1", "zigzag", "ZIG-01", null, "question")];
    const city = cityOf([filmia, workia], inbox);
    // FIL-I6 counts once (its approval); WRK-I2 has a ticket in Needs Jorge. WRK-I10's note only names him: not counted.
    assert.deepEqual(waitingOf(city, inbox), { count: 3, by_project: { filmia: 1, zigzag: 1, workia: 1 } });
    assert.deepEqual(waitingOf([], []), { count: 0, by_project: {} });
  });

  test("the skyline keeps only towers with a ticket En curso or En revisión", () => {
    const city = workingCity(cityOf([filmia, workia], []));
    assert.deepEqual(city.map((d) => d.slug), ["workia"]);
    assert.deepEqual(city[0]!.towers.map((t) => t.key), ["WRK-I2", "WRK-I3"]);
    const inbox = [item("a1", "filmia", "FIL-I6-5", "FIL-I6")];
    assert.deepEqual(looseInbox(workingCity(cityOf([filmia], inbox)), inbox).map((i) => i.id), ["a1"]);
  });

  test("long initiatives get wider towers, not taller ones", () => {
    assert.equal(columnsFor(0), 2);
    assert.equal(columnsFor(20), 2);
    assert.equal(columnsFor(21), 3);
    assert.equal(columnsFor(46), 4);
  });

  test("words", () => {
    assert.ok(addressedToJorge("Jorge: crear el cliente OAuth"));
    assert.ok(addressedToJorge("Esperar el OK de Jorge para arrancar"));
    assert.ok(!addressedToJorge("Phase 1 first."));
    assert.ok(addressedToJorge("Jorge releases sandbox → main; then the MIC-I1-4 device check on prod"));
    assert.ok(addressedToJorge("PR 45 merged into sandbox. Awaiting Jorge's approval to close the tickets"));
    assert.ok(addressedToJorge("Q1–Q3 answered (pinned decision). Jorge: say go to move ZIG-I18 to Active."));
    assert.ok(!addressedToJorge("Get CI green on #576, record results per phase, then Jorge merges into sandbox"));
    assert.ok(!addressedToJorge("WRK-I2-3 skipped by Jorge. Migrations apply on release."));
    const i3 = cityOf([workia], [])[0]!.towers.find((t) => t.key === "WRK-I3")!;
    assert.equal(towerLabel(i3, "Workia"), "WRK-I3, Iniciativa WRK-I3, Workia, planeando, 0 de 3 hechos, 2 agentes trabajan");
  });
});
