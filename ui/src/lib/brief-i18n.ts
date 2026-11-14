// PLA-I42-4: every label of the /brief page and its settings sheet, in English and Spanish (D5: the page follows the
// brief's language; the nav tab stays "Brief"; the rest of Plania stays Spanish). Components never hard-code a label:
// they read BRIEF_LABELS[language]. Weekdays and months come from Intl.DateTimeFormat(language); counts use the
// plural functions below.
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
  s: SettingsLabels;
};

/** The settings sheet (spec §8 "Settings sheet") and its Setup check. */
export type SettingsLabels = {
  title: string;
  description: string;
  close: string;
  general: string;
  enabled: string;
  enabledHint: string;
  runAt: string;
  fallbackAt: string;
  fallbackHint: string;
  timezone: string;
  timezoneHint: (resolved: string) => string;
  timezoneLabel: string;
  language: string;
  languages: { en: string; es: string };
  ownerName: string;
  ownerHint: (resolved: string) => string;
  content: string;
  hiddenRefs: string;
  hiddenRefsHint: string;
  addRef: string;
  removeRef: (ref: string) => string;
  maxItems: string;
  ideasPerProject: string;
  ideasEnabled: string;
  model: string;
  modelHint: string;
  projects: string;
  projectsHint: string;
  include: (name: string) => string;
  includeIdeas: (name: string) => string;
  inBrief: string;
  ideasOn: string;
  letter: string;
  order: string;
  editPersona: string;
  hidePersona: string;
  persona: (name: string) => string;
  personaHint: string;
  personaNone: string;
  savePersona: string;
  personaSaved: string;
  personaStale: string;
  save: string;
  saving: string;
  saved: string;
  saveFailed: string;
  cancel: string;
  loading: string;
  setup: string;
  setupHint: string;
  setupOk: string;
  setupBad: string;
  setupFailed: string;
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
  s: {
    title: "Brief settings",
    description: "The morning brief for every project. Changes apply to the next brief.",
    close: "Close",
    general: "Schedule",
    enabled: "Morning brief on",
    enabledHint: "Off means no scheduled run. Generate now still works.",
    runAt: "Run time",
    fallbackAt: "Fallback time",
    fallbackHint: "If the full brief hasn't started by then, a facts-only brief is stored.",
    timezone: "Time zone",
    timezoneHint: (r) => `Blank uses the server zone (now ${r}).`,
    timezoneLabel: "Zone label",
    language: "Language",
    languages: { en: "English", es: "Spanish" },
    ownerName: "Owner name",
    ownerHint: (r) => `Blank uses the server default (now “${r}”).`,
    content: "Content",
    hiddenRefs: "Hidden refs",
    hiddenRefsHint: "Items and ideas that mention one of these are left out.",
    addRef: "Add",
    removeRef: (r) => `Remove ${r}`,
    maxItems: "Max items per app",
    ideasPerProject: "Ideas per project",
    ideasEnabled: "Ideas on",
    model: "Model",
    modelHint: "Blank uses Claude's default.",
    projects: "Projects",
    projectsHint: "Include, ideas, idea letter and order for each project.",
    include: (n) => `Include ${n} in the brief`,
    includeIdeas: (n) => `Ideas for ${n}`,
    inBrief: "In brief",
    ideasOn: "Ideas",
    letter: "Letter",
    order: "Order",
    editPersona: "Edit persona",
    hidePersona: "Close persona",
    persona: (n) => `Idea persona for ${n}`,
    personaHint: "Who suggests this project's ideas. Saved as the project doc “Idea persona”.",
    personaNone: "No persona yet.",
    savePersona: "Save persona",
    personaSaved: "Persona saved",
    personaStale: "Someone changed it meanwhile. Reopen it and try again.",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    saveFailed: "Couldn't save. Check the fields.",
    cancel: "Cancel",
    loading: "Loading…",
    setup: "Setup check",
    setupHint: "Read-only. The Claude login check runs only in pnpm brief:doctor.",
    setupOk: "OK",
    setupBad: "Needs attention",
    setupFailed: "Couldn't run the setup check.",
  },
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
  s: {
    title: "Ajustes del brief",
    description: "El brief de la mañana para todos los proyectos. Los cambios valen para el siguiente brief.",
    close: "Cerrar",
    general: "Horario",
    enabled: "Brief de la mañana encendido",
    enabledHint: "Apagado no hay corrida programada. Generar ahora sigue funcionando.",
    runAt: "Hora de corrida",
    fallbackAt: "Hora límite",
    fallbackHint: "Si el brief completo no ha empezado a esa hora, se guarda uno solo con datos.",
    timezone: "Zona horaria",
    timezoneHint: (r) => `Vacío usa la zona del servidor (ahora ${r}).`,
    timezoneLabel: "Etiqueta de zona",
    language: "Idioma",
    languages: { en: "Inglés", es: "Español" },
    ownerName: "Nombre del dueño",
    ownerHint: (r) => `Vacío usa el valor del servidor (ahora “${r}”).`,
    content: "Contenido",
    hiddenRefs: "Refs ocultas",
    hiddenRefsHint: "Se omiten los pendientes e ideas que mencionen alguna.",
    addRef: "Agregar",
    removeRef: (r) => `Quitar ${r}`,
    maxItems: "Máximo de pendientes por app",
    ideasPerProject: "Ideas por proyecto",
    ideasEnabled: "Ideas encendidas",
    model: "Modelo",
    modelHint: "Vacío usa el modelo por defecto de Claude.",
    projects: "Proyectos",
    projectsHint: "Incluir, ideas, letra de idea y orden de cada proyecto.",
    include: (n) => `Incluir ${n} en el brief`,
    includeIdeas: (n) => `Ideas para ${n}`,
    inBrief: "En el brief",
    ideasOn: "Ideas",
    letter: "Letra",
    order: "Orden",
    editPersona: "Editar persona",
    hidePersona: "Cerrar persona",
    persona: (n) => `Persona de ideas de ${n}`,
    personaHint: "Quién propone las ideas de este proyecto. Se guarda como el doc del proyecto “Idea persona”.",
    personaNone: "Aún no hay persona.",
    savePersona: "Guardar persona",
    personaSaved: "Persona guardada",
    personaStale: "Alguien la cambió mientras tanto. Ábrela de nuevo e inténtalo otra vez.",
    save: "Guardar",
    saving: "Guardando…",
    saved: "Guardado",
    saveFailed: "No se pudo guardar. Revisa los campos.",
    cancel: "Cancelar",
    loading: "Cargando…",
    setup: "Revisión de instalación",
    setupHint: "Solo lectura. La revisión del login de Claude corre solo en pnpm brief:doctor.",
    setupOk: "Bien",
    setupBad: "Requiere atención",
    setupFailed: "No se pudo correr la revisión de instalación.",
  },
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
