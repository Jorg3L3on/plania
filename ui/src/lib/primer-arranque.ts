// PLA-I2-2: the first-start screen's words and rules, tested without a browser. Plain words for the owner.
// PLA-I2-10: in both languages (lib/i18n.ts); the owner picks the language on this screen.
// No "@/" imports: a test reads this file with node directly.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export const PASSWORD_MIN = 12;

// F5: folders, the defaults as this machine writes them (C:Users<user>planiaprojects on Windows); sent only to
// the browser on this machine while first start is open.
export type FirstStartFolders = { projects: string; worktrees: string };
export type FirstStartState = { open: boolean; loopback: boolean; folders?: FirstStartFolders };
// PLA-I2-3: the two folders come prefilled with the neutral defaults; ~ is the home on this machine.
export type FirstStartForm = { code: string; name: string; password: string; repeat: string; time_zone: string; projects_root: string; worktrees_root: string };
export const DEFAULT_PROJECTS_ROOT = "~/plania/projects";
export const DEFAULT_WORKTREES_ROOT = "~/plania/worktrees";

export const FIRST_START = defineWords({
  es: {
    title: "Te damos la bienvenida a Plania",
    lead: "Es la primera vez que Plania arranca en esta máquina. Dinos cómo llamarte y elige tu contraseña.",
    code: "Código de un solo uso",
    codeHint: "Lo imprimió la instalación al terminar. Si lo perdiste, vuelve a correr la instalación y te dará otro.",
    name: "Tu nombre",
    nameHint: "Así te saludará Plania y así te llamará tu equipo.",
    password: "Contraseña",
    passwordHint: `Al menos ${PASSWORD_MIN} caracteres.`,
    repeat: "Repite la contraseña",
    timeZone: "Zona horaria",
    timeZoneHint: "La tomamos de tu navegador; cámbiala si no es la tuya.",
    projectsRoot: "Carpeta de tus proyectos",
    projectsRootHint: "Aquí busca Plania el código de cada proyecto, una carpeta por proyecto.",
    worktreesRoot: "Carpeta de trabajo de los agentes",
    worktreesRootHint: "Aquí hacen sus copias para trabajar sin tocar las tuyas.",
    machine: "Antes de terminar, revisa qué le falta a esta máquina",
    machineLink: "Ver qué falta",
    paused: "Tu compañía empieza en pausa: nada corre hasta que tú la reanudes.",
    moreOptions: "Más opciones",
    moreOptionsHint: "Zona horaria y carpetas. Lo que viene sirve para casi todos.",
    submit: "Empezar",
    submitting: "Preparando todo…",
    notLoopback: "El primer arranque solo se hace desde esta misma máquina: abre Plania en su navegador, en localhost.",
    back: "Volver al primer arranque",
    noCode: "Escribe el código que imprimió la instalación.",
    noName: "Escribe tu nombre.",
    shortPassword: `La contraseña necesita al menos ${PASSWORD_MIN} caracteres.`,
    differentPasswords: "Las dos contraseñas no son iguales.",
    noTimeZone: "Elige tu zona horaria.",
    noFolders: "Escribe las dos carpetas, o deja las que vienen.",
    badCode: "Ese código no es el que imprimió la instalación.",
    closed: "Plania ya tiene dueño. Entra con tu contraseña.",
    badTimeZone: "Esa zona horaria no existe. Escribe una como Europe/Madrid.",
    badFolder: "Esa carpeta no sirve: escríbela completa, o empezando con ~.",
    checkData: "Revisa los datos e intenta de nuevo.",
    failed: "No se pudo terminar. Intenta de nuevo.",
    wait: (n: number) => `Demasiados intentos. Espera ${n} ${n === 1 ? "segundo" : "segundos"} y vuelve a probar.`,
  },
  en: {
    title: "Welcome to Plania",
    lead: "This is the first time Plania starts on this machine. Tell us what to call you and choose your password.",
    code: "One-time code",
    codeHint: "The install printed it when it finished. If you lost it, run the install again and it will give you another.",
    name: "Your name",
    nameHint: "Plania greets you by it, and your team calls you by it.",
    password: "Password",
    passwordHint: `At least ${PASSWORD_MIN} characters.`,
    repeat: "Repeat the password",
    timeZone: "Time zone",
    timeZoneHint: "Taken from your browser; change it if it is not yours.",
    projectsRoot: "Your projects folder",
    projectsRootHint: "Plania looks here for each project's code, one folder per project.",
    worktreesRoot: "The agents' working folder",
    worktreesRootHint: "They make their copies here, so they work without touching yours.",
    machine: "Before you finish, check what this machine is missing",
    machineLink: "See what is missing",
    paused: "Your company starts paused: nothing runs until you resume it.",
    moreOptions: "More options",
    moreOptionsHint: "Time zone and folders. What is given suits almost everyone.",
    submit: "Start",
    submitting: "Getting everything ready…",
    notLoopback: "First start only works from this same machine: open Plania in its browser, on localhost.",
    back: "Back to first start",
    noCode: "Type the code the install printed.",
    noName: "Type your name.",
    shortPassword: `The password needs at least ${PASSWORD_MIN} characters.`,
    differentPasswords: "The two passwords are not the same.",
    noTimeZone: "Choose your time zone.",
    noFolders: "Type both folders, or keep the ones given.",
    badCode: "That is not the code the install printed.",
    closed: "Plania already has an owner. Sign in with your password.",
    badTimeZone: "That time zone does not exist. Type one like Europe/Madrid.",
    badFolder: "That folder will not do: type it in full, or starting with ~.",
    checkData: "Check what you typed and try again.",
    failed: "It could not finish. Try again.",
    wait: (n: number) => `Too many tries. Wait ${n} ${n === 1 ? "second" : "seconds"} and try again.`,
  },
});

