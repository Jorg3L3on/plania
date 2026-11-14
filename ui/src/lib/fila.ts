// PLA-I47-3: La fila (Design frame 7). Now, next, postponed and done in one list the owner acts on, built from what
// GET /api/company already reads: the leg in course's steps (route), the owner's orders and the Ready tickets in the
// runner's order (ready, next_first). Pure; the floor draws it (components/compania/edificio/fila.tsx).
//   Ahora      what runs now (a step In progress, an order in course) and a delivery that waits to be accepted
//   Sigue      numbered in the order the runner will take it: the owner's open orders first, then the ticket he
//              put first (next_first), then the rest in the read's order; a held plan step says what it waits for
//   Pospuesto  the leg's steps put off on purpose (Backlog)
//   Hecho      the last three steps landed, newest first, and how many there are
// «Hacer primero» only where it changes something (Plan doc answer 2): an order with a key, a Ready ticket outside
// the plan, and the plan step that is free (state next). Never on a held step.
import type { Decision, OrgMember, OrgOrder, OrgProject, OrgRouteStep } from "./api";
import { stepLine } from "./edificio";

export type FilaMark = "work" | "you" | "done" | "pub" | "off" | "order" | "next" | "held";
export type FilaAct = { kind: "primero"; key: string } | { kind: "detener"; runId: string } | { kind: "aceptar"; decision: Decision; action: "fusionar" | "aceptar" } | { kind: "quitar"; key: string };
export type FilaRow = { id: string; key: string | null; title: string; line: string; mark: FilaMark; n?: number; tu?: boolean; acts: FilaAct[] };
export type Fila = { ahora: FilaRow[]; sigue: FilaRow[]; pospuesto: FilaRow[]; hecho: FilaRow[]; hechoTotal: number };

const OPEN_ORDER = new Set(["enviada", "entendida", "sin_tomar"]);
const quoted = (s: string, n = 60) => `«${s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s}»`;

// The delivery decision that carries this ticket, if one waits.
function deliveryFor(key: string, decisions: Decision[]): Decision | null {
  return decisions.find((d) => d.state === null && d.actions.some((a) => a === "fusionar" || a === "aceptar") && (d.ref === key || (d.links ?? []).some((l) => l.kind === "ticket" && l.ref === key))) ?? null;
}
const runOn = (key: string, team: OrgMember[]) => team.find((m) => m.state === "running" && m.now?.ticket === key)?.now?.run_id ?? null;

function orderLine(o: OrgOrder): string {
  if (o.state === "sin_tomar") return "Tu pedido · nadie lo ha tomado";
  if (o.state === "entendida") return o.who ? `Tu pedido · ${o.who} lo entendió` : "Tu pedido · entendido";
  return "Tu pedido · enviado";
}

export function filaOf(p: OrgProject & { next_first?: string | null }, decisions: Decision[], now: number, timeZone?: string): Fila {
  const here = p.route?.legs.find((l) => l.state === "here");
  const steps: (OrgRouteStep & { postponed?: boolean; waits?: string | null })[] = here?.steps ?? [];
  const stepBy = new Map(steps.map((s) => [s.key, s]));
  const team = p.team;
  const orders = p.orders ?? [];
  const seen = new Set<string>();

  const stepRow = (s: (typeof steps)[number]): FilaRow => {
    if (s.state === "working") {
      const run = runOn(s.key, team);
      return { id: s.key, key: s.key, title: s.title, line: stepLine(s, team, now, timeZone), mark: "work", acts: run ? [{ kind: "detener", runId: run }] : [] };
    }
    if (s.state === "delivered") {
      const d = deliveryFor(s.key, decisions);
      const action = d?.actions.find((a): a is "fusionar" | "aceptar" => a === "fusionar" || a === "aceptar");
      return { id: s.key, key: s.key, title: s.title, line: stepLine(s, team, now, timeZone), mark: "you", acts: d && action ? [{ kind: "aceptar", decision: d, action }] : [] };
    }
    if (s.state === "next") return { id: s.key, key: s.key, title: s.title, line: stepLine(s, team, now, timeZone), mark: "next", acts: [{ kind: "primero", key: s.key }] };
    if (s.state === "done" || s.state === "published") return { id: s.key, key: s.key, title: s.title, line: stepLine(s, team, now, timeZone), mark: s.state === "published" ? "pub" : "done", acts: [] };
    if (s.postponed) return { id: s.key, key: s.key, title: s.title, line: "Pospuesto a propósito", mark: "off", acts: [] };
    return { id: s.key, key: s.key, title: s.title, line: s.waits ? `Espera a ${quoted(s.waits)}` : stepLine(s, team, now, timeZone), mark: "held", acts: [] };
  };

  // Ahora
  const ahora: FilaRow[] = [];
  for (const o of orders) {
    if (o.state !== "en_curso") continue;
    ahora.push({ id: `o-${o.id}`, key: o.key ?? null, title: o.title, line: o.who ? `Tu pedido · ${o.who} trabaja en él` : "Tu pedido · en curso", mark: "work", tu: true, acts: o.run?.status === "running" ? [{ kind: "detener", runId: o.run.id }] : [] });
    if (o.key) seen.add(o.key);
  }
  for (const s of steps) {
    if ((s.state === "working" || s.state === "delivered") && !seen.has(s.key)) {
      ahora.push(stepRow(s));
      seen.add(s.key);
    }
  }

  // Sigue: the owner's open orders, then next_first, then the read's order, then the leg's waiting steps.
  const mine: FilaRow[] = [];
  for (const o of orders) {
    if (!OPEN_ORDER.has(o.state) || o.stage === "cancelada" || (o.key && seen.has(o.key))) continue;
    const acts: FilaAct[] = o.key ? [{ kind: "primero", key: o.key }, { kind: "quitar", key: o.key }] : [];
    mine.push({ id: `o-${o.id}`, key: o.key ?? null, title: o.title, line: orderLine(o), mark: "order", tu: true, acts });
    if (o.key) seen.add(o.key);
  }
  const rest: FilaRow[] = [];
  for (const r of p.ready ?? []) {
    if (seen.has(r.key)) continue;
    const s = stepBy.get(r.key);
    if (s?.postponed) continue;
    rest.push(s ? stepRow(s) : { id: r.key, key: r.key, title: r.title, line: "Lista para empezar", mark: "next", acts: [{ kind: "primero", key: r.key }] });
    seen.add(r.key);
  }
  for (const s of steps) {
    if (seen.has(s.key) || s.postponed || !(s.state === "next" || s.state === "later")) continue;
    rest.push(stepRow(s));
    seen.add(s.key);
  }
  const first = p.next_first ? rest.findIndex((r) => r.key === p.next_first) : -1;
  if (first > 0) rest.unshift(...rest.splice(first, 1));
  const sigue = [...mine, ...rest].map((r, i) => ({ ...r, n: i + 1 }));

  const pospuesto = steps.filter((s) => s.postponed && !seen.has(s.key)).map(stepRow);
  const landed = steps.filter((s) => s.state === "done" || s.state === "published").sort((a, b) => Date.parse(b.at ?? "0") - Date.parse(a.at ?? "0"));
  return { ahora, sigue, pospuesto, hecho: landed.slice(0, 3).map(stepRow), hechoTotal: landed.length };
}
