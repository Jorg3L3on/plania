// PLA-I52-5: En vivo. The delivery's copy opens signed in through Plania's loopback proxy, and on the tailnet when the
// Mac has Tailscale. A fake upstream app and a fake Tailscale; the throwaway test database. Nothing reaches a network.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const vivo = await import("../src/captures/vivo.js");
type Json = Record<string, any>;

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let upstream: http.Server;
let upPort = 0;
const seen: Json[] = [];
let tsCalls: string[] = [];
const fakeTs = { on: async (port: number, to: string) => (tsCalls.push(`on ${port} ${to}`), `https://mac.tailnet.ts.net:${port}`), off: async (port: number) => void tsCalls.push(`off ${port}`) };

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  upstream = http.createServer((req, res) => {
    seen.push({ url: req.url, cookie: req.headers.cookie ?? null, host: req.headers.host });
    if (req.url === "/panel/entrar-otra-vez") {
      res.writeHead(302, { location: `http://localhost:${upPort}/panel/entrar` }).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" }).end(`ok ${req.url}`);
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
  upPort = (upstream.address() as AddressInfo).port;
  await raw.query(`update projects set settings = settings || $1::jsonb where slug = 'zigzag'`, [
    JSON.stringify({ capture: { start_command: "x {port}", port: 3000, pages: [{ key: "a", path: "/", label: "A" }], session: { login_path: "/panel/entrar", user: "asesora@example.com", user_field: "correo", password_field: "contrasena", password_command: "true" } } }),
  ]);
});
after(async () => {
  await vivo.stopAllVivo();
  upstream.close();
  await raw.end();
});
beforeEach(async () => {
  await vivo.stopAllVivo();
  seen.length = 0;
  tsCalls = [];
});

const get = (url: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; body: string; location?: string }>((resolve, reject) => {
    http.get(url, { headers }, (r) => {
      let body = "";
      r.on("data", (d) => (body += d));
      r.on("end", () => resolve({ status: r.statusCode ?? 0, body, location: r.headers.location }));
    }).on("error", reject);
  });

describe("the helpers", () => {
  test("only this Mac's loopback is a peer; the session wins a cookie clash; a redirect to the copy stays on the proxy", () => {
    assert.ok(vivo.isLoopback("127.0.0.1") && vivo.isLoopback("::1") && vivo.isLoopback("::ffff:127.0.0.1"));
    assert.ok(!vivo.isLoopback("192.168.1.20") && !vivo.isLoopback("100.64.0.3") && !vivo.isLoopback(undefined));
    assert.equal(vivo.withSession("a=1; sesion=vieja", [{ name: "sesion", value: "nueva" }]), "a=1; sesion=nueva");
    assert.equal(vivo.withSession(undefined, [{ name: "s", value: "1" }]), "s=1");
    assert.equal(vivo.localLocation("http://localhost:4100/panel?x=1", 4100), "/panel?x=1");
    assert.equal(vivo.localLocation("https://example.com/a", 4100), "https://example.com/a");
  });
});

describe("En vivo", () => {
  test("opens signed in: every request to the copy carries the test user's session; redirects stay on the proxy", async () => {
    vivo.setVivoDeps({ target: () => ({ port: upPort, worktree: "/tmp/wt" }), signIn: async () => [{ name: "mianovia_sesion", value: "abc" }], tailscale: null });
    const r = await vivo.startVivo(db, "zigzag");
    assert.equal(r.signed_in, true);
    assert.equal(r.tailnet, false);
    assert.match(r.hint!, /Tailscale/);
    assert.match(r.url!, /^http:\/\/localhost:\d+$/);
    const page = await get(`${r.local_url}/panel/sucursales`, { cookie: "otra=1" });
    assert.equal(page.status, 200);
    assert.equal(page.body, "ok /panel/sucursales");
    assert.equal(seen.at(-1)!.cookie, "otra=1; mianovia_sesion=abc");
    assert.equal(seen.at(-1)!.host, `localhost:${upPort}`);
    const redirect = await get(`${r.local_url}/panel/entrar-otra-vez`);
    assert.equal(redirect.status, 302);
    assert.equal(redirect.location, "/panel/entrar");
    assert.deepEqual(await vivo.startVivo(db, "zigzag"), r, "a second click returns the same copy");
  });

  test("with Tailscale it opens on the tailnet, and the entry goes when the copy stops", async () => {
    vivo.setVivoDeps({ target: () => ({ port: upPort, worktree: null }), signIn: async () => [{ name: "s", value: "1" }], tailscale: fakeTs });
    const r = await vivo.startVivo(db, "zigzag");
    assert.equal(r.tailnet, true);
    assert.match(r.url!, /^https:\/\/mac\.tailnet\.ts\.net:\d+$/);
    assert.equal(r.hint, null);
    const port = Number(new URL(r.local_url!).port);
    assert.deepEqual(tsCalls, [`on ${port} http://127.0.0.1:${port}`], "the tailnet forwards to the loopback proxy only");
    await vivo.stopVivo("zigzag");
    assert.deepEqual(tsCalls.at(-1), `off ${port}`);
    assert.equal(vivo.vivoRead("zigzag"), null);
    await assert.rejects(get(`${r.local_url}/`), "the proxy is closed");
  });

  test("when signing in fails it still opens, and says who to enter as (Copiar contraseña)", async () => {
    vivo.setVivoDeps({ target: () => ({ port: upPort, worktree: null }), signIn: async () => { throw new Error("No se pudo entrar con asesora@example.com (seguía en /panel/entrar)"); }, tailscale: null });
    const r = await vivo.startVivo(db, "zigzag");
    assert.equal(r.signed_in, false);
    assert.equal(r.user, "asesora@example.com");
    assert.match(r.error!, /No se pudo entrar/);
    assert.equal((await get(`${r.local_url}/`)).status, 200);
  });

  test("without the delivery's copy on there is nothing to open; the screen's route says so", async () => {
    vivo.setVivoDeps({ target: () => null, tailscale: null });
    await assert.rejects(vivo.startVivo(db, "zigzag"), /INVALID_FILTER/);
    const res = await app.request(`/api/projects/zigzag/entrega/vivo`, { method: "POST", headers: { Cookie: `${SESSION_COOKIE}=${createSession()}` } });
    assert.equal(res.status, 400);
    assert.notEqual((await app.request(`/api/projects/zigzag/entrega/vivo`, { method: "POST" })).status, 200, "only the screen's session");
  });
});
