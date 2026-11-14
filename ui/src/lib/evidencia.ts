// PLA-I46-10: the evidence card (design screen 3). When the floor's move is to accept a delivery, Ahora carries what
// QA saw on it: the tests (14 de 14), the separate review, «Check list del PO» (3 de 3) and the stills of that
// delivery. Pure: the card (components/compania/edificio/evidence.tsx) draws what evidenceView returns, and
// test/i46-decision-ui.test.ts feeds it plain objects. A project without QA still shows the tests the ticket's own
// results carry (Decision.evidence), and says plainly that there was no separate review.
import type { Decision, QaRead } from "./api";

export type Tile = { value: string; ok: boolean | null; sub: string };
export type EvidenceView = {
  tests: Tile;
  review: Tile;
  checklist: { title: string; items: { n: number; text: string; mark: "pass" | "fail" | null }[] };
  stills: string[];
  pr: string | null;
  loading: boolean;
};

// Devolver a Taller: one quick reason and one optional line. What Taller reads is «reason: line».
export const RETURN_REASONS = ["No se ve bien", "Falta algo", "El texto", "Otra cosa"] as const;
export const returnText = (reason: string, line: string) => {
  const l = line.replace(/\s+/g, " ").trim();
  return l ? `${reason}: ${l}` : reason;
};
export const EV_WORDS = {
  accept: "Aceptar",
  back: "Devolver a Taller",
  send: "Devolver",
  cancel: "Cancelar",
  pr: "Ver PR",
  note: "Ver nota",
  hideNote: "Ocultar nota",
  sheet: "Devolver a Taller",
  line: "Una línea para Taller (opcional)",
  auto: "Aceptar sola en la copia de prueba",
} as const;

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};
const BUSY = new Set(["waiting", "checking", "reviewing"]);

// The delivery Ahora is asking about, when the floor's move is to accept one.
export const deliveryOf = (move: { origen: { kind: string; id?: string; decision?: string } } | null, decisions: Decision[]): Decision | null => {
  const o = move?.origen;
  // A code delivery (a PR): what QA checks. A deliverable without a PR (a doc) keeps its bubble under its maker.
  if (!o || o.kind !== "decision" || o.decision !== "pr") return null;
  return decisions.find((d) => d.id === o.id) ?? null;
};
export const prOf = (d: Pick<Decision, "links">) => (d.links ?? []).find((l) => l.kind === "pr")?.ref ?? null;

export function evidenceView(read: QaRead | null | undefined, d: Pick<Decision, "evidence" | "links">): EvidenceView {
  const r = read ?? null;
  let tests: Tile;
  if (r && r.tests.total > 0) tests = { value: `${r.tests.pass} de ${r.tests.total}`, ok: r.tests.verdict === "pass", sub: r.tests.verdict === "pass" ? "pasan en la entrega" : "no todas pasan" };
  else if (r && r.tests.items.length > 0) tests = { value: r.tests.verdict === "pass" ? "Pasan" : "Fallan", ok: r.tests.verdict === "pass", sub: r.tests.items.map((i) => i.name).join(", ") };
  else if (d.evidence && d.evidence.pass != null) {
    const total = d.evidence.pass + (d.evidence.fail ?? 0);
    tests = { value: `${d.evidence.pass} de ${total}`, ok: d.evidence.verdict === "pass" && !d.evidence.fail, sub: "según la última prueba del ticket" };
  } else if (d.evidence) tests = { value: d.evidence.verdict === "pass" ? "Pasan" : "Fallan", ok: d.evidence.verdict === "pass", sub: clip(d.evidence.cite, 60) };
  else tests = { value: "Sin pruebas", ok: null, sub: "nadie las corrió todavía" };

  let review: Tile;
  if (r?.review) review = r.review.verdict === "pass" ? { value: "Sin hallazgos", ok: true, sub: "otro agente, sin ver a Taller" } : { value: "Encontró algo", ok: false, sub: clip(r.review.notes, 90) };
  else if (r && BUSY.has(r.state)) review = { value: "En curso", ok: null, sub: "QA la está haciendo" };
  else review = { value: "Sin revisión aparte", ok: null, sub: r?.enabled ? "QA no la hizo en esta entrega" : "no hay QA en este equipo" };

  const items = (r?.checklist ?? []).map((c) => ({ n: c.n, text: c.text, mark: c.mark }));
  const passed = items.filter((c) => c.mark === "pass").length;
  const checklist = { title: items.length ? `Check list del PO · ${passed} de ${items.length}` : "Check list del PO", items };
  return { tests, review, checklist, stills: (r?.captures?.image_urls ?? []).slice(0, 2), pr: prOf(d), loading: read === undefined };
}

// PLA-I46-15: what a key does in the decision layer. A accepts, D returns (a delivery), C changes (a plan), Esc
// closes. Nothing while typing in a field, nor with a modifier held (so the browser's own shortcuts still work).
export type LayerKind = "delivery" | "plan";
export type LayerCommand = "accept" | "return" | "change" | "close";
type KeyLike = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: unknown };
const typing = (t: unknown) => {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  return el.isContentEditable === true || ["INPUT", "TEXTAREA", "SELECT"].includes(String(el.tagName ?? "").toUpperCase());
};
export function layerKey(e: KeyLike, kind: LayerKind): LayerCommand | null {
  if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === "Escape") return "close";
  if (k === "a") return "accept";
  if (k === "d" && kind === "delivery") return "return";
  if (k === "c" && kind === "plan") return "change";
  return null;
}
