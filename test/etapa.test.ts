// PLA-I53-2: etapaOf, one stage per ticket. Pure: every stage from its facts, and the four edge cases of check 1.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { useTestEnv } from "./helpers.js";

useTestEnv();
const { ETAPAS, ahoraOf, etapaOf, isAhora } = await import("../src/api/etapa.js");
type Facts = Parameters<typeof etapaOf>[0];

const NOW = new Date("2026-11-15T12:00:00.000Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const taller = { agent: "taller-demo", role: "taller" };
const base = (patch: Partial<Facts> = {}): Facts => ({
  status: "Ready",
  statusChangedAt: ago(60),
  owner: { agent: "taller", role: "taller" },
  lease: null,
  run: null,
  qa: { applies: false, lane: null },
  pr: null,
  waitsOn: [],
  held: null,
  blockedNote: null,
  postponed: false,
  delivery: null,
  ...patch,
});
const lane = (status: string, patch: Partial<NonNullable<Facts["qa"]["lane"]>> = {}) => ({ status, returned: false, attempt: 1, commit: "abc1234", createdAt: ago(30), startedAt: ago(20), endedAt: ago(10), ...patch });
const liveLease = { holder: taller, since: ago(15), until: new Date(NOW.getTime() + 15 * 60_000) };
const deadLease = { holder: taller, since: ago(90), until: ago(30) };
const of = (patch: Partial<Facts>) => etapaOf(base(patch), NOW)!;

describe("etapaOf: one stage per status", () => {
  test("despues: Backlog outside the leg in course", () => {
    assert.equal(of({ status: "Backlog" }).etapa, "despues");
    // PLA-47: and says why it waits.
    assert.equal(of({ status: "Backlog" }).reason, "Está en Backlog: nadie la pasó a Lista.");
    assert.equal(of({ status: "Backlog", waitsOn: ["Hosting"] }).reason, "Espera a «Hosting»");
    assert.equal(of({ status: "Backlog", postponed: true, waitsOn: ["Hosting"] }).reason, "Espera a «Hosting»");
  });
  test("pospuesto: Backlog in the leg in course (or under an On hold initiative)", () => {
    const e = of({ status: "Backlog", postponed: true });
    assert.equal(e.etapa, "pospuesto");
    assert.equal(e.reason, "Pospuesto a propósito.");
    assert.equal(of({ status: "Ready", postponed: true }).etapa, "pospuesto");
  });
  test("lista: Ready and nothing holds it", () => {
    const e = of({});
    assert.deepEqual(e, { etapa: "lista", qa: null, holder: null, live: false, since: ago(60).toISOString(), ci: null, reason: null });
  });
  test("en_espera: Ready behind an unfinished ticket", () => {
    const e = of({ waitsOn: ["Primer paso"] });
    assert.equal(e.etapa, "en_espera");
    assert.equal(e.reason, "Espera a «Primer paso»");
  });
  test("bloqueado: Ready with an open typed blocker; Blocked by something other than tickets, with its note", () => {
    assert.equal(of({ held: "Owner: crear la cuenta de prueba" }).etapa, "bloqueado");
    assert.equal(of({ status: "Blocked", blockedNote: "Falta la llave", held: "Owner: crear la llave", waitsOn: ["Otro paso"] }).etapa, "bloqueado");
    const e = of({ status: "Blocked", blockedNote: "Falta la llave de prueba" });
    assert.equal(e.etapa, "bloqueado");
    assert.equal(e.reason, "Falta la llave de prueba");
  });
  test("construyendo: In progress with a live lease, since the claim", () => {
    const e = of({ status: "In progress", lease: liveLease });
    assert.equal(e.etapa, "construyendo");
    assert.deepEqual(e.holder, taller);
    assert.equal(e.live, true);
    assert.equal(e.since, ago(15).toISOString());
  });
  test("construyendo: In progress with a running run and no lease; the run's agent is the holder", () => {
    const e = of({ status: "In progress", run: { holder: { agent: "taller-otro", role: "taller" }, since: ago(5) } });
    assert.equal(e.etapa, "construyendo");
    assert.equal(e.holder?.agent, "taller-otro");
    assert.equal(e.since, ago(5).toISOString());
  });
  test("construyendo: a Ready ticket a run already works on", () => {
    assert.equal(of({ run: { holder: taller, since: ago(2) } }).etapa, "construyendo");
  });
  test("devuelto: sent back by the owner (Pedir cambios), Ready, shows who fixes it", () => {
    const e = of({ delivery: { returned: true, open: false, at: ago(8) } });
    assert.equal(e.etapa, "devuelto");
    assert.deepEqual(e.holder, { agent: "taller", role: "taller" });
    assert.equal(e.live, false);
    assert.equal(e.since, ago(8).toISOString());
  });
  test("devuelto: QA returned it and Taller is fixing it now (live)", () => {
    const e = of({ status: "In progress", lease: liveLease, qa: { applies: true, lane: lane("fail", { returned: true }) } });
    assert.equal(e.etapa, "devuelto");
    assert.equal(e.live, true);
    assert.deepEqual(e.holder, taller);
  });
  test("en_qa queued: In review, QA applies and no lane yet", () => {
    const e = of({ status: "In review", qa: { applies: true, lane: null }, pr: { state: "open", ci: "success", head: "abc1234" } });
    assert.equal(e.etapa, "en_qa");
    assert.equal(e.qa, "queued");
    assert.equal(e.live, false);
    assert.equal(e.ci, "success");
  });
  test("en_qa queued: the lane saw an older commit than the PR head", () => {
    const e = of({ status: "In review", qa: { applies: true, lane: lane("pass", { commit: "0ld0001" }) }, pr: { state: "open", ci: "success", head: "abc1234" } });
    assert.equal(e.etapa, "en_qa");
    assert.equal(e.qa, "queued");
  });
  test("en_qa running: the lane is checking", () => {
    const e = of({ status: "In review", qa: { applies: true, lane: lane("checking") } });
    assert.equal(e.etapa, "en_qa");
    assert.equal(e.qa, "running");
    assert.equal(e.live, true);
    assert.equal(e.since, ago(20).toISOString());
  });
  test("en_revision: QA not required, PR open with CI pending", () => {
    const e = of({ status: "In review", pr: { state: "open", ci: "pending", head: "abc1234" } });
    assert.equal(e.etapa, "en_revision");
    assert.equal(e.ci, "pending");
  });
  test("te_toca: delivered (the delivery message waits on the owner), CI green", () => {
    const e = of({ status: "In review", qa: { applies: true, lane: lane("pass") }, pr: { state: "open", ci: "success", head: "abc1234" }, delivery: { returned: false, open: true, at: ago(9) } });
    assert.equal(e.etapa, "te_toca");
    assert.deepEqual(e.holder, { agent: "owner", role: "ceo" });
    assert.equal(e.since, ago(9).toISOString());
  });
  test("PLA-158 (F-27): pictures still coming: the board line says what the pass waits on", () => {
    const base = { status: "In review", qa: { applies: false, lane: null }, pr: { state: "open", ci: "success", head: "abc1234" }, delivery: { returned: false, open: true, at: ago(9) }, photos: true };
    assert.equal(of(base as never).reason, "Plania toma las fotos de la entrega.");
    const e = of({ ...base, photosWaiting: "Espera a que terminen las fotos de otra entrega." } as never);
    assert.equal(e.etapa, "en_revision");
    assert.equal(e.reason, "Plania toma las fotos de la entrega. Espera a que terminen las fotos de otra entrega.");
  });

  test("te_toca: Needs owner", () => {
    assert.equal(of({ status: "Needs owner" }).etapa, "te_toca");
  });
  test("te_toca: QA failed again on a later attempt (revísala tú)", () => {
    const e = of({ status: "In review", qa: { applies: true, lane: lane("fail", { attempt: 2 }) } });
    assert.equal(e.etapa, "te_toca");
    assert.match(e.reason!, /revísala tú/);
  });
  test("integrado, publicado, hecho; Won't do has no stage", () => {
    assert.equal(of({ status: "Merged" }).etapa, "integrado");
    assert.equal(of({ status: "Released" }).etapa, "publicado");
    assert.equal(of({ status: "Done" }).etapa, "hecho");
    assert.equal(etapaOf(base({ status: "Won't do" }), NOW), null);
  });
});

describe("etapaOf: the four edge cases of check 1", () => {
  test("In progress with an expired lease and no run = sin_dueno", () => {
    const e = of({ status: "In progress", lease: deadLease });
    assert.equal(e.etapa, "sin_dueno");
    assert.equal(e.holder, null);
    assert.equal(e.live, false);
    assert.equal(e.since, ago(30).toISOString());
  });
  test("In review + QA fail = devuelto", () => {
    const e = of({ status: "In review", qa: { applies: true, lane: lane("fail") }, pr: { state: "open", ci: "success", head: "abc1234" } });
    assert.equal(e.etapa, "devuelto");
    assert.equal(e.reason, "QA encontró fallas y la devolvió.");
  });
  test("In review + QA pass + CI failure = en_revision with ci failure", () => {
    const e = of({ status: "In review", qa: { applies: true, lane: lane("pass") }, pr: { state: "open", ci: "failure", head: "abc1234" }, delivery: { returned: false, open: true, at: ago(5) } });
    assert.equal(e.etapa, "en_revision");
    assert.equal(e.ci, "failure");
    assert.equal(e.reason, "Las pruebas del PR fallan.");
  });
  test("Blocked only by unfinished tickets = en_espera", () => {
    const e = of({ status: "Blocked", waitsOn: ["Servidor primero", "Otro"] });
    assert.equal(e.etapa, "en_espera");
    assert.equal(e.reason, "Espera a «Servidor primero»");
  });
});

test("every stage id is reachable from some facts", () => {
  const seen = new Set<string>();
  const cases: Partial<Facts>[] = [
    { status: "Backlog" },
    { status: "Backlog", postponed: true },
    {},
    { waitsOn: ["x"] },
    { held: "x" },
    { status: "In progress", lease: liveLease },
    { delivery: { returned: true, open: false, at: ago(1) } },
    { status: "In progress", lease: deadLease },
    { status: "In review", qa: { applies: true, lane: null } },
    { status: "In review", pr: { state: "open", ci: "failure", head: null } },
    { status: "Needs owner" },
    { status: "Merged" },
    { status: "Released" },
    { status: "Done" },
  ];
  for (const c of cases) seen.add(of(c).etapa);
  assert.deepEqual([...seen].sort(), [...ETAPAS].sort());
});

test("ahora: construyendo, en_qa running and devuelto only, building first", () => {
  const row = (key: string, patch: Partial<Facts>) => ({ key, title: key, parent_key: null, etapa: of(patch) });
  const rows = [
    row("T-1", { status: "In review", qa: { applies: true, lane: lane("checking") } }),
    row("T-2", { status: "In progress", lease: liveLease }),
    row("T-3", { delivery: { returned: true, open: false, at: ago(3) } }),
    row("T-4", { status: "In review", qa: { applies: true, lane: null } }),
    row("T-5", { status: "In progress", lease: deadLease }),
    row("T-6", {}),
  ];
  assert.deepEqual(ahoraOf(rows).map((r) => [r.key, r.etapa]), [["T-2", "construyendo"], ["T-1", "en_qa"], ["T-3", "devuelto"]]);
  assert.equal(isAhora(null), false);
});
