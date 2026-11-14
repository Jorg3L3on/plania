// PLA-I35/I36: a decision's body (Te toca's row body), kept when Te toca's list left /ceo (PLA-I39-5, -9). It hangs under
// its asker's window on the building (edificio/question.tsx) and keeps every kind's actions: a proposal's named
// options (recommended first), Elegir each, "1 + 2" and Responder; Jorge's own ticket Hecho / Aplazar; a PR or
// delivery Fusionar / Aceptar / Pedir cambios with its evidence and hold line; a plan Sí, empiecen / Cambiar algo /
// Cancelar; a step Hecho; a release goes to Bandeja. Keys live behind Detalles. Presentational: data and actions come
// in as props (test/edificio-ui.test.ts, test/compania-v2.test.ts and test/i36-ui.test.ts render it with fake data).
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { ago } from "@/lib/compania";
import type { Decision, DecisionInput } from "@/lib/api";
import { linkHref, roleName } from "@/lib/org";
import { checksText, ordered, releaseText, stateText, evidenceText, plainLink } from "@/lib/v2";
import { Dot, TONE_INK, pillGhost, pillPrimary } from "@/components/compania/parts";
import { FileStepBox } from "@/components/compania/file-step";

const pillSmall = "min-h-9 px-3.5 text-xs";

// ---- a decision

export type DecisionBusy = { id: string; key: string } | null;

// PLA-I39-5: the body of a decision (Te toca's row body), shared by Te toca and the question under a window.
// DecisionView is pure (its small form state comes in as ui), so tests call its handlers without a DOM;
// DecisionBody holds that state.
export type DecisionUi = { reply: boolean; setReply: (v: boolean) => void; text: string; setText: (v: string) => void; open: boolean; setOpen: (v: boolean) => void };
export type DecisionProps = {
  d: Decision;
  now: number;
  busy: DecisionBusy;
  error?: string | null;
  opened?: boolean;
  onAct: (d: Decision, input: DecisionInput, key: string) => void;
  // PLA-23: a release publishes in place when the page can (the building); else it goes to Bandeja.
  onPublish?: (d: Decision) => void;
};

