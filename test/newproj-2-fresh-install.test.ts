// NEWPROJ-2: a fresh install (a database built only from the migrations, no `plania` project, no prompt docs)
// creates its first project from the sheet when the repo's kit has the core role prompts (kit/roles/<role>.md).
// The same lookup decides creation, the hire sheet and the runner (src/runner/prompts.ts). Throwaway DB and kit.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

const kit = mkdtempSync(path.join(tmpdir(), "plania-kit-"));
mkdirSync(path.join(kit, "roles"));
const role = (r: string) => path.join(kit, "roles", `${r}.md`);
for (const r of ["product-owner", "research", "artist", "taller"]) writeFileSync(role(r), `# ${r}\n\nFixture prompt.\n`);
process.env.PLANIA_KIT_DIR = kit;
delete process.env.PLANIA_PROMPTS_PROJECT;
useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const runner = await import("../src/runner/runner.js");

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const post = (url: string, body: unknown) => app.request(url, { method: "POST", headers: jorge(), body: JSON.stringify(body) });
const count = async (sql: string, args: unknown[] = []) => (await raw.query(sql, args)).rows[0].n as number;

before(async () => {
  raw = await resetTestDb();
  // resetTestDb adds four projects after the migrations; a fresh install has none.
  await raw.query(`delete from projects`);
  ({ db, close: closeDb } = makeDb());
});

after(async () => {
  await closeDb?.();
  await raw?.end();
  rmSync(kit, { recursive: true, force: true });
});

test("NEWPROJ-2: on a migrations-only database the sheet creates a project from the kit's role prompts", async () => {
  assert.equal(await count(`select count(*)::int as n from projects`), 0);
  const res = await post("/api/company/projects", { name: "Primero", goal: "Probar que una instalación nueva arranca." });
  assert.equal(res.status, 201, await res.clone().text());
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.slug, "primero");
  assert.equal(body.prompt_doc_id, null, "the prompt came from a file, not a doc");
  assert.deepEqual(body.team, ["po-primero", "research-primero", "artist-primero", "taller-primero"]);
  assert.equal(await count(`select count(*)::int as n from projects where slug = 'plania'`), 0, "no prompts project was needed");
  const po = (await raw.query(`select note from agents where slug = 'po-primero'`)).rows[0];
  assert.equal(po.note, "Prompt: kit/roles/product-owner.md.");
  // The runner reads the same prompt for the seat.
  const prompt = await runner.promptDoc(db, "product-owner", process.env);
  assert.match(prompt!.version, /^git:[0-9a-f]{12}$/);
});

test("NEWPROJ-2: a core seat with no doc and no kit file refuses creation and is named", async () => {
  unlinkSync(role("taller"));
  try {
    const res = await post("/api/company/projects", { name: "Sin Taller", goal: "Meta." });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: "PROMPT_DOC_MISSING", seats: ["taller"] });
    assert.equal(await count(`select count(*)::int as n from projects where slug = 'sin-taller'`), 0);

    // A doc in the prompts project is enough for that seat, even when the project exists only for it.
    const p = (await raw.query(`insert into projects (slug, title, key_prefix) values ('plania', 'Plania', 'PLA') returning id`)).rows[0].id;
    await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, 'Prompt: Taller', '# Taller', $2)`, [p, JSON.stringify({ agent: "test", session_id: "s" })]);
    const ok = await post("/api/company/projects", { name: "Con Taller", goal: "Meta." });
    assert.equal(ok.status, 201, await ok.clone().text());
  } finally {
    writeFileSync(role("taller"), "# taller\n\nFixture prompt.\n");
  }
});

test("NEWPROJ-2: hiring a specialist uses the same lookup: a kit file is enough, nothing is refused", async () => {
  const hire = (template: string) => post("/api/company/projects/primero/team", { template });
  const before = (await (await app.request("/api/company/projects/primero", { headers: jorge() })).json()) as { hire: { slug: string; state: string }[] };
  assert.equal(before.hire.find((h) => h.slug === "qa")?.state, "no_doc");
  const refused = await hire("qa");
  assert.equal(refused.status, 409);
  assert.equal(((await refused.json()) as { error: string }).error, "PROMPT_DOC_MISSING");

  writeFileSync(role("qa"), "# qa\n\nFixture prompt.\n");
  const after = (await (await app.request("/api/company/projects/primero", { headers: jorge() })).json()) as { hire: { slug: string; state: string }[] };
  assert.equal(after.hire.find((h) => h.slug === "qa")?.state, "free");
  const res = await hire("qa");
  assert.equal(res.status, 201, await res.clone().text());
  assert.equal((await raw.query(`select note from agents where slug = 'qa-primero'`)).rows[0].note, "Prompt: kit/roles/qa.md.");
});
