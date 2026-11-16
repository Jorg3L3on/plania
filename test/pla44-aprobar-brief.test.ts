// PLA-44: the Brief's approve action names its effect, and «sandbox» never reaches the screen in either language.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;

test("accept_pr reads Aprobar y pasar a prueba and its confirm says what happens", async () => {
  const { BRIEF_LABELS } = await load("lib/brief-i18n.ts");
  const es = BRIEF_LABELS.es.d, en = BRIEF_LABELS.en.d;
  assert.equal(es.verbs.accept_pr, "Aprobar y pasar a prueba");
  assert.equal(en.verbs.accept_pr, "Approve into the test copy");
  assert.equal(es.stamps.accept_pr, "Aprobado");
  assert.equal(en.stamps.accept_pr, "Approved");
  assert.equal(es.confirm.accept_pr({ project: "MiCasa", pr: 12, key: "MIC-3" }), "Esto integra el PR #12 a la copia de prueba de MiCasa. Lo publicado no cambia.");
  assert.equal(en.confirm.accept_pr({ project: "MiCasa", pr: 12, key: "MIC-3" }), "This merges PR #12 into MiCasa's test copy. Nothing published changes.");
  assert.match(es.confirm.publish({ project: "MiCasa", from: "sandbox", into: "main", tickets: 1 }), /^Esto publica la copia de prueba en main para MiCasa: 1 ticket, sin migraciones\./);
  assert.match(en.confirm.publish({ project: "MiCasa", from: "sandbox", into: "main", tickets: 2 }), /^This publishes the test copy to main for MiCasa: 2 tickets, no migrations\./);
});

test("the release and PR evidence rows call the sandbox branch the test copy", async () => {
  const { evidence } = await load("lib/brief-row.ts");
  const release = { kind: "release", from: "sandbox", into: "main", env: "sandbox", ahead: null, tickets: [], migrations: [] };
  const pr = { kind: "pr", number: 7, state: "open", base: "sandbox", ticket: null };
  for (const lang of ["es", "en"] as const) {
    const rows = JSON.stringify([...evidence(release, lang), ...evidence(pr, lang)]);
    assert.doesNotMatch(rows, /sandbox/i, lang);
  }
  assert.equal(evidence(release, "es")[0][1], "copia de prueba → main · copia de prueba");
});

test("no on-screen string in the Brief labels says sandbox", () => {
  const src = readFileSync(new URL("../ui/src/lib/brief-i18n.ts", import.meta.url), "utf8");
  const shown = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n").match(/["`][^"`\n]*sandbox[^"`\n]*["`]/gi) ?? [];
  assert.deepEqual(shown.filter((s) => s !== '"sandbox"'), []);
});
