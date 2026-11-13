// PLA-I40-4: the band at the top of a floor. One state word, one sentence that says what is happening and until
// when (lib/edificio.ts nowLine), a second line with the reason, and the one action the owner can take. With a
// start time it counts down every second; with reduced motion it only shows the time. Presentational: the page
// holds the calls (test/i40-floor-ui.test.ts renders it with fake data).
import { useEffect, useRef, useState } from "react";
import type { Decision, OrgProject } from "@/lib/api";
import { countdown, type NowLine } from "@/lib/edificio";
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

export const Now = ({
  project: p,
  line,
  now,
  decisions,
  acts,
  qacts,
  onFijar,
  onPublish,
}: {
  project: OrgProject;
  line: NowLine;
  now: number;
  decisions?: Decision[];
  acts?: NowActs;
  qacts?: QuestionActs;
  onFijar?: (p: OrgProject) => void;
  onPublish?: (p: OrgProject) => void;
}) => {
  const a = line.action;
  const d = a?.kind === "decision" ? decisions?.find((x) => x.id === a.id) : undefined;
  const run =
    !a
      ? null
      : a.kind === "start"
        ? acts?.onStart && (() => acts.onStart!(p.slug, a.agent, a.pastGuard))
        : a.kind === "decision"
          ? d && qacts && (() => qacts.onAct(d, { action: a.action }, `now-${a.action}`))
          : a.kind === "reveal"
            ? () => revealQuestion(p.slug)
            : a.kind === "publish"
              ? onPublish && (() => onPublish(p))
              : a.kind === "fijar"
                ? onFijar && (() => onFijar(p))
                : acts?.onPlan && (() => acts.onPlan!(p.slug, a.text));
  const busy = !!a && (acts?.busy === `${p.slug}:${a.kind}` || (a.kind === "decision" && qacts?.busy?.id === a.id));
  return (
    <div className="edi-nowb" data-now={line.state} data-holder={line.holder ?? undefined} aria-live="polite">
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
        {a && run && (
          <div className="edi-nacts">
            <button type="button" className="edi-nact" onClick={run} disabled={busy || qacts?.disabled} data-now-action={a.kind} data-control={`ahora-${a.kind}`}>
              {busy ? "…" : a.label}
            </button>
          </div>
        )}
      </div>
      {line.starts_at && <Tick key={line.starts_at} until={line.starts_at} now={now} label={line.state === "stuck" ? "para reintentar" : "para arrancar"} onElapsed={acts?.onElapsed} />}
    </div>
  );
};
