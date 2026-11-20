// PLA-128: icons in the repo made from an older logo read «viejo» and the request redoes them. Throwaway DB and
// store, a fake git whose commits Plania's own set fills, sharp on this machine.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-pla128-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const pedido = await import("../src/brand/pedido.js");
const marca = await import("../src/brand/marca.js");
const logos = await import("../src/brand/logos.js");
const surfaces = await import("../src/brand/surfaces.js");
const { stageUpload, useUpload } = await import("../src/brand/upload.js");
const { makeDb } = await import("../src/db/client.js");

const svg = (bg: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/><path d="M28 72V28h44" stroke="#fff" stroke-width="12" fill="none" stroke-linecap="round"/></svg>`);
let commits: Record<string, Record<string, Buffer>> = {};
let tip = "";
const git: import("../src/brand/logos.js").Git = async (_cwd, args) => {
  const ok = (b: string | Buffer) => ({ code: 0, stdout: Buffer.isBuffer(b) ? b : Buffer.from(b) });
  const no = { code: 1, stdout: Buffer.alloc(0) };
  if (args[0] === "fetch") return ok("");
  if (args[0] === "rev-parse") return args[3] === "sandbox^{commit}" && tip ? ok(tip) : no;
  if (args[0] === "ls-tree") {
    const files = commits[args[4]!];
    return files ? ok(Object.entries(files).map(([p, b]) => `100644 blob ${"a".repeat(40)} ${b.length}\t${p}`).join("\0") + "\0") : no;
  }
  if (args[0] === "cat-file") {
    const [c, p] = args[2]!.split(/:(.+)/);
    const b = commits[c!]?.[p!];
    return b ? ok(b) : no;
  }
  return no;
};
const base: Record<string, Buffer> = { "package.json": Buffer.from(`{"dependencies":{"next":"16.0.0"}}`), "src/app/layout.tsx": Buffer.from("export default function L() { return null; }") };
const commit = (files: Record<string, Buffer>) => {
  tip = String(Object.keys(commits).length + 1).repeat(40).slice(0, 40);
  commits[tip] = files;
};
const read = async () => {
  marca.forgetMarca();
  logos.forgetLogoLooks();
  return (await marca.marcaRead(db, "tienda", { git, fresh: true }))!;
};
const pickLogo = async (bg: string) => {
  const s = await stageUpload("tienda", svg(bg), `logo-${bg.slice(1)}.svg`);
  await useUpload(db, project, { up: s.up, name: s.name, scale: 100, bg: null }, { agent: "owner", session_id: "web" });
};
/** What Taller does: every file of Plania's set lands in the repo as it is. */
const placeAll = async () => {
  await read();
  const set = (await pedido.buildSet(db, project, "todo"))!;
  const next = { ...commits[tip] };
  for (const f of set.files) next[f.path] = f.bytes;
  commit(next);
};

let raw: Awaited<ReturnType<typeof resetTestDb>>;
let db: ReturnType<typeof makeDb>["db"];
let project: import("../src/db/schema.js").Project;
before(async () => {
  raw = await resetTestDb();
  db = makeDb().db;
});
after(async () => {
  await raw.end();
  rmSync(STORE, { recursive: true, force: true });
});
beforeEach(async () => {
  commits = {};
  commit({ ...base });
  rmSync(path.join(STORE, "_marca", "tienda"), { recursive: true, force: true });
  await raw.query("delete from project_logos");
  await raw.query("delete from tasks where project_id in (select id from projects where slug = 'tienda')");
  await raw.query("delete from projects where slug = 'tienda'");
  await raw.query("insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND')");
  project = (await raw.query("select * from projects where slug = 'tienda'")).rows[0];
  project.settings ??= {};
});

test("#1 #2 a new logo turns the repo's icons from the old one «viejo»; the request redoes them; then nothing is viejo", async () => {
  await pickLogo("#1d4ed8");
  await placeAll();
  const first = await read();
  assert.deepEqual(first.rows.filter((r) => r.state === "viejo"), [], "the repo has this logo's files");
  assert.ok(first.rows.filter((r) => r.state === "ok").length >= 8);

  await pickLogo("#b91c1c");
  const after = await read();
  const old = after.rows.filter((r) => r.state === "viejo").map((r) => r.id).sort();
  assert.deepEqual(old, ["a192", "a512", "apple", "ico", "mask", "og", "svg"].sort(), "every compared icon is from the old logo (mono is a white silhouette of the same drawing)");
  assert.ok(after.rows.find((r) => r.id === "apple")!.checks.some((c) => c.k === "old_logo" && !c.ok));
  const set = (await pedido.buildSet(db, project, "faltan"))!;
  for (const id of old) assert.ok(set.plan.items.some((i) => i.key === id && i.op === "~"), `${id} is redone in place`);

  await placeAll();
  assert.deepEqual((await read()).rows.filter((r) => r.state === "viejo"), [], "once Taller places the new set, nothing is viejo");
});

test("#1 a surface's own icon is compared with its own files; a logo found in the repo leaves the icons be", async () => {
  await pickLogo("#1d4ed8");
  const s = await stageUpload("tienda", svg("#047857"), "android.svg");
  await surfaces.setSurface(project, "android", { up: s.up, name: s.name, scale: 70, bg: "#f4ede4" });
  await placeAll();
  await pickLogo("#b91c1c");
  const r = await read();
  for (const id of ["a192", "a512", "mask"]) assert.equal(r.rows.find((x) => x.id === id)!.state, "ok", `${id} keeps Android's own icon`);
  assert.equal(r.rows.find((x) => x.id === "apple")!.state, "viejo");
  assert.ok(r.surfaces.android);

  // A project whose logo Plania found in its repo: its other icons are its own, never «viejo».
  await raw.query("delete from project_logos");
  rmSync(path.join(STORE, "_marca", "tienda", "surfaces.json"), { force: true });
  commit({ ...commits[tip], "public/brand/logo.svg": svg("#7c3aed") });
  const found = await read();
  assert.equal(found.logo?.source, "repo");
  assert.deepEqual(found.rows.filter((x) => x.state === "viejo"), []);
});
