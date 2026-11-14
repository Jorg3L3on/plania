// PLA-I42-2: the /brief page's labels in the brief's language (D5). A small local table for now;
// PLA-I42-4 moves it to ui/src/lib/brief-i18n.ts with the settings sheet labels and the flag captions.
import type { BriefLanguage } from "@/lib/brief";

type Plural = (n: number) => string;
export type BriefLabels = {
  kicker: string;
  title: string;
  generate: string;
  generating: string;
  generatingMin: (min: number) => string;
  waitingBuild: string;
  today: string;
  history: string;
  settings: string;
  settingsSoon: string;
  empty: (time: string) => string;
  off: string;
  failed: string;
  refreshFailed: string;
  pastDay: string;
  needLine: Plural;
  nothingNeeds: string;
  blockers: Plural;
  ready: Plural;
  ideas: Plural;
  checked: Plural;
  notChecked: string;
  all: string;
  allApps: string;
  view: string;
  appFilter: string;
  openPerApp: string;
  needsYou: string;
  upNext: string;
  noNeeds: string;
  noNext: string;
  blocker: string;
  open: string;
  check: (title: string) => string;
  generated: (stamp: string) => string;
  missing: string;
  ideasTitle: string;
  ideasHint: string;
  ideasCount: Plural;
  from: (source: string) => string;
  flags: { cost: string; outside_service: string; legal: string; repo_change: string; big: string; overlap: (ref: string) => string };
  hideIdea: (title: string) => string;
  selectIdea: (title: string) => string;
  noIdeas: string;
  sendBar: string;
  toPlania: Plural;
  reply: string;
  clear: string;
  copyReply: string;
  copied: string;
  copyFailed: string;
  sendToPlania: string;
};

const en: BriefLabels = {
  kicker: "Today",
  title: "Morning brief",
  generate: "Generate now",
  generating: "Generating…",
  generatingMin: (m) => `Generating… ${m} min`,
  waitingBuild: "Waiting for the current build",
  today: "Today",
  history: "Brief of",
  settings: "Settings",
  settingsSoon: "Settings (coming soon)",
  empty: (time) => `No brief yet. It runs at ${time}, or press Generate now.`,
  off: "Morning brief is off. Turn it on in settings.",
  failed: "Couldn't load the brief.",
  refreshFailed: "Couldn't refresh",
  pastDay: "A past brief, read-only.",
  needLine: (n) => (n === 1 ? "1 thing needs you" : `${n} things need you`),
  nothingNeeds: "Nothing needs you",
  blockers: (n) => (n === 1 ? "1 release blocker" : `${n} release blockers`),
  ready: (n) => `${n} ready to pick up`,
  ideas: (n) => (n === 1 ? "1 new idea" : `${n} new ideas`),
  checked: (n) => `${n} checked`,
  notChecked: "Not checked",
  all: "All",
  allApps: "All apps",
  view: "Show",
  appFilter: "Filter by app",
  openPerApp: "Open items per app",
  needsYou: "Needs you",
  upNext: "Up next",
  noNeeds: "Nothing needs you here.",
  noNext: "Nothing up next here.",
  blocker: "Blocker",
  open: "Open",
  check: (t) => `Done: ${t}`,
  generated: (s) => `Generated ${s}`,
  missing: "Some parts are missing. See Needs you.",
  ideasTitle: "Today's ideas",
  ideasHint: "Select ideas to send to Plania, or reply with their codes.",
  ideasCount: (n) => (n === 1 ? "1 idea" : `${n} ideas`),
  from: (s) => `from ${s}`,
  flags: { cost: "costs money", outside_service: "new outside service", legal: "legal review", repo_change: "repo change", big: "big", overlap: (r) => `overlaps ${r}` },
  hideIdea: (t) => `Hide: ${t}`,
  selectIdea: (t) => `Select: ${t}`,
  noIdeas: "No ideas here.",
  sendBar: "Selected ideas",
  toPlania: (n) => (n === 1 ? "1 idea → Plania" : `${n} ideas → Plania`),
  reply: "Reply",
  clear: "Clear",
  copyReply: "Copy reply",
  copied: "Copied",
  copyFailed: "Couldn't copy",
  sendToPlania: "Send to Plania",
};

