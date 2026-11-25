// PLA-I2-12: the machine check's words. One list, read by the install command (`pnpm machine:check`, the
// installer's hook) and by the screen page (/machine/falta) through GET /api/machine-check, so both say the same
// thing. Pure: no "@/" imports, because the server imports this file (src/machine-check/).
// PLA-I2-10: in both languages; the server passes the install's language (src/language.ts).
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

/** Every item the check reports, in the order it is shown. */
export const MACHINE_ITEMS = ["node", "postgres", "git", "gh", "claude", "claude_session", "pg_dump", "disk", "memory", "chrome"] as const;
export type MachineItemId = (typeof MACHINE_ITEMS)[number];

/** ready: there and working. missing: required and not ready (the install stops). optional: not there, not needed. */
export type MachineState = "ready" | "missing" | "optional";

export type MachineReason =
  | "ok"
  | "absent" // the program is not installed
  | "old" // installed, older than Plania needs
  | "no_url" // no DATABASE_URL
  | "unreachable" // Postgres did not answer: not running, or not installed (connection refused or timed out)
  | "bad_password" // B3: Postgres answered and refused the password (28P01, or a password it asked for and none given)
  | "auth_refused" // B3: the role does not exist, or pg_hba.conf lets it not in (28000)
  | "no_database" // B3: Postgres answered, the database in the address does not exist (3D000)
  | "signed_out" // gh or Claude without a session
  | "no_write" // gh signed in, but its token cannot write to repositories
  | "mismatch" // pg_dump older than the server
  | "low" // too little disk or memory
  | "not_checked" // Claude's session cannot be checked without Claude
  | "failed"; // the short Claude run ended with another error

export type MachineDetail = {
  version?: string | null;
  need?: string;
  server?: string | null;
  gb?: number;
  needGb?: number;
  subtype?: string;
  /** B3: the Postgres user in the address, when it names one. */
  user?: string;
};

export const MIN_NODE_MAJOR = 22;
export const MIN_POSTGRES_MAJOR = 14;
export const MIN_FREE_DISK_GB = 10;
export const MIN_MEMORY_GB = 8;

const v = (d: MachineDetail) => (d.version ? ` ${d.version}` : "");
const gbOf = (d: MachineDetail) => d.gb ?? "?";
const who = (d: MachineDetail) => (d.user ? ` ${d.user}` : "");

type Said = { sentence: string; fix: string | null };

