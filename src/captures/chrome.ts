// PLA-I46-6: headless Chrome over the DevTools protocol, with no new dependency: the Chrome already on
// the machine (or PLANIA_CHROME_PATH), Node's own WebSocket, a throwaway profile per run. Nothing paid.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { findOnPath } from "../lib/claude-bin.js";
import { runEnv } from "../runner/run-env.js";

export type Viewport = { width: number; height: number; mobile: boolean; scale: number };
export type Nav = { status: number | null; url: string };

// What the pipeline needs from a browser tab. Tests pass a fake one.
export interface BrowserPage {
  setViewport(v: Viewport): Promise<void>;
  goto(url: string): Promise<Nav>;
  evaluate<T>(expression: string): Promise<T>;
  screenshot(fullPage: boolean): Promise<Buffer>;
  // PLA-I52-5: the session the page holds (El Probador's live copy signs the owner in with it). Optional for fakes.
  cookies?(): Promise<{ name: string; value: string }[]>;
}
export interface Browser {
  page: BrowserPage;
  close(): Promise<void>;
}
export type LaunchBrowser = () => Promise<Browser>;

const NAV_TIMEOUT_MS = 30_000;
// A cold headless Chrome on the machine takes 2 to 10 s to open its DevTools port when idle (PLA-I46-16 measured it),
// and more next to the test suite or a second Chrome. 15 s failed under that load; this is only an upper bound.
const LAUNCH_TIMEOUT_MS = 45_000;
const SETTLE_MS = 600; // after load: fonts, client components, a streamed Suspense boundary

// Where Chrome lives: PLANIA_CHROME_PATH, the installed Google Chrome or Chromium, else Playwright's
// downloaded chromium if one is on the machine. Null when there is none.
// PLA-I2-4: on Linux too: the usual names on PATH (google-chrome, chromium, chromium-browser) and Playwright's
// Linux cache (~/.cache/ms-playwright/chromium-*/chrome-linux/chrome).
// P1: on Windows, Google Chrome under %ProgramFiles%, %ProgramFiles(x86)% and %LOCALAPPDATA% (a per-user install).
export function findChrome(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string | null {
  const candidates = [
    env.PLANIA_CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    ...windowsChrome(env),
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) if (exists(p)) return p;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
    const p = findOnPath(name, env, exists);
    if (p) return p;
  }
  const home = env.HOME || homedir();
  // PLA-I2-19: PLAYWRIGHT_BROWSERS_PATH and $XDG_CACHE_HOME too; newer Playwright unpacks chrome-linux64.
  const xdgCache = env.XDG_CACHE_HOME?.trim() && path.isAbsolute(env.XDG_CACHE_HOME.trim()) ? env.XDG_CACHE_HOME.trim() : path.join(home, ".cache");
  const mac = ["chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"];
  const linux = ["chrome-linux/chrome", "chrome-linux64/chrome"];
  const caches: [string, string[]][] = [
    ...(env.PLAYWRIGHT_BROWSERS_PATH && path.isAbsolute(env.PLAYWRIGHT_BROWSERS_PATH) ? [[env.PLAYWRIGHT_BROWSERS_PATH, [...linux, ...mac]] as [string, string[]]] : []),
    [path.join(home, "Library/Caches/ms-playwright"), mac],
    [path.join(xdgCache, "ms-playwright"), linux],
  ];
  for (const [pw, subs] of caches) {
    if (!exists(pw)) continue;
    let dirs: string[] = [];
    try {
      dirs = readdirSync(pw).filter((d) => d.startsWith("chromium-")).sort().reverse();
    } catch {
      continue;
    }
    for (const d of dirs) for (const sub of subs) if (exists(path.join(pw, d, sub))) return path.join(pw, d, sub);
  }
  return null;
}

// The variables are only set on Windows, so elsewhere this is empty.
function windowsChrome(env: NodeJS.ProcessEnv): string[] {
  return [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA]
    .map((dir) => dir?.trim())
    .filter((dir): dir is string => Boolean(dir))
    .map((dir) => path.win32.join(dir, "Google", "Chrome", "Application", "chrome.exe"));
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

  async cookies(): Promise<{ name: string; value: string }[]> {
    const r = await this.cdp.send<{ cookies: { name: string; value: string }[] }>("Network.getCookies");
    return r.cookies.map((c) => ({ name: c.name, value: c.value }));
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
  if (!bin) throw new Error("No Chrome on this machine (set PLANIA_CHROME_PATH)");
  const profile = mkdtempSync(path.join(tmpdir(), "plania-capture-"));
  const proc = spawn(
    bin,
    ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "about:blank"],
    // PLA-I2-13: the basics only, never the server's tokens (checkoutEnv, src/captures/run.ts).
    { stdio: "ignore", env: runEnv(process.env, { claude: false }) },
  );
  const cleanup = () => {
    if (proc.exitCode === null) proc.kill("SIGKILL");
    // A Chrome still shutting down can write into its profile while it is removed (ENOTEMPTY, PLA-I46-16): retry, and
    // never let a leftover temp folder fail the capture.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // left in the temp folder; the OS clears it
    }
  };
  try {
    const port = Number((await waitForFile(path.join(profile, "DevToolsActivePort"), LAUNCH_TIMEOUT_MS, proc)).split("\n")[0]);
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
