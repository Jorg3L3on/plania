// PLA-I2-10, the server's side: its sentences follow the install's language (Spanish unchanged), each run is told
// the owner's language, and no server code finds a ticket or a note by matching a Spanish sentence, apart from the
// documented fallbacks for rows written before the fields existed.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";
import { lookupsUnder } from "./spanish-lookups.js";

useTestEnv();
const { isWords } = await import("../ui/src/lib/i18n.js");
const { resetLanguage } = await import("../src/language.js");
const { resetOwnerName } = await import("../src/owner.js");
const { summarize, SUMMARY } = await import("../src/mcp/summary.js");
const { HELD_WORDS, heldText } = await import("../src/runner/admission.js");
const { READY_WORDS, readinessOf } = await import("../src/mcp/readiness.js");
const { PROGRESS_WORDS } = await import("../src/mcp/progress.js");
const { PUSH_WORDS, messageFor } = await import("../src/jobs/push.js");
const { FOOTPRINT_WORDS } = await import("../src/mcp/footprint-audit.js");
const { FAILED_WORDS } = await import("../src/runner/failed.js");
const { THREAD_ACTION_WORDS } = await import("../src/api/thread-actions.js");
const { ORDER_WORDS } = await import("../src/api/company-actions.js");
const { ideaScope } = await import("../src/api/company-pedidos.js");
const { CONSULTA_WORDS } = await import("../src/pedidos/consultas.js");
const { IMAGE_WORDS } = await import("../src/pedidos/images.js");
const { FRAME_WORDS } = await import("../src/pedidos/frames.js");
const { MACHINE_WORDS } = await import("../src/maquinas/machines.js");
const { LIMITS_WORDS, limitsPage } = await import("../ui/src/lib/limites.js");
const { languageLine, ownerLanguage } = await import("../src/runner/owner-language.js");
const runner = await import("../src/runner/runner.js");
const { orderText } = await import("../src/api/company-decisions.js");
const { askedText } = await import("../src/api/company-pedido.js");
const { isUnderstood } = await import("../src/api/understood.js");
const { legTitleOf } = await import("../src/mcp/proposals.js");
const { RESPUESTA } = await import("../src/captures/preguntas.js");
const { makeDb } = await import("../src/db/client.js");
const { createTask, setTask } = await import("../src/mcp/writes.js");
const { webCtx } = await import("../src/mcp/tx.js");

const MODULES = { SUMMARY, HELD_WORDS, READY_WORDS, PROGRESS_WORDS, PUSH_WORDS, FOOTPRINT_WORDS, FAILED_WORDS, THREAD_ACTION_WORDS, ORDER_WORDS, CONSULTA_WORDS, IMAGE_WORDS, FRAME_WORDS, MACHINE_WORDS, LIMITS_WORDS };
const SPANISH_MARKS = /[áéíóúñ¿¡]/;

function inLanguage<T>(lang: "es" | "en", fn: () => T): T {
  const was = process.env.PLANIA_LANGUAGE;
  process.env.PLANIA_LANGUAGE = lang;
  try {
    return fn();
  } finally {
    if (was === undefined) delete process.env.PLANIA_LANGUAGE;
    else process.env.PLANIA_LANGUAGE = was;
  }
}

// Every key path (functions and arrays are leaves).
function keyPaths(v: unknown, at = ""): string[] {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return [at];
  return Object.keys(v as object).sort().flatMap((k) => keyPaths((v as Record<string, unknown>)[k], `${at}.${k}`));
}

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  resetLanguage();
  resetOwnerName(null);
});
after(async () => {
  await raw.end();
});

// ---- server sentences

test("every server wording module has the same keys in both languages", () => {
  for (const [name, w] of Object.entries(MODULES)) {
    assert.ok(isWords(w), `${name} is made with defineWords`);
    assert.deepEqual(keyPaths(w.en), keyPaths(w.es), name);
  }
});

