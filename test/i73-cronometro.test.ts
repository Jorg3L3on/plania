// PLA-I73-1: the stopwatch, the photo-pass events and the Spotlight-free copies folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { useTestEnv } from "./helpers.js";

useTestEnv();
const { cronometro, stepTimes } = await import("../src/api/cronometro.js");
const { worktreesDefault, defaultFolders } = await import("../src/folders.js");
const ui = await import("../ui/src/lib/cronometro.js");

const T0 = Date.parse("2026-11-21T22:33:00Z");
const at = (min: number) => new Date(T0 + min * 60_000);
const ev = (key: string, type: string, min: number, payload: Record<string, unknown> = {}) => ({ type, at: at(min), taskKey: key, payload });
const run = (key: string, from: number, to: number) => ({ taskKey: key, role: "taller", startedAt: at(from), endedAt: at(to) });

test("I73-1 #1: a step is split into stalled, building, photos, owner and redoing, and the totals add up", () => {
  const step = { key: "X-1", title: "Uno", phase: 1, createdAt: at(0), createdStatus: "Ready" };
  const evs = [
    ev("X-1", "task.status", 30, { from: "In progress", to: "In review" }),
    ev("X-1", "probador.started", 30),
    ev("X-1", "probador.pass", 32, { ok: true }),
    ev("X-1", "task.status", 35, { from: "In review", to: "Ready" }),
    ev("X-1", "task.status", 45, { from: "In progress", to: "In review" }),
    ev("X-1", "probador.started", 45),
    ev("X-1", "probador.pass", 47, { ok: true }),
    ev("X-1", "pr.merged", 60),
  ];
  const s = stepTimes(step, evs, [run("X-1", 14, 30), run("X-1", 35, 45)], at(100));
  assert.equal(s.totals.detenido, 14 * 60_000, "nothing woke Taller for 14 minutes");
  assert.equal(s.totals.construye, 16 * 60_000);
  assert.equal(s.totals.fotos, 4 * 60_000);
  assert.equal(s.totals.rehace, 10 * 60_000, "the run after the send-back is redoing");
  assert.equal(s.totals.dueno, (3 + 13) * 60_000);
  assert.equal(s.ms, 60 * 60_000);
  assert.equal(Object.values(s.totals).reduce((a, b) => a + b, 0), s.ms);
});

test("I73-1 #2: the initiative total spans its steps, counts the time before, and stays open while a step runs", () => {
  const steps = [
    { key: "X-1", title: "Uno", phase: 1, createdAt: at(0), createdStatus: "Ready" },
    { key: "X-2", title: "Dos", phase: 2, createdAt: at(0), createdStatus: "Backlog" },
  ];
  const evs = [ev("X-1", "pr.merged", 20), ev("X-2", "task.status", 20, { from: "Backlog", to: "Ready" })];
  const c = cronometro(steps, evs, [run("X-1", 1, 15), run("X-2", 21, 30)], at(40), at(-26));
  assert.equal(c.open, true);
  assert.equal(c.ms, 40 * 60_000);
  assert.equal(c.before_ms, 26 * 60_000);
  assert.equal(c.steps[1]!.totals.construye, 9 * 60_000);
  assert.equal(c.steps[1]!.totals.detenido, 11 * 60_000, "Ready with nobody working after the run ended");
  const closed = cronometro(steps, [...evs, ev("X-2", "pr.merged", 35)], [run("X-1", 1, 15), run("X-2", 21, 30)], at(40));
  assert.equal(closed.open, false);
  assert.equal(closed.ms, 35 * 60_000);
});

test("I73-1 #3: a step still in Backlog has no time, and a photo pass still running counts until now", () => {
  const s = stepTimes({ key: "X-3", title: "Tres", phase: 3, createdAt: at(0), createdStatus: "Backlog" }, [], [], at(10));
  assert.equal(s.start, null);
  const open = stepTimes({ key: "X-4", title: "Cuatro", phase: 4, createdAt: at(0), createdStatus: "Ready" }, [ev("X-4", "task.status", 5, { from: "In progress", to: "In review" }), ev("X-4", "probador.started", 5)], [run("X-4", 0, 5)], at(12));
  assert.equal(open.totals.fotos, 7 * 60_000);
});

test("I73-1 #4: the screen words: durations, bars in a fixed order, headline open or closed", () => {
  assert.equal(ui.duracion(40_000), "40 s");
  assert.equal(ui.duracion(26 * 60_000), "26 min");
  assert.equal(ui.duracion(227 * 60_000), "3 h 47");
  assert.equal(ui.duracion(120 * 60_000), "2 h");
  const totals = { construye: 74, rehace: 11, fotos: 46, verifica: 0, dueno: 53, detenido: 16 };
  const bars = ui.barsOf(totals);
  assert.deepEqual(bars.map((b) => b.tramo), ["construye", "rehace", "fotos", "dueno", "detenido"], "an empty piece is left out, the order is fixed");
  assert.equal(bars[0]!.label, "Taller construye");
  const v = ui.cronoView({ start: at(0).toISOString(), end: null, ms: 227 * 60_000, before_ms: 26 * 60_000, totals, steps: [], open: true });
  assert.equal(v!.headline, "3 h 47 hasta ahora");
  assert.match(v!.before!, /26 min antes/);
  assert.equal(ui.cronoView(null), null);
});

test("I73-1 #5: a new macOS install keeps its copies in worktrees.noindex; an existing folder or another system keeps worktrees", () => {
  const root = path.join("/home/ana", "plania");
  assert.equal(worktreesDefault(root, () => false, "darwin"), path.join(root, "worktrees.noindex"));
  assert.equal(worktreesDefault(root, () => true, "darwin"), path.join(root, "worktrees"), "an install that has the old folder keeps it");
  assert.equal(worktreesDefault(root, () => false, "linux"), path.join(root, "worktrees"));
  assert.equal(defaultFolders("/home/ana", () => false).projects, path.join(root, "projects"));
});
