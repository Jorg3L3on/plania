// PLA-I62-3: a project's Ahora tab (board B1). Left: what waits on the owner (the floor's move, word for word, with
// its one white button; a delivery also offers Ver antes y después and Pedir ajuste), or, when nothing does, where
// the work stands with the nudge the building offers (start a teammate, past the guard too, or «Arma el plan");
// then who works now with Detener, and the pasos in review that need nothing from him, with Publicar lo aceptado.
// Right: the goal (Fijar or Cambiar meta, date, forecast, this week, Ojo), the team in one line each, and the link to
// the project's page. Every call is /ceo's (components/corriente/acts.ts).
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { Decision, OrgMember, OrgProject, ProjectTicket } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import { nowLine, type NowAction, type NowLine } from "@/lib/edificio";
import { ETAPA_WORD } from "@/lib/etapas";
import { RETURN_REASONS, acceptWords, returnText } from "@/lib/evidencia";
import { rumboText } from "@/lib/v2";
import type { CorrienteActs } from "./acts";
import { Agent, Btn, Key, Label, State, You } from "./parts";

export const PLAN_ASK = "Arma el plan del proyecto: los entregables y los pasos de cada uno.";
const REVIEW = new Set(["en_qa", "en_revision", "integrado"]);
const STATE_WORD: Record<string, string> = { en_qa: "QA la prueba", en_revision: "En revisión", integrado: "Espera publicación" };

export type AhoraLinks = {
  entrega: (d: Decision) => string;
  /** A decision whose answer lives in Te toca (a question to reveal). */
  tetoca: (d: Decision | null) => string;
  paso: (key: string) => string;
  tablero: string;
  equipo: string;
  miembro: (agent: string) => string;
  publicar: string;
  pagina: string;
  /** The server's in-page links (#te-toca, #publicar). */
  hash: (href: string) => string;
};

