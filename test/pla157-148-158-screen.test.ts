// PLA-157, PLA-148 (F-3, F-5, F-6), PLA-158 (F-11, F-30): the screen rules found in a real run, tested without a
// browser: the PR chip, «Reabrir», the soft review stops, a request's short name, the Publicar list without keys and
// the secrets covered in «Respuestas a tus preguntas».
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const paso = await load("lib/paso.ts");
const ficha = await load("lib/ficha.ts");
const nombre = await load("lib/nombre.ts");
const redact = await load("lib/redact.ts");
const { words } = await load("lib/i18n.ts");
const { TABLERO_WORDS } = await load("lib/tablero-words.ts");
const { FICHA_WORDS } = await load("lib/ficha-words.ts");
const src = (p: string) => readFileSync(new URL(`../ui/src/${p}`, import.meta.url), "utf8");

test("PLA-157 (a): the PR chip follows the PR's own state; the status only when the state is unknown", () => {
  assert.equal(paso.prChip("Done", "open"), "open", "a Done step with its PR still open is not «Fusionado»");
  assert.equal(paso.prChip("Done", "OPEN"), "open");
  assert.equal(paso.prChip("In review", "merged"), "merged");
  assert.equal(paso.prChip("Won't do", "closed"), "closed");
  assert.equal(paso.prChip("Done", null), "merged");
  assert.equal(paso.prChip("Released", undefined), "merged");
  assert.equal(paso.prChip("In review", null), "open");
  assert.equal(paso.prChip("In review", "draft"), "open", "an unknown state falls back to the status rule");
  for (const lang of ["es", "en"]) assert.ok(words(TABLERO_WORDS, lang).closedPr, `closedPr in ${lang}`);
  assert.equal(words(TABLERO_WORDS, "es").closedPr, "Cerrado");
});

test("PLA-157 (b): «Reabrir» shows on a closed step only and sends it back to In review with a reason", () => {
  assert.equal(paso.canReopen({ kind: "ticket", status: "Done" }), true);
  assert.equal(paso.canReopen({ kind: "ticket", status: "Won't do" }), true);
  for (const status of ["Backlog", "Ready", "In progress", "In review", "Merged", "Released", "Blocked", "Needs owner"]) assert.equal(paso.canReopen({ kind: "ticket", status }), false, status);
  assert.equal(paso.canReopen({ kind: "initiative", status: "Done" }), false, "an initiative is not reopened from a step's view");
  assert.equal(paso.canReopen({ kind: "idea", status: "Done" }), false);
  assert.equal(paso.REOPEN_TO, "In review");
  assert.deepEqual(paso.reopenPatch("  el PR sigue abierto ", 7, true), { status: "In review", reason: "el PR sigue abierto", version: 7 });
  assert.equal(paso.reopenPatch("   ", 7, true), null, "the lifecycle's reopen needs a reason");
  // PLA-160 (F-34): no muestra, no delivery card to bring back: the step goes to Ready to be redone.
  assert.deepEqual(paso.reopenPatch("no se arregló", 7, false), { status: "Ready", reason: "no se arregló", version: 7 });
  assert.equal(paso.reopenTo(true), "In review");
  assert.equal(paso.reopenTo(false), "Ready");
  for (const lang of ["es", "en"]) for (const k of ["reopen", "reopenLabel", "reopenHint", "reopenPlaceholder", "reopened", "reopenFailed", "reopenRedoHint", "reopenedRedo"]) assert.ok(words(TABLERO_WORDS, lang)[k], `${k} in ${lang}`);
  assert.equal(words(TABLERO_WORDS, "es").reopen, "Reabrir");
});

test("PLA-157 (b): the move «Reabrir» sends is one the lifecycle takes from the owner's screen with a reason", async () => {
  const lc = (await import(new URL("../src/mcp/lifecycle.ts", import.meta.url).href)) as Record<string, any>;
  for (const from of ["Done", "Won't do"]) {
    assert.equal(lc.actionForMove(from, paso.REOPEN_TO), "reopen");
    assert.equal(lc.assertTransition("ticket", from, paso.REDO_TO, { human: true, reason: "rehacer" }), true, "PLA-160: reopening to Ready is allowed too");
    assert.equal(lc.assertTransition("ticket", from, paso.REOPEN_TO, { human: true, reason: "el PR sigue abierto" }), true);
    assert.throws(() => lc.assertTransition("ticket", from, paso.REOPEN_TO, { human: true, reason: "" }), /HUMAN_ONLY/);
  }
});

