// PLA-I46-11: el plan para aceptar (design screen 4). When the PO plans a leg, Ahora carries the plan: up to 4 steps,
// up to 3 closed questions with the PO's suggestion already marked, and the PO's check list (3 things to verify)
// that the owner may edit. Three exits: Aceptar plan (the floor's move, green: Ahora's ActButton, the Tú window's
// and the phone bar's) · Cambiar algo (one line to the PO, who plans again) · Después (it waits; nothing starts).
// A plan left for later shows as one quiet line with Ver el plan, which opens it with its own Aceptar plan.
// Stateful pieces are memo components (test/edificio-ui.test.ts expands plain function components).
import { memo } from "react";
import type { Decision, OrgProject } from "@/lib/api";
import type { QuestionActs } from "./question";
import { draftOf, legPlanOf, planInput, setDraft, useDraft } from "./plan-draft";

export const PLAN_WORDS = { accept: "Aceptar plan", change: "Cambiar algo", later: "Después", see: "Ver el plan", hide: "Cerrar", send: "Enviar al PO", suggested: "sugerida" } as const;

const busyOn = (d: Decision, q?: QuestionActs) => q?.busy?.id === d.id;
const act = (d: Decision, q: QuestionActs | undefined, action: "empezar" | "cambiar" | "despues") => {
  if (!q) return;
  const x = draftOf(d);
  if (action === "cambiar") return q.onAct(d, { action, text: x.text.trim() }, "plan-cambiar");
  q.onAct(d, { action, ...planInput(d, action) }, `plan-${action}`);
};

// The plan Ahora shows on this floor: the move's own plan, or one left for later.
export function floorPlan(p: OrgProject, decisions: Decision[]): { d: Decision; waiting: boolean } | null {
  const d = legPlanOf(p.slug, decisions);
  if (!d) return null;
  return { d, waiting: !!d.plan?.later_at };
}

// The exits beside the main button. While waiting: Ver el plan, then (open) its own Aceptar plan and Cambiar algo.
export const PlanActs = memo(function PlanActs({ d, waiting, qacts }: { d: Decision; waiting: boolean; qacts?: QuestionActs }) {
  const x = useDraft(d);
  const busy = busyOn(d, qacts) || !!qacts?.disabled;
  const change = (
    <button type="button" className="edi-btn" data-plan-act="cambiar" aria-expanded={x.changing} onClick={() => setDraft(d, { changing: !x.changing, open: true })} disabled={busy}>
      {PLAN_WORDS.change}
    </button>
  );
  if (waiting && !x.open)
    return (
      <button type="button" className="edi-btn" data-plan-act="ver" onClick={() => setDraft(d, { open: true })}>
        {PLAN_WORDS.see}
      </button>
    );
  if (waiting)
    return (
      <>
        <button type="button" className="edi-nact edi-go" data-plan-act="empezar" onClick={() => act(d, qacts, "empezar")} disabled={busy}>
          {busy && qacts?.busy?.key === "plan-empezar" ? "…" : PLAN_WORDS.accept}
        </button>
        {change}
        <button type="button" className="edi-btn" data-plan-act="cerrar" onClick={() => setDraft(d, { open: false, changing: false })}>
          {PLAN_WORDS.hide}
        </button>
      </>
    );
  return (
    <>
      {change}
      <button type="button" className="edi-btn" data-plan-act="despues" onClick={() => act(d, qacts, "despues")} disabled={busy}>
        {busy && qacts?.busy?.key === "plan-despues" ? "…" : PLAN_WORDS.later}
      </button>
    </>
  );
});

// Steps, questions and the check list; the Cambiar algo line when it is open. Hidden while a waiting plan is closed.
export const PlanBody = memo(function PlanBody({ d, waiting, qacts }: { d: Decision; waiting: boolean; qacts?: QuestionActs }) {
  const x = useDraft(d);
  if (waiting && !x.open) return null;
  const plan = d.plan!;
  const qs = plan.questions ?? [];
  const busy = busyOn(d, qacts) || !!qacts?.disabled;
  const error = qacts?.errors?.[d.id];
  return (
    <div className="edi-plan" data-plan={d.id} data-waiting={waiting ? "1" : undefined}>
      <div className="edi-pcol" data-plan-steps>
        <p className="edi-peye">{plan.steps.length === 1 ? "1 paso" : `${plan.steps.length} pasos`}</p>
        <ol>
          {plan.steps.map((s, i) => (
            <li key={i} title={`Hecho cuando: ${s.done_when}`}>
              {s.title}
            </li>
          ))}
        </ol>
      </div>
      {qs.length > 0 && (
        <div className="edi-pcol" data-plan-questions>
          <p className="edi-peye">{qs.length === 1 ? "1 pregunta" : `${qs.length} preguntas`}</p>
          {qs.map((q, i) => (
            <div key={i} className="edi-pq" role="radiogroup" aria-label={q.text}>
              <span>{q.text}</span>
              <span className="edi-popts">
                {q.options.map((o, k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    className="edi-popt"
                    aria-checked={x.answers[i] === k}
                    data-suggested={k === q.suggested ? "1" : undefined}
                    onClick={() => setDraft(d, { answers: x.answers.map((a, j) => (j === i ? k : a)) })}
                    disabled={busy}
                  >
                    {o}
                    {k === q.suggested && <sup>{PLAN_WORDS.suggested}</sup>}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="edi-pcol" data-plan-checklist>
        <p className="edi-peye">Check list del PO · la puedes editar</p>
        {x.checklist.map((c, i) => (
          <input
            key={i}
            className="edi-pfield"
            value={c}
            maxLength={200}
            aria-label={`Cosa a verificar ${i + 1}`}
            aria-invalid={!c.trim() || undefined}
            onChange={(e) => setDraft(d, { checklist: x.checklist.map((v, j) => (j === i ? e.target.value : v)) })}
            disabled={busy}
          />
        ))}
      </div>
      {x.changing && (
        <form
          className="edi-pchange"
          onSubmit={(e) => {
            e.preventDefault();
            if (x.text.trim()) act(d, qacts, "cambiar");
          }}
        >
          <input className="edi-pfield" value={x.text} maxLength={500} placeholder="Qué cambiar, en una línea. El PO rehace el plan." aria-label="Qué cambiar del plan" onChange={(e) => setDraft(d, { text: e.target.value })} disabled={busy} />
          <button type="submit" className="edi-btn" disabled={busy || !x.text.trim()}>
            {busy && qacts?.busy?.key === "plan-cambiar" ? "…" : PLAN_WORDS.send}
          </button>
        </form>
      )}
      {error && (
        <p className="edi-perr" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
