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
const ctx = { actor: { agent: "test-agent", session_id: "s1" } };
const { webCtx } = await import("../src/mcp/tx.js");
const { addResult } = await import("../src/mcp/evidence.js");
const { addDecision } = await import("../src/mcp/decisions.js");
const { ask } = await import("../src/mcp/questions.js");

let raw: pg.Client;
let cookie: string;

const get = (path: string, withCookie = true) =>
  app.request(path, { headers: withCookie ? { Cookie: cookie } : {} });
// The open list only, without the decisions and activity below it.
const openSection = (page: string) => page.split(/<h2>(?:Decisiones|Actividad)<\/h2>/)[0]!;
const post = (path: string, withCookie = true, form: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    headers: withCookie ? { Cookie: cookie } : {},
    body: new URLSearchParams(form),
  });

async function version(key: string): Promise<string> {
  const { rows } = await raw.query("select version from tasks where key = $1", [key]);
  return String(rows[0]?.version ?? 1);
}

// Done as the screen sends it: with the version that was on the page.
const done = async (path: string, key: string) => post(path, true, { version: await version(key) });

async function row(key: string) {
  const { rows } = await raw.query("select status, resolved_at from tasks where key = $1", [key]);
  return rows[0] as { status: string; resolved_at: Date | null };
}