// PLA-I2-10: the check's words in both languages. The install command and the server pass the install's language;
// the screen reads its own (lib/i18n.ts).
export const FALTA = defineWords({
  es: {
    names: {
      node: "Node",
      postgres: "Postgres",
      git: "git",
      gh: "GitHub (gh)",
      claude: "Claude Code",
      claude_session: "Sesión de Claude",
      pg_dump: "pg_dump, para los respaldos",
      disk: "Espacio en disco",
      memory: "Memoria",
      chrome: "Chrome, para las fotos de pantalla",
    } as Record<MachineItemId, string>,
    states: { ready: "Lista", missing: "Falta", optional: "Opcional" } as Record<MachineState, string>,
    ok: {
      node: (d: MachineDetail) => `Node${v(d)} está instalado.`,
      postgres: (d: MachineDetail) => `Postgres${v(d)} responde.`,
      git: (d: MachineDetail) => `git${v(d)} está instalado.`,
      gh: (d: MachineDetail) => `gh${v(d)} tiene la sesión iniciada y puede escribir en tus repositorios.`,
      claude: (d: MachineDetail) => `Claude Code${v(d)} está instalado.`,
      claude_session: () => "Claude tiene la sesión iniciada: una prueba corta respondió.",
      pg_dump: (d: MachineDetail) => `pg_dump${v(d)} sirve para la versión de tu Postgres.`,
      disk: (d: MachineDetail) => `Hay ${gbOf(d)} GB libres.`,
      memory: (d: MachineDetail) => `La máquina tiene ${gbOf(d)} GB de memoria.`,
      chrome: () => "Chrome está instalado.",
    } as Record<MachineItemId, (d: MachineDetail) => string>,
    nodeOld: (d: MachineDetail): Said => ({ sentence: `Node${v(d)} es muy viejo: Plania necesita Node ${MIN_NODE_MAJOR} o más nuevo.`, fix: "Instala Node 22 o más nuevo: https://nodejs.org/en/download" }),
    nodeAbsent: { sentence: "Node no está instalado.", fix: "Instala Node 22 o más nuevo: https://nodejs.org/en/download" } as Said,
    pgNoUrl: { sentence: "Plania no sabe dónde está tu Postgres.", fix: "Escribe DATABASE_URL en el archivo .env, por ejemplo postgres://localhost:5432/plania" } as Said,
    pgOld: (d: MachineDetail): Said => ({ sentence: `Postgres${v(d)} es muy viejo: Plania necesita Postgres ${MIN_POSTGRES_MAJOR} o más nuevo.`, fix: "Instala una versión más nueva: https://www.postgresql.org/download/" }),
    pgDown: {
      sentence: "Postgres no responde: no está encendido, o no está instalado.",
      fix: "Enciéndelo (en Mac con Homebrew: brew services start postgresql@16; en Windows, el servicio postgresql o Laragon), o instálalo: https://www.postgresql.org/download/",
    } as Said,
    // B3: Postgres answered and said no; each reason has its own fix.
    pgBadPassword: (d: MachineDetail): Said => ({
      sentence: `Postgres responde, pero no aceptó la contraseña del usuario${who(d)}.`,
      fix: "Corre otra vez pnpm plania:install y escribe el usuario y la contraseña de Postgres cuando los pida, o corrige DATABASE_URL en .env (postgres://usuario:contraseña@localhost:5432/plania).",
    }),
    pgAuthRefused: (d: MachineDetail): Said => ({
      sentence: `Postgres responde, pero el usuario${who(d)} no existe o no tiene permiso para entrar.`,
      fix: "Corre otra vez pnpm plania:install y escribe un usuario de Postgres que exista (por ejemplo postgres) con su contraseña, o corrige DATABASE_URL en .env.",
    }),
    pgNoDatabase: {
      sentence: "Postgres responde, pero la base de la dirección no existe.",
      fix: "Corre pnpm plania:install: crea la base. O corrige el nombre de la base en DATABASE_URL, en .env.",
    } as Said,
    gitAbsent: { sentence: "git no está instalado.", fix: "Instala git: https://git-scm.com/downloads" } as Said,
    // F2: gh is not needed to install, only before the first project with code.
    ghSignedOut: { sentence: "gh está instalado pero no tiene la sesión iniciada; hace falta antes del primer proyecto con código.", fix: "En una terminal corre: gh auth login" } as Said,
    ghNoWrite: { sentence: "gh tiene la sesión iniciada, pero sin permiso para escribir en tus repositorios; hace falta antes del primer proyecto con código.", fix: "En una terminal corre: gh auth refresh -s repo" } as Said,
    ghAbsent: { sentence: "gh, la herramienta de GitHub, no está instalada; hace falta antes del primer proyecto con código.", fix: "Instálala: https://cli.github.com" } as Said,
    claudeAbsent: { sentence: "Claude Code no está instalado.", fix: "Instálalo: https://docs.claude.com/en/docs/claude-code/setup (o escribe su ruta en CLAUDE_CODE_BIN)" } as Said,
    sessionNotChecked: { sentence: "No se pudo revisar la sesión de Claude porque Claude Code no está instalado.", fix: "Instala Claude Code primero." } as Said,
    sessionFailed: (d: MachineDetail): Said => ({ sentence: `La prueba corta de Claude terminó con un error${d.subtype ? ` (${d.subtype})` : ""}.`, fix: "En una terminal corre claude y revisa que responda." }),
    sessionSignedOut: { sentence: "Claude no tiene la sesión iniciada en esta máquina.", fix: "En una terminal corre claude y entra con tu cuenta (/login)." } as Said,
    dumpMismatch: (d: MachineDetail): Said => ({
      sentence: `pg_dump${v(d)} es más viejo que tu Postgres${d.server ? ` ${d.server}` : ""}: los respaldos fallarían.`,
      fix: "Instala las herramientas de Postgres de la misma versión que el servidor, o escribe su carpeta en PLANIA_PG_BIN.",
    }),
    dumpAbsent: { sentence: "pg_dump no está instalado: sin él no hay respaldos.", fix: "Instala las herramientas de Postgres de la misma versión que el servidor, o escribe su carpeta en PLANIA_PG_BIN." } as Said,
    diskLow: (d: MachineDetail): Said => ({ sentence: `Quedan ${gbOf(d)} GB libres; Plania necesita al menos ${MIN_FREE_DISK_GB} GB para copias de trabajo y respaldos.`, fix: "Libera espacio en el disco." }),
    memoryLow: (d: MachineDetail): Said => ({ sentence: `La máquina tiene ${gbOf(d)} GB de memoria; Plania necesita al menos ${MIN_MEMORY_GB} GB.`, fix: "Usa una máquina con más memoria." }),
    chromeAbsent: { sentence: "Chrome no está instalado: no habrá fotos de pantalla, todo lo demás funciona.", fix: "Instálalo: https://www.google.com/chrome/ (o escribe su ruta en PLANIA_CHROME_PATH)" } as Said,
    headline: (missing: number) =>
      missing === 0 ? "El entorno está listo para continuar." : missing === 1 ? "A esta máquina le falta una cosa." : `A esta máquina le faltan ${missing} cosas.`,
    /** The install command's mark after an optional item. */
    optionalMark: " (opcional)",
    // The page (/machine/falta).
    kicker: "Esta máquina",
    title: "Qué le falta",
    lead: "Lo que Plania necesita para trabajar aquí, y cómo arreglar lo que falta.",
    failed: "No se pudo revisar la máquina.",
    again: "Revisar otra vez",
    optional: "opcional",
    checkedAt: (time: string) => `Revisada: ${time}`,
  },
  en: {
    names: {
      node: "Node",
      postgres: "Postgres",
      git: "git",
      gh: "GitHub (gh)",
      claude: "Claude Code",
      claude_session: "Claude session",
      pg_dump: "pg_dump, for backups",
      disk: "Disk space",
      memory: "Memory",
      chrome: "Chrome, for screenshots",
    },
    states: { ready: "Ready", missing: "Missing", optional: "Optional" },
    ok: {
      node: (d: MachineDetail) => `Node${v(d)} is installed.`,
      postgres: (d: MachineDetail) => `Postgres${v(d)} is answering.`,
      git: (d: MachineDetail) => `git${v(d)} is installed.`,
      gh: (d: MachineDetail) => `gh${v(d)} is signed in and can write to your repositories.`,
      claude: (d: MachineDetail) => `Claude Code${v(d)} is installed.`,
      claude_session: () => "Claude is signed in: a short test answered.",
      pg_dump: (d: MachineDetail) => `pg_dump${v(d)} works with your Postgres version.`,
      disk: (d: MachineDetail) => `${gbOf(d)} GB free.`,
      memory: (d: MachineDetail) => `The machine has ${gbOf(d)} GB of memory.`,
      chrome: () => "Chrome is installed.",
    },
    nodeOld: (d: MachineDetail): Said => ({ sentence: `Node${v(d)} is too old: Plania needs Node ${MIN_NODE_MAJOR} or newer.`, fix: "Install Node 22 or newer: https://nodejs.org/en/download" }),
    nodeAbsent: { sentence: "Node is not installed.", fix: "Install Node 22 or newer: https://nodejs.org/en/download" },
    pgNoUrl: { sentence: "Plania does not know where your Postgres is.", fix: "Write DATABASE_URL in the .env file, for example postgres://localhost:5432/plania" },
    pgOld: (d: MachineDetail): Said => ({ sentence: `Postgres${v(d)} is too old: Plania needs Postgres ${MIN_POSTGRES_MAJOR} or newer.`, fix: "Install a newer version: https://www.postgresql.org/download/" }),
    pgDown: {
      sentence: "Postgres is not answering: it is not running, or not installed.",
      fix: "Start it (on a Mac with Homebrew: brew services start postgresql@16; on Windows, the postgresql service or Laragon), or install it: https://www.postgresql.org/download/",
    },
    pgBadPassword: (d: MachineDetail): Said => ({
      sentence: `Postgres is answering, but did not accept the password of the user${who(d)}.`,
      fix: "Run pnpm plania:install again and type the Postgres user and password when it asks, or fix DATABASE_URL in .env (postgres://user:password@localhost:5432/plania).",
    }),
    pgAuthRefused: (d: MachineDetail): Said => ({
      sentence: `Postgres is answering, but the user${who(d)} does not exist or is not allowed in.`,
      fix: "Run pnpm plania:install again and type a Postgres user that exists (for example postgres) with its password, or fix DATABASE_URL in .env.",
    }),
    pgNoDatabase: {
      sentence: "Postgres is answering, but the database in the address does not exist.",
      fix: "Run pnpm plania:install: it creates the database. Or fix the database name in DATABASE_URL, in .env.",
    },
    gitAbsent: { sentence: "git is not installed.", fix: "Install git: https://git-scm.com/downloads" },
    ghSignedOut: { sentence: "gh is installed but not signed in; it is needed before the first project with code.", fix: "In a terminal run: gh auth login" },
    ghNoWrite: { sentence: "gh is signed in, but cannot write to your repositories; it is needed before the first project with code.", fix: "In a terminal run: gh auth refresh -s repo" },
    ghAbsent: { sentence: "gh, the GitHub tool, is not installed; it is needed before the first project with code.", fix: "Install it: https://cli.github.com" },
    claudeAbsent: { sentence: "Claude Code is not installed.", fix: "Install it: https://docs.claude.com/en/docs/claude-code/setup (or write its path in CLAUDE_CODE_BIN)" },
    sessionNotChecked: { sentence: "Claude's session could not be checked because Claude Code is not installed.", fix: "Install Claude Code first." },
    sessionFailed: (d: MachineDetail): Said => ({ sentence: `Claude's short test ended with an error${d.subtype ? ` (${d.subtype})` : ""}.`, fix: "In a terminal run claude and check that it answers." }),
    sessionSignedOut: { sentence: "Claude is not signed in on this machine.", fix: "In a terminal run claude and sign in with your account (/login)." },
    dumpMismatch: (d: MachineDetail): Said => ({
      sentence: `pg_dump${v(d)} is older than your Postgres${d.server ? ` ${d.server}` : ""}: backups would fail.`,
      fix: "Install the Postgres tools of the same version as the server, or write their folder in PLANIA_PG_BIN.",
    }),
    dumpAbsent: { sentence: "pg_dump is not installed: without it there are no backups.", fix: "Install the Postgres tools of the same version as the server, or write their folder in PLANIA_PG_BIN." },
    diskLow: (d: MachineDetail): Said => ({ sentence: `${gbOf(d)} GB free; Plania needs at least ${MIN_FREE_DISK_GB} GB for working copies and backups.`, fix: "Free up disk space." }),
    memoryLow: (d: MachineDetail): Said => ({ sentence: `The machine has ${gbOf(d)} GB of memory; Plania needs at least ${MIN_MEMORY_GB} GB.`, fix: "Use a machine with more memory." }),
    chromeAbsent: { sentence: "Chrome is not installed: there will be no screenshots, everything else works.", fix: "Install it: https://www.google.com/chrome/ (or write its path in PLANIA_CHROME_PATH)" },
    headline: (missing: number) =>
      missing === 0 ? "The environment is ready to go on." : missing === 1 ? "This machine is missing one thing." : `This machine is missing ${missing} things.`,
    optionalMark: " (optional)",
    kicker: "This machine",
    title: "What it is missing",
    lead: "What Plania needs to work here, and how to fix what is missing.",
    failed: "The machine could not be checked.",
    again: "Check again",
    optional: "optional",
    checkedAt: (time: string) => `Checked: ${time}`,
  },
});

