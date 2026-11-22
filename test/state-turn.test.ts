// PLA-I74-5: turnOf gives every open item exactly one of the five turns, or names the gap («nobody») the watchdog
// heals. A table: one row per kind of item, its facts, the turn it must have.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TURNS, turnOf, type TurnInput } from "../src/state/turn.js";

const NOW = new Date("2026-11-22T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const base: TurnInput = {
  key: "T-1",
  status: "Ready",
  statusChangedAt: ago(5),
  paused: false,
  liveRun: null,
  queuedRun: null,
  lease: null,
  question: false,
  couldNotStart: null,
  onHold: false,
  personOwned: false,
  workable: true,
  waitsOnStep: null,
  typed: null,
  etapa: "lista",
  qa: null,
  ci: null,
  worker: "taller",
  workerBusy: false,
};
const run = { id: "r1", agent: "taller", since: ago(1) };
const endedLease = { agent: "taller", runner: true, runnerEnded: true, since: ago(40) };

const ROWS: [string, Partial<TurnInput>, string][] = [
  ["a live run on it", { status: "In progress", liveRun: run, lease: { agent: "taller", runner: true, runnerEnded: false, since: ago(1) } }, "agent_working"],
  ["a live run on a Ready step (it just started)", { liveRun: run }, "agent_working"],
  ["an agent in its own terminal holds the lease", { status: "In progress", lease: { agent: "claude code", runner: false, runnerEnded: false, since: ago(3) } }, "agent_working"],
  ["a live run woken on another key claimed it", { status: "In progress", lease: { agent: "taller", runner: true, runnerEnded: false, since: ago(3) } }, "agent_working"],
  ["QA runs on the delivery", { status: "In review", etapa: "en_qa", qa: "running" }, "agent_working"],
  ["a run is queued on it", { queuedRun: { id: "r2", agent: "taller" } }, "agent_queued:run_queued"],
  ["its agent is busy with another step", { workerBusy: true }, "agent_queued:agent_busy"],
  ["it waits on an earlier step", { workable: false, waitsOnStep: "Paso 1" }, "agent_queued:waits_step"],
  ["a chain step in Backlog waits on the one before", { status: "Backlog", workable: false, waitsOnStep: "Paso 1", etapa: "despues" }, "agent_queued:waits_step"],
  ["QA's queue has it", { status: "In review", etapa: "en_qa", qa: "queued" }, "agent_queued:qa_queued"],
  ["an open question", { status: "Needs owner", etapa: "te_toca", question: true }, "owner:question"],
  ["a delivery waits for the owner", { status: "In review", etapa: "te_toca" }, "owner:delivery"],
  ["the owner's own step", { personOwned: true, workable: false }, "owner:own_step"],
  ["a human action blocks it", { workable: false, typed: { type: "human_action", at: null, text: "Poner la llave" } }, "owner:action"],
  ["its initiative is On hold", { onHold: true, workable: false, etapa: "pospuesto" }, "owner:postponed"],
  ["a Backlog step nobody planned", { status: "Backlog", workable: false, etapa: "despues" }, "owner:backlog"],
  ["Blocked with only a note", { status: "Blocked", workable: false, etapa: "bloqueado" }, "owner:blocked"],
  ["the project is paused", { paused: true }, "owner:paused"],
  ["CI runs on its PR", { status: "In review", etapa: "en_revision", ci: "pending", statusChangedAt: ago(10) }, "outside:ci"],
  ["it waits for a set time", { workable: false, typed: { type: "time_after", at: new Date(NOW.getTime() + 3_600_000).toISOString(), text: null } }, "outside:time"],
  ["merged, waiting for the deploy", { status: "Merged", etapa: "integrado", statusChangedAt: ago(10) }, "outside:deploy"],
  ["released, waiting for Plania to close it", { status: "Released", etapa: "publicado", statusChangedAt: ago(10) }, "outside:close"],
  ["its PR merged, the poller has not moved it", { status: "In review", etapa: "integrado", statusChangedAt: ago(5) }, "outside:merge"],
  ["its newest run could not start", { couldNotStart: "fail: worktree: no repo" }, "failed"],
  ["Ready, nothing woke anyone", {}, "nobody:not_woken"],
  ["held by a run that ended (PLA-167)", { status: "In progress", lease: endedLease, etapa: "sin_dueno" }, "nobody:held_by_ended_run"],
  ["In progress, the lease lapsed", { status: "In progress", etapa: "sin_dueno" }, "nobody:lease_lapsed"],
  ["sent back and nobody took it", { status: "Ready", etapa: "devuelto" }, "nobody:sent_back"],
  ["CI red, nobody on it", { status: "In review", etapa: "en_revision", ci: "failure" }, "nobody:ci_red"],
  ["the deploy is two hours late", { status: "Merged", etapa: "integrado", statusChangedAt: ago(120) }, "nobody:overdue"],
];

const label = (t: NonNullable<ReturnType<typeof turnOf>>) =>
  t.turn === "agent_queued" ? `${t.turn}:${t.reason}` : t.turn === "owner" ? `${t.turn}:${t.card}` : t.turn === "outside" ? `${t.turn}:${t.on}` : t.turn === "nobody" ? `${t.turn}:${t.why}` : t.turn;

for (const [name, facts, want] of ROWS) {
  test(`turnOf: ${name} → ${want}`, () => {
    const t = turnOf({ ...base, ...facts }, NOW);
    assert.ok(t, "an open item always has a turn");
    assert.equal(label(t), want);
    assert.ok((TURNS as readonly string[]).includes(t.turn) || t.turn === "nobody");
  });
}

test("turnOf: every one of the five turns appears in the table, and nobody's reasons all carry a heal", () => {
  const got = ROWS.map(([, f]) => turnOf({ ...base, ...f }, NOW)!);
  for (const k of TURNS) assert.ok(got.some((t) => t.turn === k), k);
  for (const t of got) if (t.turn === "nobody") assert.ok(t.why === "overdue" ? t.heal.kind === "none" : t.heal.kind === "wake", t.why);
  const held = turnOf({ ...base, status: "In progress", lease: endedLease }, NOW)!;
  assert.deepEqual(held.turn === "nobody" && held.heal, { kind: "wake", release: true, reason: "its run ended holding it" });
});

test("turnOf: a closed item has no turn; an outside wait carries its time limit", () => {
  assert.equal(turnOf({ ...base, status: "Done" }, NOW), null);
  assert.equal(turnOf({ ...base, status: "Won't do" }, NOW), null);
  const t = turnOf({ ...base, status: "Merged", etapa: "integrado", statusChangedAt: ago(10) }, NOW)!;
  assert.deepEqual(t, { turn: "outside", on: "deploy", until: new Date(ago(10).getTime() + 60 * 60_000).toISOString() });
});

test("turnOf: a live run wins over everything; a question wins over a queued run", () => {
  assert.equal(turnOf({ ...base, liveRun: run, question: true, paused: true }, NOW)!.turn, "agent_working");
  assert.equal(turnOf({ ...base, question: true, queuedRun: { id: "r", agent: "taller" } }, NOW)!.turn, "owner");
});