export const DecisionView = ({ d, now, busy, error, onAct, onPublish, ui }: DecisionProps & { ui: DecisionUi }) => {
  const { reply, setReply, text, setText, open, setOpen } = ui;
  const acted = !!d.state;
  const checks = checksText(d);
  const release = releaseText(d);
  // PLA-I36-11: tickets and keys go to Detalles; the main line links the doc, the change and the preview.
  const all = (d.links ?? []).map((l) => ({ ...l, href: linkHref(l, d.project) })).filter((l) => l.href);
  const links = all.filter((l) => l.kind !== "ticket");
  const keyed = all.filter((l) => l.kind === "ticket");
  const evidence = evidenceText(d);
  const work = d.kind === "pr" || d.kind === "deliverable";
  const busyHere = busy?.id === d.id;
  const options = ordered(d);
  const label = (key: string, word: string) => (busyHere && busy?.key === key ? "…" : word);
  // A file step Plania can do itself (aplicar): the file, the lines, and one button.
  const fileStep = d.file_step && d.actions.includes("aplicar") ? d.file_step : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 2) return;
    onAct(d, { action: "responder", text: text.trim() }, "responder");
    setReply(false);
    setText("");
  };
  return (
    <div className="grid min-w-0 gap-1.5">
      <p className="min-w-0 text-sm break-words">
        <span className="font-semibold">{d.title}</span>
        <span className="text-xs text-muted-foreground"> · {ago(d.at, now)}</span>
      </p>
      {d.detail && d.kind !== "proposal" && <p className="line-clamp-2 text-xs text-muted-foreground">{d.detail}</p>}
      {release && (
        <p className="text-xs break-words text-muted-foreground" data-release>
          {release}
        </p>
      )}
      {checks && (
        <p className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", TONE_INK[checks.tone])} data-checks={checks.open ? "open" : "done"}>
          <Dot tone={checks.tone} /> {checks.text}
        </p>
      )}
      {(links.length > 0 || d.body) && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-links={links.length}>
          {d.body && (
            <button type="button" className="font-semibold hover:underline" aria-expanded={open} onClick={() => setOpen(!open)} data-control="ver-mensaje">
              {open ? "Ocultar mensaje" : d.asker ? `Ver el mensaje de ${roleName(d.asker.role)}` : "Ver mensaje"}
            </button>
          )}
          {links.map((l) =>
            /^https?:/.test(l.href!) ? (
              <a key={`${l.kind}-${l.ref}`} href={l.href!} target="_blank" rel="noreferrer" className="min-w-0 truncate font-semibold text-foreground hover:underline" data-link={l.kind}>
                {plainLink(l)} ↗
              </a>
            ) : (
              <Link key={`${l.kind}-${l.ref}`} to={l.href!} className="min-w-0 truncate font-semibold text-foreground hover:underline" data-link={l.kind}>
                {plainLink(l)}
              </Link>
            ),
          )}
        </div>
      )}
      {open && d.body && (
        <p className="max-h-80 overflow-y-auto rounded-xl bg-muted/60 p-3 text-sm leading-relaxed break-words whitespace-pre-wrap" data-body>
          {d.body}
        </p>
      )}
      {work && (evidence || d.preview_url !== undefined) && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-evidence>
          {evidence && (
            <span className={cn("inline-flex items-center gap-1.5 font-semibold", TONE_INK[evidence.tone])}>
              <Dot tone={evidence.tone} /> {evidence.text}
            </span>
          )}
          {d.preview_url ? (
            <a href={d.preview_url} target="_blank" rel="noreferrer" className="font-semibold text-foreground hover:underline" data-control="vista-previa">
              Ver la vista previa ↗
            </a>
          ) : (
            <span className="text-muted-foreground" data-no-preview>
              Sin vista previa: se configura en Detalles del proyecto
            </span>
          )}
        </div>
      )}
      {d.plan && (
        <div className="grid min-w-0 gap-1.5 rounded-xl bg-muted/60 p-3 text-sm" data-plan-row>
          <p className="break-words">
            <span className="font-semibold">Lo entendí: </span>
            {d.plan.understood}
          </p>
          <ol className="grid gap-1">
            {d.plan.steps.map((st, i) => (
              <li key={i} className="grid min-w-0 gap-0.5" data-step={i + 1}>
                <span className="min-w-0 break-words">
                  <span className="font-mono text-xs text-muted-foreground">{i + 1}.</span> {st.title}
                </span>
                <span className="pl-4 text-xs break-words text-muted-foreground">Hecho cuando: {st.done_when}</span>
              </li>
            ))}
          </ol>
          {d.plan.cost && <p className="text-xs text-muted-foreground">Cuesta: {d.plan.cost}</p>}
        </div>
      )}
      {acted ? (
        <p className="text-xs font-semibold text-ink-done" data-state={d.state!.action}>
          ✓ {stateText(d.state!)}
        </p>
      ) : (
        <>
          {fileStep && (
            <FileStepBox
              d={{ ...d, file_step: fileStep }}
              busy={busyHere && busy?.key === "aplicar"}
              disabled={busyHere && busy?.key !== "aplicar"}
              onApply={(input) => onAct(d, input, "aplicar")}
            />
          )}
          {options.length > 0 && (
            <ol className="grid gap-1" data-options={options.length}>
              {options.map((o) => (
                <li key={o.n} className="flex min-w-0 items-start gap-2.5 max-sm:flex-wrap" data-option={o.n} data-recommended={o.recommended ? "1" : undefined}>
                  <span className="w-4 shrink-0 pt-2 font-mono text-xs text-muted-foreground">{o.n}</span>
                  <span className={cn("min-w-0 flex-1 pt-1.5 text-sm break-words", o.recommended && "font-semibold")}>
                    {o.label}
                    {o.recommended && <span className="font-normal text-muted-foreground"> · recomendado</span>}
                    {(o.effect || o.cost) && (
                      <span className="block text-xs font-normal text-muted-foreground" data-option-cost>
                        {[o.effect, o.cost].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    data-action="elegir"
                    className={cn(o.recommended ? pillPrimary : pillGhost, pillSmall, "max-sm:ml-6")}
                    disabled={busyHere}
                    onClick={() => onAct(d, { action: "elegir", option: o.n }, `elegir-${o.n}`)}
                  >
                    {label(`elegir-${o.n}`, "Elegir")}
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {d.kind === "proposal" && (d.recommended_reason || d.detail) && (
              <span className="mr-auto min-w-0 text-xs text-muted-foreground">{d.recommended_reason ? `Recomienda: ${d.recommended_reason}` : d.detail}</span>
            )}
            {d.kind === "proposal" &&
              (d.combinable ?? []).map((set) => (
                <button
                  key={set.join("+")}
                  type="button"
                  data-action="combo"
                  className={cn(pillGhost, pillSmall)}
                  disabled={busyHere}
                  onClick={() => onAct(d, { action: "elegir", option: set }, `combo-${set.join("+")}`)}
                >
                  {label(`combo-${set.join("+")}`, set.join(" + "))}
                </button>
              ))}
            {d.actions.includes("empezar") && (
              <button type="button" data-action="empezar" className={cn(pillPrimary, pillSmall)} disabled={busyHere} onClick={() => onAct(d, { action: "empezar" }, "empezar")}>
                {label("empezar", "Sí, empiecen")}
              </button>
            )}
            {d.actions.includes("cambiar") && (
              <button type="button" data-action="cambiar" className={cn(pillGhost, pillSmall)} disabled={busyHere} onClick={() => onAct(d, { action: "cambiar" }, "cambiar")}>
                {label("cambiar", "Cambiar algo")}
              </button>
            )}
            {d.actions.includes("cancelar") && (
              <button type="button" data-action="cancelar" className={cn(pillGhost, pillSmall)} disabled={busyHere} onClick={() => onAct(d, { action: "cancelar" }, "cancelar")}>
                {label("cancelar", "Cancelar")}
              </button>
            )}
            {d.kind === "release" &&
              (onPublish ? (
                <button type="button" className={cn(pillPrimary, pillSmall)} data-action="publicar" onClick={() => onPublish(d)}>
                  Publicar
                </button>
              ) : (
                <Link to="/inbox" className={cn(pillPrimary, pillSmall)} data-action="publicar">
                  Publicar en Bandeja
                </Link>
              ))}
            {d.actions.includes("hecho") && (
              <button
                type="button"
                data-action="hecho"
                className={cn(fileStep ? pillGhost : pillPrimary, pillSmall)}
                disabled={busyHere}
                onClick={() => onAct(d, { action: "hecho" }, "hecho")}
              >
                {label("hecho", fileStep ? "Ya lo hice yo" : "Hecho")}
              </button>
            )}
            {d.actions.includes("aplazar") && (
              <button type="button" data-action="aplazar" className={cn(pillGhost, pillSmall)} disabled={busyHere} onClick={() => onAct(d, { action: "aplazar" }, "aplazar")}>
                {label("aplazar", "Aplazar")}
              </button>
            )}
            {(d.actions.includes("fusionar") || d.actions.includes("aceptar")) && (
              <button
                type="button"
                data-action={d.actions.includes("fusionar") ? "fusionar" : "aceptar"}
                className={cn(pillPrimary, pillSmall)}
                disabled={busyHere || !!d.hold}
                title={d.hold ?? undefined}
                onClick={() => onAct(d, { action: d.actions.includes("fusionar") ? "fusionar" : "aceptar" }, "aceptar")}
              >
                {label("aceptar", "Aceptar")}
              </button>
            )}
            {d.hold && (d.actions.includes("fusionar") || d.actions.includes("aceptar")) && (
              <span className="text-xs font-semibold text-ink-blocked" data-hold>
                {d.hold}
              </span>
            )}
            {d.actions.includes("cambios") && (
              <button type="button" data-action="cambios" className={cn(pillGhost, pillSmall)} disabled={busyHere} aria-expanded={reply} onClick={() => setReply(!reply)}>
                Pedir cambios
              </button>
            )}
            {d.actions.includes("responder") && (
              <button type="button" data-action="responder" className={cn(pillGhost, pillSmall)} disabled={busyHere} aria-expanded={reply} onClick={() => setReply(!reply)}>
                Responder
              </button>
            )}
          </div>
          {reply && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                if (d.actions.includes("cambios")) {
                  e.preventDefault();
                  if (text.trim().length < 2) return;
                  onAct(d, { action: "cambios", text: text.trim() }, "cambios");
                  setReply(false);
                  setText("");
                } else submit(e);
              }}
            >
              <input
                aria-label={d.actions.includes("cambios") ? "Qué cambiar" : "Tu respuesta"}
                className="min-h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={d.actions.includes("cambios") ? "Qué cambiar, en una frase" : "Tu respuesta"}
                value={text}
                maxLength={2000}
                onChange={(e) => setText(e.target.value)}
                autoFocus
              />
              <button type="submit" className={cn(pillPrimary, "min-h-10 px-3 text-xs")} disabled={text.trim().length < 2}>
                Enviar
              </button>
            </form>
          )}
        </>
      )}
      {(d.ref || keyed.length > 0) && (
        <details className="text-xs text-muted-foreground" data-detalles>
          <summary className="cursor-pointer select-none">Detalles</summary>
          <p className="pt-1 font-mono break-words">{[d.ref, ...keyed.map((l) => l.ref)].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ")}</p>
        </details>
      )}
      {error && <p className="text-xs text-ink-blocked">{error}</p>}
    </div>
  );
};

export const DecisionBody = (props: DecisionProps) => {
  const [reply, setReply] = useState(false);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(!!props.opened);
  return <DecisionView {...props} ui={{ reply, setReply, text, setText, open, setOpen }} />;
};
