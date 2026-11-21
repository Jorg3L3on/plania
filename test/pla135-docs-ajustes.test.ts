// PLA-135: Archivo is gone; the project's own docs live in Ajustes («Docs del proyecto»): the three context notes every
// run reads, and the library the team looks up. The read and the save run against the test database; the band and the
// reader are rendered server-side with fake reads, and the address model is called directly. Nothing real runs.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type pg from "pg";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resetTestDb, useTestEnv } from "./helpers.js";

const TMP = mkdtempSync(path.join(tmpdir(), "plania-pla135-"));
const kit = path.join(TMP, "kit");
mkdirSync(path.join(kit, "roles"), { recursive: true });
for (const r of ["product-owner", "research", "artist", "taller"]) writeFileSync(path.join(kit, "roles", `${r}.md`), `# ${r}\n\nFixture prompt.\n`);
cpSync(path.resolve(import.meta.dirname, "../kit/context"), path.join(kit, "context"), { recursive: true });
process.env.PLANIA_KIT_DIR = kit;
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
delete process.env.PLANIA_PROMPTS_PROJECT;
useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { setNewProjectRepoCheck } = await import("../src/api/company.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { firstLine, notLibrary } = await import("../src/api/project-settings.js");
type SettingsRead = import("../src/api/project-settings.js").SettingsRead;

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/docs-proyecto.ts");
const corr = await load("lib/corriente.ts");
const comp = await load("components/corriente/docs-proyecto.tsx");
const h = React.createElement;

let raw: pg.Client;
let closeDb: () => Promise<void>;
const SLUG = "recetario";
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const base = `/api/company/projects/${SLUG}/settings`;
const put = (p: string, body: unknown) => app.request(`${base}${p}`, { method: "PUT", headers: jorge(), body: JSON.stringify(body) });
const read = async (): Promise<SettingsRead> => (await (await app.request(base, { headers: jorge() })).json()) as SettingsRead;

before(async () => {
  raw = await resetTestDb();
  ({ close: closeDb } = makeDb() as { db: unknown; close: () => Promise<void> });
  setNewProjectRepoCheck({ git: async () => ({ code: 1, stdout: "", stderr: "" }), isDir: () => true });
  const res = await app.request("/api/company/projects", { method: "POST", headers: jorge(), body: JSON.stringify({ name: "Recetario", goal: "Recetas en un minuto.", no_code: true }) });
  assert.equal(res.status, 201, await res.clone().text());
});

after(async () => {
  setNewProjectRepoCheck(null);
  await closeDb?.();
  await raw?.end();
  rmSync(TMP, { recursive: true, force: true });
});

test("PLA-135: the library is the project's own docs, newest first, without the notes, prompts, packs or a thing's papers", async () => {
  const ACT = '{"agent":"t","session_id":"s"}';
  const pid = (await raw.query(`select id from projects where slug = $1`, [SLUG])).rows[0].id as string;
  const doc = (title: string, md: string, hours: number) =>
    raw.query(`insert into docs (project_id, task_id, title, markdown, actor, updated_at) values ($1, null, $2, $3, $4::jsonb, now() - make_interval(hours => $5))`, [pid, title, md, ACT, hours]);
  await doc("Reglas", "# Reglas\n\n- Nada se publica sin **probar** en el celular.", 2);
  await doc("Guía de marca", "Rosa palo.", 1);
  await doc("Context: Glossary", "# Glosario\n\nx", 0);
  await doc("Prompt: Taller", "# Taller", 0);
  await doc("Pack: diseño", "# Pack", 0);
  const a = await read();
  assert.deepEqual(a.library.map((d) => d.title), ["Guía de marca", "Reglas"]);
  assert.equal(a.library[1]!.first, "Nada se publica sin probar en el celular.");
  assert.equal(a.context.find((c) => c.id === "glossary")!.doc_id !== null, true);
  assert.match(a.context.find((c) => c.id === "glossary")!.updated_at ?? "", /^\d{4}-/);
  assert.equal(a.context.find((c) => c.id === "map")!.updated_at, null);
  assert.equal(firstLine("# T\n\n```\ncode\n```"), "code");
  assert.equal(firstLine("x".repeat(200)).length, 140);
  assert.ok(notLibrary("Context: Map") && notLibrary("Prompt: PO") && notLibrary("Pack: x") && !notLibrary("Reglas"));
});

test("PLA-135: a library doc is created by title, replaced with the version read, and refused for Plania's own names", async () => {
  const made = await put("/docs", { title: "Notas de la clienta", markdown: "Quiere la agenda en el celular." });
  assert.equal(made.status, 200, await made.clone().text());
  const a = (await made.json()) as SettingsRead;
  const d = a.library.find((x) => x.title === "Notas de la clienta")!;
  assert.equal(d.version, 1);
  assert.equal(((await (await put("/docs", { title: "Notas de la clienta", markdown: "otra" })).json()) as { error: string }).error, "DOC_EXISTS");
  const edited = (await (await put("/docs", { title: "Notas de la clienta", markdown: "Y avisos por WhatsApp.", version: 1 })).json()) as SettingsRead;
  assert.equal(edited.library.find((x) => x.id === d.id)!.version, 2);
  assert.equal(edited.library[0]!.id, d.id, "the edited doc is the newest");
  assert.equal(((await (await put("/docs", { title: "Notas de la clienta", markdown: "pisado", version: 1 })).json()) as { error: string }).error, "STALE_VERSION");
  for (const title of ["Context: Map", "Prompt: Taller", "Pack: x", "   "]) assert.equal((await put("/docs", { title, markdown: "x" })).status, 400, title);
  assert.equal((await put("/docs", { title: "x", markdown: "y", extra: 1 })).status, 400, "strict body");
});

test("PLA-135: Archivo is gone from the address; a doc opens over the list unless its address names Ajustes", () => {
  assert.ok(!(corr.TABS as string[]).includes("archivo"));
  assert.equal(corr.tabOfVer({ kind: "doc", id: "x" }), "todo");
  assert.deepEqual(corr.atOf("?proyecto=f&t=archivo"), { view: "corriente", slug: "f", tab: "todo", ver: null });
  assert.equal(corr.atOf("?proyecto=f&t=ajustes&ver=doc:abc").tab, "ajustes");
  assert.equal(corr.atOf("?proyecto=f&ver=doc:abc").tab, "todo");
  assert.equal(corr.searchOf({ slug: "f", tab: "ajustes", ver: { kind: "doc", id: "ctx-map" } }), "?proyecto=f&t=ajustes&ver=doc%3Actx-map");
  assert.equal(corr.fromBuilding("?piso=f", { kind: "lienzo", key: "F-IDEA2" }, "f"), "?proyecto=f&ver=idea%3AF-IDEA2");
  assert.equal(corr.fromBuilding("?piso=f", { kind: "tab", tab: "docs" }, "f"), "?proyecto=f&t=ajustes");
});

test("PLA-135: the pure parts: doc addresses, seats, search, wires, the notes' state and titles", () => {
  assert.deepEqual(lib.docRefOf("nuevo"), { kind: "nuevo" });
  assert.deepEqual(lib.docRefOf("ctx-map"), { kind: "ctx", id: "map" });
  assert.deepEqual(lib.docRefOf("ctx-otro"), { kind: "doc", id: "ctx-otro" });
  assert.deepEqual(lib.docRefOf("8f2e"), { kind: "doc", id: "8f2e" });
  assert.equal(lib.ctxRef({ id: "map", doc_id: null }), "ctx-map");
  assert.equal(lib.ctxRef({ id: "map", doc_id: "d1" }), "d1");
  assert.deepEqual(lib.thingVer("MIA-IDEA4"), { kind: "idea", key: "MIA-IDEA4" });
  assert.deepEqual(lib.thingVer("MIA-I2"), { kind: "iniciativa", key: "MIA-I2" });
  assert.equal(lib.initials("Product owner"), "PO");
  assert.equal(lib.initials("Research"), "RE");
  assert.equal(lib.seatLabel("product-owner"), "Product owner");
  assert.equal(lib.seatLabel("research"), "Research");
  assert.equal(lib.sinTitulo("# Reglas\n\nNada."), "Nada.");
  assert.equal(lib.sinTitulo("Nada.\n# Luego"), "Nada.\n# Luego");
  assert.ok(lib.docMatches({ title: "Guía de marca", first: "" }, "guia"));
  assert.ok(lib.docMatches({ title: "Reglas", first: "Nada se publica" }, "PUBLICA"));
  assert.ok(!lib.docMatches({ title: "Reglas", first: "" }, "marca"));
  assert.deepEqual(lib.centres(3, 112, 12, 360), [56, 180, 304]);
  assert.deepEqual(lib.centres(2, 56, 12, 360), [146, 214]);
  assert.equal(lib.notaEstado({ doc_id: null, markdown: "" }, "", "es"), "NO EXISTE TODAVÍA");
  assert.equal(lib.notaEstado({ doc_id: "d", markdown: "  " }, "", "es"), "VACÍA: NADIE LA LEE");
  assert.equal(lib.notaEstado({ doc_id: "d", markdown: "a\nb" }, "19 nov", "es"), "2 LÍNEAS · 19 NOV");
  assert.ok(lib.tituloOk("Reglas") && !lib.tituloOk("") && !lib.tituloOk("Context: X") && !lib.tituloOk("x".repeat(121)));
});

test("PLA-135: the band draws the notes, the team's seats with their wires, and the library with a way to add one", () => {
  const a = {
    slug: "recetario",
    title: "Recetario",
    context: [
      { id: "glossary", title: "Context: Glossary", doc_id: "g1", version: 2, markdown: "# Glosario\n\nCita: una visita.", template: "", updated_at: "2026-11-19T12:00:00Z" },
      { id: "commands", title: "Context: Commands", doc_id: null, version: null, markdown: "", template: "# Comandos", updated_at: null },
      { id: "map", title: "Context: Map", doc_id: null, version: null, markdown: "", template: "# Mapa", updated_at: null },
    ],
    library: [{ id: "r1", title: "Reglas del proyecto", version: 1, updated_at: "2026-11-15T12:00:00Z", first: "Nada se publica sin probar." }],
  };
  const p = { slug: "recetario", title: "Recetario", team: [{ role: "product-owner" }, { role: "research" }, { role: "research" }] };
  const out = renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, {}, h(comp.DocsProyecto, { a, p, docTo: (id: string) => `/d/${id}` }))));
  assert.match(out, /id="ajustes-contexto"/, "the readiness list's link still lands here");
  assert.match(out, />Docs del proyecto</);
  assert.match(out, /<a [^>]*data-contexto="glossary" data-existe="1" href="\/d\/g1"/);
  assert.match(out, /<a [^>]*data-contexto="map" data-existe="0" href="\/d\/ctx-map"/);
  assert.match(out, /NO EXISTE TODAVÍA/);
  assert.equal((out.match(/data-asiento=/g) ?? []).length, 2, "one seat per role");
  assert.match(out, />Product owner</);
  assert.match(out, /class="fl"/, "the notes' wires flow");
  assert.match(out, /class="d"/, "the library's wire is dashed");
  assert.match(out, /<a [^>]*data-doc="r1" href="\/d\/r1"/);
  assert.match(out, /Nada se publica sin probar\./);
  assert.match(out, /<a [^>]*data-control="nuevo-doc" href="\/d\/nuevo"/);
  assert.ok(!/RECE-|MIA-|-IDEA/.test(out), "no keys on the screen");
  const empty = renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, {}, h(comp.DocsProyecto, { a: { ...a, library: [] }, p: { ...p, team: [] }, docTo: (id: string) => `/d/${id}` }))));
  assert.match(empty, /La biblioteca está vacía/);
  assert.match(empty, /Todavía no hay nadie en el equipo/);
  assert.ok(!/class="fl"/.test(empty), "no wires without a team");
});
