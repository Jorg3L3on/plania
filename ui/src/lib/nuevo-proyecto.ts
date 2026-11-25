// NEWPROJ-2: what the sheet «Agregar un proyecto» (once «Nuevo proyecto») says when the server refuses (POST /company/projects).
// It also holds the sheet's four ways in (Local, Nube, SSH, Sin código), the repository spellings each one takes and
// the words of the folder window; the server imports this file for the shapes (src/runner/open-project.ts).
// Plain words, never the error code. Pure, so the tests call it directly.
// PLA-I2-10: the words are in NUEVO_PROYECTO_WORDS, in both languages; CODIGO_OPCIONES stays the Spanish one (tests
// read it) and the sheets read codigoOpciones(). Each function takes the language last.
import { seatName } from "./corriente.js";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";
import { PREPARAR_CODIGO_WORDS } from "./preparar-codigo.js";

/** How a GitHub refusal starts: the Ajustes view did not save, the sheet did not make the project. */
export type GithubLead = "save" | "create";

export const NUEVO_PROYECTO_WORDS = defineWords({
  es: {
    and: "y",
    seatsNone: "No se creó nada: falta el texto de instrucciones de algún puesto del equipo.",
    seatOne: (seat: string) => `No se creó nada: ${seat} no tiene su texto de instrucciones.`,
    seatsMany: (seats: string) => `No se creó nada: ${seats} no tienen su texto de instrucciones.`,
    projectExists: "No se creó nada: ya hay un proyecto con ese nombre.",
    keyTaken: "No se creó nada: esa clave ya es de otro proyecto.",
    carpeta: (path: string) => `la carpeta ${path}`,
    esaCarpeta: "esa carpeta",
    // PLA-I2-5: no terminal and no branch name: what has no button here is done after creating, from Despliegue (PLA-132)
    // («Preparar el código», «Crear la rama de trabajo»), choosing «Todavía no hay código» for now.
    despues: "Elige «Sin código» y prepáralo después desde Despliegue.",
    folderMissing: (folder: string, despues: string) => `No se creó nada: ${folder} no existe en esta máquina. Revisa la ruta, o ${despues}`,
    notGit: (folder: string, despues: string) => `No se creó nada: ${folder} tiene archivos pero no es un repositorio. Elige la carpeta del código, o ${despues}`,
    noOrigin: (folder: string, despues: string) => `No se creó nada: ${folder} no está conectada a GitHub. ${despues}`,
    originUnreachable: (folder: string) => `No se creó nada: no pude leer el repositorio en GitHub de ${folder}. Revisa en «Qué le falta» (en Máquina) que GitHub tenga la sesión iniciada.`,
    noStartBranch: (despues: string) => `No se creó nada: el repositorio en GitHub no tiene la rama de trabajo. ${despues}`,
    lead: { save: "No se guardó", create: "No se creó nada" } as Record<GithubLead, string>,
    github: {
      REPO_GITHUB_NO_GH: (lead: string) => `${lead}: GitHub no está instalado en esta máquina. «Qué le falta» (en Máquina) dice cómo instalarlo.`,
      REPO_GITHUB_SIGNED_OUT: (lead: string) => `${lead}: GitHub no tiene la sesión iniciada en esta máquina. «Qué le falta» (en Máquina) dice cómo entrar.`,
      REPO_GITHUB_NOT_FOUND: (lead: string) => `${lead}: tu cuenta de GitHub no encuentra ese repositorio. Revisa el dueño y el nombre.`,
      REPO_GITHUB_NO_WRITE: (lead: string) => `${lead}: tu cuenta de GitHub no puede escribir en ese repositorio. Pide acceso de escritura o usa otro.`,
      REPO_GITHUB_FAILED: (lead: string) => `${lead}: GitHub no respondió. Vuelve a intentar en un momento.`,
    } as Record<string, (lead: string) => string>,
    githubRepo: "No se creó nada: el repositorio de GitHub se escribe como dueño/nombre, por ejemplo ana/mi-proyecto.",
    repoPath: "No se creó nada: la carpeta va con su ruta completa, empezando con / o con ~/.",
    noCode: "No se creó nada: elige solo una opción para el código.",
    invalid: "No se creó nada: revisa el nombre y la meta.",
    other: "No se pudo crear el proyecto.",
    opciones: [
      { key: "carpeta", label: "Local", hint: "Una carpeta de esta máquina, con git y conectada a GitHub. La reviso antes de crear nada." },
      { key: "github", label: "Nube", hint: "Un repositorio de GitHub. Lo clono con tu cuenta de GitHub en la carpeta de proyectos, con el nombre del proyecto." },
      { key: "ssh", label: "SSH", hint: "Cualquier repositorio por su URL SSH. Lo clono con tus llaves SSH en la carpeta de proyectos, con el nombre del proyecto." },
      { key: "ninguno", label: "Sin código", hint: "Se crea el proyecto sin código. Máquinas lo dirá hasta que tenga carpeta." },
    ] as { key: CodigoOpcion; label: string; hint: string }[],
    agregar: {
      // The folder window: the server asks the machine for it (Finder, the Windows folder window, zenity or kdialog).
      elegir: "Elegir carpeta…",
      eligiendo: "Mira la ventana para elegir carpeta…",
      ventanaTitulo: "Elige la carpeta del proyecto",
      sinVentana: "Desde aquí no puedo abrir la ventana para elegir carpeta: escribe la ruta completa.",
      nubePlaceholder: "dueño/nombre o https://github.com/dueño/nombre",
      sshPlaceholder: "git@github.com:dueño/nombre.git",
      sshLabel: "URL SSH del repositorio",
      repoMal: "Escribe el repositorio como dueño/nombre o pega su dirección de GitHub.",
      sshMal: "Pega la URL SSH del repositorio, por ejemplo git@github.com:dueño/nombre.git.",
      metaOpcional: "Meta, en una oración (opcional)",
      clonando: "Clonando…",
      revisando: "Revisando la carpeta…",
      // PLA-180 (the PLA-I2-5 rule): the working branch is made only when the owner says so: it is one push to his repository.
      sinRama: "El repositorio no tiene la rama de trabajo, donde el equipo deja lo que hace. Puedo crearla en el repositorio desde la rama principal; no cambia ningún archivo.",
      crearRama: "Crear la rama y agregar",
      // A screen newer than the server it talks to: the route is not there until the server restarts.
      servidorViejo: "El servidor de Plania todavía no tiene esta opción. Reinícialo y vuelve a intentarlo.",
      ssh: {
        REPO_SSH_DENIED: "No se creó nada: el servidor del repositorio no aceptó tus llaves SSH. Revisa que tu llave esté agregada a tu cuenta (en GitHub: Settings › SSH keys) y cargada en esta máquina.",
        REPO_SSH_HOST_UNKNOWN: "No se creó nada: esta máquina todavía no conoce al servidor del repositorio. Conéctate una vez desde la Terminal (por ejemplo ssh -T git@github.com), acepta su huella y vuelve a intentarlo.",
        REPO_SSH_NOT_FOUND: "No se creó nada: ese repositorio no existe, o tu llave SSH no tiene acceso a él. Revisa la URL.",
        REPO_ORIGIN_UNREACHABLE: "No se creó nada: no pude conectarme al servidor del repositorio. Revisa la URL y la conexión.",
      } as Record<string, string>,
    },
  },
  en: {
    and: "and",
    seatsNone: "Nothing was made: some seat on the team is missing its instructions text.",
    seatOne: (seat: string) => `Nothing was made: ${seat} doesn't have its instructions text.`,
    seatsMany: (seats: string) => `Nothing was made: ${seats} don't have their instructions text.`,
    projectExists: "Nothing was made: there is already a project with that name.",
    keyTaken: "Nothing was made: that key already belongs to another project.",
    carpeta: (path: string) => `the folder ${path}`,
    esaCarpeta: "that folder",
    despues: "Choose «No code» and prepare it later from Deploy.",
    folderMissing: (folder: string, despues: string) => `Nothing was made: ${folder} doesn't exist on this machine. Check the path, or ${despues}`,
    notGit: (folder: string, despues: string) => `Nothing was made: ${folder} has files but is not a repository. Choose the code's folder, or ${despues}`,
    noOrigin: (folder: string, despues: string) => `Nothing was made: ${folder} is not connected to GitHub. ${despues}`,
    originUnreachable: (folder: string) => `Nothing was made: I couldn't read the GitHub repository of ${folder}. Check in «What's missing» (in Machine) that GitHub is signed in.`,
    noStartBranch: (despues: string) => `Nothing was made: the GitHub repository doesn't have the working branch. ${despues}`,
    lead: { save: "Not saved", create: "Nothing was made" },
    github: {
      REPO_GITHUB_NO_GH: (lead: string) => `${lead}: GitHub is not installed on this machine. «What's missing» (in Machine) says how to install it.`,
      REPO_GITHUB_SIGNED_OUT: (lead: string) => `${lead}: GitHub is not signed in on this machine. «What's missing» (in Machine) says how to sign in.`,
      REPO_GITHUB_NOT_FOUND: (lead: string) => `${lead}: your GitHub account can't find that repository. Check the owner and the name.`,
      REPO_GITHUB_NO_WRITE: (lead: string) => `${lead}: your GitHub account can't write to that repository. Ask for write access or use another.`,
      REPO_GITHUB_FAILED: (lead: string) => `${lead}: GitHub didn't answer. Try again in a moment.`,
    },
    githubRepo: "Nothing was made: the GitHub repository is written as owner/name, for example ana/my-project.",
    repoPath: "Nothing was made: the folder goes with its full path, starting with / or ~/.",
    noCode: "Nothing was made: choose only one option for the code.",
    invalid: "Nothing was made: check the name and the goal.",
    other: "The project could not be made.",
    opciones: [
      { key: "carpeta", label: "Local", hint: "A folder on this machine, with git and connected to GitHub. I check it before making anything." },
      { key: "github", label: "Cloud", hint: "A GitHub repository. I clone it with your GitHub account into the projects folder, under the project's name." },
      { key: "ssh", label: "SSH", hint: "Any repository by its SSH URL. I clone it with your SSH keys into the projects folder, under the project's name." },
      { key: "ninguno", label: "No code", hint: "The project is made with no code. Machines will say so until it has a folder." },
    ],
    agregar: {
      elegir: "Choose folder…",
      eligiendo: "Look for the folder window…",
      ventanaTitulo: "Choose the project's folder",
      sinVentana: "I can't open the folder window from here: type the full path.",
      nubePlaceholder: "owner/name or https://github.com/owner/name",
      sshPlaceholder: "git@github.com:owner/name.git",
      sshLabel: "Repository SSH URL",
      repoMal: "Write the repository as owner/name or paste its GitHub address.",
      sshMal: "Paste the repository's SSH URL, for example git@github.com:owner/name.git.",
      metaOpcional: "Goal, in one sentence (optional)",
      clonando: "Cloning…",
      revisando: "Checking the folder…",
      sinRama: "The repository doesn't have the working branch, where the team leaves its work. I can make it in the repository from the main branch; no file changes.",
      crearRama: "Make the branch and add",
      servidorViejo: "The Plania server doesn't have this option yet. Restart it and try again.",
      ssh: {
        REPO_SSH_DENIED: "Nothing was made: the repository's server didn't accept your SSH keys. Check that your key is added to your account (on GitHub: Settings › SSH keys) and loaded on this machine.",
        REPO_SSH_HOST_UNKNOWN: "Nothing was made: this machine doesn't know the repository's server yet. Connect once from Terminal (for example ssh -T git@github.com), accept its fingerprint and try again.",
        REPO_SSH_NOT_FOUND: "Nothing was made: that repository doesn't exist, or your SSH key has no access to it. Check the URL.",
        REPO_ORIGIN_UNREACHABLE: "Nothing was made: I couldn't reach the repository's server. Check the URL and the connection.",
      },
    },
  },
});

