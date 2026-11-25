// NEWPROJ-8: details of the sheet «Nuevo proyecto». The inputs stop where the route does (40 and 280), the route takes
// a name and a goal at exactly those lengths, a click on the dimmed background keeps typed text, and the screen's
// NewProjectResult is the server's NewProject. Throwaway DB and kit; no code location is checked (no_code).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type pg from "pg";
import type { NewProjectResult } from "../ui/src/lib/compania.js";
import type { NewProject } from "../src/runner/new-project.js";
import { resetTestDb, useTestEnv } from "./helpers.js";

const TMP = mkdtempSync(path.join(tmpdir(), "plania-newproj8-"));
const kit = path.join(TMP, "kit");
mkdirSync(path.join(kit, "roles"), { recursive: true });
for (const r of ["product-owner", "research", "artist", "taller"]) writeFileSync(path.join(kit, "roles", `${r}.md`), `# ${r}\n\nFixture prompt.\n`);
process.env.PLANIA_KIT_DIR = kit;
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
delete process.env.PLANIA_PROMPTS_PROJECT;
useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { NEW_PROJECT_GOAL_MAX, NEW_PROJECT_NAME_MAX } = await import("../src/runner/new-project.js");
const { META_MAX, NOMBRE_MAX, fondoMouseDown, nuevoProyectoSinTexto } = await import("../ui/src/lib/nuevo-proyecto.js");

// The screen's result type and the server's are the same shape, both ways (a type error here fails `tsc --noEmit`).
const toScreen = (r: NewProject): NewProjectResult => r;
const toServer = (r: NewProjectResult): NewProject => r;
void toScreen;
void toServer;

let raw: pg.Client;
const post = (body: unknown) =>
  app.request("/api/company/projects", { method: "POST", headers: { Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

before(async () => {
  raw = await resetTestDb();
});

after(async () => {
  await raw?.end();
  rmSync(TMP, { recursive: true, force: true });
});

const sheet = readFileSync(new URL("../ui/src/components/corriente/hojas.tsx", import.meta.url), "utf8");
const nuevo = sheet.slice(sheet.indexOf("export const NuevoProyecto"), sheet.indexOf("export const Pausar"));

test("NEWPROJ-8: the sheet's input limits are the server's", () => {
  assert.equal(NOMBRE_MAX, NEW_PROJECT_NAME_MAX);
  assert.equal(META_MAX, NEW_PROJECT_GOAL_MAX);
  assert.equal(NEW_PROJECT_NAME_MAX, 40);
  assert.equal(NEW_PROJECT_GOAL_MAX, 280);
  assert.match(nuevo, /value=\{name\}\s+maxLength=\{NOMBRE_MAX\}/);
  assert.match(nuevo, /value=\{goal\} maxLength=\{META_MAX\}/);
});

test("NEWPROJ-8: the route takes a 40-character name and a 280-character goal, and refuses one more", async () => {
  const name = "Proyecto de prueba con nombre muy largo!";
  const goal = "m".repeat(280);
  assert.equal(name.length, 40);
  const ok = await post({ name, goal, no_code: true });
  assert.equal(ok.status, 201, await ok.clone().text());
  const body = (await ok.json()) as NewProjectResult;
  assert.equal(body.paused, true);
  assert.ok(Array.isArray(body.team) && body.team.includes(body.po), "the reply carries the team, PO included");
  const { rows } = await raw.query(`select p.title, g.title as goal from projects p join goals g on g.project_id = p.id where p.slug = $1`, [body.slug]);
  assert.equal(rows[0]?.title, name);
  assert.equal(rows[0]?.goal, goal);

  assert.equal((await post({ name: `${name}x`, goal: "Una meta.", no_code: true })).status, 400);
  assert.equal((await post({ name: "Otro proyecto", goal: `${goal}m`, no_code: true })).status, 400);
});

test("NEWPROJ-8: a mouse-down on the background keeps typed text in the creation sheet", () => {
  const back = {};
  let closed = 0;
  const close = () => void closed++;
  const onBack = (fields: string[]) => fondoMouseDown(nuevoProyectoSinTexto(fields), close);

  // Something typed in any field: the click on the background does nothing, so the form and its text stay.
  for (const fields of [["Viajia", "", "", ""], ["", "Una meta.", "", ""], ["", "", "~/Developer/x", ""], ["", "", "", "o/r"]]) {
    onBack(fields)({ target: back, currentTarget: back });
  }
  assert.equal(closed, 0);
  // Empty form (spaces only count as empty): the background closes as before.
  onBack(["", "  ", "", ""])({ target: back, currentTarget: back });
  assert.equal(closed, 1);
  // A mouse-down inside the sheet never closes it.
  onBack(["", "", "", ""])({ target: {}, currentTarget: back });
  assert.equal(closed, 1);

  // The sheet wires it: the shell's background uses the helper, the creation sheet passes its four fields, and no
  // other sheet passes closeOnBack (they keep closing on the background).
  assert.match(sheet, /className="cor-hoja-back" onMouseDown=\{fondoMouseDown\(closeOnBack, onClose\)\}/);
  assert.match(nuevo, /closeOnBack=\{nuevoProyectoSinTexto\(\[name, goal, carpeta, repo, ssh\]\)\}/);
  assert.equal(sheet.split("closeOnBack={").length - 1, 1);
});

test("NEWPROJ-8: the name and goal row stacks at phone width", () => {
  const css = readFileSync(new URL("../ui/src/corriente.css", import.meta.url), "utf8");
  assert.match(nuevo, /className="cor-hoja-form cor-hoja-nuevo"/);
  assert.match(css, /\.cor-hoja-nuevo \.cor-hoja-two > label \{ min-width: 0; \}/);
  assert.match(css, /@media \(max-width: 639px\) \{ \.cor-hoja-nuevo \.cor-hoja-two \{ flex-direction: column; \} \}/);
});

test("NEWPROJ-8: .env.example names PLANIA_WORKTREES_ROOT", () => {
  const lines = readFileSync(new URL("../.env.example", import.meta.url), "utf8").split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith("PLANIA_WORKTREES_ROOT="));
  assert.ok(at > 0, "listed");
  // PLA-I2-3: the default is neutral now (the folder chosen at first start, else one under the user's home).
  assert.match(lines[at - 1]!, /^# .*~\/plania\/worktrees/);
});
