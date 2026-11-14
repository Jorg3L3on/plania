// PLA-I46-15: Una decisión (design screen 6). A decision that is a floor's move (a delivery to accept, a leg's plan
// to accept) can come to the front from Ahora's «Al frente»: the building dims behind and the thing to decide shows
// with three actions. Centred on a desktop, the whole screen on a phone (CSS). Shortcuts (lib/evidencia.ts
// layerKey): A accepts, D returns (a delivery), C changes (a plan), Esc closes; none while typing in a field. Focus
// starts on the main button, Tab stays inside, and on close it goes back to the floor (evidence-store closeLayer).
// It reuses the floor's own pieces (EvidenceBody, PlanBody, runOf), so the layer and Ahora send the same thing.
// Rendered into <body> (a portal), so the phone's app bar cannot sit on top of it.
import { memo, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Decision, OrgProject } from "@/lib/api";
import { nowLine } from "@/lib/edificio";
import { EV_WORDS, deliveryOf, layerKey, type LayerCommand, type LayerKind } from "@/lib/evidencia";
import { EvidenceBody } from "./evidence";
import { closeLayer, setReturn, useLayer, useReturn } from "./evidence-store";
import { runOf, type MoveCtx } from "./now";
import { PLAN_WORDS, PlanBody } from "./plan";
import { draftOf, isLegPlan, setDraft, useDraft } from "./plan-draft";

const Kbd = ({ k }: { k: string }) => (
  <kbd className="edi-kbd" aria-hidden>
    {k}
  </kbd>
);

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const DecisionLayer = memo(function DecisionLayer({ projects, decisions, ctx, now, companyPaused, timeZone }: { projects: OrgProject[]; decisions: Decision[]; ctx: MoveCtx; now: number; companyPaused?: boolean; timeZone?: string }) {
  const at = useLayer();
  const p = at ? projects.find((x) => x.slug === at.slug) : undefined;
  const line = p ? nowLine(p, decisions, now, { companyPaused, timeZone }) : null;
  const move = line?.move ?? null;
  const live = !!(at && move && move.origen.kind === "decision" && move.origen.id === at.id);
  const d = live ? (decisions.find((x) => x.id === at!.id) ?? null) : null;
  const kind: LayerKind | null = d ? (deliveryOf(move, decisions) ? "delivery" : isLegPlan(d) ? "plan" : null) : null;

  // The decision was taken (or left the floor): the layer goes and focus returns to the floor.
  useEffect(() => {
    if (at && !kind) closeLayer();
  }, [at, kind]);
  if (!at || !p || !d || !kind || !move) return null;
  return <LayerCard key={d.id} p={p} d={d} kind={kind} say={move.texto} why={line!.why} ctx={ctx} run={runOf(p, move.accion, ctx)} label={move.accion.label} />;
});

const LayerCard = memo(function LayerCard({ p, d, kind, say, why, ctx, run, label }: { p: OrgProject; d: Decision; kind: LayerKind; say: string; why: string; ctx: MoveCtx; run: (() => void) | null; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLButtonElement>(null);
  const ret = useReturn(d.id);
  const plan = useDraft(d);
  const busy = ctx.qacts?.busy?.id === d.id || !!ctx.qacts?.disabled;

  const second: { label: string; key: string; on: () => void; expanded: boolean } | null =
    kind === "delivery"
      ? ctx.qacts && d.actions.includes("cambios")
        ? { label: EV_WORDS.back, key: "D", on: () => setReturn(d.id, { open: !ret.open }), expanded: ret.open }
        : null
      : { label: PLAN_WORDS.change, key: "C", on: () => setDraft(d, { changing: !draftOf(d).changing, open: true }), expanded: plan.changing };

  const doIt = (c: LayerCommand) => {
    if (c === "close") return closeLayer();
    if (c === "accept") return run && !busy ? run() : undefined;
    if (second && ((c === "return" && kind === "delivery") || (c === "change" && kind === "plan"))) second.on();
  };

  useEffect(() => {
    main.current?.focus();
    const prev = typeof document !== "undefined" ? document.body.style.overflow : "";
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab" && box.current) {
        const all = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!all.length) return;
        const first = all[0]!;
        const last = all[all.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      const c = layerKey(e, kind);
      if (!c) return;
      e.preventDefault();
      doIt(c);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const body: ReactNode = kind === "delivery" ? <EvidenceBody p={p} d={d} acts={ctx.acts} qacts={ctx.qacts} inLayer /> : <PlanBody d={d} waiting={false} qacts={ctx.qacts} />;
  const node = (
    <div
      className="edi-layer"
      data-layer={kind}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeLayer();
      }}
    >
      <div ref={box} className="edi-lcard" role="dialog" aria-modal="true" aria-labelledby={`layer-say-${d.id}`} aria-describedby={`layer-why-${d.id}`} data-layer-card={d.id}>
        <p className="edi-nword">Una decisión · {p.title}</p>
        <h2 className="edi-lsay" id={`layer-say-${d.id}`}>
          {say}
        </h2>
        {why && (
          <p className="edi-nwhy" id={`layer-why-${d.id}`}>
            {why}
          </p>
        )}
        <div className="edi-lbody">{body}</div>
        <div className="edi-nacts edi-lacts">
          {run && (
            <button ref={main} type="button" className="edi-nact edi-go" data-layer-main onClick={run} disabled={busy}>
              {busy ? "…" : label}
              <Kbd k="A" />
            </button>
          )}
          {second && (
            <button type="button" className="edi-btn" data-layer-second aria-expanded={second.expanded} onClick={second.on} disabled={busy}>
              {second.label}
              <Kbd k={second.key} />
            </button>
          )}
          <button type="button" className="edi-btn" data-layer-close onClick={closeLayer}>
            Cerrar
            <Kbd k="Esc" />
          </button>
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? node : createPortal(node, document.body);
});
