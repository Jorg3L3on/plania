// PLA-45: the Brief never shows the branch name or «fusionar», and «Activar corridas» on a PR card says why.
import assert from "node:assert/strict";
import { test } from "node:test";
import { plainBrief, plainWords } from "../src/brief/plain.js";

test("PLA-45: Spanish brief text says la copia de prueba and aprobar", () => {
  assert.equal(plainWords("El PR #212 lleva 17 días abierto contra sandbox. Revísalo y fusiónalo o ciérralo.", "es"), "El PR #212 lleva 17 días abierto contra la copia de prueba. Revísalo y apruébalo o ciérralo.");
  assert.equal(plainWords("Dependabot lo abrió contra la rama sandbox.", "es"), "Dependabot lo abrió contra la copia de prueba.");
  assert.equal(plainWords("Está en sandbox desde ayer.", "es"), "Está en la copia de prueba desde ayer.");
});

test("PLA-45: English brief text says the test copy", () => {
  assert.equal(plainWords("PR #3 is open against sandbox.", "en"), "PR #3 is open against the test copy.");
});

test("PLA-45: only readable text changes; refs and targets stay", () => {
  const d = plainBrief({ language: "es", items: [{ id: "a", ref: "sandbox", title: "Mira sandbox", detail: "contra sandbox", targets: [{ kind: "pr", project: "x", pr: 1 }] }], ideas: [{ id: "i", title: "t", why: "en sandbox" }] }) as any;
  assert.equal(d.items[0].ref, "sandbox");
  assert.equal(d.items[0].title, "Mira la copia de prueba");
  assert.equal(d.items[0].detail, "contra la copia de prueba");
  assert.equal(d.ideas[0].why, "en la copia de prueba");
  assert.deepEqual(d.items[0].targets, [{ kind: "pr", project: "x", pr: 1 }]);
});

test("PLA-45: the runs confirm has no «tick», and the why line names the project", async () => {
  const i18n = (await import(new URL("../ui/src/lib/brief-i18n.ts", import.meta.url).href)) as Record<string, any>;
  const es = i18n.BRIEF_LABELS.es;
  assert.doesNotMatch(es.d.confirm.resume_runs({ project: "Filmia" }), /tick/);
  assert.match(es.c.runsWhy("Filmia"), /^Filmia está en pausa/);
});

test("PLA-45: old thread messages read with today's words", async () => {
  const { plainWords: pw } = (await import(new URL("../ui/src/lib/plain-words.ts", import.meta.url).href)) as { plainWords: (s: string, l?: string) => string };
  assert.equal(pw("Necesito: que lo revises (Aceptar o Pedir cambios)."), "Necesito: que lo revises (Aprobar o Pedir cambios).");
  assert.equal(pw("PR #23 hacia sandbox. Necesito que revises la muestra y aceptes o pidas cambios."), "PR #23 hacia la copia de prueba. Necesito que revises la muestra y apruebes o pidas cambios.");
  assert.equal(pw("Acepté MIA-31: Elijo 1."), "Aprobé MIA-31: Elijo 1.");
  assert.equal(pw("PR #28 into sandbox."), "PR #28 into la copia de prueba.");
});

test("PLA-45: a PR chip in a thread says la copia de prueba", async () => {
  const org = (await import(new URL("../ui/src/lib/org.ts", import.meta.url).href)) as Record<string, any>;
  assert.equal(org.linkLabel({ kind: "pr", ref: "https://github.com/x/y/pull/28", title: "PR #28 a sandbox" }), "PR #28 a la copia de prueba");
});
