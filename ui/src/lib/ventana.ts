// PLA-I46-7/8: the Ventana a la app. The read the server sends (src/api/captures.ts) and the one state the floor
// draws from it: con captura, en vivo, vacío, cargando, error or apagada. Pure, so the tests drive it with fake data.
import { clockAt } from "./edificio";

export type Still = { id: string; image_url: string; width: number; height: number | null; url: string | null; commit: string | null; branch: string | null; task_key: string | null; taken_at: string };
export type StillError = { message: string; commit: string | null; task_key: string | null; taken_at: string };
export type Shot = { still: Still | null; error: StillError | null };
export type CapturePage = { key: string; label: string; path: string; session: boolean; desktop: Shot; phone: Shot };
export type PruebaPhase = "starting" | "capturing" | "live" | "failed" | "off" | "running";
export type PruebaRead = { phase: PruebaPhase; managed: boolean; port: number | null; url: string | null; started_at: string | null; error: string | null; detail: string | null };
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

export const VENTANA = {
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
  vivo: "En vivo en tu Mac",
} as const;

const shown = (p: CapturePage) => !!(p.desktop.still || p.phone.still || p.desktop.error || p.phone.error);

export function ventanaView(read: CapturesRead | undefined, o: { pending?: boolean; failed?: boolean; page?: string | null; timeZone?: string } = {}): VentanaView {
  const base: VentanaView = { state: "cargando", page: null, pages: [], desktop: null, phone: null, title: null, button: null, caption: VENTANA.leyendo, detail: null, open: null, apagar: false };
  if (!read) {
    if (o.failed) return { ...base, state: "error", title: VENTANA.errorLeer, button: { act: "leer", label: "Reintentar" }, caption: "Plania no respondió." };
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

  if (pr.phase === "starting") return { ...v, state: "cargando", caption: VENTANA.encendiendo, open: null };
  if (pr.phase === "capturing") return { ...v, state: "cargando", caption: VENTANA.tomando };
  if (pr.phase === "failed")
    return {
      ...v,
      state: "error",
      title: VENTANA.errorEncender,
      button: { act: "encender", label: "Reintentar" },
      caption: at ? `Se ve la última captura buena, de las ${at}.` : (pr.error ?? ""),
      detail: [pr.error, pr.detail].filter(Boolean).join("\n") || null,
    };
  if (!on) {
    if (!any) return { ...v, state: "vacio", caption: VENTANA.vacioCap, button: { act: "encender", label: "Encenderla" } };
    return { ...v, state: "apagada", title: VENTANA.apagada, button: { act: "encender", label: "Encenderla" }, caption: `Última captura: ${at}. ${VENTANA.sinClic}` };
  }
  // On: the newest error of this page (a still newer than it already hides it, server side).
  const errs = [page?.desktop.error, page?.phone.error].filter((e): e is StillError => !!e);
  if (errs.length || pr.error) {
    const msg = [pr.error, ...errs.map((e) => e.message)].filter(Boolean);
    return {
      ...v,
      state: "error",
      title: VENTANA.errorCaptura,
      button: { act: "tomar", label: "Reintentar" },
      caption: at ? `Se ve la última captura buena, de las ${at}.` : "Todavía no hay una captura buena.",
      detail: [...new Set(msg)].join("\n") || null,
    };
  }
  if (!any) return { ...v, state: "vacio", caption: "La copia de prueba está encendida.", button: { act: "tomar", label: "Tomar la captura" } };
  if (pr.phase === "live" && pr.managed) return { ...v, state: "vivo", caption: VENTANA.vivo };
  return { ...v, state: "captura", caption: `Copia de prueba · captura de las ${at}` };
}

// How often the floor reads the Ventana again: fast while something moves, slowly while the copy is on (that
// reading also tells the server somebody is looking, so the copy is not stopped as idle), else not at all.
export function ventanaPoll(read: CapturesRead | undefined): number | false {
  const ph = read?.prueba.phase;
  if (ph === "starting" || ph === "capturing") return 1500;
  if (ph === "live" || ph === "running") return 60_000;
  return false;
}
