// NEWPROJ-4: a project's readiness list, grouped «Falta» / «Listo» / «No hace falta» (wording in @/lib/listo).
// Two looks: "cor" inside Compañía's sheets (corriente.css), "page" on the project page (Tailwind).
// ajustes is the place for the link to the project's settings view, which a later step adds; nothing passes it yet.
import type { ReactNode } from "react";
import { listoGrupos, type Listo, type ListoLinea } from "@/lib/listo";
import { cn } from "@/lib/utils";

const DOT: Record<"cor" | "page", (l: ListoLinea) => string> = {
  cor: (l) => `cor-listo-dot ${l.estado === "missing" ? (l.para ? "bad" : "amber") : l.estado === "ready" ? "ok" : ""}`,
  page: (l) => cn("mt-1.5 size-2 flex-none rounded-full", l.estado === "missing" ? (l.para ? "bg-destructive" : "bg-amber-500") : l.estado === "ready" ? "bg-emerald-500" : "bg-muted-foreground/40"),
};

export const ListoLista = ({ r, look, ajustes }: { r: Listo; look: "cor" | "page"; ajustes?: ReactNode }) => {
  const grupos = listoGrupos(r.items);
  const cor = look === "cor";
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
                    {l.para && <span className={cor ? "cor-listo-para" : "ml-2 text-xs font-normal text-destructive"}>impide arrancar</span>}
                  </b>
                  <span className={cor ? undefined : "break-words text-muted-foreground"}>{l.texto}</span>
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