before(async () => {
  raw = await resetTestDb();
  cookie = `${SESSION_COOKIE}=${createSession()}`;
  const { db, close } = makeDb();
  try {
    // A v1 card, as left by the handoff seed: read-only now.
    await raw.query(
      `update projects set resume_in_progress = 'Fase 2 de importación', resume_next_action = 'Revisar PR <b>#12</b>',
       resume_branch_or_prod = 'feat/import' where slug = 'micasa'`,
    );
    await writes.createTask(db, {
      project: "micasa", kind: "initiative", key: "MIC-01", title: "Importación", scope: "PRD", summary: "Estados de cuenta",
      next_action: "Conciliar <i>después</i> del parser",
    }, ctx);
    await writes.createTask(db, { project: "micasa", key: "MIC-01-F1", scope: "s", checks: ["c"], title: "Parser", parent_key: "MIC-01", summary: "Leer PDF" }, ctx);
    await writes.createTask(db, { project: "micasa", key: "MIC-01-F2", scope: "s", checks: ["c"], title: "Conciliar", parent_key: "MIC-01", priority: "P0" }, ctx);
    await writes.createTask(db, { project: "micasa", key: "MIC-01-F3", scope: "s", checks: ["c"], title: "Cerrado", parent_key: "MIC-01" }, ctx);
    await writes.createTask(db, { project: "micasa", key: "MIC-B-01", scope: "s", checks: ["c"], title: "Spec <script>alert(1)</script>" }, ctx);
    await writes.createTask(db, { project: "micasa", key: "MIC-B-02", scope: "s", checks: ["c"], title: "Descartado" }, ctx);
    await writes.setTask(db, { project: "micasa", key: "MIC-B-02", status: "Won't do", version: 1 }, webCtx);
    await writes.createTask(db, { project: "micasa", key: "MIC-B-03", scope: "s", checks: ["c"], title: "Tomado" }, ctx);
    await writes.claim(db, { project: "micasa", key: "MIC-B-03" }, ctx);
    await writes.claim(db, { project: "micasa", key: "MIC-01-F1" }, ctx);
    await addResult(db, { project: "micasa", key: "MIC-01-F1", kind: "unit", verdict: "pass", cite: "parser tests" }, ctx);
    await writes.setTask(db, {
      project: "micasa", key: "MIC-01-F1", version: 2, status: "In review", pr_url: "https://github.com/Jorg3L3on/micasa/pull/12",
    }, ctx);
    await writes.setTask(db, { project: "micasa", key: "MIC-01-F2", version: 1, status: "Blocked", note: "Esperando API del banco" }, ctx);
    await writes.setTask(db, { project: "micasa", key: "MIC-01-F3", version: 1, status: "Done" }, webCtx);
    await writes.createTask(db, { project: "micasa", kind: "initiative", key: "MIC-00", title: "Vieja" }, ctx);
    await writes.createTask(db, { project: "micasa", key: "MIC-00-F1", scope: "s", checks: ["c"], title: "Huérfano", parent_key: "MIC-00" }, ctx);
    await writes.setTask(db, { project: "micasa", key: "MIC-00", status: "Done", version: 1 }, webCtx);
    await addDecision(db, { project: "micasa", text: "Solo PDF del banco", task_key: "MIC-01-F1", pin: true }, ctx);
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

  test("shows the generated resume per initiative, escaped", async () => {
    const page = await (await get("/p/micasa")).text();
    const ficha = page.split("<h2>Ficha</h2>")[1]!.split("<h2>Abierto</h2>")[0]!;
    assert.match(ficha, /Importación <span class="meta mono">MIC-01 · Planning<\/span>/);
    assert.match(ficha, /Conciliar &lt;i&gt;después&lt;\/i&gt; del parser/);
    assert.match(ficha, /Solo PDF del banco/);
    assert.match(ficha, /MIC-B-03<\/span> · test-agent/, "standalone claims show up");
  });

  test("keeps the v1 card read-only under a fold", async () => {
    const page = await (await get("/p/micasa")).text();
    assert.match(page, /<summary>Ficha anterior \(v1, solo lectura\)<\/summary>/);
    assert.match(page, /Fase 2 de importación/);
    assert.match(page, /Revisar PR &lt;b&gt;#12&lt;\/b&gt;/);
    assert.match(page, /Decisión fija<\/dt><dd class="empty">—<\/dd>/);
  });

  test("the project list shows one generated line", async () => {
    const page = await (await get("/")).text();
    assert.match(page, /En curso: MIC-B-03 \(test-agent\)/);
    assert.match(page, /Sin ficha\./, "an empty project says so");
  });

  test("lists open work only, with title, line, status and priority", async () => {
    const page = openSection(await (await get("/p/micasa")).text());
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

describe("claims", () => {
  test("a claimed ticket shows who holds it; Liberar frees it", async () => {
    const page = await (await get("/p/micasa")).text();
    assert.match(page, /test-agent <span class="mono">s1<\/span> hasta/);
    const res = await post("/p/micasa/tasks/MIC-B-03/release");
    assert.equal(res.status, 302);
    assert.equal((await row("MIC-B-03")).status, "Ready");
    assert.doesNotMatch(await (await get("/p/micasa")).text(), /Liberar/);
  });
});

describe("questions", () => {
  test("Jorge answers on screen: the ticket returns to In progress with its lease, the answer is a decision", async () => {
    const { db, close } = makeDb();
    let id = "";
    try {
      await writes.createTask(db, { project: "workia", key: "WRK-Q-01", scope: "s", checks: ["c"], title: "Pregunta" }, ctx);
      await writes.claim(db, { project: "workia", key: "WRK-Q-01" }, ctx);
      id = (await ask(db, { project: "workia", key: "WRK-Q-01", question: "¿Español o inglés?", options: ["Español", "Inglés"] }, ctx)).question.id;
    } finally {
      await close();
    }
    const page = await (await get("/p/workia")).text();
    assert.match(page, /<h2>Preguntas para ti<\/h2>/);
    assert.match(page, /¿Español o inglés\?/);
    assert.match(page, /name="answer" value="Español"/);
    assert.match(await (await get("/")).text(), /1 pregunta para ti · /);

    const res = await post(`/p/workia/questions/${id}/answer`, true, { answer: "Español", free: "" });
    assert.equal(res.status, 302);
    const r = await row("WRK-Q-01");
    assert.equal(r.status, "In progress");
    const { rows } = await raw.query("select owner, lease_until > now() as live from tasks where key = 'WRK-Q-01'");
    assert.equal(rows[0].live, true, "the lease is intact");
    const { rows: d } = await raw.query("select line, actor from decisions where line like '¿Español%'");
    assert.equal(d[0].line, "¿Español o inglés? → Español");
    assert.equal(d[0].actor.agent, "jorge");
    assert.doesNotMatch(await (await get("/p/workia")).text(), /Preguntas para ti/);
  });
});

describe("decisions", () => {
  test("a reversed decision is struck through", async () => {
    const { db, close } = makeDb();
    try {
      const old = await addDecision(db, { project: "zigzag", text: "Borrar con confirmación" }, ctx);
      await addDecision(db, { project: "zigzag", text: "Sin borrado", supersedes: old.decision.id }, ctx);
    } finally {
      await close();
    }
    const page = await (await get("/p/zigzag")).text();
    assert.match(page, /<s>Borrar con confirmación<\/s>/);
    assert.match(page, /Sin borrado/);
    assert.doesNotMatch(page, /<s>Sin borrado/);
  });
});

describe("export", () => {
  test("Jorge's session downloads the project from a link on its page", async () => {
    assert.match(await (await get("/p/micasa")).text(), /href="\/export\/micasa.json"/);
    const res = await get("/export/micasa.json");
    assert.equal(res.status, 200);
    assert.ok(((await res.json()) as { tasks: unknown[] }).tasks.length > 5);
  });
});

describe("activity", () => {
  test("lists recent events in local time with the actor", async () => {
    const page = await (await get("/p/micasa")).text();
    const feed = page.split("<h2>Actividad</h2>")[1] ?? "";
    assert.match(feed, /<time datetime="\d{4}-\d{2}-\d{2}T[^"]+Z">/);
    assert.match(feed, /test-agent/);
    assert.match(feed, /task\.status/);
  });
});

describe("POST Done", () => {
  test("the form carries the version; a stale one changes nothing and says so", async () => {
    const page = await (await get("/p/micasa")).text();
    assert.match(page, /name="version" value="\d+"/);
    const res = await post("/p/micasa/tasks/MIC-01-F1/done", true, { version: "999" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/p/micasa?stale=MIC-01-F1");
    assert.equal((await row("MIC-01-F1")).status, "In review");
    assert.match(await (await get("/p/micasa?stale=MIC-01-F1")).text(), /MIC-01-F1 cambió mientras lo veías/);
  });

  test("marks a ticket Done with resolved_at and redirects to the detail", async () => {
    const res = await done("/p/micasa/tasks/MIC-01-F1/done", "MIC-01-F1");
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/p/micasa");
    const r = await row("MIC-01-F1");
    assert.equal(r.status, "Done");
    assert.ok(r.resolved_at instanceof Date);
    const { rows } = await raw.query("select actor from events where task_key = 'MIC-01-F1' order by id desc limit 1");
    assert.equal(rows[0].actor.agent, "jorge", "the screen writes as jorge");
    assert.ok(!openSection(await (await get("/p/micasa")).text()).includes("MIC-01-F1"), "Done leaves the list");
  });

  test("marks an initiative Done", async () => {
    const res = await done("/p/micasa/initiatives/MIC-01/done", "MIC-01");
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
