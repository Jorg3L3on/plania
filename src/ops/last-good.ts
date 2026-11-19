// PLA-I2-9: the live server changes only when the owner restarts it, and a restart on a newer commit that does not
// come up goes back to the last commit that did. The server records itself as good once it has been up for a while
// (scripts/dev.ts); `pnpm server:restart` (scripts/restart.ts) restarts, waits for /health/ui to report the expected
// commit, and otherwise checks out the last good commit, restarts again and says so. Every outside call is a dep.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { defineWords, say } from "../words.js";

// PLA-I2-10: what a restart prints for the owner in the install's language; the Spanish is unchanged.
export const RESTART_WORDS = defineWords({
  es: {
    version: (v: string) => `la versión ${v}`,
    commit: (c: string) => `el commit ${c}`,
    up: (what: string) => `Plania reiniciado en ${what}.`,
    down: (what: string) => `Plania no arrancó en ${what}.`,
    noRecord: "No hay registro de un arranque anterior que funcionara, así que no puedo volver atrás solo. Revisa el registro del servicio.",
    reinstall: (v: string) => `La última versión que arrancó fue la ${v}. Vuelve a instalar esa versión.`,
    sameCommit: "Es el mismo commit que arrancó la última vez, así que el problema no está en el código: revisa la base de datos y el registro del servicio.",
    checkoutFailed: (c: string, error: string) => `No pude volver al commit ${c}, el último que arrancó: ${error}`,
    fellBack: (c: string) => `Volví al commit ${c}, el último que arrancó, y Plania ya está arriba.`,
    detached: "Tu copia del código quedó en ese commit, sin rama: cuando arregles el problema, vuelve a tu rama y reinicia otra vez.",
    stillDown: (c: string) => `Volví al commit ${c}, el último que arrancó, y tampoco arrancó. Revisa la base de datos y el registro del servicio.`,
  },
  en: {
    version: (v: string) => `version ${v}`,
    commit: (c: string) => `commit ${c}`,
    up: (what: string) => `Plania restarted on ${what}.`,
    down: (what: string) => `Plania did not start on ${what}.`,
    noRecord: "There is no record of an earlier start that worked, so I cannot go back on my own. Check the service log.",
    reinstall: (v: string) => `The last version that started was ${v}. Install that version again.`,
    sameCommit: "It is the same commit that started last time, so the problem is not in the code: check the database and the service log.",
    checkoutFailed: (c: string, error: string) => `I could not go back to commit ${c}, the last one that started: ${error}`,
    fellBack: (c: string) => `I went back to commit ${c}, the last one that started, and Plania is up again.`,
    detached: "Your copy of the code is left on that commit, with no branch: once you fix the problem, go back to your branch and restart again.",
    stillDown: (c: string) => `I went back to commit ${c}, the last one that started, and it did not start either. Check the database and the service log.`,
  },
});

export type GoodStart = { commit: string | null; version: string; packaged: boolean; root: string; at: string };

export const lastGoodFile = (env: NodeJS.ProcessEnv = process.env): string =>
  env.PLANIA_LAST_GOOD_FILE?.trim() || path.join(env.HOME || homedir(), ".config", "plania", "last-good.json");

export function readLastGood(file: string): GoodStart | null {
  try {
    if (!existsSync(file)) return null;
    const v = JSON.parse(readFileSync(file, "utf8")) as Partial<GoodStart>;
    return typeof v.version === "string" && typeof v.root === "string" ? { commit: v.commit ?? null, version: v.version, packaged: !!v.packaged, root: v.root, at: String(v.at ?? "") } : null;
  } catch {
    return null;
  }
}

export function writeLastGood(file: string, rec: GoodStart): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
}

/** Only the live service records a good start: its own port, jobs on. Dev servers and test copies (PLANIA_JOBS=0) never do. */
export const recordsGoodStart = (port: number, env: NodeJS.ProcessEnv = process.env): boolean =>
  port === (Number(env.PLANIA_PORT) || 3737) && env.PLANIA_JOBS !== "0" && env.PLANIA_LAST_GOOD !== "0";

/** How long the server must stay up before it counts as a good start. */
export const GOOD_AFTER_MS = 30_000;

export type Health = { commit: string | null; version: string | null };

export type RestartDeps = {
  restart: () => void; // the service manager's restart (launchctl kickstart / systemctl --user restart)
  health: () => Promise<Health | null>; // GET /health/ui, null while it does not answer
  head: () => string | null; // the checkout's commit now; null in a release package
  version: () => string; // the version the folder holds now
  packaged: boolean;
  lastGood: () => GoodStart | null;
  checkout: (commit: string) => { ok: true } | { ok: false; error: string }; // git checkout --detach <commit>
  sleep: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollMs?: number;
};

export type RestartOutcome = { status: "up" | "fell_back" | "down"; lines: string[] };

const short = (c: string | null | undefined) => (c ? c.slice(0, 7) : "?");

async function waitUp(d: RestartDeps, want: { commit: string | null; version: string }): Promise<boolean> {
  const timeout = d.timeoutMs ?? 120_000;
  const poll = d.pollMs ?? 2_000;
  for (let waited = 0; waited <= timeout; waited += poll) {
    const h = await d.health().catch(() => null);
    if (h && (want.commit ? h.commit === want.commit : h.version === want.version)) return true;
    await d.sleep(poll);
  }
  return false;
}

/** Restarts and checks the server came up on what the folder holds; otherwise goes back to the last good commit. */
export async function restartWithFallback(d: RestartDeps): Promise<RestartOutcome> {
  const want = { commit: d.packaged ? null : d.head(), version: d.version() };
  const w = say(RESTART_WORDS);
  const what = d.packaged ? w.version(want.version) : w.commit(short(want.commit));
  d.restart();
  if (await waitUp(d, want)) return { status: "up", lines: [w.up(what)] };

  const good = d.lastGood();
  const down = w.down(what);
  if (!good) return { status: "down", lines: [down, w.noRecord] };
  if (d.packaged || !good.commit) {
    return { status: "down", lines: [down, w.reinstall(good.version)] };
  }
  if (good.commit === want.commit) {
    return { status: "down", lines: [down, w.sameCommit] };
  }
  const back = d.checkout(good.commit);
  if (!back.ok) return { status: "down", lines: [down, w.checkoutFailed(short(good.commit), back.error)] };
  d.restart();
  if (await waitUp(d, { commit: good.commit, version: good.version })) {
    return {
      status: "fell_back",
      lines: [
        down,
        w.fellBack(short(good.commit)),
        w.detached,
      ],
    };
  }
  return { status: "down", lines: [down, w.stillDown(short(good.commit))] };
}
