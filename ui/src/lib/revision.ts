// PLA-I74-6: «Revisar proyecto», the pure part. What the check-up card in Máquinas says about the last pass, each
// step's name and time, and the warning next to «Constrúyelo» when the last pass is red or more than a day old.
// components/corriente/revision.tsx draws what these return; test/i74-revision.test.ts feeds them plain objects.
// Pure: no "@/" imports.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type StepId = "instalar" | "comprobar" | "build" | "base" | "arranque" | "foto" | "deploy" | "maquina";
export type StepState = "ok" | "fallo" | "aviso" | "omitido";
export type RevisionStep = { id: StepId; estado: StepState; ms: number; detalle: string | null; tail: string | null };
export type RevisionPass = { trigger: "setup" | "nightly" | "owner"; started_at: string; finished_at: string; ok: boolean; branch: string; commit: string | null; cold_start_ms: number | null; steps: RevisionStep[] };
export type RevisionRead = {
  last: RevisionPass | null;
  running: { trigger: string; started_at: string; step: StepId } | null;
  waits: { cold_start_ms: number | null; ready_ms: number; login_ms: number; form_ms: number; qa_start_ms: number };
  available: boolean;
};

export const STALE_MS = 24 * 60 * 60_000;
export const ORDER: StepId[] = ["instalar", "comprobar", "build", "base", "arranque", "foto", "deploy", "maquina"];

export const REVISION_UI = defineWords({
  es: {
    title: "Revisión del proyecto",
    button: "Revisar proyecto",
    running: (step: string) => `Revisando: ${step}…`,
    never: "Nunca se ha revisado. Revísalo antes de construir: se prueba de cero en una copia limpia.",
    ok: (ago: string) => `Todo bien ${ago}`,
    red: (n: number, ago: string) => `${n === 1 ? "1 paso falló" : `${n} pasos fallaron`} ${ago}`,
    old: (ago: string) => `La última revisión fue ${ago}: puede estar vieja`,
    unavailable: "No disponible en este sistema",
    started: "Revisión en marcha. Tarda unos minutos.",
    already: "Ya hay una revisión en marcha.",
    noDetail: "Sin detalle",
    coldStart: (s: number) => `Arranque en frío: ${s} s. Las esperas de las fotos se ajustan a eso.`,
    steps: {
      instalar: "Instalar",
      comprobar: "Comprobar",
      build: "Build",
      base: "Base",
      arranque: "Arranque",
      foto: "Entrar y foto",
      deploy: "Último despliegue",
      maquina: "Esta Mac",
    } as Record<StepId, string>,
    state: { ok: "bien", fallo: "falló", aviso: "aviso", omitido: "no se hizo" } as Record<StepState, string>,
    // Next to «Constrúyelo».
    warnRed: (step: string) => `Ojo: la última revisión del proyecto falló en «${step}». Se puede construir, pero lo más probable es que se trabe.`,
    warnOld: (ago: string) => `Ojo: la última revisión del proyecto fue ${ago}. Revísalo en Máquinas antes de construir.`,
    warnNever: "Ojo: este proyecto nunca se ha revisado. Revísalo en Máquinas antes de construir.",
    ago: {
      now: "hace un momento",
      minutes: (n: number) => `hace ${n} min`,
      hours: (n: number) => `hace ${n} h`,
      days: (n: number) => (n === 1 ? "hace un día" : `hace ${n} días`),
    },
  },
  en: {
    title: "Project check-up",
    button: "Check the project",
    running: (step: string) => `Checking: ${step}…`,
    never: "Never checked. Check it before building: it is tried from scratch on a clean copy.",
    ok: (ago: string) => `All good ${ago}`,
    red: (n: number, ago: string) => `${n === 1 ? "1 step failed" : `${n} steps failed`} ${ago}`,
    old: (ago: string) => `The last check-up was ${ago}: it may be stale`,
    unavailable: "Not available on this system",
    started: "Check-up started. It takes a few minutes.",
    already: "A check-up is already running.",
    noDetail: "No detail",
    coldStart: (s: number) => `Cold start: ${s} s. The pictures' waits follow it.`,
    steps: {
      instalar: "Install",
      comprobar: "Checks",
      build: "Build",
      base: "Database",
      arranque: "Start",
      foto: "Sign in and photo",
      deploy: "Last deploy",
      maquina: "This Mac",
    },
    state: { ok: "fine", fallo: "failed", aviso: "warning", omitido: "not done" },
    warnRed: (step: string) => `Careful: the project's last check-up failed at «${step}». You can build, but it will most likely get stuck.`,
    warnOld: (ago: string) => `Careful: the project's last check-up was ${ago}. Check it in Máquinas before building.`,
    warnNever: "Careful: this project has never been checked. Check it in Máquinas before building.",
    ago: {
      now: "a moment ago",
      minutes: (n: number) => `${n} min ago`,
      hours: (n: number) => `${n} h ago`,
      days: (n: number) => (n === 1 ? "a day ago" : `${n} days ago`),
    },
  },
});

