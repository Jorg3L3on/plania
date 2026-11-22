// PLA-I74-10: photo truth and empty states in the sample. Each sampled page declares the URL it must land on; a photo
// taken on another URL is marked wrong and holds «Aceptar» back with a plain Spanish reason (on the card and in the
// server's accept). Artist's empty-state frames become sample cases, photographed before the muestra's rows load.
// Fake browser, fake copies, test DB only.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-i74-fotos-"));
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
const WT_ROOT = path.join(TMP, "worktrees");
const { makeDb } = await import("../src/db/client.js");
const writes = await import("../src/mcp/writes.js");
const settings = await import("../src/captures/settings.js");
const { parseMuestra } = await import("../src/captures/muestra.js");
const { runCapture } = await import("../src/captures/run.js");
const probador = await import("../src/captures/probador.js");
const prueba = await import("../src/captures/prueba.js");
const store = await import("../src/captures/store.js");
const vacios = await import("../src/captures/vacios.js");
const { threadAction } = await import("../src/api/thread-actions.js");
const { resolveThread } = await import("../src/runner/threads.js");
type Json = Record<string, any>;
type Browser = import("../src/captures/chrome.js").Browser;

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
const ctx = { actor: { agent: "t", session_id: "s-i74-10", machine: "ci" } };
const BASE = "http://localhost:3998";

function png(): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(1440, 16);
  b.writeUInt32BE(900, 20);
  return b;
}
// A pretend app: /panel lists one ficha; its link sends the browser to /panel/ajustes instead (the follow that landed on
// the wrong page in the last real run).
const fakeBrowser = (followTo: string) => async (): Promise<Browser> => {
  let at = `${BASE}/`;
  return {
    page: {
      async setViewport() {},
      async goto(url: string) {
        at = url;
        return { status: 200, url };
      },
      async evaluate<T>(js: string): Promise<T> {
        if (js === "location.href") return at as T;
        if (js === "location.pathname") return new URL(at).pathname as T;
        if (js.includes("a ? a.href")) return `${BASE}${followTo}` as T;
        if (js.includes("overlay")) return { overlay: "", body: "ok" } as T;
        throw new Error(`unexpected script ${js.slice(0, 40)}`);
      },
      async screenshot() {
        return png();
      },
    },
    async close() {},
  } as unknown as Browser;
};
const okFetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
const exec = async () => ({ code: 0, stdout: "x\n", stderr: "" });

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  const repo = path.join(TMP, "repo");
  mkdirSync(repo, { recursive: true });
  await raw.query(`update projects set settings = settings || jsonb_build_object('capture', $1::jsonb, 'local', jsonb_build_object('repo_path', $2::text)) where slug = 'zigzag'`, [
    JSON.stringify({ start_command: "npm run dev -- --port {port}", port: 3998, pages: [{ key: "inicio", path: "/", label: "Inicio" }] }),
    repo,
  ]);
});
after(async () => {
  prueba.stopAll();
  await raw.end();
  rmSync(TMP, { recursive: true, force: true });
});