test("event lines follow the language; the Spanish is unchanged", () => {
  const ev = { type: "task.status", task_key: "ZIG-1", actor: { agent: "taller", session_id: "s" }, payload: { from: "Ready", to: "In review" } };
  assert.equal(inLanguage("es", () => summarize(ev)), "ZIG-1 → In review (desde Ready) (taller)");
  assert.equal(inLanguage("en", () => summarize(ev)), "ZIG-1 → In review (from Ready) (taller)");
  const asked = { type: "question.asked", task_key: "ZIG-1", actor: { agent: "po", session_id: "s" }, payload: { question: "¿Cuál?" } };
  assert.equal(inLanguage("es", () => summarize(asked)), "ZIG-1 pregunta al dueño: ¿Cuál?");
  assert.equal(inLanguage("en", () => summarize(asked)), "ZIG-1 question for the owner: ¿Cuál?");
  // Every event type has an English line with no Spanish of its own.
  for (const type of Object.keys(SUMMARY.en.lines)) {
    const line = inLanguage("en", () => summarize({ type, task_key: "K-1", actor: { agent: "owner", session_id: "s" }, payload: { title: "t", to: "Done", from: "Ready", text: "x", reason: "r", branch: "b" } }));
    assert.equal(SPANISH_MARKS.test(line), false, `${type}: ${line}`);
  }
});

test("held reasons, readiness, push notices and the limits page follow the language", () => {
  assert.equal(inLanguage("es", () => heldText("rest")), "Descansa entre corridas");
  assert.equal(inLanguage("en", () => heldText("rest")), "Resting between runs");
  const input = { tickets: [], initiatives: [], decisions: [], lastEventAt: null, nextClaimableKey: null, headlineStale: false, deployFailed: false, envBehind: false, envUnknown: false } as never;
  assert.equal(inLanguage("es", () => readinessOf(input)).line, "No hay contexto reciente para retomar.");
  assert.equal(inLanguage("en", () => readinessOf(input)).line, "No recent context to pick up.");
  const item = { kind: "question", group: "decisiones", project: "zigzag", key: "ZIG-1", why: "x", title: "x", id: "1" } as never;
  assert.equal(inLanguage("es", () => messageFor([item], new Map())).title, "Te preguntan");
  assert.equal(inLanguage("en", () => messageFor([item, item], new Map())).title, "Your turn: 2 decisions");
  const limits = { groups: [{ id: "force-push", does: ["force-push"], rules: 1 }], everyRun: ["force-push"], outbound: [{ id: "claude", optional: false }], worktrees: "/w", isolation: null };
  const en = limitsPage(limits, "en");
  assert.equal(en.never[0]!.title, "Never rewrite what was already pushed");
  for (const t of [...en.never.flatMap((g) => [g.title, g.lead, ...g.items]), ...en.where, ...en.cannot, ...en.owner_only]) assert.equal(SPANISH_MARKS.test(t), false, t);
  assert.equal(limitsPage(limits).never[0]!.title, "Nunca reescribir lo que ya se subió", "Spanish by default");
});

test("an order's and an idea's scope follow the language and carry the owner's words unchanged", () => {
  const es = inLanguage("es", () => ORDER_WORDS.es.scope("Quiero un botón", "Compañía", null, false));
  assert.match(es, /^Pedido del dueño desde Compañía: "Quiero un botón"/);
  const en = inLanguage("en", () => ideaScope("I want a button"));
  assert.match(en, /^Request from the owner via Company \(Shape it\): "I want a button"/);
  assert.match(en, /`Understood: …`/);
});

// ---- check 3: each run is told the owner's language

test("check 3: the run's prompt names the owner's language (Spanish by default, English when chosen)", () => {
  const input = { agent: "taller-zig", role: "taller", project: { slug: "zigzag", title: "Zigzag" }, goal: null, task: { key: "ZIG-1", title: "x" }, workspace: null, sessionId: "s" };
  const es = inLanguage("es", () => runner.userPrompt(input));
  const en = inLanguage("en", () => runner.userPrompt(input));
  assert.ok(es.includes("in plain Spanish"), "Spanish install");
  assert.ok(en.includes("in plain English"), "English install");
  assert.equal(en.includes("in plain Spanish"), false);
  assert.equal(inLanguage("en", () => ownerLanguage()), "English");
  assert.equal(inLanguage("es", () => languageLine()), languageLine("Spanish"));
});

// ---- check 5: nothing found by a Spanish sentence