const es: BriefLabels = {
  kicker: "Hoy",
  title: "Brief de la mañana",
  generate: "Generar ahora",
  generating: "Generando…",
  generatingMin: (m) => `Generando… ${m} min`,
  waitingBuild: "Esperando la construcción en curso",
  today: "Hoy",
  history: "Brief del",
  settings: "Ajustes",
  settingsSoon: "Ajustes (pronto)",
  empty: (time) => `Aún no hay brief. Corre a las ${time}, o pulsa Generar ahora.`,
  off: "El brief de la mañana está apagado. Enciéndelo en ajustes.",
  failed: "No se pudo cargar el brief.",
  refreshFailed: "No se pudo actualizar",
  pastDay: "Un brief pasado, solo lectura.",
  needLine: (n) => (n === 1 ? "1 cosa te necesita" : `${n} cosas te necesitan`),
  nothingNeeds: "Nada te necesita",
  blockers: (n) => (n === 1 ? "1 bloqueo de release" : `${n} bloqueos de release`),
  ready: (n) => (n === 1 ? "1 lista para tomar" : `${n} listas para tomar`),
  ideas: (n) => (n === 1 ? "1 idea nueva" : `${n} ideas nuevas`),
  checked: (n) => (n === 1 ? "1 marcada" : `${n} marcadas`),
  notChecked: "Sin marcar",
  all: "Todo",
  allApps: "Todas las apps",
  view: "Mostrar",
  appFilter: "Filtrar por app",
  openPerApp: "Pendientes por app",
  needsYou: "Te necesita",
  upNext: "Lo siguiente",
  noNeeds: "Aquí nada te necesita.",
  noNext: "Aquí no hay nada siguiente.",
  blocker: "Bloqueo",
  open: "Abrir",
  check: (t) => `Hecho: ${t}`,
  generated: (s) => `Generado ${s}`,
  missing: "Faltan algunas partes. Mira Te necesita.",
  ideasTitle: "Ideas de hoy",
  ideasHint: "Elige ideas para mandarlas a Plania, o responde con sus códigos.",
  ideasCount: (n) => (n === 1 ? "1 idea" : `${n} ideas`),
  from: (s) => `de ${s}`,
  flags: { cost: "cuesta dinero", outside_service: "servicio externo nuevo", legal: "revisión legal", repo_change: "cambio de repo", big: "grande", overlap: (r) => `se cruza con ${r}` },
  hideIdea: (t) => `Ocultar: ${t}`,
  selectIdea: (t) => `Elegir: ${t}`,
  noIdeas: "Aquí no hay ideas.",
  sendBar: "Ideas elegidas",
  toPlania: (n) => (n === 1 ? "1 idea → Plania" : `${n} ideas → Plania`),
  reply: "Respuesta",
  clear: "Limpiar",
  copyReply: "Copiar respuesta",
  copied: "Copiada",
  copyFailed: "No se pudo copiar",
  sendToPlania: "Mandar a Plania",
};

export const BRIEF_LABELS: Record<BriefLanguage, BriefLabels> = { en, es };

/** The header stamp, e.g. "Fri · Nov 13 · 07:04 CDMX", in the brief's zone and language. */
export function briefStamp(iso: string, timezone: string, label: string, language: BriefLanguage): string {
  const d = new Date(iso);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(language, { timeZone: timezone, ...o }).format(d);
  const time = part({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${part({ weekday: "short" })} · ${part({ month: "short", day: "numeric" })} · ${time} ${label}`;
}

/** A history entry's label from its local date, e.g. "Thu · Nov 12" (a calendar date, so read in UTC). */
export function dayLabel(localDate: string, language: BriefLanguage): string {
  const d = new Date(`${localDate}T12:00:00Z`);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(language, { timeZone: "UTC", ...o }).format(d);
  return `${part({ weekday: "short" })} · ${part({ month: "short", day: "numeric" })}`;
}
