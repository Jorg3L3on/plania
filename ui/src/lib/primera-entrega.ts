// PLA-I2-16: the guide to a first delivery, on the home screen until the owner accepts one. Its words and the pure
// rules that turn the server's read (GET /api/guia, src/api/guia.ts) into steps. Tested without a browser.
// Relative imports only: the server imports this file for the failure words.
import { arranqueOf, type ArranqueWords } from "./arranque.js";

export type PasoEstado = "hecho" | "ahora" | "luego";
export type PasoId = "maquina" | "proyecto" | "reanudar" | "pedido" | "plan" | "entrega";

/** What the server reads, every field from data. */
export type GuiaRead = {
  visible: boolean;
  proyecto: { slug: string; title: string } | null;
  maquina: "lista" | "falta" | "sin_revisar";
  company_paused: boolean;
  project_paused: boolean;
  pedido: boolean;
  plan: "nada" | "espera" | "aprobado";
  entrega: "nada" | "espera" | "aceptada";
  fallo: { summary: string; ticket: string | null; at: string | null; por: string; arregla: string } | null;
  est_pct_per_run: number;
};

export type Paso = { id: PasoId; titulo: string; texto: string; estado: PasoEstado; href: string; boton: string };

// Sized to finish in one run on the smallest paid plan: one short document, no code, nothing to set up.
export const PEDIDO_SUGERIDO = "Escribe un documento corto que diga qué es este proyecto, para quién es y cuáles serían sus tres primeros pasos.";

// The example for someone with no repository at hand: a project with no code whose first request ends in a document.
export const EJEMPLO = { name: "Ejemplo", goal: "Probar Plania con un primer trabajo pequeño que termina en un documento." } as const;

export const WORDS = {
  titulo: "Tu primera entrega",
  intro: "Seis pasos hasta que el equipo te entregue algo y lo aceptes. Cada uno se marca solo cuando ya está.",
  ejemplo: "Probar con un ejemplo",
  ejemploTexto: "¿No tienes un repositorio a la mano? El ejemplo es un proyecto sin código: su primer trabajo termina en un documento.",
  pedirSugerido: "Pedir esto",
  pausa: "Para detener todo en cualquier momento: Pausar la compañía.",
  falloTitulo: "Algo no dejó arrancar al equipo",
  listo: "Listo",
} as const;

/** «Una corrida usa más o menos el 3 % de tu plan de cinco horas.» */
export function consumoLinea(pct: number): string {
  const n = Number.isFinite(pct) && pct > 0 ? Math.round(pct) : 3;
  return `Una corrida usa más o menos el ${n} % de tu plan de cinco horas, así que este pedido cabe de sobra.`;
}

const ceo = (q = "") => `/ceo${q}`;

/** The six steps, in order; the first one not done is «ahora». Links go where each thing is done on the screen. */
export function pasosDe(r: GuiaRead): Paso[] {
  const p = r.proyecto;
  const enProyecto = p ? ceo(`?proyecto=${encodeURIComponent(p.slug)}`) : ceo("?nuevo");
  const pausado = r.company_paused || r.project_paused;
  const base: Array<Omit<Paso, "estado"> & { hecho: boolean }> = [
    {
      id: "maquina",
      titulo: "Revisa la máquina",
      texto:
        r.maquina === "lista"
          ? "Tiene todo lo que Plania necesita."
          : r.maquina === "falta"
            ? "Le falta algo: ábrela y sigue el arreglo de cada cosa."
            : "Mira qué le falta antes de empezar; se marca al revisarla.",
      href: "/machine/falta",
      boton: "Ver qué falta",
      hecho: r.maquina === "lista",
    },
    {
      id: "proyecto",
      titulo: "Crea tu primer proyecto",
      texto: p ? `${p.title} ya existe.` : "Ponle nombre y una meta de una frase. Empieza en pausa, con su equipo.",
      href: p ? enProyecto : ceo("?nuevo"),
      boton: "Nuevo proyecto",
      hecho: !!p,
    },
    {
      id: "reanudar",
      titulo: "Reanúdalo",
      texto: r.company_paused
        ? "La compañía empieza detenida: reanúdala para que el equipo pueda trabajar."
        : "Un proyecto nuevo empieza en pausa: nada corre hasta que lo reanudes.",
      href: r.company_paused || !p ? ceo("?hoja=reanudar") : ceo(`?hoja=reanudar:${encodeURIComponent(p.slug)}`),
      boton: "Reanudar",
      hecho: !!p && !pausado,
    },
    {
      id: "pedido",
      titulo: "Pide algo pequeño",
      texto: `Por ejemplo: «${PEDIDO_SUGERIDO}» ${consumoLinea(r.est_pct_per_run)}`,
      href: enProyecto,
      boton: "Pedir",
      hecho: r.pedido,
    },
    {
      id: "plan",
      titulo: "Aprueba el plan",
      texto:
        r.plan === "espera"
          ? "El responsable del proyecto te propuso un plan: léelo y, si te parece, «Sí, empiecen»."
          : "El responsable del proyecto te propondrá un plan; nada se construye hasta que digas «Sí, empiecen».",
      href: enProyecto,
      boton: "Ver el plan",
      hecho: r.plan === "aprobado",
    },
    {
      id: "entrega",
      titulo: "Acepta la entrega",
      texto:
        r.entrega === "espera"
          ? "El equipo terminó: revisa lo que hizo y pulsa Aceptar, o pide cambios."
          : "Cuando el equipo termine, te toca revisarlo y aceptarlo.",
      href: enProyecto,
      boton: "Ver la entrega",
      hecho: r.entrega === "aceptada",
    },
  ];
  const first = base.findIndex((s) => !s.hecho);
  return base.map(({ hecho, ...s }, i) => ({ ...s, estado: hecho ? "hecho" : i === first ? "ahora" : "luego" }));
}

/** Whether to offer the example project: only while there is no project yet. */
export const ofreceEjemplo = (r: GuiaRead): boolean => !r.proyecto;

/** The words for a run that could not start, or ended because Claude has no session: what happened and the fix. */
export function falloWords(summary: string | null | undefined): ArranqueWords | null {
  return arranqueOf(summary);
}
