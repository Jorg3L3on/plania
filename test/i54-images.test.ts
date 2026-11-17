// PLA-I54-2: pictures on a request. The store (once per content, type by bytes, 5 MB, 6 per request), the four
// routes behind the session cookie, and a run on a task with pictures gets their paths in its prompt.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const scratch = mkdtempSync(path.join(tmpdir(), "plania-i54-images-"));
const STORE = path.join(scratch, "captures");
process.env.PLANIA_CAPTURES_DIR = STORE;
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const writes = await import("../src/mcp/writes.js");
const images = await import("../src/pedidos/images.js");
const runner = await import("../src/runner/runner.js");
const { wakeAgent } = await import("../src/jobs/heartbeat.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");

type Db = ReturnType<typeof makeDb>["db"];
type Json = Record<string, any>;
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
const ctx = { actor: { agent: "test-agent", session_id: "s-i54-2" } };
const cookie = () => `${SESSION_COOKIE}=${createSession()}`;
const dir = () => path.join(STORE, "pedidos", "micasa");

// Smallest headers each type is known by; tag makes distinct contents.
function png(w: number, h: number, tag = ""): Buffer {
  const b = Buffer.alloc(33 + tag.length);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b.write(tag, 33, "ascii");
  return b;
}
function jpeg(w: number, h: number): Buffer {
  // SOI, APP0 (len 4), SOF0 (len 11: precision, height, width, ...)
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
}
function webp(w: number, h: number): Buffer {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(22, 4);
  b.write("WEBP", 8, "ascii");
  b.write("VP8X", 12, "ascii");
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
}

const url = (key: string, rest = "") => `/api/company/projects/micasa/tasks/${key}/images${rest}`;
const upload = (key: string, body: Buffer, type = "image/png", headers: Record<string, string> = { Cookie: cookie() }) =>
  app.request(url(key), { method: "POST", headers: { ...headers, "Content-Type": type }, body: new Uint8Array(body) });
const ready = (key: string) => writes.createTask(db, { project: "micasa", key, title: "Pedido con fotos", scope: "Scope", checks: ["Done"], status: "Ready" } as never, ctx);

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
});

