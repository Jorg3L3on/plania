// NEWPROJ-5: a run that could not start, in the owner's words. Every start-up failure the runner writes
// (src/runner/start-failures.ts START_FAILURES, "fail: <reason>") has what happened and what to fix.
// test/newproj5-start-failures.test.ts checks that every one of them is worded here.
// Pure: Calidad, Plomería and the project page's rows read it.

export type ArranqueWords = { /** What happened, as a sentence. */ por: string; /** What fixes it. */ arregla: string };

export const ARRANQUE: Record<string, ArranqueWords> = {
  "missing env PLANIA_RUNNER_TOKEN": {
    por: "El servidor no tiene la llave con la que el equipo entra a Plania",
    arregla: "Pon PLANIA_RUNNER_TOKEN en el archivo .env de Plania y reinicia el servidor.",
  },
  "no prompt doc": {
    por: "Faltan las instrucciones de este puesto",
    arregla: "Carga las instrucciones de los puestos en Plania y vuelve a intentarlo.",
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
    arregla: "Revisa que el repositorio tenga su rama de prueba y que la Mac pueda conectarse a GitHub.",
  },
  "worktree add": {
    por: "No pudo crear la carpeta de trabajo",
    arregla: "Revisa el repositorio en la Mac (espacio en disco, carpetas que ya existen) y vuelve a intentarlo.",
  },
  "read copy checkout": {
    por: "No pudo poner al día la copia de lectura",
    arregla: "Revisa el repositorio en la Mac y vuelve a intentarlo.",
  },
  "start lost": {
    por: "Se perdió al arrancar",
    arregla: "Plania se reinició mientras arrancaba: vuelve a intentarlo.",
  },
  start: {
    por: "Algo falló mientras preparaba la corrida",
    arregla: "Vuelve a intentarlo; si se repite, míralo en Máquinas.",
  },
};

// "fail: no prompt doc (Prompt: QA)" → "no prompt doc". Null when the summary is not a failure.
export const failReason = (summary: string): string | null => {
  const m = /^fail:\s*(.*)$/i.exec(summary.trim());
  return m ? m[1]!.split("(")[0]!.trim() : null;
};

/** The words for a run summary that is a start-up failure, else null. */
export function arranqueOf(summary: string | null | undefined): ArranqueWords | null {
  const r = summary ? failReason(summary) : null;
  return r ? (ARRANQUE[r] ?? null) : null;
}

/** One line for a row: «No pudo arrancar: <por>. <arregla>» */
export function arranqueLine(summary: string | null | undefined): string | null {
  const w = arranqueOf(summary);
  return w ? `No pudo arrancar: ${w.por.charAt(0).toLowerCase()}${w.por.slice(1)}. ${w.arregla}` : null;
}
