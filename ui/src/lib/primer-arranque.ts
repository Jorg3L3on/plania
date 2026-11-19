// PLA-I2-2: the first-start screen's words and rules, tested without a browser. Plain Spanish for the owner.
// No "@/" imports: a test reads this file with node directly.

export const PASSWORD_MIN = 12;

export type FirstStartState = { open: boolean; loopback: boolean };
// PLA-I2-3: the two folders come prefilled with the neutral defaults; ~ is the home on this machine.
export type FirstStartForm = { code: string; name: string; password: string; repeat: string; time_zone: string; projects_root: string; worktrees_root: string };
export const DEFAULT_PROJECTS_ROOT = "~/plania/projects";
export const DEFAULT_WORKTREES_ROOT = "~/plania/worktrees";

export const WORDS = {
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
  submit: "Empezar",
  submitting: "Preparando todo…",
  notLoopback: "El primer arranque solo se hace desde esta misma máquina: abre Plania en su navegador, en localhost.",
  back: "Volver al primer arranque",
} as const;

/** The zone the browser runs in, or "" when it does not say. */
export function browserTimeZone(intl: typeof Intl = Intl): string {
  try {
    return intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/** The first problem with the form, in the owner's words, or null when it can be sent. */
export function formProblem(f: FirstStartForm): string | null {
  if (!f.code.trim()) return "Escribe el código que imprimió la instalación.";
  if (!f.name.trim()) return "Escribe tu nombre.";
  if ([...f.password].length < PASSWORD_MIN) return `La contraseña necesita al menos ${PASSWORD_MIN} caracteres.`;
  if (f.password !== f.repeat) return "Las dos contraseñas no son iguales.";
  if (!f.time_zone.trim()) return "Elige tu zona horaria.";
  if (!f.projects_root.trim() || !f.worktrees_root.trim()) return "Escribe las dos carpetas, o deja las que vienen.";
  return null;
}

/** What the server's refusal means to the owner. */
export function refusalText(code: string, detail: { field?: unknown; retry_after?: unknown } = {}): string {
  switch (code) {
    case "SETUP_CODE_INVALID":
      return "Ese código no es el que imprimió la instalación.";
    case "TOO_MANY_TRIES":
      return waitText(detail.retry_after);
    case "NOT_LOOPBACK":
      return WORDS.notLoopback;
    case "FIRST_START_CLOSED":
      return "Plania ya tiene dueño. Entra con tu contraseña.";
    case "INVALID_BODY":
      if (detail.field === "password") return `La contraseña necesita al menos ${PASSWORD_MIN} caracteres.`;
      if (detail.field === "time_zone") return "Esa zona horaria no existe. Escribe una como Europe/Madrid.";
      if (detail.field === "name") return "Escribe tu nombre.";
      if (detail.field === "projects_root" || detail.field === "worktrees_root") return "Esa carpeta no sirve: escríbela completa, o empezando con ~.";
      return "Revisa los datos e intenta de nuevo.";
    default:
      return "No se pudo terminar. Intenta de nuevo.";
  }
}

/** Ten wrong tries in a minute: the wait, in seconds, said plainly. */
export function waitText(seconds: unknown): string {
  const n = typeof seconds === "number" && seconds > 0 ? Math.ceil(seconds) : 60;
  return `Demasiados intentos. Espera ${n} ${n === 1 ? "segundo" : "segundos"} y vuelve a probar.`;
}
