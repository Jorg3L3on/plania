// PLA-I73-3/5/6: what a plan step carries (skeleton, dependencies, files, effort, «Pruébalo» views) and the risk
// check behind one review per module. Pure: no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { useTestEnv } from "./helpers.js";

useTestEnv();
const { checkStageData } = await import("../src/mcp/stage-docs.js");
const { riesgoOf } = await import("../src/api/riesgo.js");
const { velocidadOf, checkVelocidad } = await import("../src/runner/velocidad.js");

const step = (over: Record<string, unknown> = {}) => ({ title: "La boutique agrega vestidos", done_when: "En «Vestidos» se crea un vestido con fotos y se ve en la lista", try_it: "Entra al panel, agrega un vestido con 3 fotos y míralo en la lista", ...over });
const muestra = { frase: "La boutique sube sus vestidos.", vistas: [{ key: "lista", label: "Lista", path: "/panel/vestidos", session: true }], pasos: ["Abre la lista", "Agrega uno", "Edítalo"] };

test("I73-5 #1: a plan keeps the skeleton flag, dependencies, files, effort and a valid muestra", () => {
  const d = checkStageData("planning", {
    steps: [step({ esqueleto: true, effort: "high", files: ["src/db/**"] }), step({ title: "La novia ve el catálogo", depends_on: [0], files: ["src/app/catalogo/**"], muestra }), step({ title: "La asesora ve favoritas", depends_on: [0, 0] })],
    risks: ["Las fotos pesan"],
  });
  assert.equal(d.steps[0]!.esqueleto, true);
  assert.equal(d.steps[0]!.effort, "high");
  assert.deepEqual(d.steps[1]!.depends_on, [0]);
  assert.deepEqual(d.steps[2]!.depends_on, [0], "duplicates collapse");
  assert.deepEqual(d.steps[1]!.files, ["src/app/catalogo/**"]);
  assert.equal(d.steps[1]!.muestra!.vistas[0]!.path, "/panel/vestidos");
  assert.equal(d.steps[2]!.muestra, undefined);
});

test("I73-5 #2: a plan is refused for a later skeleton, a dependency on a later step, a broken muestra or a bad effort", () => {
  const plan = (steps: unknown[]) => () => checkStageData("planning", { steps, risks: ["x pesa"] });
  assert.throws(plan([step(), step({ esqueleto: true })]), (e: { code?: string; detail?: { field?: string } }) => e.detail?.field === "steps[1].esqueleto");
  assert.throws(plan([step({ depends_on: [0] })]), (e: { detail?: { field?: string } }) => e.detail?.field === "steps[0].depends_on");
  assert.throws(plan([step({ muestra: { frase: "x", vistas: [], pasos: [] } })]), (e: { detail?: { field?: string } }) => String(e.detail?.field).startsWith("steps[0].muestra"));
  assert.throws(plan([step({ effort: "max" })]));
});

test("I73-3 #1: the risk check stops destructive SQL, login and payment files, and lets additive work through", async () => {
  const files: Record<string, string> = {
    "drizzle/0009_vestidos.sql": "CREATE TABLE vestido (id uuid primary key);\n-- drop table nothing, a comment\nCREATE INDEX x ON vestido(id);",
    "drizzle/0010_limpia.sql": "ALTER TABLE cita DROP COLUMN notas;",
    "drizzle/0011_mueve.sql": "UPDATE cita SET estado = 'x';",
  };
  const read = async (f: string) => files[f] ?? null;
  assert.equal(await riesgoOf(["src/app/catalogo/revista.tsx", "drizzle/0009_vestidos.sql"], read), null, "a new table is not a risk");
  assert.match((await riesgoOf(["drizzle/0010_limpia.sql"], read))!.reason, /Cambia o borra datos/);
  assert.match((await riesgoOf(["drizzle/0011_mueve.sql"], read))!.reason, /Cambia o borra datos/);
  assert.match((await riesgoOf(["src/app/panel/login/page.tsx"], read))!.reason, /acceso/);
  assert.match((await riesgoOf(["src/lib/pagos/stripe.ts"], read))!.reason, /pagos/);
  assert.match((await riesgoOf(["drizzle/0099_gone.sql"], read))!.reason, /No se pudo leer/, "unreadable SQL is not waved through");
  assert.equal(await riesgoOf(["src/app/catalogo/favoritas.tsx", "src/lib/catalogo.ts"], read), null);
});

test("I73 #settings: speed settings default on and refuse what is malformed", () => {
  assert.deepEqual(velocidadOf({}), { apilar: true, revision: "por_modulo", carriles: 2, esqueleto_temprano: true, verificar: true });
  assert.equal(velocidadOf({ velocidad: { carriles: 9, revision: "por_paso" } }).carriles, 4);
  assert.equal(velocidadOf({ velocidad: { revision: "por_paso" } }).revision, "por_paso");
  checkVelocidad({ apilar: false, carriles: 3 });
  assert.throws(() => checkVelocidad({ carriles: 0 }));
  assert.throws(() => checkVelocidad({ revision: "nunca" }));
  assert.throws(() => checkVelocidad({ turbo: true }));
});
