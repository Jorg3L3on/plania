// NEWPROJ-5: a run that could not start, in the owner's words. Every start-up failure the runner writes
// (src/runner/start-failures.ts START_FAILURES, "fail: <reason>") has what happened and what to fix.
// test/newproj5-start-failures.test.ts checks that every one of them is worded here.
// Pure: Calidad, Plomería and the project page's rows read it.
// PLA-I2-10: the words are in ARRANQUE_WORDS, in both languages; ARRANQUE stays the Spanish ones (tests and the
// server read it), and each function takes the language last. The server (src/api/guia.ts) reads the default.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type ArranqueWords = { /** What happened, as a sentence. */ por: string; /** What fixes it. */ arregla: string };

export const ARRANQUE_WORDS = defineWords({
  es: {
    fallos: {
      "missing env PLANIA_RUNNER_TOKEN": {
        por: "El servidor no tiene la llave con la que el equipo entra a Plania",
        // PLA-I2-6: the token is made at first start (PLA-I2-2); nothing is pasted.
        arregla: "La llave se crea al terminar el primer arranque de Plania. Si ya lo terminaste, reinicia Plania.",
      },
      "no prompt doc": {
        por: "Faltan las instrucciones de este puesto",
        arregla: "Carga las instrucciones de los puestos en Plania y vuelve a intentarlo.",
      },
      // PLA-158 (F-31)
      "no taller database": {
        por: "No pudo preparar la copia de la base con la que trabaja el constructor",
        arregla: "Revisa que la base de la app sea local y esté encendida (Máquinas) y vuelve a intentarlo. El constructor nunca trabaja sobre la base de la app.",
      },
      "base not allowed": {
        por: "La rama de origen no está permitida",
        arregla: "El paso tiene que partir de la copia de prueba, no de la versión publicada: cámbialo en el paso.",
      },
      "bad worktree name": {
        por: "El nombre de la carpeta de trabajo no es válido",
        arregla: "Revisa la clave del proyecto y del paso.",
      },
      "worktree inside the repo": {
        por: "La carpeta de trabajo quedaría dentro del repositorio",
        arregla: "Cambia PLANIA_WORKTREES_ROOT a una carpeta fuera del repositorio.",
      },
      "no repo": {
        por: "No encontró el repositorio",
        arregla: "Revisa en Máquinas la carpeta del repositorio del proyecto.",
      },
      "worktree unreadable": {
        por: "No pudo leer la carpeta de trabajo del paso",
        arregla: "Borra la carpeta de trabajo de este paso y vuelve a intentarlo.",
      },
      "fetch origin/sandbox": {
        por: "No pudo traer la copia de prueba desde GitHub",
        arregla: "Revisa que el repositorio tenga su rama de prueba y que la máquina pueda conectarse a GitHub.",
      },
      "worktree add": {
        por: "No pudo crear la carpeta de trabajo",
        arregla: "Revisa el repositorio en la máquina (espacio en disco, carpetas que ya existen) y vuelve a intentarlo.",
      },
      "read copy checkout": {
        por: "No pudo poner al día la copia de lectura",
        arregla: "Revisa el repositorio en la máquina y vuelve a intentarlo.",
      },
      "start lost": {
        por: "Se perdió al arrancar",
        arregla: "Plania se reinició mientras arrancaba: vuelve a intentarlo.",
      },
      "no such trial": {
        por: "La prueba ya no existe",
        arregla: "Se borró antes de arrancar: vuelve a pulsar «Probar» en la habilidad.",
      },
      "trial base": {
        por: "No se encontró la entrega para la prueba",
        arregla: "La entrega ya no tiene su commit: elige otra entrega para probar.",
      },
      "trial copy": {
        por: "No se pudo hacer la copia para la prueba",
        arregla: "Git no pudo preparar la copia aparte: revisa el repo del proyecto y vuelve a probar.",
      },
      start: {
        por: "Algo falló mientras preparaba la corrida",
        arregla: "Vuelve a intentarlo; si se repite, míralo en Máquinas.",
      },
      // PLA-I2-16: not a start failure (the process ran), but the owner must act the same way: Claude has no session here.
      "signed out": {
        por: "Claude no tiene la sesión iniciada en esta máquina",
        arregla: "En una terminal corre claude y entra con tu cuenta (/login); luego vuelve a intentarlo.",
      },
    } as Record<string, ArranqueWords>,
    line: (por: string, arregla: string) => `No pudo arrancar: ${por}. ${arregla}`,
  },
  en: {
    fallos: {
      "missing env PLANIA_RUNNER_TOKEN": {
        por: "The server doesn't have the key the team uses to get into Plania",
        arregla: "The key is made when Plania's first start is finished. If you already finished it, restart Plania.",
      },
      "no prompt doc": {
        por: "This seat's instructions are missing",
        arregla: "Load the seats' instructions into Plania and try again.",
      },
      "no taller database": {
        por: "Could not prepare the database copy the builder works on",
        arregla: "Check that the app's database is local and on (Machines), then try again. The builder never works on the app's own database.",
      },
      "base not allowed": {
        por: "The starting branch is not allowed",
        arregla: "The step has to start from the test copy, not from the published version: change it in the step.",
      },
      "bad worktree name": {
        por: "The working folder's name is not valid",
        arregla: "Check the project's key and the step's.",
      },
      "worktree inside the repo": {
        por: "The working folder would end up inside the repository",
        arregla: "Change PLANIA_WORKTREES_ROOT to a folder outside the repository.",
      },
      "no repo": {
        por: "It didn't find the repository",
        arregla: "Check the project's repository folder in Machines.",
      },
      "worktree unreadable": {
        por: "It couldn't read the step's working folder",
        arregla: "Delete this step's working folder and try again.",
      },
      "fetch origin/sandbox": {
        por: "It couldn't bring the test copy from GitHub",
        arregla: "Check that the repository has its test branch and that the machine can reach GitHub.",
      },
      "worktree add": {
        por: "It couldn't make the working folder",
        arregla: "Check the repository on the machine (disk space, folders that already exist) and try again.",
      },
      "read copy checkout": {
        por: "It couldn't bring the reading copy up to date",
        arregla: "Check the repository on the machine and try again.",
      },
      "start lost": {
        por: "It got lost while starting",
        arregla: "Plania restarted while it was starting: try again.",
      },
      "no such trial": {
        por: "The trial no longer exists",
        arregla: "It was removed before it started: press Try on the skill again.",
      },
      "trial base": {
        por: "The delivery for the trial was not found",
        arregla: "The delivery no longer has its commit: pick another delivery to try.",
      },
      "trial copy": {
        por: "The copy for the trial could not be made",
        arregla: "Git could not prepare the separate copy: check the project's repo and try again.",
      },
      start: {
        por: "Something failed while the run was being prepared",
        arregla: "Try again; if it happens again, look at it in Machines.",
      },
      "signed out": {
        por: "Claude is not signed in on this machine",
        arregla: "In a terminal run claude and sign in with your account (/login); then try again.",
      },
    },
    line: (por: string, arregla: string) => `Couldn't start: ${por}. ${arregla}`,
  },
});

