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
import type { Decision, DecisionAction, EtapaId, FichaIdea, OrgFicha, OrgMoveAction, OrgProject, PedidoState, PedidoStop, ProjectTicket } from "./api";
import { ETAPA_WORD } from "./etapas";
import { seatName } from "./corriente";
import { arranqueLine } from "./arranque";

// ---- words

/** The nine stops of a thing's thread (PLA-IDEA27): six idea stops, the valve, construction, published. */
export const PARADAS = ["buzon", "entendido", "investigacion", "diseno", "plan", "lista", "valvula", "construccion", "publicado"] as const;
export type Parada = (typeof PARADAS)[number];
export const PARADA_NAME: Record<Parada, string> = {
  buzon: "Buzón",
  entendido: "Entendido",
  investigacion: "Investigación",
  diseno: "Diseño",
  plan: "Plan",
  lista: "Lista",
  valvula: "Constrúyelo",
  construccion: "Construcción",
  publicado: "Publicado",
};
const IDEA_STOPS: readonly PedidoStop[] = ["buzon", "entendido", "investigacion", "diseno", "plan", "lista"];
const STAGE_STOP: Record<string, PedidoStop> = { idea: "entendido", research: "investigacion", design: "diseno", planning: "plan", ready: "lista" };

export type Tipo = "pedido" | "idea" | "iniciativa" | "suelto" | "decision" | "publicar" | "jugada";
export const TIPO_NAME: Record<Tipo, string> = { pedido: "Pedido tuyo", idea: "Idea", iniciativa: "Iniciativa", suelto: "Paso suelto", decision: "Decisión", publicar: "Publicar", jugada: "Tu jugada" };

export const GRUPOS = ["toca", "mueve", "fila", "quieto", "hecho"] as const;
export type Grupo = (typeof GRUPOS)[number];
export const GRUPO_NAME: Record<Grupo, string> = { toca: "Te toca", mueve: "Se mueve", fila: "En fila", quieto: "Quieto", hecho: "Hecho" };

// ---- shapes

/** One step of the construction part of the thread. */
export type TramoTono = "hecho" | "vivo" | "toca" | "fila" | "quieto";
export type Tramo = { key: string; title: string; etapa: EtapaId; tono: TramoTono };
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
  | { kind: "detener"; run: string }
  | { kind: "primero"; key: string }
  | { kind: "lista"; key: string };