/** The item names in Spanish (kept for older readers; words(FALTA).names is the screen's language). */
export const ITEM_NAME: Record<MachineItemId, string> = FALTA.es.names;

/** Chrome, and gh (F2: needed only before the first project with code), can be missing without stopping the install. */
export const REQUIRED: Record<MachineItemId, boolean> = {
  node: true,
  postgres: true,
  git: true,
  gh: false,
  claude: true,
  claude_session: true,
  pg_dump: true,
  disk: true,
  memory: true,
  chrome: false,
};

/** The state words in Spanish (kept for older readers; words(FALTA).states is the screen's language). */
export const STATE_WORD: Record<MachineState, string> = FALTA.es.states;

/** One plain sentence and the fix (a link or the exact step; null when there is nothing to do). */
export function machineWords(id: MachineItemId, reason: MachineReason, d: MachineDetail = {}, language: Language = getLanguage()): Said {
  const w = words(FALTA, language);
  if (reason === "ok") return { sentence: w.ok[id](d), fix: null };
  switch (id) {
    case "node":
      return reason === "old" ? w.nodeOld(d) : w.nodeAbsent;
    case "postgres":
      if (reason === "no_url") return w.pgNoUrl;
      if (reason === "old") return w.pgOld(d);
      if (reason === "bad_password") return w.pgBadPassword(d);
      if (reason === "auth_refused") return w.pgAuthRefused(d);
      if (reason === "no_database") return w.pgNoDatabase;
      return w.pgDown;
    case "git":
      return w.gitAbsent;
    case "gh":
      if (reason === "signed_out") return w.ghSignedOut;
      if (reason === "no_write") return w.ghNoWrite;
      return w.ghAbsent;
    case "claude":
      return w.claudeAbsent;
    case "claude_session":
      if (reason === "not_checked") return w.sessionNotChecked;
      if (reason === "failed") return w.sessionFailed(d);
      return w.sessionSignedOut;
    case "pg_dump":
      return reason === "mismatch" ? w.dumpMismatch(d) : w.dumpAbsent;
    case "disk":
      return w.diskLow(d);
    case "memory":
      return w.memoryLow(d);
    case "chrome":
      return w.chromeAbsent;
  }
}

