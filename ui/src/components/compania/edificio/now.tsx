// PLA-I40-4: the band at the top of a floor. One state word, one sentence that says what is happening and until
// when (lib/edificio.ts nowLine), a second line with the reason, and the one action the owner can take. With a
// start time it counts down every second; with reduced motion it only shows the time. Presentational: the page
// holds the calls (test/i40-floor-ui.test.ts renders it with fake data). PLA-I46-3: when the floor has a move (the
// server's next_move) the band says its texto, breathes in orange and its button is green; ActButton and runOf are
// shared with the Tú window and the phone bar, so the three run the same action.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Decision, OrgProject } from "@/lib/api";
import { countdown, type NowAction, type NowLine } from "@/lib/edificio";
import { PlanActs, PlanBody, floorPlan } from "./plan";
import { planInput } from "./plan-draft";
import { revealQuestion } from "./publish";
import type { QuestionActs } from "./question";

export type NowActs = {
  // Que empiece ya / Seguir de todos modos: start that teammate's next run now.
  onStart?: (slug: string, agent: string, pastGuard: boolean) => void;
  // Que PO lo planee: an order to the project's PO.
  onPlan?: (slug: string, text: string) => void;
  // PLA-I40-6: a request nobody took: send it to the PO again, or close it.
  onResend?: (slug: string, key: string) => void;
  onClose?: (slug: string, key: string) => void;
  // PLA-I40-7: the project's accept-by-itself switch.
  onAuto?: (slug: string, on: boolean) => void;
  // The countdown reached zero: read the floor again.
  onElapsed?: () => void;
  // "<slug>:<kind>" while a call is out.
  busy?: string | null;
};

const Tick = ({ until, now, label, onElapsed }: { until: string; now: number; label: string; onElapsed?: () => void }) => {
  const [at, setAt] = useState(now);
  const told = useRef(false);
  useEffect(() => {
    if (told.current || at < Date.parse(until)) return;
    told.current = true;
    onElapsed?.();
  }, [at, until, onElapsed]);
  useEffect(() => {
    setAt(Date.now());
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setAt(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [until]);
  return (
    <p className="edi-ntick" data-countdown={until} role="timer" aria-live="off">
      <b>{countdown(until, at)}</b>
      <span>{label}</span>
    </p>
  );
};

// PLA-I46-3: what a click on an action does. The same function backs Ahora's button, the Tú window's and the phone
// bar's, so the three run the same thing. Null when this page cannot do it here (no handler passed).
export type MoveCtx = { decisions?: Decision[]; acts?: NowActs; qacts?: QuestionActs; onFijar?: (p: OrgProject) => void; onPublish?: (p: OrgProject) => void };
export function runOf(p: OrgProject, a: NowAction | null, c: MoveCtx): (() => void) | null {
  if (!a) return null;
  if (a.kind === "start") return c.acts?.onStart ? () => c.acts!.onStart!(p.slug, a.agent, "pastGuard" in a ? a.pastGuard : false) : null;
  if (a.kind === "decision") {
    const d = c.decisions?.find((x) => x.id === a.id);
    // PLA-I46-11: Aceptar plan sends the answers and the check list as the owner left them.
    return d && c.qacts ? () => c.qacts!.onAct(d, { action: a.action, ...planInput(d, a.action) }, `now-${a.action}`) : null;
  }
  if (a.kind === "reveal") return () => revealQuestion(p.slug);
  if (a.kind === "publish") return c.onPublish ? () => c.onPublish!(p) : null;
  if (a.kind === "fijar") return c.onFijar ? () => c.onFijar!(p) : null;
  if (a.kind === "link") return null;
  return c.acts?.onPlan ? () => c.acts!.onPlan!(p.slug, a.text) : null;
}
const busyOf = (p: OrgProject, a: NowAction, c: MoveCtx) => c.acts?.busy === `${p.slug}:${a.kind}` || (a.kind === "decision" && c.qacts?.busy?.id === a.id);

// The one button of an action. A move is green (edi-go); anything else is a secondary outline button. where says
// which surface draws it (ahora, tu, barra), so the phone bar can stand in for Ahora's at 390.
export const ActButton = ({ project: p, action: a, move, where, ctx, className = "" }: { project: OrgProject; action: NowAction; move: boolean; where: "ahora" | "tu" | "barra"; ctx: MoveCtx; className?: string }) => {
  const cls = `${move ? "edi-nact edi-go" : "edi-btn"} ${className}`.trim();
  const data = { "data-now-action": a.kind, "data-where": where, "data-move": move ? "1" : undefined, "data-control": `${where}-${a.kind}` };
  if (a.kind === "link")
    return (
      <a href={a.href} className={cls} {...data}>
        {a.label}
      </a>
    );
  const run = runOf(p, a, ctx);
  if (!run) return null;
  const busy = busyOf(p, a, ctx);
  return (
    <button type="button" className={cls} onClick={run} disabled={busy || ctx.qacts?.disabled} {...data}>
      {busy ? "…" : a.label}
    </button>
  );
};

export const Now = ({
  project: p,
  line,
  now,
  decisions,
  acts,
  qacts,
  onFijar,
  onPublish,
  side,
}: {
  project: OrgProject;
  line: NowLine;
  now: number;
  decisions?: Decision[];
  acts?: NowActs;
  qacts?: QuestionActs;
  onFijar?: (p: OrgProject) => void;
  onPublish?: (p: OrgProject) => void;
  // PLA-I46-7: the Ventana a la app, beside the text (under it at 390).
  side?: ReactNode;
}) => {
  const a = line.action;
  const ctx: MoveCtx = { decisions, acts, qacts, onFijar, onPublish };
  // PLA-I46-11: the leg's plan, when it is this move or waits for later (plan.tsx).
  const fp = decisions ? floorPlan(p, decisions) : null;
  const plan = fp && (fp.waiting || (line.move?.origen.kind === "decision" && line.move.origen.id === fp.d.id)) ? fp : null;
  // PLA-I46-3: only a card with a move breathes (data-breathe); the CSS stops it under reduce-motion.
  return (
    <div className="edi-nowb" data-now={line.state} data-holder={line.holder ?? undefined} data-breathe={line.move ? "1" : undefined} data-side={side ? "1" : undefined} aria-live="polite">
      <div className="edi-ntext">
        <p className="edi-nword" data-now-word>
          {line.word}
        </p>
        <p className="edi-nsay" data-now-say>
          {line.say}
        </p>
        {line.why && (
          <p className="edi-nwhy" data-now-why>
            {line.why}
          </p>
        )}
        {(a || plan) && (
          <div className="edi-nacts">
            {a && <ActButton project={p} action={a} move={!!line.move} where="ahora" ctx={ctx} />}
            {plan && <PlanActs d={plan.d} waiting={plan.waiting} qacts={qacts} />}
          </div>
        )}
      </div>
      {plan && <PlanBody d={plan.d} waiting={plan.waiting} qacts={qacts} />}
      {side}
      {line.starts_at && <Tick key={line.starts_at} until={line.starts_at} now={now} label={line.state === "stuck" ? "para reintentar" : "para arrancar"} onElapsed={acts?.onElapsed} />}
    </div>
  );
};