const list = (names: string[], language: Language): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} ${words(NUEVO_PROYECTO_WORDS, language).and} ${names.at(-1)}`;
const lowerFirst = (s: string): string => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;

/** The refusal line: code and detail from the server's reply, or null when the request never got an answer. */
export function nuevoProyectoError(code: string | null, detail: Record<string, unknown> = {}, language: Language = getLanguage()): string {
  const w = words(NUEVO_PROYECTO_WORDS, language);
  if (code === "PROMPT_DOC_MISSING") {
    const raw: unknown[] = Array.isArray(detail.seats) ? detail.seats : [];
    const seats = raw.filter((s): s is string => typeof s === "string").map((s) => seatName(s));
    if (seats.length === 0) return w.seatsNone;
    return seats.length === 1 ? w.seatOne(seats[0]!) : w.seatsMany(list(seats, language));
  }
  if (code === "PROJECT_EXISTS") return w.projectExists;
  if (code === "KEY_PREFIX_TAKEN") return w.keyTaken;
  // NEWPROJ-3: the folder's checks, one sentence each, saying what to fix.
  const folder = typeof detail.path === "string" && detail.path ? w.carpeta(detail.path) : w.esaCarpeta;
  if (code === "REPO_FOLDER_MISSING") return w.folderMissing(folder, lowerFirst(w.despues));
  if (code === "REPO_NOT_GIT") return w.notGit(folder, lowerFirst(w.despues));
  if (code === "REPO_NO_ORIGIN") return w.noOrigin(folder, w.despues);
  if (code === "REPO_ORIGIN_UNREACHABLE") return w.originUnreachable(folder);
  if (code === "REPO_NO_START_BRANCH") return w.noStartBranch(w.despues);
  return githubWords(code, "create", language) ?? restOf(code, detail, language);
}

/** PLA-I2-5: the GitHub choice's check, the same sentences in the sheet and in Ajustes. Null for another code. */
export function githubWords(code: string | null, lead: GithubLead = "save", language: Language = getLanguage()): string | null {
  const w = words(NUEVO_PROYECTO_WORDS, language);
  const line = code && Object.hasOwn(w.github, code) ? w.github[code] : undefined;
  return line ? line(w.lead[lead]) : null;
}

function restOf(code: string | null, detail: Record<string, unknown>, language: Language): string {
  const w = words(NUEVO_PROYECTO_WORDS, language);
  if (code === "INVALID_BODY" && detail.field === "github_repo") return w.githubRepo;
  if (code === "INVALID_BODY" && detail.field === "repo_path") return w.repoPath;
  if (code === "INVALID_BODY" && detail.field === "no_code") return w.noCode;
  if (code === "INVALID_BODY") return w.invalid;
  return w.other;
}

// NEWPROJ-8: the inputs stop where the server does (NEW_PROJECT_NAME_MAX / NEW_PROJECT_GOAL_MAX in
// src/runner/new-project.ts). The screen does not import server code; test/newproj-8-sheet-details.test.ts compares them.
export const NOMBRE_MAX = 40;
export const META_MAX = 280;

// NEWPROJ-8: a mouse-down on the dimmed background closes the creation sheet only while nothing is typed, so a stray
// click never throws text away. Esc and «Cancelar» still close. Pure, so the test drives it with fake events.
export const nuevoProyectoSinTexto = (fields: string[]): boolean => fields.every((f) => !f.trim());
export const fondoMouseDown =
  (closes: boolean, onClose: () => void) =>
  (e: { target: unknown; currentTarget: unknown }): void => {
    if (closes && e.target === e.currentTarget) onClose();
  };

// NEWPROJ-3: where the project's code is. Local: a folder on this machine (its GitHub repository read from origin). Nube: a
// GitHub repository cloned with gh. SSH: any repository cloned with git over SSH. Sin código: none yet. The same shapes
// the server checks (src/runner/open-project.ts, src/runner/repo-check.ts).
export type CodigoOpcion = "carpeta" | "github" | "ssh" | "ninguno";
export const CODIGO_OPCIONES: { key: CodigoOpcion; label: string; hint: string }[] = NUEVO_PROYECTO_WORDS.es.opciones;
/** The four choices in the screen's language (or the one given). */
export const codigoOpciones = (language: Language = getLanguage()): { key: CodigoOpcion; label: string; hint: string }[] => words(NUEVO_PROYECTO_WORDS, language).opciones;
export const agregarWords = (language: Language = getLanguage()) => words(NUEVO_PROYECTO_WORDS, language).agregar;
const GITHUB_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
export const githubRepoOk = (v: string): boolean => GITHUB_REPO.test(v.trim());
export const carpetaOk = (v: string): boolean => {
  const t = v.trim();
  return t.length > 0 && t.length <= 500 && (t.startsWith("/") || t.startsWith("~/") || /^[A-Za-z]:[\\/]/.test(t));
};

const OWNER = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})";
const NAME = "[A-Za-z0-9._-]{1,100}";
const SPELLINGS = [
  new RegExp(`^(${OWNER})/(${NAME})$`),
  new RegExp(`^(?:https?://)?(?:www\\.)?github\\.com/(${OWNER})/(${NAME})/?$`, "i"),
  new RegExp(`^(?:ssh://)?git@github\\.com[:/](${OWNER})/(${NAME})/?$`, "i"),
];

