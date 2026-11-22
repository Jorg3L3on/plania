// PLA-I52-4: El Probador, the pure part. What the viewer shows for a view, side and width, the words on the card,
// and what «Si aceptas» says. The component (components/compania/edificio/probador.tsx) draws what these return;
// test/i52-probador-ui.test.ts feeds them plain objects.
import type { ParVista, ProbadorRead } from "./api";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type Side = "antes" | "despues" | "comparar";
export type Width = "desktop" | "phone";

// PLA-I2-10: El Probador's words in both languages. KIND_WORD and PROBADOR_WORDS keep the Spanish for callers that
// read the constants; kindWord() and probadorWords() follow the screen's language.
export const PROBADOR_ALL = defineWords({
  es: {
    kind: { nueva: "nueva", cambio: "cambió", igual: "igual", sin_antes: "sin antes", error: "error" } as Record<ParVista["kind"], string>,
    card: {
      antes: "Antes",
      despues: "Después",
      comparar: "Comparar",
      desktop: "Escritorio",
      phone: "Teléfono",
      cargando: "Cargando la foto…",
      resaltar: "Resaltar cambios",
      vivo: "Pruébala en vivo",
      encender: "Encender la copia",
      encendiendo: "Encendiendo la copia…",
      pasos: "Pruébala en 3 pasos",
      siAceptas: "Si apruebas",
      tomar: "Volver a tomar las fotos",
      abrir: "Abrir el probador",
      nueva: "Pantalla nueva: en la copia de prueba esta dirección no existe.",
      sinFoto: "Sin foto",
      conError: "La página dio error",
    },
    altBefore: "antes",
    altAfter: "después",
    altDesktop: "escritorio",
    altPhone: "teléfono",
    noStillBefore: "Sin foto de la copia de prueba",
    noStillAfter: "Sin foto de la entrega",
    taking: "Tomando las fotos de la entrega…",
    failed: (error: string) => `No salieron las fotos: ${error}`,
    noDetail: "sin detalle",
    missing: (error: string) => `Faltan fotos: ${error}`,
    testCopy: "copia de prueba",
    ifAccepted: "Pasa a tu copia de prueba; lo publicado no cambia. A producción solo llega cuando tú lances. Se puede deshacer.",
    ifNot: (waiting: string) => `Si no: ${waiting} espera a esta.`,
  },
  en: {
    kind: { nueva: "new", cambio: "changed", igual: "same", sin_antes: "no before", error: "error" },
    card: {
      antes: "Before",
      despues: "After",
      comparar: "Compare",
      desktop: "Desktop",
      phone: "Phone",
      cargando: "Loading the picture…",
      resaltar: "Highlight changes",
      vivo: "Try it live",
      encender: "Turn on the copy",
      encendiendo: "Turning on the copy…",
      pasos: "Try it in 3 steps",
      siAceptas: "If you approve",
      tomar: "Take the pictures again",
      abrir: "Open El Probador",
      nueva: "New screen: this address does not exist on the test copy.",
      sinFoto: "No picture",
      conError: "The page showed an error",
    },
    altBefore: "before",
    altAfter: "after",
    altDesktop: "desktop",
    altPhone: "phone",
    noStillBefore: "No picture of the test copy",
    noStillAfter: "No picture of the delivery",
    taking: "Taking the delivery's pictures…",
    failed: (error: string) => `The pictures did not come out: ${error}`,
    noDetail: "no detail",
    missing: (error: string) => `Pictures missing: ${error}`,
    testCopy: "test copy",
    ifAccepted: "It goes to your test copy; what is published does not change. It reaches production only when you release. It can be undone.",
    ifNot: (waiting: string) => `If not: ${waiting} waits for this one.`,
  },
});
export const KIND_WORD: Record<ParVista["kind"], string> = PROBADOR_ALL.es.kind;
export const kindWord = (kind: ParVista["kind"], language: Language = getLanguage()): string => words(PROBADOR_ALL, language).kind[kind];
export const PROBADOR_WORDS = PROBADOR_ALL.es.card;
export const probadorWords = (language: Language = getLanguage()) => words(PROBADOR_ALL, language).card;

// What to draw in one frame: a still, a «nueva» note, or why there is no picture.
export type Frame = { kind: "still"; src: string; alt: string; ratio: number | null } | { kind: "nueva" } | { kind: "none"; why: string; error?: boolean };

export function frameOf(v: ParVista, width: Width, side: "antes" | "despues", language: Language = getLanguage()): Frame {
  const w = words(PROBADOR_ALL, language);
  const s = v[width][side];
  if (s.still) {
    const ratio = s.still.height ? s.still.width / s.still.height : null;
    return { kind: "still", src: s.still.image_url, alt: `${v.label}, ${side === "antes" ? w.altBefore : w.altAfter}, ${width === "desktop" ? w.altDesktop : w.altPhone}`, ratio };
  }
  if (side === "antes" && s.missing) return { kind: "nueva" };
  // PLA-76: the delivery's page crashed; say so as the heading, with the error's first line under it.
  if (side === "despues" && v.kind === "error" && s.error) return { kind: "none", why: s.error, error: true };
  return { kind: "none", why: s.error ?? (side === "antes" ? w.noStillBefore : w.noStillAfter) };
}

// Where the viewer opens: on a crashed page first (PLA-76), then on a new screen (that is what the delivery is about), else the first change.
export function firstVista(r: ProbadorRead): string | null {
  return (r.vistas.find((v) => v.kind === "error") ?? r.vistas.find((v) => v.kind === "nueva") ?? r.vistas.find((v) => v.kind === "cambio") ?? r.vistas[0])?.key ?? null;
}

// The default side: a new screen shows después; a change opens on Comparar.
export const sideFor = (v: ParVista | undefined): Side => (v && v.kind === "cambio" ? "comparar" : "despues");

// One line under the title, saying where the pictures stand. Null when there is nothing to say.
export function stateLine(r: ProbadorRead, language: Language = getLanguage()): string | null {
  const w = words(PROBADOR_ALL, language);
  const s = r.state;
  if (!s) return null;
  // PLA-158 (F-27): a pass that waits (another delivery's pictures, a live copy left open) says on what.
  if (s.state === "tomando") return s.waiting ? `${w.taking} ${s.waiting}` : w.taking;
  if (s.state === "fallo") return w.failed((s.error ?? w.noDetail).replace(/\bsandbox\b/g, w.testCopy));
  return s.error ? w.missing(s.error.replace(/copia de sandbox/g, w.testCopy).replace(/\bsandbox\b/g, w.testCopy)) : null;
}

// PLA-158 (F-27): the line under «Tomando las fotos de la entrega…» on the delivery card: what the pass waits on, or
// the usual «they show up here» (soon) while it works.
export const tomandoLine = (r: Pick<ProbadorRead, "state"> | null | undefined, soon: string): string => r?.state?.waiting?.trim() || soon;

// What accepting does, in the owner's words. into: where an accepted delivery lands (the project's release from).
export function siAceptas(into: string | null, waiting: string | null, language: Language = getLanguage()): string[] {
  // PLA-42: the branch name (sandbox) stays off screen: it is «tu copia de prueba».
  void into;
  const w = words(PROBADOR_ALL, language);
  const out = [w.ifAccepted];
  if (waiting) out.push(w.ifNot(waiting));
  return out;
}