export type MachineItem = {
  id: MachineItemId;
  state: MachineState;
  required: boolean;
  reason: MachineReason;
  name: string;
  sentence: string;
  fix: string | null;
};

/** GET /api/machine-check. ready: nothing required is missing. */
export type MachineCheckReading = { items: MachineItem[]; ready: boolean; checked_at: string };

/** The item as both outputs show it: state from ready-or-not and REQUIRED, words from machineWords. */
export function machineItem(id: MachineItemId, reason: MachineReason, d: MachineDetail = {}, language: Language = getLanguage()): MachineItem {
  const required = REQUIRED[id];
  const state: MachineState = reason === "ok" ? "ready" : required ? "missing" : "optional";
  return { id, state, required, reason, name: words(FALTA, language).names[id], ...machineWords(id, reason, d, language) };
}

/** The page's headline: how many required items are missing. */
export function machineHeadline(items: Pick<MachineItem, "state">[], language: Language = getLanguage()): string {
  return words(FALTA, language).headline(items.filter((i) => i.state === "missing").length);
}

/** Splits a fix into text and one link, so the page can make the link clickable. */
export function fixParts(fix: string): { before: string; url: string | null; after: string } {
  const m = /https?:\/\/[^\s)]+/.exec(fix);
  if (!m) return { before: fix, url: null, after: "" };
  return { before: fix.slice(0, m.index), url: m[0], after: fix.slice(m.index + m[0].length) };
}
