// PLA-I48: Máquinas, the second level of a floor. Screen-only routes, mounted under /api/projects after the session
// check like the capture routes, so the screen cookie opens them and no MCP token or agent does.
//   GET  /:slug/maquinas                        the server and the base, the scripts found, the pages (F1)
//   GET  /:slug/maquinas/bitacora               the test copy's last 200 output lines, scrubbed (F1)
//   POST /:slug/captures/reiniciar              stop then start the test copy (F1)
//   POST /:slug/maquinas/configurar             settings.capture from the dev script found (F1)
//   POST /:slug/maquinas/base/encender|apagar   the brew service of the floor's local base (F1)
//   GET  /:slug/maquinas/tablas                 tables, counts, columns, relations, migrations (F2)
//   GET  /:slug/maquinas/tablas/:name/filas     50 rows a page with the total (F2)
//   POST /:slug/maquinas/migrar                 Aplicar: the migrate command only (F5)
//   POST /:slug/maquinas/sembrar                migrate and seed (F2)
//   POST /:slug/maquinas/vaciar-y-sembrar       {rows}: truncate and seed again, the only writing path (F2)
//   GET  /:slug/maquinas/llaves                 variable names, set or missing, never a value (F3)
//   POST /:slug/maquinas/llaves                 {name, value}: one value into the app's env file; answers names only (PLA-116)
//   GET  /:slug/maquinas/pruebas, POST …        the last test run; start one (F3)
//   GET  /:slug/maquinas/recorrido              Cómo probarla's steps and the test user (F3)
//   POST /:slug/maquinas/recorrido/contrasena   a fresh password for the test user, once (F3)
//   GET  /:slug/maquinas/copias                 the start copy and one per open initiative (PLA-I72-1)
//   POST /:slug/maquinas/copias/:id/:action     encender | apagar | reiniciar | borrar | quedarse {keep} (PLA-I72-1)
//   GET  /:slug/maquinas/numeros                live numbers of every machine; keeps sampling while read (PLA-I72-2)
//   POST /:slug/maquinas/copias/:id/borrar-cache the copy's build cache folders only (PLA-I72-2)
//   GET  /:slug/maquinas/sobrantes              what closed initiatives left: bases, servers, folders (PLA-I72-3)
//   DELETE /:slug/maquinas/sobrantes/:id        one of them; DELETE …/sobrantes {expected}: all, guarded (PLA-I72-3)
//   GET  /:slug/maquinas/entrar                 the test user and its kept password, for the eye (PLA-I72-4)
//   POST /:slug/maquinas/entrar/cambiar         Cambiarla: a new one in the app and every running copy (PLA-I72-4)
//   POST /:slug/maquinas/copias/reiniciar-encendidas  restart every running copy, after a key changed (PLA-I72-4)
// And, for the building: GET /api/maquinas/tablero, every floor's server (F7).
import type { Context } from "hono";
import { Hono } from "hono";
import { asc } from "drizzle-orm";
import { withDb, type Db } from "../db/client.js";
import { projects } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { idOf, pruebaOf, pruebaRead, reiniciar, pruebaLog } from "../captures/prueba.js";
import { MaquinaError } from "../maquinas/errors.js";
import { appEnvOf, baseLever, configurar, maquinasRead, projectOf } from "../maquinas/machines.js";
import { filas, migrar, sembrar, tablas, vaciarYSembrar } from "../maquinas/reader.js";
import { llaves, ponerLlave } from "../maquinas/llaves.js";
import { correrPruebas, pruebasRead } from "../maquinas/pruebas.js";
import { cambiarContrasena, entrarRead, nuevaContrasena, recorrido } from "../maquinas/recorrido.js";
import { secretValues } from "../maquinas/env.js";
import { copiaAction, copiasRead, reiniciarEncendidas, type CopiaAction } from "../maquinas/copias.js";
import { borrarCache, numerosRead } from "../maquinas/numeros.js";
import { borrarSobrante, borrarTodo, sobrantesRead } from "../maquinas/sobrantes.js";

export const maquinasRoutes = new Hono();
export const tableroRoutes = new Hono();

const answer = async (c: Context, fn: (db: Db) => Promise<unknown>) => {
  try {
    return c.json((await withDb(fn)) as object);
  } catch (e) {
    if (e instanceof MaquinaError) return c.json({ error: e.code, hint: e.hint, ...e.detail }, e.status);
    if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.code === "PROJECT_NOT_FOUND" ? 404 : 400);
    throw e;
  }
};

maquinasRoutes.get("/:slug/maquinas", (c) => answer(c, (db) => maquinasRead(db, c.req.param("slug"))));
maquinasRoutes.get("/:slug/maquinas/bitacora", (c) =>
  answer(c, async (db) => {
    const p = await projectOf(db, c.req.param("slug"));
    // PLA-I72-5: ?copia=<initiative key> reads that copy's output.
    const copia = c.req.query("copia");
    const id = copia && copia !== "inicio" ? idOf(p.slug, "iniciativa", copia) : p.slug;
    return { lines: pruebaLog(id, secretValues(appEnvOf(p).env.values)) };
  }),
);
maquinasRoutes.post("/:slug/captures/reiniciar", (c) => answer(c, async (db) => ({ prueba: await reiniciar(db, c.req.param("slug")) })));
maquinasRoutes.post("/:slug/maquinas/configurar", (c) => answer(c, (db) => configurar(db, c.req.param("slug"))));
maquinasRoutes.post("/:slug/maquinas/base/encender", (c) => answer(c, async (db) => ({ base: await baseLever(db, c.req.param("slug"), "encender") })));
maquinasRoutes.post("/:slug/maquinas/base/apagar", (c) => answer(c, async (db) => ({ base: await baseLever(db, c.req.param("slug"), "apagar") })));