export const ARRANQUE: Record<string, ArranqueWords> = ARRANQUE_WORDS.es.fallos;

/** The words for one start-up failure reason, in the screen's language (or the one given); null when it has none. */
export const arranqueReason = (reason: string, language: Language = getLanguage()): ArranqueWords | null => words(ARRANQUE_WORDS, language).fallos[reason] ?? null;

// "fail: no prompt doc (Prompt: QA)" → "no prompt doc". Null when the summary is not a failure.
export const failReason = (summary: string): string | null => {
  const m = /^fail:\s*(.*)$/i.exec(summary.trim());
  return m ? m[1]!.split("(")[0]!.trim() : null;
};

/** The words for a run summary that is a start-up failure, else null. */
export function arranqueOf(summary: string | null | undefined, language: Language = getLanguage()): ArranqueWords | null {
  const r = summary ? failReason(summary) : null;
  return r ? arranqueReason(r, language) : null;
}

/** One line for a row: «No pudo arrancar: <por>. <arregla>» */
export function arranqueLine(summary: string | null | undefined, language: Language = getLanguage()): string | null {
  const w = arranqueOf(summary, language);
  return w ? words(ARRANQUE_WORDS, language).line(`${w.por.charAt(0).toLowerCase()}${w.por.slice(1)}`, w.arregla) : null;
}
