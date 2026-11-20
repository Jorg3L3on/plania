// PLA-I69-6: Marca → Historial, the screen's logic and words. The logo's, the style's and the voice's versions and
// Marca's requests to Taller in one list, newest first; one picked shows against what leads today.
import { defineWords, words } from "./i18n.js";
import { LOCALE } from "./locale.js";
import type { Style } from "./estilo.js";
import type { Voice } from "./voz.js";
import type { VersionRef } from "./marca.js";

export type RequestKind = "caras" | "estilo" | "nombre";
export type Historial = {
  logo: VersionRef[];
  style: { v: number; at: string; current: boolean; style: Style }[];
  voice: { v: number; at: string; current: boolean; voice: Voice }[];
  requests: { key: string; title: string; kind: RequestKind; status: string; at: string; pr: string | null }[];
};
export type Lane = "logo" | "estilo" | "voz" | "pedido";
export type Entry =
  | { lane: "logo"; id: string; at: string; current: boolean; v: VersionRef }
  | { lane: "estilo"; id: string; at: string; current: boolean; v: number; style: Style }
  | { lane: "voz"; id: string; at: string; current: boolean; v: number; voice: Voice }
  | { lane: "pedido"; id: string; at: string; current: false; r: Historial["requests"][number] };

/** One list, newest first. */
export function entries(h: Historial, lane: Lane | "todo" = "todo"): Entry[] {
  const all: Entry[] = [
    ...h.logo.map((v) => ({ lane: "logo" as const, id: `logo-${v.v}`, at: v.at, current: v.active, v })),
    ...h.style.map((s) => ({ lane: "estilo" as const, id: `estilo-${s.v}`, at: s.at, current: s.current, v: s.v, style: s.style })),
    ...h.voice.map((s) => ({ lane: "voz" as const, id: `voz-${s.v}`, at: s.at, current: s.current, v: s.v, voice: s.voice })),
    ...h.requests.map((r) => ({ lane: "pedido" as const, id: `pedido-${r.key}`, at: r.at, current: false as const, r })),
  ];
  return all.filter((e) => lane === "todo" || e.lane === lane).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

const STYLE_KEYS = ["brand", "accent", "neutral", "head", "body", "mono", "base", "ratio", "radius", "pill", "shadow", "border", "density", "lib", "stroke", "fill", "motion", "img"] as const;
const VOICE_KEYS = ["trato", "cerca", "humor", "breve", "sencillo", "name", "short", "desc", "tag"] as const;
/** What a version has that today's does not, field by field. */
export function styleDiff(a: Style, b: Style): { k: (typeof STYLE_KEYS)[number]; from: string; to: string }[] {
  return STYLE_KEYS.filter((k) => String(a[k]) !== String(b[k])).map((k) => ({ k, from: String(b[k]), to: String(a[k]) }));
}
export function voiceDiff(a: Voice, b: Voice): { k: (typeof VOICE_KEYS)[number]; from: string; to: string }[] {
  return VOICE_KEYS.filter((k) => String(a[k]) !== String(b[k])).map((k) => ({ k, from: String(b[k]), to: String(a[k]) }));
}

export const HISTORIAL_WORDS = defineWords({
  es: {
    loading: "Leyendo el historial…",
    readError: "el historial",
    lanes: { todo: "Todo", logo: "Logo", estilo: "Estilo", voz: "Voz y nombre", pedido: "Pedidos" } as Record<string, string>,
    lanesLabel: "Qué mostrar",
    empty: "Todavía no hay nada aquí: cada cambio en Marca queda en esta lista.",
    current: "Actual",
    version: (lane: string, v: number) => `${lane} · versión ${v}`,
    goBack: "Volver a esta",
    goneBack: (lane: string, v: number) => `${lane}: volvió a la versión ${v}. Quedó como una versión nueva.`,
    pick: "Elige una línea para verla junto a lo de hoy.",
    then: "Entonces",
    now: "Hoy",
    same: "Igual que hoy.",
    fields: {
      brand: "Color de marca", accent: "Acento", neutral: "Grises", head: "Títulos", body: "Texto", mono: "Código", base: "Tamaño", ratio: "Escala", radius: "Esquinas", pill: "Píldora", shadow: "Sombras", border: "Bordes", density: "Espacio", lib: "Íconos", stroke: "Trazo", fill: "Relleno", motion: "Movimiento", img: "Ilustración",
      trato: "Trato", cerca: "Cercanía", humor: "Humor", breve: "Brevedad", sencillo: "Sencillez", name: "Nombre", short: "Nombre corto", desc: "Descripción", tag: "Frase",
    } as Record<string, string>,
    source: { repo: "del repo", upload: "subido por ti", artist: "de Artist" } as Record<string, string>,
    kinds: { caras: "Íconos", estilo: "Estilo", nombre: "Nombre y textos" } as Record<string, string>,
    status: {
      Backlog: "En espera", Ready: "Lista para Taller", "In progress": "Taller trabaja", "Needs owner": "Te espera", "In review": "En revisión", Merged: "Aceptado", Released: "En el repo", Done: "En el repo", "Won't do": "No se hará",
    } as Record<string, string>,
    pr: "Ver el PR",
    guide: "La guía de entonces",
    when: (iso: string) => new Date(iso).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
  },
  en: {
    loading: "Reading the history…",
    readError: "the history",
    lanes: { todo: "All", logo: "Logo", estilo: "Style", voz: "Voice and name", pedido: "Requests" } as Record<string, string>,
    lanesLabel: "What to show",
    empty: "Nothing here yet: every change in Marca stays in this list.",
    current: "Current",
    version: (lane: string, v: number) => `${lane} · version ${v}`,
    goBack: "Go back to this one",
    goneBack: (lane: string, v: number) => `${lane}: back to version ${v}. It was kept as a new version.`,
    pick: "Pick a line to see it next to today's.",
    then: "Then",
    now: "Today",
    same: "Same as today.",
    fields: {
      brand: "Brand colour", accent: "Accent", neutral: "Greys", head: "Headings", body: "Text", mono: "Code", base: "Size", ratio: "Scale", radius: "Corners", pill: "Pill", shadow: "Shadows", border: "Borders", density: "Space", lib: "Icons", stroke: "Stroke", fill: "Fill", motion: "Motion", img: "Illustration",
      trato: "Address", cerca: "Warmth", humor: "Humour", breve: "Brevity", sencillo: "Plainness", name: "Name", short: "Short name", desc: "Description", tag: "Tagline",
    } as Record<string, string>,
    source: { repo: "from the repo", upload: "uploaded by you", artist: "by Artist" } as Record<string, string>,
    kinds: { caras: "Icons", estilo: "Style", nombre: "Name and texts" } as Record<string, string>,
    status: {
      Backlog: "Waiting", Ready: "Ready for Taller", "In progress": "Taller is on it", "Needs owner": "Waiting for you", "In review": "In review", Merged: "Accepted", Released: "In the repo", Done: "In the repo", "Won't do": "Won't be done",
    } as Record<string, string>,
    pr: "See the PR",
    guide: "The guide back then",
    when: (iso: string) => new Date(iso).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
  },
});
export const historialWords = () => words(HISTORIAL_WORDS);
export type HistorialWords = ReturnType<typeof historialWords>;