after(async () => {
  await runner.waitForAllRuns();
  await closeDb?.();
  await raw?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("I54-2: the type comes from the bytes, with the size when the header says it", () => {
  assert.equal(images.sniffImage(png(10, 20)), "image/png");
  assert.equal(images.sniffImage(jpeg(30, 40)), "image/jpeg");
  assert.equal(images.sniffImage(webp(50, 60)), "image/webp");
  assert.equal(images.sniffImage(Buffer.from("GIF89a....")), null);
  assert.equal(images.sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
  assert.deepEqual(images.imageSize(png(10, 20), "image/png"), { width: 10, height: 20 });
  assert.deepEqual(images.imageSize(jpeg(30, 40), "image/jpeg"), { width: 30, height: 40 });
  assert.deepEqual(images.imageSize(webp(50, 60), "image/webp"), { width: 50, height: 60 });
  assert.equal(images.imageSize(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg"), null);
});

test("I54-2 #1: the store writes one file per content, under pedidos/<project>, and one row per picture on a request", async () => {
  await ready("IMG-1");
  await ready("IMG-1B");
  const a = await images.addTaskImage(db, { slug: "micasa", key: "IMG-1", bytes: png(4, 3, "a"), actor: ctx.actor });
  assert.equal(a.created, true);
  assert.equal(a.image.mime, "image/png");
  assert.equal(a.image.width, 4);
  const again = await images.addTaskImage(db, { slug: "micasa", key: "IMG-1", bytes: png(4, 3, "a"), actor: ctx.actor });
  assert.equal(again.created, false, "the same picture twice is the same row");
  assert.equal(again.image.id, a.image.id);
  const other = await images.addTaskImage(db, { slug: "micasa", key: "IMG-1B", bytes: png(4, 3, "a"), actor: ctx.actor });
  assert.equal(other.created, true, "another request may hold the same picture");
  const files = readdirSync(dir());
  assert.equal(files.length, 1, "one file for one content");
  assert.match(files[0]!, /^[0-9a-f]{64}\.png$/);
  assert.equal((await raw.query(`select count(*)::int as n from task_images`)).rows[0].n, 2);

  // Deleting one row keeps the file the other request still points at; the last one takes the file.
  assert.deepEqual(await images.deleteTaskImage(db, "micasa", "IMG-1", a.image.id), { file_removed: false });
  assert.equal(readdirSync(dir()).length, 1);
  assert.deepEqual(await images.deleteTaskImage(db, "micasa", "IMG-1B", other.image.id), { file_removed: true });
  assert.equal(readdirSync(dir()).length, 0);
  await assert.rejects(images.addTaskImage(db, { slug: "micasa", key: "NOPE-9", bytes: png(1, 1), actor: ctx.actor }), { code: "PEDIDO_NO_ENCONTRADO" });
});

test("I54-2 #1: upload takes PNG, JPEG and WebP (raw or multipart) and refuses other types, over 5 MB and a seventh picture", async () => {
  await ready("IMG-2");
  const first = await upload("IMG-2", png(8, 8, "1"));
  assert.equal(first.status, 201);
  const body = (await first.json()) as Json;
  assert.equal(body.image.url, `/api/company/projects/micasa/tasks/IMG-2/images/${body.image.id}`);
  assert.equal((await upload("IMG-2", png(8, 8, "1"))).status, 200, "the same picture again is not a new one");
  assert.equal((await upload("IMG-2", jpeg(2, 2), "image/jpeg")).status, 201);
  // The name and the declared type do not matter, the bytes do.
  assert.equal((await upload("IMG-2", webp(3, 3), "application/octet-stream")).status, 201);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(png(9, 9, "multi"))], { type: "image/png" }), "captura.png");
  const multi = await app.request(url("IMG-2"), { method: "POST", headers: { Cookie: cookie() }, body: form });
  assert.equal(multi.status, 201);

  const gif = await upload("IMG-2", Buffer.from("GIF89a\x01\x00\x01\x00"), "image/gif");
  assert.equal(gif.status, 415);
  assert.deepEqual(await gif.json(), { error: "TIPO_NO_ADMITIDO", message: "Solo se aceptan imágenes PNG, JPEG o WebP." });
  const disguised = new FormData();
  disguised.append("file", new Blob(["<svg/>"], { type: "image/png" }), "foto.png");
  assert.equal((await app.request(url("IMG-2"), { method: "POST", headers: { Cookie: cookie() }, body: disguised })).status, 415);

  const big = Buffer.concat([png(1, 1), Buffer.alloc(images.MAX_IMAGE_BYTES)]);
  const tooBig = await upload("IMG-2", big);
  assert.equal(tooBig.status, 413);
  assert.deepEqual(await tooBig.json(), { error: "IMAGEN_GRANDE", message: "La imagen pesa más de 5 MB." });
  const justUnder = Buffer.concat([png(1, 1, "edge"), Buffer.alloc(images.MAX_IMAGE_BYTES - png(1, 1, "edge").length)]);
  assert.equal(justUnder.length, images.MAX_IMAGE_BYTES);
  assert.equal((await upload("IMG-2", justUnder)).status, 201, "exactly 5 MB is allowed");

  const empty = await upload("IMG-2", Buffer.alloc(0));
  assert.equal(empty.status, 400);
  assert.equal(((await empty.json()) as Json).error, "IMAGEN_VACIA");

  assert.equal((await upload("IMG-2", png(5, 5, "six"))).status, 201);
  assert.equal((await raw.query(`select count(*)::int as n from task_images t join tasks k on k.id = t.task_id where k.key = 'IMG-2'`)).rows[0].n, 6);
  const seventh = await upload("IMG-2", png(5, 5, "seven"));
  assert.equal(seventh.status, 409);
  assert.deepEqual(await seventh.json(), { error: "DEMASIADAS_IMAGENES", message: "Un pedido admite hasta 6 imágenes." });
  assert.equal((await upload("IMG-2", png(8, 8, "1"))).status, 200, "a picture already there is still answered at six");

  const missing = await upload("NOPE-1", png(1, 1));
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as Json).message, "No encontré ese pedido.");
});

test("I54-2 #1: two uploads at once never make a seventh picture", async () => {
  await ready("IMG-RACE");
  const all = await Promise.all(Array.from({ length: 9 }, (_, i) => upload("IMG-RACE", png(2, 2, `r${i}`))));
  const codes = all.map((r) => r.status).sort();
  assert.deepEqual(codes, [201, 201, 201, 201, 201, 201, 409, 409, 409]);
});