// Each place that still reads stored text by Spanish words, and why it may. Anything new fails the test.
const ALLOWED: Record<string, string> = {
  "src/runner/runner.ts|Cambios que pide": "fallback: owner's requests for changes written before the owner_changes field (read only when the field is absent)",
  "src/api/company-decisions.ts|Pedido de": "fallback: orders made before tasks.owner_words (orderText reads the field first)",
  "src/api/company-pedido.ts|Darle forma": "fallback: ideas made before tasks.owner_words (askedText reads the field first)",
  "src/api/company-pedido.ts|De Compañía": "fallback: screen notes written before the note's kind field",
  "src/api/company-pedido.ts|Constrúyelo": "fallback: «Constrúyelo» notes written before the note's kind field",
  "src/api/company-pedido.ts|pide cambios en": "fallback: answer notes written before the note's kind field",
  "src/api/company-pedido.ts|Descartada por": "fallback: discard notes written before the note's kind field",
  "src/api/understood.ts|entend": "marker word the PO is told to write, read in both languages (Entendí / Understood)",
  "src/captures/preguntas.ts|Respuesta": "marker word the run is told to write, read in both languages (Respuesta / Answer)",
  "src/mcp/proposals.ts|Planea": "marker word of a leg order, read in both languages (Planea / Plan)",
  "src/api/company-decisions.ts|recomend": "reads the PO's recommendation in its own proposal text, in both languages; finds no ticket or note",
  "src/api/company-decisions.ts|recomiendo": "the same, the line that names the recommended option",
  "src/api/company-idea.ts|opci": "reads the option number in research's recommendation, in both languages",
  "src/captures/probador.ts|muestra un error": "reads the capture's own error text (src/captures/run.ts), not a ticket or a note",
  "src/mcp/audit.ts|no antes": "a scope heuristic with its words in both languages; finds no ticket or note",
  "src/mcp/owner-lines.ts|ÁÉÍÓÚ": "splits sentences at Spanish capitals and question marks, any language",
  "src/mcp/proposals.ts|¿": "drops an opening question mark",
  "src/mcp/stage-docs.ts|ninguno": "placeholder words in both languages",
  "src/mcp/stage-docs.ts|cuando": "vague answers in both languages",
  "src/runner/packs.ts|cu[aá]ndo": "the When: line of a skill pack, both languages",
  "src/runner/retro.ts|contraseña": "secret redaction words, both languages",
  "src/mcp/checks.ts|visual(?:es": "PLA-I74-11: which checks are visual, words in both languages; finds no ticket or note",
  "src/captures/vacios.ts|vac[ií]": "PLA-I74-10: tells an empty-state frame by Artist's own words, in both languages; finds no ticket or note",
};

test("check 5: no server code finds a ticket or a note by a Spanish sentence, apart from the listed fallbacks and markers", () => {
  const found = lookupsUnder(path.resolve(import.meta.dirname, ".."));
  const unexplained = found.filter((l) => !Object.keys(ALLOWED).some((k) => k.split("|")[0] === l.file && l.text.includes(k.split("|")[1]!)));
  assert.deepEqual(unexplained.map((l) => `${l.file}:${l.line} ${l.text.slice(0, 80)}`), []);
  // The list only names places that are still there.
  for (const k of Object.keys(ALLOWED)) assert.ok(found.some((l) => k.split("|")[0] === l.file && l.text.includes(k.split("|")[1]!)), `stale allow-list entry ${k}`);
});

test("check 5: markers read in both languages", () => {
  assert.ok(isUnderstood("Entendí: un botón") && isUnderstood("Understood: a button"));
  assert.ok(RESPUESTA.test("Respuesta: sí") && RESPUESTA.test("Answer: yes"));
  assert.equal(legTitleOf("Planea «Pagos»: sus pasos"), "Pagos");
  assert.equal(legTitleOf("Plan «Payments»: its steps"), "Payments");
});

