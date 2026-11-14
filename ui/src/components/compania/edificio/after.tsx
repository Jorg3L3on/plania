// PLA-I40-6: under the team, Solo tú (what only he does); Lo último (the last three things that happened, one line
// each) sits on the plate under Pedir. Pasa sin ti is no longer drawn. An answer he already gave is one of those lines (Ver opens the same body
// the bubble had); a request of his that nobody took is a warning here with Reenviar and Cerrar. Presentational.
import type { ReactNode } from "react";
import type { Decision, OrgProject } from "@/lib/api";
import { AUTO_LABEL, SOLO_TU, SOLO_TU_AUTO, lastLines, staleAge, whenWord } from "@/lib/edificio";
import { DecisionBody } from "@/components/compania/v2";
import type { NowActs } from "./now";
import type { QuestionActs } from "./question";

export const After = ({
  project: p,
  decisions,
  now,
  timeZone,
  acts,
  qacts,
  solo,
  hideAuto,
}: {
  project: OrgProject;
  decisions: Decision[];
  now: number;
  timeZone?: string;
  acts?: NowActs;
  qacts?: QuestionActs;
  // PLA-I40-7: the project's switch, drawn under Solo tú.
  solo?: ReactNode;
  // PLA-I46-10: the evidence card carries the switch while a delivery waits; one switch on screen, not two.
  hideAuto?: boolean;
}) => {
  if (p.latest === undefined) return null;
  const auto = p.auto_accept;
  return (
    <div className="edi-after" data-after>
      <section className="edi-acol" data-col="solo-tu">
        <h3>Solo tú</h3>
        <p>{auto?.on ? SOLO_TU_AUTO : SOLO_TU}</p>
        {auto && acts?.onAuto && !hideAuto && (
          <label className="edi-now edi-auto" htmlFor={`auto-${p.slug}`}>
            <input id={`auto-${p.slug}`} type="checkbox" checked={auto.on} disabled={acts.busy === `${p.slug}:auto`} onChange={(e) => acts.onAuto!(p.slug, e.currentTarget.checked)} data-control="aceptar-sola" />
            {AUTO_LABEL}
          </label>
        )}
        {auto?.on && auto.hold && (
          <p className="edi-autohold" data-auto-hold>
            No se aceptó sola: {auto.hold}
          </p>
        )}
        {solo}
      </section>
    </div>
  );
};

// Lo último, on the plate under Pedir.
export const Last = ({
  project: p,
  decisions,
  now,
  timeZone,
  acts,
  qacts,
}: {
  project: OrgProject;
  decisions: Decision[];
  now: number;
  timeZone?: string;
  acts?: NowActs;
  qacts?: QuestionActs;
}) => {
  if (p.latest === undefined) return null;
  const last = lastLines(p, decisions, 6);
  const stale = p.stale_requests ?? [];
  return (
    <section className="edi-acol edi-plate-last" data-col="ultimo">
        <h3>Lo último</h3>
        {stale.map((r) => (
          <div key={r.key} className="edi-stale" data-stale={r.key} role="status">
            <p>
              Tu pedido «{r.title}» lleva {staleAge(r.since, now)} sin que nadie lo tome.
            </p>
            <div className="edi-links">
              {acts?.onResend && (
                <button type="button" className="edi-mini" onClick={() => acts.onResend!(p.slug, r.key)} disabled={acts.busy === `${p.slug}:request`} data-control="reenviar">
                  Reenviar
                </button>
              )}
              {acts?.onClose && (
                <button type="button" className="edi-mini" onClick={() => acts.onClose!(p.slug, r.key)} disabled={acts.busy === `${p.slug}:request`} data-control="cerrar-pedido">
                  Cerrar
                </button>
              )}
            </div>
          </div>
        ))}
        {last.length === 0 && stale.length === 0 && <p>Todavía no pasa nada aquí.</p>}
        {/* PLA-I46-4: the newest line only; «Ver todo» unfolds the rest, each answer with its Ver. */}
        {last[0] && (
          <div className="edi-last" data-last={last[0].decision ? "answered" : "seen"}>
            <p>
              <time dateTime={last[0].at}>{whenWord(last[0].at, now, timeZone)}</time>
              <span>{last[0].text}</span>
            </p>
          </div>
        )}
        {last.length > 0 && (last.length > 1 || (last[0]!.decision && qacts)) && (
          <details className="edi-lastall" data-last-all>
            <summary>Ver todo</summary>
            {last.map((l) => (
              <div key={l.id} className="edi-last" data-last={l.decision ? "answered" : "seen"}>
                <p>
                  <time dateTime={l.at}>{whenWord(l.at, now, timeZone)}</time>
                  <span>{l.text}</span>
                </p>
                {l.decision && qacts && (
                  <details className="dark edi-lastd">
                    <summary>Ver</summary>
                    <DecisionBody d={l.decision} now={qacts.now} busy={qacts.busy} error={qacts.errors?.[l.decision.id] ?? null} opened={qacts.opened === l.decision.id} onAct={qacts.onAct} onPublish={qacts.onPublish} />
                  </details>
                )}
              </div>
            ))}
          </details>
        )}
    </section>
  );
};
