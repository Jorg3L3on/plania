// PLA-91 (guided test PLA-86, F-14): the delivery card follows the copy while it starts and shows its state outside
// the «Más» menu. The proxy half (Origin/Referer) is in i52-vivo.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("PLA-91: the card polls the copy while it starts and says its state in the open", async () => {
  const src = await readFile(new URL("../ui/src/components/corriente/entrega.tsx", import.meta.url), "utf8");
  assert.match(src, /if \(live\?\.phase !== "starting"\) return;/);
  assert.match(src, /api\s*\.entregaEstado\(p\.slug\)/);
  assert.match(src, /clearInterval/);
  for (const state of ["starting", "live", "abierta", "failed"]) assert.match(src, new RegExp(`data-copia="${state}"`), state);
  const api = await readFile(new URL("../ui/src/lib/api.ts", import.meta.url), "utf8");
  assert.match(api, /entregaEstado: \(slug: string\) => request<\{ entrega: EntregaRead \| null \}>\("GET", `\/projects\/\$\{encodeURIComponent\(slug\)\}\/entrega`\)/);
});