test("I54-2 #2: list, serve and delete work, and every route needs the session cookie", async () => {
  await ready("IMG-3");
  const a = (await (await upload("IMG-3", png(6, 7, "x"))).json()) as Json;
  const b = (await (await upload("IMG-3", jpeg(11, 12), "image/jpeg")).json()) as Json;

  const list = await app.request(url("IMG-3"), { headers: { Cookie: cookie() } });
  assert.equal(list.status, 200);
  const rows = ((await list.json()) as Json).images as Json[];
  assert.deepEqual(rows.map((r) => [r.id, r.mime, r.width, r.height]), [
    [a.image.id, "image/png", 6, 7],
    [b.image.id, "image/jpeg", 11, 12],
  ]);
  assert.deepEqual(Object.keys(rows[0]!).sort(), ["bytes", "created_at", "height", "id", "mime", "url", "width"]);

  const got = await app.request(url("IMG-3", `/${b.image.id}`), { headers: { Cookie: cookie() } });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("Content-Type"), "image/jpeg");
  assert.match(got.headers.get("Cache-Control") ?? "", /^private/);
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), jpeg(11, 12));
  // An id of another request is not found through this one.
  await ready("IMG-3B");
  assert.equal((await app.request(`/api/company/projects/micasa/tasks/IMG-3B/images/${b.image.id}`, { headers: { Cookie: cookie() } })).status, 404);
  assert.equal((await app.request(url("IMG-3", "/not-a-uuid"), { headers: { Cookie: cookie() } })).status, 404);

  // No cookie: 401 on all four; a Bearer: 403 even with the cookie.
  const id = a.image.id as string;
  const calls: [string, string][] = [["POST", url("IMG-3")], ["GET", url("IMG-3")], ["GET", url("IMG-3", `/${id}`)], ["DELETE", url("IMG-3", `/${id}`)]];
  for (const [method, u] of calls) {
    const body = method === "POST" ? new Uint8Array(png(1, 1, "anon")) : undefined;
    assert.equal((await app.request(u, { method, body, headers: { "Content-Type": "image/png" } })).status, 401, `${method} ${u} without cookie`);
    assert.equal((await app.request(u, { method, body, headers: { "Content-Type": "image/png", Cookie: cookie(), Authorization: "Bearer test-token" } })).status, 403, `${method} ${u} with a Bearer`);
  }
  assert.equal(rows.length, 2, "nothing was written without the cookie");

  const del = await app.request(url("IMG-3", `/${id}`), { method: "DELETE", headers: { Cookie: cookie() } });
  assert.equal(del.status, 200);
  assert.deepEqual(await del.json(), { deleted: true });
  assert.equal((await app.request(url("IMG-3", `/${id}`), { headers: { Cookie: cookie() } })).status, 404);
  assert.equal((await app.request(url("IMG-3", `/${id}`), { method: "DELETE", headers: { Cookie: cookie() } })).status, 404);
  const after = ((await (await app.request(url("IMG-3"), { headers: { Cookie: cookie() } })).json()) as Json).images as Json[];
  assert.deepEqual(after.map((r) => r.id), [b.image.id]);
});

// ---- The run prompt

test("I54-2 #4: the prompt lists the pictures' absolute paths, and says nothing when there are none", () => {
  const base = {
    agent: "PO MiCasa",
    role: "po",
    project: { slug: "micasa", title: "MiCasa" },
    goal: null,
    task: { key: "MIC-IDEA3", title: "Botón de buscar" },
    workspace: null,
    sessionId: "run-1",
  };
  const withPics = runner.userPrompt({ ...base, images: ["/Users/x/plania-captures/pedidos/micasa/aa.png", "/Users/x/plania-captures/pedidos/micasa/bb.jpg"] });
  assert.match(withPics, /Pictures Jorge attached to this request \(open each one with the Read tool before you answer\):\n- \/Users\/x\/plania-captures\/pedidos\/micasa\/aa\.png\n- \/Users\/x\/plania-captures\/pedidos\/micasa\/bb\.jpg/);
  assert.doesNotMatch(runner.userPrompt(base), /Pictures/);
  assert.doesNotMatch(runner.userPrompt({ ...base, images: [] }), /Pictures/);
});