test("PLA-148 (F-3): the soft stops read «Para revisar», never «Te toca»", () => {
  for (const s of ["entendido", "investigacion", "diseno", "plan"]) assert.equal(ficha.stopBar(s), "review", s);
  assert.equal(ficha.stopBar("lista"), "you", "«Constrúyelo» waits on him");
  assert.equal(words(FICHA_WORDS, "es").toReview, "Para revisar");
  assert.equal(words(FICHA_WORDS, "en").toReview, "To review");
  // Each soft stop's bar takes its label from the rule, not from yourTurn.
  const f = src("components/corriente/ficha.tsx");
  const block = f.slice(f.indexOf("// The chosen stop's answer"), f.indexOf("// Nothing to answer here"));
  assert.ok(!block.includes("label={w.yourTurn}"), "no soft stop bar says «Te toca»");
  assert.equal((block.match(/label=\{bar\.label\}/g) ?? []).length, 4);
});

test("PLA-148 (F-5): Investigación takes his own correction, and a sent note says it went", () => {
  const f = src("components/corriente/ficha.tsx");
  const inv = f.slice(f.indexOf('if (s.stop === "investigacion"'), f.indexOf('if (s.stop === "diseno"'));
  assert.match(inv, /aria-label=\{w\.researchWrongLabel\}/);
  assert.match(inv, /verdict: "cambios", text/);
  assert.match(inv, /verdict: "opcion", option: pick, text/);
  assert.equal(words(FICHA_WORDS, "es").noteSent, "Enviada: la leen en su siguiente turno.");
  assert.ok(words(FICHA_WORDS, "en").noteSent);
  for (const lang of ["es", "en"]) for (const k of ["researchWrongLabel", "researchCorrectHere"]) assert.ok(words(FICHA_WORDS, lang)[k], `${k} in ${lang}`);
});

test("PLA-148 (F-6): a request's name is its first sentence, at most 48 characters, cut on a word", () => {
  const n = nombre.ideaName;
  assert.equal(n("Catálogo de productos con favoritos. La tienda sube sus productos desde el pane…"), "Catálogo de productos con favoritos");
  assert.equal(n("Una idea corta"), "Una idea corta");
  assert.equal(n("Agenda: citas por día con recordatorio"), "Agenda: citas por día con recordatorio", "a first sentence too short to name anything keeps going");
  const long = n("Quiero que la página de inicio muestre los últimos pedidos de cada cliente con su estado y fecha");
  assert.equal(long, "Quiero que la página de inicio muestre los…");
  assert.ok(long.length <= 49);
  assert.ok(!/\s…$/.test(long));
  assert.equal(n("v2.0 del panel de control"), "v2.0 del panel de control", "a period inside a word does not end the sentence");
  assert.equal(n("  espacios   de   más.  "), "espacios de más");
  assert.equal(n(""), "");
  assert.equal(n(null), "");
  const word = n("Supercalifragilisticoexpialidosomuchomaslargoquecuarentayocho");
  assert.ok(word.endsWith("…") && word.length <= 49, "one long word is cut at the limit");
});

test("PLA-158 (F-30): the Publicar sheet lists the changes by title, without ticket keys", () => {
  const h = src("components/corriente/hojas.tsx");
  const list = h.slice(h.indexOf("data-publish-list"), h.indexOf("andMore(n - 4)"));
  assert.ok(!list.includes("<Key>"), "no key beside a change");
  assert.match(list, /\{x\.title\}/);
});

test("PLA-158 (F-11): secret-looking parts of an old question are covered", () => {
  const r = redact.redactSecrets;
  const M = redact.MASK;
  assert.equal(r("Entra con password Hunter2 y revisa el panel"), `Entra con password ${M} y revisa el panel`);
  assert.equal(r("mi contraseña es gato123."), `mi contraseña es ${M}`);
  assert.equal(r("contraseña: perro"), `contraseña: ${M}`);
  assert.equal(r("the password is 'swordfish'"), `the password is '${M}'`);
  assert.equal(r("clave=abc"), `clave=${M}`);
  assert.equal(r("Secret=s3cr3t; y sigue"), `Secret=${M}; y sigue`);
  assert.equal(r("api key: XYZ"), `api key: ${M}`);
  assert.equal(r("token ghp_abcdefghijklmnop1234"), `token ${M}`);
  assert.equal(r("usa sk-ant-api03-abcdefgh123 para probar"), `usa ${M} para probar`);
  assert.equal(r("hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 ok"), `hash ${M} ok`);
  assert.equal(r("eyJhbGciOiJIUzI1NiJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0"), M);
  // Ordinary words stay.
  for (const s of ["¿cuántos tokens gastamos esta semana?", "la clave del éxito", "Cambia la clave del wifi", "¿Qué falta para publicar?", "unacadenamuylargadeletrassinnumerosparanadaquever"]) assert.equal(r(s), s, s);
  assert.equal(r(null), "");
  const t = src("components/corriente/tetoca.tsx");
  assert.match(t, /redactSecrets\(c\.text\)/);
  assert.match(t, /redactSecrets\(c\.answer!\.short\)/);
});
