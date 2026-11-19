// AUDIT-8: the PO's decisions on an idea, as closed questions. When the idea stage delivered data, la ficha's
// Entendido lists them with the recommended option already chosen; it applies unless the owner changes it.
import type { IdeaDecision, IdeaDecisionInput } from "@/lib/api";
import { words } from "@/lib/i18n";
import { DECISIONES_WORDS } from "@/lib/decisiones-words";
import { Btn, Label } from "./parts";

// PLA-88: where a change goes once the idea is past the PO's stop: who has it now and the stop it stays on.
export type Forward = { to: string; stop: string };
/** PLA-88: the stage an idea sits on, as where a changed decision goes (null on the idea stage: the PO redoes it). */
export const forwardOf = (stage: string | null | undefined): Forward | null => (stage ? (words(DECISIONES_WORDS).forward[stage] ?? null) : null);

/** AUDIT-8: what one decision says under its options. marked is the option he has marked (the one in force until he marks another). */
export function decisionWords(q: IdeaDecision, marked: number, forward: Forward | null = null): { line: string; act: "confirm" | "change" | null; label: string } {
  const w = words(DECISIONES_WORDS);
  const name = (n: number) => w.quote(q.options[n - 1] ?? "");
  if (marked !== q.chosen)
    return {
      line: forward ? w.changeForward(name(marked), forward) : w.changeBack(name(marked)),
      act: "change",
      label: w.changeTo(name(marked)),
    };
  if (q.state === "decided") return { line: `${w.decided(name(q.chosen))}${q.chosen === q.recommended ? "" : w.recommended(name(q.recommended))}`, act: null, label: "" };
  return { line: w.applies(name(q.recommended), q.why), act: "confirm", label: w.fine };
}

/** AUDIT-8: the PO's decisions as closed questions. The recommended option comes chosen; nothing waits for him. */
export const Decisiones = ({ decisions, dec, why, open, busy, forward = null, onMark, onWhy, onSend }: { decisions: IdeaDecision[]; dec: Record<number, number>; why: Record<number, string>; open: boolean; busy: boolean; forward?: Forward | null; onMark: (n: number, option: number) => void; onWhy: (n: number, text: string) => void; onSend: (input: IdeaDecisionInput) => void }) => {
  const t = words(DECISIONES_WORDS);
  return (
  <section className="cor-decisiones" data-decisiones={decisions.length} aria-label={t.title}>
    <Label tone="violet">{t.title}</Label>
    <p className="cor-text">{t.intro}</p>
    {decisions.map((q) => {
      const marked = dec[q.n] ?? q.chosen;
      const w = decisionWords(q, marked, forward);
      const send = () => onSend({ decision: q.n, option: marked, question: q.question, ...(w.act === "change" && why[q.n]?.trim() ? { text: why[q.n]!.trim() } : {}) });
      return (
        <div key={q.n} className="cor-card cor-decision" data-decision={q.n} data-state={q.state}>
          <b>{q.question}</b>
          <div className="cor-opts" role="radiogroup" aria-label={q.question}>
            {q.options.map((o, i) => (
              <button key={o} type="button" role="radio" aria-checked={marked === i + 1} className="cor-opt" disabled={!open || busy} onClick={() => onMark(q.n, i + 1)} data-option={i + 1}>
                {o}
                {i + 1 === q.recommended && <small>{t.recommendedTag}</small>}
              </button>
            ))}
          </div>
          <p className="cor-text">{w.line}</p>
          {open && w.act === "change" && (
            <form
              className="cor-ajuste-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy) send();
              }}
            >
              <input className="cor-input" maxLength={1000} value={why[q.n] ?? ""} aria-label={t.whyLabel} placeholder={t.whyPlaceholder} onChange={(e) => onWhy(q.n, e.target.value)} />
              <Btn kind="primary" type="submit" disabled={busy} data-control="idea-decision-cambiar">
                {w.label}
              </Btn>
            </form>
          )}
          {open && w.act === "confirm" && (
            <div className="cor-acts">
              <Btn kind="secondary" small disabled={busy} onClick={send} data-control="idea-decision-confirmar">
                {w.label}
              </Btn>
            </div>
          )}
        </div>
      );
    })}
  </section>
  );
};
