// PLA-I52-4: El Probador, the pure part. What the viewer shows for a view, side and width, the words on the card,
// and what «Si aceptas» says. The component (components/compania/edificio/probador.tsx) draws what these return;
// test/i52-probador-ui.test.ts feeds them plain objects.
import type { ParVista, ProbadorRead } from "./api";

export type Side = "antes" | "despues" | "comparar";
export type Width = "desktop" | "phone";

export const KIND_WORD: Record<ParVista["kind"], string> = { nueva: "nueva", cambio: "cambió", igual: "igual", sin_antes: "sin antes", error: "error" };

export const PROBADOR_WORDS = {
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
} as const;

// What to draw in one frame: a still, a «nueva» note, or why there is no picture.
export type Frame = { kind: "still"; src: string; alt: string; ratio: number | null } | { kind: "nueva" } | { kind: "none"; why: string; error?: boolean };

export function frameOf(v: ParVista, width: Width, side: "antes" | "despues"): Frame {
  const s = v[width][side];
  if (s.still) {
    const ratio = s.still.height ? s.still.width / s.still.height : null;
    return { kind: "still", src: s.still.image_url, alt: `${v.label}, ${side === "antes" ? "antes" : "después"}, ${width === "desktop" ? "escritorio" : "teléfono"}`, ratio };
  }
  if (side === "antes" && s.missing) return { kind: "nueva" };
  // PLA-76: the delivery's page crashed; say so as the heading, with the error's first line under it.
  if (side === "despues" && v.kind === "error" && s.error) return { kind: "none", why: s.error, error: true };
  return { kind: "none", why: s.error ?? (side === "antes" ? "Sin foto de la copia de prueba" : "Sin foto de la entrega") };
}

// Where the viewer opens: on a crashed page first (PLA-76), then on a new screen (that is what the delivery is about), else the first change.
export function firstVista(r: ProbadorRead): string | null {
  return (r.vistas.find((v) => v.kind === "error") ?? r.vistas.find((v) => v.kind === "nueva") ?? r.vistas.find((v) => v.kind === "cambio") ?? r.vistas[0])?.key ?? null;
}

// The default side: a new screen shows después; a change opens on Comparar.
export const sideFor = (v: ParVista | undefined): Side => (v && v.kind === "cambio" ? "comparar" : "despues");

// One line under the title, saying where the pictures stand. Null when there is nothing to say.
export function stateLine(r: ProbadorRead): string | null {
  const s = r.state;
  if (!s) return null;
  if (s.state === "tomando") return "Tomando las fotos de la entrega…";
  if (s.state === "fallo") return `No salieron las fotos: ${(s.error ?? "sin detalle").replace(/\bsandbox\b/g, "copia de prueba")}`;
  return s.error ? `Faltan fotos: ${s.error.replace(/copia de sandbox/g, "copia de prueba").replace(/\bsandbox\b/g, "copia de prueba")}` : null;
}

// What accepting does, in the owner's words. into: where an accepted delivery lands (the project's release from).
export function siAceptas(into: string | null, waiting: string | null): string[] {
  // PLA-42: the branch name (sandbox) stays off screen: it is «tu copia de prueba».
  void into;
  const out = [`Pasa a tu copia de prueba; lo publicado no cambia. A producción solo llega cuando tú lances. Se puede deshacer.`];
  if (waiting) out.push(`Si no: ${waiting} espera a esta.`);
  return out;
}
