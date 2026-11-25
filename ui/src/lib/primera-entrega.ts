// PLA-I2-16: the guide to a first delivery, on the home screen until the owner accepts one. Its words and the pure
// rules that turn the server's read (GET /api/guia, src/api/guia.ts) into steps. Tested without a browser.
// Relative imports only: the server imports this file for the failure words.
import { arranqueOf, type ArranqueWords } from "./arranque.js";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

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

// accion: the step's button acts in place instead of following href (F6: Reanudar resumes the company and the project).
export type Paso = { id: PasoId; titulo: string; texto: string; estado: PasoEstado; href: string; boton: string; accion?: "reanudar" };

// PLA-I2-10: the words are in PRIMERA_ENTREGA_WORDS, in both languages. PEDIDO_SUGERIDO, EJEMPLO and WORDS stay the
// Spanish ones (tests and the server read them); the guide reads primeraEntregaWords() and pedidoSugerido(). The
// server (src/api/guia.ts) makes the example project with the Spanish EJEMPLO.
export const PRIMERA_ENTREGA_WORDS = defineWords({
  es: {
    // Sized to finish in one run on the smallest paid plan: one short document, no code, nothing to set up.
    pedidoSugerido: "Escribe un documento corto que diga qué es este proyecto, para quién es y cuáles serían sus tres primeros pasos.",
    // The example for someone with no repository at hand: a project with no code whose first request ends in a document.
    ejemploProyecto: { name: "Ejemplo", goal: "Probar Plania con un primer trabajo pequeño que termina en un documento." },
    guia: {
      titulo: "Tu primera entrega",
      intro: "Seis pasos hasta que el equipo te entregue algo y lo aceptes. Cada uno se marca solo cuando ya está.",
      ejemplo: "Probar con un ejemplo",
      ejemploTexto: "¿No tienes un repositorio a la mano? El ejemplo es un proyecto sin código: su primer trabajo termina en un documento.",
      pedirSugerido: "Pedir esto",
      pausa: "Para detener todo en cualquier momento: Pausar la compañía.",
      falloTitulo: "Algo no dejó arrancar al equipo",
      listo: "Listo",
    },
    consumo: (n: number) => `Una corrida usa más o menos el ${n} % de tu plan de cinco horas, así que este pedido cabe de sobra.`,
    maquina: {
      titulo: "Revisa la máquina",
      lista: "Tiene todo lo que Plania necesita.",
      falta: "Le falta algo: ábrela y sigue el arreglo de cada cosa.",
      sinRevisar: "Mira qué le falta antes de empezar; se marca al revisarla.",
      boton: "Ver qué falta",
    },
    proyecto: {
      titulo: "Agrega tu primer proyecto",
      existe: (title: string) => `${title} ya existe.`,
      nuevo: "Uno nuevo, o uno que ya tiene código: en esta máquina, en GitHub o por SSH. Empieza en pausa, con su equipo.",
      boton: "Agregar proyecto",
    },
    reanudar: {
      titulo: "Reanúdalo",
      compania: "La compañía empieza detenida: reanúdala para que el equipo pueda trabajar.",
      proyecto: "Un proyecto nuevo empieza en pausa: nada corre hasta que lo reanudes.",
      // F6: the company and the first project both start paused; one press resumes the two.
      ambos: (title: string) => `La compañía y ${title} empiezan en pausa. Reanudar pone a andar las dos con un solo botón.`,
      boton: "Reanudar",
      reanudando: "Reanudando…",
      fallo: "No se pudo reanudar. Intenta de nuevo.",
    },
    pedido: {
      titulo: "Pide algo pequeño",
      texto: (pedido: string, consumo: string) => `Por ejemplo: «${pedido}» ${consumo}`,
      boton: "Pedir",
    },
    plan: {
      titulo: "Aprueba el plan",
      espera: "El responsable del proyecto te propuso un plan: léelo y, si te parece, «Sí, empiecen».",
      nada: "El responsable del proyecto te propondrá un plan; nada se construye hasta que digas «Sí, empiecen».",
      boton: "Ver el plan",
    },
    entrega: {
      titulo: "Acepta la entrega",
      espera: "El equipo terminó: revisa lo que hizo y pulsa Aceptar, o pide cambios.",
      nada: "Cuando el equipo termine, te toca revisarlo y aceptarlo.",
      boton: "Ver la entrega",
    },
  },
  en: {
    pedidoSugerido: "Write a short document that says what this project is, who it is for and what its first three steps would be.",
    ejemploProyecto: { name: "Example", goal: "Try Plania with a small first job that ends in a document." },
    guia: {
      titulo: "Your first delivery",
      intro: "Six steps until the team delivers something to you and you accept it. Each one ticks itself once it is done.",
      ejemplo: "Try an example",
      ejemploTexto: "No repository at hand? The example is a project with no code: its first job ends in a document.",
      pedirSugerido: "Ask for this",
      pausa: "To stop everything at any moment: Pause the company.",
      falloTitulo: "Something kept the team from starting",
      listo: "Done",
    },
    consumo: (n: number) => `A run uses about ${n} % of your five-hour plan, so this request fits easily.`,
    maquina: {
      titulo: "Check the machine",
      lista: "It has everything Plania needs.",
      falta: "Something is missing: open it and follow the fix for each thing.",
      sinRevisar: "See what is missing before you start; it ticks once it is checked.",
      boton: "See what's missing",
    },
    proyecto: {
      titulo: "Add your first project",
      existe: (title: string) => `${title} already exists.`,
      nuevo: "A new one, or one that already has code: on this machine, on GitHub or over SSH. It starts paused, with its team.",
      boton: "Add project",
    },
    reanudar: {
      titulo: "Resume it",
      compania: "The company starts stopped: resume it so the team can work.",
      proyecto: "A new project starts paused: nothing runs until you resume it.",
      ambos: (title: string) => `The company and ${title} start paused. Resume starts both with one button.`,
      boton: "Resume",
      reanudando: "Resuming…",
      fallo: "It could not resume. Try again.",
    },
    pedido: {
      titulo: "Ask for something small",
      texto: (pedido: string, consumo: string) => `For example: «${pedido}» ${consumo}`,
      boton: "Ask",
    },
    plan: {
      titulo: "Approve the plan",
      espera: "The project's lead proposed a plan to you: read it and, if it looks right, «Yes, go ahead».",
      nada: "The project's lead will propose a plan to you; nothing is built until you say «Yes, go ahead».",
      boton: "See the plan",
    },
    entrega: {
      titulo: "Accept the delivery",
      espera: "The team finished: review what it did and press Accept, or ask for changes.",
      nada: "When the team finishes, it's your turn to review it and accept it.",
      boton: "See the delivery",
    },
  },
});

