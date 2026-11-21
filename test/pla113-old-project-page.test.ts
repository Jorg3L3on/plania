// PLA-113 (guided test PLA-86, F-2): the old project page is reached on purpose only, from Ajustes (PLA-135; it was Archivo) (?pagina). Every
// other /p/<slug> link opens the project in La corriente, and ?task=KEY opens that step, idea or initiative there.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const lib = (await import(new URL("../ui/src/lib/corriente.ts", import.meta.url).href)) as Record<string, any>;

test("PLA-113: /p/<slug> goes to La corriente; ?task opens the thing; ?pagina stays", () => {
  const go = (search: string) => lib.oldProjectHref("mianovia", search);
  assert.equal(go(""), lib.hrefOf({ slug: "mianovia" }));
  assert.equal(go("?task=MIA-38"), lib.hrefOf({ slug: "mianovia", ver: { kind: "paso", key: "MIA-38" } }));
  assert.equal(go("?task=MIA-I10-5"), lib.hrefOf({ slug: "mianovia", ver: { kind: "paso", key: "MIA-I10-5" } }), "a phase is a step");
  assert.equal(go("?task=MIA-I10"), lib.hrefOf({ slug: "mianovia", ver: { kind: "iniciativa", key: "MIA-I10" } }));
  assert.equal(go("?task=MIA-IDEA4"), lib.hrefOf({ slug: "mianovia", ver: { kind: "idea", key: "MIA-IDEA4" } }));
  assert.equal(go("?pagina"), null);
  assert.equal(go("?pagina&task=MIA-38"), null);
  assert.match(go("?task=MIA-38"), /^\/ceo\?proyecto=mianovia/);
});

test("PLA-113: the route uses it, and Ajustes' link asks for the page (PLA-135: it was Archivo's)", async () => {
  const app = await readFile(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /<Route path="\/p\/:slug" element=\{<ProjectRoute \/>\} \/>/);
  assert.match(app, /const to = oldProjectHref\(slug, location\.search\);/);
  const ajustes = await readFile(new URL("../ui/src/components/corriente/ajustes.tsx", import.meta.url), "utf8");
  assert.match(ajustes, /href=\{`\/p\/\$\{encodeURIComponent\(p\.slug\)\}\?pagina`\} data-control="pagina"/);
});
