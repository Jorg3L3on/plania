// PLA-I64-1 (PLA-IDEA28, boards A1 and A3): a project's things in one list. A pedido is an idea, an idea becomes an
// initiative, and a loose step is a thing of its own; each shows once, on one thread, grouped by what it needs:
//   toca    something waits on the owner (a delivery, a question, «Constrúyelo», a stuck «Constrúyelo», Cerrar,
//           a request nobody took, Publicar)
//   mueve   someone works on it now
//   fila    it starts by itself or is in review: it does not need him
//   quieto  it does not move by itself; it says what it waits for and carries the lever that moves it
//   hecho   finished initiatives and loose steps (a summary, not rows of work)
// Pure: it reads what GET /api/company (the project, its board, its pedidos, the decisions, the server's move) and
// GET /api/company/projects/:slug/ficha (open ideas with their state, which idea became which initiative) give.
import type { Decision, DecisionAction, EtapaHolder, EtapaId, FichaIdea, OrgFicha, OrgMoveAction, OrgProject, PedidoState, PedidoStop, ProjectTicket, Tokens } from "./api";
import { etapaWord, wordOf } from "./etapas";
import { ideaName } from "./nombre";
import { seatName } from "./corriente";
import { LOCALE } from "./locale";
import { arranqueLine } from "./arranque";
import { prodWaits, publicarWords } from "./publicar";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

// ---- words

/** The nine stops of a thing's thread (PLA-IDEA27): six idea stops, the valve, construction, published. */
export const PARADAS = ["buzon", "entendido", "investigacion", "diseno", "plan", "lista", "valvula", "construccion", "publicado"] as const;
export type Parada = (typeof PARADAS)[number];
const IDEA_STOPS: readonly PedidoStop[] = ["buzon", "entendido", "investigacion", "diseno", "plan", "lista"];
const STAGE_STOP: Record<string, PedidoStop> = { idea: "entendido", research: "investigacion", design: "diseno", planning: "plan", ready: "lista" };

export type Tipo = "pedido" | "idea" | "iniciativa" | "suelto" | "decision" | "publicar" | "jugada";

export const GRUPOS = ["toca", "mueve", "fila", "quieto", "hecho"] as const;
export type Grupo = (typeof GRUPOS)[number];

