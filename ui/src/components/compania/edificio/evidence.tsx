// PLA-I46-10: the evidence card (design screen 3). When the floor's move is to accept a delivery, Ahora carries what
// QA saw (lib/evidencia.ts evidenceView): tests, the separate review, «Check list del PO», the stills of that
// delivery, and the switch «Aceptar sola en la copia de prueba» (off unless the owner turns it on; main is never
// accepted alone). Three exits: Aceptar (the floor's move: Ahora's green ActButton, the Tú window's and the phone
// bar's) · Devolver a Taller (a quick reason and one optional line) · Ver PR. After a return the floor is violet and
// asks nothing; BackNote is the grey «Ver nota». Stateful pieces are memo components (the tests expand plain ones).
import { memo, useState } from "react";
import type { Decision, OrgProject } from "@/lib/api";
import { EV_WORDS, RETURN_REASONS, evidenceView, returnText } from "@/lib/evidencia";
import { openLayer, setReturn, useLayer, useQaRead, useReturn } from "./evidence-store";
import type { NowActs } from "./now";
import type { QuestionActs } from "./question";

const busyOn = (d: Decision, q?: QuestionActs) => q?.busy?.id === d.id || !!q?.disabled;

// The exits beside Aceptar: Devolver a Taller (opens the sheet), Ver PR, and «Al frente» (the decision layer).
// held: the server's move is «Ver y responder» (the delivery has a hold), so Aceptar is here, plain, not green.
export const EvidenceActs = memo(function EvidenceActs({ p, d, qacts, front = true, held = false }: { p: OrgProject; d: Decision; qacts?: QuestionActs; front?: boolean; held?: boolean }) {
  const r = useReturn(d.id);
  const pr = (d.links ?? []).find((l) => l.kind === "pr")?.ref ?? null;
  const accept = d.actions.find((a) => a === "fusionar" || a === "aceptar");
  return (
    <>
      {held && qacts && accept && (
        <button type="button" className="edi-btn" data-ev-act="aceptar" onClick={() => qacts.onAct(d, { action: accept }, `now-${accept}`)} disabled={busyOn(d, qacts)}>
          {busyOn(d, qacts) && qacts.busy?.key === `now-${accept}` ? "…" : EV_WORDS.accept}
        </button>
      )}
      {qacts && d.actions.includes("cambios") && (
        <button type="button" className="edi-btn" data-ev-act="devolver" aria-expanded={r.open} onClick={() => setReturn(d.id, { open: !r.open })} disabled={busyOn(d, qacts)}>
          {EV_WORDS.back}
        </button>
      )}
      {pr && (
        <a className="edi-vlink" href={pr} target="_blank" rel="noreferrer" data-ev-act="pr">
          {EV_WORDS.pr}
        </a>
      )}
      {front && (
        <button type="button" className="edi-vlink" data-ev-act="frente" onClick={(e) => openLayer(p.slug, d.id, e.currentTarget)}>
          Al frente
        </button>
      )}
    </>
  );
});

// Devolver a Taller: one reason (a tap), one optional line, Devolver. Taller reads «reason: line» as a note.
export const ReturnSheet = memo(function ReturnSheet({ d, qacts, where = "ahora" }: { d: Decision; qacts?: QuestionActs; where?: "ahora" | "capa" }) {
  const r = useReturn(d.id);
  if (!r.open || !qacts) return null;
  const busy = busyOn(d, qacts);
  const error = qacts.errors?.[d.id];
  const send = () => {
    qacts.onAct(d, { action: "cambios", text: returnText(r.reason, r.line) }, "devolver");
    setReturn(d.id, { open: false });
  };
  return (
    <form
      className="edi-sheet"
      data-ev-sheet={d.id}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <p className="edi-peye" id={`dev-${where}-${d.id}`}>
        {EV_WORDS.sheet}
      </p>
      <div className="edi-popts" role="radiogroup" aria-labelledby={`dev-${where}-${d.id}`}>
        {RETURN_REASONS.map((x) => (
          <button key={x} type="button" role="radio" className="edi-popt" aria-checked={r.reason === x} onClick={() => setReturn(d.id, { reason: x })} disabled={busy} data-reason={x}>
            {x}
          </button>
        ))}
      </div>
      <input className="edi-pfield" value={r.line} maxLength={300} placeholder={EV_WORDS.line} aria-label="Nota para Taller" onChange={(e) => setReturn(d.id, { line: e.target.value })} disabled={busy} />
      <div className="edi-nacts">
        <button type="submit" className="edi-nact edi-back" data-ev-act="enviar" disabled={busy}>
          {busy && qacts.busy?.key === "devolver" ? "…" : EV_WORDS.send}
        </button>
        <button type="button" className="edi-btn" onClick={() => setReturn(d.id, { open: false })}>
          {EV_WORDS.cancel}
        </button>
      </div>
      {error && (
        <p className="edi-perr" role="alert">
          {error}
        </p>
      )}
    </form>
  );
});

