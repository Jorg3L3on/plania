// PLA-I67-1: «Oficio» on the screen, without a browser: the address (inside Equipo, Esc back to Equipo), the
// drawing's rows and threads, where the deliveries sit, the sentence under the switcher, and the list a shelf switch
// saves.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import * as React from "react";
import { atOf, hrefOf, isBuilt, legacyHref } from "../ui/src/lib/corriente.js";
(globalThis as { React?: unknown }).React = React;
const { escFrom } = (await import(new URL("../ui/src/pages/corriente.tsx", import.meta.url).href)) as { escFrom: (at: unknown) => unknown };
import { carriedLine, dayMarks, dotsX, firstPick, headline, labelEvery, rowsOf, shelfNext, skillWords, threadWidth, type OficioDelivery, type OficioSkill } from "../ui/src/lib/oficio.js";
import { KIT_SKILL_WORDS } from "../ui/src/lib/oficio-words.js";

const skill = (slug: string, over: Partial<OficioSkill> = {}): OficioSkill => ({
  slug,
  name: slug,
  when: `When ${slug}`,
  source: "kit",
  version: `${slug}@abcd1234`,
  on: true,
  factory: true,
  runs_carried: 3,
  runs_used: 1,
  deliveries_carried: 3,
  deliveries_used: 1,
  owner: null,
  ...over,
});
const delivery = (key: string, over: Partial<OficioDelivery> = {}): OficioDelivery => ({
  key,
  title: `Entrega ${key}`,
  kind: "ticket",
  status: "Done",
  outcome: "primera",
  closed: true,
  sent_back: 0,
  words: null,
  at: "2026-11-18T10:00:00.000Z",
  runs: 1,
  carried: ["tdd"],
  used: [],
  ...over,
});

// PLA-I71-2: the agent page became the panel beside the org chart. Its old address opens the chart with that seat
// selected; the panel's tab lives in the address; Esc steps back to the chart.
test("I67-1 #1 (PLA-I71-2): the old page's address opens the chart with that seat selected, and Esc goes back to Equipo", () => {
  const at = atOf("?proyecto=tienda&t=equipo&ver=oficio%3Ataller-tienda");
  assert.deepEqual(at.ver, { kind: "miembro", agent: "taller-tienda" });
  assert.equal(at.tab, "equipo");
  assert.ok(isBuilt(at));
  assert.deepEqual(escFrom(at), { slug: "tienda", tab: "equipo" });
  assert.equal(hrefOf({ slug: "tienda", ver: { kind: "miembro", agent: "taller-tienda" }, extra: { ficha: "motor" } }), "/ceo?proyecto=tienda&t=equipo&ver=miembro%3Ataller-tienda&ficha=motor");
  assert.match(legacyHref(at), /member%3Ataller-tienda/);
});

test("I67-1 #1 (PLA-I71-2): the selected seat opens its panel on the chart, its tab from the address", () => {
  const page = readFileSync(path.resolve(import.meta.dirname, "../ui/src/pages/corriente.tsx"), "utf8");
  assert.match(page, /tab=\{fichaTabOf\(new URLSearchParams\(location\.search\)\.get\("ficha"\)\)\}/);
  assert.ok(!/OficioPage/.test(page), "the separate page is gone");
});

test("I67-1 #2: rows are the seat, the skills it carries, then factory skills turned off; cut to fit", () => {
  const skills = [skill("tdd"), skill("pr"), skill("design-it-twice", { on: false, factory: false, runs_carried: 0 }), skill("handoff", { on: false })];
  const rows = rowsOf(skills, 10);
  assert.deepEqual(
    rows.map((r) => (r.kind === "post" ? "post" : `${r.kind}:${r.skill.slug}`)),
    ["post", "skill:tdd", "skill:pr", "off:handoff"],
  );
  assert.equal(rowsOf(skills, 2).length, 2);
  assert.equal(rowsOf([], 0).length, 1, "the seat's own row always shows");
  // Thicker the more it was used.
  assert.equal(threadWidth(0, 5), 1.2);
  assert.ok(threadWidth(5, 5) > threadWidth(1, 5));
  assert.equal(threadWidth(5, 5), 4.5);
});

