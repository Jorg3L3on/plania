// Gate answers stay the stored English word. The screen only changes how they read.
import assert from "node:assert/strict";
import { test } from "node:test";
import { optionLabel } from "../ui/src/lib/inbox.js";

test("gate options read in Spanish and any other option stays as written", () => {
  assert.deepEqual(
    ["pursue", "drop", "later", "proceed", "rework", "ready"].map(optionLabel),
    ["Seguir", "Soltar", "Después", "Adelante", "Rehacer", "Lista"],
  );
  assert.equal(optionLabel("¿Quién firma el cobro?"), "¿Quién firma el cobro?");
});
