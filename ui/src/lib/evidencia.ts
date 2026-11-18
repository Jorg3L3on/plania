// PLA-I46-10: the evidence card (design screen 3). When the floor's move is to accept a delivery, Ahora carries what
// QA saw on it: the tests (14 de 14), the separate review, «Check list del PO» (3 de 3) and the stills of that
// delivery. Pure: the card (components/compania/edificio/evidence.tsx) draws what evidenceView returns, and
// test/i46-decision-ui.test.ts feeds it plain objects. A project without QA still shows the tests the ticket's own
// results carry (Decision.evidence), and says plainly that there was no separate review.
import type { Decision, QaRead } from "./api";

export type Tile = { value: string; ok: boolean | null; sub: string };
// AUDIT-6: one short line per verdict of the review (does it do what was asked; is the code sound).
export type AxisLine = { axis: "spec" | "code"; text: string; ok: boolean; sub: string };
export type EvidenceView = {
  tests: Tile;
  review: Tile;
  // Empty for a review with one verdict (before AUDIT-6): the card shows review.value as before.
  axes: AxisLine[];
  // Whether QA went through the app in a browser; null when the project does not ask for it.
  walked: { text: string; ok: boolean } | null;
  checklist: { title: string; items: { n: number; text: string; mark: "pass" | "fail" | null }[] };
  stills: string[];
  pr: string | null;
  loading: boolean;
};

// Devolver a Taller: one quick reason and an optional note. What Taller reads is «reason: note».
// PLA-92 (guided test PLA-86, F-16): the note was one line cut silently at 300 characters; a real correction stopped
// mid-sentence. It is now a text box of NOTE_MAX characters whose line breaks are kept (the server takes 2000 with the
// reason in front), and a mark's note goes to MARK_MAX.
export const RETURN_REASONS = ["No se ve bien", "Falta algo", "El texto", "Otra cosa"] as const;
export const NOTE_MAX = 1900;
export const MARK_MAX = 600;
export const returnText = (reason: string, line: string) => {
  const l = line
    .split("\n")
    .map((x) => x.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return l ? `${reason}: ${l}` : reason;
};
export const EV_WORDS = {
  accept: "Aprobar y pasar a prueba",
  back: "Devolver a Taller",
  send: "Devolver",
  cancel: "Cancelar",
  pr: "Ver PR",
  note: "Ver nota",
  hideNote: "Ocultar nota",
  sheet: "Devolver a Taller",
  line: "Qué cambiarías, para Taller (opcional)",
  auto: "Aprobar sola si las pruebas pasan (solo a la copia de prueba)",
} as const;

// AUDIT-6: the review's two verdicts and the walk-through, in the owner's words.
export const AXIS_WORDS = {
  spec: { pass: "Hace lo que se pidió", fail: "No hace todo lo que se pidió" },
  code: { pass: "El código está bien", fail: "El código tiene un problema" },
} as const;
export const WALKED_WORDS = { yes: "QA recorrió la app", no: "QA no recorrió la app" } as const;

// A text that did not come (an older or partial read) is an empty line, never a crash (PLA-I47-7).
const clip = (s: string | null | undefined, n: number) => {
  const one = (s ?? "").replace(/\s+/g, " ").trim();
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

// PLA-40, PLA-42: what Aprobar does, said on the button and in one line under it. A delivery with a PR is merged into
// sandbox (never main: src/api/thread-actions.ts); one without a PR (a doc) moves its ticket to Hecho. No key and no
// word sandbox on screen (PLA-I36-11): it is «la copia de prueba». aria names the delivery (title and aria-label).
// Same button words as the server's move (src/api/company-move.ts ONE_CLICK), so every surface says the same.
export type AcceptWords = { label: string; hint: string; aria: string };
export const APPROVE = {
  pr: { label: "Aprobar y pasar a prueba", hint: "Se integra a la copia de prueba; lo publicado no cambia. Luego arranca el siguiente paso." },
  done: { label: "Aprobar y cerrar", hint: "La entrega pasa a Hecho y arranca el siguiente paso." },
  plan: { label: "Aprobar el plan", hint: "Se crean sus pasos y Taller empieza." },
} as const;
export const APPROVED = { pr: "Aprobado · en la copia de prueba", done: "Aprobado · cerrado" } as const;
export function acceptWords(d: Pick<Decision, "kind" | "links" | "preview_url"> & { title?: string | null }, opts: { seen?: boolean } = {}): AcceptWords {
  const pr = d.kind === "pr" || !!prOf(d);
  const w = pr ? APPROVE.pr : APPROVE.done;
  const unseen = d.preview_url || opts.seen ? "" : " Sin vista previa: la apruebas sin haberla visto.";
  const name = d.title ? `«${clip(d.title, 70)}»` : "la entrega";
  return { label: w.label, hint: `${w.hint}${unseen}`, aria: `Aprobar ${name} y ${pr ? "pasar a prueba" : "cerrar"}` };
}

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

  // AUDIT-6: the two verdicts, each on its own line; a failing one carries the start of QA's note.
  const { spec, code } = r?.review ?? {};
  const axes: AxisLine[] =
    spec && code
      ? [
          { axis: "spec", ok: spec.verdict === "pass", text: spec.verdict === "pass" ? AXIS_WORDS.spec.pass : AXIS_WORDS.spec.fail, sub: spec.verdict === "pass" ? "" : clip(spec.notes, 90) },
          { axis: "code", ok: code.verdict === "pass", text: code.verdict === "pass" ? AXIS_WORDS.code.pass : AXIS_WORDS.code.fail, sub: code.verdict === "pass" ? "" : clip(code.notes, 90) },
        ]
      : [];
  const walked = typeof r?.review?.walked === "boolean" ? { text: r.review.walked ? WALKED_WORDS.yes : WALKED_WORDS.no, ok: r.review.walked } : null;

  const items = (r?.checklist ?? []).map((c) => ({ n: c.n, text: c.text, mark: c.mark }));
  const passed = items.filter((c) => c.mark === "pass").length;
  const checklist = { title: items.length ? `Check list del PO · ${passed} de ${items.length}` : "Check list del PO", items };
  return { tests, review, axes, walked, checklist, stills: (r?.captures?.image_urls ?? []).slice(0, 2), pr: prOf(d), loading: read === undefined };
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