/** owner/name from the ways a GitHub repository is written or pasted (owner/name, https, ssh); null for anything else. */
export function githubRepoDe(text: string): string | null {
  const t = text.trim();
  for (const re of SPELLINGS) {
    const m = re.exec(t);
    if (!m) continue;
    const name = m[2]!.replace(/\.git$/i, "");
    if (!name || name === "." || name === "..") return null;
    return `${m[1]}/${name}`;
  }
  return null;
}

// SSH: scp-like user@host:path or ssh://[user@]host[:port]/path. No part may start with "-" (never read as an option).
const SCP = /^([A-Za-z0-9._][A-Za-z0-9._-]*)@([A-Za-z0-9][A-Za-z0-9.-]*):(?!\/)([A-Za-z0-9._~][A-Za-z0-9._~\/-]*)$/;
const SSH_URL = /^ssh:\/\/(?:([A-Za-z0-9._][A-Za-z0-9._-]*)@)?([A-Za-z0-9][A-Za-z0-9.-]*)(?::(\d{1,5}))?\/([A-Za-z0-9._~][A-Za-z0-9._~\/-]*)$/;

/** The SSH URL as typed (trimmed, no trailing slash) when it is one git can clone over SSH; null for anything else. */
export function sshUrlDe(text: string): string | null {
  const t = text.trim().replace(/\/+$/, "");
  if (t.length > 300) return null;
  const m = SCP.exec(t) ?? SSH_URL.exec(t);
  if (!m) return null;
  if (m.at(-1)!.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  return t;
}

/** The name the sheet suggests: the folder's last part, or the repository's name. Capped at NOMBRE_MAX. */
export function nombreSugerido(opcion: CodigoOpcion | null, valor: string): string {
  const t = valor.trim();
  if (!t || !opcion || opcion === "ninguno") return "";
  const base =
    opcion === "github" ? (githubRepoDe(t)?.split("/")[1] ?? "") : opcion === "ssh" ? (sshUrlDe(t)?.split(/[:/]/).at(-1) ?? "") : (t.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? "");
  return base.replace(/\.git$/i, "").slice(0, NOMBRE_MAX);
}

/** What the sheet sends besides name and goal. Sin código keeps the old shape; the other three name their way in. */
export type CodigoBody = { no_code: true } | { origen: "local"; repo_path: string; crear_rama?: boolean } | { origen: "nube" | "ssh"; repo: string; crear_rama?: boolean };

/** What the sheet sends for the choice, or null while the choice is missing or its field is not right yet. */
export function codigoBody(opcion: CodigoOpcion | null, carpeta: string, repo: string, ssh = ""): CodigoBody | null {
  if (opcion === "ninguno") return { no_code: true };
  if (opcion === "carpeta") return carpetaOk(carpeta) ? { origen: "local", repo_path: carpeta.trim() } : null;
  if (opcion === "github") {
    const r = githubRepoDe(repo);
    return r ? { origen: "nube", repo: r } : null;
  }
  if (opcion === "ssh") {
    const u = sshUrlDe(ssh);
    return u ? { origen: "ssh", repo: u } : null;
  }
  return null;
}

/** A goal is asked for a project with no code (it says what to build); with code it is optional. */
export const metaObligatoria = (opcion: CodigoOpcion | null): boolean => opcion === "ninguno";

/**
 * The sheet's refusal line for the four ways in. The working branch is offered, not blamed (the sheet shows
 * «Crear la rama y agregar»); the clone's steps say what Despliegue says (PLA-132); SSH says which of its failures.
 */
export function agregarError(code: string | null, detail: Record<string, unknown> = {}, language: Language = getLanguage()): string {
  const w = words(NUEVO_PROYECTO_WORDS, language);
  if (code === "REPO_NO_START_BRANCH") return w.agregar.sinRama;
  if (code === "HTTP_404" || code === "HTTP_405") return w.agregar.servidorViejo;
  if (code === "INVALID_BODY" && detail.field === "repo") return detail.origen === "ssh" ? w.agregar.sshMal : w.agregar.repoMal;
  if (code && detail.field === "ssh" && Object.hasOwn(w.agregar.ssh, code)) return w.agregar.ssh[code]!;
  const setup = words(PREPARAR_CODIGO_WORDS, language).why;
  if (code && detail.field === "setup" && Object.hasOwn(setup, code)) return `${w.lead.create}. ${setup[code]!}`;
  return nuevoProyectoError(code, detail, language);
}
