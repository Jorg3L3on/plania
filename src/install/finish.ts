// F3, F4: how the install command ends. Plania is started when it is not already running (as a service where
// `pnpm service:install` supports the system, otherwise the closing box says how to start it), the browser opens on
// the first-start page with the one-time code in the URL fragment, and a box shows the address and the code.
// The fragment's name, `code`, is the contract with the first-start page (ui/src/pages/): a fragment never reaches
// the server or its logs. Every outside call is injected.
import { defineWords, words } from "../../ui/src/lib/i18n.js";
import type { Language } from "../language.js";

export const FINISH_WORDS = defineWords({
  es: {
    starting: "Encendiendo Plania como servicio…",
    startFailed: (why: string) => `No se pudo dejar Plania como servicio (${why}).`,
    notUp: "Plania no respondió todavía.",
    done: "Plania está instalada.",
    open: (url: string) => `Abre: ${url}`,
    code: (code: string) => `Código de un solo uso: ${code}`,
    startHint: "Enciéndela con: pnpm start",
    serviceHint: "Para que arranque sola: pnpm service:install",
    // PLA-I2-4 (from zero): what the install went on without (Claude Code), said again after the box.
    stillMissing: "Plania ya funciona. Para que los agentes trabajen, falta esto:",
  },
  en: {
    starting: "Starting Plania as a service…",
    startFailed: (why: string) => `Plania could not be set up as a service (${why}).`,
    notUp: "Plania has not answered yet.",
    done: "Plania is installed.",
    open: (url: string) => `Open: ${url}`,
    code: (code: string) => `One-time code: ${code}`,
    startHint: "Start it with: pnpm start",
    serviceHint: "To have it start on its own: pnpm service:install",
    stillMissing: "Plania works now. For the agents to work, this is still missing:",
  },
});

/** The page the browser opens: first start with the code in the fragment, or the screen once an owner exists. */
export function firstStartUrl(port: number, code: string | null): string {
  return code ? `http://localhost:${port}/primer-arranque#code=${encodeURIComponent(code)}` : `http://localhost:${port}/`;
}

/** Lines inside a box drawn with line characters, as wide as the longest line. */
export function closingBox(lines: string[]): string {
  const width = Math.max(...lines.map((l) => [...l].length));
  const pad = (l: string) => l + " ".repeat(width - [...l].length);
  return [`┌${"─".repeat(width + 2)}┐`, ...lines.map((l) => `│ ${pad(l)} │`), `└${"─".repeat(width + 2)}┘`].join("\n");
}

export type FinishDeps = {
  port: number;
  setupCode: string | null;
  language: Language;
  /** --no-open */
  open: boolean;
  /** --no-start */
  start: boolean;
  /** Whether Plania answers on this port (GET /health). */
  isUp: () => Promise<boolean>;
  /** Whether `pnpm service:install` supports this system. */
  serviceSupported: boolean;
  /** Installs and starts the service; throws with the reason when it fails. */
  startService: () => Promise<void>;
  openBrowser: (url: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for a service that was just started, in tries of `sleep(500)`. */
  waitTries?: number;
  log: (line: string) => void;
};

export type FinishResult = { started: "already" | "service" | "not_started"; opened: boolean; url: string; box: string };

export async function finishInstall(d: FinishDeps): Promise<FinishResult> {
  const w = words(FINISH_WORDS, d.language);
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const url = firstStartUrl(d.port, d.setupCode);
  let started: FinishResult["started"] = "not_started";
  if (await d.isUp()) started = "already";
  else if (d.start && d.serviceSupported) {
    d.log(w.starting);
    try {
      await d.startService();
      for (let i = 0; i < (d.waitTries ?? 60); i++) {
        if (await d.isUp()) {
          started = "service";
          break;
        }
        await sleep(500);
      }
      if (started !== "service") d.log(w.notUp);
    } catch (e) {
      d.log(w.startFailed(e instanceof Error ? e.message.split("\n")[0]! : String(e)));
    }
  }
  const running = started !== "not_started";
  let opened = false;
  if (running && d.open) {
    try {
      d.openBrowser(url);
      opened = true;
    } catch {
      // The box has the address.
    }
  }
  const lines = [w.done, w.open(url), ...(d.setupCode ? [w.code(d.setupCode)] : [])];
  if (!running) lines.push(w.startHint, ...(d.serviceSupported ? [w.serviceHint] : []));
  return { started, opened, url, box: closingBox(lines) };
}

/** The command that opens a URL in the default browser, per system. On Windows rundll32 keeps the fragment. */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): { cmd: string; args: string[] } {
  if (platform === "darwin") return { cmd: "open", args: [url] };
  if (platform === "win32") return { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  return { cmd: "xdg-open", args: [url] };
}