// PLA-I2-10: every word of the list and its sentence, in both languages. The Spanish constants (PARADA_NAME,
// TIPO_NAME, GRUPO_NAME, RETRY) stay for callers that read them; cosasOf and fraseOf take the language last.
export const COSAS_WORDS = defineWords({
  es: {
    paradas: {
      buzon: "Buzón",
      entendido: "Entendido",
      investigacion: "Investigación",
      diseno: "Diseño",
      plan: "Plan",
      lista: "Lista",
      valvula: "Constrúyelo",
      construccion: "Construcción",
      publicado: "Publicado",
    } as Record<Parada, string>,
    /** PLA-62: the short names, when the thread is narrow (hilo.tsx). */
    paradasShort: { entendido: "Entend.", investigacion: "Invest.", publicado: "Public." } as Partial<Record<Parada, string>>,
    tipos: { pedido: "Pedido tuyo", idea: "Idea", iniciativa: "Iniciativa", suelto: "Paso suelto", decision: "Decisión", publicar: "Publicar", jugada: "Tu jugada" } as Record<Tipo, string>,
    grupos: { toca: "Te toca", mueve: "Se mueve", fila: "En fila", quieto: "Quieto", hecho: "Hecho" } as Record<Grupo, string>,
    retry: "Volver a intentar",
    quote: (s: string) => `«${s}»`,
    // A loose step's sentence without its title: «X» está lista → Está lista.
    ownIs: " está ",
    ownIsCap: "Está ",
    listaPaused: (t: string) => `${t} está lista: arranca cuando reanudes.`,
    lista: (t: string) => `${t} está lista: arranca sola.`,
    enQa: (t: string) => `${t} está en QA: no te necesita.`,
    // PLA-I74-5: the step's turn (src/state/turn.ts) says who has it next.
    queuedRun: (t: string, who: string) => `${t}: en cola, ${who} la toma en cuanto pueda.`,
    busyWorker: (t: string, who: string) => `${t}: ${who} la toma al terminar lo que hace.`,
    outsideUntil: (t: string, what: string, at: string) => `${t}: espera ${what}, a más tardar a las ${at}.`,
    outsideOn: { ci: "las pruebas de GitHub", photos: "las fotos de la entrega", review: "la revisión", merge: "la integración", deploy: "el despliegue", close: "que Plania la cierre", env: "el entorno", time: "la hora indicada" } as Record<string, string>,
    enRevisionWhy: (t: string, why: string) => `${t}: ${why}. No te necesita.`,
    enRevision: (t: string) => `${t} está en revisión: no te necesita.`,
    integrado: (t: string) => `${t} ya está en la copia de prueba: espera publicación.`,
    beingFixed: "la están arreglando.",
    seePlan: "Ver el plan",
    answer: "Responder",
    decide: "Decidir",
    of: (done: number, total: number) => `${done} de ${total}`,
    aDelivery: "Una entrega",
    delivered: "entregada: espera que la aceptes.",
    manyDelivered: (n: number) => `Taller entregó ${n} pasos; cada uno espera que lo aceptes o pidas ajuste.`,
    waitsForYou: "Te espera",
    manyWaitForYou: (n: number) => `${n} te esperan`,
    closeIt: "Todos sus pasos están hechos: ciérrala.",
    readyToClose: "Lista para cerrar",
    couldNotStartLine: "No pudo arrancar.",
    couldNotStart: "No pudo arrancar",
    someone: "Alguien",
    works: (who: string, t: string) => `${who} trabaja ${t}.`,
    missingStep: (t: string, why: string) => `Falta ${t}. ${why}`,
    stepsDone: "Sus pasos están hechos: espera publicarse.",
    noStepsYet: "Sin pasos todavía.",
    done: "Hecha",
    noSteps: "Sin pasos",
    docMissing: (d: string) => `Falta el doc ${d}.`,
    poAsks: "El PO te pregunta algo.",
    asksYou: (stop: string) => `${stop} · te pregunta`,
    putsOnBoard: (seat: string) => `${seat} la sube al tablero.`,
    movingToBoard: "Pasando al tablero",
    stuckValve: "Dijiste «Constrúyelo» y nadie la está subiendo al tablero.",
    stuck: "Atorada",
    planReady: "El plan está: «Constrúyelo» la sube al tablero.",
    readyToBuild: "Lista para construir",
    theTeam: "El equipo",
    worksIt: (who: string, stop: string) => `${who} la trabaja: ${stop}.`,
    inboxPaused: "En el buzón: el PO la toma cuando reanudes.",
    inbox: "En el buzón: el PO la toma en su turno.",
    readyIdea: "Lista: el PO la vuelve iniciativa.",
    nobodyWorksIt: (rest: string) => `Nadie la trabaja. ${rest}`,
    atStop: (stop: string) => `Está en ${stop}.`,
    move: {
      fijar: "Sin meta, el equipo no sabe qué va primero.",
      planear: "Lo que sigue no está planeado todavía.",
      arrancar: "Está listo y espera tu señal.",
      ver: "Míralo cuando puedas.",
    } as Record<string, string>,
    nobodyTook: (t: string) => `Nadie tomó ${t}.`,
    notTaken: "Sin tomar",
    asks: (seat: string) => `${seat} pregunta`,
    publishTitle: (title: string) => `Publicar ${title}`,
    acceptedWaits: "Lo aceptado espera publicarse.",
    stepReady: (t: string) => `${t} está listo y espera tu señal.`,
    minutes: (m: number) => `${m} min`,
    hours: (h: number) => `${h} h`,
    days: (d: number) => `${d} días`,
    // Feminine number words (cosa, entrega), 0 to 10.
    numF: ["Cero", "Una", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez"],
    emptyMueve: "Todavía no hay nada aquí.",
    emptySub: "Pide lo primero y se vuelve una fila.",
    emptyFalta: "Cada cosa que pidas avanza sola de Buzón a Lista. Nadie escribe código hasta que digas «Constrúyelo».",
    companyStopped: "La compañía está detenida.",
    projectPaused: (title: string) => `${title} está en pausa.`,
    movingNow: (num: string, n: number) => `${num} ${n === 1 ? "cosa se mueve" : "cosas se mueven"} ahora.`,
    nobodyWorks: "Nadie trabaja ahora.",
    stuckFor: (t: string) => `Tu «Constrúyelo» lleva ${t} sin subir al tablero.`,
    stuckNoTime: "Tu «Constrúyelo» no ha subido al tablero.",
    deliveriesWait: (num: string, n: number) => `${num} ${n === 1 ? "entrega te espera" : "entregas te esperan"}.`,
    thingsWait: (num: string, n: number) => `${num} ${n === 1 ? "cosa te espera" : "cosas te esperan"}.`,
    // The word the deliveries sentence carries (the paused line says «aceptarlas» after it).
    deliveriesWord: "entregas",
    nothingYet: "Todavía no hay nada aquí: pide lo primero, o pide al PO que arme el plan.",
    pausedToca: (one: boolean, company: boolean, fila: number) =>
      `Puedes ${one ? "atenderla" : "aceptarlas"} en pausa. Nada nuevo arranca hasta que ${company ? "reanudes la compañía" : "lo reanudes"}${fila ? `: ${fila === 1 ? "una cosa tiene" : `${fila} cosas tienen`} un paso listo.` : "."}`,
    pausedNothing: "Nada arranca hasta que lo reanudes.",
    stepsLeft: (open: number, total: number, title: string) => `${open === 1 ? "Falta 1 paso" : `Faltan ${open} pasos`} de ${total} para terminar ${title}.`,
    filaWait: (num: string, n: number) => `${num} ${n === 1 ? "cosa espera" : "cosas esperan"} turno; no te necesitan.`,
    nothingElse: "Nada más por ahora.",
  },
  en: {
    paradas: {
      buzon: "Inbox",
      entendido: "Understood",
      investigacion: "Research",
      diseno: "Design",
      plan: "Plan",
      lista: "Ready",
      valvula: "Build it",
      construccion: "Building",
      publicado: "Published",
    },
    paradasShort: { entendido: "Underst.", investigacion: "Research", publicado: "Publ." } as Partial<Record<Parada, string>>,
    tipos: { pedido: "Your request", idea: "Idea", iniciativa: "Initiative", suelto: "Loose step", decision: "Decision", publicar: "Publish", jugada: "Your move" },
    grupos: { toca: "Your turn", mueve: "Moving", fila: "In line", quieto: "Still", hecho: "Done" },
    retry: "Try again",
    quote: (s: string) => `“${s}”`,
    ownIs: " is ",
    ownIsCap: "Is ",
    listaPaused: (t: string) => `${t} is ready: it starts when you resume.`,
    lista: (t: string) => `${t} is ready: it starts by itself.`,
    enQa: (t: string) => `${t} is in QA: it does not need you.`,
    queuedRun: (t: string, who: string) => `${t}: queued, ${who} takes it as soon as it can.`,
    busyWorker: (t: string, who: string) => `${t}: ${who} takes it after what it is doing.`,
    outsideUntil: (t: string, what: string, at: string) => `${t}: waits for ${what}, at the latest by ${at}.`,
    outsideOn: { ci: "GitHub's checks", photos: "the delivery's pictures", review: "the review", merge: "the merge", deploy: "the deploy", close: "Plania to close it", env: "the environment", time: "the set time" } as Record<string, string>,
    enRevisionWhy: (t: string, why: string) => `${t}: ${why}. It does not need you.`,
    enRevision: (t: string) => `${t} is in review: it does not need you.`,
    integrado: (t: string) => `${t} is already on the test copy: it waits to be published.`,
    beingFixed: "it is being fixed.",
    seePlan: "See the plan",
    answer: "Answer",
    decide: "Decide",
    of: (done: number, total: number) => `${done} of ${total}`,
    aDelivery: "A delivery",
    delivered: "delivered: it waits for you to accept it.",
    manyDelivered: (n: number) => `Taller delivered ${n} steps; each waits for you to accept it or ask for changes.`,
    waitsForYou: "Waiting for you",
    manyWaitForYou: (n: number) => `${n} waiting for you`,
    closeIt: "All its steps are done: close it.",
    readyToClose: "Ready to close",
    couldNotStartLine: "It could not start.",
    couldNotStart: "Could not start",
    someone: "Someone",
    works: (who: string, t: string) => `${who} is working on ${t}.`,
    missingStep: (t: string, why: string) => `Still to do: ${t}. ${why}`,
    stepsDone: "Its steps are done: it waits to be published.",
    noStepsYet: "No steps yet.",
    done: "Done",
    noSteps: "No steps",
    docMissing: (d: string) => `The ${d} doc is missing.`,
    poAsks: "The PO is asking you something.",
    asksYou: (stop: string) => `${stop} · asks you`,
    putsOnBoard: (seat: string) => `${seat} is putting it on the board.`,
    movingToBoard: "Moving to the board",
    stuckValve: "You said “Build it” and nobody is putting it on the board.",
    stuck: "Stuck",
    planReady: "The plan is done: “Build it” puts it on the board.",
    readyToBuild: "Ready to build",
    theTeam: "The team",
    worksIt: (who: string, stop: string) => `${who} is working on it: ${stop}.`,
    inboxPaused: "In the inbox: the PO takes it when you resume.",
    inbox: "In the inbox: the PO takes it in its turn.",
    readyIdea: "Ready: the PO turns it into an initiative.",
    nobodyWorksIt: (rest: string) => `Nobody is working on it. ${rest}`,
    atStop: (stop: string) => `It is at ${stop}.`,
    move: {
      fijar: "Without a goal, the team does not know what comes first.",
      planear: "What comes next is not planned yet.",
      arrancar: "It is ready and waits for your signal.",
      ver: "Look at it when you can.",
    },
    nobodyTook: (t: string) => `Nobody took ${t}.`,
    notTaken: "Not taken",
    asks: (seat: string) => `${seat} asks`,
    publishTitle: (title: string) => `Publish ${title}`,
    acceptedWaits: "What you accepted waits to be published.",
    stepReady: (t: string) => `${t} is ready and waits for your signal.`,
    minutes: (m: number) => `${m} min`,
    hours: (h: number) => `${h} h`,
    days: (d: number) => `${d} days`,
    numF: ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"],
    emptyMueve: "There is nothing here yet.",
    emptySub: "Ask for the first thing and it becomes a row.",
    emptyFalta: "Each thing you ask for moves by itself from Inbox to Ready. Nobody writes code until you say “Build it”.",
    companyStopped: "The company is stopped.",
    projectPaused: (title: string) => `${title} is paused.`,
    movingNow: (num: string, n: number) => `${num} ${n === 1 ? "thing is moving" : "things are moving"} now.`,
    nobodyWorks: "Nobody is working now.",
    stuckFor: (t: string) => `Your “Build it” has waited ${t} to reach the board.`,
    stuckNoTime: "Your “Build it” has not reached the board.",
    deliveriesWait: (num: string, n: number) => `${num} ${n === 1 ? "delivery waits for you" : "deliveries wait for you"}.`,
    thingsWait: (num: string, n: number) => `${num} ${n === 1 ? "thing waits for you" : "things wait for you"}.`,
    deliveriesWord: "deliveries",
    nothingYet: "There is nothing here yet: ask for the first thing, or ask the PO to make the plan.",
    pausedToca: (one: boolean, company: boolean, fila: number) =>
      `You can ${one ? "handle it" : "accept them"} while paused. Nothing new starts until you ${company ? "resume the company" : "resume it"}${fila ? `: ${fila === 1 ? "one thing has" : `${fila} things have`} a step ready.` : "."}`,
    pausedNothing: "Nothing starts until you resume it.",
    stepsLeft: (open: number, total: number, title: string) => `${open === 1 ? "1 step" : `${open} steps`} of ${total} left to finish ${title}.`,
    filaWait: (num: string, n: number) => `${num} ${n === 1 ? "thing waits its" : "things wait their"} turn; they do not need you.`,
    nothingElse: "Nothing else for now.",
  },
});
type W = (typeof COSAS_WORDS)["es"];

export const PARADA_NAME: Record<Parada, string> = COSAS_WORDS.es.paradas;
export const TIPO_NAME: Record<Tipo, string> = COSAS_WORDS.es.tipos;
export const GRUPO_NAME: Record<Grupo, string> = COSAS_WORDS.es.grupos;
export const paradaName = (p: Parada, language: Language = getLanguage()): string => words(COSAS_WORDS, language).paradas[p];
export const tipoName = (t: Tipo, language: Language = getLanguage()): string => words(COSAS_WORDS, language).tipos[t];
export const paradaShort = (p: Parada, language: Language = getLanguage()): string => { const w = words(COSAS_WORDS, language); return w.paradasShort[p] ?? w.paradas[p]; };
export const grupoName = (g: Grupo, language: Language = getLanguage()): string => words(COSAS_WORDS, language).grupos[g];

// ---- shapes

/** One step of the construction part of the thread. */
export type TramoTono = "hecho" | "vivo" | "toca" | "fila" | "quieto";
export type Tramo = {
  key: string;
  title: string;
  etapa: EtapaId;
  tono: TramoTono;
  /** PLA-I3-4: what the step's tooltip says about its state: the stage word (wordOf), who holds it, since when.
   *  Optional: the Hecho rows and older callers build a Tramo without them. */
  word?: string;
  holder?: EtapaHolder | null;
  since?: string | null;
};
export type Valvula = "cerrada" | "toca" | "atorada" | "pasando" | "abierta";
export type Hilo = {
  /** Index of the idea stop it stands at (0 Buzón … 5 Lista); null when it never was an idea here. */
  idea: number | null;
  /** How the current idea stop looks: someone works it, it waits on the owner, it waits its turn, nobody moves it. */
  ideaTono: TramoTono | null;
  valvula: Valvula;
  tramos: Tramo[];
  publicado: boolean;
  /** Where it stands on the nine stops. */
  at: Parada;
};

/** The lever on a row: the one action it needs (step 4 draws the buttons; every one is an existing call). */
export type Palanca =
  | { kind: "jugada"; action: OrgMoveAction; decision: string | null }
  | { kind: "decision"; id: string; action: DecisionAction; label: string }
  | { kind: "entregas"; ids: string[] }
  | { kind: "responder"; key: string; question: string }
  | { kind: "construir"; key: string }
  | { kind: "despertar"; key: string }
  | { kind: "cerrar"; key: string; version: number | null }
  | { kind: "reenviar"; key: string }
  | { kind: "publicar" }
  // PLA-I68-1: Publicar waits on a setting (who migrates production): the row links to it instead.
  // PLA-132: that setting is Despliegue's production environment; its Resumen names it with a fix that opens it.
  | { kind: "camino"; sec: string; label: string }
  | { kind: "detener"; run: string }
  // PLA-161: En fila also offers Aplazar, so the owner can hold queued work before Reanudar: a loose step goes back
  // to Backlog (Quieto, where Pasar a Lista undoes it), an initiative goes On hold (its steps read Pospuesto).
  | { kind: "primero"; key: string | null; aplazar: Aplazar }
  | { kind: "lista"; key: string };
export type Aplazar = { key: string; to: "Backlog" | "On hold" };

export type Cosa = {
  key: string;
  tipo: Tipo;
  /** The idea it was born from (an initiative that was a pedido or an idea). */
  idea_key: string | null;
  title: string;
  /** PLA-148 (F-6): an idea's or request's whole text when `title` is its short name (for the hover). */
  full?: string;
  grupo: Exclude<Grupo, "hecho">;
  hilo: Hilo;
  /** What it waits for, in a sentence (the server's reasons, src/api/etapa.ts and the tube). */
  espera: string;
  /** The small caps line above it: «4 DE 5 · DESPUÉS», «ATORADA», «EN REVISIÓN». */
  cap: string;
  palanca: Palanca | null;
  /** The decision(s) waiting on him inside it. */
  decisions: string[];
  /** Since when it stands where it is (the order inside a group). */
  since: string | null;
  /** PLA-I3-3: what an initiative spent (phase 1's roll-up); absent on other things and from older servers. */
  tokens?: Tokens | null;
};
export type Hecha = { key: string; title: string; idea_key: string | null; done_at: string | null };
export type Cosas = {
  grupos: { grupo: Exclude<Grupo, "hecho">; cosas: Cosa[] }[];
  hecho: { iniciativas: Hecha[]; sueltos: number; ultimo_suelto: string | null };
  /** Requests he put on the shelf (Guardar): out of the stream, listed apart (Restaurar is in the idea's Más). */
  guardadas: number;
  guardadasList: { key: string; title: string }[];
  /** Open things in all (Hecho not counted). */
  abiertas: number;
};

export type CosasInput = {
  p: OrgProject;
  decisions: Decision[];
  /** The ficha read; null while it loads (then pedidos stand in for ideas). */
  ficha: Pick<OrgFicha, "ideas" | "promoted"> | null;
  companyPaused?: boolean;
};

// ---- helpers

const DONE: ReadonlySet<EtapaId> = new Set(["hecho", "publicado", "integrado"]);
const QUIET: ReadonlySet<EtapaId> = new Set(["despues", "pospuesto", "en_espera", "bloqueado", "sin_dueno"]);
const byKey = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
const isPending = (d: Decision) => d.state === null && (d.actions.length > 0 || d.kind === "release");
const isDelivery = (d: Decision) => (d.kind === "deliverable" || d.kind === "pr") && d.actions.some((a) => a === "aceptar" || a === "fusionar");
const refsOf = (d: Decision) => [d.ref, ...(d.links ?? []).filter((l) => l.kind === "ticket").map((l) => l.ref)].filter((x): x is string => !!x);

// PLA-I74-5: someone works it this minute only when its turn says an agent is working (a live run); a server before
// the turn sends etapa.live alone.
export const isWorking = (t: Pick<ProjectTicket, "etapa" | "turn">): boolean => (t.turn ? t.turn.turn === "agent_working" : t.etapa.live);

export function tonoOf(t: Pick<ProjectTicket, "etapa" | "turn">, paused: boolean): TramoTono {
  const e = t.etapa;
  if (DONE.has(e.etapa)) return "hecho";
  if (e.etapa === "te_toca") return "toca";
  if (isWorking(t) && !paused) return "vivo";
  if (QUIET.has(e.etapa)) return "quieto";
  return "fila";
}

const runOn = (key: string, p: OrgProject): string | null => p.team.find((m) => m.state === "running" && m.now?.ticket === key)?.now?.run_id ?? null;
const workerOn = (key: string, p: OrgProject) => p.team.find((m) => m.state === "running" && m.now?.ticket === key) ?? null;

/** NEWPROJ-5: the teammate whose next start is this step (its hold, else its queue). */
const starterOf = (key: string, p: OrgProject): string | null =>
  p.team.find((m) => m.next_start?.key === key)?.agent ?? p.team.find((m) => (m.queue ?? []).some((q) => q.key === key))?.agent ?? null;
/** NEWPROJ-5: the retry on a step whose run could not start (Spanish; the rows read the screen's language). */
export const RETRY = COSAS_WORDS.es.retry;

/** The next step that is not done, in phase order then key order. */
const focusOf = (ts: ProjectTicket[], paused: boolean, tono: TramoTono) =>
  [...ts].sort((a, b) => (a.phase ?? 999) - (b.phase ?? 999) || byKey(a.key, b.key)).find((t) => tonoOf(t, paused) === tono) ?? null;

/** The lever that moves a quiet step: Pasar a Lista when it sits in Backlog for no reason but that. */
function quietLever(t: ProjectTicket): Palanca | null {
  return t.status === "Backlog" && t.etapa.etapa === "despues" && !(t.etapa.reason ?? "").startsWith("Espera a") ? { kind: "lista", key: t.key } : null;
}

function filaWords(t: ProjectTicket, paused: boolean, w: W, language: Language, p?: OrgProject): string {
  const e = t.etapa.etapa;
  const q = w.quote(t.title);
  // PLA-I74-5: the queued and outside waits read the step's turn.
  const turn = t.turn;
  const seat = (agent: string | null) => {
    const m = agent ? p?.team.find((x) => x.agent === agent) : undefined;
    return m ? seatName(m.role) : w.theTeam;
  };
  if (!paused && turn?.turn === "agent_queued" && turn.reason === "run_queued") return w.queuedRun(q, seat(turn.agent));
  if (!paused && turn?.turn === "agent_queued" && turn.reason === "agent_busy") return w.busyWorker(q, seat(turn.agent));
  if (turn?.turn === "outside" && turn.until) {
    const at = new Date(turn.until).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
    return w.outsideUntil(q, w.outsideOn[turn.on] ?? w.outsideOn.env!, at);
  }
  if (e === "lista") return paused ? w.listaPaused(q) : w.lista(q);
  if (e === "en_qa") return w.enQa(q);
  if (e === "en_revision") return t.etapa.reason ? w.enRevisionWhy(q, t.etapa.reason.replace(/\.$/, "")) : w.enRevision(q);
  if (e === "integrado") return w.integrado(q);
  if (e === "devuelto") return `${q}: ${t.etapa.reason ?? w.beingFixed}`;
  return `${q}: ${t.etapa.reason ?? etapaWord(e, language)}`;
}

/** The decision the server's move points at, if any. */
const moveDecision = (p: OrgProject) => (p.next_move?.origen.kind === "decision" ? p.next_move.origen.id : null);

function decisionLever(d: Decision, p: OrgProject, w: W): Palanca {
  if (moveDecision(p) === d.id && p.next_move) return { kind: "jugada", action: p.next_move.accion, decision: d.id };
  if (isDelivery(d)) return { kind: "entregas", ids: [d.id] };
  const action = d.actions[0] ?? "responder";
  return { kind: "decision", id: d.id, action, label: d.kind === "plan" ? w.seePlan : d.kind === "question" ? w.answer : w.decide };
}

// ---- the read

/** A ticket-made thing (an initiative or a loose step) from its steps. */
function ticketThing(
  base: { key: string; tipo: "iniciativa" | "suelto"; title: string; idea_key: string | null; ideaDone: boolean; tokens: Tokens | null },
  ts: ProjectTicket[],
  ctx: { p: OrgProject; paused: boolean; mine: Decision[]; canClose: boolean; version: number | null; done: number; total: number; w: W; language: Language },
): Cosa {
  const { p, paused, w, language } = ctx;
  const quote = w.quote;
  const tramos: Tramo[] = [...ts]
    .sort((a, b) => (a.phase ?? 999) - (b.phase ?? 999) || byKey(a.key, b.key))
    .map((t) => ({ key: t.key, title: t.title, etapa: t.etapa.etapa, tono: tonoOf(t, paused), word: wordOf(t.etapa, language), holder: t.etapa.holder, since: t.etapa.since }));
  const keys = new Set([base.key, ...ts.map((t) => t.key)]);
  const decisions = ctx.mine.filter((d) => refsOf(d).some((r) => keys.has(r)));
  const deliveries = decisions.filter(isDelivery);
  const allDone = tramos.length > 0 && tramos.every((t) => t.tono === "hecho");
  const hilo: Hilo = {
    idea: base.ideaDone ? IDEA_STOPS.length - 1 : null,
    ideaTono: base.ideaDone ? "hecho" : null,
    valvula: "abierta",
    tramos,
    publicado: allDone && ts.every((t) => t.etapa.etapa === "publicado" || t.etapa.etapa === "hecho"),
    at: allDone ? "publicado" : "construccion",
  };
  const count = base.tipo === "iniciativa" ? w.of(ctx.done, ctx.total) : null;
  const cap = (word: string) => [count, word].filter(Boolean).join(" · ").toUpperCase();
  const since = (t: ProjectTicket | null) => t?.etapa.since ?? null;
  // A loose step is its own only step: its sentence does not repeat its title.
  const own = (e: string) => {
    if (base.tipo !== "suelto" || !e.startsWith(quote(base.title))) return e;
    const after = e.slice(quote(base.title).length);
    const rest = after.startsWith(": ") ? after.slice(2) : after.startsWith(w.ownIs) ? w.ownIsCap + after.slice(w.ownIs.length) : after;
    return rest ? rest[0]!.toUpperCase() + rest.slice(1) : e;
  };
  const out = (grupo: Cosa["grupo"], espera: string, word: string, palanca: Palanca | null, s: string | null): Cosa => ({ ...base, grupo, hilo, espera: own(espera), cap: cap(word), palanca, decisions: decisions.map((d) => d.id), since: s });

  // Te toca: deliveries, another decision on one of its steps, Cerrar.
  const tocaT = ts.filter((t) => tonoOf(t, paused) === "toca");
  if (deliveries.length > 0 || tocaT.length > 0) {
    const nd = Math.max(deliveries.length, tocaT.length);
    const first = deliveries[0] ?? null;
    const palanca: Palanca = first && moveDecision(p) && deliveries.some((d) => d.id === moveDecision(p)) && p.next_move
      ? { kind: "jugada", action: p.next_move.accion, decision: moveDecision(p) }
      : { kind: "entregas", ids: deliveries.map((d) => d.id) };
    const t0 = tocaT[0] ?? null;
    const espera = nd === 1 ? `${t0 ? quote(t0.title) : (first?.title ?? w.aDelivery)}: ${t0?.etapa.reason ?? w.delivered}` : w.manyDelivered(nd);
    return out("toca", espera, nd === 1 ? w.waitsForYou : w.manyWaitForYou(nd), palanca, since(t0) ?? first?.at ?? null);
  }
  const other = decisions[0];
  if (other) return out("toca", other.title, w.tipos.decision, decisionLever(other, p, w), other.at);
  if (base.tipo === "iniciativa" && ctx.canClose) return out("toca", w.closeIt, w.readyToClose, { kind: "cerrar", key: base.key, version: ctx.version }, null);

  // NEWPROJ-5: a step whose newest run could not start waits on the owner: what happened and what to fix, and a retry
  // (never «Que empiece ya», nor «arranca sola», while that cause may stand).
  const roto = [...ts].sort((a, b) => (a.phase ?? 999) - (b.phase ?? 999) || byKey(a.key, b.key)).find((t) => t.arranque && !isWorking(t) && tonoOf(t, paused) !== "hecho");
  if (roto) {
    const line = arranqueLine(roto.arranque!.summary, language) ?? w.couldNotStartLine;
    const agent = starterOf(roto.key, p);
    const palanca: Palanca | null = agent && !paused ? { kind: "jugada", action: { kind: "start", agent, label: w.retry }, decision: null } : null;
    return out("toca", base.tipo === "iniciativa" ? `${quote(roto.title)}: ${line}` : line, w.couldNotStart, palanca, roto.arranque!.at ?? since(roto));
  }

  // Se mueve: someone works one of its steps now.
  const vivo = focusOf(ts, paused, "vivo");
  if (vivo) {
    const m = workerOn(vivo.key, p);
    const who = m ? seatName(m.role) : vivo.etapa.holder ? seatName(vivo.etapa.holder.role) : w.someone;
    const run = runOn(vivo.key, p);
    return out("mueve", w.works(who, quote(vivo.title)), etapaWord(vivo.etapa.etapa, language), run ? { kind: "detener", run } : null, m?.now?.since ?? since(vivo));
  }
  // En fila: it starts by itself or is in review.
  const fila = focusOf(ts, paused, "fila");
  if (fila) {
    const aplazar: Aplazar = base.tipo === "iniciativa" ? { key: base.key, to: "On hold" } : { key: fila.key, to: "Backlog" };
    const lever: Palanca | null = fila.etapa.etapa === "lista" ? { kind: "primero", key: p.next_first !== fila.key ? fila.key : null, aplazar } : null;
    return out("fila", filaWords(fila, paused, w, language, p), etapaWord(fila.etapa.etapa, language), lever, since(fila));
  }
  // Quieto: the first step that does not move, with its reason and its lever.
  const q = focusOf(ts, paused, "quieto");
  if (q) {
    const why = q.etapa.reason ?? etapaWord(q.etapa.etapa, language);
    const espera = base.tipo === "iniciativa" ? w.missingStep(quote(q.title), why) : why;
    return out("quieto", espera, etapaWord(q.etapa.etapa, language), quietLever(q), since(q));
  }
  // Every step landed but the initiative is not closed (it waits to be published or closed by Plania).
  return out("fila", allDone ? w.stepsDone : w.noStepsYet, allDone ? w.done : w.noSteps, null, null);
}

/** An idea not promoted yet: a pedido (origin owner) or the team's idea. */
function ideaThing(i: { key: string; title: string; origin: string | null; stop: PedidoStop; state: PedidoState | null; question: { id: string; text: string } | null; waits: string | null; at: string | null; ordered_at?: string | null }, ctx: { p: OrgProject; paused: boolean; mine: Decision[]; w: W }): Cosa {
  const { p, paused, w } = ctx;
  const tipo: Tipo = i.origin === "owner" ? "pedido" : "idea";
  const worker = workerOn(i.key, p);
  const live = !!worker && !paused;
  const decisions = ctx.mine.filter((d) => refsOf(d).includes(i.key));
  const at = IDEA_STOPS.indexOf(i.stop);
  const valve = i.state === "valvula";
  const hilo = (ideaTono: TramoTono, valvula: Valvula): Hilo => ({ idea: at, ideaTono, valvula, tramos: [], publicado: false, at: valvula === "atorada" || valvula === "pasando" ? "valvula" : i.stop });
  // PLA-148 (F-6): the short name on the row; the whole text on hover.
  const name = ideaName(i.title) || i.title;
  const base = { key: i.key, tipo, idea_key: null, title: name, ...(name !== i.title ? { full: i.title } : {}), decisions: decisions.map((d) => d.id) };
  const stopName = w.paradas[i.stop];
  const waits = i.waits ? i.waits.replace(/^Doc (\w+)$/, (_m, d: string) => w.docMissing(d)) : null;

  if (i.question || i.state === "espera") {
    const text = i.question?.text ?? waits ?? w.poAsks;
    return { ...base, grupo: "toca", hilo: hilo("toca", "cerrada"), espera: text, cap: w.asksYou(stopName).toUpperCase(), palanca: { kind: "responder", key: i.key, question: i.question?.id ?? "" }, since: i.at };
  }
  const d = decisions[0];
  if (d) return { ...base, grupo: "toca", hilo: hilo("toca", "cerrada"), espera: d.title, cap: stopName.toUpperCase(), palanca: decisionLever(d, p, w), since: d.at };
  if (valve && live) return { ...base, grupo: "mueve", hilo: hilo("hecho", "pasando"), espera: w.putsOnBoard(seatName(worker!.role)), cap: w.movingToBoard, palanca: worker?.now?.run_id ? { kind: "detener", run: worker.now.run_id } : null, since: worker?.now?.since ?? i.at };
  // PLA-62: the valve's clock is the «Constrúyelo» itself, not the idea's last edit.
  if (valve) return { ...base, grupo: "toca", hilo: hilo("hecho", "atorada"), espera: w.stuckValve, cap: w.stuck, palanca: { kind: "despertar", key: i.key }, since: i.ordered_at ?? i.at };
  if (i.stop === "lista" && tipo === "pedido") return { ...base, grupo: "toca", hilo: hilo("hecho", "toca"), espera: w.planReady, cap: w.readyToBuild, palanca: { kind: "construir", key: i.key }, since: i.at };
  if (live || i.state === "trabajando") {
    const who = worker ? seatName(worker.role) : w.theTeam;
    return { ...base, grupo: "mueve", hilo: hilo("vivo", "cerrada"), espera: w.worksIt(who, stopName), cap: stopName.toUpperCase(), palanca: worker?.now?.run_id ? { kind: "detener", run: worker.now.run_id } : null, since: worker?.now?.since ?? i.at };
  }
  if (i.state === "cola") return { ...base, grupo: "fila", hilo: hilo("fila", "cerrada"), espera: paused ? w.inboxPaused : w.inbox, cap: stopName.toUpperCase(), palanca: null, since: i.at };
  // Quieta: nobody works it; it says what its stop still needs.
  const espera = i.stop === "lista" ? w.readyIdea : w.nobodyWorksIt(waits && waits !== "Puede avanzar" ? waits : w.atStop(stopName));
  return { ...base, grupo: "quieto", hilo: hilo("quieto", "cerrada"), espera, cap: stopName.toUpperCase(), palanca: paused ? null : { kind: "despertar", key: i.key }, since: i.at };
}


// Te toca: the row carrying the server's move first (it gets the screen's white button and matches the sentence),
// then the longest waiting.
const ORDER_TOCA = (a: Cosa, b: Cosa) => Number(b.palanca?.kind === "jugada") - Number(a.palanca?.kind === "jugada") || (a.since ?? "9").localeCompare(b.since ?? "9") || byKey(a.key, b.key);
const ORDER_REST = (a: Cosa, b: Cosa) => (b.since ?? "").localeCompare(a.since ?? "") || byKey(a.key, b.key);

export function cosasOf({ p, decisions, ficha, companyPaused = false }: CosasInput, language: Language = getLanguage()): Cosas {
  const w = words(COSAS_WORDS, language);
  const quote = w.quote;
  const paused = companyPaused || p.paused;
  const mine = decisions.filter((d) => d.project === p.slug && isPending(d) && d.kind !== "release");
  const promoted = new Map<string, string>(); // initiative → idea
  for (const x of ficha?.promoted ?? []) promoted.set(x.initiative, x.idea);
  for (const i of ficha?.ideas ?? []) if (i.promoted_to) promoted.set(i.promoted_to, i.key);
  const out: Cosa[] = [];

  // Ideas not promoted: the ficha's (any origin), else the pedidos while it loads.
  const pedidos = new Map((p.pedidos ?? []).map((x) => [x.key, x]));
  const ideas: FichaIdea[] = ficha ? ficha.ideas : [];
  const seen = new Set<string>();
  let guardadas = 0;
  const guardadasList: { key: string; title: string }[] = [];
  // A promoted idea is its initiative: never a row of its own, even if the tube still lists it.
  for (const k of promoted.values()) seen.add(k);
  for (const i of ideas) {
    seen.add(i.key);
    if (i.promoted_to) continue;
    const pd = pedidos.get(i.key);
    if (i.guardada || pd?.guardada) {
      guardadas++;
      guardadasList.push({ key: i.key, title: ideaName(i.summary || i.title) || i.title });
      continue;
    }
    out.push(
      ideaThing(
        {
          key: i.key,
          title: i.summary || i.title,
          origin: i.origin ?? (pd ? "owner" : null),
          stop: i.stop ?? pd?.stop ?? STAGE_STOP[i.stage ?? "idea"] ?? "entendido",
          state: i.state ?? pd?.state ?? null,
          question: i.question ?? pd?.question ?? null,
          waits: i.waits,
          at: i.updated_at,
          ordered_at: i.ordered_at ?? null,
        },
        { p, paused, mine, w },
      ),
    );
  }
  for (const pd of p.pedidos ?? []) {
    if (seen.has(pd.key)) continue;
    if (pd.guardada) {
      guardadas++;
      guardadasList.push({ key: pd.key, title: ideaName(pd.title) || pd.title });
      continue;
    }
    out.push(ideaThing({ key: pd.key, title: pd.title, origin: "owner", stop: pd.stop, state: pd.state, question: pd.question, waits: null, at: pd.at }, { p, paused, mine, w }));
  }

  // Open initiatives and loose steps from the board.
  const board = p.tablero;
  for (const ini of board?.initiatives ?? []) {
    const idea = promoted.get(ini.key) ?? null;
    out.push(
      ticketThing({ key: ini.key, tipo: "iniciativa", title: ini.title, idea_key: idea, ideaDone: !!idea, tokens: ini.tokens ?? null }, ini.tickets, {
        p,
        paused,
        mine,
        canClose: !!ini.can_close,
        version: ini.version ?? null,
        done: ini.done,
        total: ini.total,
        w,
        language,
      }),
    );
  }
  for (const t of board?.loose ?? []) {
    if (DONE.has(t.etapa.etapa)) continue;
    out.push(ticketThing({ key: t.key, tipo: "suelto", title: t.title, idea_key: null, ideaDone: false, tokens: null }, [t], { p, paused, mine, canClose: false, version: null, done: 0, total: 1, w, language }));
  }

  // A request of his nobody took: Reenviar on its row (or a row of its own).
  for (const s of p.stale_requests ?? []) {
    const c = out.find((x) => x.key === s.key);
    if (c) Object.assign(c, { grupo: "toca", espera: w.nobodyTook(quote(s.title)), cap: w.notTaken, palanca: { kind: "reenviar", key: s.key }, since: s.since });
    else
      out.push({
        key: s.key,
        tipo: "suelto",
        idea_key: null,
        title: s.title,
        grupo: "toca",
        hilo: { idea: null, ideaTono: null, valvula: "abierta", tramos: [], publicado: false, at: "construccion" },
        espera: w.nobodyTook(quote(s.title)),
        cap: w.notTaken.toUpperCase(),
        palanca: { kind: "reenviar", key: s.key },
        decisions: [],
        since: s.since,
      });
  }

  // Decisions on this project that belong to no row (a question, a proposal) are rows of their own.
  const used = new Set(out.flatMap((c) => c.decisions));
  for (const d of mine) {
    if (used.has(d.id)) continue;
    out.push({
      key: d.ref ?? d.id,
      tipo: "decision",
      idea_key: null,
      title: d.title,
      grupo: "toca",
      hilo: { idea: null, ideaTono: null, valvula: "abierta", tramos: [], publicado: false, at: "construccion" },
      espera: d.detail ?? d.title,
      cap: (d.asker ? w.asks(seatName(d.asker.role)) : w.tipos.decision).toUpperCase(),
      palanca: decisionLever(d, p, w),
      decisions: [d.id],
      since: d.at,
    });
  }

  // Publicar lo aceptado: one row while a release waits.
  const release = decisions.find((d) => d.project === p.slug && d.kind === "release" && d.state === null);
  // PLA-I68-1: a release with migrations and nobody named to migrate production waits; its lever is the setting.
  const waits = !!release && prodWaits(release.release);
  const pw = publicarWords();
  if (release)
    out.push({
      key: "publicar",
      tipo: "publicar",
      idea_key: null,
      title: waits ? pw.waitTitle : release.title || w.publishTitle(p.title),
      grupo: "toca",
      hilo: { idea: null, ideaTono: null, valvula: "abierta", tramos: [], publicado: false, at: "publicado" },
      espera: waits ? pw.waitWhy : (release.detail ?? w.acceptedWaits),
      cap: w.tipos.publicar,
      palanca: waits ? { kind: "camino", sec: "resumen", label: pw.setIt } : { kind: "publicar" },
      decisions: [release.id],
      since: release.at,
    });

  // The server's move when it is not a decision (start a teammate, plan, set the goal, a link): a Te toca row of its
  // own. An empty project shows its own way in (Pedir, «Arma el plan»), so it gets none.
  const mv = p.next_move;
  // NEWPROJ-5: a move that starts a teammate on a step that already has a row is that row's lever, not a second row:
  // a step is listed once. A row that could not start keeps its retry and its reason.
  const moveKey = mv?.accion.kind === "start" ? (p.team.find((m) => m.agent === (mv.accion as { agent: string }).agent)?.next_start?.key ?? null) : null;
  const holder = moveKey ? out.find((c) => c.key === moveKey || c.hilo.tramos.some((t) => t.key === moveKey)) : undefined;
  if (mv && holder) {
    const step = holder.hilo.tramos.find((t) => t.key === moveKey);
    const espera = holder.tipo === "iniciativa" && step ? w.stepReady(quote(step.title)) : w.move.arrancar!;
    if (holder.grupo !== "toca") Object.assign(holder, { grupo: "toca", espera, cap: w.grupos.toca.toUpperCase(), palanca: { kind: "jugada", action: mv.accion, decision: null } });
  } else if (mv && mv.origen.kind !== "decision" && out.length > 0)
    out.push({
      key: "jugada",
      tipo: "jugada",
      idea_key: null,
      title: mv.texto,
      grupo: "toca",
      hilo: { idea: null, ideaTono: null, valvula: "abierta", tramos: [], publicado: false, at: "construccion" },
      espera: w.move[mv.verbo] ?? "",
      cap: w.grupos.toca,
      palanca: { kind: "jugada", action: mv.accion, decision: null },
      decisions: [],
      since: null,
    });

  const grupos = (["toca", "mueve", "fila", "quieto"] as const).map((g) => ({ grupo: g, cosas: out.filter((c) => c.grupo === g).sort(g === "toca" ? ORDER_TOCA : ORDER_REST) }));
  const iniciativas: Hecha[] = (board?.done_initiatives ?? []).map((d) => ({ key: d.key, title: d.title, idea_key: promoted.get(d.key) ?? null, done_at: d.done_at }));
  return { grupos, hecho: { iniciativas, sueltos: board?.loose_done ?? 0, ultimo_suelto: board?.loose_done_title ?? null }, guardadas, guardadasList, abiertas: out.length };
}

// ---- PLA-I64-3: the sentence on top (LIB-0137), generated from the list and today's line (lib/edificio.ts nowLine,
// wrapped, not changed): what moves; in amber, what waits on the owner (only when something does); one line on what
// is left.
export type Frase = { mueve: string; toca: string | null; falta: string; /** A grey second line (the empty project). */ sub?: string };

const elapsed = (since: string | null, now: number, w: W): string | null => {
  if (!since) return null;
  const m = Math.max(0, Math.round((now - Date.parse(since)) / 60_000));
  if (m < 60) return w.minutes(m);
  const h = Math.floor(m / 60);
  return h < 48 ? w.hours(h) : w.days(Math.floor(h / 24));
};

export function fraseOf(
  p: OrgProject,
  c: Cosas,
  line: { state: string; say: string; why: string },
  opts: { now: number; companyPaused?: boolean; totals?: { open: number; done: number } | null },
  language: Language = getLanguage(),
): Frase {
  const w = words(COSAS_WORDS, language);
  const num = (n: number) => (n <= 10 ? w.numF[n]! : String(n));
  const g = (k: Exclude<Grupo, "hecho">) => c.grupos.find((x) => x.grupo === k)?.cosas ?? [];
  const toca = g("toca");
  const mueve = g("mueve");
  const fila = g("fila");
  const quieto = g("quieto");
  const paused = !!opts.companyPaused || p.paused;

  // An empty project: what will happen when he asks (board A4).
  if (c.abiertas === 0 && c.hecho.iniciativas.length === 0 && c.hecho.sueltos === 0 && !paused)
    return { mueve: w.emptyMueve, toca: null, sub: w.emptySub, falta: w.emptyFalta };

  // What moves.
  let first: string;
  if (opts.companyPaused) first = w.companyStopped;
  else if (p.paused) first = w.projectPaused(p.title);
  else if ((line.state === "work" || line.state === "back") && mueve.length > 0) first = line.say;
  else if (mueve.length === 1) first = mueve[0]!.espera;
  else if (mueve.length > 1) first = w.movingNow(num(mueve.length), mueve.length);
  else first = w.nobodyWorks;

  // What waits on him (amber), only when something does.
  let amber: string | null = null;
  if (toca.length > 0) {
    const stuck = toca.find((x) => x.hilo.valvula === "atorada");
    const deliveries = toca.reduce((n, x) => n + (x.palanca?.kind === "entregas" ? x.palanca.ids.length : x.palanca?.kind === "jugada" && x.tipo === "iniciativa" ? 1 : 0), 0);
    if (stuck) {
      const t = elapsed(stuck.since, opts.now, w);
      amber = t ? w.stuckFor(t) : w.stuckNoTime;
    } else if (deliveries > 1) amber = w.deliveriesWait(num(deliveries), deliveries);
    else if (line.state === "you") amber = line.say;
    else if (toca.length === 1) amber = toca[0]!.espera;
    else amber = w.thingsWait(num(toca.length), toca.length);
  }

  // What is left.
  let last: string;
  if (c.abiertas === 0) last = w.nothingYet;
  else if (paused && toca.length > 0) last = w.pausedToca(toca.length === 1 && !!amber && !amber.includes(w.deliveriesWord), !!opts.companyPaused, fila.length);
  else if (paused) last = line.why || w.pausedNothing;
  else {
    const t = opts.totals;
    const left = t && t.open > 0 ? w.stepsLeft(t.open, t.open + t.done, p.title) : null;
    const still = mueve.length === 0 && fila.length === 0 && quieto.length > 0 ? quieto[0]!.espera : null;
    last = [left, still].filter(Boolean).join(" ") || (fila.length ? w.filaWait(num(fila.length), fila.length) : w.nothingElse);
  }
  return { mueve: first, toca: amber, falta: last };
}
