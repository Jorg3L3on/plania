// PLA-121: «Pedírselo a Taller» gives the icons ticket to the project's Taller, so its creation queues Taller's run
// (PLA-103). Throwaway DB and store, fake git, event wakes on, no runner process.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
const STORE = mkdtempSync(path.join(tmpdir(), "plania-pla121-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const pedido = await import("../src/brand/pedido.js");
const marca = await import("../src/brand/marca.js");
const { makeDb } = await import("../src/db/client.js");
const { ensureMember } = await import("../src/runner/team.js");

const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#4a1f3d"/><path d="M28 72V28h44" stroke="#fff" stroke-width="12" fill="none" stroke-linecap="round"/></svg>`;
const C1 = "1".repeat(40);
const files: Record<string, Buffer> = { "package.json": Buffer.from("{}"), "src/app/layout.tsx": Buffer.from(""), "public/brand/icon.svg": Buffer.from(tile) };
const git: import("../src/brand/logos.js").Git = async (_cwd, args) => {
  const no = { code: 1, stdout: Buffer.alloc(0) };
  if (args[0] === "rev-parse") return args[3] === "sandbox^{commit}" ? { code: 0, stdout: Buffer.from(C1) } : no;
  if (args[0] === "ls-tree") return { code: 0, stdout: Buffer.from(Object.entries(files).map(([p, b]) => `100644 blob ${"a".repeat(40)} ${b.length}\t${p}`).join("\0") + "\0") };
  if (args[0] === "cat-file") {
    const b = files[args[2]!.split(/:(.+)/)[1]!];
    return b ? { code: 0, stdout: b } : no;
  }
  return no;
};

let raw: Awaited<ReturnType<typeof resetTestDb>>;
let db: ReturnType<typeof makeDb>["db"];
before(async () => {
  raw = await resetTestDb();
  db = makeDb().db;
});
after(async () => {
  await raw.end();
  rmSync(STORE, { recursive: true, force: true });
});

test("PLA-121: the icons ticket belongs to the project's Taller and its creation queues Taller on it", async () => {
  await raw.query("insert into projects (slug, title, key_prefix, runs_paused) values ('tienda', 'Tienda', 'TND', false)");
  const project = (await raw.query("select * from projects where slug = 'tienda'")).rows[0];
  project.settings ??= {};
  await ensureMember(db, project as never, "taller", { note: "test" } as never);
  const taller = (await raw.query("select id, slug from agents where project_id = $1 and role_template = 'taller'", [project.id])).rows[0];
  await marca.marcaRead(db, "tienda", { git });
  const r = await pedido.requestIcons(db, project, "faltan");
  const t = (await raw.query("select status, owner_agent from tasks where key = $1", [r.key])).rows[0];
  assert.deepEqual([t.status, t.owner_agent], ["Ready", taller.id]);
  const runs = (await raw.query("select status, task_key from agent_runs where agent_id = $1", [taller.id])).rows;
  assert.deepEqual(runs.map((x) => [x.status, x.task_key]), [["queued", r.key]], "Taller is queued on the icons ticket");
});
