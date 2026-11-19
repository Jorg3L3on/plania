// B3: the install command's Postgres address. The default address names no user, so Postgres takes the system's
// user name, which on most machines is not a Postgres role or has no password. When the address fails on
// credentials, the install tries the usual `postgres` user without a password, then asks in the terminal for the
// user and the password (hidden), tests them, and goes on with the address that works (written to .env as before).
// Connection refused, a missing database or anything else is left to the machine check, which says what to fix.
import readline from "node:readline";
import { Writable } from "node:stream";
import { withDatabase } from "../db/migrate.js";
import { readPg, userOf, withCredentials, type PgFailure, type PgReading } from "../lib/pg-connect.js";
import type { Language } from "../language.js";
import { defineWords, words } from "../../ui/src/lib/i18n.js";
import { machineWords } from "../../ui/src/lib/falta.js";

/** Questions in the terminal; null when there is no terminal to ask in (a pipe, a service). */
export type Ask = { line(question: string): Promise<string>; secret(question: string): Promise<string> };

export const CONNECT_WORDS = defineWords({
  es: {
    asUsual: (user: string) => `Postgres aceptó al usuario ${user}.`,
    askUser: (fallback: string) => `Usuario de Postgres (${fallback}): `,
    askPassword: "Contraseña (no se muestra): ",
    worked: (user: string) => `Postgres aceptó al usuario ${user}; la dirección queda en .env.`,
    tryAgain: "No funcionó. Prueba otra vez.",
  },
  en: {
    asUsual: (user: string) => `Postgres accepted the user ${user}.`,
    askUser: (fallback: string) => `Postgres user (${fallback}): `,
    askPassword: "Password (not shown): ",
    worked: (user: string) => `Postgres accepted the user ${user}; the address goes into .env.`,
    tryAgain: "That did not work. Try again.",
  },
});

const CREDENTIALS: PgFailure[] = ["bad_password", "auth_refused"];
const onCredentials = (r: PgReading) => !r.ok && CREDENTIALS.includes(r.reason ?? "unreachable");
const USUAL_USER = "postgres";

export type ConnectDeps = {
  probe?: (url: string) => Promise<PgReading>;
  ask: Ask | null;
  log: (line: string) => void;
  language: Language;
  tries?: number;
};

/**
 * The address to install with: `url` when its server answers, else one with a user and password that work. The
 * server is reached through its `postgres` database, since the install's own may not exist yet. `reading` is the
 * last answer; when it is not ok, the machine check reports why.
 */
export async function workingAddress(url: string, deps: ConnectDeps): Promise<{ url: string; reading: PgReading }> {
  const probe = deps.probe ?? readPg;
  const w = words(CONNECT_WORDS, deps.language);
  const test = (candidate: string) => probe(withDatabase(candidate, "postgres"));
  let reading = await test(url);
  if (!onCredentials(reading)) return { url, reading };

  // Most local installs (Laragon, Postgres.app, Homebrew, a trust rule in pg_hba.conf) let `postgres` in as it is.
  if (!userOf(url)) {
    const usual = withCredentials(url, USUAL_USER, "");
    const r = await test(usual);
    if (r.ok) {
      deps.log(w.asUsual(USUAL_USER));
      return { url: usual, reading: r };
    }
  }
  if (!deps.ask) return { url, reading };

  let fallback = userOf(url) ?? USUAL_USER;
  for (let i = 0; i < (deps.tries ?? 3); i++) {
    if (reading.ok) break;
    deps.log(i === 0 ? machineWords("postgres", reading.reason ?? "unreachable", { user: userOf(url) }, deps.language).sentence : w.tryAgain);
    const user = (await deps.ask.line(w.askUser(fallback))).trim() || fallback;
    const password = await deps.ask.secret(w.askPassword);
    const candidate = withCredentials(url, user, password);
    reading = await test(candidate);
    if (reading.ok) {
      deps.log(w.worked(user));
      return { url: candidate, reading };
    }
    // A server that stopped answering, or a missing database, is not fixed by another password.
    if (!onCredentials(reading)) return { url: candidate, reading };
    fallback = user;
  }
  return { url, reading };
}

/** Questions in this terminal, the password without echo. Null when stdin is not a terminal. */
export function terminalAsk(input: NodeJS.ReadStream = process.stdin, output: NodeJS.WriteStream = process.stdout): Ask | null {
  if (!input.isTTY) return null;
  const ask = (question: string, hidden: boolean) =>
    new Promise<string>((resolve) => {
      let muted = false;
      const out = new Writable({
        write(chunk, encoding, done) {
          if (!muted) output.write(chunk, encoding);
          done();
        },
      });
      const rl = readline.createInterface({ input, output: out, terminal: true });
      rl.on("SIGINT", () => {
        output.write("\n");
        process.exit(130);
      });
      rl.question(question, (answer) => {
        rl.close();
        if (hidden) output.write("\n");
        resolve(answer);
      });
      // The question is written; what is typed after it is not echoed.
      muted = hidden;
    });
  return { line: (q) => ask(q, false), secret: (q) => ask(q, true) };
}