describe("each page declares the URL it must land on", () => {
  test("the default: the path (no query); a follow path: anything under it; a CSS follow: only what url says", () => {
    assert.equal(settings.landingOf({ path: "/panel?tab=citas" }), "/panel");
    assert.equal(settings.landingOf({ path: "/panel", follow: "/panel/novias/" }), "/panel/novias/*");
    assert.equal(settings.landingOf({ path: "/panel", follow: "a.ficha" }), null);
    assert.equal(settings.landingOf({ path: "/panel", follow: "a.ficha", url: "/panel/novias/:id" }), "/panel/novias/:id");
    assert.ok(settings.landsOn("/panel", "http://x/panel/?tab=1"));
    assert.ok(!settings.landsOn("/panel", "http://x/panel/ajustes"));
    assert.ok(settings.landsOn("/panel/novias/*", "http://x/panel/novias/n1"));
    assert.ok(!settings.landsOn("/panel/novias/*", "http://x/panel/novias/"), "an open prefix needs a record after it");
    assert.ok(!settings.landsOn("/panel/novias/*", "http://x/panel/ajustes"));
    assert.ok(settings.landsOn("/panel/novias/:id", "http://x/panel/novias/n1"));
    assert.ok(!settings.landsOn("/panel/novias/:id", "http://x/panel/novias/n1/editar"));
    assert.ok(settings.landsOn("/panel/nov*", "http://x/panel/novias"));
  });

  test("a view and a capture page accept url; a query or a space is refused", () => {
    const m = (url: string) => parseMuestra({ frase: "f", pasos: ["a", "b", "c"], vistas: [{ key: "v", label: "V", path: "/p", url }] });
    assert.ok(m("/p/:id").ok);
    assert.equal(m("/p?x=1").ok, false);
    assert.equal(settings.parseCaptureSettings({ start_command: "x", port: 3000, pages: [{ key: "a", path: "/", label: "A", url: "/ a" }] }).ok, false);
  });

  test("#1 a photo whose final URL differs from its page's declared URL is marked wrong; the right one is kept", async () => {
    const t = await writes.createTask(db, { project: "zigzag", title: "Ficha de la novia", scope: "s", checks: ["c"] } as never, ctx as never);
    const views = [
      { key: "ficha", label: "Ficha de la novia", path: "/panel", follow: "/panel/novias/" },
      { key: "lista", label: "Lista", path: "/panel/ajustes" },
    ];
    const sum = await runCapture(db, { project: "zigzag", checkout: TMP, base_url: BASE, task_key: t.key, views, side: "despues", actor: ctx.actor, viewports: ["desktop"] }, { exec, fetch: okFetch, launch: fakeBrowser("/panel/ajustes") });
    const ficha = sum.stills.find((s) => s.page === "ficha")!;
    assert.equal(ficha.status, "error");
    assert.equal(ficha.wrong, true);
    assert.equal(ficha.error, "Foto equivocada: «Ficha de la novia» salió en /panel/ajustes y debía salir en /panel/novias/*");
    const lista = sum.stills.find((s) => s.page === "lista")!;
    assert.equal(lista.status, "ok");
    assert.equal(lista.wrong, undefined);
    const row = (await raw.query(`select status, url from capture_stills where id = $1`, [ficha.id])).rows[0];
    assert.deepEqual([row.status, row.url], ["error", `${BASE}/panel/ajustes`], "the wrong URL is kept with the row");
  });
});

