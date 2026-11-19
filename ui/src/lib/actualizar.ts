// PLA-I2-8: the words for an update and what it kept of the owner's own kit. The update command prints them
// (src/update/), and the screen shows the last update's report on Novedades and a hint in Plomería.
// Plain Spanish, no ticket keys, no branch names.
// PLA-I2-10: in both languages (lib/i18n.ts). Pure: no "@/" imports, the server and node tests import this file.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";
import { FALLBACK_LOCALES, LOCALE } from "./locale.js";

// A kit file the owner changed and the update kept. `both`: the release changed it too; its version is in kit.new/.
export type KitKeptFile = { file: string; kind: "edited" | "both" | "added" };

// A role prompt edited in Plania (the live copy) that the update left alone: the release's version is in kit/roles/.
export type KitHeldRole = { role: string; title: string; state: "doc_newer" | "both_changed" };

export type UpdateReport = {
  from: string;
  to: string;
  at: string;
  backup: string;
  kit_files: KitKeptFile[];
  kit_roles: KitHeldRole[];
};

export const KIT_WORDS = defineWords({
  es: {
    added: (file: string) => `Tu archivo ${file} se quedó como estaba.`,
    edited: (file: string) => `Tu cambio en ${file} se quedó; esta versión no traía cambios para ese archivo.`,
    both: (file: string, beside: string) => `Tu cambio en ${file} se quedó, y esta versión también lo cambió: la nueva está en ${beside}. Compáralas y copia lo que quieras.`,
    role: (title: string, role: string) =>
      `Editaste en Plania el texto de «${title}» y se quedó el tuyo. La versión nueva está en kit/roles/${role}.md: si la quieres, cópiala a mano o corre pnpm kit:sync --force (reemplaza la tuya).`,
  },
  en: {
    added: (file: string) => `Your file ${file} was left as it was.`,
    edited: (file: string) => `Your change to ${file} was kept; this version brought no changes to that file.`,
    both: (file: string, beside: string) => `Your change to ${file} was kept, and this version changed it too: the new one is in ${beside}. Compare them and copy what you want.`,
    role: (title: string, role: string) =>
      `You edited the text of «${title}» in Plania and yours was kept. The new version is in kit/roles/${role}.md: if you want it, copy it by hand or run pnpm kit:sync --force (it replaces yours).`,
  },
});

