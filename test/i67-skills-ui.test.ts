// PLA-I67-2: the skill card on the screen, without a browser: the diff between two versions (and only the changed
// lines with their neighbours), «Para quién» narrowest first, the card's top line, a version's note, the refusal a save
// shows, and an owner skill reading by its own name.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cardHead, changedOnly, draftChanged, lineDiff, saveError, scopeOptions, versionDiff, versionNote } from "../ui/src/lib/oficio-skills.js";
import { skillWords } from "../ui/src/lib/oficio.js";

test("PLA-I67-2: the line diff keeps common lines and marks what was taken out and put in", () => {
  assert.deepEqual(lineDiff("a\nb\nc", "a\nx\nc"), [
    { kind: "same", text: "a" },
    { kind: "del", text: "b" },
    { kind: "add", text: "x" },
    { kind: "same", text: "c" },
  ]);
  assert.deepEqual(lineDiff("", "one"), [
    { kind: "del", text: "" },
    { kind: "add", text: "one" },
  ]);
  assert.deepEqual(lineDiff("same", "same"), [{ kind: "same", text: "same" }]);
  const v1 = { name: "Boceto", description: "Cuando hay pantalla.", body: "1\n2\n3\n4\n5\n6\n7" };
  const v2 = { ...v1, body: "1\n2\n3\n4\nCinco\n6\n7" };
  const short = changedOnly(versionDiff(v1, v2));
  assert.deepEqual(short, [{ kind: "gap" }, { kind: "same", text: "4" }, { kind: "del", text: "5" }, { kind: "add", text: "Cinco" }, { kind: "same", text: "6" }]);
  assert.deepEqual(changedOnly(versionDiff(v1, v1)), [], "no change, nothing to show");
});

test("PLA-I67-2: «Para quién» goes from one agent to every agent; the card's head names whose it is", () => {
  assert.deepEqual(
    scopeOptions("Artist", "es").map((o) => [o.value, o.label]),
    [
      ["agent", "Solo Artist en este proyecto"],
      ["project", "Todo el equipo de este proyecto"],
      ["seat", "Artist en todos los proyectos"],
      ["company", "Todos los agentes"],
    ],
  );
  assert.equal(cardHead({ source: "owner", origin: "owner", n: 3 }, "es"), "Habilidad tuya · v3");
  assert.equal(cardHead({ source: "owner", origin: "factory-copy", n: 2 }, "es"), "Tu versión · v2");
  assert.equal(cardHead({ source: "kit", origin: null, n: null }, "es"), "De fábrica");
  assert.equal(versionNote({ note: "rollback:2" }, "es"), "vuelta a la 2");
  assert.equal(versionNote({ note: "factory" }, "es"), "copia de fábrica");
  assert.equal(versionNote({ note: null }, "es"), null);
});

test("PLA-I67-2: a refused save says why in words; a draft knows when it changed", () => {
  assert.equal(saveError("SKILL_NOT_ALLOWED", "body", "es"), "Solo texto: sin scripts, hooks ni permisos de herramientas.");
  assert.equal(saveError("SKILL_INVALID", "description", "es"), "Revisa cuándo la usa (hasta 1024 letras, sin < ni >).");
  assert.equal(saveError("SKILL_EXISTS", null, "es"), "Ya hay una habilidad con ese nombre.");
  assert.equal(saveError(null), null);
  const card = { name: "Boceto", when: "Cuando hay pantalla.", body: "Pasos", scope: "agent" as const };
  assert.equal(draftChanged(card, { name: "Boceto", description: "Cuando  hay pantalla. ", body: "Pasos\n", scope: "agent" }), false);
  assert.equal(draftChanged(card, { name: "Boceto", description: "Cuando hay pantalla.", body: "Pasos", scope: "seat" }), true);
});

test("PLA-I67-2: the owner's own skill reads by its own name; a factory copy that kept its slug as name reads as the factory one", () => {
  assert.equal(skillWords({ slug: "tdd", name: "Primero la prueba, a mi modo", when: "x", source: "owner" }, "es").name, "Primero la prueba, a mi modo");
  assert.notEqual(skillWords({ slug: "tdd", name: "tdd", when: "x", source: "owner" }, "es").name, "tdd");
  assert.notEqual(skillWords({ slug: "tdd", name: "tdd", when: "x", source: "kit" }, "es").name, "tdd");
});
