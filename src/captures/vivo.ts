// PLA-I52-5: En vivo. «Pruébala en vivo» opens the delivery's own copy already signed in, on the Mac and, when the
// Mac has Tailscale, on the phone. Plania signs the test user in once (a fresh password, never kept), then serves
// the copy through a small proxy on a loopback port that adds that session to every request. Nothing listens on the
// LAN: the proxy binds 127.0.0.1 and refuses any other peer; `tailscale serve` forwards the tailnet to it, as it
// already does for Plania itself (docs/phone-access.md). Off with the delivery's copy. Nothing paid.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { entregaEnv, entregaRead } from "./prueba.js";
import { sessionCookies } from "./run.js";
import type { CaptureSettings } from "./settings.js";

export type VivoRead = {
  url: string | null; // what «Pruébala en vivo» opens (the tailnet address when there is one, else localhost)
  local_url: string | null;
  tailnet: boolean; // the phone can open it
  signed_in: boolean; // the proxy carries the test user's session
  user: string | null; // the test user, for «Copiar contraseña» when signing in did not work
  error: string | null;
  hint: string | null; // what to do so the phone can open it
};

type Target = { port: number; worktree: string | null };
type Tailscale = { on(port: number, to: string): Promise<string | null>; off(port: number): Promise<void> };
export type VivoDeps = {
  target?: (slug: string) => Target | null;
  signIn?: (input: { base_url: string; checkout: string; settings: CaptureSettings }) => Promise<{ name: string; value: string }[]>;
  tailscale?: Tailscale | null;
};

type Live = { slug: string; key: string | null; server: http.Server; port: number; target: number; cookies: { name: string; value: string }[]; read: VivoRead };
const lives = new Map<string, Live>();
let deps: VivoDeps = {};
export function setVivoDeps(d: VivoDeps): void {
  deps = d;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
export const isLoopback = (addr: string | undefined): boolean => !!addr && LOOPBACK.has(addr);

// Request cookies plus the session's, the session winning on a name clash (the owner never has the app's login).
export function withSession(header: string | undefined, session: { name: string; value: string }[]): string | undefined {
  if (!session.length) return header;
  const mine = new Map(session.map((c) => [c.name, c.value]));
  const theirs = (header ?? "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !mine.has(p.split("=")[0]!.trim()));
  return [...theirs, ...[...mine].map(([n, v]) => `${n}=${v}`)].join("; ");
}

// PLA-91 (guided test PLA-86, F-15): the browser's Origin and Referer name the proxy (localhost:<proxy port>), while
// Host is rewritten to the copy. Next.js compares Origin with Host for Server Actions and answered every form post
// with 500 «Invalid Server Actions request», so nothing could be saved in the live copy. Both are rewritten to the
// copy's own origin when they point at this proxy (on loopback or the tailnet); any other origin is left as it is.
export function toCopyOrigin(value: string | undefined, proxyPort: number, target: number): string | undefined {
  if (!value) return value;
  try {
    const u = new URL(value);
    if (Number(u.port) !== proxyPort) return value;
    return `http://localhost:${target}${value.slice(u.origin.length)}`;
  } catch {
    return value;
  }
}

// A redirect to the copy's own origin becomes a path, so the browser stays on the proxy.
export function localLocation(location: string, target: number): string {
  try {
    const u = new URL(location);
    if ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && Number(u.port) === target) return u.pathname + u.search + u.hash;
  } catch {
    // already a path
  }
  return location;
}

function proxy(live: Omit<Live, "server" | "port" | "read">): http.Server {
  const server = http.createServer((req, res) => {
    if (!isLoopback(req.socket.remoteAddress)) {
      res.writeHead(403).end("Solo desde esta Mac o tu tailnet");
      return;
    }
    const headers = { ...req.headers, host: `localhost:${live.target}` } as http.OutgoingHttpHeaders;
    const proxyPort = (req.socket.localPort ?? 0) as number;
    for (const k of ["origin", "referer"] as const) {
      const v = toCopyOrigin(req.headers[k], proxyPort, live.target);
      if (v) headers[k] = v;
    }
    const cookie = withSession(req.headers.cookie, live.cookies);
    if (cookie) headers.cookie = cookie;
    delete headers["x-forwarded-host"];
    const up = http.request({ host: "127.0.0.1", port: live.target, method: req.method, path: req.url, headers }, (r) => {
      const out = { ...r.headers };
      if (typeof out.location === "string") out.location = localLocation(out.location, live.target);
      res.writeHead(r.statusCode ?? 502, out);
      r.pipe(res);
    });
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("La copia de la entrega no responde");
    });
    req.pipe(up);
  });
  // Dev servers keep a socket open for live reload: pass upgrades straight through.
  server.on("upgrade", (req, socket: Socket, head) => {
    if (!isLoopback(socket.remoteAddress)) return socket.destroy();
    const up = connect(live.target, "127.0.0.1", () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i]!;
        lines.push(`${k}: ${k.toLowerCase() === "host" ? `localhost:${live.target}` : req.rawHeaders[i + 1]}`);
      }
      up.write(lines.join("\r\n") + "\r\n\r\n");
      if (head?.length) up.write(head);
      up.pipe(socket).pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  return server;
}

