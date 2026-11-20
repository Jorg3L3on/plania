// PLA-I67-6: «Probar» and «Traer de un enlace» on the screen, without a browser: the version each run carried in
// words, a trial's line (waiting, not started and why), the update's diff over the body and every file, the link's
// host, the refusals in words, and both languages for every key.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { words } from "../ui/src/lib/i18n.js";
import { hostOf, importError, othersCount, skillText, stampWords, trialError, trialLine, trialLive, updateDiff } from "../ui/src/lib/oficio-trials.js";
import { IMPORT_WORDS, TRIAL_WORDS } from "../ui/src/lib/oficio-trial-words.js";
import { versionNote } from "../ui/src/lib/oficio-skills.js";

const versions = [
  { n: 2, hash: "bbbbbbbb" },
  { n: 1, hash: "aaaaaaaa" },
];

test("I67-6 #2: each side says which version of the skill its run carried, and how many others", () => {
  assert.equal(stampWords("cierre@aaaaaaaa", versions, "es"), "Llevaba la v1");
  assert.equal(stampWords("cierre@bbbbbbbb", versions, "es"), "Llevaba la v2");
  assert.equal(stampWords("cierre@cccccccc", versions, "es"), "Llevaba la versión cccccccc");
  assert.equal(stampWords(null, versions, "es"), "no llevaba esta habilidad");
  assert.equal(stampWords("cierre@bbbbbbbb", versions, "en"), "Carried v2");
  assert.equal(othersCount(["cierre@aaaaaaaa", "otra@1", "mas@2"], "cierre"), 2);
  assert.equal(words(TRIAL_WORDS, "es").others(1), "y una habilidad más");
});

test("I67-6: a trial's line says it waits and why, or why it did not start; it says it uses plan", () => {
  assert.equal(trialLine({ status: "queued", summary: "queued: cap reached" }, "es"), "en espera · Espera un lugar libre: hay otras corridas.");
  assert.equal(trialLine({ status: "skipped", summary: "skipped: plan at 95% (guard 70%)" }, "es"), "No empezó: el plan está cerca de su límite.");
  assert.equal(trialLine({ status: "done", summary: "ok" }, "es"), "terminada");
  assert.equal(trialLine({ status: "failed", summary: "fail" }, "en"), "failed");
  assert.ok(trialLive({ status: "queued" }) && trialLive({ status: "running" }) && !trialLive({ status: "done" }));
  assert.match(words(TRIAL_WORDS, "es").plan, /Usa plan/);
  assert.match(words(TRIAL_WORDS, "es").lead(3), /No toca esa tarea, su rama ni su propuesta de cambio/);
});

test("I67-6 #4: the update's diff covers the name, «cuándo», the body and every file", () => {
  const current = { name: "Contraste", description: "Cuando hay color.", body: "Mide.", files: [{ path: "a.md", content: "uno" }] };
  const fetched = { ...current, body: "Mide, también en oscuro.", files: [{ path: "a.md", content: "uno" }, { path: "b.md", content: "dos" }] };
  assert.equal(skillText(current), "# Contraste\nCuando hay color.\n\nMide.\n── a.md\nuno");
  const d = updateDiff({ current, fetched });
  assert.deepEqual(d.filter((l) => l.kind !== "same"), [
    { kind: "del", text: "Mide." },
    { kind: "add", text: "Mide, también en oscuro." },
    { kind: "add", text: "" },
    { kind: "add", text: "── b.md" },
    { kind: "add", text: "dos" },
  ]);
  assert.equal(versionNote({ note: "link:abcdef012345" }, "es"), "del enlace");
});

test("I67-6 #3: a refused link or save reads in words; the host of a link", () => {
  assert.match(importError("SKILL_NOT_ALLOWED", "es")!, /scripts, hooks o permisos de herramientas/);
  assert.match(importError("SKILL_IMPORT_FORMAT", "es")!, /no es una habilidad/);
  assert.match(importError("SKILL_IMPORT_CHANGED", "es")!, /cambió mientras lo leías/);
  assert.match(importError("FETCH_ADDRESS_REFUSED", "es")!, /no visita/);
  assert.equal(importError("FETCH_TIMEOUT", "es"), "No se pudo leer el enlace.");
  assert.equal(importError(null), null);
  assert.equal(trialError("TRIAL_NO_DELIVERY", "es"), "Esa entrega ya no se puede repetir: su trabajo no está.");
  assert.equal(hostOf("https://www.github.com/acme/skills/tree/main/x"), "github.com");
  assert.equal(words(IMPORT_WORDS, "es").pinned("0123456789abcdef"), "fija a 01234567");
});

test("I67-6: the screen's words have no ticket keys, branch names or the word sandbox", () => {
  const text = readFileSync(path.resolve(import.meta.dirname, "../ui/src/lib/oficio-trial-words.ts"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(text, /sandbox|\bjl\/|PLA-|\bmain\b/i);
});

test("I67-6: the trial's CSS sits inside the Oficio block, before the phone rules", () => {
  const css = readFileSync(path.resolve(import.meta.dirname, "../ui/src/corriente.css"), "utf8");
  const at = css.indexOf(".ofi-trial {");
  assert.ok(at > 0 && at < css.indexOf("/* ---- PLA-I3-7"));
});