class FakeChild extends EventEmitter {
  pid: number;
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  exit(code: number): void {
    this.stdout.write(
      `${JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, session_id: `sess-${this.pid}`, result: "OK", modelUsage: { m: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } })}\n`,
    );
    this.stdout.end();
    setImmediate(() => this.emit("exit", code, null));
  }
}

const repo = path.join(scratch, "repos", "micasa");
const wtRoot = path.join(scratch, "worktrees");
function fakes() {
  const spawned: { prompt: string; child: FakeChild }[] = [];
  let pid = 60_000;
  const deps = {
    env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", CLAUDE_CODE_BIN: "/fake/bin/claude" } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: wtRoot,
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async (args: string[], cwd: string) => {
      if (args[0] === "worktree" && args[1] === "add") {
        const target = args.find((a) => a.startsWith(wtRoot))!;
        mkdirSync(target, { recursive: true });
        writeFileSync(path.join(target, ".git"), "gitdir: fake\n");
      }
      if (args[0] === "rev-parse" && args[1] === "--verify") return { code: 1, stdout: "", stderr: "" };
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return { code: 0, stdout: "jl/feature\n", stderr: "" };
      if (args[0] === "diff" && cwd.startsWith(wtRoot)) return { code: 0, stdout: "src/app.ts\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    spawn: (_command: string, args: string[]) => {
      pid += 1;
      const child = new FakeChild(pid);
      spawned.push({ prompt: args[args.indexOf("-p") + 1]!, child });
      return child;
    },
    kill: () => undefined,
    reportTokens: async (_db: unknown, input: unknown) => input,
    probeUsage: async () => null,
  };
  return { deps, spawned };
}

beforeEach(async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
});

test("I54-2 #4: a run on a task with pictures gets their paths in its prompt; a task without gets none", async () => {
  mkdirSync(repo, { recursive: true });
  const micasa = (await raw.query(`select id from projects where slug = 'micasa'`)).rows[0].id as string;
  await raw.query(`update agents set heartbeat_minutes = null, adapter = 'none', adapter_config = '{}'::jsonb`);
  await raw.query(`update agents set adapter = 'claude_code', project_id = $1 where slug = 'taller'`, [micasa]);
  await raw.query(`update projects set settings = jsonb_build_object('local', jsonb_build_object('repo_path', $1::text)) where slug = 'micasa'`, [repo]);
  await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, 'Prompt: Taller', '# Taller', '{"agent":"t","session_id":"s"}')`, [micasa]);
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  await raw.query(`update runner_settings set company_paused = false, max_concurrent = 2, cooldown_minutes = 0, plan_guard_pct = 70, guard_override = false, reserve_tokens = 1000`);
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, seven_day_pct, five_hour_resets_at) values (now(), 'stream', 'allowed', 10, 19, now() + interval '3 hours')`);

  await ready("RUN-PIC");
  const one = await images.addTaskImage(db, { slug: "micasa", key: "RUN-PIC", bytes: png(3, 3, "run1"), actor: ctx.actor });
  const two = await images.addTaskImage(db, { slug: "micasa", key: "RUN-PIC", bytes: jpeg(4, 4), actor: ctx.actor });
  const files = (await raw.query(`select file from task_images where id in ($1, $2) order by created_at, id`, [one.image.id, two.image.id])).rows.map((r) => path.join(dir(), r.file as string));
  assert.ok(files.every((f) => existsSync(f)));

  const f = fakes();
  assert.equal((await wakeAgent(db, { agent: "taller", taskKey: "RUN-PIC", now: new Date() }, { runner: f.deps as never })).reason, "ok");
  const prompt = f.spawned[0]!.prompt;
  for (const p of await images.taskImagePaths(db, micasa, "RUN-PIC")) assert.ok(prompt.includes(`\n- ${p}`), `prompt names ${p}`);
  assert.ok(files.every((p) => path.isAbsolute(p) && prompt.includes(p)));
  f.spawned[0]!.child.exit(0);
  await runner.waitForAllRuns();

  await ready("RUN-NOPIC");
  runner.resetRunnerForTests();
  const g = fakes();
  assert.equal((await wakeAgent(db, { agent: "taller", taskKey: "RUN-NOPIC", now: new Date() }, { runner: g.deps as never })).reason, "ok");
  assert.doesNotMatch(g.spawned[0]!.prompt, /Pictures Jorge attached/);
  g.spawned[0]!.child.exit(0);
  await runner.waitForAllRuns();
});