const elapsedMin = (since: string | undefined, now: number) => {
  if (!since) return "";
  const m = Math.max(0, Math.round((now - Date.parse(since)) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/** What a decision's first line says above its title. */
export function youEyebrow(d: Decision | null, p: OrgProject): string {
  if (!d) return "Te toca";
  const who = d.asker ? seatName(d.asker.role) : null;
  switch (d.kind) {
    case "deliverable":
    case "pr":
      return `Te toca · ${who ?? "Taller"} te entrega`;
    case "plan":
      return `Te toca · ${who ?? "PO"} propone un plan`;
    case "proposal":
      return `Te toca · ${who ?? "PO"} te da opciones`;
    case "question":
      return `Te toca · ${who ?? "El equipo"} pregunta`;
    case "release":
      return `Te toca · publicar ${p.title}`;
    default:
      return "Te toca · un paso tuyo";
  }
}

/** Pedir ajuste: one reason, one optional line, Enviar a Taller. Taller reads «reason: line». */
export const Ajuste = ({ d, acts, onDone }: { d: Decision; acts: CorrienteActs; onDone: () => void }) => {
  const [reason, setReason] = useState<string>(RETURN_REASONS[0]);
  const [line, setLine] = useState("");
  const busy = acts.decisions.busy?.id === d.id;
  return (
    <form
      className="cor-ajuste"
      data-ajuste={d.id}
      onSubmit={(e) => {
        e.preventDefault();
        acts.decisions.decide(d, { action: "cambios", text: returnText(reason, line) }, "devolver");
        onDone();
      }}
    >
      <Label as="p" id={`aj-${d.id}`}>
        Pedir ajuste a Taller
      </Label>
      <div className="cor-seg" role="radiogroup" aria-labelledby={`aj-${d.id}`}>
        {RETURN_REASONS.map((x) => (
          <button key={x} type="button" role="radio" aria-checked={reason === x} className="cor-opt" onClick={() => setReason(x)} disabled={busy} data-reason={x}>
            {x}
          </button>
        ))}
      </div>
      <div className="cor-ajuste-row">
        <input className="cor-input" value={line} maxLength={300} placeholder="Una línea para Taller (opcional)" aria-label="Nota para Taller" onChange={(e) => setLine(e.target.value)} disabled={busy} />
        <Btn kind="secondary" type="submit" disabled={busy} data-control="enviar-ajuste">
          Enviar a Taller
        </Btn>
        <Btn kind="quiet" onClick={onDone}>
          Cancelar
        </Btn>
      </div>
    </form>
  );
};

/** The move's one button: what a click does is runOf's in the building, here with La corriente's calls. */
export const MoveButton = ({ p, a, d, primary, acts, links, onFijar }: { p: OrgProject; a: NowAction; d: Decision | null; primary: boolean; acts: CorrienteActs; links: AhoraLinks; onFijar: (p: OrgProject) => void }) => {
  const kind = primary ? "primary" : "secondary";
  const data = { "data-move-action": a.kind, "data-control": `ahora-${a.kind}` };
  if (a.kind === "link")
    return a.href.startsWith("#") ? (
      <Link className={`cor-btn ${kind}`} to={links.hash(a.href)} {...data}>
        {a.label}
      </Link>
    ) : (
      <a className={`cor-btn ${kind}`} href={a.href} {...data}>
        {a.label}
      </a>
    );
  if (a.kind === "reveal")
    return (
      <Link className={`cor-btn ${kind}`} to={links.tetoca(d)} {...data}>
        {a.label}
      </Link>
    );
  if (a.kind === "publish")
    return (
      <Link className={`cor-btn ${kind}`} to={links.publicar} {...data}>
        {a.label}
      </Link>
    );
  const busy = a.kind === "decision" ? acts.decisions.busy?.id === a.id : acts.busy === `${p.slug}:${a.kind}`;
  const accept = a.kind === "decision" && (a.action === "aceptar" || a.action === "fusionar") && d ? acceptWords(d).aria : undefined;
  const onClick = () => {
    if (a.kind === "decision") {
      if (!d) return;
      // A leg's plan goes with its suggested answers and its check list as they are.
      const plan = a.action === "empezar" && d.plan?.leg ? { answers: (d.plan.questions ?? []).map((q) => q.suggested), checklist: d.plan.checklist ?? [] } : {};
      acts.decisions.decide(d, { action: a.action, ...plan }, `now-${a.action}`);
    } else if (a.kind === "start") acts.start(p.slug, a.agent, "pastGuard" in a ? a.pastGuard : false);
    else if (a.kind === "fijar") onFijar(p);
    else if (a.kind === "plan") acts.plan(p.slug, a.text);
  };
  return (
    <Btn kind={kind} onClick={onClick} disabled={busy} title={accept} aria-label={accept} {...data}>
      {busy ? "…" : accept ? "Aceptar" : a.label}
    </Btn>
  );
};

const YouCard = ({ p, line, decisions, acts, links, onFijar }: { p: OrgProject; line: NowLine; decisions: Decision[]; acts: CorrienteActs; links: AhoraLinks; onFijar: (p: OrgProject) => void }) => {
  const o = line.move?.origen;
  const d = o?.kind === "decision" ? (decisions.find((x) => x.id === o.id) ?? null) : null;
  const [ajuste, setAjuste] = useState(false);
  const delivery = !!d && (d.kind === "deliverable" || d.kind === "pr");
  const error = d ? acts.decisions.errors[d.id] : null;
  return (
    <section className="cor-card you cor-youcard" aria-label="Te toca" data-you-card={d?.id ?? "move"}>
      <div className="cor-youcard-text">
        <Label tone="amber">{youEyebrow(d, p)}</Label>
        <h2 className="cor-h2">{d?.ref && delivery ? `${d.ref} · ${d.title}` : line.say}</h2>
        {line.why && <p className="cor-text cor-why">{line.why}</p>}
        {d && !delivery && d.title !== line.say && <p className="cor-text cor-ellipsis">{d.title}</p>}
        <div className="cor-acts">
          {line.action && <MoveButton p={p} a={line.action} d={d} primary acts={acts} links={links} onFijar={onFijar} />}
          {delivery && d && (
            <>
              <Link className="cor-btn secondary" to={links.entrega(d)} data-control="ver-entrega">
                Ver antes y después
              </Link>
              {d.actions.includes("cambios") && (
                <Btn kind="quiet" aria-expanded={ajuste} onClick={() => setAjuste((x) => !x)} data-control="pedir-ajuste">
                  Pedir ajuste
                </Btn>
              )}
            </>
          )}
        </div>
        {ajuste && d && <Ajuste d={d} acts={acts} onDone={() => setAjuste(false)} />}
        {error && (
          <p className="cor-state bad" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
};

/** Nothing waits on the owner: where the work stands, and the building's nudge when there is one. */
const StateCard = ({ p, line, acts, links, onFijar, emptyBoard }: { p: OrgProject; line: NowLine; acts: CorrienteActs; links: AhoraLinks; onFijar: (p: OrgProject) => void; emptyBoard: boolean }) => {
  const reason = p.light_reason && p.light !== "ok" && p.light !== "needs_jorge" ? p.light_reason : null;
  const canPlan = emptyBoard && !p.paused && !(p.route && p.route.legs.length > 0);
  return (
    <section className="cor-card cor-statecard" aria-label="Ahora" data-state-card={line.state}>
      <Label>{line.word}</Label>
      <h2 className="cor-h3">{line.say}</h2>
      {line.why && <p className="cor-text">{line.why}</p>}
      {reason && reason.text !== line.say && (
        <p className="cor-text" data-light-reason>
          {reason.text}
        </p>
      )}
      {(line.action || reason?.action || canPlan) && (
        <div className="cor-acts">
          {line.action && <MoveButton p={p} a={line.action} d={null} primary={false} acts={acts} links={links} onFijar={onFijar} />}
          {reason?.action && !line.action && (
            <Link className="cor-btn secondary" to={reason.action.href.startsWith("#") ? links.hash(reason.action.href) : reason.action.href} data-light-action>
              {reason.action.label}
            </Link>
          )}
          {canPlan && (
            <Btn kind="secondary" onClick={() => acts.plan(p.slug, PLAN_ASK)} disabled={acts.busy === `${p.slug}:plan`} data-control="planear">
              Arma el plan
            </Btn>
          )}
        </div>
      )}
    </section>
  );
};

const Running = ({ p, m, now, acts, links }: { p: OrgProject; m: OrgMember; now: number; acts: CorrienteActs; links: AhoraLinks }) => {
  const runId = m.now?.run_id ?? null;
  return (
    <div className="cor-card cor-run" data-running={m.agent}>
      <Agent />
      <div className="cor-run-text">
        <div className="cor-run-line">
          <Link to={links.miembro(m.agent)} className="cor-run-who">
            {seatName(m.role)}
          </Link>
          {m.now?.ticket && <Key>{m.now.ticket}</Key>}
          <span className="cor-body cor-ellipsis">{m.now?.title ?? "trabajando"}</span>
        </div>
        <div className="cor-bar" aria-hidden>
          <i className="cor-bar-fill" />
        </div>
      </div>
      <span className="cor-cap">{elapsedMin(m.now?.since, now).toUpperCase()}</span>
      {runId && (
        <Btn kind="secondary" onClick={() => acts.stopRun(runId)} disabled={acts.busy === `stop-${runId}`} data-control="detener" aria-label={`Detener a ${seatName(m.role)} de ${p.title}`}>
          {acts.busy === `stop-${runId}` ? "Deteniendo…" : "Detener"}
        </Btn>
      )}
    </div>
  );
};

const Row = ({ to, k, title, state, data }: { to: string; k: string; title: string; state: ReactNode; data?: string }) => (
  <Link className="cor-row cor-prow" to={to} data-row={data}>
    <Key>{k}</Key>
    <span className="cor-ellipsis cor-prow-title">{title}</span>
    {state}
  </Link>
);

export const Meta = ({ p, onFijar, now }: { p: OrgProject; onFijar: (p: OrgProject) => void; now: number }) => {
  const r = rumboText(p);
  const ojo = [
    ...(p.light_reason && p.light !== "ok" && p.light !== "needs_jorge" ? [p.light_reason.text] : []),
    ...(p.stale_requests ?? []).map((s) => `Nadie tomó «${s.title}»`),
  ];
  void now;
  return (
    <section aria-label="Meta del proyecto" className="cor-side-sec" data-meta>
      <div className="cor-side-head">
        <Label as="h2">Meta</Label>
        <Btn kind="link" onClick={() => onFijar(p)} data-control="fijar">
          {r.missing ? "Fijar meta" : "Cambiar meta"}
        </Btn>
      </div>
      <p className="cor-meta-goal">{r.goal ?? <span className="cor-muted">Sin meta todavía.</span>}</p>
      <dl className="cor-kv">
        <div>
          <dt>Fecha</dt>
          <dd className="cor-mono">{r.date ?? "—"}</dd>
        </div>
        <div>
          <dt>Pronóstico</dt>
          <dd className={`cor-mono ${r.forecast?.tone === "stop" ? "cor-state bad" : ""}`}>{r.forecast?.text ?? "—"}</dd>
        </div>
        <div>
          <dt>Esta semana</dt>
          <dd className="cor-mono">{p.this_week.done === 1 ? "1 HECHO" : `${p.this_week.done} HECHOS`}</dd>
        </div>
      </dl>
      {ojo.length > 0 && (
        <div className="cor-ojo" data-ojo>
          <span className="cor-label">Ojo</span>
          <ul>
            {ojo.slice(0, 2).map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

const SEAT_STATE: Record<string, [string, "live" | "amber" | undefined]> = { running: ["Trabajando", "live"], waiting_jorge: ["Te espera", "amber"], paused: ["En pausa", undefined], idle: ["Libre", undefined] };

export const TeamLines = ({ p, links, companyPaused }: { p: OrgProject; links: AhoraLinks; companyPaused: boolean }) => (
  <section aria-label="Equipo" className="cor-side-sec" data-team>
    <div className="cor-side-head">
      <Label as="h2">Equipo</Label>
      <Link className="cor-btn link" to={links.equipo}>
        Ver equipo
      </Link>
    </div>
    <ul className="cor-team">
      {p.team.slice(0, 5).map((m) => {
        const [w, tone] = companyPaused || p.paused ? ["En pausa", undefined] : (SEAT_STATE[m.state] ?? ["Libre", undefined]);
        return (
          <li key={m.agent}>
            <Link to={links.miembro(m.agent)} className="cor-row" data-seat={m.agent}>
              <span>{seatName(m.role)}</span>
              <State tone={tone}>{w}</State>
            </Link>
          </li>
        );
      })}
    </ul>
  </section>
);

export const Ahora = ({
  p,
  decisions,
  now,
  timeZone,
  companyPaused,
  totals,
  acts,
  links,
  onFijar,
}: {
  p: OrgProject;
  decisions: Decision[];
  now: number;
  timeZone?: string;
  companyPaused: boolean;
  totals: { open: number; done: number } | null;
  acts: CorrienteActs;
  links: AhoraLinks;
  onFijar: (p: OrgProject) => void;
}) => {
  const line = nowLine(p, decisions, now, { companyPaused, timeZone });
  const running = companyPaused || p.paused ? [] : p.team.filter((m) => m.state === "running");
  const board: ProjectTicket[] = [...(p.tablero?.initiatives.flatMap((i) => i.tickets) ?? []), ...(p.tablero?.loose ?? [])];
  const review = board.filter((t) => REVIEW.has(t.etapa.etapa));
  const release = decisions.find((d) => d.project === p.slug && d.kind === "release" && !d.state) ?? null;
  const SHOWN = running.length > 1 ? 2 : 3;
  return (
    <div className="cor-ahora" data-ahora={p.slug}>
      <div className="cor-ahora-main">
        {line.state === "you" ? <YouCard p={p} line={line} decisions={decisions} acts={acts} links={links} onFijar={onFijar} /> : <StateCard p={p} line={line} acts={acts} links={links} onFijar={onFijar} emptyBoard={board.length === 0} />}
        {running.length > 0 && (
          <section aria-label="En curso" className="cor-sec" data-en-curso>
            <Label as="h2">En curso</Label>
            {running.slice(0, 2).map((m) => (
              <Running key={m.agent} p={p} m={m} now={now} acts={acts} links={links} />
            ))}
            {running.length > 2 && (
              <Link className="cor-btn link" to={links.equipo}>
                Ver a los {running.length} que trabajan
              </Link>
            )}
          </section>
        )}
        {(review.length > 0 || release) && (
          <section aria-label="En revisión" className="cor-sec" data-en-revision={review.length}>
            <Label as="h2">{`En revisión · ${review.length} · no necesitan nada de ti`}</Label>
            <div>
              {review.slice(0, SHOWN).map((t) => (
                <Row key={t.key} to={links.paso(t.key)} k={t.key} title={t.title} state={<State>{STATE_WORD[t.etapa.etapa] ?? ETAPA_WORD[t.etapa.etapa]}</State>} data={t.key} />
              ))}
            </div>
            <div className="cor-sec-foot">
              {review.length > SHOWN ? (
                <Link className="cor-btn link" to={links.tablero} data-control="ver-tablero">
                  {review.length - SHOWN === 1 ? "Ver la otra en el tablero" : `Ver las otras ${review.length - SHOWN} en el tablero`}
                </Link>
              ) : (
                <span />
              )}
              {release && (
                <Link className="cor-btn quiet" to={links.publicar} data-control="publicar">
                  Publicar lo aceptado
                </Link>
              )}
            </div>
          </section>
        )}
      </div>
      <aside className="cor-ahora-side">
        <Meta p={p} onFijar={onFijar} now={now} />
        <TeamLines p={p} links={links} companyPaused={companyPaused} />
        <div className="cor-side-foot">
          {totals && <span className="cor-cap">{`${totals.open} abiertos · ${totals.done} hechos`.toUpperCase()}</span>}
          <Link className="cor-btn link" to={links.pagina} data-control="pagina">
            Abrir la página del proyecto
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 3h7v7M13 3 4 12" />
            </svg>
          </Link>
        </div>
      </aside>
    </div>
  );
};

/** The amber small rhombus used in tab counts and lists. */
export const YouMark = () => <You small flat />;
