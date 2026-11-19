// PLA-I2-18: the help report's redactor. The report is built from allow-listed fields; this is the second wall, applied
// to every free-text line that still reaches it (a run's failure line, a server log line, a machine check sentence).
// It hides three things:
//   1. any value the machine holds as a secret, matched literally: every environment value (the process and .env)
//      that is long enough to be one, and any extra value the caller knows about;
//   2. what the diff scanner recognises (src/lib/scan/patterns.ts): tokens, private keys, URLs with credentials, cards,
//      CLABE, CURP, emails, wallets;
//   3. shapes a secret takes in a log: NAME=value where the name sounds secret, a Bearer header, a password hash, a long
//      run of hex or base64.
import { scanLine } from "../lib/scan/patterns.js";

export const HIDDEN = "[oculto]";

/** Values shorter than this are not taken as secrets: "1", "true", "3737", "es" would hide half the report. */
export const MIN_SECRET_LENGTH = 6;
/** A line longer than this is cut: a log line can carry a whole prompt. */
export const MAX_LINE = 300;

const SECRET_NAME = /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|PASS|KEY|HASH|BEARER|CREDENTIAL|AUTH|COOKIE|SESSION)[A-Z0-9_]*)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi;
const BEARER = /\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const ARGON = /\$argon2[a-z]*\$[^\s"']+/gi;
const BCRYPT = /\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{40,}/g;
const LONG_HEX = /\b[0-9a-f]{32,}\b/gi;
const LONG_B64 = /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9+/_-])/g;

export type Redactor = (text: string) => string;

/** The literal secrets: every value of these environments at least MIN_SECRET_LENGTH long, longest first. */
export function secretValues(...sources: (Record<string, string | undefined> | string[] | undefined)[]): string[] {
  const out = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    const values = Array.isArray(source) ? source : Object.values(source);
    for (const v of values) {
      const t = v?.trim();
      if (t && t.length >= MIN_SECRET_LENGTH) out.add(t);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * A redactor that hides the given literal values and every shape above. Values that are ordinary words a report needs
 * (a path to a program, "postgres") can be passed in keep: they are not hidden on their own.
 */
export function makeRedactor(secrets: string[], keep: string[] = []): Redactor {
  const kept = new Set(keep);
  const literal = secrets.filter((s) => !kept.has(s));
  return (text: string) => {
    let line = String(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ");
    // Shapes first, literals after: a short value such as "postgres" replaced first would break the shape of a
    // postgres://user:password@host URL and leave its password behind.
    for (const f of scanLine(line)) if (f.value) line = line.split(f.value).join(HIDDEN);
    line = line
      // Bearer first: "Authorization: Bearer <token>" would otherwise hide only the word Bearer.
      .replace(BEARER, (_m, word: string) => `${word} ${HIDDEN}`)
      .replace(SECRET_NAME, (_m, name: string) => `${name}=${HIDDEN}`)
      .replace(ARGON, HIDDEN)
      .replace(BCRYPT, HIDDEN)
      .replace(LONG_HEX, HIDDEN)
      // A long run with digits and both cases is a key; a long plain path or word is not.
      .replace(LONG_B64, (m) => (/\d/.test(m) && /[a-z]/.test(m) && /[A-Z]/.test(m) ? HIDDEN : m));
    for (const s of literal) if (line.includes(s)) line = line.split(s).join(HIDDEN);
    return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line;
  };
}