export type Cosa = {
  key: string;
  tipo: Tipo;
  /** The idea it was born from (an initiative that was a pedido or an idea). */
  idea_key: string | null;
  title: string;
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

export function tonoOf(t: Pick<ProjectTicket, "etapa">, paused: boolean): TramoTono {
  const e = t.etapa;
  if (DONE.has(e.etapa)) return "hecho";
  if (e.etapa === "te_toca") return "toca";
  if (e.live && !paused) return "vivo";
  if (QUIET.has(e.etapa)) return "quieto";
  return "fila";
}

const quote = (s: string) => `«${s}»`;
const runOn = (key: string, p: OrgProject): string | null => p.team.find((m) => m.state === "running" && m.now?.ticket === key)?.now?.run_id ?? null;
const workerOn = (key: string, p: OrgProject) => p.team.find((m) => m.state === "running" && m.now?.ticket === key) ?? null;

/** NEWPROJ-5: the teammate whose next start is this step (its hold, else its queue). */
const starterOf = (key: string, p: OrgProject): string | null =>
  p.team.find((m) => m.next_start?.key === key)?.agent ?? p.team.find((m) => (m.queue ?? []).some((q) => q.key === key))?.agent ?? null;
/** NEWPROJ-5: the retry on a step whose run could not start. */
export const RETRY = "Volver a intentar";

/** The next step that is not done, in phase order then key order. */
const focusOf = (ts: ProjectTicket[], paused: boolean, tono: TramoTono) =>
  [...ts].sort((a, b) => (a.phase ?? 999) - (b.phase ?? 999) || byKey(a.key, b.key)).find((t) => tonoOf(t, paused) === tono) ?? null;

/** The lever that moves a quiet step: Pasar a Lista when it sits in Backlog for no reason but that. */
function quietLever(t: ProjectTicket): Palanca | null {
  return t.status === "Backlog" && t.etapa.etapa === "despues" && !(t.etapa.reason ?? "").startsWith("Espera a") ? { kind: "lista", key: t.key } : null;
}

function filaWords(t: ProjectTicket, paused: boolean): string {
  const e = t.etapa.etapa;
  if (e === "lista") return paused ? `${quote(t.title)} está lista: arranca cuando reanudes.` : `${quote(t.title)} está lista: arranca sola.`;
  if (e === "en_qa") return `${quote(t.title)} está en QA: no te necesita.`;
  if (e === "en_revision") return t.etapa.reason ? `${quote(t.title)}: ${t.etapa.reason.replace(/\.$/, "")}. No te necesita.` : `${quote(t.title)} está en revisión: no te necesita.`;
  if (e === "integrado") return `${quote(t.title)} ya está en la copia de prueba: espera publicación.`;
  if (e === "devuelto") return `${quote(t.title)}: ${t.etapa.reason ?? "la están arreglando."}`;
  return `${quote(t.title)}: ${t.etapa.reason ?? ETAPA_WORD[e]}`;
}

/** The decision the server's move points at, if any. */
const moveDecision = (p: OrgProject) => (p.next_move?.origen.kind === "decision" ? p.next_move.origen.id : null);

function decisionLever(d: Decision, p: OrgProject): Palanca {
  if (moveDecision(p) === d.id && p.next_move) return { kind: "jugada", action: p.next_move.accion, decision: d.id };
  if (isDelivery(d)) return { kind: "entregas", ids: [d.id] };
  const action = d.actions[0] ?? "responder";
  return { kind: "decision", id: d.id, action, label: d.kind === "plan" ? "Ver el plan" : d.kind === "question" ? "Responder" : "Decidir" };
}

// ---- the read

/** A ticket-made thing (an initiative or a loose step) from its steps. */
function ticketThing(
  base: { key: string; tipo: "iniciativa" | "suelto"; title: string; idea_key: string | null; ideaDone: boolean },
  ts: ProjectTicket[],
  ctx: { p: OrgProject; paused: boolean; mine: Decision[]; canClose: boolean; version: number | null; done: number; total: number },
): Cosa {
  const { p, paused } = ctx;
  const tramos: Tramo[] = [...ts]
    .sort((a, b) => (a.phase ?? 999) - (b.phase ?? 999) || byKey(a.key, b.key))
    .map((t) => ({ key: t.key, title: t.title, etapa: t.etapa.etapa, tono: tonoOf(t, paused) }));
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
  const count = base.tipo === "iniciativa" ? `${ctx.done} de ${ctx.total}` : null;
  const cap = (word: string) => [count, word].filter(Boolean).join(" · ").toUpperCase();
  const since = (t: ProjectTicket | null) => t?.etapa.since ?? null;
  // A loose step is its own only step: its sentence does not repeat its title.
  const own = (e: string) => {
    if (base.tipo !== "suelto" || !e.startsWith(quote(base.title))) return e;
    const rest = e.slice(quote(base.title).length).replace(/^(: | está )/, (m) => (m === ": " ? "" : "Está "));
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
    const espera = nd === 1 ? `${t0 ? quote(t0.title) : (first?.title ?? "Una entrega")}: ${t0?.etapa.reason ?? "entregada: espera que la aceptes."}` : `Taller entregó ${nd} pasos; cada uno espera que lo aceptes o pidas ajuste.`;
    return out("toca", espera, nd === 1 ? "Te espera" : `${nd} te esperan`, palanca, since(t0) ?? first?.at ?? null);
  }
  const other = decisions[0];
  if (other) return out("toca", other.title, TIPO_NAME.decision, decisionLever(other, p), other.at);
  if (base.tipo === "iniciativa" && ctx.canClose) return out("toca", "Todos sus pasos están hechos: ciérrala.", "Lista para cerrar", { kind: "cerrar", key: base.key, version: ctx.version }, null);

  // NEWPROJ-5: a step whose newest run could not start waits on the owner: what happened and what to fix, and a retry
  // (never «Que empiece ya», nor «arranca sola», while that cause may stand).
  const roto = [...ts].sort((a, b) => (a.phase ?? 999) - (b.phase ?? 999) || byKey(a.key, b.key)).find((t) => t.arranque && !t.etapa.live && tonoOf(t, paused) !== "hecho");
  if (roto) {
    const line = arranqueLine(roto.arranque!.summary) ?? "No pudo arrancar.";
    const agent = starterOf(roto.key, p);
    const palanca: Palanca | null = agent && !paused ? { kind: "jugada", action: { kind: "start", agent, label: RETRY }, decision: null } : null;
    return out("toca", base.tipo === "iniciativa" ? `${quote(roto.title)}: ${line}` : line, "No pudo arrancar", palanca, roto.arranque!.at ?? since(roto));
  }

  // Se mueve: someone works one of its steps now.
  const vivo = focusOf(ts, paused, "vivo");
  if (vivo) {
    const w = workerOn(vivo.key, p);
    const who = w ? seatName(w.role) : vivo.etapa.holder ? seatName(vivo.etapa.holder.role) : "Alguien";
    const run = runOn(vivo.key, p);
    return out("mueve", `${who} trabaja ${quote(vivo.title)}.`, ETAPA_WORD[vivo.etapa.etapa], run ? { kind: "detener", run } : null, w?.now?.since ?? since(vivo));
  }
  // En fila: it starts by itself or is in review.
  const fila = focusOf(ts, paused, "fila");
  if (fila) {
    const lever: Palanca | null = fila.etapa.etapa === "lista" && p.next_first !== fila.key ? { kind: "primero", key: fila.key } : null;
    return out("fila", filaWords(fila, paused), ETAPA_WORD[fila.etapa.etapa], lever, since(fila));
  }
  // Quieto: the first step that does not move, with its reason and its lever.
  const q = focusOf(ts, paused, "quieto");
  if (q) {
    const why = q.etapa.reason ?? ETAPA_WORD[q.etapa.etapa];
    const espera = base.tipo === "iniciativa" ? `Falta ${quote(q.title)}. ${why}` : why;
    return out("quieto", espera, ETAPA_WORD[q.etapa.etapa], quietLever(q), since(q));
  }
  // Every step landed but the initiative is not closed (it waits to be published or closed by Plania).
  return out("fila", allDone ? "Sus pasos están hechos: espera publicarse." : "Sin pasos todavía.", allDone ? "Hecha" : "Sin pasos", null, null);
}

/** An idea not promoted yet: a pedido (origin jorge) or the team's idea. */
function ideaThing(i: { key: string; title: string; origin: string | null; stop: PedidoStop; state: PedidoState | null; question: { id: string; text: string } | null; waits: string | null; at: string | null; ordered_at?: string | null }, ctx: { p: OrgProject; paused: boolean; mine: Decision[] }): Cosa {
  const { p, paused } = ctx;
  const tipo: Tipo = i.origin === "owner" ? "pedido" : "idea";
  const worker = workerOn(i.key, p);
  const live = !!worker && !paused;
  const decisions = ctx.mine.filter((d) => refsOf(d).includes(i.key));
  const at = IDEA_STOPS.indexOf(i.stop);
  const valve = i.state === "valvula";
  const hilo = (ideaTono: TramoTono, valvula: Valvula): Hilo => ({ idea: at, ideaTono, valvula, tramos: [], publicado: false, at: valvula === "atorada" || valvula === "pasando" ? "valvula" : i.stop });
  const base = { key: i.key, tipo, idea_key: null, title: i.title, decisions: decisions.map((d) => d.id) };
  const stopName = PARADA_NAME[i.stop];
  const waits = i.waits ? i.waits.replace(/^Doc (\w+)$/, (_m, d: string) => `Falta el doc ${d}.`) : null;

  if (i.question || i.state === "espera") {
    const text = i.question?.text ?? waits ?? "El PO te pregunta algo.";
    return { ...base, grupo: "toca", hilo: hilo("toca", "cerrada"), espera: text, cap: `${stopName} · te pregunta`.toUpperCase(), palanca: { kind: "responder", key: i.key, question: i.question?.id ?? "" }, since: i.at };
  }
  const d = decisions[0];
  if (d) return { ...base, grupo: "toca", hilo: hilo("toca", "cerrada"), espera: d.title, cap: stopName.toUpperCase(), palanca: decisionLever(d, p), since: d.at };
  if (valve && live) return { ...base, grupo: "mueve", hilo: hilo("hecho", "pasando"), espera: `${seatName(worker!.role)} la sube al tablero.`, cap: "Pasando al tablero", palanca: worker?.now?.run_id ? { kind: "detener", run: worker.now.run_id } : null, since: worker?.now?.since ?? i.at };
  // PLA-62: the valve's clock is the «Constrúyelo» itself, not the idea's last edit.
  if (valve) return { ...base, grupo: "toca", hilo: hilo("hecho", "atorada"), espera: "Dijiste «Constrúyelo» y nadie la está subiendo al tablero.", cap: "Atorada", palanca: { kind: "despertar", key: i.key }, since: i.ordered_at ?? i.at };
  if (i.stop === "lista" && tipo === "pedido") return { ...base, grupo: "toca", hilo: hilo("hecho", "toca"), espera: "El plan está: «Constrúyelo» la sube al tablero.", cap: "Lista para construir", palanca: { kind: "construir", key: i.key }, since: i.at };
  if (live || i.state === "trabajando") {
    const who = worker ? seatName(worker.role) : "El equipo";
    return { ...base, grupo: "mueve", hilo: hilo("vivo", "cerrada"), espera: `${who} la trabaja: ${stopName}.`, cap: stopName.toUpperCase(), palanca: worker?.now?.run_id ? { kind: "detener", run: worker.now.run_id } : null, since: worker?.now?.since ?? i.at };
  }
  if (i.state === "cola") return { ...base, grupo: "fila", hilo: hilo("fila", "cerrada"), espera: paused ? "En el buzón: el PO la toma cuando reanudes." : "En el buzón: el PO la toma en su turno.", cap: stopName.toUpperCase(), palanca: null, since: i.at };
  // Quieta: nobody works it; it says what its stop still needs.
  const espera = i.stop === "lista" ? "Lista: el PO la vuelve iniciativa." : `Nadie la trabaja. ${waits && waits !== "Puede avanzar" ? waits : `Está en ${stopName}.`}`;
  return { ...base, grupo: "quieto", hilo: hilo("quieto", "cerrada"), espera, cap: stopName.toUpperCase(), palanca: paused ? null : { kind: "despertar", key: i.key }, since: i.at };
}

const ESPERA_MOVE: Record<string, string> = { fijar: "Sin meta, el equipo no sabe qué va primero.", planear: "Lo que sigue no está planeado todavía.", arrancar: "Está listo y espera tu señal.", ver: "Míralo cuando puedas.", aceptar: "", publicar: "", responder: "" };

// Te toca: the row carrying the server's move first (it gets the screen's white button and matches the sentence),
// then the longest waiting.
const ORDER_TOCA = (a: Cosa, b: Cosa) => Number(b.palanca?.kind === "jugada") - Number(a.palanca?.kind === "jugada") || (a.since ?? "9").localeCompare(b.since ?? "9") || byKey(a.key, b.key);
const ORDER_REST = (a: Cosa, b: Cosa) => (b.since ?? "").localeCompare(a.since ?? "") || byKey(a.key, b.key);

export function cosasOf({ p, decisions, ficha, companyPaused = false }: CosasInput): Cosas {
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
      guardadasList.push({ key: i.key, title: i.summary || i.title });
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
        { p, paused, mine },
      ),
    );
  }
  for (const pd of p.pedidos ?? []) {
    if (seen.has(pd.key)) continue;
    if (pd.guardada) {
      guardadas++;
      guardadasList.push({ key: pd.key, title: pd.title });
      continue;
    }
    out.push(ideaThing({ key: pd.key, title: pd.title, origin: "owner", stop: pd.stop, state: pd.state, question: pd.question, waits: null, at: pd.at }, { p, paused, mine }));
  }

  // Open initiatives and loose steps from the board.
  const board = p.tablero;
  for (const ini of board?.initiatives ?? []) {
    const idea = promoted.get(ini.key) ?? null;
    out.push(
      ticketThing({ key: ini.key, tipo: "iniciativa", title: ini.title, idea_key: idea, ideaDone: !!idea }, ini.tickets, {
        p,
        paused,
        mine,
        canClose: !!ini.can_close,
        version: ini.version ?? null,
        done: ini.done,
        total: ini.total,
      }),
    );
  }
  for (const t of board?.loose ?? []) {
    if (DONE.has(t.etapa.etapa)) continue;
    out.push(ticketThing({ key: t.key, tipo: "suelto", title: t.title, idea_key: null, ideaDone: false }, [t], { p, paused, mine, canClose: false, version: null, done: 0, total: 1 }));
  }

  // A request of his nobody took: Reenviar on its row (or a row of its own).
  for (const s of p.stale_requests ?? []) {
    const c = out.find((x) => x.key === s.key);
    if (c) Object.assign(c, { grupo: "toca", espera: `Nadie tomó ${quote(s.title)}.`, cap: "Sin tomar", palanca: { kind: "reenviar", key: s.key }, since: s.since });
    else
      out.push({
        key: s.key,
        tipo: "suelto",
        idea_key: null,
        title: s.title,
        grupo: "toca",
        hilo: { idea: null, ideaTono: null, valvula: "abierta", tramos: [], publicado: false, at: "construccion" },
        espera: `Nadie tomó ${quote(s.title)}.`,
        cap: "SIN TOMAR",
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
      cap: (d.asker ? `${seatName(d.asker.role)} pregunta` : "Decisión").toUpperCase(),
      palanca: decisionLever(d, p),
      decisions: [d.id],
      since: d.at,
    });
  }

  // Publicar lo aceptado: one row while a release waits.
  const release = decisions.find((d) => d.project === p.slug && d.kind === "release" && d.state === null);
  if (release)
    out.push({
      key: "publicar",
      tipo: "publicar",
      idea_key: null,
      title: release.title || `Publicar ${p.title}`,
      grupo: "toca",
      hilo: { idea: null, ideaTono: null, valvula: "abierta", tramos: [], publicado: false, at: "publicado" },
      espera: release.detail ?? "Lo aceptado espera publicarse.",
      cap: "Publicar",
      palanca: { kind: "publicar" },
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
    const espera = holder.tipo === "iniciativa" && step ? `${quote(step.title)} está listo y espera tu señal.` : ESPERA_MOVE.arrancar!;
    if (holder.grupo !== "toca") Object.assign(holder, { grupo: "toca", espera, cap: "Te toca".toUpperCase(), palanca: { kind: "jugada", action: mv.accion, decision: null } });
  } else if (mv && mv.origen.kind !== "decision" && out.length > 0)
    out.push({
      key: "jugada",
      tipo: "jugada",
      idea_key: null,
      title: mv.texto,
      grupo: "toca",
      hilo: { idea: null, ideaTono: null, valvula: "abierta", tramos: [], publicado: false, at: "construccion" },
      espera: ESPERA_MOVE[mv.verbo] ?? "",
      cap: "Te toca",
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

const elapsed = (since: string | null, now: number): string | null => {
  if (!since) return null;
  const m = Math.max(0, Math.round((now - Date.parse(since)) / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} días`;
};
const NUM_ES = ["Cero", "Una", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez"];
const countFem = (n: number, one: string, many: string) => `${n <= 10 ? NUM_ES[n] : String(n)} ${n === 1 ? one : many}`;

export function fraseOf(
  p: OrgProject,
  c: Cosas,
  line: { state: string; say: string; why: string },
  opts: { now: number; companyPaused?: boolean; totals?: { open: number; done: number } | null },
): Frase {
  const g = (k: Exclude<Grupo, "hecho">) => c.grupos.find((x) => x.grupo === k)?.cosas ?? [];
  const toca = g("toca");
  const mueve = g("mueve");
  const fila = g("fila");
  const quieto = g("quieto");
  const paused = !!opts.companyPaused || p.paused;

  // An empty project: what will happen when he asks (board A4).
  if (c.abiertas === 0 && c.hecho.iniciativas.length === 0 && c.hecho.sueltos === 0 && !paused)
    return { mueve: "Todavía no hay nada aquí.", toca: null, sub: "Pide lo primero y se vuelve una fila.", falta: "Cada cosa que pidas avanza sola de Buzón a Lista. Nadie escribe código hasta que digas «Constrúyelo»." };

  // What moves.
  let first: string;
  if (opts.companyPaused) first = "La compañía está detenida.";
  else if (p.paused) first = `${p.title} está en pausa.`;
  else if ((line.state === "work" || line.state === "back") && mueve.length > 0) first = line.say;
  else if (mueve.length === 1) first = mueve[0]!.espera;
  else if (mueve.length > 1) first = `${countFem(mueve.length, "cosa se mueve", "cosas se mueven")} ahora.`;
  else first = "Nadie trabaja ahora.";

  // What waits on him (amber), only when something does.
  let amber: string | null = null;
  if (toca.length > 0) {
    const stuck = toca.find((x) => x.hilo.valvula === "atorada");
    const deliveries = toca.reduce((n, x) => n + (x.palanca?.kind === "entregas" ? x.palanca.ids.length : x.palanca?.kind === "jugada" && x.tipo === "iniciativa" ? 1 : 0), 0);
    if (stuck) {
      const t = elapsed(stuck.since, opts.now);
      amber = t ? `Tu «Constrúyelo» lleva ${t} sin subir al tablero.` : "Tu «Constrúyelo» no ha subido al tablero.";
    } else if (deliveries > 1) amber = `${countFem(deliveries, "entrega te espera", "entregas te esperan")}.`;
    else if (line.state === "you") amber = line.say;
    else if (toca.length === 1) amber = toca[0]!.espera;
    else amber = `${countFem(toca.length, "cosa te espera", "cosas te esperan")}.`;
  }

  // What is left.
  let last: string;
  if (c.abiertas === 0) last = "Todavía no hay nada aquí: pide lo primero, o pide al PO que arme el plan.";
  else if (paused && toca.length > 0) last = `Puedes ${toca.length === 1 && amber && !/entregas/.test(amber) ? "atenderla" : "aceptarlas"} en pausa. Nada nuevo arranca hasta que ${opts.companyPaused ? "reanudes la compañía" : "lo reanudes"}${fila.length ? `: ${fila.length === 1 ? "una cosa tiene" : `${fila.length} cosas tienen`} un paso listo.` : "."}`;
  else if (paused) last = line.why || "Nada arranca hasta que lo reanudes.";
  else {
    const t = opts.totals;
    const left = t && t.open > 0 ? `${t.open === 1 ? "Falta 1 paso" : `Faltan ${t.open} pasos`} de ${t.open + t.done} para terminar ${p.title}.` : null;
    const still = mueve.length === 0 && fila.length === 0 && quieto.length > 0 ? quieto[0]!.espera : null;
    last = [left, still].filter(Boolean).join(" ") || (fila.length ? `${countFem(fila.length, "cosa espera", "cosas esperan")} turno; no te necesitan.` : "Nada más por ahora.");
  }
  return { mueve: first, toca: amber, falta: last };
}