// ---- El Probador's pass, with fake copies (harness from i52-pares.test.ts)
let clock = 1_000_000;
const stream = () => ({ on: () => undefined });
let nextPid = 8100;
const pruebaDeps = () => ({
  git: async (args: string[]) => {
    if (args[0] === "worktree" && args[1] === "add") mkdirSync(args[3]!, { recursive: true });
    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return { code: 0, stdout: "HEAD\n", stderr: "" };
    if (args[0] === "rev-parse") return { code: 0, stdout: "5a4db0c5a4db0c5a4db0c5a4db0c5a4db0c5a4db\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  },
  spawn: (() => ({ pid: nextPid++, stdout: stream(), stderr: stream(), once: () => undefined })) as any,
  kill: () => undefined,
  alive: () => false,
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  up: async () => true,
  portBusy: async () => false,
  env: { ...process.env, PLANIA_WORKTREES_ROOT: WT_ROOT },
  pollMs: 5,
  readyMs: 2_000,
  stopGraceMs: 5,
  sweep: false,
  signals: false,
  footprints: false,
  now: () => clock,
  serverRoot: path.join(TMP, "not-plania"),
});

const MUESTRA = {
  frase: "Las asesoras ven la ficha.",
  vistas: [
    { key: "ficha", label: "Ficha de la novia", path: "/panel", follow: "/panel/novias/" },
    { key: "ajustes", label: "Ajustes de la agenda", path: "/panel/ajustes", acciones: [{ click: "Editar" }, { fill: "#dias", value: "5" }] },
  ],
  pasos: ["uno", "dos", "tres"],
  datos: "insert into citas (id) values ('pla-i74-10')",
};

type Order = string[];
const captureWith = (order: Order, wrongKeys: Set<string>) => async (d: typeof db, input: Json) => {
  order.push(`capture:${input.side}:${input.views.map((v: Json) => v.key).join(",")}`);
  const [p] = (await raw.query(`select id from projects where slug = $1`, [input.project])).rows;
  const [t] = (await raw.query(`select id from tasks where key = $1`, [input.task_key])).rows;
  const runId = crypto.randomUUID();
  const stills: Json[] = [];
  for (const vp of ["desktop", "phone"] as const)
    for (const v of input.views) {
      const base = { projectId: p.id, taskId: t.id, runId, pageKey: v.key, pageLabel: v.label, path: v.path, viewport: vp, width: 1440, height: 100, commit: null, branch: input.branch, actor: input.actor, side: input.side };
      const wrong = input.side === "despues" && wrongKeys.has(v.key);
      const row = wrong
        ? await store.recordStill(d, input.project, { ...base, ok: false, error: `Foto equivocada: «${v.label}» salió en /panel/ajustes y debía salir en /panel/novias/*`, url: "http://x/panel/ajustes" })
        : await store.recordStill(d, input.project, { ...base, ok: true, png: png(), url: null });
      stills.push({ page: v.key, viewport: vp, status: row.status, id: row.id, ...(row.error ? { error: row.error } : {}), ...(wrong ? { wrong: true } : {}) });
    }
  const ok = stills.filter((s) => s.status === "ok").length;
  return { run_id: runId, project: input.project, task_key: input.task_key, commit: null, branch: input.branch, base_url: input.base_url, ok, failed: stills.length - ok, stills } as any;
};

async function delivery(title: string, muestra: Json = MUESTRA): Promise<{ key: string; id: string }> {
  const t = await writes.createTask(db, { project: "zigzag", title, scope: "s", checks: ["ok"] } as never, ctx as never);
  await raw.query(`update tasks set muestra = $1::jsonb, branch = $2, status = 'In review', work_type = 'code' where key = $3`, [JSON.stringify(muestra), `jl/${t.key.toLowerCase()}`, t.key]);
  const [row] = (await raw.query(`select id from tasks where key = $1`, [t.key])).rows;
  return { key: t.key, id: row.id };
}
const taskRow = async (key: string) => (await raw.query(`select * from tasks where key = $1`, [key])).rows[0];

describe("a wrong photo holds «Aceptar»", () => {
  beforeEach(() => {
    prueba.resetPrueba();
    prueba.setPruebaDeps(pruebaDeps() as never);
  });

  test("#2 the pass marks the card wrong; the hold is a plain Spanish reason, and the server refuses the accept", async () => {
    const { key } = await delivery("Ficha con enlace roto");
    const order: Order = [];
    const s = await probador.probar(db, "zigzag", key, { capture: captureWith(order, new Set(["ficha"])) as any, cargarDatos: (async () => ({ ok: true })) as any, pollMs: 5, waitMs: 3000 });
    assert.equal(s?.state, "lista");
    assert.equal(s?.wrong, true);
    const [p] = (await raw.query(`select * from projects where slug = 'zigzag'`)).rows;
    const t = await taskRow(key);
    const toP = { ...p, settings: p.settings } as never;
    const toT = { ...t, muestra: t.muestra, probador: t.probador } as never;
    const gate = probador.probadorGate(toP, toT, null);
    assert.equal(gate.pending, false);
    assert.equal(gate.hold, "No se puede aprobar todavía. Foto equivocada: «Ficha de la novia» salió en /panel/ajustes y debía salir en /panel/novias/*. Hay que corregir la muestra o la pantalla y volver a tomar las fotos.");
    assert.doesNotMatch(gate.hold!, /PLA-|sandbox|jl\//, "no ticket keys or branch names on the screen");
    // The server's accept refuses it too: the hold is not only a disabled button.
    const ref = await resolveThread(db, "zigzag");
    const [msg] = (
      await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links) values ($1, 'taller', 'taller', 'Entregué', $2::jsonb) returning id`, [ref.thread.id, JSON.stringify([{ kind: "ticket", ref: key }, { kind: "pr", ref: "https://github.com/acme/app/pull/7" }])])
    ).rows;
    const out = (await threadAction(db, ref, { message_id: msg.id, action: "aceptar" })) as Json;
    assert.equal(out.error, "PHOTO_WRONG_PAGE");
    assert.match(out.hint, /Foto equivocada/);
    assert.equal((await taskRow(key)).status, "In review", "nothing moved");
  });

  test("every después photo wrong: back to Taller with the reason, and the second time the card holds", async () => {
    const { key } = await delivery("Todo en otra página", { ...MUESTRA, vistas: [MUESTRA.vistas[0]] });
    const order: Order = [];
    const deps = { capture: captureWith(order, new Set(["ficha"])) as any, cargarDatos: (async () => ({ ok: true })) as any, pollMs: 5, waitMs: 3000, returnToTaller: false };
    let s = await probador.probar(db, "zigzag", key, deps);
    assert.equal(s?.state, "fallo");
    assert.match(s!.error!, /Foto equivocada/);
    s = await probador.probar(db, "zigzag", key, deps);
    assert.equal(s?.state, "lista");
    assert.equal(s?.wrong, true);
  });
});

describe("Artist's empty-state frames become sample cases", () => {
  const frame = (frameId: string, name: string, extra: Json = {}) => ({ frameId, name, grupo: null, hace: null, porque: null, ...extra });

  test("an empty-state frame is recognised by its name, group or what it does; others are not", () => {
    assert.ok(vacios.isEmptyFrame(frame("A1", "Ajustes vacíos")));
    assert.ok(vacios.isEmptyFrame(frame("A2", "Agenda", { hace: "Sin citas todavía: muestra los días por defecto" })));
    assert.ok(vacios.isEmptyFrame(frame("A3", "Primera vez", { grupo: "Estado vacío" })));
    assert.ok(vacios.isEmptyFrame(frame("A4", "Empty inbox")));
    assert.ok(!vacios.isEmptyFrame(frame("B1", "Agenda con tres citas")));
    assert.ok(!vacios.isEmptyFrame(frame("B2", "Vaciar la papelera", { hace: "Borra todo" })), "a verb is not an empty state");
  });

  test("a case pairs with the view it names, keeps its clicks but not its fills or follow, and needs a muestra with datos", () => {
    const m = parseMuestra(MUESTRA);
    assert.ok(m.ok);
    const cases = vacios.casesOf(m.muestra, [frame("T", "Portada"), frame("V2", "Ajustes de la agenda vacíos")], "es");
    assert.deepEqual(cases, [{ key: "vacia-v2", label: "Ajustes de la agenda vacíos", path: "/panel/ajustes", estado: "vacía, con lo que la app pone por defecto", acciones: [{ click: "Editar" }], from_frame: "V2" }]);
    assert.deepEqual(vacios.casesOf({ ...m.muestra, datos: undefined }, [frame("V2", "Ajustes vacíos")]), [], "without datos every view is already empty");
    const many = vacios.casesOf(m.muestra, [frame("V1", "Ficha vacía"), frame("V2", "Ajustes vacíos"), frame("V3", "Ficha sin datos")], "es");
    assert.deepEqual(many.map((c) => c.key), ["vacia-v1", "vacia-v2"], "one case per view");
  });

  test("#3 the idea's empty-state frames become cases of its initiative's deliveries, photographed before the rows load, and shown on the card", async () => {
    const ini = await writes.createTask(db, { project: "zigzag", title: "Agenda", kind: "initiative", scope: "s" } as never, ctx as never);
    const idea = await writes.createTask(db, { project: "zigzag", title: "Idea de la agenda", kind: "idea", scope: "s" } as never, ctx as never);
    const [iniRow] = (await raw.query(`select id, project_id from tasks where key = $1`, [ini.key])).rows;
    const [ideaRow] = (await raw.query(`update tasks set promoted_to = $1 where key = $2 returning id`, [ini.key, idea.key])).rows;
    for (const [i, [fid, name]] of [["T", "Portada"], ["V2", "Ajustes de la agenda vacíos"]].entries())
      await raw.query(`insert into idea_frames (project_id, task_id, frame_id, name, position, file, mime, bytes, actor) values ($1, $2, $3, $4, $5, 'f.png', 'image/png', 10, '{"agent":"artist","session_id":"x"}'::jsonb)`, [iniRow.project_id, ideaRow.id, fid, name, i]);
    const { key, id } = await delivery("Paso de la agenda");
    await raw.query(`update tasks set parent_id = $1 where id = $2`, [iniRow.id, id]);

    const order: Order = [];
    const s = await probador.probar(db, "zigzag", key, {
      capture: captureWith(order, new Set()) as any,
      cargarDatos: (async (_slug: string, lane: string) => {
        order.push(`datos:${lane}`);
        return { ok: true };
      }) as any,
      pollMs: 5,
      waitMs: 3000,
    });
    assert.equal(s?.state, "lista", JSON.stringify(s));
    const despuesCase = order.indexOf("capture:despues:vacia-v2");
    assert.ok(despuesCase >= 0, order.join(" | "));
    assert.ok(despuesCase < order.indexOf("datos:entrega"), `the empty state is photographed before the rows: ${order.join(" | ")}`);
    assert.ok(order.indexOf("capture:despues:ficha,ajustes") > order.indexOf("datos:entrega"));
    const read = await probador.probadorRead(db, "zigzag", key);
    const v = read!.vistas.find((x) => x.key === "vacia-v2")!;
    assert.equal(v.label, "Ajustes de la agenda vacíos");
    assert.equal(v.estado, "vacía, con lo que la app pone por defecto");
    assert.ok(v.desktop.despues.still, "the case has its picture");
    assert.deepEqual(read!.vistas.map((x) => x.key), ["ficha", "ajustes", "vacia-v2"]);
  });
});
