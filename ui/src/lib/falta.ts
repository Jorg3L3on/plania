// PLA-I2-12: the machine check's words. One list, read by the install command (`pnpm machine:check`, the
// installer's hook) and by the screen page (/machine/falta) through GET /api/machine-check, so both say the same
// thing. Pure: no "@/" imports, because the server imports this file (src/machine-check/).

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
  | "unreachable" // Postgres did not answer
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
};

export const MIN_NODE_MAJOR = 22;
export const MIN_POSTGRES_MAJOR = 14;
export const MIN_FREE_DISK_GB = 10;
export const MIN_MEMORY_GB = 8;

export const ITEM_NAME: Record<MachineItemId, string> = {
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
};

/** Only Chrome can be missing without stopping the install. */
export const REQUIRED: Record<MachineItemId, boolean> = {
  node: true,
  postgres: true,
  git: true,
  gh: true,
  claude: true,
  claude_session: true,
  pg_dump: true,
  disk: true,
  memory: true,
  chrome: false,
};

export const STATE_WORD: Record<MachineState, string> = { ready: "Lista", missing: "Falta", optional: "Opcional" };

const v = (d: MachineDetail) => (d.version ? ` ${d.version}` : "");

/** One plain sentence and the fix (a link or the exact step; null when there is nothing to do). */
export function machineWords(id: MachineItemId, reason: MachineReason, d: MachineDetail = {}): { sentence: string; fix: string | null } {
  if (reason === "ok") {
    const okSentence: Record<MachineItemId, string> = {
      node: `Node${v(d)} está instalado.`,
      postgres: `Postgres${v(d)} responde.`,
      git: `git${v(d)} está instalado.`,
      gh: `gh${v(d)} tiene la sesión iniciada y puede escribir en tus repositorios.`,
      claude: `Claude Code${v(d)} está instalado.`,
      claude_session: "Claude tiene la sesión iniciada: una prueba corta respondió.",
      pg_dump: `pg_dump${v(d)} sirve para la versión de tu Postgres.`,
      disk: `Hay ${d.gb ?? "?"} GB libres.`,
      memory: `La máquina tiene ${d.gb ?? "?"} GB de memoria.`,
      chrome: "Chrome está instalado.",
    };
    return { sentence: okSentence[id], fix: null };
  }
  switch (id) {
    case "node":
      return reason === "old"
        ? { sentence: `Node${v(d)} es muy viejo: Plania necesita Node ${MIN_NODE_MAJOR} o más nuevo.`, fix: "Instala Node 22 o más nuevo: https://nodejs.org/en/download" }
        : { sentence: "Node no está instalado.", fix: "Instala Node 22 o más nuevo: https://nodejs.org/en/download" };
    case "postgres":
      if (reason === "no_url") return { sentence: "Plania no sabe dónde está tu Postgres.", fix: "Escribe DATABASE_URL en el archivo .env, por ejemplo postgres://localhost:5432/plania" };
      if (reason === "old") return { sentence: `Postgres${v(d)} es muy viejo: Plania necesita Postgres ${MIN_POSTGRES_MAJOR} o más nuevo.`, fix: "Instala una versión más nueva: https://www.postgresql.org/download/" };
      return {
        sentence: "Postgres no responde: no está instalado o no está encendido.",
        fix: "Instálalo y enciéndelo: https://www.postgresql.org/download/ (en Mac con Homebrew: brew install postgresql@16 && brew services start postgresql@16)",
      };
    case "git":
      return { sentence: "git no está instalado.", fix: "Instala git: https://git-scm.com/downloads" };
    case "gh":
      if (reason === "signed_out") return { sentence: "gh está instalado pero no tiene la sesión iniciada.", fix: "En una terminal corre: gh auth login" };
      if (reason === "no_write") return { sentence: "gh tiene la sesión iniciada, pero sin permiso para escribir en tus repositorios.", fix: "En una terminal corre: gh auth refresh -s repo" };
      return { sentence: "gh, la herramienta de GitHub, no está instalada.", fix: "Instálala: https://cli.github.com" };
    case "claude":
      return { sentence: "Claude Code no está instalado.", fix: "Instálalo: https://docs.claude.com/en/docs/claude-code/setup (o escribe su ruta en CLAUDE_CODE_BIN)" };
    case "claude_session":
      if (reason === "not_checked") return { sentence: "No se pudo revisar la sesión de Claude porque Claude Code no está instalado.", fix: "Instala Claude Code primero." };
      if (reason === "failed") return { sentence: `La prueba corta de Claude terminó con un error${d.subtype ? ` (${d.subtype})` : ""}.`, fix: "En una terminal corre claude y revisa que responda." };
      return { sentence: "Claude no tiene la sesión iniciada en esta máquina.", fix: "En una terminal corre claude y entra con tu cuenta (/login)." };
    case "pg_dump":
      if (reason === "mismatch") {
        return {
          sentence: `pg_dump${v(d)} es más viejo que tu Postgres${d.server ? ` ${d.server}` : ""}: los respaldos fallarían.`,
          fix: "Instala las herramientas de Postgres de la misma versión que el servidor, o escribe su carpeta en PLANIA_PG_BIN.",
        };
      }
      return { sentence: "pg_dump no está instalado: sin él no hay respaldos.", fix: "Instala las herramientas de Postgres de la misma versión que el servidor, o escribe su carpeta en PLANIA_PG_BIN." };
    case "disk":
      return { sentence: `Quedan ${d.gb ?? "?"} GB libres; Plania necesita al menos ${MIN_FREE_DISK_GB} GB para copias de trabajo y respaldos.`, fix: "Libera espacio en el disco." };
    case "memory":
      return { sentence: `La máquina tiene ${d.gb ?? "?"} GB de memoria; Plania necesita al menos ${MIN_MEMORY_GB} GB.`, fix: "Usa una máquina con más memoria." };
    case "chrome":
      return { sentence: "Chrome no está instalado: no habrá fotos de pantalla, todo lo demás funciona.", fix: "Instálalo: https://www.google.com/chrome/ (o escribe su ruta en PLANIA_CHROME_PATH)" };
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
export function machineItem(id: MachineItemId, reason: MachineReason, d: MachineDetail = {}): MachineItem {
  const required = REQUIRED[id];
  const state: MachineState = reason === "ok" ? "ready" : required ? "missing" : "optional";
  return { id, state, required, reason, name: ITEM_NAME[id], ...machineWords(id, reason, d) };
}

/** The page's headline: how many required items are missing. */
export function machineHeadline(items: Pick<MachineItem, "state">[]): string {
  const missing = items.filter((i) => i.state === "missing").length;
  if (missing === 0) return "Esta máquina tiene todo lo que Plania necesita.";
  return missing === 1 ? "A esta máquina le falta una cosa." : `A esta máquina le faltan ${missing} cosas.`;
}

/** Splits a fix into text and one link, so the page can make the link clickable. */
export function fixParts(fix: string): { before: string; url: string | null; after: string } {
  const m = /https?:\/\/[^\s)]+/.exec(fix);
  if (!m) return { before: fix, url: null, after: "" };
  return { before: fix.slice(0, m.index), url: m[0], after: fix.slice(m.index + m[0].length) };
}
