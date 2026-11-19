// NEWPROJ-2: the sheet «Nuevo proyecto» says why nothing was created in plain Spanish, naming the seats with no
// prompt (ui/src/lib/nuevo-proyecto.ts). Pure, no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import { nuevoProyectoError } from "../ui/src/lib/nuevo-proyecto.js";

const NO_CODE = /\b[A-Z]{2,}_[A-Z_]+\b/;

test("NEWPROJ-2: a missing prompt names the seats and says nothing was created", () => {
  assert.equal(nuevoProyectoError("PROMPT_DOC_MISSING", { seats: ["taller"] }), "No se creó nada: Taller no tiene su texto de instrucciones.");
  assert.equal(
    nuevoProyectoError("PROMPT_DOC_MISSING", { seats: ["product-owner", "research", "artist"] }),
    "No se creó nada: PO, Research y Artist no tienen su texto de instrucciones.",
  );
  assert.match(nuevoProyectoError("PROMPT_DOC_MISSING"), /^No se creó nada/);
});

test("NEWPROJ-2: no refusal shows a code in capitals", () => {
  const cases: [string | null, Record<string, unknown>?][] = [
    ["PROMPT_DOC_MISSING", { seats: ["product-owner", "research", "artist", "taller"] }],
    ["PROMPT_DOC_MISSING", {}],
    ["PROJECT_EXISTS", { slug: "cafe" }],
    ["KEY_PREFIX_TAKEN", { field: "key_prefix" }],
    ["INVALID_BODY", { field: "name" }],
    ["HTTP_500", {}],
    [null],
  ];
  for (const [code, detail] of cases) {
    const line = nuevoProyectoError(code, detail);
    assert.doesNotMatch(line, NO_CODE, line);
    assert.doesNotMatch(line, /HTTP|\(/, line);
  }
});
