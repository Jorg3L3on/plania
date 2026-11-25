// NEWPROJ-4: a project's readiness list, grouped «Falta» / «Listo» / «No hace falta» (wording in @/lib/listo).
// Two looks: "cor" inside Compañía's sheets (corriente.css), "page" on the project page (Tailwind).
// ajustes is the place for the link to the project's settings view (NEWPROJ-6: the Ajustes door).
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { linkTo } from "@/lib/corriente";
import { listoDonde, listoIrA, listoIr, listoGrupos, listoSecciones, listoSeccionWords, type Listo, type ListoLinea, type ListoSeccion } from "@/lib/listo";
import { cn } from "@/lib/utils";
import { words } from "@/lib/i18n";
import { TASK } from "@/lib/task-words";

/** A missing item's way to its control: an Ajustes section (#ajustes-…) or a Despliegue section (PLA-132). */
export const irHref = (slug: string, to: { tab: "ajustes" | "camino"; sec: string }): string =>
  to.tab === "camino" ? linkTo({ slug, tab: "camino", ver: { kind: "camino", sec: to.sec } }) : `${linkTo({ slug, tab: "ajustes" })}#ajustes-${to.sec}`;

const DOT: Record<"cor" | "page", (l: ListoLinea) => string> = {
  cor: (l) => `cor-listo-dot ${l.estado === "missing" ? (l.para ? "bad" : "amber") : l.estado === "ready" ? "ok" : ""}`,
  page: (l) => cn("mt-1.5 size-2 flex-none rounded-full", l.estado === "missing" ? (l.para ? "bg-destructive" : "bg-amber-500") : l.estado === "ready" ? "bg-emerald-500" : "bg-muted-foreground/40"),
};

export const ListoLista = ({ r, look, ajustes }: { r: Listo; look: "cor" | "page"; ajustes?: ReactNode }) => {
  const grupos = listoGrupos(r.items);
  const cor = look === "cor";
  const w = words(TASK);
  return (
    <div className={cor ? "cor-listo" : "grid gap-4"} data-listo={r.blocking}>
      {grupos.map((g) => (
        <section key={g.key} aria-label={g.titulo} data-listo-grupo={g.key}>
          <h3 className={cor ? "cor-label" : "mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"}>{g.titulo}</h3>
          <ul className={cor ? "cor-listo-list" : "grid"}>
            {g.lineas.map((l) => (
              <li key={l.key} className={cor ? "cor-listo-item" : "flex gap-2.5 border-t py-2 text-sm"} data-listo-item={l.id} data-listo-para={l.para ? "1" : undefined}>
                <span aria-hidden className={DOT[look](l)} />
                <span className={cor ? "cor-listo-body" : "grid min-w-0 gap-0.5"}>
                  <b className={cor ? undefined : "font-medium"}>
                    {l.titulo}
                    {l.para && <span className={cor ? "cor-listo-para" : "ml-2 text-xs font-normal text-destructive"}>{w.blocksStart}</span>}
                  </b>
                  <span className={cor ? undefined : "break-words text-muted-foreground"}>{l.texto}</span>
                  {/* PLA-I2-6: a missing item links to its control in the project's Ajustes; PLA-132: or in Despliegue. */}
                  {l.estado === "missing" && listoIrA(l.id) && (
                    <Link to={irHref(r.slug, listoIrA(l.id)!)} className={cor ? "cor-btn link small" : "text-sm font-medium underline underline-offset-2"} data-listo-ir={listoIrA(l.id)!.sec}>
                      {listoIr(undefined, listoIrA(l.id)!.tab)}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {ajustes}
    </div>
  );
};

// PLA-180: the sheet after adding a project, in three short sections instead of one long list: Resumen (the verdict and what it
// is), Falta (only what to fix, each with its way to Ajustes or Despliegue, as ListoLista), Listo (what is done, titles only). cor look only.
export const ListoSecciones = ({ r, resumen, ajustes }: { r: Listo; resumen: ReactNode; ajustes?: ReactNode }) => {
  const w = listoSeccionWords();
  const c = listoSecciones(r);
  const [seccion, setSeccion] = useState<ListoSeccion>("resumen");
  const grupos = listoGrupos(r.items);
  const falta = grupos.find((g) => g.key === "falta");
  const hechos = grupos.filter((g) => g.key !== "falta").flatMap((g) => g.lineas);
  const label = (s: ListoSeccion) => (s === "falta" ? `${w.secciones.falta} · ${c.falta}` : s === "listo" ? `${w.secciones.listo} · ${c.listo}` : w.secciones.resumen);
  return (
    <div className="cor-listo cor-listo-secciones" data-listo={r.blocking} data-listo-seccion={seccion}>
      <div className="cor-listo-tabs" role="tablist" aria-label={w.secciones.resumen}>
        {c.secciones.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={seccion === s} className="cor-opt" onClick={() => setSeccion(s)} data-seccion={s}>
            {label(s)}
          </button>
        ))}
      </div>
      {seccion === "resumen" && (
        <div className="cor-listo-resumen" role="tabpanel">
          {resumen}
          <div className="cor-listo-veredicto">
            <p className="cor-text">
              {c.falta === 0 ? w.resumenNada : w.resumenFalta(c.falta)} {c.falta > 0 && c.para === 0 ? w.resumenNoPara(listoDonde(r.items)) : null}
            </p>
            {c.falta > 0 && (
              <button type="button" className="cor-btn link small" onClick={() => setSeccion("falta")} data-ver="falta">
                {w.verFalta} →
              </button>
            )}
            <p className="cor-text">{w.resumenListo(c.listo)}</p>
            <button type="button" className="cor-btn link small" onClick={() => setSeccion("listo")} data-ver="listo">
              {w.verListo} →
            </button>
          </div>
        </div>
      )}
      {seccion === "falta" && falta && (
        <div role="tabpanel">
          <ul className="cor-listo-list">
            {falta.lineas.map((l) => (
              <li key={l.key} className="cor-listo-item" data-listo-item={l.id} data-listo-para={l.para ? "1" : undefined}>
                <span aria-hidden className={DOT.cor(l)} />
                <span className="cor-listo-body">
                  {/* Title and its way to its control on one line: one row less per item. */}
                  <span className="cor-listo-head">
                    <b>
                      {l.titulo}
                      {l.para && <span className="cor-listo-para">{words(TASK).blocksStart}</span>}
                    </b>
                    {listoIrA(l.id) && (
                      <Link to={irHref(r.slug, listoIrA(l.id)!)} className="cor-btn link small" aria-label={`${listoIr(undefined, listoIrA(l.id)!.tab)}: ${l.titulo}`} data-listo-ir={listoIrA(l.id)!.sec}>
                        {w.arreglar} →
                      </Link>
                    )}
                  </span>
                  <span>{l.texto}</span>
                </span>
              </li>
            ))}
          </ul>
          {ajustes}
        </div>
      )}
      {seccion === "listo" && (
        <ul className="cor-listo-list cor-listo-compacta" role="tabpanel">
          {hechos.map((l) => (
            <li key={l.key} className="cor-listo-item" data-listo-item={l.id} title={l.texto}>
              <span aria-hidden className={DOT.cor(l)} />
              <span className="cor-listo-body">
                <b>{l.titulo}</b>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