test("I67-1 #2: deliveries sit oldest on the left; dates thin out when the line is crowded", () => {
  const list = [delivery("C"), delivery("B"), delivery("A")];
  assert.deepEqual(
    dotsX(list, 100, 300).map(({ d, x }) => [d.key, x]),
    [
      ["A", 100],
      ["B", 200],
      ["C", 300],
    ],
  );
  assert.deepEqual(dotsX([delivery("A")], 100, 300).map(({ x }) => x), [300]);
  assert.equal(labelEvery(12, 400), 2);
  assert.equal(labelEvery(5, 400), 1);
  // The readout opens on the newest one that ended, not on work still going.
  assert.equal(firstPick([delivery("D", { outcome: "trabajando", closed: false }), delivery("C", { outcome: "devuelta", closed: false }), delivery("B")]), "C");
  assert.equal(firstPick([delivery("D", { outcome: "trabajando", closed: false })]), "D");
  assert.equal(firstPick([]), null);
});

test("I67-1 #5: the sentence counts skills and deliveries in words, and says when there are none", () => {
  const two = { skills: [skill("tdd"), skill("pr"), skill("x", { on: false })], deliveries: [delivery("A"), delivery("B"), delivery("C")], counts: { closed: 3, first_time: 2, last_five: 3, last_five_first: 2 } };
  assert.deepEqual(headline(two, "Taller", "es"), { lead: "Taller: dos habilidades.", rest: "Tres entregas en tres meses, dos a la primera." });
  assert.deepEqual(headline(two, "Taller", "en"), { lead: "Taller: two skills.", rest: "Three deliveries in three months, two first time." });
  const none = { skills: [skill("x", { on: false })], deliveries: [], counts: { closed: 0, first_time: 0, last_five: 0, last_five_first: 0 } };
  assert.deepEqual(headline(none, "Research", "es"), { lead: "Research: ninguna habilidad.", rest: "Todavía no entrega nada aquí." });
  const one = { skills: [skill("tdd")], deliveries: [delivery("A", { closed: false, outcome: "espera" })], counts: { closed: 0, first_time: 0, last_five: 0, last_five_first: 0 } };
  assert.equal(headline(one, "QA", "es").rest, "Una entrega en tres meses.");
});

test("I67-1 #3: a shelf switch saves what it carries now with that one skill turned on or off", () => {
  assert.deepEqual(shelfNext(["tdd", "pr"], "tdd", false), ["pr"]);
  assert.deepEqual(shelfNext(["pr"], "pr", false), []);
  assert.deepEqual(shelfNext(["pr"], "handoff", true), ["pr", "handoff"]);
  assert.deepEqual(shelfNext(["pr"], "pr", true), ["pr"]);
});

test("I67-1: every skill that comes with Plania has a name and a line in both languages; others keep their own", () => {
  const kit = path.resolve(import.meta.dirname, "../kit/skills");
  for (const slug of readdirSync(kit)) {
    for (const lang of ["es", "en"] as const) {
      const w = (KIT_SKILL_WORDS[lang] as Record<string, { name: string; line: string } | undefined>)[slug];
      assert.ok(w?.name && w.line, `${slug} in ${lang}`);
      assert.ok(w.line.length <= 100, `${slug} line in ${lang} is one short line`);
    }
  }
  assert.deepEqual(skillWords({ slug: "mi-pack", name: "Mi pack", when: "al hacer algo" }, "es"), { name: "Mi pack", line: "al hacer algo" });
  assert.equal(skillWords({ slug: "tdd", name: "tdd", when: "x" }, "es").name, "Construir con pruebas");
  // Used skills are named; one of the machine's own (not on the shelf) is not.
  const skills = [skill("tdd"), skill("pr")];
  assert.equal(carriedLine(delivery("A", { carried: ["tdd", "pr"], used: ["tdd", "pr", "idea-package"] }), skills, "es"), "Llevaba 2 habilidades y usó Construir con pruebas y El PR.");
  assert.equal(carriedLine(delivery("A", { carried: [], used: ["idea-package"] }), skills, "es"), "No llevaba habilidades y no usó ninguna.");
});


test("I67-1 (live check): a date shows once per day, the newest always", () => {
  assert.deepEqual(dayMarks(["18 nov", "18 nov", "18 nov", "18 nov"], 1), [false, false, false, true]);
  assert.deepEqual(dayMarks(["14 nov", "15 nov", "15 nov", "16 nov", "hoy"], 1), [true, true, false, true, true]);
  assert.deepEqual(dayMarks(["1 nov", "2 nov", "3 nov", "4 nov", "5 nov", "6 nov"], 2), [true, false, true, false, false, true]);
});
