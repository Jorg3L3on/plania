// PLA-I46-10: the evidence card (design screen 3). When the floor's move is to accept a delivery, Ahora carries what
// QA saw on it: the tests (14 de 14), the separate review, «Check list del PO» (3 de 3) and the stills of that
// delivery. Pure: the card (components/compania/edificio/evidence.tsx) draws what evidenceView returns, and
// test/i46-decision-ui.test.ts feeds it plain objects. A project without QA still shows the tests the ticket's own
// results carry (Decision.evidence), and says plainly that there was no separate review.
import type { Decision, QaRead } from "./api";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

// PLA-I2-10: the evidence card's words in both languages. The constants below (RETURN_REASONS, EV_WORDS, AXIS_WORDS,
// WALKED_WORDS, APPROVE, APPROVED) keep the Spanish for callers that read them; evidenciaWords() follows the screen.
export const EVIDENCIA_WORDS = defineWords({
  es: {
    returnReasons: ["No se ve bien", "Falta algo", "El texto", "Otra cosa"] as [string, ...string[]],
    ev: {
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
    },
    axis: {
      spec: { pass: "Hace lo que se pidió", fail: "No hace todo lo que se pidió" },
      code: { pass: "El código está bien", fail: "El código tiene un problema" },
    },
    walked: { yes: "QA recorrió la app", no: "QA no recorrió la app" },
    approve: {
      pr: { label: "Aprobar y pasar a prueba", hint: "Se integra a la copia de prueba; lo publicado no cambia. Luego arranca el siguiente paso." },
      done: { label: "Aprobar y cerrar", hint: "La entrega pasa a Hecho y arranca el siguiente paso." },
      plan: { label: "Aprobar el plan", hint: "Se crean sus pasos y Taller empieza." },
    },
    approved: { pr: "Aprobado · en la copia de prueba", done: "Aprobado · cerrado" },
    unseen: " Sin vista previa: la apruebas sin haberla visto.",
    named: (title: string) => `«${title}»`,
    theDelivery: "la entrega",
    acceptAria: (name: string, pr: boolean) => `Aprobar ${name} y ${pr ? "pasar a prueba" : "cerrar"}`,
    of: (n: number, total: number) => `${n} de ${total}`,
    testsPassSub: "pasan en la entrega",
    testsNotAllSub: "no todas pasan",
    pass: "Pasan",
    fail: "Fallan",
    ticketTestSub: "según la última prueba del ticket",
    noTests: "Sin pruebas",
    noTestsSub: "nadie las corrió todavía",
    noFindings: "Sin hallazgos",
    noFindingsSub: "otro agente, sin ver a Taller",
    found: "Encontró algo",
    inProgress: "En curso",
    inProgressSub: "QA la está haciendo",
    noReview: "Sin revisión aparte",
    noReviewSub: "QA no la hizo en esta entrega",
    noQaSub: "no hay QA en este equipo",
    checklist: "Check list del PO",
    checklistOf: (passed: number, total: number) => `Check list del PO · ${passed} de ${total}`,
  },
  en: {
    returnReasons: ["It does not look right", "Something is missing", "The text", "Something else"],
    ev: {
      accept: "Approve and send to test",
      back: "Send back to Taller",
      send: "Send back",
      cancel: "Cancel",
      pr: "See PR",
      note: "See note",
      hideNote: "Hide note",
      sheet: "Send back to Taller",
      line: "What you would change, for Taller (optional)",
      auto: "Approve by itself if the tests pass (only to the test copy)",
    },
    axis: {
      spec: { pass: "It does what was asked", fail: "It does not do everything that was asked" },
      code: { pass: "The code is sound", fail: "The code has a problem" },
    },
    walked: { yes: "QA went through the app", no: "QA did not go through the app" },
    approve: {
      pr: { label: "Approve and send to test", hint: "It goes into the test copy; what is published does not change. Then the next step starts." },
      done: { label: "Approve and close", hint: "The delivery moves to Done and the next step starts." },
      plan: { label: "Approve the plan", hint: "Its steps are created and Taller starts." },
    },
    approved: { pr: "Approved · on the test copy", done: "Approved · closed" },
    unseen: " No preview: you approve it without having seen it.",
    named: (title: string) => `“${title}”`,
    theDelivery: "the delivery",
    acceptAria: (name: string, pr: boolean) => `Approve ${name} and ${pr ? "send to test" : "close"}`,
    of: (n: number, total: number) => `${n} of ${total}`,
    testsPassSub: "pass on the delivery",
    testsNotAllSub: "not all pass",
    pass: "Pass",
    fail: "Fail",
    ticketTestSub: "from the ticket's last test",
    noTests: "No tests",
    noTestsSub: "nobody ran them yet",
    noFindings: "No findings",
    noFindingsSub: "another agent, without seeing Taller",
    found: "Found something",
    inProgress: "In progress",
    inProgressSub: "QA is doing it",
    noReview: "No separate review",
    noReviewSub: "QA did not do it on this delivery",
    noQaSub: "there is no QA on this team",
    checklist: "PO's checklist",
    checklistOf: (passed: number, total: number) => `PO's checklist · ${passed} of ${total}`,
  },
});
export const evidenciaWords = (language: Language = getLanguage()) => words(EVIDENCIA_WORDS, language);

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
// The reason is also what Taller reads, as free text (the server never parses it): the screen sends the reasons in
// its own language (evidenciaWords().returnReasons); the Spanish constant stays for its readers.
export const RETURN_REASONS: readonly [string, ...string[]] = EVIDENCIA_WORDS.es.returnReasons;
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
export const EV_WORDS = EVIDENCIA_WORDS.es.ev;

