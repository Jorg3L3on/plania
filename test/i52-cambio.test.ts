// PLA-I52-7: tres tipos y el carrete. The kind of change from the diff, «solo lo que no se ve» accepting only what
// does not change the screen, and the release card's reel. Throwaway DB and capture store; fictional data.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-i52-7-"));
process.env.PLANIA_CAPTURES_DIR = TMP;
(globalThis as { React?: unknown }).React = React;
const { makeDb } = await import("../src/db/client.js");
const writes = await import("../src/mcp/writes.js");
const store = await import("../src/captures/store.js");
const { encodePng } = await import("../src/captures/diff.js");
const { cambioOf } = await import("../src/captures/muestra.js");
const { autoVerdict } = await import("../src/api/auto-accept.js");
const { releaseReel } = await import("../src/captures/probador.js");
const { resolveThread } = await import("../src/runner/threads.js");

type Json = Record<string, any>;

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
const ctx = { actor: { agent: "t", session_id: "s-i52-7", machine: "ci" } };
const png = encodePng({ width: 64, height: 40, channels: 3, data: Buffer.alloc(64 * 40 * 3, 180) });

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
});
after(async () => {
  await raw.end();
  rmSync(TMP, { recursive: true, force: true });
});

describe("the kind of change", () => {
  test("screens are se_ve; mail, exports and jobs se_comporta; the rest no_se_ve; tests never count", () => {
    assert.equal(cambioOf(["src/app/panel/page.tsx", "src/db/x.ts"]), "se_ve");
    assert.equal(cambioOf(["src/lib/mailer.ts"]), "se_comporta");
    assert.equal(cambioOf(["src/lib/panel/exportar-excel.ts"]), "se_comporta");
    assert.equal(cambioOf(["src/jobs/recordatorios.ts"]), "se_comporta");
    assert.equal(cambioOf(["drizzle/0007_sucursales.sql", "src/db/sucursales.ts"]), "no_se_ve");
    assert.equal(cambioOf(["src/lib/mailer.test.ts", "src/db/a.ts"]), "no_se_ve", "a test about mail is not mail");
  });
});

describe("«solo lo que no se ve»", () => {
  test("with only that switch on, a delivery that changes the screen waits for the owner; one that does not goes on", async () => {
    await raw.query(`update projects set settings = settings || '{"auto_accept_invisible": true}'::jsonb where slug = 'filmia'`);
    const t = await writes.createTask(db, { project: "filmia", title: "Índices", scope: "s", checks: ["ok"] } as never, ctx as never);
    await raw.query(`update tasks set status = 'In review', cambio = 'se_ve' where key = $1`, [t.key]);
    const { thread } = await resolveThread(db, "filmia");
    const [m] = (await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links) values ($1, 'taller-filmia', 'taller', 'Listo', $2::jsonb) returning id`, [thread.id, JSON.stringify([{ kind: "ticket", ref: t.key, title: "Índices" }])])).rows;
    const [p] = (await raw.query(`select * from projects where slug = 'filmia'`)).rows;
    const d: Json = { id: `m-${m.id}`, kind: "pr", asker: { agent: "taller-filmia", role: "taller" }, hold: null, evidence: { verdict: "pass", fail: 0 } };
    assert.equal(await autoVerdict(db, { ...p, settings: p.settings, runsPaused: p.runs_paused }, d as never), "Cambia lo que se ve: revísala tú.");
    await raw.query(`update tasks set cambio = null where key = $1`, [t.key]);
    assert.equal(await autoVerdict(db, { ...p, settings: p.settings } as never, d as never), "No se sabe si cambia la pantalla: revísala tú.");
    await raw.query(`update tasks set cambio = 'no_se_ve' where key = $1`, [t.key]);
    assert.equal(await autoVerdict(db, { ...p, settings: p.settings } as never, d as never), "Todavía no se lee el PR.", "past the kind check, the usual rules apply");
    const all = { ...p, settings: { ...p.settings, auto_accept: true } };
    await raw.query(`update tasks set cambio = 'se_ve' where key = $1`, [t.key]);
    assert.equal(await autoVerdict(db, all as never, d as never), "Todavía no se lee el PR.", "with the full switch on, the kind does not matter");
  });
});