/** The guide's words in the screen's language (or the one given). */
export const primeraEntregaWords = (language: Language = getLanguage()) => words(PRIMERA_ENTREGA_WORDS, language);

export const PEDIDO_SUGERIDO = PRIMERA_ENTREGA_WORDS.es.pedidoSugerido;
/** The suggested request in the screen's language: what the guide shows is what the button asks. */
export const pedidoSugerido = (language: Language = getLanguage()): string => words(PRIMERA_ENTREGA_WORDS, language).pedidoSugerido;

export const EJEMPLO = PRIMERA_ENTREGA_WORDS.es.ejemploProyecto;

export const WORDS = PRIMERA_ENTREGA_WORDS.es.guia;

/** «Una corrida usa más o menos el 3 % de tu plan de cinco horas.» */
export function consumoLinea(pct: number, language: Language = getLanguage()): string {
  const n = Number.isFinite(pct) && pct > 0 ? Math.round(pct) : 3;
  return words(PRIMERA_ENTREGA_WORDS, language).consumo(n);
}

const ceo = (q = "") => `/ceo${q}`;

/** The six steps, in order; the first one not done is «ahora». Links go where each thing is done on the screen. */
export function pasosDe(r: GuiaRead, language: Language = getLanguage()): Paso[] {
  const w = words(PRIMERA_ENTREGA_WORDS, language);
  const p = r.proyecto;
  const enProyecto = p ? ceo(`?proyecto=${encodeURIComponent(p.slug)}`) : ceo("?nuevo");
  const pausado = r.company_paused || r.project_paused;
  const base: Array<Omit<Paso, "estado"> & { hecho: boolean }> = [
    {
      id: "maquina",
      titulo: w.maquina.titulo,
      texto: r.maquina === "lista" ? w.maquina.lista : r.maquina === "falta" ? w.maquina.falta : w.maquina.sinRevisar,
      href: "/machine/falta",
      boton: w.maquina.boton,
      hecho: r.maquina === "lista",
    },
    {
      id: "proyecto",
      titulo: w.proyecto.titulo,
      texto: p ? w.proyecto.existe(p.title) : w.proyecto.nuevo,
      href: p ? enProyecto : ceo("?nuevo"),
      boton: w.proyecto.boton,
      hecho: !!p,
    },
    {
      id: "reanudar",
      titulo: w.reanudar.titulo,
      texto: p && r.company_paused && r.project_paused ? w.reanudar.ambos(p.title) : r.company_paused ? w.reanudar.compania : w.reanudar.proyecto,
      href: p ? ceo(`?proyecto=${encodeURIComponent(p.slug)}&hoja=reanudar:${encodeURIComponent(p.slug)}`) : ceo("?nuevo"),
      boton: w.reanudar.boton,
      ...(p && pausado ? { accion: "reanudar" as const } : {}),
      hecho: !!p && !pausado,
    },
    {
      id: "pedido",
      titulo: w.pedido.titulo,
      texto: w.pedido.texto(w.pedidoSugerido, consumoLinea(r.est_pct_per_run, language)),
      href: enProyecto,
      boton: w.pedido.boton,
      hecho: r.pedido,
    },
    {
      id: "plan",
      titulo: w.plan.titulo,
      texto: r.plan === "espera" ? w.plan.espera : w.plan.nada,
      href: enProyecto,
      boton: w.plan.boton,
      hecho: r.plan === "aprobado",
    },
    {
      id: "entrega",
      titulo: w.entrega.titulo,
      texto: r.entrega === "espera" ? w.entrega.espera : w.entrega.nada,
      href: enProyecto,
      boton: w.entrega.boton,
      hecho: r.entrega === "aceptada",
    },
  ];
  // The machine step never holds the rest back: something optional or slow to fix (backups) must not stop a first
  // delivery. While it is not done it is «ahora» beside the first open step after it.
  const first = base.findIndex((s, i) => i > 0 && !s.hecho);
  return base.map(({ hecho, ...s }, i) => ({ ...s, estado: hecho ? "hecho" : i === 0 || i === first ? "ahora" : "luego" }));
}

/** F6: what the guide's Reanudar resumes in one press: the company when it is stopped, and the first project when it is
 * paused. The project goes first, so a failure in between leaves the company stopped and nothing running. */
export function aReanudar(r: Pick<GuiaRead, "proyecto" | "company_paused" | "project_paused">): { project: string | null; company: boolean } {
  return { project: r.proyecto && r.project_paused ? r.proyecto.slug : null, company: r.company_paused };
}

/** Whether to offer the example project: only while there is no project yet. */
export const ofreceEjemplo = (r: GuiaRead): boolean => !r.proyecto;

/** The words for a run that could not start, or ended because Claude has no session: what happened and the fix. */
export function falloWords(summary: string | null | undefined, language: Language = getLanguage()): ArranqueWords | null {
  return arranqueOf(summary, language);
}
