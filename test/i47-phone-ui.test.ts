// PLA-I47-6: the phone (390). Reads index.css as the I46 tests do: under 40rem the floor is one column that scrolls as
// a page (never collapsed to zero), the tower is a strip of tiles on top, La ficha is a sheet from the bottom with a
// backdrop that closes it, and the phone bar keeps the move. The width checks ran in the Browser pane (Plania results).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
// Every @media block for a width, flattened to its rules.
const blocks = (query: string) => {
  const out: string[] = [];
  let at = css.indexOf(`@media (${query}) {`);
  while (at >= 0) {
    let depth = 0;
    let i = css.indexOf("{", at);
    const start = i;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) break;
    }
    out.push(css.slice(start + 1, i));
    at = css.indexOf(`@media (${query}) {`, i);
  }
  return out.join("\n");
};

test("I47-6: under 40rem the floor stacks into one column and the page scrolls; the tower is a strip", () => {
  const phone = blocks("width < 40rem");
  assert.match(phone, /\.edi-bld \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(phone, /\.edi:has\(\.edi-bld\) \{ height: auto; min-height: 0; \}/);
  assert.match(phone, /\.edi-bld \{ flex: none; \}/, "the building keeps its height in an auto-height page (it collapsed to 0 without this)");
  assert.match(phone, /\.edi-rail \{ flex-direction: row; overflow-x: auto;/);
  assert.match(phone, /\.edi-fhead \.edi-goal \{ flex-basis: 100%;/);
  const narrow = blocks("width < 48rem");
  assert.match(narrow, /\.edi-fbody \{ grid-template-columns: minmax\(0, 1fr\); grid-template-rows: auto; \}/, "Ahora, Equipo and Pedir, then La fila under them");
});

test("I47-6: La ficha is a bottom sheet with a backdrop that closes it; the phone bar keeps the move", () => {
  const phone = blocks("width < 40rem");
  // PLA-I47-7: above the app's tab bar, and the phone bar steps aside while the sheet is open.
  assert.match(phone, /\.edi-bld > \.edi-ficha \{ top: auto; left: 0; right: 0; bottom: calc\(4\.5rem \+ env\(safe-area-inset-bottom, 0px\)\); width: auto; height: min\(72dvh, 600px\);/);
  assert.match(phone, /\.edi:has\(\.edi-bld\[data-ficha="open"\]\) \.edi-pbar \{ display: none; \}/);
  assert.match(phone, /\.edi-bld\[data-ficha="open"\] > \.edi-scrim:not\(\[hidden\]\) \{ display: block; position: fixed;/);
  const b = readFileSync(new URL("../ui/src/components/compania/edificio/building.tsx", import.meta.url), "utf8");
  assert.ok(b.includes("onClick={onFichaClose}") && b.includes("<PhoneBar"), "the backdrop closes La ficha; the phone bar stays");
  assert.match(phone, /\.edi-nowb \.edi-go\[data-move\], \.edi-tu-go \{ display: none !important; \}/, "the bar carries Ahora's button at 390");
});
