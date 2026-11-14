// PLA-I46-6: headless Chrome over the DevTools protocol, with no new dependency: the Chrome already on
// the Mac (or PLANIA_CHROME_PATH), Node's own WebSocket, a throwaway profile per run. Nothing paid.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

export type Viewport = { width: number; height: number; mobile: boolean; scale: number };
export type Nav = { status: number | null; url: string };

// What the pipeline needs from a browser tab. Tests pass a fake one.
export interface BrowserPage {
  setViewport(v: Viewport): Promise<void>;
  goto(url: string): Promise<Nav>;
  evaluate<T>(expression: string): Promise<T>;
  screenshot(fullPage: boolean): Promise<Buffer>;
}
export interface Browser {
  page: BrowserPage;
  close(): Promise<void>;
}
export type LaunchBrowser = () => Promise<Browser>;

const NAV_TIMEOUT_MS = 30_000;
const SETTLE_MS = 600; // after load: fonts, client components, a streamed Suspense boundary

// Where Chrome lives: PLANIA_CHROME_PATH, the installed Google Chrome or Chromium, else Playwright's
// downloaded chromium if one is on the Mac. Null when there is none.
export function findChrome(): string | null {
  const candidates = [
    process.env.PLANIA_CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) if (existsSync(p)) return p;
  const pw = path.join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(pw)) {
    const dirs = readdirSync(pw).filter((d) => d.startsWith("chromium-")).sort().reverse();
    for (const d of dirs) {
      for (const sub of ["chrome-mac-arm64", "chrome-mac"]) {
        const app = path.join(pw, d, sub, "Chromium.app/Contents/MacOS/Chromium");
        if (existsSync(app)) return app;
      }
    }
  }
  return null;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };
type Listener = (params: any) => void;

// One DevTools connection to one tab.
class Cdp {
  private id = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Map<string, Set<Listener>>();
  constructor(private ws: WebSocket) {
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: unknown };
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners.get(msg.method) ?? []) l(msg.params);
      }
    });
    ws.addEventListener("close", () => {
      for (const p of this.pending.values()) p.reject(new Error("Chrome closed the connection"));
      this.pending.clear();
    });
  }
  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method: string, l: Listener): () => void {
    const set = this.listeners.get(method) ?? this.listeners.set(method, new Set()).get(method)!;
    set.add(l);
    return () => set.delete(l);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what}: no answer after ${Math.round(ms / 1000)} s`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForFile(file: string, ms: number, proc: ChildProcess): Promise<string> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (proc.exitCode !== null) throw new Error(`Chrome exited with code ${proc.exitCode}`);
    if (existsSync(file)) {
      const text = readFileSync(file, "utf8");
      if (text.includes("\n")) return text;
    }
    await sleep(100);
  }
  throw new Error("Chrome did not open its DevTools port");
}

class CdpPage implements BrowserPage {
  private viewport: Viewport | null = null;
  constructor(private cdp: Cdp) {}

  async setViewport(v: Viewport): Promise<void> {
    this.viewport = v;
    await this.cdp.send("Emulation.setDeviceMetricsOverride", { width: v.width, height: v.height, deviceScaleFactor: v.scale, mobile: v.mobile });
    await this.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: v.mobile, maxTouchPoints: v.mobile ? 5 : 1 });
  }

  async goto(url: string): Promise<Nav> {
    let status: number | null = null;
    const offResponse = this.cdp.on("Network.responseReceived", (p: { type: string; response: { status: number } }) => {
      if (p.type === "Document") status = p.response.status;
    });
    const loaded = new Promise<void>((resolve) => {
      const off = this.cdp.on("Page.loadEventFired", () => (off(), resolve()));
    });
    try {
      const r = await this.cdp.send<{ errorText?: string }>("Page.navigate", { url });
      if (r.errorText) throw new Error(`could not open ${url}: ${r.errorText}`);
      await withTimeout(loaded, NAV_TIMEOUT_MS, `opening ${url}`);
      await sleep(SETTLE_MS);
      const at = await this.evaluate<string>("location.href");
      return { status, url: at };
    } finally {
      offResponse();
    }
  }

  async evaluate<T>(expression: string): Promise<T> {
    const r = await this.cdp.send<{ result: { value?: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }

  async screenshot(fullPage: boolean): Promise<Buffer> {
    const params: Record<string, unknown> = { format: "png" };
    if (fullPage && this.viewport) {
      const m = await this.cdp.send<{ cssContentSize: { width: number; height: number } }>("Page.getLayoutMetrics");
      const height = Math.min(Math.ceil(m.cssContentSize.height), 8000);
      params.clip = { x: 0, y: 0, width: this.viewport.width, height, scale: 1 };
      params.captureBeyondViewport = true;
    }
    const r = await this.cdp.send<{ data: string }>("Page.captureScreenshot", params);
    return Buffer.from(r.data, "base64");
  }
}

// Starts headless Chrome with a fresh profile (no cookies, no history of the owner's) and opens one tab.
export const launchChrome: LaunchBrowser = async () => {
  const bin = findChrome();
  if (!bin) throw new Error("No Chrome on this Mac (set PLANIA_CHROME_PATH)");
  const profile = mkdtempSync(path.join(tmpdir(), "plania-capture-"));
  const proc = spawn(
    bin,
    ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "about:blank"],
    { stdio: "ignore" },
  );
  const cleanup = () => {
    if (proc.exitCode === null) proc.kill("SIGKILL");
    rmSync(profile, { recursive: true, force: true });
  };
  try {
    const port = Number((await waitForFile(path.join(profile, "DevToolsActivePort"), 15_000, proc)).split("\n")[0]);
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    const tab = targets.find((t) => t.type === "page");
    if (!tab) throw new Error("Chrome opened no tab");
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve());
        ws.addEventListener("error", () => reject(new Error("could not connect to Chrome")));
      }),
      10_000,
      "connecting to Chrome",
    );
    const cdp = new Cdp(ws);
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");
    await cdp.send("Runtime.enable");
    return {
      page: new CdpPage(cdp),
      close: async () => {
        try {
          ws.close();
        } catch {
          // already closed
        }
        const exited = new Promise<void>((r) => proc.once("exit", () => r()));
        if (proc.exitCode === null) proc.kill("SIGTERM");
        await Promise.race([exited, sleep(2000)]);
        cleanup();
      },
    };
  } catch (e) {
    cleanup();
    throw e;
  }
};
