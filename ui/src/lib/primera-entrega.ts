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
      intro: "Tres pasos y el equipo se pone a trabajar; luego te toca aprobar su plan y aceptar la entrega. Cada paso se marca solo cuando ya está.",
      ejemplo: "Probar con un ejemplo",
      ejemploTexto: "¿No tienes un repositorio a la mano? El ejemplo es un proyecto sin código: su primer trabajo termina en un documento.",
      pedirSugerido: "Pedir esto",
      pausa: "Para detener todo en cualquier momento: Pausar la compañía.",
      falloTitulo: "Algo no dejó arrancar al equipo",
      listo: "Listo",
    },
    consumo: (n: number) => `Una corrida usa más o menos el ${n} % de tu plan de cinco horas, así que este pedido cabe de sobra.`,
    maquina: {
      titulo: "Requisitos del entorno",
      lista: "Tiene todo lo que Plania necesita.",
      falta: "Le falta algo: revísalo y sigue el arreglo de cada cosa.",
      sinRevisar: "Valida los requisitos necesarios para iniciar el proyecto. Esta revisión no impide continuar con los siguientes pasos.",
      boton: "Ver qué falta",
    },
    proyecto: {
      titulo: "Agrega tu primer proyecto",
      existe: (title: string) => `${title} ya existe.`,
      nuevo: "Uno nuevo, o uno que ya tiene código: en esta máquina, en GitHub o por SSH. Empieza en pausa, con su equipo.",
      boton: "Agregar proyecto",
    },
    reanudar: {
      titulo: "Iniciar proyecto",
      compania: "La compañía empieza detenida: reanúdala para que el equipo pueda trabajar.",
      proyecto: "Un proyecto nuevo empieza en pausa: nada corre hasta que lo reanudes.",
      // F6: the company and the first project both start paused; one press resumes the two.
      ambos: (title: string) => `La compañía y ${title} empiezan en pausa. «Iniciar proyecto» pone a andar los dos con un solo botón.`,
      boton: "Reanudar",
      reanudando: "Reanudando…",
      fallo: "No se pudo reanudar. Intenta de nuevo.",
    },
    pedido: {
      titulo: "Define una primera tarea",
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
    // The short card on Inicio and the wizard it opens (steps 1 to 4; 5 and 6 wait for the team).
    tarjeta: {
      progreso: (hechos: number, total: number) => `${hechos} de ${total} listos`,
      paso: (n: number, total: number) => `Paso ${n} de ${total}`,
      empezar: "Empezar",
      continuar: "Continuar",
      esperando: "Ahora le toca al equipo: te avisamos aquí cuando haya algo que ver.",
      maquina: "Falta revisar los requisitos del entorno.",
      verMaquina: "Revisarlos",
    },
    asistente: {
      titulo: "Prepara tu primera entrega",
      intro: "Tres pasos y el equipo se pone a trabajar. Puedes cerrar y seguir después: cada paso queda hecho.",
      etiquetas: { maquina: "Requisitos", proyecto: "Proyecto", iniciar: "Iniciar" } as Record<PasoAsistente, string>,
      atras: "Atrás",
      continuar: "Continuar",
      cerrar: "Cerrar",
      // Step 1: the requirements' body is always the same sentence; the list shows under it once checked.
      maquinaCuerpo: "Valida los requisitos necesarios para iniciar el proyecto. Esta revisión no impide continuar con los siguientes pasos.",
      revisar: "Revisar",
      reintentar: "Reintentar",
      // One line per state of the check: running (first time, or again over the last list) and failed.
      revisandoPrimera: "Revisando los requisitos… la prueba de Claude tarda unos segundos.",
      revisandoOtraVez: "Revisando otra vez… la lista aparece al terminar.",
      revisarFallo: "No se pudo completar la revisión. Pulsa «Reintentar» para intentarlo otra vez.",
      agregar: "Agregar proyecto",
      ejemploO: "¿No tienes un repositorio a la mano?",
      // Step 2 once the project exists: what it is, and what is left to set up (none of it stops a start, or some does).
      agregadoCuerpo: (title: string, pausado: boolean) =>
        pausado ? `El proyecto ${title} ya existe y está agregado, pero permanece en pausa junto con su equipo.` : `El proyecto ${title} ya existe y está agregado, con su equipo.`,
      pendientes: (n: number) => (n === 1 ? "Hay 1 elemento pendiente de configuración." : `Hay ${n} elementos pendientes de configuración.`),
      pendientesNinguno: "Ninguno impide iniciar el proyecto; pueden completarse posteriormente desde",
      pendientesAlguno: "Los marcados impiden que el equipo trabaje; complétalos desde",
      // The places themselves (Ajustes, Despliegue) are links worded in lib/listo.ts; o joins two of them.
      o: "o",
      pendientesNingunoSolo: "Ninguno impide iniciar el proyecto.",
      pendientesAlgunoSolo: "Los marcados impiden que el equipo trabaje.",
      impide: "impide trabajar",
      // Step 3, first part: the project's state, and the button that starts it (and the company).
      iniciarTitulo: "Estado del proyecto",
      iniciarCuerpo: (title: string) => `El proyecto ${title} y su compañía ya están configurados y listos para iniciar su ejecución.`,
      iniciar: "Iniciar proyecto",
      iniciando: "Iniciando",
      iniciado: "Proyecto iniciado",
      enPausa: "En pausa",
      activo: "Activo",
      // Step 3, second part: the first task.
      tareaTitulo: "Define una primera tarea",
      tareaCuerpo: "Establece una tarea sencilla y corta que permita completar una primera ejecución. El ejemplo puede modificarse.",
      tareaAntes: "Inicia el proyecto para enviarle su primera tarea.",
      yaPediste: "Ya le pediste algo al equipo. El responsable del proyecto te propondrá un plan.",
      pedirYTerminar: "Pedir y terminar",
      pidiendo: "Pidiendo…",
      pedidoFallo: "No se pudo enviar el pedido. Intenta de nuevo.",
      terminado: "Listo: el equipo tiene tu pedido. Te avisamos en Inicio cuando haya un plan para aprobar.",
      terminar: "Terminar",
    },
  },
  en: {
    pedidoSugerido: "Write a short document that says what this project is, who it is for and what its first three steps would be.",
    ejemploProyecto: { name: "Example", goal: "Try Plania with a small first job that ends in a document." },
    guia: {
      titulo: "Your first delivery",
      intro: "Three steps and the team gets to work; then you approve its plan and accept the delivery. Each step ticks itself once it is done.",
      ejemplo: "Try an example",
      ejemploTexto: "No repository at hand? The example is a project with no code: its first job ends in a document.",
      pedirSugerido: "Ask for this",
      pausa: "To stop everything at any moment: Pause the company.",
      falloTitulo: "Something kept the team from starting",
      listo: "Done",
    },
    consumo: (n: number) => `A run uses about ${n} % of your five-hour plan, so this request fits easily.`,
    maquina: {
      titulo: "Environment requirements",
      lista: "It has everything Plania needs.",
      falta: "Something is missing: check it and follow the fix for each thing.",
      sinRevisar: "Checks what is needed to start the project. This check does not stop you from going on to the next steps.",
      boton: "See what's missing",
    },
    proyecto: {
      titulo: "Add your first project",
      existe: (title: string) => `${title} already exists.`,
      nuevo: "A new one, or one that already has code: on this machine, on GitHub or over SSH. It starts paused, with its team.",
      boton: "Add project",
    },
    reanudar: {
      titulo: "Start the project",
      compania: "The company starts stopped: resume it so the team can work.",
      proyecto: "A new project starts paused: nothing runs until you resume it.",
      ambos: (title: string) => `The company and ${title} start paused. «Start the project» starts both with one button.`,
      boton: "Resume",
      reanudando: "Resuming…",
      fallo: "It could not resume. Try again.",
    },
    pedido: {
      titulo: "Set a first task",
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
    tarjeta: {
      progreso: (hechos: number, total: number) => `${hechos} of ${total} done`,
      paso: (n: number, total: number) => `Step ${n} of ${total}`,
      empezar: "Start",
      continuar: "Continue",
      esperando: "Now it's the team's turn: you'll see it here when there is something to look at.",
      maquina: "The environment requirements are still to be checked.",
      verMaquina: "Check them",
    },
    asistente: {
      titulo: "Get your first delivery going",
      intro: "Three steps and the team gets to work. You can close and come back: each step stays done.",
      etiquetas: { maquina: "Requirements", proyecto: "Project", iniciar: "Start" },
      atras: "Back",
      continuar: "Continue",
      cerrar: "Close",
      maquinaCuerpo: "Checks what is needed to start the project. This check does not stop you from going on to the next steps.",
      revisar: "Check",
      reintentar: "Try again",
      revisandoPrimera: "Checking the requirements… the Claude test takes a few seconds.",
      revisandoOtraVez: "Checking again… the list shows when it's done.",
      revisarFallo: "The check could not finish. Press «Try again» to run it again.",
      agregar: "Add project",
      ejemploO: "No repository at hand?",
      agregadoCuerpo: (title: string, pausado: boolean) =>
        pausado ? `The project ${title} already exists and is added, but it stays paused along with its team.` : `The project ${title} already exists and is added, with its team.`,
      pendientes: (n: number) => (n === 1 ? "There is 1 item left to set up." : `There are ${n} items left to set up.`),
      pendientesNinguno: "None of them stops the project from starting; they can be done later from",
      pendientesAlguno: "The marked ones stop the team from working; finish them from",
      o: "or",
      pendientesNingunoSolo: "None of them stops the project from starting.",
      pendientesAlgunoSolo: "The marked ones stop the team from working.",
      impide: "stops work",
      iniciarTitulo: "Project status",
      iniciarCuerpo: (title: string) => `The project ${title} and its company are set up and ready to start running.`,
      iniciar: "Start the project",
      iniciando: "Starting",
      iniciado: "Project started",
      enPausa: "Paused",
      activo: "Running",
      tareaTitulo: "Set a first task",
      tareaCuerpo: "Set a simple, short task that can finish in a first run. You can change the example.",
      tareaAntes: "Start the project to send it its first task.",
      yaPediste: "You already asked the team for something. The project's lead will propose a plan to you.",
      pedirYTerminar: "Ask and finish",
      pidiendo: "Asking…",
      pedidoFallo: "The request could not be sent. Try again.",
      terminado: "Done: the team has your request. You'll see it on Inicio when there is a plan to approve.",
      terminar: "Finish",
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

// The wizard on Inicio holds the first four steps of the card in three: its third, «Iniciar», starts the project and
// sends the first task (the card's reanudar and pedido). Plan and delivery wait for the team, so they stay on the card.
export type PasoAsistente = "maquina" | "proyecto" | "iniciar";
export const PASOS_ASISTENTE: readonly PasoAsistente[] = ["maquina", "proyecto", "iniciar"];
export const PASOS_DE_ASISTENTE: Record<PasoAsistente, readonly PasoId[]> = { maquina: ["maquina"], proyecto: ["proyecto"], iniciar: ["reanudar", "pedido"] };
const asistenteDe = (id: PasoId): number => PASOS_ASISTENTE.findIndex((a) => PASOS_DE_ASISTENTE[a].includes(id));
/** Whether a wizard step is done: all the card's steps it holds are. */
export const asistenteHecho = (a: PasoAsistente, pasos: Paso[]): boolean => PASOS_DE_ASISTENTE[a].every((id) => pasos.find((p) => p.id === id)?.estado === "hecho");

/**
 * The short card, in the wizard's three steps: how many are done, one segment each, and the step to show. Inside a
 * wizard step the card shows the guide step it is on (iniciar: start the project, then the first task). The machine
 * never holds the rest back: once a later step is done the card shows the next open one and keeps the machine as a
 * side note (maquinaPendiente). With the three done the team works: the card shows the plan or the delivery, with no
 * step number (n null) and outside the wizard.
 */
export function tarjetaDe(pasos: Paso[]): {
  hechos: number;
  total: number;
  segmentos: Array<{ id: PasoAsistente; hecho: boolean }>;
  actual: Paso | null;
  n: number | null;
  enAsistente: boolean;
  maquinaPendiente: boolean;
} {
  const segmentos = PASOS_ASISTENTE.map((id) => ({ id, hecho: asistenteHecho(id, pasos) }));
  const maquinaHecha = segmentos[0]!.hecho;
  const resto = segmentos.findIndex((s, i) => i > 0 && !s.hecho);
  const empezado = segmentos.some((s, i) => i > 0 && s.hecho);
  const i = !maquinaHecha && !empezado ? 0 : resto;
  const abierto = (ids: readonly PasoId[]) => ids.map((id) => pasos.find((p) => p.id === id)!).find((p) => p.estado !== "hecho") ?? null;
  const actual = i >= 0 ? abierto(PASOS_DE_ASISTENTE[PASOS_ASISTENTE[i]!]) : abierto(["plan", "entrega"]);
  return {
    hechos: segmentos.filter((s) => s.hecho).length,
    total: PASOS_ASISTENTE.length,
    segmentos,
    actual,
    n: i >= 0 ? i + 1 : null,
    enAsistente: i >= 0,
    maquinaPendiente: !maquinaHecha && i !== 0,
  };
}

/** The wizard's first step when it opens: the one holding the card's step, else the first of its three not done. */
export function pasoInicial(pasos: Paso[]): number {
  const t = tarjetaDe(pasos);
  const i = t.actual ? asistenteDe(t.actual.id) : -1;
  if (i >= 0) return i;
  const abierto = PASOS_ASISTENTE.findIndex((a) => !asistenteHecho(a, pasos));
  return abierto < 0 ? PASOS_ASISTENTE.length - 1 : abierto;
}

/** Whether the wizard may go on from a step. The machine never holds the rest back; the others need their step done. */
export function puedeSeguir(id: PasoAsistente, pasos: Paso[]): boolean {
  if (id === "maquina") return true;
  return asistenteHecho(id, pasos);
}

/** Whether the stepper may jump to a step: every required step before it is done (the machine is optional). */
export function alcanzable(i: number, pasos: Paso[]): boolean {
  return PASOS_ASISTENTE.slice(0, i).every((a) => a === "maquina" || asistenteHecho(a, pasos));
}

/** Step 1's state: never checked, checking (with or without a list already shown), the list, or a real failure. A
 * failure is only shown when nothing is running, so a check in progress never reads as a failed one. */
export type RequisitosFase = "sin_revisar" | "revisando" | "revisando_otra_vez" | "listo" | "error";
export function requisitosFase(s: { pedido: boolean; corriendo: boolean; hayLectura: boolean; fallo: boolean }): RequisitosFase {
  if (s.corriendo) return s.hayLectura ? "revisando_otra_vez" : "revisando";
  if (!s.pedido) return "sin_revisar";
  if (s.fallo) return "error";
  return s.hayLectura ? "listo" : "sin_revisar";
}

/** Whether to offer the example project: only while there is no project yet. */
export const ofreceEjemplo = (r: GuiaRead): boolean => !r.proyecto;

/** The words for a run that could not start, or ended because Claude has no session: what happened and the fix. */
export function falloWords(summary: string | null | undefined, language: Language = getLanguage()): ArranqueWords | null {
  return arranqueOf(summary, language);
}
