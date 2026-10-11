// Inicio's model (ui/src/lib/home.ts): the headline sentence, flights, what comes next and the tiles. Pure, no database.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { doneToday, envLine, flightsOf, headlineOf, joinNames, liveServersOf, nextLine, numberWord, tileOf, type HomeProject, type HomeTask } from "../ui/src/lib/home.js";

const NOW = new Date("2026-10-11T05:02:00Z").getTime();

function ticket(key: string, status: string, extra: Partial<HomeTask> = {}): HomeTask {
  return { key, kind: "ticket", title: `Título de ${key}`, summary: "", status, priority: "P2", parent_key: null, blocked_note: null, pr_url: null, updated_at: "2026-10-11T04:00:00Z", ...extra };
}
function project(slug: string, title: string, extra: Partial<HomeProject> = {}): HomeProject {
  return { slug, title, line: "Sin ficha.", tasks: [], next_claimable: null, envs: [], activity: [0, 0, 0, 0, 0, 0, 0], ...extra };
}
const claim = (key: string, session: string, model = "claude-opus-5-5") =>
  ticket(key, "In progress", { claimed_by: { agent: "Claude Code", session_id: session, model }, claimed_at: "2026-10-11T04:20:00Z", last_seen_at: "2026-10-11T05:01:00Z", branch: "slice/x" });
const server = (task_key: string | null, session_id: string | null, port: number, project: string | null = "zigzag") =>
  ({ kind: "server", state: "live", task_key, session_id, project, repo: project, locator: `port:${port}`, details: { port }, first_seen_at: "2026-10-10T20:00:00Z" }) as const;

describe("words", () => {
  test("numbers become words up to nine; names join with y", () => {
    assert.equal(numberWord(0), "Ningún");
    assert.equal(numberWord(2), "Dos");
    assert.equal(numberWord(12), "12");
    assert.equal(joinNames([]), "");
    assert.equal(joinNames(["Filmia"]), "Filmia");
    assert.equal(joinNames(["Zigzag", "Filmia"]), "Zigzag y Filmia");
    assert.equal(joinNames(["A", "B", "C"]), "A, B y C");
  });
});

describe("flightsOf", () => {
  test("one flight per live claim, newest first, with the server that belongs to the ticket or the session", () => {
    const zig = project("zigzag", "Zigzag", { tasks: [claim("ZIG-I12-6", "s1"), ticket("ZIG-I12-5", "Done")] });
    const fil = project("filmia", "Filmia", { tasks: [claim("FIL-12", "s2", "claude-sonnet-5-5")] });
    fil.tasks[0]!.claimed_at = "2026-10-11T04:40:00Z";
    const flights = flightsOf([zig, fil], [server("ZIG-I12-6", null, 3069), server(null, "s2", 3001, "filmia"), server(null, null, 3737, null)]);
    assert.deepEqual(flights.map((f) => [f.key, f.port, f.model, f.projectTitle]), [
      ["FIL-12", ":3001", "claude-sonnet-5-5", "Filmia"],
      ["ZIG-I12-6", ":3069", "claude-opus-5-5", "Zigzag"],
    ]);
    assert.equal(flights[1]!.branch, "slice/x");
  });

  test("a stopped server or an initiative claim does not count", () => {
    const p = project("zigzag", "Zigzag", { tasks: [claim("ZIG-I12-6", "s1"), { ...claim("ZIG-I12", "s1"), kind: "initiative" }] });
    const flights = flightsOf([p], [{ ...server("ZIG-I12-6", null, 3069), state: "gone" }]);
    assert.deepEqual(flights.map((f) => [f.key, f.port]), [["ZIG-I12-6", null]]);
  });
});

describe("headlineOf", () => {
  const zig = project("zigzag", "Zigzag", { tasks: [claim("ZIG-I12-6", "s1")] });
  const fil = project("filmia", "Filmia", { tasks: [claim("FIL-12", "s2"), ticket("FIL-I7-5", "Done")] });
  const wrk = project("workia", "Workia");
  const text = (h: ReturnType<typeof headlineOf>) => h.voice.map((v) => v.text).join("");

  test("two agents: who moves, who waits, what the Mac carries", () => {
    const flights = flightsOf([zig, fil], []);
    const h = headlineOf({ projects: [fil, wrk, zig], flights, inbox: { count: 15, by_project: { workia: 15 } }, totals: { orphan: 0, stale: 1 }, nowMs: NOW });
    assert.equal(h.title, "Dos agentes trabajan ahora.");
    assert.equal(text(h), "Zigzag y Filmia avanzan solas; Workia te espera con 15 cosas, y la Mac tiene 1 obsoleto.");
    assert.equal(h.voice[1]!.tone, "jorge");
  });

  test("one agent, nothing waiting, a clean Mac", () => {
    const h = headlineOf({ projects: [fil], flights: flightsOf([fil], []), inbox: { count: 0, by_project: {} }, totals: { orphan: 0, stale: 0 }, nowMs: NOW });
    assert.equal(h.title, "Un agente trabaja ahora.");
    assert.equal(text(h), "Filmia avanza sola; nada te espera.");
  });

  test("nobody working: what got done today; several projects waiting are listed by count", () => {
    const h = headlineOf({ projects: [fil, wrk, zig], flights: [], inbox: { count: 4, by_project: { workia: 1, zigzag: 2, machine: 1 } }, totals: null, nowMs: NOW });
    assert.equal(h.title, "Nadie trabaja ahora.");
    assert.equal(text(h), "Hoy se cerró 1 ticket; Zigzag y Workia y 1 más te esperan con 4 cosas.");
    const quiet = headlineOf({ projects: [wrk], flights: [], inbox: { count: 1, by_project: { machine: 1 } }, totals: { orphan: 2, stale: 0 }, nowMs: NOW });
    assert.equal(text(quiet), "Hoy no se cerró nada; la Mac te espera con 1 cosa, y la Mac tiene 2 sin dueño.");
  });
});

