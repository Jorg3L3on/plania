// PLA-I67-4: references on «Oficio», without a browser: what a paste or a drop is taken for, the refusals said before
// sending, which rows the drawing keeps, and the line a delivery's readout says about what its runs carried and opened.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deliveryRefs, pastedUrl, precheck, refRoom, refRows, type Reference, type SeatRun } from "../ui/src/lib/references.js";
import { REFERENCE_UI_WORDS } from "../ui/src/lib/references-words.js";

const ref = (id: string, over: Partial<Reference> = {}): Reference => ({
  id,
  kind: "image",
  title: id,
  url: null,
  host: null,
  snapshot_at: null,
  snapshot_chars: 0,
  fetch_status: null,
  fetch_error: null,
  file_url: `/f/${id}`,
  mime: "image/png",
  bytes: 10,
  original_bytes: 20,
  width: 1440,
  height: 900,
  tokens: 1728,
  pages: null,
  note: "",
  stance: "follow",
  applies: "always",
  scope: "agent",
  state: "on",
  mine: true,
  created_at: "2026-11-19T10:00:00Z",
  uses: { runs_carried: 0, runs_opened: 0, deliveries_carried: 0, deliveries_opened: 0 },
  ...over,
});

test("I67-4: a pasted line is a link only when it is one http(s) address", () => {
  assert.equal(pastedUrl("  https://linear.app/changelog  "), "https://linear.app/changelog");
  assert.equal(pastedUrl("http://a.test"), "http://a.test/");
  assert.equal(pastedUrl("mira esto https://a.test"), null);
  assert.equal(pastedUrl("javascript:alert(1)"), null);
  assert.equal(pastedUrl("file:///etc/hosts"), null);
  assert.equal(pastedUrl(""), null);
});

test("I67-4 #3: the screen refuses before sending what is over 5 MB or plainly another type; an unknown type goes to the server", () => {
  assert.equal(precheck({ size: 5 * 1024 * 1024 + 1, type: "image/png" }), "big");
  assert.equal(precheck({ size: 100, type: "image/gif" }), "type");
  assert.equal(precheck({ size: 100, type: "application/pdf" }), null);
  assert.equal(precheck({ size: 100, type: "" }), null);
});

test("I67-4: the drawing keeps the references that are on first and cuts to its room with «y N más»", () => {
  const list = [ref("a", { state: "off" }), ref("b"), ref("c"), ref("d")];
  assert.deepEqual(refRows(list, 5).shown.map((r) => r.id), ["b", "c", "d", "a"]);
  const cut = refRows(list, 3);
  assert.deepEqual(cut.shown.map((r) => r.id), ["b", "c"]);
  assert.equal(cut.more, 2);
  assert.equal(refRoom(9, 0), 0, "no references, no rows");
  assert.equal(refRoom(9, 10), 3, "a third of the room");
  assert.equal(refRoom(9, 2), 2);
  assert.equal(refRoom(2, 5), 0, "no room on a tiny drawing");
});

test("I67-4 #4: a delivery's readout says how many references its runs carried and opened", () => {
  const runs: SeatRun[] = [
    { run_id: "1", task_key: "K-1", status: "ok", at: "x", references: [{ id: "a", title: "A", kind: "image", stance: "follow", opened: false }, { id: "b", title: "B", kind: "link", stance: "avoid", opened: false }] },
    { run_id: "2", task_key: "K-1", status: "ok", at: "x", references: [{ id: "a", title: "A", kind: "image", stance: "follow", opened: true }] },
    { run_id: "3", task_key: "K-2", status: "ok", at: "x", references: [{ id: "a", title: "A", kind: "image", stance: "follow", opened: false }] },
  ];
  const by = deliveryRefs(runs);
  assert.deepEqual(by.get("K-1"), { carried: 2, opened: 1 });
  assert.deepEqual(by.get("K-2"), { carried: 1, opened: 0 });
  const es = REFERENCE_UI_WORDS.es;
  assert.equal(es.runLine(2, 1), "Llevaba 2 referencias y abrió 1.");
  assert.equal(es.runLine(1, 0), "Llevaba 1 referencia y no abrió ninguna.");
  assert.equal(es.runLine(0, 0), "");
  assert.equal(REFERENCE_UI_WORDS.en.runLine(3, 0), "It carried 3 references and opened none.");
});

test("I67-4 #5: the card's lines: size and token cost, the use count, follow or avoid", () => {
  const es = REFERENCE_UI_WORDS.es;
  assert.equal(es.size(1440, 900, 1728), "1,440 × 900 · ~1,728 tokens");
  assert.equal(es.uses(7, 9), "La abrió en 7 de 9 entregas desde que la guardaste.");
  assert.equal(es.uses(1, 1), "La abrió en 1 de 1 entrega desde que la guardaste.");
  assert.deepEqual([es.follow, es.avoid], ["Seguir", "Evitar"]);
  assert.equal(es.pages(3), "PDF · 3 páginas");
});
