// AUDIT-8: the PO's decisions on an idea, as closed questions. When the idea stage delivered data, la ficha's
// Entendido lists them with the recommended option already chosen; it applies unless the owner changes it.
import type { IdeaDecision, IdeaDecisionInput } from "@/lib/api";
import { Btn, Label } from "./parts";

/** AUDIT-8: what one decision says under its options. marked is the option he has marked (the one in force until he marks another). */
export function decisionWords(q: IdeaDecision, marked: number): { line: string; act: "confirm" | "change" | null; label: string } {
  const name = (n: number) => `«${q.options[n - 1] ?? ""}»`;
  if (marked !== q.chosen) return { line: `Si cambias a ${name(marked)}, la idea vuelve al PO para rehacerla con tu respuesta.`, act: "change", label: `Cambiar a ${name(marked)}` };
  if (q.state === "decided") return { line: `Tú decidiste ${name(q.chosen)}.${q.chosen === q.recommended ? "" : ` El PO recomendaba ${name(q.recommended)}.`}`, act: null, label: "" };
  return { line: `Se aplica ${name(q.recommended)} si no la cambias. ${q.why}`, act: "confirm", label: "Así está bien" };
}

/** AUDIT-8: the PO's decisions as closed questions. The recommended option comes chosen; nothing waits for him. */
export const Decisiones = ({ decisions, dec, why, open, busy, onMark, onWhy, onSend }: { decisions: IdeaDecision[]; dec: Record<number, number>; why: Record<number, string>; open: boolean; busy: boolean; onMark: (n: number, option: number) => void; onWhy: (n: number, text: string) => void; onSend: (input: IdeaDecisionInput) => void }) => (
  <section className="cor-decisiones" data-decisiones={decisions.length} aria-label="Lo que el PO da por hecho">
    <Label tone="violet">Lo que el PO da por hecho</Label>
    <p className="cor-text">Son sus dudas, ya con respuesta. La marcada se aplica si no la cambias; nada te espera.</p>
    {decisions.map((q) => {
      const marked = dec[q.n] ?? q.chosen;
      const w = decisionWords(q, marked);
      const send = () => onSend({ decision: q.n, option: marked, question: q.question, ...(w.act === "change" && why[q.n]?.trim() ? { text: why[q.n]!.trim() } : {}) });
      return (
        <div key={q.n} className="cor-card cor-decision" data-decision={q.n} data-state={q.state}>
          <b>{q.question}</b>
          <div className="cor-opts" role="radiogroup" aria-label={q.question}>
            {q.options.map((o, i) => (
              <button key={o} type="button" role="radio" aria-checked={marked === i + 1} className="cor-opt" disabled={!open || busy} onClick={() => onMark(q.n, i + 1)} data-option={i + 1}>
                {o}
                {i + 1 === q.recommended && <small>recomendada</small>}
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
              <input className="cor-input" maxLength={1000} value={why[q.n] ?? ""} aria-label="Por qué la cambias (opcional)" placeholder="¿Por qué? (opcional)" onChange={(e) => onWhy(q.n, e.target.value)} />
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