/** The first-start words in the screen's language (Spanish for code that does not say). */
export const WORDS = words(FIRST_START);

/** The zone the browser runs in, or "" when it does not say. */
export function browserTimeZone(intl: typeof Intl = Intl): string {
  try {
    return intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/** The first problem with the form, in the owner's words, or null when it can be sent. */
export function formProblem(f: FirstStartForm, language: Language = getLanguage()): string | null {
  const w = words(FIRST_START, language);
  if (!f.code.trim()) return w.noCode;
  if (!f.name.trim()) return w.noName;
  if ([...f.password].length < PASSWORD_MIN) return w.shortPassword;
  if (f.password !== f.repeat) return w.differentPasswords;
  if (!f.time_zone.trim()) return w.noTimeZone;
  if (!f.projects_root.trim() || !f.worktrees_root.trim()) return w.noFolders;
  return null;
}

/** What the server's refusal means to the owner. */
export function refusalText(code: string, detail: { field?: unknown; retry_after?: unknown } = {}, language: Language = getLanguage()): string {
  const w = words(FIRST_START, language);
  switch (code) {
    case "SETUP_CODE_INVALID":
      return w.badCode;
    case "TOO_MANY_TRIES":
      return waitText(detail.retry_after, language);
    case "NOT_LOOPBACK":
      return w.notLoopback;
    case "FIRST_START_CLOSED":
      return w.closed;
    case "INVALID_BODY":
      if (detail.field === "password") return w.shortPassword;
      if (detail.field === "time_zone") return w.badTimeZone;
      if (detail.field === "name") return w.noName;
      if (detail.field === "projects_root" || detail.field === "worktrees_root") return w.badFolder;
      return w.checkData;
    default:
      return w.failed;
  }
}

/** Ten wrong tries in a minute: the wait, in seconds, said plainly. */
export function waitText(seconds: unknown, language: Language = getLanguage()): string {
  const n = typeof seconds === "number" && seconds > 0 ? Math.ceil(seconds) : 60;
  return words(FIRST_START, language).wait(n);
}

// F4: the install opens /primer-arranque#code=<code>. A fragment never reaches the server or its logs; the page reads
// it once and takes it out of the address bar.
/** The one-time code in an address fragment («#code=ABCD-EFGH»), or null when there is none. */
export function codeFromHash(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  let code: string | null;
  try {
    code = new URLSearchParams(raw).get("code");
  } catch {
    return null;
  }
  const clean = code?.trim() ?? "";
  return clean && clean.length <= 64 ? clean : null;
}

/** F5: the form's first values. The folders are the server's, written the way this machine writes paths. */
export function initialForm(state: Pick<FirstStartState, "folders"> | undefined, timeZone: string, code = ""): FirstStartForm {
  return {
    code,
    name: "",
    password: "",
    repeat: "",
    time_zone: timeZone,
    projects_root: state?.folders?.projects ?? DEFAULT_PROJECTS_ROOT,
    worktrees_root: state?.folders?.worktrees ?? DEFAULT_WORKTREES_ROOT,
  };
}

/** F5: whether «Más opciones» must open to show what is wrong (the time zone or a folder lives there). */
export function problemInOptions(f: FirstStartForm, refusedField?: unknown): boolean {
  if (refusedField === "time_zone" || refusedField === "projects_root" || refusedField === "worktrees_root") return true;
  return !!f.code.trim() && !!f.name.trim() && [...f.password].length >= PASSWORD_MIN && f.password === f.repeat && (!f.time_zone.trim() || !f.projects_root.trim() || !f.worktrees_root.trim());
}

/** F4: the code field shows unless the code came in the address; a refused code shows it again to type. */
export const showCodeField = (fromAddress: boolean, refusedCode: string | null): boolean => !fromAddress || refusedCode === "SETUP_CODE_INVALID";
