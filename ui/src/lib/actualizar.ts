// PLA-I2-8: the words for an update and what it kept of the owner's own kit. The update command prints them
// (src/update/), and the screen shows the last update's report on Novedades and a hint in Plomería.
// Plain Spanish, no ticket keys, no branch names.

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

export function kitFileLine(k: KitKeptFile): string {
  if (k.kind === "added") return `Tu archivo ${k.file} se quedó como estaba.`;
  if (k.kind === "edited") return `Tu cambio en ${k.file} se quedó; esta versión no traía cambios para ese archivo.`;
  const beside = k.file.replace(/^kit\//, "kit.new/");
  return `Tu cambio en ${k.file} se quedó, y esta versión también lo cambió: la nueva está en ${beside}. Compáralas y copia lo que quieras.`;
}

export function kitRoleLine(r: KitHeldRole): string {
  return `Editaste en Plania el texto de «${r.title}» y se quedó el tuyo. La versión nueva está en kit/roles/${r.role}.md: si la quieres, cópiala a mano o corre pnpm kit:sync --force (reemplaza la tuya).`;
}

export function reportLines(r: Pick<UpdateReport, "kit_files" | "kit_roles">): string[] {
  return [...r.kit_files.map(kitFileLine), ...r.kit_roles.map(kitRoleLine)];
}

// How many things wait on the owner after the last update: only the ones where the release changed something too.
export const pendingKit = (r: Pick<UpdateReport, "kit_files" | "kit_roles"> | null): number =>
  r ? r.kit_files.filter((k) => k.kind === "both").length + r.kit_roles.length : 0;

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const dayOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
};

export const ACTUALIZAR = {
  title: "La última actualización",
  headline: (r: Pick<UpdateReport, "from" | "to" | "at">) => `De la versión ${r.from} a la ${r.to}, el ${dayOf(r.at)}.`,
  nothingKept: "No había cambios tuyos en los textos de los roles ni en las habilidades.",
  backup: (file: string) => `El respaldo de antes de actualizar quedó en ${file}.`,
  hint: (n: number) => (n === 1 ? "1 cambio tuyo para revisar tras la actualización" : `${n} cambios tuyos para revisar tras la actualización`),
} as const;

// The command's own sentences, one per step.
export const PASOS = {
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
} as const;