const w = (language?: Language) => words(REVISION_UI, language ?? getLanguage());

export function agoText(iso: string, now: number, language?: Language): string {
  const a = w(language).ago;
  const mins = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (mins < 2) return a.now;
  if (mins < 60) return a.minutes(mins);
  const h = Math.floor(mins / 60);
  if (h < 36) return a.hours(h);
  return a.days(Math.round(h / 24));
}

/** A step's time: «0,4 s», «12 s», «3 min 5 s». */
export function timeText(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
}

export const stepName = (id: StepId, language?: Language): string => w(language).steps[id];
export const stateWord = (s: StepState, language?: Language): string => w(language).state[s];

/** The steps in order, with a placeholder for a step an older pass did not record. */
export const stepsOf = (p: RevisionPass): RevisionStep[] => ORDER.map((id) => p.steps.find((s) => s.id === id) ?? { id, estado: "omitido", ms: 0, detalle: null, tail: null });

export type Summary = { tone: "ok" | "bad" | "warn" | "idle" | "live"; text: string };

/** The line beside the title. */
export function summaryOf(r: RevisionRead, now: number, language?: Language): Summary {
  const t = w(language);
  if (!r.available) return { tone: "idle", text: t.unavailable };
  if (r.running) return { tone: "live", text: t.running(stepName(r.running.step, language)) };
  const p = r.last;
  if (!p) return { tone: "warn", text: t.never };
  const ago = agoText(p.finished_at, now, language);
  const red = p.steps.filter((s) => s.estado === "fallo").length;
  if (red) return { tone: "bad", text: t.red(red, ago) };
  if (now - Date.parse(p.finished_at) > STALE_MS) return { tone: "warn", text: t.old(ago) };
  return { tone: "ok", text: t.ok(ago) };
}

/** The warning next to «Constrúyelo»: the last pass is red, more than a day old, or there is none. Null when it is
 * green and fresh, or when this system cannot run a check-up (nothing the owner could do about it). */
export function buildWarning(r: RevisionRead | null | undefined, now: number, language?: Language): string | null {
  if (!r || !r.available) return null;
  const t = w(language);
  const p = r.last;
  if (!p) return t.warnNever;
  const bad = p.steps.find((s) => s.estado === "fallo");
  if (bad) return t.warnRed(stepName(bad.id, language));
  if (now - Date.parse(p.finished_at) > STALE_MS) return t.warnOld(agoText(p.finished_at, now, language));
  return null;
}

/** The step to open first: the first failure, else the first warning, else none. */
export const firstOpen = (p: RevisionPass | null): StepId | null => (p ? (p.steps.find((s) => s.estado === "fallo") ?? p.steps.find((s) => s.estado === "aviso"))?.id ?? null : null);
