// PLA-I47-3: La fila, the floor's right column (Design frame 7). Ahora, Sigue (numbered in the runner's order),
// Pospuesto and Hecho (the last three, «Ver los N»). A row is a mark, the title (two lines at most, the whole text in
// title) and one line; its actions show on hover and on focus: Hacer primero, Detener, Aceptar, Quitar. Each calls
// a route that exists (pickNext, stop a run, the delivery's own accept, cancel an order). Hook-free.
import type { ReactNode } from "react";
import type { Decision, OrgProject } from "@/lib/api";
import { filaOf, type FilaAct, type FilaRow } from "@/lib/fila";

export type FilaActs = {
  onPickNext?: (slug: string, key: string) => void;
  onStop?: (runId: string) => void;
  onAccept?: (d: Decision, action: "fusionar" | "aceptar") => void;
  onCancel?: (slug: string, key: string) => void;
  // A row opens its detail (La ficha, PLA-I47-4).
  onRow?: (slug: string, row: FilaRow, el: HTMLElement) => void;
  busy?: string | null;
};

const LABEL: Record<FilaAct["kind"], string> = { primero: "Hacer primero", detener: "Detener", aceptar: "Aceptar", quitar: "Quitar" };
const busyKey = (a: FilaAct) => (a.kind === "primero" ? `next-${a.key}` : a.kind === "quitar" ? `cancel-${a.key}` : a.kind === "detener" ? a.runId : `accept-${a.decision.id}`);

// What a click on an action calls; null when the page passed no handler for it.
export function filaRun(slug: string, a: FilaAct, acts: FilaActs): (() => void) | null {
  if (a.kind === "primero") return acts.onPickNext ? () => acts.onPickNext!(slug, a.key) : null;
  if (a.kind === "quitar") return acts.onCancel ? () => acts.onCancel!(slug, a.key) : null;
  if (a.kind === "detener") return acts.onStop ? () => acts.onStop!(a.runId) : null;
  return acts.onAccept ? () => acts.onAccept!(a.decision, a.action) : null;
}

const Row = ({ slug, row, acts }: { slug: string; row: FilaRow; acts: FilaActs }) => {
  const runs = row.acts.map((a) => ({ a, run: filaRun(slug, a, acts) })).filter((x) => x.run);
  return (
    <li className="edi-frow" data-g={row.mark} data-fila-row={row.key ?? row.id}>
      <button type="button" className="edi-frow-main" title={row.title} onClick={(e) => acts.onRow?.(slug, row, e.currentTarget)} data-control="fila-row">
        <span className="edi-fmk" data-mk={row.mark} aria-hidden>
          {row.n ?? (row.mark === "done" || row.mark === "pub" ? "✓" : row.tu ? "tú" : "")}
        </span>
        <span className="edi-ftx">
          <b>{row.title}</b>
          <small>{row.line}</small>
        </span>
      </button>
      {runs.length > 0 && (
        <span className="edi-frow-acts">
          {runs.map(({ a, run }) => (
            <button key={a.kind} type="button" className="edi-fmini" disabled={acts.busy === busyKey(a)} onClick={run!} data-control={`fila-${a.kind}`}>
              {LABEL[a.kind]}
            </button>
          ))}
        </span>
      )}
    </li>
  );
};

const Section = ({ title, hint, rows, slug, acts, empty, ordered, children }: { title: string; hint?: string; rows: FilaRow[]; slug: string; acts: FilaActs; empty?: string; ordered?: boolean; children?: ReactNode }) => {
  if (rows.length === 0 && !empty) return null;
  const List = ordered ? "ol" : "ul";
  return (
    <section className="edi-fsec" data-fila={title}>
      <h3 className="edi-eyebrow">
        {title}
        {hint && <small>{hint}</small>}
      </h3>
      {rows.length === 0 ? (
        <p className="edi-fempty">{empty}</p>
      ) : (
        <List className="edi-flist">
          {rows.map((r) => (
            <Row key={r.id} slug={slug} row={r} acts={acts} />
          ))}
        </List>
      )}
      {children}
    </section>
  );
};

export const Fila = ({ project: p, decisions, now, timeZone, acts }: { project: OrgProject; decisions: Decision[]; now: number; timeZone?: string; acts: FilaActs }) => {
  const f = filaOf(p, decisions, now, timeZone);
  return (
    <div className="edi-fila" data-fila-of={p.slug}>
      <h2 className="edi-fila-h">
        La fila <span>{f.sigue.length === 0 && f.ahora.length === 0 ? "nada en cola" : `${f.sigue.length} en cola`}</span>
      </h2>
      <Section title="Ahora" rows={f.ahora} slug={p.slug} acts={acts} empty="Nadie trabaja en este piso ahora." />
      <Section title="Sigue" hint="en el orden en que se toma" rows={f.sigue} slug={p.slug} acts={acts} empty="No hay nada en cola." ordered />
      <Section title="Pospuesto" rows={f.pospuesto} slug={p.slug} acts={acts} />
      <Section title="Hecho" rows={f.hecho} slug={p.slug} acts={acts}>
        {f.hechoTotal > f.hecho.length && (
          <button type="button" className="edi-fmore" onClick={(e) => acts.onRow?.(p.slug, { id: "hecho", key: null, title: "Hecho", line: "", mark: "done", acts: [] }, e.currentTarget)} data-control="fila-ver-hecho">
            Ver los {f.hechoTotal}
          </button>
        )}
      </Section>
    </div>
  );
};
