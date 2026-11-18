// PLA-96 (guided test PLA-86, F-19): a delivery whose link title is only the ticket key shows the ticket's title.
import assert from "node:assert/strict";
import { test } from "node:test";
import { useTestEnv } from "./helpers.js";

useTestEnv();
const { deliveryTitle } = await import("../src/api/company-decisions.js");

test("PLA-96: the card's title is the link's, or the ticket's when the link only repeats the key", () => {
  const t = { title: "La novia agenda su cita al terminar el registro" };
  assert.equal(deliveryTitle({ ref: "MIA-I10-2", title: "MIA-I10-2" }, t, "Entregué"), t.title, "MIA-I10-2 read its key twice");
  assert.equal(deliveryTitle({ ref: "MIA-I10-2", title: "" }, t, "Entregué"), t.title);
  assert.equal(deliveryTitle({ ref: "MIA-I10-1", title: "Horario de citas" }, t, "x"), "Horario de citas", "an agent's own title stays");
  assert.equal(deliveryTitle(undefined, null, "Primera línea\nsegunda"), "Primera línea");
  assert.equal(deliveryTitle({ ref: "MIA-9", title: "MIA-9" }, null, "x"), "MIA-9", "no ticket found: the key is all there is");
});
