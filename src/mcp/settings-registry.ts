// PLA-I2-6: the one list of project settings (projects.settings). set_project accepts exactly these keys
// (SETTING_KEYS), the Ajustes view shows each one where its control is, and the README lists the advanced ones with
// the reason they can be left alone (`pnpm exec tsx scripts/settings-table.ts` writes that table; test/settings-registry.test.ts checks
// it). Typed against ProjectSettings: a key added to the type without an entry here does not compile.
//   tier      basic: a new owner may need it to finish setup. advanced: a default that can be left alone; its control
//             is in Ajustes' closed «Avanzado» section, and `reason` says why it can wait.
//   control   where the screen sets it. Every key has one; internal ones name the screen action that writes them.
//   default   what holds while the key is unset (English, for the README).
//   frase     the plain Spanish sentence the screen shows beside the control; defecto, the default said the same way.
import type { ProjectSettings } from "../db/schema.js";

export type SettingTier = "basic" | "advanced";
export type SettingControl =
  | "ajustes.codigo"
  | "ajustes.lanzamiento"
  | "ajustes.pruebas"
  | "ajustes.vista"
  | "ajustes.arranque"
  | "ajustes.avanzado"
  | "motores"
  | "piso.siguiente";
// defecto: the default in plain Spanish, for the screen; every advanced key has one.
// owner_only: why an agent setting it would weaken a control the owner keeps. Only the owner's screen (a context with
// human: true, from the session cookie) writes such a key; set_project from an agent refuses it with INVALID_FILTER,
// as an unknown key (I46-10 #4).
export type SettingDef = { tier: SettingTier; control: SettingControl; default: string; frase: string; reason?: string; defecto?: string; owner_only?: string };

