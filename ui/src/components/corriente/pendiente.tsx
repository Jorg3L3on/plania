// PLA-I62-4: one thing that waits on the owner, as a card (boards A2 and A6, Pendientes). Every kind that exists
// today, with /ceo's own actions (components/compania/v2.tsx, edificio/plan.tsx, file-step.tsx):
//   entrega (pr, deliverable)  Aceptar (held while its hold says why), Ver antes y después, Pedir ajuste; a failed
//                              run offers «Que <dueño> vuelva a probar» (verificar); the project's «Se aprueba sola»
//                              switches and why the last one was not accepted by itself.
//   plan                       its steps, the PO's questions with the suggestion marked, the check list to edit;
//                              Empezar, Cambiar algo (one line to the PO), Después, Cancelar.
//   pregunta / opciones        the options (the suggested or recommended one chosen), Responder; combinations;
//                              Cambiar algo writes an answer of his own.
//   paso tuyo                  Hecho and Aplazar; a file step adds its lines to the PR (aplicar) or Ya lo hice yo.
//   publicar                   Publicar (the release sheet).
// Answered: the card says what was done, in place.
import { useState } from "react";
import { Link } from "react-router";
import type { Decision, OrgProject } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import { APPROVE, acceptWords } from "@/lib/evidencia";
import { frameOf } from "@/lib/probador";
import { checksText, evidenceText, ordered, releaseText, stateText } from "@/lib/v2";
import type { CorrienteActs } from "./acts";
import { Ajuste } from "./ajuste";
import { Btn, Label, Logo, Opt, Switch, You } from "./parts";
import { useProbadorRead } from "./reads";

export type PendLinks = { entrega: (d: Decision) => string; publicar: (d: Decision) => string; project: (slug: string) => string };

export function kindWord(d: Decision): string {
  const who = d.asker ? seatName(d.asker.role) : null;
  switch (d.kind) {
    case "deliverable":
    case "pr":
      return d.actions.includes("verificar") && d.hold ? "Algo falló" : `Entrega · ${who ?? "Taller"}`;
    case "plan":
      return `Plan · ${who ?? "PO"}`;
    case "proposal":
      return `Opciones · ${who ?? "PO"}`;
    case "question":
      return `Pregunta · ${who ?? "el equipo"}`;
    case "release":
      return "Publicar";
    default:
      return d.file_step ? "Paso tuyo · archivo" : "Paso tuyo";
  }
}

const isDelivery = (d: Decision) => d.kind === "deliverable" || d.kind === "pr";

/** The project's accept-by-itself switches, as on the building's evidence card (PLA-I40-7, PLA-I52-7). */
export const AutoSwitches = ({ p, acts, compact }: { p: OrgProject; acts: CorrienteActs; compact?: boolean }) => {
  const on = !!p.auto_accept?.on;
  const invisible = !!p.auto_accept?.invisible;
  const busy = acts.busy === `${p.slug}:auto`;
  return (
    <div className="cor-pend-auto" data-auto={p.slug}>
      {!compact && <Label>En {p.title}</Label>}
      <Switch on={on} label="Aprobar sola si las pruebas pasan" onChange={(v) => acts.autoAccept(p.slug, v)} disabled={busy} data-control="aceptar-sola" />
      {!on && <Switch on={invisible} label="Solo lo que no se ve" onChange={(v) => acts.autoInvisible(p.slug, v)} disabled={busy} data-control="aceptar-invisible" />}
      {(on || invisible) && p.auto_accept?.hold ? <p data-auto-hold>No se aprobó sola: {p.auto_accept.hold}</p> : !compact && <p>Solo llega a la copia de prueba. Publicar sigue siendo tuyo.</p>}
    </div>
  );
};

/** Two stills of the delivery (the first view's antes and después), or the frames saying there are none yet; a click
 *  opens the Entrega. */
