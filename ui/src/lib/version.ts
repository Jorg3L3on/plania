// PLA-I2-17: the words for which release of Plania this is (GET /api/release): the small line in Plomería and the
// Novedades page, which shows the release notes (CHANGELOG.md, written by the owner). No commit or branch names.

export type ReleaseReading = {
  version: string;
  commit: string | null;
  built_at: string | null;
  // true when the server runs from a release package, false in a working copy of the code.
  packaged: boolean;
  notes: string;
};

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function builtOn(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

/** «Versión 0.2.0, armada el 18 de noviembre de 2026» for a release; a working copy says so. */
export function versionLine(r: Pick<ReleaseReading, "version" | "built_at" | "packaged">): string {
  if (!r.packaged) return `Versión ${r.version}, copia de trabajo`;
  const on = builtOn(r.built_at);
  return on ? `Versión ${r.version}, armada el ${on}` : `Versión ${r.version}`;
}

export const NOVEDADES = {
  link: "Novedades",
  kicker: "Esta versión",
  title: "Novedades",
  empty: "Esta versión no trae notas.",
  error: "No se pudieron leer las novedades.",
} as const;