export const SETTINGS = {
  local: { tier: "basic", control: "ajustes.codigo", default: "the folder named after the project under PLANIA_PROJECTS_ROOT", frase: "Dónde está el código en esta computadora, o que todavía no hay código." },
  github: {
    tier: "basic",
    control: "ajustes.codigo",
    default: "none: no pull requests or checks are read",
    frase: "El repositorio en GitHub. La llave, si hace falta, se da por el nombre de una variable, nunca su valor.",
  },
  release: {
    tier: "basic",
    control: "ajustes.lanzamiento",
    default: "a new project ships from the screen (mode merge, start branch → main, env prod); an older one keeps what it has",
    frase: "La fusión a producción que solo tú haces, desde la pantalla o con un comando.",
  },
  qa: { tier: "basic", control: "ajustes.pruebas", default: "no verify list; the other QA switches off", frase: "Los comandos que QA corre en cada entrega." },
  capture: { tier: "basic", control: "ajustes.arranque", default: "none until Máquinas guesses it from the dev script", frase: "Cómo arranca la app para probarla y tomarle fotos." },
  preview_url: { owner_only: "an agent could point the owner's preview link anywhere", tier: "basic", control: "ajustes.vista", default: "none", frase: "Dónde ves la app corriendo." },
  plan_approval: { owner_only: "off, a PO's plan makes tickets without the owner's «Sí, empiecen»", tier: "basic", control: "ajustes.vista", default: "on for a new project", frase: "Un plan del PO espera tu «Sí, empiecen»." },
  auto_accept: { owner_only: "on, deliveries enter the test copy without the owner", tier: "basic", control: "ajustes.vista", default: "off", frase: "Una entrega con sus pruebas en verde entra a la copia de prueba sin esperarte." },
  auto_accept_invisible: { owner_only: "on, deliveries enter the test copy without the owner", tier: "basic", control: "ajustes.vista", default: "off", frase: "Solo lo que no cambia la pantalla entra sin esperarte." },
  runner: { owner_only: "it raises how many runs go at once and which server variables runs get", tier: "basic", control: "motores", default: "the company's limits", frase: "Cuántos agentes y preguntas trabajan a la vez en este proyecto." },
  next_first: { owner_only: "it overrides the step the owner picked to go first", tier: "basic", control: "piso.siguiente", default: "none: the board's order", frase: "El paso listo que va primero." },
  // PLA-I2-5: the working branch every worktree is cut from (src/runner/start-branch.ts).
  start_branch: {
    tier: "advanced",
    defecto: "la rama de prueba de siempre.",
    control: "ajustes.avanzado",
    default: "sandbox",
    frase: "La rama de donde parte el equipo y a la que entra lo que aceptas. Nunca la rama publicada.",
    reason: "The default works once the repository has that branch; «Crear la rama de trabajo» makes it.",
  },
  release_target: {
    tier: "advanced",
    defecto: "el entorno «prod».",
    control: "ajustes.avanzado",
    default: "prod",
    frase: "El entorno al que debe llegar un paso para contar como publicado.",
    reason: "Only matters with more than one deploy target; prod fits a project with one.",
  },
  release_on: {
    tier: "advanced",
    defecto: "Plania lo decide según lo que tiene el proyecto.",
    control: "ajustes.avanzado",
    default: "env with Vercel or a recorded commit, else branch",
    frase: "Qué cuenta como publicado: que el entorno corra el cambio, o que la rama publicada lo tenga.",
    reason: "Plania picks it from what the project has; set it only when the guess is wrong.",
  },
  auto_done: {
    tier: "advanced",
    defecto: "encendido.",
    control: "ajustes.avanzado",
    default: "on",
    frase: "Un paso publicado con todo comprobado se cierra solo.",
    reason: "On is what a new owner wants; off keeps every closing by hand.",
  },
  branch_pattern: {
    tier: "advanced",
    defecto: "cualquier nombre de rama.",
    control: "ajustes.avanzado",
    default: "none: any branch name",
    frase: "La forma que debe tener el nombre de cada rama (una expresión regular).",
    reason: "The runner already names its branches; a pattern only binds outside clients.",
  },
  claim_from: {
    tier: "advanced",
    defecto: "de lo pendiente.",
    control: "ajustes.avanzado",
    default: "backlog",
    frase: "De dónde toma trabajo un agente que pide el siguiente: de lo pendiente o solo de lo listo.",
    reason: "The PO decides what is Ready; the default suits a team the PO leads.",
  },
  resources: {
    tier: "advanced",
    defecto: "sin tope propio.",
    control: "ajustes.avanzado",
    default: "none: leases with the server's limits",
    frase: "Cosas compartidas que se apartan por turnos (un puerto, una base), con su tiempo máximo.",
    reason: "Leases work without it; it only caps how long one may be held.",
  },
  quotas: {
    tier: "advanced",
    defecto: "sin límites diarios.",
    control: "ajustes.avanzado",
    default: "none",
    frase: "Cuántas veces al día se puede usar algo con límite (una API externa).",
    reason: "Only for a project that calls an outside service with a daily cap.",
  },
  vercel: {
    tier: "advanced",
    defecto: "no se leen los despliegues.",
    control: "ajustes.avanzado",
    default: "none: deploys are not read",
    frase: "El proyecto en Vercel. La llave se da por el nombre de una variable, nunca su valor.",
    reason: "Only for a project deployed on Vercel.",
  },
  maquinas: {
    tier: "advanced",
    defecto: "Plania los busca en el repositorio.",
    control: "ajustes.avanzado",
    default: "found in the repo: the env file, the migrate and seed scripts, the migrations folder",
    frase: "Los comandos de la base de la app, cuando Plania no los encuentra solo.",
    reason: "Plania finds them in package.json and the repo; set them only when it cannot.",
  },
  // PLA-I2-3: the project's place in lists; its colour and mark come from its slug.
  identity: {
    tier: "advanced",
    defecto: "Por nombre, en orden alfabético.",
    control: "ajustes.avanzado",
    default: "by slug, alphabetically",
    frase: "En qué lugar sale el proyecto en las listas (menor primero).",
    reason: "Alphabetical order works until there are enough projects to care.",
  },
  team: {
    tier: "advanced",
    defecto: "120 minutos.",
    control: "ajustes.avanzado",
    default: "idle after 120 minutes",
    frase: "Cuántos minutos sin señal hacen que un agente cuente como atorado.",
    reason: "Two hours suits runs of any length the runner starts.",
  },
} as const satisfies Record<keyof ProjectSettings, SettingDef>;

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export const ADVANCED_KEYS = SETTING_KEYS.filter((k) => SETTINGS[k].tier === "advanced");
// PLA-I2-6: the keys only the owner's screen sets (see SettingDef.owner_only).
export const OWNER_ONLY_KEYS = SETTING_KEYS.filter((k) => !!(SETTINGS[k] as SettingDef).owner_only);
/** The keys a caller may set: every key from the owner's screen; the rest only, from an agent. */
export const settableKeys = (human: boolean): SettingKey[] => (human ? SETTING_KEYS : SETTING_KEYS.filter((k) => !OWNER_ONLY_KEYS.includes(k)));

// A variable's name, never its value: what every *_env field and every token field takes.
export const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

// What a pasted secret looks like: a value no settings field should hold. Not a scanner; a guard on the screen's
// free-form fields (src/api/project-settings.ts) so a token never lands in projects.settings.
const SECRET_SHAPES = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /:\/\/[^/\s:@]+:[^/\s@]+@/,
];
export const looksSecret = (s: string): boolean => SECRET_SHAPES.some((r) => r.test(s));

/** Every string inside a value, keys included, for the secret guard. */
export function stringsIn(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(stringsIn);
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [k, ...stringsIn(x)]);
  return [];
}

/** The README's tables: the keys only the owner's screen sets, then the advanced ones; between the settings-table markers. */
export function advancedTable(): string {
  const rows = ADVANCED_KEYS.map((k) => {
    const d: SettingDef = SETTINGS[k];
    return `| \`${k}\` | ${d.default} | ${d.reason ?? ""} |`;
  });
  const owner = OWNER_ONLY_KEYS.map((k) => `| \`${k}\` | ${(SETTINGS[k] as SettingDef).owner_only} |`);
  return [
    "Only the owner's screen sets these; `set_project` from an agent refuses them (INVALID_FILTER):",
    "",
    "| Setting | Why an agent may not |",
    "|---|---|",
    ...owner,
    "",
    "Advanced settings, which can be left alone:",
    "",
    "| Setting | Default | Why it can be left alone |",
    "|---|---|---|",
    ...rows,
  ].join("\n");
}
