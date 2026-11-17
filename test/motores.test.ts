// PLA-I59-1 (Motores): the rule that picks a run's model and effort, the flags it becomes, and the validators.
// Pure: no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanEffort, cleanModel, resolveMotor } from "../src/runner/motor.js";
import { claudeArgs } from "../src/runner/runner.js";

const seat = (model: string | null = null, effort: string | null = null, consultaModel: string | null = null, consultaEffort: string | null = null) => ({ model, effort, consultaModel, consultaEffort });
const company = (model: string | null = null, effort: string | null = null) => ({ model, effort });

test("I59-1: nothing set anywhere → no model, no effort, both from the CLI", () => {
  assert.deepEqual(resolveMotor({ seat: seat(), company: company() }), { model: null, effort: null, source: { model: "cli", effort: "cli" } });
});

test("I59-1: the company default applies to a seat with nothing of its own", () => {
  const m = resolveMotor({ seat: seat(), company: company("opus", "high") });
  assert.deepEqual([m.model, m.effort, m.source.model, m.source.effort], ["opus", "high", "company", "company"]);
});

test("I59-1: the seat beats the company, model and effort each on their own", () => {
  const m = resolveMotor({ seat: seat("sonnet", null), company: company("opus", "high") });
  assert.deepEqual([m.model, m.effort, m.source.model, m.source.effort], ["sonnet", "high", "seat", "company"]);
});

test("I59-1: the QA lane's model wins over the seat; the effort still follows the seat", () => {
  const m = resolveMotor({ qaModel: "sonnet", seat: seat("opus", "max"), company: company("fable", "low") });
  assert.deepEqual([m.model, m.effort, m.source.model, m.source.effort], ["sonnet", "max", "qa", "seat"]);
});

test("I59-1: consulta_* is read only on a Preguntar run, and falls back to the seat then the company", () => {
  const s = seat("opus", "high", "haiku", null);
  const ask = resolveMotor({ consulta: true, seat: s, company: company(null, "low") });
  assert.deepEqual([ask.model, ask.effort, ask.source.model, ask.source.effort], ["haiku", "high", "consulta", "seat"]);
  const normal = resolveMotor({ consulta: false, seat: s, company: company() });
  assert.deepEqual([normal.model, normal.source.model], ["opus", "seat"]);
  const bare = resolveMotor({ consulta: true, seat: seat(), company: company("sonnet", "medium") });
  assert.deepEqual([bare.model, bare.effort, bare.source.model], ["sonnet", "medium", "company"]);
});

test("I59-1: claudeArgs adds --model and --effort only when set; nothing set keeps today's args", () => {
  const base = { prompt: "p", settingsPath: "/s", mcpConfigPath: "/m", systemPromptPath: null, maxTurns: 40, resume: null };
  const plain = claudeArgs(base);
  assert.equal(plain.includes("--model"), false);
  assert.equal(plain.includes("--effort"), false);
  const both = claudeArgs({ ...base, model: "sonnet", effort: "high" });
  assert.deepEqual(both.slice(-4), ["--model", "sonnet", "--effort", "high"]);
  assert.deepEqual(both.slice(0, plain.length), plain);
});

test("I59-1: validators take aliases and full ids, refuse the rest; empty clears", () => {
  for (const ok of ["haiku", "Sonnet", " opus ", "fable", "claude-opus-5-5", "claude-opus-5-5[1m]"]) assert.notEqual(cleanModel(ok), undefined, ok);
  for (const bad of ["gpt-4", "opus; rm -rf", "claude-", "--model"]) assert.equal(cleanModel(bad), undefined, bad);
  assert.equal(cleanModel(""), null);
  assert.equal(cleanModel(null), null);
  for (const ok of ["low", "medium", "HIGH", "xhigh", "max"]) assert.notEqual(cleanEffort(ok), undefined, ok);
  assert.equal(cleanEffort("ultra"), undefined);
  assert.equal(cleanEffort(""), null);
});