export const Shots = ({ p, d, to }: { p: OrgProject; d: Decision; to: string }) => {
  const read = useProbadorRead(p.slug, d.ref);
  const v = read.data?.vistas[0];
  const one = (side: "antes" | "despues") => {
    const f = v ? frameOf(v, "desktop", side) : null;
    const word = side === "antes" ? "Antes" : "Después";
    if (f?.kind === "still")
      return (
        <span className="cor-shot" data-shot={side}>
          <img src={f.src} alt={f.alt} loading="lazy" decoding="async" />
          <b>{word}</b>
        </span>
      );
    return (
      <span className="cor-shot empty" data-shot={side}>
        {f?.kind === "nueva" ? "Pantalla nueva" : read.data?.state?.state === "tomando" ? "Tomando la foto…" : `Sin foto · ${word.toLowerCase()}`}
      </span>
    );
  };
  if (read.isPending || !read.data?.muestra) return null;
  return (
    <Link className="cor-pend-shots" to={to} data-shots aria-label={`Ver antes y después de ${d.ref ?? d.title}`}>
      {one("antes")}
      {one("despues")}
    </Link>
  );
};

/** A leg's plan: steps, the PO's questions (suggestion marked) and the check list, editable before Empezar. */
const PlanBox = ({ d, acts }: { d: Decision; acts: CorrienteActs }) => {
  const plan = d.plan!;
  const qs = plan.questions ?? [];
  const [answers, setAnswers] = useState<number[]>(qs.map((q) => q.suggested));
  const [list, setList] = useState<string[]>([...(plan.checklist ?? [])]);
  const [changing, setChanging] = useState(false);
  const [text, setText] = useState("");
  const busy = acts.decisions.busy?.id === d.id;
  const leg = !!plan.leg;
  return (
    <>
      {plan.understood && (
        <p className="cor-text" data-plan-understood>
          <b>Lo entendí:</b> {plan.understood}
        </p>
      )}
      <div className="cor-plan" data-plan={d.id}>
        <div>
          <Label>{plan.steps.length === 1 ? "1 paso" : `${plan.steps.length} pasos`}</Label>
          <ol>
            {plan.steps.map((s, i) => (
              <li key={i} title={`Hecho cuando: ${s.done_when}`}>
                {s.title}
              </li>
            ))}
          </ol>
        </div>
        {qs.length > 0 && (
          <div className="cor-plan-q">
            <Label>{qs.length === 1 ? "1 pregunta del PO" : `${qs.length} preguntas del PO`}</Label>
            {qs.map((q, i) => (
              <div key={i} role="radiogroup" aria-label={q.text} className="cor-plan-q">
                <span>{q.text}</span>
                <span className="cor-opts">
                  {q.options.map((o, k) => (
                    <button key={k} type="button" role="radio" aria-checked={answers[i] === k} className="cor-opt" onClick={() => setAnswers((a) => a.map((x, j) => (j === i ? k : x)))} disabled={busy}>
                      {o}
                      {k === q.suggested && <small>sugerida</small>}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
        {leg && (
          <div>
            <Label>Lista para revisar · la puedes editar</Label>
            {list.map((c, i) => (
              <input key={i} className="cor-input" value={c} maxLength={200} aria-label={`Cosa a verificar ${i + 1}`} onChange={(e) => setList((l) => l.map((v, j) => (j === i ? e.target.value : v)))} disabled={busy} />
            ))}
          </div>
        )}
      </div>
      <div className="cor-acts">
        {d.actions.includes("empezar") && (
          <Btn kind="primary" onClick={() => acts.decisions.decide(d, { action: "empezar", ...(leg ? { answers, checklist: list.map((c) => c.trim()) } : {}) }, "plan-empezar")} disabled={busy} data-action="empezar">
            {busy && acts.decisions.busy?.key === "plan-empezar" ? "…" : "Empezar"}
          </Btn>
        )}
        {d.actions.includes("cambiar") && (
          // An order's plan hands its words back to the ask box at once; a leg's plan takes one line for the PO.
          <Btn kind="secondary" aria-expanded={leg ? changing : undefined} onClick={() => (leg ? setChanging((x) => !x) : acts.decisions.decide(d, { action: "cambiar" }, "cambiar"))} disabled={busy} data-action="cambiar">
            Cambiar algo
          </Btn>
        )}
        {d.actions.includes("despues") && (
          <Btn kind="quiet" onClick={() => acts.decisions.decide(d, { action: "despues" }, "plan-despues")} disabled={busy} data-action="despues">
            Después
          </Btn>
        )}
        {d.actions.includes("cancelar") && (
          <Btn kind="quiet" onClick={() => acts.decisions.decide(d, { action: "cancelar" }, "cancelar")} disabled={busy} data-action="cancelar">
            Cancelar
          </Btn>
        )}
      </div>
      <p className="cor-cap">{APPROVE.plan.hint}</p>
      {changing && (
        <form
          className="cor-ajuste-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            acts.decisions.decide(d, { action: "cambiar", text: text.trim() }, "plan-cambiar");
            setChanging(false);
          }}
        >
          <input className="cor-input" value={text} maxLength={500} placeholder="Qué cambiar, en una línea. El PO rehace el plan." aria-label="Qué cambiar del plan" onChange={(e) => setText(e.target.value)} disabled={busy} />
          <Btn kind="secondary" type="submit" disabled={busy || !text.trim()}>
            Enviar al PO
          </Btn>
        </form>
      )}
    </>
  );
};

/** Options to pick (a proposal or a question): the recommended one chosen; Responder sends it. */
const Options = ({ d, acts }: { d: Decision; acts: CorrienteActs }) => {
  const options = ordered(d);
  const [pick, setPick] = useState<number | null>(options.find((o) => o.recommended)?.n ?? options[0]?.n ?? null);
  const [own, setOwn] = useState(false);
  const [text, setText] = useState("");
  const busy = acts.decisions.busy?.id === d.id;
  return (
    <>
      {options.length > 0 && (
        <div className="cor-opts" role="radiogroup" aria-label="Opciones" data-options={options.length}>
          {options.map((o) => (
            <button key={o.n} type="button" role="radio" aria-checked={pick === o.n} className="cor-opt" onClick={() => setPick(o.n)} disabled={busy} data-option={o.n} title={[o.effect, o.cost].filter(Boolean).join(" · ") || undefined}>
              {o.label}
              {o.recommended && <small>{d.kind === "proposal" ? "recomendada" : "sugerida"}</small>}
            </button>
          ))}
        </div>
      )}
      {d.kind === "proposal" && d.recommended_reason && <p className="cor-cap">Recomienda: {d.recommended_reason}</p>}
      <div className="cor-acts">
        {options.length > 0 && d.actions.includes("elegir") && (
          <Btn kind="primary" disabled={busy || pick === null} onClick={() => pick !== null && acts.decisions.decide(d, { action: "elegir", option: pick }, `elegir-${pick}`)} data-action="elegir">
            {busy ? "…" : "Responder"}
          </Btn>
        )}
        {(d.combinable ?? []).map((set) => (
          <Btn key={set.join("+")} kind="secondary" disabled={busy} onClick={() => acts.decisions.decide(d, { action: "elegir", option: set }, `combo-${set.join("+")}`)} data-action="combo">
            {set.join(" + ")}
          </Btn>
        ))}
        {d.actions.includes("responder") && (
          <Btn kind={options.length ? "quiet" : "primary"} aria-expanded={own} onClick={() => setOwn((x) => !x)} disabled={busy} data-action="responder">
            {options.length ? "Cambiar algo" : "Responder"}
          </Btn>
        )}
      </div>
      {own && (
        <form
          className="cor-ajuste-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length < 2) return;
            acts.decisions.decide(d, { action: "responder", text: text.trim() }, "responder");
            setOwn(false);
            setText("");
          }}
        >
          <input className="cor-input" value={text} maxLength={2000} placeholder="Tu respuesta" aria-label="Tu respuesta" onChange={(e) => setText(e.target.value)} autoFocus />
          <Btn kind="secondary" type="submit" disabled={text.trim().length < 2}>
            Enviar
          </Btn>
        </form>
      )}
    </>
  );
};

/** A file step: the file and its lines, editable; Agregar al PR y marcar hecho, or Ya lo hice yo. */
const FileBox = ({ d, acts }: { d: Decision & { file_step: NonNullable<Decision["file_step"]> }; acts: CorrienteActs }) => {
  const f = d.file_step;
  const [path, setPath] = useState(f.path);
  const [lines, setLines] = useState(f.lines);
  const n = f.pr_url ? (/\/pull\/(\d+)/.exec(f.pr_url)?.[1] ?? null) : null;
  const busy = acts.decisions.busy?.id === d.id;
  const working = busy && acts.decisions.busy?.key === "aplicar";
  return (
    <div className="cor-file" data-file-step={f.source}>
      <p className="cor-text">
        Son líneas para un archivo que el equipo no puede escribir. Las revisas y se agregan al PR{n ? ` #${n}` : ""} con un clic. Las que ya estén no se repiten.
        {f.source === "text" ? " Se leyeron del mensaje: revísalas antes." : ""}
      </p>
      <input className="cor-input" value={path} onChange={(e) => setPath(e.target.value)} disabled={busy} aria-label="Archivo" spellCheck={false} data-control="archivo-ruta" />
      <textarea className="cor-textarea" rows={Math.min(8, Math.max(3, lines.split("\n").length + 1))} value={lines} onChange={(e) => setLines(e.target.value)} disabled={busy} aria-label="Líneas" spellCheck={false} data-control="archivo-lineas" />
      {working && (
        <p className="cor-cap" role="status">
          Agregando en GitHub: lee {path.trim()} en la rama del PR, agrega las líneas que faltan y hace un commit.
        </p>
      )}
      <div className="cor-acts">
        <Btn kind="primary" disabled={busy || !path.trim() || !lines.trim()} onClick={() => acts.decisions.decide(d, { action: "aplicar", path: path.trim(), lines }, "aplicar")} data-action="aplicar">
          {working ? "Agregando…" : n ? `Agregar al PR #${n} y marcar hecho` : "Agregar al PR y marcar hecho"}
        </Btn>
        {d.actions.includes("hecho") && (
          <Btn kind="quiet" disabled={busy} onClick={() => acts.decisions.decide(d, { action: "hecho" }, "hecho")} data-action="hecho">
            Ya lo hice yo
          </Btn>
        )}
      </div>
    </div>
  );
};

export const Pendiente = ({ d, p, acts, links, big = false }: { d: Decision; p: OrgProject | null; acts: CorrienteActs; links: PendLinks; big?: boolean }) => {
  const [ajuste, setAjuste] = useState(false);
  const busy = acts.decisions.busy?.id === d.id;
  const error = acts.decisions.errors[d.id];
  const delivery = isDelivery(d);
  const accept = d.actions.find((a) => a === "fusionar" || a === "aceptar");
  const checks = checksText(d);
  const release = releaseText(d);
  const fileStep = d.file_step && d.actions.includes("aplicar") ? (d as Decision & { file_step: NonNullable<Decision["file_step"]> }) : null;
  const failed = delivery && d.actions.includes("verificar") && !!d.hold && !d.verify;
  const title = d.ref && (delivery || d.kind === "action" || d.kind === "step") ? `${d.ref} · ${d.title}` : d.title;
  const why = delivery ? (d.hold ? null : accept ? acceptWords(d, { seen: true }).hint : null) : d.kind === "release" ? release : d.detail;
  return (
    <article className={`cor-pend ${big ? "big" : ""} ${d.state ? "done" : ""}`} data-pendiente={d.id} data-kind={d.kind} aria-label={`${kindWord(d)}: ${d.title}`}>
      <div className="cor-pend-top">
        <You small={!big} />
        {p && (
          <Link className="cor-pend-proj" to={links.project(p.slug)}>
            <Logo slug={p.slug} title={p.title} size="sm" />
            {p.title}
          </Link>
        )}
        <Label tone="amber">{kindWord(d)}</Label>
      </div>
      <div className="cor-pend-main">
        <div className="cor-pend-text">
          <h2 className="cor-pend-title">{title}</h2>
          {why && <p className="cor-text">{why}</p>}
          {failed && (
            <p className="cor-text">
              <span className="cor-state bad">{d.hold}</span> Puedes pedir que su dueño lo intente otra vez.
            </p>
          )}
          {checks && (
            <p className="cor-cap" data-checks={checks.open ? "open" : "done"}>
              {checks.text}
            </p>
          )}
          {delivery && (() => {
            const ev = evidenceText(d);
            return (
              <p className="cor-cap" data-evidence>
                {ev && <span>{ev.text}</span>}
                {ev && " · "}
                {d.preview_url ? (
                  <a className="cor-inline" href={d.preview_url} target="_blank" rel="noreferrer" data-control="vista-previa">
                    Ver la vista previa ↗
                  </a>
                ) : (
                  <span data-no-preview>Sin vista previa</span>
                )}
              </p>
            );
          })()}
          {d.state ? (
            <p className="cor-state ok" data-state={d.state.action}>
              ✓ {stateText(d.state)}
            </p>
          ) : (
            <>
              {d.kind === "plan" && d.plan && <PlanBox d={d} acts={acts} />}
              {(d.kind === "proposal" || d.kind === "question") && <Options d={d} acts={acts} />}
              {fileStep && <FileBox d={fileStep} acts={acts} />}
              {delivery && (
                <>
                  <div className="cor-acts">
                    {accept && (
                      <Btn kind="primary" disabled={busy || !!d.hold} title={d.hold ?? acceptWords(d).aria} aria-label={acceptWords(d).aria} onClick={() => acts.decisions.decide(d, { action: accept }, "aceptar")} data-action={accept}>
                        {busy && acts.decisions.busy?.key === "aceptar" ? "…" : "Aceptar"}
                      </Btn>
                    )}
                    {d.actions.includes("verificar") && (
                      <Btn kind={accept ? "secondary" : "primary"} disabled={busy} onClick={() => acts.decisions.decide(d, { action: "verificar" }, "verificar")} data-action="verificar">
                        {`Que ${d.asker ? seatName(d.asker.role) : "su dueño"} vuelva a probar`}
                      </Btn>
                    )}
                    <Link className="cor-btn secondary" to={links.entrega(d)} data-control="ver-entrega">
                      Ver antes y después
                    </Link>
                    {d.actions.includes("cambios") && (
                      <Btn kind="quiet" aria-expanded={ajuste} onClick={() => setAjuste((x) => !x)} disabled={busy} data-action="cambios">
                        Pedir ajuste
                      </Btn>
                    )}
                  </div>
                  {d.hold && !failed && (
                    <span className={`cor-hold ${d.verify ? "wait" : ""}`} role={d.verify ? "status" : undefined} data-hold>
                      {d.hold}
                    </span>
                  )}
                  {ajuste && <Ajuste d={d} acts={acts} onDone={() => setAjuste(false)} />}
                </>
              )}
              {(d.kind === "action" || d.kind === "step") && !fileStep && (
                <div className="cor-acts">
                  {d.actions.includes("hecho") && (
                    <Btn kind="primary" disabled={busy} onClick={() => acts.decisions.decide(d, { action: "hecho" }, "hecho")} data-action="hecho">
                      {busy && acts.decisions.busy?.key === "hecho" ? "…" : "Hecho"}
                    </Btn>
                  )}
                  {d.actions.includes("aplazar") && (
                    <Btn kind="quiet" disabled={busy} onClick={() => acts.decisions.decide(d, { action: "aplazar" }, "aplazar")} data-action="aplazar">
                      Aplazar
                    </Btn>
                  )}
                </div>
              )}
              {d.kind === "release" && (
                <div className="cor-acts">
                  <Link className="cor-btn primary" to={links.publicar(d)} data-action="publicar">
                    Publicar
                  </Link>
                </div>
              )}
            </>
          )}
          {error && (
            <p className="cor-state bad" role="alert">
              {error}
            </p>
          )}
        </div>
        {big && delivery && p && <Shots p={p} d={d} to={links.entrega(d)} />}
      </div>
      {big && delivery && p && !d.state && <AutoSwitches p={p} acts={acts} />}
    </article>
  );
};

/** One line for a card that waits behind the first: what it is, where, and Abrir. */
export const PendienteRow = ({ d, p, onOpen }: { d: Decision; p: OrgProject | null; onOpen: () => void }) => (
  <div className="cor-pend-row" data-pendiente-row={d.id}>
    <You small />
    {p && <Logo slug={p.slug} title={p.title} size="sm" />}
    <div className="cor-pend-text">
      <span className="cor-pend-title cor-ellipsis">{d.ref && isDelivery(d) ? `${d.ref} · ${d.title}` : d.title}</span>
      <span className="cor-cap">{[p?.title, kindWord(d)].filter(Boolean).join(" · ")}</span>
    </div>
    {d.hold && <span className="cor-hold">{d.hold}</span>}
    <Btn kind="secondary" onClick={onOpen} data-control="abrir">
      Abrir
    </Btn>
  </div>
);
