// PLA-I46-7/8: the Ventana a la app. The read the server sends (src/api/captures.ts) and the one state the floor
// draws from it: con captura, en vivo, vacío, cargando, error or apagada. Pure, so the tests drive it with fake data.
// PLA-I2-10: its words in both languages (lib/i18n.ts).
import { clockAt } from "./edificio";
import { noDisponible } from "./sistema";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type Still = { id: string; image_url: string; width: number; height: number | null; url: string | null; commit: string | null; branch: string | null; task_key: string | null; taken_at: string };
export type StillError = { message: string; commit: string | null; task_key: string | null; taken_at: string };
export type Shot = { still: Still | null; error: StillError | null };
export type CapturePage = { key: string; label: string; path: string; session: boolean; desktop: Shot; phone: Shot };
// PLA-I2-4: unavailable: this system cannot run a test copy; stills "unavailable": it cannot take stills (no Chrome).
export type PruebaPhase = "starting" | "capturing" | "live" | "failed" | "off" | "running" | "unavailable";
export type PruebaRead = { phase: PruebaPhase; managed: boolean; port: number | null; url: string | null; started_at: string | null; error: string | null; detail: string | null; stills?: "unavailable" };
export type CapturesRead = {
  project: string;
  configured: boolean;
  start: { command: string; port: number; url: string } | null;
  viewports: Record<"desktop" | "phone", { width: number; height: number }>;
  pages: CapturePage[];
  last_ok_at: string | null;
  last_run_at: string | null;
  prueba: PruebaRead;
};

export type VentanaState = "captura" | "vivo" | "vacio" | "cargando" | "error" | "apagada";
// What the one button in the frame does: Encenderla, take the stills again, or read the floor again.
export type VentanaAct = "encender" | "tomar" | "leer";

export type VentanaView = {
  state: VentanaState;
  page: CapturePage | null;
  pages: CapturePage[]; // the ones with something to show, for the page chips
  desktop: Still | null;
  phone: Still | null;
  title: string | null; // the line over a grey frame
  button: { act: VentanaAct; label: string } | null;
  caption: string;
  detail: string | null; // Ver detalle
  open: string | null; // Abrir ↗
  apagar: boolean;
};

export const VENTANA = defineWords({
  es: {
    vacio: "Todavía no hay nada que ver",
    vacioCap: "Aparece con la primera entrega.",
    tomando: "Tomando la captura…",
    encendiendo: "Encendiendo la copia de prueba…",
    leyendo: "Abriendo la ventana…",
    apagada: "La copia de prueba está apagada",
    sinClic: "Nada arranca sin tu clic.",
    errorCaptura: "No se pudo tomar la captura",
    errorEncender: "No se pudo encender",
    errorLeer: "No se pudo abrir la ventana",
    vivo: "En vivo en tu máquina",
    reintentar: "Reintentar",
    encenderla: "Encenderla",
    tomar: "Tomar la captura",
    noResponde: "Plania no respondió.",
    ultimaBuena: (at: string) => `Se ve la última captura buena, de las ${at}.`,
    sinBuena: "Todavía no hay una captura buena.",
    ultima: (at: string | null, sinClic: string) => `Última captura: ${at}. ${sinClic}`,
    encendida: "La copia de prueba está encendida.",
    captura: (at: string | null) => `Copia de prueba · captura de las ${at}`,
  },
  en: {
    vacio: "Nothing to see yet",
    vacioCap: "It shows up with the first delivery.",
    tomando: "Taking the still…",
    encendiendo: "Turning on the test copy…",
    leyendo: "Opening the window…",
    apagada: "The test copy is off",
    sinClic: "Nothing starts without your click.",
    errorCaptura: "The still could not be taken",
    errorEncender: "It could not be turned on",
    errorLeer: "The window could not be opened",
    vivo: "Live on your machine",
    reintentar: "Try again",
    encenderla: "Turn it on",
    tomar: "Take the still",
    noResponde: "Plania did not answer.",
    ultimaBuena: (at: string) => `Showing the last good still, from ${at}.`,
    sinBuena: "There is no good still yet.",
    ultima: (at: string | null, sinClic: string) => `Last still: ${at}. ${sinClic}`,
    encendida: "The test copy is on.",
    captura: (at: string | null) => `Test copy · still from ${at}`,
  },
});