// The tiles, the stills and the switch. Loading: the tiles say so, nothing jumps.
// inLayer: drawn in Una decisión; while the layer holds this decision, Ahora's copy keeps its sheet closed.
export const EvidenceBody = memo(function EvidenceBody({ p, d, acts, qacts, inLayer = false }: { p: OrgProject; d: Decision; acts?: NowActs; qacts?: QuestionActs; inLayer?: boolean }) {
  const read = useQaRead(p.slug, d.ref, d.id);
  const layer = useLayer();
  const sheet = inLayer || layer?.id !== d.id;
  const v = evidenceView(read, d);
  const on = !!p.auto_accept?.on;
  const busy = acts?.busy === `${p.slug}:auto`;
  return (
    <div className="edi-ev" data-evidence={d.id} aria-busy={v.loading || undefined}>
      <div className="edi-evt" data-ev="tests">
        <p className="edi-peye">Pruebas</p>
        <b data-ok={v.tests.ok === null ? undefined : v.tests.ok ? "1" : "0"}>{v.loading ? "…" : v.tests.value}</b>
        <span>{v.loading ? "Leyendo lo que vio QA" : v.tests.sub}</span>
      </div>
      <div className="edi-evt" data-ev="review">
        <p className="edi-peye">Revisión aparte</p>
        <b data-ok={v.review.ok === null ? undefined : v.review.ok ? "1" : "0"}>{v.loading ? "…" : v.review.value}</b>
        <span>{v.loading ? "" : v.review.sub}</span>
      </div>
      <div className="edi-evt" data-ev="checklist">
        <p className="edi-peye">{v.checklist.title}</p>
        {v.checklist.items.length ? (
          <ul>
            {v.checklist.items.map((c) => (
              <li key={c.n} data-mark={c.mark ?? "none"}>
                <span aria-hidden>{c.mark === "pass" ? "✓" : c.mark === "fail" ? "✗" : "·"}</span> {c.text}
                <span className="sr-only">{c.mark === "pass" ? ", se cumple" : c.mark === "fail" ? ", no se cumple" : ", sin revisar"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span>{v.loading ? "" : "El PO no escribió una para este paso"}</span>
        )}
      </div>
      {v.stills.length > 0 && (
        <div className="edi-evt edi-evshots" data-ev="stills">
          <p className="edi-peye">Capturas de la entrega</p>
          <span className="edi-evpair">
            {v.stills.map((src, i) => (
              <img key={src} src={src} alt={`${d.title}, ${i === 0 ? "escritorio" : "teléfono"}`} loading="lazy" decoding="async" className={i === 1 ? "edi-evph" : undefined} />
            ))}
          </span>
        </div>
      )}
      <div className="edi-evsw">
        <button type="button" role="switch" className="edi-sw" aria-checked={on} onClick={() => acts?.onAuto?.(p.slug, !on)} disabled={!acts?.onAuto || busy} data-control="aceptar-sola-card">
          <i aria-hidden />
          {EV_WORDS.auto} · {on ? "encendido" : "apagado"}
        </button>
        {on && p.auto_accept?.hold && <span data-auto-hold>No se aceptó sola: {p.auto_accept.hold}</span>}
      </div>
      {sheet && <ReturnSheet d={d} qacts={qacts} where={inLayer ? "capa" : "ahora"} />}
    </div>
  );
});

// After a return: the note, behind a grey «Ver nota».
export const BackNote = memo(function BackNote({ note }: { note: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="edi-btn edi-grey" aria-expanded={open} onClick={() => setOpen((x) => !x)} data-control="ver-nota">
        {open ? EV_WORDS.hideNote : EV_WORDS.note}
      </button>
      {open && (
        <p className="edi-bnote" data-back-note>
          {note}
        </p>
      )}
    </>
  );
});