export function kitFileLine(k: KitKeptFile, language: Language = getLanguage()): string {
  const w = words(KIT_WORDS, language);
  if (k.kind === "added") return w.added(k.file);
  if (k.kind === "edited") return w.edited(k.file);
  const beside = k.file.replace(/^kit\//, "kit.new/");
  return w.both(k.file, beside);
}

export function kitRoleLine(r: KitHeldRole, language: Language = getLanguage()): string {
  return words(KIT_WORDS, language).role(r.title, r.role);
}

export function reportLines(r: Pick<UpdateReport, "kit_files" | "kit_roles">, language: Language = getLanguage()): string[] {
  return [...r.kit_files.map((k) => kitFileLine(k, language)), ...r.kit_roles.map((x) => kitRoleLine(x, language))];
}

// How many things wait on the owner after the last update: only the ones where the release changed something too.
export const pendingKit = (r: Pick<UpdateReport, "kit_files" | "kit_roles"> | null): number =>
  r ? r.kit_files.filter((k) => k.kind === "both").length + r.kit_roles.length : 0;

// PLA-I2-10: the day in the page's locale («18 de noviembre», «November 18»), or the language's fallback when the
// words asked for are not the page's; UTC, as before.
const dayIn = (iso: string, language: Language) => {
  const d = new Date(iso);
  const locale = language === getLanguage() ? LOCALE : FALLBACK_LOCALES[language];
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(d);
};

export const ACTUALIZAR = defineWords({
  es: {
    title: "La última actualización",
    headline: (r: Pick<UpdateReport, "from" | "to" | "at">) => `De la versión ${r.from} a la ${r.to}, el ${dayIn(r.at, "es")}.`,
    nothingKept: "No había cambios tuyos en los textos de los roles ni en las habilidades.",
    backup: (file: string) => `El respaldo de antes de actualizar quedó en ${file}.`,
    hint: (n: number) => (n === 1 ? "1 cambio tuyo para revisar tras la actualización" : `${n} cambios tuyos para revisar tras la actualización`),
  },
  en: {
    title: "The last update",
    headline: (r: Pick<UpdateReport, "from" | "to" | "at">) => `From version ${r.from} to ${r.to}, on ${dayIn(r.at, "en")}.`,
    nothingKept: "You had no changes in the roles' texts or in the skills.",
    backup: (file: string) => `The backup from before the update is in ${file}.`,
    hint: (n: number) => (n === 1 ? "1 change of yours to review after the update" : `${n} changes of yours to review after the update`),
  },
});

// The command's own sentences, one per step.
export const STEPS = defineWords({
  es: {
    checking: "Reviso que no haya trabajo en curso.",
    inFlight: (what: string[]) =>
      `No se actualizó: hay trabajo en curso (${what.join("; ")}). Espera a que termine y vuelve a correr la actualización.`,
    notPackage: "Esta copia de Plania no se instaló desde un paquete, así que no se actualiza con este comando.",
    unpacking: (file: string) => `Abro el paquete ${file}.`,
    badPackage: (why: string) => `No se actualizó: el paquete no sirve (${why}). Nada cambió.`,
    notNewer: (current: string, next: string) => `No se actualizó: el paquete es la versión ${next} y ya tienes la ${current}. Nada cambió.`,
    newer: (current: string, next: string) => `Vas de la versión ${current} a la ${next}.`,
    deps: "Instalo lo que la versión nueva necesita.",
    depsFailed: (why: string) => `No se actualizó: no se pudo instalar lo que la versión nueva necesita (${why}). Nada cambió.`,
    backingUp: "Respaldo la base de datos.",
    backupFailed: (why: string) => `No se actualizó: el respaldo falló (${why}). Nada cambió.`,
    backedUp: (file: string) => `Respaldo listo: ${file}.`,
    noFreshBackup: "No se actualizó: no hay un respaldo de hoy, y sin él no se toca la base. Nada cambió.",
    stopping: "Apago Plania.",
    noService: "Plania no corre como servicio aquí: apágala tú y vuelve a correr la actualización con --no-service.",
    swapping: "Cambio los archivos del programa; tus ajustes y tus cambios al kit se quedan.",
    migrating: "Actualizo la base de datos.",
    migrated: (n: number) => (n === 0 ? "La base ya estaba al día." : n === 1 ? "Se aplicó 1 cambio a la base." : `Se aplicaron ${n} cambios a la base.`),
    starting: "Enciendo Plania.",
    manualStart: "Enciende Plania con pnpm start.",
    done: (version: string, port: number) => `Listo: Plania está en la versión ${version}. Lo nuevo: http://localhost:${port}/novedades`,
    failedAfterStop: (why: string, from: string, backup: string) =>
      `No se actualizó: ${why}. Plania sigue en la versión ${from} y la base quedó como estaba. El respaldo de antes está en ${backup}; si algún día lo necesitas: pnpm restore:plania ${backup} --database <nombre>.`,
    startFailed: (why: string, previous: string) =>
      `La versión nueva quedó instalada pero no encendió (${why}). Revisa el registro de Plania; la versión anterior está en ${previous}.`,
  },
  en: {
    checking: "Checking that no work is in progress.",
    inFlight: (what: string[]) => `Not updated: there is work in progress (${what.join("; ")}). Wait for it to finish and run the update again.`,
    notPackage: "This copy of Plania was not installed from a package, so this command does not update it.",
    unpacking: (file: string) => `Opening the package ${file}.`,
    badPackage: (why: string) => `Not updated: the package is not usable (${why}). Nothing changed.`,
    notNewer: (current: string, next: string) => `Not updated: the package is version ${next} and you already have ${current}. Nothing changed.`,
    newer: (current: string, next: string) => `Going from version ${current} to ${next}.`,
    deps: "Installing what the new version needs.",
    depsFailed: (why: string) => `Not updated: what the new version needs could not be installed (${why}). Nothing changed.`,
    backingUp: "Backing up the database.",
    backupFailed: (why: string) => `Not updated: the backup failed (${why}). Nothing changed.`,
    backedUp: (file: string) => `Backup ready: ${file}.`,
    noFreshBackup: "Not updated: there is no backup from today, and without one the database is not touched. Nothing changed.",
    stopping: "Stopping Plania.",
    noService: "Plania does not run as a service here: stop it yourself and run the update again with --no-service.",
    swapping: "Replacing the program's files; your settings and your kit changes stay.",
    migrating: "Updating the database.",
    migrated: (n: number) => (n === 0 ? "The database was already up to date." : n === 1 ? "1 change was applied to the database." : `${n} changes were applied to the database.`),
    starting: "Starting Plania.",
    manualStart: "Start Plania with pnpm start.",
    done: (version: string, port: number) => `Done: Plania is on version ${version}. What's new: http://localhost:${port}/novedades`,
    failedAfterStop: (why: string, from: string, backup: string) =>
      `Not updated: ${why}. Plania is still on version ${from} and the database is as it was. The backup from before is in ${backup}; if you ever need it: pnpm restore:plania ${backup} --database <name>.`,
    startFailed: (why: string, previous: string) =>
      `The new version is installed but did not start (${why}). Check Plania's log; the previous version is in ${previous}.`,
  },
});

/** The update command's sentences (src/update/, scripts/update.ts): the server's words are Spanish. */
export const PASOS = words(STEPS, "es");
