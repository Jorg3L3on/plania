// 2.12 "Hoy" and push: the screen's digest, push subscriptions, the per-minute push job, and the
// session cookie behind Tailscale's reverse proxy.
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE, isSecureRequest } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { hashPassword } = await import("../src/auth/password.js");
const writes = await import("../src/mcp/writes.js");
const { ask } = await import("../src/mcp/questions.js");
const { runPush, messageFor } = await import("../src/jobs/push.js");
const { generateVapidKeys, webPushSender } = await import("../src/push.js");
const { JOBS } = await import("../src/jobs/index.js");

type Json = Record<string, any>;
const ctx = { actor: { agent: "test-agent", session_id: "s1" } };
const T = { scope: "s", checks: ["c"] };
const KEYS = generateVapidKeys();

let raw: pg.Client;
const cookie = `${SESSION_COOKIE}=${createSession()}`;

function req(method: string, path: string, body?: unknown, opts: { cookie?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  const c = opts.cookie === undefined ? cookie : opts.cookie;
  if (c) headers.Cookie = c;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function setVapid(on: boolean) {
  if (on) {
    process.env.PLANIA_VAPID_PUBLIC = KEYS.publicKey;
    process.env.PLANIA_VAPID_PRIVATE = KEYS.privateKey;
    process.env.PLANIA_VAPID_SUBJECT = "mailto:test@example.com";
  } else {
    delete process.env.PLANIA_VAPID_PUBLIC;
    delete process.env.PLANIA_VAPID_PRIVATE;
    delete process.env.PLANIA_VAPID_SUBJECT;
  }
}

// A browser's subscription keys: a P-256 public key and 16 random bytes, base64url.
function browserKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
}

async function withDb<T>(fn: (db: ReturnType<typeof makeDb>["db"]) => Promise<T>): Promise<T> {
  const { db, close } = makeDb();
  try {
    return await fn(db);
  } finally {
    await close();
  }
}

// Records what the push job would send, answering with a status per endpoint (default 201).
function fakeSender(statusFor: (endpoint: string) => number = () => 201) {
  const sent: { endpoint: string; body: Json }[] = [];
  const send = async (sub: { endpoint: string }, body: string) => {
    const status = statusFor(sub.endpoint);
    if (status >= 400) throw Object.assign(new Error(`push ${status}`), { statusCode: status });
    sent.push({ endpoint: sub.endpoint, body: JSON.parse(body) });
  };
  return { sent, send };
}

before(async () => {
  process.env.PLANIA_PASSWORD_HASH = await hashPassword("test-password-123");
  raw = await resetTestDb();
  await withDb(async (db) => {
    await writes.createTask(db, { project: "micasa", kind: "initiative", title: "Init", scope: "PRD" }, ctx); // MIC-I1
    await writes.createTask(db, { project: "micasa", title: "Fase", ...T, parent_key: "MIC-I1", phase: 1 }, ctx); // MIC-I1-1
    await writes.createTask(db, { project: "zigzag", title: "Suelto", ...T }, ctx); // ZIG-01
  });
});

after(async () => {
  setVapid(false);
  await raw?.end();
});

describe("GET /api/digest and Visto", () => {
  test("reads as the screen without moving its bookmark; Visto moves it; since wins", async () => {
    const res = await req("GET", "/api/digest");
    assert.equal(res.status, 200);
    const d = (await res.json()) as Json;
    assert.equal(d.since_from, "default");
    assert.ok(d.cursor > 0);
    const micasa = d.projects.find((p: Json) => p.slug === "micasa");
    assert.ok(micasa, "micasa changed in the last 24 h");
    assert.ok(Array.isArray(micasa.highlights.done));
    assert.equal((await raw.query("select count(*)::int as n from digest_reads where reader = 'screen'")).rows[0].n, 0, "reading does not remember");

    const seen = await req("POST", "/api/digest/seen", { cursor: d.cursor });
    assert.equal(seen.status, 200);
    const again = (await (await req("GET", "/api/digest")).json()) as Json;
    assert.equal(again.since_from, "memory");
    assert.equal(again.since, d.cursor);
    assert.deepEqual(again.projects, [], "nothing new since Visto");

    const fromDevice = (await (await req("GET", "/api/digest?since=0")).json()) as Json;
    assert.equal(fromDevice.since_from, "since");
    assert.ok(fromDevice.projects.length >= 2);
    assert.equal((await req("GET", "/api/digest?since=-1")).status, 400);
    assert.equal((await req("POST", "/api/digest/seen", { cursor: "x" })).status, 400);
    assert.equal((await req("GET", "/api/digest", undefined, { cookie: null })).status, 401);
  });
});

describe("push subscriptions", () => {
  test("the public key is PUSH_NOT_CONFIGURED until .env has the VAPID trio", async () => {
    setVapid(false);
    const off = await req("GET", "/api/push/public-key");
    assert.equal(off.status, 503);
    assert.deepEqual(await off.json(), { error: "PUSH_NOT_CONFIGURED" });
    setVapid(true);
    const on = await req("GET", "/api/push/public-key");
    assert.equal(on.status, 200);
    assert.deepEqual(await on.json(), { public_key: KEYS.publicKey });
  });

  test("subscribe upserts by endpoint; only https endpoints; DELETE removes; the cookie is required", async () => {
    const keys = browserKeys();
    const sub = { endpoint: "https://push.example/abc", keys };
    const a = await req("POST", "/api/push/subscribe", sub, { headers: { "User-Agent": "iPhone Safari" } });
    assert.equal(a.status, 201);
    const b = await req("POST", "/api/push/subscribe", { ...sub, keys: browserKeys() });
    assert.equal(b.status, 201);
    const { rows } = await raw.query("select endpoint, keys, user_agent from push_subscriptions");
    assert.equal(rows.length, 1, "the same device again is the same row");
    assert.notEqual(rows[0].keys.p256dh, keys.p256dh);
    assert.equal((await req("POST", "/api/push/subscribe", { endpoint: "http://push.example/x", keys })).status, 400);
    assert.equal((await req("POST", "/api/push/subscribe", { endpoint: "https://push.example/x" })).status, 400);
    assert.equal((await req("POST", "/api/push/subscribe", sub, { cookie: null })).status, 401);
    const del = await req("DELETE", "/api/push/subscribe", { endpoint: sub.endpoint });
    assert.deepEqual(await del.json(), { removed: true });
    assert.equal((await raw.query("select count(*)::int as n from push_subscriptions")).rows[0].n, 0);
  });
});

describe("the push job", () => {
  beforeEach(async () => {
    setVapid(true);
    await raw.query("delete from push_subscriptions");
    await raw.query("delete from machine_state where key = 'push'");
  });

  test("runs every minute; the first run takes the bookmark and sends nothing", async () => {
    const job = JOBS.find((j) => j.name === "push");
    assert.equal(job?.intervalMs, 60_000);
    await withDb((db) => ask(db, { project: "micasa", key: "MIC-I1-1", question: "¿Antes?" }, ctx));
    await raw.query("insert into push_subscriptions (endpoint, keys) values ('https://push.example/1', '{\"p256dh\":\"x\",\"auth\":\"y\"}')");
    const fake = fakeSender();
    const first = await withDb((db) => runPush(db, new Date(), fake.send));
    assert.equal(first.new, 0);
    assert.equal(fake.sent.length, 0, "turning push on never replays the backlog");
    const { rows } = await raw.query("select value from machine_state where key = 'push'");
    assert.ok(rows[0].value.seen.some((id: string) => id.startsWith("question:")));
  });

  test("a question asked by an agent becomes one message opening Decisiones; a burst is one message", async () => {
    await raw.query("insert into push_subscriptions (endpoint, keys) values ('https://push.example/1', '{\"p256dh\":\"x\",\"auth\":\"y\"}'), ('https://push.example/2', '{\"p256dh\":\"x\",\"auth\":\"y\"}')");
    const fake = fakeSender();
    await withDb((db) => runPush(db, new Date(), fake.send)); // bookmark

    await withDb((db) => ask(db, { project: "zigzag", key: "ZIG-01", question: "¿PDF o CSV?" }, ctx));
    const one = await withDb((db) => runPush(db, new Date(), fake.send));
    assert.deepEqual(one, { new: 1, sent: 2, failed: 0, removed: 0 });
    assert.equal(fake.sent.length, 2, "one per device");
    assert.equal(fake.sent[0]!.body.url, "/inbox?tab=decisiones");
    assert.equal(fake.sent[0]!.body.title, "Te preguntan");
    assert.match(fake.sent[0]!.body.body, /^Zigzag · ZIG-01: ¿PDF o CSV\?/);

    fake.sent.length = 0;
    assert.equal((await withDb((db) => runPush(db, new Date(), fake.send))).new, 0, "nothing new, nothing sent");
    assert.equal(fake.sent.length, 0);

    // A human_action and a Jorge: line are two steps.
    await withDb(async (db) => {
      await writes.createTask(db, { project: "zigzag", title: "Con paso", ...T, blocked_by: [{ human_action: { text: "Crear la cuenta de Stripe" } }] }, ctx);
      await writes.setTask(db, { project: "zigzag", key: "ZIG-01", note: "Jorge: rotar la llave de Vercel" }, ctx);
    });
    const burst = await withDb((db) => runPush(db, new Date(), fake.send));
    assert.equal(burst.new, 2);
    assert.equal(fake.sent.length, 2, "two new steps, still one message per device");
    assert.equal(fake.sent[0]!.body.title, "Te toca: 2 pasos");
    assert.equal(fake.sent[0]!.body.url, "/inbox?tab=pasos");
  });

  test("a step alone opens Pasos; 410 removes the subscription, other failures stamp failed_at", async () => {
    await raw.query("insert into push_subscriptions (endpoint, keys) values ('https://push.example/gone', '{\"p256dh\":\"x\",\"auth\":\"y\"}'), ('https://push.example/flaky', '{\"p256dh\":\"x\",\"auth\":\"y\"}'), ('https://push.example/ok', '{\"p256dh\":\"x\",\"auth\":\"y\"}')");
    const fake = fakeSender((e) => (e.endsWith("/gone") ? 410 : e.endsWith("/flaky") ? 500 : 201));
    await withDb((db) => runPush(db, new Date(), fake.send));
    await withDb((db) => writes.createTask(db, { project: "micasa", title: "Paso", ...T, blocked_by: [{ human_action: { text: "Firmar el contrato" } }] }, ctx));
    const out = await withDb((db) => runPush(db, new Date(), fake.send));
    assert.deepEqual(out, { new: 1, sent: 1, failed: 1, removed: 1 });
    assert.equal(fake.sent[0]!.body.url, "/inbox?tab=pasos");
    const { rows } = await raw.query("select endpoint, failed_at, last_ok_at from push_subscriptions order by endpoint");
    assert.deepEqual(rows.map((r) => r.endpoint), ["https://push.example/flaky", "https://push.example/ok"]);
    assert.ok(rows[0].failed_at);
    assert.ok(rows[1].last_ok_at);
  });

  test("without VAPID keys nothing is sent but the bookmark moves", async () => {
    await raw.query("insert into push_subscriptions (endpoint, keys) values ('https://push.example/1', '{\"p256dh\":\"x\",\"auth\":\"y\"}')");
    const fake = fakeSender();
    await withDb((db) => runPush(db, new Date(), fake.send));
    setVapid(false);
    await withDb((db) => ask(db, { project: "micasa", key: "MIC-I1-1", question: "¿Sin llaves?" }, ctx));
    assert.equal((await withDb((db) => runPush(db, new Date(), fake.send))).new, 1);
    assert.equal(fake.sent.length, 0);
    setVapid(true);
    assert.equal((await withDb((db) => runPush(db, new Date(), fake.send))).new, 0, "keys added later do not replay it");
  });

  test("web-push signs and encrypts for a real push service; its 410 removes the row", async () => {
    const hits: { headers: IncomingMessage["headers"]; bytes: number }[] = [];
    let status = 201;
    // web-push only speaks https: a throwaway self-signed certificate, trusted for this test only.
    const dir = mkdtempSync(path.join(tmpdir(), "plania-push-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1", "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem")], { stdio: "ignore" });
    const tls = { key: readFileSync(path.join(dir, "key.pem")), cert: readFileSync(path.join(dir, "cert.pem")) };
    rmSync(dir, { recursive: true, force: true });
    const reject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    const server = createServer(tls, (r, res) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => {
        hits.push({ headers: r.headers, bytes: Buffer.concat(chunks).length });
        res.writeHead(status).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `https://127.0.0.1:${(server.address() as AddressInfo).port}/push/abc`;
    try {
      await raw.query("insert into push_subscriptions (endpoint, keys) values ($1, $2)", [endpoint, JSON.stringify(browserKeys())]);
      await withDb((db) => runPush(db, new Date(), webPushSender));
      await withDb((db) => ask(db, { project: "micasa", key: "MIC-I1-1", question: "¿Real?" }, ctx));
      const ok = await withDb((db) => runPush(db, new Date(), webPushSender));
      assert.equal(ok.sent, 1);
      const h = hits[0]!.headers;
      assert.equal(h["content-encoding"], "aes128gcm");
      assert.match(String(h.authorization), /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
      assert.equal(h.ttl, "3600");
      assert.equal(h.urgency, "high");
      assert.ok(hits[0]!.bytes > 100, "an encrypted body");

      status = 410;
      await withDb((db) => ask(db, { project: "micasa", key: "MIC-I1-1", question: "¿Sigue?" }, ctx));
      const gone = await withDb((db) => runPush(db, new Date(), webPushSender));
      assert.equal(gone.removed, 1);
      assert.equal((await raw.query("select count(*)::int as n from push_subscriptions")).rows[0].n, 0);
    } finally {
      server.close();
      if (reject === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = reject;
    }
  });

  test("messageFor names the project and the ticket", () => {
    const item = (over: Json) => ({ id: "1", kind: "human_action", group: "pasos", project: "filmia", key: "FIL-03", title: "t", why: "Subir el .env", wait_s: 0, ...over }) as any;
    const names = new Map([["filmia", "Filmia"]]);
    assert.deepEqual(messageFor([item({})], names), { title: "Te toca", body: "Filmia · FIL-03: Subir el .env", url: "/inbox?tab=pasos", tag: "plania-te-toca" });
    assert.equal(messageFor([item({ kind: "release", key: null, why: "2 tickets listos para prod" })], names).body, "Filmia: 2 tickets listos para prod");
    assert.equal(messageFor([item({}), item({ id: "2" })], names).title, "Te toca: 2 pasos");
  });
});

describe("the session cookie behind tailscale serve", () => {
  const login = (url: string, headers: Record<string, string> = {}) =>
    app.request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ password: "test-password-123" }) });

  test("Secure over HTTPS, behind X-Forwarded-Proto https, and on loopback; not on plain http elsewhere", async () => {
    const secure = async (url: string, headers?: Record<string, string>) => {
      const res = await login(url, headers);
      assert.equal(res.status, 204, url);
      return /; Secure/.test(res.headers.get("set-cookie") ?? "");
    };
    // What tailscale serve sends: the backend host, the tailnet name in X-Forwarded-Host, https in X-Forwarded-Proto.
    assert.equal(await secure("http://127.0.0.1:3737/api/login", { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "mac.tail1234.ts.net" }), true);
    assert.equal(await secure("http://mac.tail1234.ts.net/api/login", { "X-Forwarded-Proto": "https" }), true);
    assert.equal(await secure("http://localhost:3737/api/login"), true);
    assert.equal(await secure("http://127.0.0.1:3737/api/login"), true);
    assert.equal(await secure("https://plania.example/api/login"), true);
    assert.equal(await secure("http://plania.example/api/login"), false);
    assert.equal(await secure("http://127.0.0.1:3737/api/login", { "X-Forwarded-Proto": "http" }), false);
    const out = await app.request("http://127.0.0.1:3737/api/logout", { method: "POST", headers: { "X-Forwarded-Proto": "https" } });
    assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0.*Secure|Secure.*Max-Age=0/);
  });

  test("isSecureRequest reads the first X-Forwarded-Proto value and loopback names", () => {
    const r = (url: string, h: Record<string, string> = {}) => new Request(url, { headers: h });
    assert.equal(isSecureRequest(r("http://127.0.0.1/", { "X-Forwarded-Proto": "https, http" })), true);
    assert.equal(isSecureRequest(r("http://[::1]:3737/")), true);
    assert.equal(isSecureRequest(r("http://plania.localhost:3737/")), true);
    assert.equal(isSecureRequest(r("http://10.0.0.5:3737/")), false);
  });
});
