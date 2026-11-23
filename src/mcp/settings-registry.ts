// PLA-I2-6: the one list of project settings (projects.settings). set_project accepts exactly these keys
// (SETTING_KEYS), the Ajustes view shows each one where its control is, and the README lists the advanced ones with
// the reason they can be left alone (`pnpm exec tsx scripts/settings-table.ts` writes that table; test/settings-registry.test.ts checks
// it). Typed against ProjectSettings: a key added to the type without an entry here does not compile.
//   tier      basic: a new owner may need it to finish setup. advanced: a default that can be left alone; its control
//             is in Ajustes' closed «Avanzado» section, or (PLA-133) in Despliegue for the release and branch ones,
//             and `reason` says why it can wait.
//   control   where the screen sets it. Every key has one; internal ones name the screen action that writes them.
//   default   what holds while the key is unset (English, for the README).
//   frase     the plain Spanish sentence the screen shows beside the control; defecto, the default said the same way.
import type { ProjectSettings } from "../db/schema.js";
import { defineWords, say } from "../words.js";

export type SettingTier = "basic" | "advanced";
export type SettingControl =
  // PLA-132: where the code is, the release step and the production address are edited in Despliegue (Camino).
  | "camino.codigo"
  | "camino.entornos"
  | "ajustes.pruebas"
  | "ajustes.vista"
  | "ajustes.arranque"
  | "ajustes.avanzado"
  | "motores"
  | "piso.siguiente"
  | "marca.nativo";
// defecto: the default in plain Spanish, for the screen; every advanced key has one.
// owner_only: why an agent setting it would weaken a control the owner keeps. Only the owner's screen (a context with
// human: true, from the session cookie) writes such a key; set_project from an agent refuses it with INVALID_FILTER,
// as an unknown key (I46-10 #4).
export type SettingDef = { tier: SettingTier; control: SettingControl; default: string; frase: string; reason?: string; defecto?: string; owner_only?: string };

// PLA-I2-10: the sentences the screen shows beside each control (frase) and the defaults said the same way (defecto),
// in the install's language; the Spanish is unchanged. SETTINGS reads them through getters, so the language applies
// at the moment a setting is shown.
type SettingWords = { frase: Record<keyof ProjectSettings, string>; defecto: Partial<Record<keyof ProjectSettings, string>> };
export const SETTING_WORDS = defineWords<SettingWords>({
  es: {
    frase: {
      local: "Dónde está el código en esta computadora, o que todavía no hay código.",
      github: "El repositorio en GitHub. La llave, si hace falta, se da por el nombre de una variable, nunca su valor.",
      release: "La fusión a producción que solo tú haces, desde la pantalla o con un comando.",
      qa: "Los comandos que QA corre en cada entrega.",
      capture: "Cómo arranca la app para probarla y tomarle fotos.",
      preview_url: "Dónde ves la app corriendo.",
      plan_approval: "Un plan del PO espera tu «Sí, empiecen».",
      auto_accept: "Una entrega con sus pruebas en verde entra a la copia de prueba sin esperarte.",
      auto_accept_invisible: "Solo lo que no cambia la pantalla entra sin esperarte.",
      marca: "La puerta Marca también cuenta los íconos de la app nativa y las pantallas de arranque de iPhone.",
      runner: "Cuántos agentes y preguntas trabajan a la vez en este proyecto.",
      next_first: "El paso listo que va primero.",
      start_branch: "La rama de donde parte el equipo y a la que entra lo que aceptas. Nunca la rama publicada.",
      release_target: "El entorno al que debe llegar un paso para contar como publicado.",
      release_on: "Qué cuenta como publicado: que el entorno corra el cambio, o que la rama publicada lo tenga.",
      auto_done: "Un paso publicado con todo comprobado se cierra solo.",
      velocidad: "Cómo se construye rápido: el siguiente paso empieza encima del entregado, revisas una vez por módulo, cuántos pasos a la vez y si el esqueleto empieza antes de «Constrúyelo».",
      branch_pattern: "La forma que debe tener el nombre de cada rama (una expresión regular).",
      claim_from: "De dónde toma trabajo un agente que pide el siguiente: de lo pendiente o solo de lo listo.",
      resources: "Cosas compartidas que se apartan por turnos (un puerto, una base), con su tiempo máximo.",
      quotas: "Cuántas veces al día se puede usar algo con límite (una API externa).",
      vercel: "Otro proyecto en Vercel u otra llave que el de Camino. La llave se da por el nombre de una variable, nunca su valor.",
      maquinas: "Los comandos de la base de la app, cuando Plania no los encuentra solo.",
      identity: "En qué lugar sale el proyecto en las listas (menor primero).",
      team: "Cuántos minutos sin señal hacen que un agente cuente como atorado.",
    },
    defecto: {
      start_branch: "la rama de prueba de siempre.",
      release_target: "el entorno «prod».",
      release_on: "Plania lo decide según lo que tiene el proyecto.",
      auto_done: "encendido.",
      velocidad: "pasos encima del entregado, una revisión por módulo, 2 a la vez, esqueleto temprano.",
      branch_pattern: "cualquier nombre de rama.",
      claim_from: "de lo pendiente.",
      resources: "sin tope propio.",
      quotas: "sin límites diarios.",
      vercel: "se leen los estados que el servicio publica en GitHub, y el proyecto de Vercel elegido en Camino con la llave de Conexiones.",
      maquinas: "Plania los busca en el repositorio.",
      identity: "Por nombre, en orden alfabético.",
      team: "120 minutos.",
    },
  },
  en: {
    frase: {
      local: "Where the code is on this computer, or that there is no code yet.",
      github: "The repository on GitHub. The key, if needed, is given by a variable's name, never its value.",
      release: "The merge to production that only you do, from the screen or with a command.",
      qa: "The commands QA runs on each delivery.",
      capture: "How the app starts so it can be tried and photographed.",
      preview_url: "Where you see the app running.",
      plan_approval: "A PO's plan waits for your «Yes, go ahead».",
      auto_accept: "A delivery with its tests green goes into the test copy without waiting for you.",
      auto_accept_invisible: "Only what does not change the screen goes in without waiting for you.",
      marca: "The Marca door also counts the native app icons and the iPhone launch screens.",
      runner: "How many agents and questions work at once in this project.",
      next_first: "The ready step that goes first.",
      start_branch: "The branch the team starts from and that what you accept goes into. Never the published branch.",
      release_target: "The environment a step must reach to count as published.",
      release_on: "What counts as published: the environment running the change, or the published branch having it.",
      auto_done: "A published step with everything checked closes by itself.",
      velocidad: "How building goes fast: the next step starts on top of the delivered one, you review once per module, how many steps at once, and whether the skeleton starts before «Build it».",
      branch_pattern: "The shape every branch name must have (a regular expression).",
      claim_from: "Where an agent asking for the next one takes work from: what is pending, or only what is ready.",
      resources: "Shared things taken in turns (a port, a database), with their longest hold.",
      quotas: "How many times a day something with a limit can be used (an outside API).",
      vercel: "A Vercel project or key other than Camino's. The key is given by a variable's name, never its value.",
      maquinas: "The commands for the app's database, when Plania does not find them by itself.",
      identity: "Where the project shows in lists (lowest first).",
      team: "How many minutes without a signal make an agent count as stuck.",
    },
    defecto: {
      start_branch: "the usual test branch.",
      release_target: "the «prod» environment.",
      release_on: "Plania decides from what the project has.",
      auto_done: "on.",
      velocidad: "steps on top of the delivered one, one review per module, 2 at once, early skeleton.",
      branch_pattern: "any branch name.",
      claim_from: "from what is pending.",
      resources: "no cap of its own.",
      quotas: "no daily limits.",
      vercel: "the statuses the host posts on GitHub are read, and the Vercel project picked in Camino with the key in Connections.",
      maquinas: "Plania looks for them in the repository.",
      identity: "By name, in alphabetical order.",
      team: "120 minutes.",
    },
  },
});

