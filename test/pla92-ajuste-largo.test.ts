// PLA-92 (guided test PLA-86, F-16): «Pedir ajuste» took one line cut silently at 300 characters. The note is now a
// text box of NOTE_MAX characters with its line breaks kept; a mark's note goes to MARK_MAX, on screen and on the server.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const ev = (await import(new URL("../ui/src/lib/evidencia.ts", import.meta.url).href)) as Record<string, any>;

test("PLA-92 #1: returnText keeps the note's lines, tidies spaces and fits the server's 2000", () => {
  assert.equal(ev.returnText("No se ve bien", "  1) horas en 24 h  \n\n 2)  casillas   sin nombre "), "No se ve bien: 1) horas en 24 h\n2) casillas sin nombre");
  assert.equal(ev.returnText("Falta algo", "   "), "Falta algo");
  const long = "x".repeat(ev.NOTE_MAX);
  assert.ok(ev.returnText("Otra cosa", long).length <= 2000, "reason plus the longest note stays under the route's limit");
  assert.equal(ev.MARK_MAX, 600);
});

test("PLA-92 #2: the note is a text box with the limit shown near it, and marks take 600 on both sides", async () => {
  const ajuste = await readFile(new URL("../ui/src/components/corriente/ajuste.tsx", import.meta.url), "utf8");
  assert.match(ajuste, /<textarea/);
  assert.match(ajuste, /maxLength=\{NOTE_MAX\}/);
  assert.doesNotMatch(ajuste, /maxLength=\{300\}/);
  const entrega = await readFile(new URL("../ui/src/components/corriente/entrega.tsx", import.meta.url), "utf8");
  assert.match(entrega, /maxLength=\{MARK_MAX\}/);
  const route = await readFile(new URL("../src/api/company.ts", import.meta.url), "utf8");
  assert.match(route, /note: z\.string\(\)\.max\(600\)/);
  const preguntas = await readFile(new URL("../src/captures/preguntas.ts", import.meta.url), "utf8");
  assert.match(preguntas, /\.slice\(0, 600\)/);
});
