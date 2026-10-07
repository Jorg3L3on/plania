// Screen tests: project detail page and Jorge's Done actions (handoff §6, slice 5).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const writes = await import("../src/mcp/writes.js");

let raw: pg.Client;
let cookie: string;

const get = (path: string, withCookie = true) =>
  app.request(path, { headers: withCookie ? { Cookie: cookie } : {} });
const post = (path: string, withCookie = true) =>
  app.request(path, { method: "POST", headers: withCookie ? { Cookie: cookie } : {} });

async function row(key: string) {
  const { rows } = await raw.query("select status, resolved_at from tasks where key = $1", [key]);
  return rows[0] as { status: string; resolved_at: Date | null };
}

before(async () => {
  raw = await resetTestDb();
  cookie = `${SESSION_COOKIE}=${createSession()}`;
  const { db, close } = makeDb();
  try {
    await writes.updateResume(db, "micasa", {
      in_progress: "Fase 2 de importación",
      next_action: "Revisar PR <b>#12</b>",
      branch_or_prod: "feat/import",
      must_keep_decision: "",
    });
    await writes.createInitiative(db, { project: "micasa", key: "MIC-01", title: "Importación", body: "PRD", summary: "Estados de cuenta" });
    await writes.createTask(db, { project: "micasa", key: "MIC-01-F1", title: "Parser", body: "", parent_key: "MIC-01", summary: "Leer PDF" });
    await writes.createTask(db, { project: "micasa", key: "MIC-01-F2", title: "Conciliar", body: "", parent_key: "MIC-01", priority: "P0" });
    await writes.createTask(db, { project: "micasa", key: "MIC-01-F3", title: "Cerrado", body: "", parent_key: "MIC-01" });
    await writes.createTask(db, { project: "micasa", key: "MIC-B-01", title: "Spec <script>alert(1)</script>", body: "" });
    await writes.createTask(db, { project: "micasa", key: "MIC-B-02", title: "Descartado", body: "", status: "Won't do" });
    await writes.setTask(db, {
      project: "micasa", key: "MIC-01-F1", status: "In review", pr_url: "https://github.com/Jorg3L3on/micasa/pull/12",
    });
    await writes.setTask(db, { project: "micasa", key: "MIC-01-F2", status: "Blocked", note: "Esperando API del banco" });
    await writes.setTask(db, { project: "micasa", key: "MIC-01-F3", status: "Done" });
    await writes.createInitiative(db, { project: "micasa", key: "MIC-00", title: "Vieja", body: "" });
    await writes.createTask(db, { project: "micasa", key: "MIC-00-F1", title: "Huérfano", body: "", parent_key: "MIC-00" });
    await writes.setInitiative(db, { project: "micasa", key: "MIC-00", status: "Done" });
  } finally {
    await close();
  }
});

after(async () => {
  await raw?.end();
});

describe("auth", () => {
  test("detail and Done routes redirect to /login without a session", async () => {
    for (const res of [
      await get("/p/micasa", false),
      await post("/p/micasa/tasks/MIC-01-F1/done", false),
      await post("/p/micasa/initiatives/MIC-01/done", false),
    ]) {
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), "/login");
    }
    assert.equal((await row("MIC-01-F1")).status, "In review", "nothing changes without a session");
  });

  test("the MCP Bearer does not open the screen", async () => {
    const res = await app.request("/p/micasa", { headers: { Authorization: "Bearer test-token" } });
    assert.equal(res.status, 302);
  });
});

describe("GET /p/:slug", () => {
  test("unknown project is a 404 page", async () => {
    assert.equal((await get("/p/nope")).status, 404);
  });

  test("shows the resume card, escaped, with a dash for empty fields", async () => {
    const page = await (await get("/p/micasa")).text();
    assert.match(page, /Fase 2 de importación/);
    assert.match(page, /feat\/import/);
    assert.match(page, /Revisar PR &lt;b&gt;#12&lt;\/b&gt;/);
    assert.match(page, /Decisión fija<\/dt><dd class="empty">—<\/dd>/);
  });

  test("lists open work only, with title, line, status and priority", async () => {
    const page = await (await get("/p/micasa")).text();
    for (const shown of ["MIC-01", "MIC-01-F1", "MIC-01-F2", "MIC-B-01", "MIC-00-F1", "Estados de cuenta", "Leer PDF"]) {
      assert.ok(page.includes(shown), `expected ${shown}`);
    }
    for (const hidden of ["MIC-01-F3", "MIC-B-02", "MIC-00<", "PRD"]) {
      assert.ok(!page.includes(hidden), `did not expect ${hidden}`);
    }
    assert.ok(page.includes("Spec &lt;script&gt;alert(1)&lt;/script&gt;"), "titles are escaped");
    assert.ok(page.indexOf("MIC-01-F2") < page.indexOf("MIC-01-F1"), "P0 sorts before P2");
  });

  test("shows the Blocked note and the PR link of an In review ticket", async () => {
    const page = await (await get("/p/micasa")).text();
    assert.match(page, /Esperando API del banco/);
    assert.match(page, /href="https:\/\/github.com\/Jorg3L3on\/micasa\/pull\/12"/);
  });

  test("offers Done on In review tickets and open initiatives only", async () => {
    const page = await (await get("/p/micasa")).text();
    const actions = [...page.matchAll(/action="([^"]+\/done)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(actions, ["/p/micasa/initiatives/MIC-01/done", "/p/micasa/tasks/MIC-01-F1/done"]);
  });

  test("an empty project says so", async () => {
    assert.match(await (await get("/p/zigzag")).text(), /Nada abierto\./);
  });
});

describe("POST Done", () => {
  test("marks a ticket Done with resolved_at and redirects to the detail", async () => {
    const res = await post("/p/micasa/tasks/MIC-01-F1/done");
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/p/micasa");
    const r = await row("MIC-01-F1");
    assert.equal(r.status, "Done");
    assert.ok(r.resolved_at instanceof Date);
    assert.ok(!(await (await get("/p/micasa")).text()).includes("MIC-01-F1"), "Done leaves the list");
  });

  test("marks an initiative Done", async () => {
    const res = await post("/p/micasa/initiatives/MIC-01/done");
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/p/micasa");
    const r = await row("MIC-01");
    assert.equal(r.status, "Done");
    assert.ok(r.resolved_at instanceof Date);
  });

  test("wrong kind, unknown key or unknown project is a 404 and changes nothing", async () => {
    assert.equal((await post("/p/micasa/tasks/MIC-00/done")).status, 404);
    assert.equal((await post("/p/micasa/initiatives/MIC-B-01/done")).status, 404);
    assert.equal((await post("/p/micasa/tasks/NOPE/done")).status, 404);
    assert.equal((await post("/p/nope/tasks/MIC-B-01/done")).status, 404);
    assert.equal((await row("MIC-B-01")).status, "Backlog");
  });
});
