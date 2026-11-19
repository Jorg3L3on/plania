// PLA-I52-6: señalar y preguntar. A return from El Probador carries the owner's pins with a crop of each picture;
// a question is kept, wakes Taller for a read-only run, and its «Respuesta:» shows on the card. Throwaway DB and
// capture store; fictional data.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-i52-6-"));
process.env.PLANIA_CAPTURES_DIR = TMP;
const { makeDb } = await import("../src/db/client.js");
const writes = await import("../src/mcp/writes.js");
const store = await import("../src/captures/store.js");
const { encodePng, decodePng } = await import("../src/captures/diff.js");
const decisions = await import("../src/api/company-decisions.js");
const pq = await import("../src/captures/preguntas.js");
const probador = await import("../src/captures/probador.js");
const runner = await import("../src/runner/runner.js");
const { resolveThread } = await import("../src/runner/threads.js");
type Json = Record<string, any>;

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
const ctx = { actor: { agent: "t", session_id: "s-i52-6", machine: "ci" } };
const MUESTRA = { frase: "Se ve.", vistas: [{ key: "sucursales", label: "Sucursales", path: "/panel/sucursales" }], pasos: ["a", "b", "c"] };
const solid = (w: number, h: number) => encodePng({ width: w, height: h, channels: 3, data: Buffer.alloc(w * h * 3, 200) });
let key = "";
let msgId = "";

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  await raw.query(`update projects set settings = settings || $1::jsonb where slug = 'zigzag'`, [JSON.stringify({ capture: { start_command: "x {port}", port: 3000, pages: [{ key: "a", path: "/", label: "A" }] } })]);
  const t = await writes.createTask(db, { project: "zigzag", title: "Pantalla de sucursales", scope: "s", checks: ["ok"] } as never, ctx as never);
  key = t.key;
  await raw.query(`update tasks set muestra = $1::jsonb, status = 'In review', pr_url = 'https://github.com/x/zigzag/pull/3' where key = $2`, [JSON.stringify(MUESTRA), key]);
  const [p] = (await raw.query(`select id from projects where slug = 'zigzag'`)).rows;
  const [tr] = (await raw.query(`select id from tasks where key = $1`, [key])).rows;
  for (const [vp, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    await store.recordStill(db, "zigzag", { projectId: p.id, taskId: tr.id, runId: crypto.randomUUID(), pageKey: "sucursales", pageLabel: "Sucursales", path: "/panel/sucursales", viewport: vp, width: w, height: h, commit: null, branch: null, actor: ctx.actor, side: "despues", ok: true, png: solid(w, h), url: null });
  }
  const { thread } = await resolveThread(db, "zigzag");
  const [m] = (await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links) values ($1, 'taller-zigzag', 'taller', 'Listo', $2::jsonb) returning id`, [thread.id, JSON.stringify([{ kind: "ticket", ref: key, title: "Pantalla" }, { kind: "pr", ref: "https://github.com/x/zigzag/pull/3", title: "PR" }])])).rows;
  msgId = m.id;
});
after(async () => {
  await raw.end();
  rmSync(TMP, { recursive: true, force: true });
});

describe("señalar", () => {
  test("a return with 2 pins reaches Taller with 2 crops and their notes", async () => {
    const out = (await decisions.actOnDecision(db, `m-${msgId}`, {
      action: "cambios",
      text: "No se ve bien: el botón",
      marcas: [
        { vista: "sucursales", side: "despues", width: "desktop", x: 0.5, y: 0.2, note: "Este botón muy pegado" },
        { vista: "sucursales", side: "despues", width: "phone", x: 0.9, y: 0.95, note: "Se corta" },
      ],
    })) as Json;
    assert.ok(!out.error, JSON.stringify(out));
    const t = (await raw.query(`select status from tasks where key = $1`, [key])).rows[0];
    assert.equal(t.status, "Ready");
    const note = (await raw.query(`select payload from events where task_key = $1 and type = 'task.note' order by id desc limit 1`, [key])).rows[0]?.payload?.note
      ?? (await raw.query(`select payload::text as p from events where task_key = $1 order by id desc`, [key])).rows.map((r: Json) => r.p).join("\n");
    assert.match(String(note), /No se ve bien: el botón/);
    assert.match(String(note), /Marcas en El Probador/);
    assert.match(String(note), /1\. Sucursales \(\/panel\/sucursales\), después, escritorio, 50% desde la izquierda, 20% desde arriba: Este botón muy pegado/);
    assert.match(String(note), /2\. Sucursales .*teléfono.*: Se corta/);
    const crops = (await raw.query(`select page_key, width, height, file from capture_stills where page_key like 'marca-%' order by page_key`)).rows;
    assert.deepEqual(crops.map((c: Json) => c.page_key), ["marca-1-sucursales", "marca-2-sucursales"]);
    const png = readFileSync(path.join(TMP, "zigzag", crops[0].file));
    assert.equal(decodePng(png)?.width, Math.round(1280 * 0.36), "a third of the picture around the pin");
    assert.ok(existsSync(path.join(TMP, "zigzag", crops[1].file)));
    assert.match(String(note), new RegExp(`foto: ${TMP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/zigzag/[0-9a-f]{64}\\.png`), "a file path Taller can open on this machine");
  });

  test("pins are cleaned: unknown views, out-of-range spots and extra fields are dropped or clamped", () => {
    const m = pq.cleanMarcas([{ vista: "Bad Key!", x: 0.1, y: 0.1 }, { vista: "ok", x: 4, y: -1, side: "x", width: "tv", note: " a  b " }, "nope"]);
    assert.deepEqual(m, [{ vista: "ok", side: "despues", width: "desktop", x: 1, y: 0, note: "a b" }]);
  });
});

describe("preguntar", () => {
  test("a question is kept and its «Respuesta:» shows on the card, without opening any session", async () => {
    await raw.query(`update tasks set status = 'In review' where key = $1`, [key]);
    const r = await pq.preguntar(db, "zigzag", key, "¿Qué pasa con las novias de una sucursal que apago?");
    assert.ok(r.id && typeof r.wake === "string");
    let read = (await probador.probadorRead(db, "zigzag", key))!;
    assert.deepEqual(read.preguntas.map((q) => [q.text, q.answer]), [["¿Qué pasa con las novias de una sucursal que apago?", null]]);
    const { thread } = await resolveThread(db, "zigzag");
    await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links, at) values ($1, 'taller-zigzag', 'taller', $2, $3::jsonb, now() + interval '1 second')`, [
      thread.id,
      "Respuesta: se quedan en el listado; solo su formulario deja de abrir.",
      JSON.stringify([{ kind: "ticket", ref: key, title: "Pantalla" }]),
    ]);
    read = (await probador.probadorRead(db, "zigzag", key))!;
    assert.equal(read.preguntas[0]!.answer?.text, "se quedan en el listado; solo su formulario deja de abrir.");
    await assert.rejects(pq.preguntar(db, "zigzag", key, "   "), /INVALID_FILTER/);
  });

  test("the answer run reads only: QA's deny rules, and a moved head is recorded", async () => {
    const src = readFileSync(new URL("../src/runner/runner.ts", import.meta.url), "utf8");
    assert.match(src, /role === "qa" \|\| asks \? QA_DENY_RULES : \[\]/);
    runner.markAskHead("run-1", "aaaa111");
    const same = await runner.askHeadCheck("run-1", "/tmp", async () => ({ code: 0, stdout: "aaaa111\n", stderr: "" }));
    assert.deepEqual(same, { before: "aaaa111", after: "aaaa111", moved: false });
    runner.markAskHead("run-2", "aaaa111");
    const moved = await runner.askHeadCheck("run-2", "/tmp", async () => ({ code: 0, stdout: "bbbb222\n", stderr: "" }));
    assert.equal(moved?.moved, true);
    assert.equal(await runner.askHeadCheck("run-3", "/tmp", async () => ({ code: 0, stdout: "x", stderr: "" })), null, "other runs are not checked");
    assert.ok(pq.PREGUNTA_MARK === "[pregunta]");
  });
});