test("check 5: the owner's words are fields; old rows still read through the fallback", async () => {
  assert.equal(orderText({ scope: 'Pedido del dueño desde Compañía: "viejo"', title: "t", ownerWords: null }), "viejo");
  assert.equal(orderText({ scope: "Request from the owner via Company: whatever", title: "t", ownerWords: "new words" }), "new words");
  assert.equal(askedText('Pedido del dueño desde Compañía (Darle forma): "vieja"\n', "t"), "vieja");
  assert.equal(askedText("Request from the owner via Company (Shape it): …", "t", "new idea"), "new idea");

  // The screen's order stores owner_words; an agent's create_task cannot.
  const screen = (await createTask(db, { project: "zigzag", title: "Pedido", scope: "s", status: "Ready", work_type: "research", owner_words: "I want a button" } as never, { ...webCtx, tool: "test" })) as { key: string };
  const agent = (await createTask(db, { project: "zigzag", title: "Agent", scope: "s", status: "Ready", work_type: "research", owner_words: "forged" } as never, { actor: { agent: "po", session_id: "s1" } })) as { key: string };
  const words = async (k: string) => (await raw.query("select owner_words from tasks where key = $1", [k])).rows[0].owner_words as string | null;
  assert.equal(await words(screen.key), "I want a button");
  assert.equal(await words(agent.key), null);

  // The owner's request for changes, in English, found by its field; an agent's note with the field is ignored.
  const pid = (await raw.query("select id from projects where slug = 'zigzag'")).rows[0].id as string;
  const version = async (k: string) => (await raw.query("select version from tasks where key = $1", [k])).rows[0].version as number;
  await setTask(db, { project: "zigzag", key: screen.key, status: "In review", version: await version(screen.key) } as never, { ...webCtx, tool: "test" });
  await setTask(db, { project: "zigzag", key: screen.key, status: "Ready", version: await version(screen.key), note: "Changes the owner asks for: bigger button", owner_changes: "bigger button" } as never, { ...webCtx, tool: "test" });
  assert.equal(await runner.ownerChangesOf(db, pid, screen.key), "bigger button");
  await setTask(db, { project: "zigzag", key: agent.key, version: await version(agent.key), note: "noise", owner_changes: "forged" } as never, { actor: { agent: "po", session_id: "s1" } });
  assert.equal(await runner.ownerChangesOf(db, pid, agent.key), null);
});

// ---- every server sentence comes from a wording module

const ROOT = path.resolve(import.meta.dirname, "..");
const ALLOW_FILE = path.join(ROOT, "test", "server-words-allow.txt");

test("no Spanish sentence in a string literal under src/ outside a wording module, apart from the allow-list", async () => {
  const { findServerSpanish, readAllow } = await import("../scripts/server-words.js");
  const found = findServerSpanish(ROOT);
  const allow = readAllow(ALLOW_FILE);
  const unexplained = [...found].filter(([f]) => !allow.has(f)).map(([f, list]) => `${f}:${list[0]!.line} ${list[0]!.text.slice(0, 80)}`);
  assert.deepEqual(unexplained, []);
  // Each entry gives its reason and is still needed.
  for (const [f, why] of allow) {
    assert.ok(why.length >= 10, `${f} needs a reason`);
    assert.ok(found.has(f), `stale allow-list entry: ${f}`);
  }
});

test("the detector skips wording modules and comments, and finds a sentence anywhere else", async () => {
  const { serverSpanishIn } = await import("../scripts/server-words.js");
  const src = [
    "// La corrida se detuvo: comentario.",
    "export const W = defineWords({ es: { a: `La corrida de ${x} se detuvo.`, b: \"No hay contexto.\" }, en: { a: `Run ${x} stopped.`, b: \"No context.\" } });",
    "const bad = \"No encuentro la base de datos del proyecto\";",
  ].join("\n");
  assert.deepEqual(serverSpanishIn(src).map((f) => f.line), [3]);
});

test("every wording module under src/ has the same keys in both languages", async () => {
  const { serverFiles } = await import("../scripts/server-words.js");
  const { readFileSync } = await import("node:fs");
  const { pathToFileURL } = await import("node:url");
  let n = 0;
  for (const f of serverFiles(ROOT)) {
    if (!readFileSync(path.join(ROOT, f), "utf8").includes("defineWords(")) continue;
    const mod = (await import(pathToFileURL(path.join(ROOT, f)).href)) as Record<string, unknown>;
    for (const [name, w] of Object.entries(mod)) {
      if (!isWords(w)) continue;
      n += 1;
      assert.deepEqual(keyPaths((w as { en: unknown }).en), keyPaths((w as { es: unknown }).es), `${f} ${name}`);
    }
  }
  assert.ok(n >= 14, `found ${n} exported wording modules`);
});