// The Mac's Tailscale CLI, when there is one: `tailscale serve --bg --https=<port> <to>`, and its DNS name.
function tailscaleBin(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const p of [env.PLANIA_TAILSCALE_BIN, "/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale"]) if (p && existsSync(p)) return p;
  return null;
}
const run = (bin: string, args: string[]) =>
  new Promise<{ code: number; out: string }>((resolve) =>
    execFile(bin, args, { timeout: 20_000 }, (err, stdout) => resolve({ code: err ? 1 : 0, out: String(stdout) })),
  );
export function realTailscale(): Tailscale | null {
  const bin = tailscaleBin();
  if (!bin) return null;
  return {
    async on(port, to) {
      if ((await run(bin, ["serve", "--bg", `--https=${port}`, to])).code !== 0) return null;
      const st = await run(bin, ["status", "--json"]);
      try {
        const dns = String((JSON.parse(st.out) as { Self?: { DNSName?: string } }).Self?.DNSName ?? "").replace(/\.$/, "");
        return dns ? `https://${dns}:${port}` : null;
      } catch {
        return null;
      }
    },
    async off(port) {
      await run(bin, ["serve", `--https=${port}`, "off"]);
    },
  };
}

// PLA-111 (guided test PLA-86, F-33): each «encender» got a random port, so a tab or a phone bookmark from the last
// try pointed nowhere. A project's live copy now asks for the same port every time (4300–4399 by its slug) and
// takes any free one only when that one is busy.
export const VIVO_BASE = 4300;
export const vivoPort = (slug: string): number => VIVO_BASE + ([...slug].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 100);
const listenOn = (server: http.Server, port: number) =>
  new Promise<boolean>((resolve, reject) => {
    const fail = (e: NodeJS.ErrnoException) => (e.code === "EADDRINUSE" && port !== 0 ? resolve(false) : reject(e));
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", fail);
      resolve(true);
    });
  });

const PHONE_HINT = "Para abrirla en el teléfono, esta Mac necesita Tailscale (docs/phone-access.md).";

// Starts (or returns) the live copy of a project's delivery. The delivery's copy must be on (F2).
export async function startVivo(db: Db, slug: string): Promise<VivoRead> {
  const had = lives.get(slug);
  if (had) return had.read;
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: slug });
  const settings = p.settings.capture;
  if (!settings) throw new ToolError("INVALID_FILTER", { field: "settings.capture", hint: "the project has no capture settings" });
  const e = entregaRead(slug);
  const target = deps.target ? deps.target(slug) : e && e.phase === "live" && e.port ? { port: e.port, worktree: e.worktree } : null;
  if (!target) throw new ToolError("INVALID_FILTER", { field: "entrega", hint: "la copia de la entrega no está encendida" });

  const user = settings.session?.user ?? null;
  let cookies: { name: string; value: string }[] = [];
  let error: string | null = null;
  if (settings.session) {
    try {
      cookies = await (deps.signIn ?? sessionCookies)({ base_url: `http://localhost:${target.port}`, checkout: target.worktree ?? "", settings, env: entregaEnv(slug) });
      if (!cookies.length) error = "No se pudo entrar con el usuario de prueba";
    } catch (err) {
      error = err instanceof Error ? err.message.split("\n")[0]!.slice(0, 200) : String(err);
    }
  }
  const base = { slug, key: e?.key ?? null, target: target.port, cookies };
  const server = proxy(base);
  if (!(await listenOn(server, vivoPort(slug)))) await listenOn(server, 0);
  const port = (server.address() as AddressInfo).port;
  const local = `http://localhost:${port}`;
  const ts = deps.tailscale === undefined ? realTailscale() : deps.tailscale;
  const tailnetUrl = ts ? await ts.on(port, `http://127.0.0.1:${port}`).catch(() => null) : null;
  const read: VivoRead = {
    url: tailnetUrl ?? local,
    local_url: local,
    tailnet: !!tailnetUrl,
    signed_in: !settings.session || cookies.length > 0,
    user,
    error,
    hint: tailnetUrl ? null : PHONE_HINT,
  };
  lives.set(slug, { ...base, server, port, read });
  return read;
}

export function vivoRead(slug: string): VivoRead | null {
  return lives.get(slug)?.read ?? null;
}

// Off: the proxy closes and its tailnet entry goes. Called when the delivery's copy stops.
export async function stopVivo(slug: string): Promise<void> {
  const l = lives.get(slug);
  if (!l) return;
  lives.delete(slug);
  await new Promise<void>((resolve) => l.server.close(() => resolve()));
  l.server.closeAllConnections?.();
  const ts = deps.tailscale === undefined ? realTailscale() : deps.tailscale;
  if (ts && l.read.tailnet) await ts.off(l.port).catch(() => undefined);
}

export async function stopAllVivo(): Promise<void> {
  for (const slug of [...lives.keys()]) await stopVivo(slug);
}
