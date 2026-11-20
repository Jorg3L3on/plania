// PLA-127: a delivery's changed images, before and after (an icons change shows on no page). Fake git, test DB.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { imagenesRead, imagenBytes } = await import("../src/captures/imagenes.js");
const writes = await import("../src/mcp/writes.js");
const { makeDb } = await import("../src/db/client.js");

const BASE = "b".repeat(40), HEAD = "h".repeat(40).replace(/h/g, "c"), TIP = "d".repeat(40);
const git: import("../src/brand/logos.js").Git = async (_cwd, args) => {
  const ok = (s: string | Buffer) => ({ code: 0, stdout: Buffer.isBuffer(s) ? s : Buffer.from(s) });
  const no = { code: 1, stdout: Buffer.alloc(0) };
  if (args[0] === "fetch") return ok("");
  if (args[0] === "rev-parse") return ({ "jl/tnd-1^{commit}": HEAD, "origin/sandbox^{commit}": TIP } as Record<string, string>)[args[3]!] ? ok(({ "jl/tnd-1^{commit}": HEAD, "origin/sandbox^{commit}": TIP } as Record<string, string>)[args[3]!]!) : no;
  if (args[0] === "merge-base") return ok(`${BASE}\n`);
  if (args[0] === "diff") return ok(["M", "public/icons/icon-192.png", "A", "public/icons/new.svg", "M", "src/app/layout.tsx", "D", "public/old.ico"].join("\0") + "\0");
  if (args[0] === "cat-file") return args[2] === `${BASE}:public/icons/icon-192.png` ? ok(Buffer.from("old-png")) : args[2] === `${HEAD}:public/icons/icon-192.png` ? ok(Buffer.from("new-png")) : no;
  return no;
};

let raw: Awaited<ReturnType<typeof resetTestDb>>;
let db: ReturnType<typeof makeDb>["db"];
before(async () => {
  raw = await resetTestDb();
  db = makeDb().db;
  await raw.query("insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND')");
  const made = (await writes.createTask(db, { project: "tienda", title: "Íconos", scope: "s", checks: ["c"], status: "Ready" } as never, { actor: { agent: "test", session_id: "s" } } as never)) as { key: string };
  await raw.query("update tasks set branch = 'jl/tnd-1' where key = $1", [made.key]);
});
after(async () => {
  await raw.end();
});

test("PLA-127 #1 the images a delivery changes, with what happens to each; code files are left out", async () => {
  const r = (await imagenesRead(db, "tienda", "TND-01", git))!;
  assert.deepEqual(r.files, [
    { path: "public/icons/icon-192.png", estado: "cambio" },
    { path: "public/icons/new.svg", estado: "nueva" },
    { path: "public/old.ico", estado: "borrada" },
  ]);
  assert.equal(r.base, BASE, "before is where the branch left the start branch");
});

test("PLA-127 #2 each side's bytes; a file the delivery does not change is refused", async () => {
  assert.equal((await imagenBytes(db, "tienda", "TND-01", "antes", "public/icons/icon-192.png", git))?.bytes.toString(), "old-png");
  assert.equal((await imagenBytes(db, "tienda", "TND-01", "despues", "public/icons/icon-192.png", git))?.bytes.toString(), "new-png");
  assert.equal((await imagenBytes(db, "tienda", "TND-01", "despues", "src/app/layout.tsx", git)), null);
  assert.equal((await imagenBytes(db, "tienda", "TND-01", "despues", "../../etc/passwd", git)), null);
});