const shown = (p: CapturePage) => !!(p.desktop.still || p.phone.still || p.desktop.error || p.phone.error);

export function ventanaView(read: CapturesRead | undefined, o: { pending?: boolean; failed?: boolean; page?: string | null; timeZone?: string } = {}, language: Language = getLanguage()): VentanaView {
  const W = words(VENTANA, language);
  const nd = noDisponible(language);
  const base: VentanaView = { state: "cargando", page: null, pages: [], desktop: null, phone: null, title: null, button: null, caption: W.leyendo, detail: null, open: null, apagar: false };
  if (!read) {
    if (o.failed) return { ...base, state: "error", title: W.errorLeer, button: { act: "leer", label: W.reintentar }, caption: W.noResponde };
    return base;
  }
  const pages = read.pages.filter(shown);
  const page = pages.find((p) => p.key === o.page) ?? pages[0] ?? read.pages[0] ?? null;
  const desktop = page?.desktop.still ?? null;
  const phone = page?.phone.still ?? null;
  const any = !!(desktop || phone);
  const lastAt = [desktop, phone].filter((s): s is Still => !!s).map((s) => s.taken_at).sort().pop() ?? null;
  const at = lastAt ? clockAt(lastAt, o.timeZone) : null;
  const pr = read.prueba;
  const on = pr.phase === "live" || pr.phase === "running";
  const v: VentanaView = { ...base, page, pages, desktop, phone, caption: "", open: on ? pr.url : null, apagar: pr.managed && (pr.phase === "live" || pr.phase === "failed") };

  // PLA-I2-4: a part this system cannot run is a plain grey frame that says so, never an error.
  if (pr.phase === "unavailable") return { ...v, state: "apagada", title: nd.unavailable, button: null, caption: nd.by.test_copy, open: null, apagar: false };
  if (pr.phase === "starting") return { ...v, state: "cargando", caption: W.encendiendo, open: null };
  if (pr.phase === "capturing") return { ...v, state: "cargando", caption: W.tomando };
  if (pr.phase === "failed")
    return {
      ...v,
      state: "error",
      title: W.errorEncender,
      button: { act: "encender", label: W.reintentar },
      caption: at ? W.ultimaBuena(at) : (pr.error ?? ""),
      detail: [pr.error, pr.detail].filter(Boolean).join("\n") || null,
    };
  if (pr.stills === "unavailable") return { ...v, state: "apagada", title: nd.unavailable, button: on ? null : { act: "encender", label: W.encenderla }, caption: nd.by.stills };
  if (!on) {
    if (!any) return { ...v, state: "vacio", caption: W.vacioCap, button: { act: "encender", label: W.encenderla } };
    return { ...v, state: "apagada", title: W.apagada, button: { act: "encender", label: W.encenderla }, caption: W.ultima(at, W.sinClic) };
  }
  // On: the newest error of this page (a still newer than it already hides it, server side).
  const errs = [page?.desktop.error, page?.phone.error].filter((e): e is StillError => !!e);
  if (errs.length || pr.error) {
    const msg = [pr.error, ...errs.map((e) => e.message)].filter(Boolean);
    return {
      ...v,
      state: "error",
      title: W.errorCaptura,
      button: { act: "tomar", label: W.reintentar },
      caption: at ? W.ultimaBuena(at) : W.sinBuena,
      detail: [...new Set(msg)].join("\n") || null,
    };
  }
  if (!any) return { ...v, state: "vacio", caption: W.encendida, button: { act: "tomar", label: W.tomar } };
  if (pr.phase === "live" && pr.managed) return { ...v, state: "vivo", caption: W.vivo };
  return { ...v, state: "captura", caption: W.captura(at) };
}

// How often the floor reads the Ventana again: fast while something moves, slowly while the copy is on (that
// reading also tells the server somebody is looking, so the copy is not stopped as idle), else not at all.
export function ventanaPoll(read: CapturesRead | undefined): number | false {
  const ph = read?.prueba.phase;
  if (ph === "starting" || ph === "capturing") return 1500;
  if (ph === "live" || ph === "running") return 60_000;
  return false;
}