// PLA-I72-5: ?copia=<id> reads or writes that copy's own base ("inicio" or an initiative key).
const copiaOf = (c: Context) => c.req.query("copia") || null;
maquinasRoutes.get("/:slug/maquinas/tablas", (c) => answer(c, (db) => tablas(db, c.req.param("slug"), copiaOf(c))));
maquinasRoutes.get("/:slug/maquinas/tablas/:name/filas", (c) => answer(c, (db) => filas(db, c.req.param("slug"), c.req.param("name"), Number(c.req.query("offset") ?? 0), copiaOf(c))));
maquinasRoutes.post("/:slug/maquinas/migrar", (c) => answer(c, (db) => migrar(db, c.req.param("slug"), copiaOf(c))));
maquinasRoutes.post("/:slug/maquinas/sembrar", (c) => answer(c, (db) => sembrar(db, c.req.param("slug"), copiaOf(c))));
maquinasRoutes.post("/:slug/maquinas/vaciar-y-sembrar", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { rows?: unknown };
  return answer(c, (db) => vaciarYSembrar(db, c.req.param("slug"), Number(body.rows), copiaOf(c)));
});

maquinasRoutes.get("/:slug/maquinas/llaves", (c) => answer(c, (db) => llaves(db, c.req.param("slug"))));
maquinasRoutes.post("/:slug/maquinas/llaves", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; value?: unknown };
  return answer(c, (db) => ponerLlave(db, c.req.param("slug"), body.name, body.value));
});
maquinasRoutes.get("/:slug/maquinas/pruebas", (c) => answer(c, (db) => pruebasRead(db, c.req.param("slug"))));
maquinasRoutes.post("/:slug/maquinas/pruebas", (c) => answer(c, (db) => correrPruebas(db, c.req.param("slug"))));
maquinasRoutes.get("/:slug/maquinas/recorrido", (c) => answer(c, (db) => recorrido(db, c.req.param("slug"))));
maquinasRoutes.post("/:slug/maquinas/recorrido/contrasena", (c) => answer(c, (db) => nuevaContrasena(db, c.req.param("slug"))));

maquinasRoutes.get("/:slug/maquinas/copias", (c) => answer(c, (db) => copiasRead(db, c.req.param("slug"))));
const ACTIONS = new Set<CopiaAction>(["encender", "apagar", "reiniciar", "borrar", "quedarse"]);
maquinasRoutes.get("/:slug/maquinas/entrar", (c) => answer(c, (db) => entrarRead(db, c.req.param("slug"))));
maquinasRoutes.post("/:slug/maquinas/entrar/cambiar", (c) => answer(c, (db) => cambiarContrasena(db, c.req.param("slug"))));
maquinasRoutes.post("/:slug/maquinas/copias/reiniciar-encendidas", (c) => answer(c, (db) => reiniciarEncendidas(db, c.req.param("slug"))));
maquinasRoutes.get("/:slug/maquinas/numeros", (c) => answer(c, (db) => numerosRead(db, c.req.param("slug"))));
maquinasRoutes.get("/:slug/maquinas/sobrantes", (c) => answer(c, (db) => sobrantesRead(db, c.req.param("slug"))));
maquinasRoutes.delete("/:slug/maquinas/sobrantes", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { expected?: unknown };
  return answer(c, (db) => borrarTodo(db, c.req.param("slug"), body.expected));
});
maquinasRoutes.delete("/:slug/maquinas/sobrantes/:id", (c) => answer(c, (db) => borrarSobrante(db, c.req.param("slug"), decodeURIComponent(c.req.param("id")))));
maquinasRoutes.post("/:slug/maquinas/copias/:id/borrar-cache", (c) => answer(c, (db) => borrarCache(db, c.req.param("slug"), c.req.param("id"))));
maquinasRoutes.post("/:slug/maquinas/copias/:id/:action", async (c) => {
  const action = c.req.param("action") as CopiaAction;
  if (!ACTIONS.has(action)) return c.json({ error: "NOT_FOUND" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { keep?: unknown };
  return answer(c, (db) => copiaAction(db, c.req.param("slug"), c.req.param("id"), action, body));
});

// The building's tablero: every running floor with its server. Only reads (no base, no rows).
export type TableroRow = { project: string; title: string; configured: boolean; phase: string; managed: boolean; port: number | null; url: string | null; error: string | null };
tableroRoutes.get("/tablero", (c) =>
  answer(c, async (db) => {
    const rows = await db.select().from(projects).orderBy(asc(projects.slug));
    const floors: TableroRow[] = [];
    for (const p of rows) {
      // pruebaOf does not count as somebody looking at the floor (the idle clock keeps running).
      const r = pruebaOf(p.slug) ?? (await pruebaRead(p.slug, p.settings.capture));
      floors.push({ project: p.slug, title: p.title, configured: !!p.settings.capture, phase: r.phase, managed: r.managed, port: r.port, url: r.url, error: r.error });
    }
    return { floors, on: floors.filter((f) => ["live", "starting", "capturing", "running"].includes(f.phase)).length };
  }),
);