describe("counts", () => {
  test("tickets closed since local midnight", () => {
    const p = project("x", "X", { tasks: [ticket("X-1", "Ready"), ticket("X-2", "Ready"), ticket("X-3", "Done"), ticket("X-4", "Done", { updated_at: "2026-10-01T00:00:00Z" })] });
    assert.equal(doneToday([p], NOW), 1);
  });
});

describe("tiles", () => {
  test("the next line comes from the server's chosen note, else the next ticket, else nothing", () => {
    assert.deepEqual(nextLine({ line: "FIL-I2: Jorge: crear el cliente OAuth.\nLuego probar.", next_claimable: null }), { key: "FIL-I2", text: "Jorge: crear el cliente OAuth." });
    assert.deepEqual(nextLine({ line: "Siguiente: FIL-12 · Transiciones suaves", next_claimable: null }), { key: "FIL-12", text: "Transiciones suaves" });
    const next = { key: "ZIG-I12-6", kind: "ticket" as const, title: "QA final", summary: "", status: "Ready", priority: null, parent_key: null, blocked_by: [], workspace: null };
    assert.deepEqual(nextLine({ line: "En curso: ZIG-I12-5 (Claude Code)", next_claimable: next }), { key: "ZIG-I12-6", text: "QA final" });
    assert.deepEqual(nextLine({ line: "Sin ficha.", next_claimable: null }), { key: null, text: "nada en cola" });
    assert.deepEqual(nextLine({ line: "Neon at 0030.", next_claimable: null }), { key: null, text: "Neon at 0030." });
  });

  test("the env line prefers prod and says what trails it", () => {
    assert.equal(envLine([], NOW), "sin entornos registrados");
    assert.equal(
      envLine([{ env: "sandbox", commit: "ab45242be0", branch: "sandbox", deployed_at: null, flags: {}, behind: 0 }, { env: "prod", commit: "b4ef072dd4", branch: "main", deployed_at: "2026-10-09T21:37:13Z", flags: { db_ahead_of_code: "0029" }, behind: 1 }], NOW),
      "prod b4ef072 · hace 1 d · 1 rama adelante · DB adelante del código",
    );
  });

  test("state and rank: en marcha, te espera, quieto, en pausa; bars scale to the busiest day", () => {
    const init = ticket("P-I1", "Active", { kind: "initiative", priority: null });
    const moving = tileOf(project("a", "A", { tasks: [init, ticket("P-I1-1", "In progress", { parent_key: "P-I1" })], activity: [0, 2, 4, 0, 0, 0, 1] }), 0, NOW);
    assert.deepEqual([moving.state.word, moving.rank, moving.bars], ["en marcha", 0, [0, 50, 100, 0, 0, 0, 25]]);
    assert.deepEqual(moving.progress, { closed: 0, total: 1 });
    const waiting = tileOf(project("b", "B", { tasks: [init, ticket("P-I1-1", "Ready", { parent_key: "P-I1" })] }), 3, NOW);
    assert.deepEqual([waiting.state.word, waiting.rank], ["te espera", 1]);
    const quiet = tileOf(project("c", "C", { tasks: [init, ticket("P-I1-1", "Backlog", { parent_key: "P-I1" })] }), 0, NOW);
    assert.deepEqual([quiet.state.word, quiet.rank], ["quieto", 2]);
    const paused = tileOf(project("d", "D"), 0, NOW);
    assert.deepEqual([paused.state.word, paused.rank, paused.nextText], ["en pausa", 3, "nada en cola"]);
  });
});

describe("liveServersOf", () => {
  test("servers en uso, by owner then port, with how long they have been up", () => {
    const list = liveServersOf([server("Z-1", null, 3074), server(null, null, 3069), { ...server(null, null, 5173, "filmia"), state: "gone" }, server(null, null, 3737, null)], NOW);
    assert.deepEqual(list.map((s) => [s.port, s.owner, s.up]), [[":3737", "sistema", "9 h"], [":3069", "zigzag", "9 h"], [":3074", "zigzag", "9 h"]]);
  });
});
