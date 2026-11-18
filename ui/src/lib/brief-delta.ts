// PLA-I63: the Morning brief as Compañía's delta (PLA-IDEA26, sketch 2 «la desembocadura»). Pure, so the tests call
// it directly. This file holds the words of the page (the date line and the headline that rewrites itself); the
// delta's model (streams, lights, the dam, Tú and the river of Resuelto) is added in I63-2.

const NUM = ["cero", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuna", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve", "treinta"];
/** A count in words up to thirty, then digits (feminine: «una cosa», «una bloquea»). */
export const numWord = (n: number): string => NUM[n] ?? String(n);
export const cap = (s: string): string => (s ? s.charAt(0).toLocaleUpperCase("es-MX") + s.slice(1) : s);

/** «mar 17 nov» for an instant (in the brief's zone) or a local date «2026-11-16». */
export function dayShort(when: string | number, timeZone?: string): string {
  const isDate = typeof when === "string" && /^\d{4}-\d{2}-\d{2}$/.test(when);
  const d = isDate ? new Date(`${when}T12:00:00Z`) : new Date(when);
  try {
    return new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: isDate ? "UTC" : timeZone })
      .formatToParts(d)
      .filter((p) => p.type !== "literal")
      .map((p) => p.value.replace(".", "").toLocaleLowerCase("es-MX"))
      .join(" ");
  } catch {
    return typeof when === "string" ? when.slice(0, 10) : "";
  }
}

/** «07:00» for an instant in the brief's zone. */
export function hhmm(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

export type KickInput =
  | { kind: "today"; generatedAt: string; timeZone?: string }
  | { kind: "past"; localDate: string }
  | { kind: "generating"; minutes: number; waitingBuild?: boolean; generatedAt: string | null; timeZone?: string }
  | { kind: "none"; now: number; timeZone?: string };

/** The date line over the headline. */
export function kickOf(k: KickInput): string {
  switch (k.kind) {
    case "today":
      return `Brief · ${dayShort(k.generatedAt, k.timeZone)} · generado ${hhmm(k.generatedAt, k.timeZone)}`;
    case "past":
      return `Brief del ${dayShort(k.localDate)} · solo lectura`;
    case "generating": {
      const what = k.waitingBuild ? "Esperando la construcción en curso" : `Generando… ${Math.max(1, k.minutes)} min`;
      return k.generatedAt ? `${what} · sigues viendo el de las ${hhmm(k.generatedAt, k.timeZone)}` : what;
    }
    case "none":
      return `Brief · ${dayShort(k.now, k.timeZone)}`;
  }
}

/** a: the second line is amber (something waits on Jorge); q: it is quiet grey. */
export type Headline = { l1: string; l2: string; tone: "a" | "q" };
export type HeadCounts = { total: number; open: number; blocked: number; needs: number };

/** The headline: one sentence for the morning that rewrites itself as things are settled. */
export function headlineOf(c: HeadCounts, runAt = "07:00"): Headline {
  if (c.total > 0 && c.open === 0) return { l1: "Todo resuelto por hoy.", l2: `El brief de mañana llega a las ${runAt}.`, tone: "q" };
  if (c.total === 0) return { l1: "Nada en el brief de hoy.", l2: `El de mañana llega a las ${runAt}.`, tone: "q" };
  const done = c.total - c.open;
  const l1 = done ? `Quedan ${numWord(c.open)} de ${numWord(c.total)}.` : `${cap(numWord(c.total))} ${c.total === 1 ? "cosa" : "cosas"} esta mañana.`;
  const b = c.blocked ? `${cap(numWord(c.blocked))} bloquea${c.blocked > 1 ? "n" : ""}` : "";
  const n = c.needs ? `${numWord(c.needs)} te espera${c.needs > 1 ? "n" : ""}` : "";
  if (b && n) return { l1, l2: `${b} y ${n}.`, tone: "a" };
  if (b) return { l1, l2: `${b}.`, tone: "a" };
  if (n) return { l1, l2: `${cap(n)}.`, tone: "a" };
  return { l1, l2: "Nada te espera: lo demás puede seguir solo.", tone: "q" };
}

/** The headline when no brief is on screen. */
export function noBriefHeadline(kind: "empty" | "off" | "failed" | "loading", runAt = "07:00"): Headline {
  switch (kind) {
    case "empty":
      return { l1: "Aún no hay brief.", l2: `Corre a las ${runAt}, o genéralo ahora.`, tone: "q" };
    case "off":
      return { l1: "El brief está apagado.", l2: "Enciéndelo en Ajustes.", tone: "q" };
    case "failed":
      return { l1: "No se pudo leer el brief.", l2: "Si la Mac está dormida, intenta al despertar.", tone: "q" };
    case "loading":
      return { l1: "Leyendo el brief…", l2: "", tone: "q" };
  }
}

/** One earlier day in «Días anteriores»: «lun 16 nov» and «3 te tocaban · 4 ideas». */
export function dayLine(row: { local_date: string; needs: number; ideas: number }): { day: string; line: string } {
  const toca = row.needs === 1 ? "1 te tocaba" : `${row.needs} te tocaban`;
  const ideas = row.ideas === 1 ? "1 idea" : `${row.ideas} ideas`;
  return { day: cap(dayShort(row.local_date)), line: `${toca} · ${ideas}` };
}
