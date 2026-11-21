// PLA-I71-1: the levers on a seat's work, moved from Equipo to the work itself (the step's page): «Dile algo» (a note
// on this step, read on the seat's next step) and «Reanudar corrida» when the last run on this step was stopped.
// Detener is the step's own lever already (PasoActs), «Que empiece ya» lives in the Motores queue.
import { useState, type FormEvent } from "react";
import type { OrgProject } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import { words } from "@/lib/i18n";
import { EQUIPO_WORDS } from "@/lib/equipo-words";
import type { CorrienteActs } from "./acts";
import { Btn, Label } from "./parts";

/** Who works on this step now, and the stopped run on it that can be resumed (pure, for the test). */
export function workOn(p: Pick<OrgProject, "team">, key: string) {
  const live = p.team.find((m) => m.state === "running" && m.now?.ticket === key) ?? null;
  const stopped = live ? null : (p.team.find((m) => m.last?.ticket === key && m.last.status === "stopped" && m.last.run_id) ?? null);
  return { live, stopped: stopped ? { m: stopped, run: stopped.last!.run_id! } : null };
}

export const Trabajo = ({ p, k, acts }: { p: OrgProject; k: string; acts: CorrienteActs }) => {
  const w = words(EQUIPO_WORDS);
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const { live, stopped } = workOn(p, k);
  const who = live ?? stopped?.m ?? null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 2) return;
    acts.note(p.slug, k, text.trim());
    setSent(w.toldIt);
    setText("");
  };
  return (
    <section className="cor-trabajo" aria-label={w.sayLabel} data-trabajo={k}>
      <form className="cor-say" onSubmit={submit}>
        <Label as="p">{who ? w.sayTo(seatName(who.role)) : w.sayLabel}</Label>
        <span className="cor-ajuste-row">
          <input className="cor-input" value={text} maxLength={1000} aria-label={w.sayLabel} placeholder={w.sayPlaceholderBusy} onChange={(e) => setText(e.target.value)} />
          <Btn kind="secondary" type="submit" disabled={text.trim().length < 2} data-control="decir">
            {w.send}
          </Btn>
          {stopped && (
            <Btn kind="secondary" onClick={() => acts.resumeRun(stopped.run)} disabled={acts.busy === `resume-${stopped.run}`} data-control="reanudar-corrida">
              {w.resumeRun}
            </Btn>
          )}
        </span>
        <span className="cor-cap" role="status">
          {sent ?? w.sayHintBusy}
        </span>
      </form>
    </section>
  );
};