export const SETTINGS = {
  local: { tier: "basic", control: "camino.codigo", default: "the folder named after the project under PLANIA_PROJECTS_ROOT", get frase() { return say(SETTING_WORDS).frase.local; } },
  github: {
    tier: "basic",
    control: "camino.codigo",
    default: "none: no pull requests or checks are read",
    get frase() { return say(SETTING_WORDS).frase.github; },
  },
  release: {
    tier: "basic",
    control: "camino.codigo",
    default: "a project made on the screen ships from the screen (mode merge, start branch → main, env prod); one made by the script or the MCP tool has none, and an older one keeps what it has",
    get frase() { return say(SETTING_WORDS).frase.release; },
  },
  qa: { tier: "basic", control: "ajustes.pruebas", default: "no verify list; the other QA switches off", get frase() { return say(SETTING_WORDS).frase.qa; } },
  capture: { tier: "basic", control: "ajustes.arranque", default: "none until Máquinas guesses it from the dev script", get frase() { return say(SETTING_WORDS).frase.capture; } },
  preview_url: { owner_only: "an agent could point the owner's preview link anywhere", tier: "basic", control: "camino.entornos", default: "none", get frase() { return say(SETTING_WORDS).frase.preview_url; } },
  // PLA-I66-6: the switch on the Marca door.
  marca: { tier: "basic", control: "marca.nativo", default: "off: only the web files are counted", get frase() { return say(SETTING_WORDS).frase.marca; } },
  plan_approval: { owner_only: "off, a PO's plan makes tickets without the owner's «Sí, empiecen»", tier: "basic", control: "ajustes.vista", default: "on for a new project", get frase() { return say(SETTING_WORDS).frase.plan_approval; } },
  auto_accept: { owner_only: "on, deliveries enter the test copy without the owner", tier: "basic", control: "ajustes.vista", default: "off", get frase() { return say(SETTING_WORDS).frase.auto_accept; } },
  auto_accept_invisible: { owner_only: "on, deliveries enter the test copy without the owner", tier: "basic", control: "ajustes.vista", default: "off", get frase() { return say(SETTING_WORDS).frase.auto_accept_invisible; } },
  runner: { owner_only: "it raises how many runs go at once and which server variables runs get", tier: "basic", control: "motores", default: "the company's limits", get frase() { return say(SETTING_WORDS).frase.runner; } },
  next_first: { owner_only: "it overrides the step the owner picked to go first", tier: "basic", control: "piso.siguiente", default: "none: the board's order", get frase() { return say(SETTING_WORDS).frase.next_first; } },
  // PLA-I2-5: the working branch every worktree is cut from (src/runner/start-branch.ts).
  start_branch: {
    tier: "advanced",
    get defecto() { return say(SETTING_WORDS).defecto.start_branch!; },
    control: "camino.codigo",
    default: "sandbox",
    get frase() { return say(SETTING_WORDS).frase.start_branch; },
    reason: "The default works once the repository has that branch; «Crear la rama de trabajo» makes it.",
  },
  release_target: {
    tier: "advanced",
    get defecto() { return say(SETTING_WORDS).defecto.release_target!; },
    control: "camino.entornos",
    default: "prod",
    get frase() { return say(SETTING_WORDS).frase.release_target; },
    reason: "Only matters with more than one deploy target; prod fits a project with one.",
  },
  release_on: {
    tier: "advanced",
    get defecto() { return say(SETTING_WORDS).defecto.release_on!; },
    control: "camino.entornos",
    default: "env with Vercel or a recorded commit, else branch",
    get frase() { return say(SETTING_WORDS).frase.release_on; },
    reason: "Plania picks it from what the project has; set it only when the guess is wrong.",
  },
  auto_done: {
    tier: "advanced",
    get defecto() { return say(SETTING_WORDS).defecto.auto_done!; },
    control: "ajustes.avanzado",
    default: "on",
    get frase() { return say(SETTING_WORDS).frase.auto_done; },
    reason: "On is what a new owner wants; off keeps every closing by hand.",
  },
  velocidad: {
    tier: "advanced",
    get defecto() { return say(SETTING_WORDS).defecto.velocidad!; },
    control: "ajustes.avanzado",
    default: "apilar on, revision por_modulo, carriles 2, esqueleto_temprano on, verificar on",
    get frase() { return say(SETTING_WORDS).frase.velocidad; },
    reason: "PLA-I73: measured on guided test 3, most of a module's time was waiting between steps.",
    owner_only: "It decides when work is accepted without the owner and how much runs at once.",
  },
  branch_pattern: {
    tier: "advanced",
    get defecto() { return say(SETTING_WORDS).defecto.branch_pattern!; },
    control: "ajustes.avanzado",
    default: "none: any branch name",
    get frase() { return say(SETTING_WORDS).frase.branch_pattern; },
    reason: "The runner already names its branches; a pattern only binds outside clients.",
  },
  claim_from: {
    tier: "advanced",
    get defecto() { return say(SETTING_WORDS).defecto.claim_from!; },
    control: "ajustes.avanzado",
    default: "backlog",
    get frase() { return say(SETTING_WORDS).frase.claim_from; },
    reason: "The PO decides what is Ready; the default suits a team the PO leads.",
  },
  resources: {
    tier: "advanced",
    get defecto() { return say(SETTING_WORDS).defecto.resources!; },
    control: "ajustes.avanzado",
    default: "none: leases with the server's limits",
    get frase() { return say(SETTING_WORDS).frase.resources; },
    reason: "Leases work without it; it only caps how long one may be held.",
  },
  quotas: {
    tier: "advanced",
    get defecto() { return say(SETTING_WORDS).defecto.quotas!; },
    control: "ajustes.avanzado",
    default: "none",
    get frase() { return say(SETTING_WORDS).frase.quotas; },
    reason: "Only for a project that calls an outside service with a daily cap.",
  },
  vercel: {
    tier: "advanced",
    get defecto() { return say(SETTING_WORDS).defecto.vercel!; },
    control: "camino.entornos",
    default: "none: host statuses on GitHub, and Camino's Vercel project with the saved key",
    get frase() { return say(SETTING_WORDS).frase.vercel; },
    reason: "Only to read a Vercel project or key other than the one Camino names.",
  },
  maquinas: {
    tier: "advanced",
    get defecto() { return say(SETTING_WORDS).defecto.maquinas!; },
    control: "ajustes.avanzado",
    default: "found in the repo: the env file, the migrate and seed scripts, the migrations folder",
    get frase() { return say(SETTING_WORDS).frase.maquinas; },
    reason: "Plania finds them in package.json and the repo; set them only when it cannot.",
  },
  // PLA-I2-3: the project's place in lists; its colour and mark come from its slug.
  identity: {
    tier: "advanced",
    get defecto() { return say(SETTING_WORDS).defecto.identity!; },
    control: "ajustes.avanzado",
    default: "by slug, alphabetically",
    get frase() { return say(SETTING_WORDS).frase.identity; },
    reason: "Alphabetical order works until there are enough projects to care.",
  },
  team: {
    tier: "advanced",
    get defecto() { return say(SETTING_WORDS).defecto.team!; },
    control: "ajustes.avanzado",
    default: "idle after 120 minutes",
    get frase() { return say(SETTING_WORDS).frase.team; },
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