// AUDIT-6: the review's two verdicts and the walk-through, in the owner's words.
export const AXIS_WORDS = EVIDENCIA_WORDS.es.axis;
export const WALKED_WORDS = EVIDENCIA_WORDS.es.walked;

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
export const APPROVE = EVIDENCIA_WORDS.es.approve;
export const APPROVED = EVIDENCIA_WORDS.es.approved;
export function acceptWords(d: Pick<Decision, "kind" | "links" | "preview_url"> & { title?: string | null }, opts: { seen?: boolean } = {}, language: Language = getLanguage()): AcceptWords {
  const t = words(EVIDENCIA_WORDS, language);
  const pr = d.kind === "pr" || !!prOf(d);
  const w = pr ? t.approve.pr : t.approve.done;
  const unseen = d.preview_url || opts.seen ? "" : t.unseen;
  const name = d.title ? t.named(clip(d.title, 70)) : t.theDelivery;
  return { label: w.label, hint: `${w.hint}${unseen}`, aria: t.acceptAria(name, pr) };
}

export function evidenceView(read: QaRead | null | undefined, d: Pick<Decision, "evidence" | "links">, language: Language = getLanguage()): EvidenceView {
  const w = words(EVIDENCIA_WORDS, language);
  const r = read ?? null;
  let tests: Tile;
  if (r && r.tests.total > 0) tests = { value: w.of(r.tests.pass, r.tests.total), ok: r.tests.verdict === "pass", sub: r.tests.verdict === "pass" ? w.testsPassSub : w.testsNotAllSub };
  else if (r && r.tests.items.length > 0) tests = { value: r.tests.verdict === "pass" ? w.pass : w.fail, ok: r.tests.verdict === "pass", sub: r.tests.items.map((i) => i.name).join(", ") };
  else if (d.evidence && d.evidence.pass != null) {
    const total = d.evidence.pass + (d.evidence.fail ?? 0);
    tests = { value: w.of(d.evidence.pass, total), ok: d.evidence.verdict === "pass" && !d.evidence.fail, sub: w.ticketTestSub };
  } else if (d.evidence) tests = { value: d.evidence.verdict === "pass" ? w.pass : w.fail, ok: d.evidence.verdict === "pass", sub: clip(d.evidence.cite, 60) };
  else tests = { value: w.noTests, ok: null, sub: w.noTestsSub };

  let review: Tile;
  if (r?.review) review = r.review.verdict === "pass" ? { value: w.noFindings, ok: true, sub: w.noFindingsSub } : { value: w.found, ok: false, sub: clip(r.review.notes, 90) };
  else if (r && BUSY.has(r.state)) review = { value: w.inProgress, ok: null, sub: w.inProgressSub };
  else review = { value: w.noReview, ok: null, sub: r?.enabled ? w.noReviewSub : w.noQaSub };

  // AUDIT-6: the two verdicts, each on its own line; a failing one carries the start of QA's note.
  const { spec, code } = r?.review ?? {};
  const axes: AxisLine[] =
    spec && code
      ? [
          { axis: "spec", ok: spec.verdict === "pass", text: spec.verdict === "pass" ? w.axis.spec.pass : w.axis.spec.fail, sub: spec.verdict === "pass" ? "" : clip(spec.notes, 90) },
          { axis: "code", ok: code.verdict === "pass", text: code.verdict === "pass" ? w.axis.code.pass : w.axis.code.fail, sub: code.verdict === "pass" ? "" : clip(code.notes, 90) },
        ]
      : [];
  const walked = typeof r?.review?.walked === "boolean" ? { text: r.review.walked ? w.walked.yes : w.walked.no, ok: r.review.walked } : null;

  const items = (r?.checklist ?? []).map((c) => ({ n: c.n, text: c.text, mark: c.mark }));
  const passed = items.filter((c) => c.mark === "pass").length;
  const checklist = { title: items.length ? w.checklistOf(passed, items.length) : w.checklist, items };
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
