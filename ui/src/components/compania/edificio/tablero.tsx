// PLA-I48-7: el Tablero del edificio (Design frame 10). Beside Plomería, which keeps its meaning (tokens and agent
// runs), «Tablero · N encendidas» opens every floor with its switch, port and state, «Configurar» for a floor that
// does not know how to start, and «Apagar todo». Tablero is presentational; TableroLive holds the reads.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { tableroLabel, tableroView, type TableroRead } from "@/lib/maquinas";
import { floorHue } from "@/lib/edificio";
import type { CSSProperties } from "react";
import type { Load } from "./ficha";

// Apagar todo: one apagar per copy Plania started and that is on (or failed), one after the other.
export async function apagarTodo(t: TableroRead, apagar: (slug: string) => Promise<unknown>): Promise<string[]> {
  const done: string[] = [];
  for (const slug of tableroView(t).stoppable) {
    await apagar(slug);
    done.push(slug);
  }
  return done;
}

export type TableroActs = { onSwitch?: (slug: string, on: boolean) => void; onConfigurar?: (slug: string) => void; onApagarTodo?: () => void; onPiso?: (slug: string) => void; onClose?: () => void; busy?: string | null };

export const Tablero = ({ read, acts }: { read: Load<TableroRead>; acts: TableroActs }) => {
  const t = read.data;
  const v = t ? tableroView(t) : null;
  return (
    <div className="edi-maq-tablero" role="dialog" aria-label="Tablero del edificio" data-tablero>
      <div className="edi-maq-shead">
        <h3>Tablero del edificio</h3>
        <button type="button" className="edi-fi-x" onClick={acts.onClose} aria-label="Cerrar el tablero" data-control="tablero-cerrar">
          ✕
        </button>
      </div>
      <p className="edi-maq-note">Lo que corre en tu Mac, piso por piso. Plomería sigue contando tokens y corridas.</p>
      {read.status === "error" ? (
        <div className="edi-fi-state" data-state="error">
          <p>No se pudo leer el tablero.</p>
          {read.retry && (
            <button type="button" className="edi-btn" onClick={read.retry} data-control="tablero-reintentar">
              Reintentar
            </button>
          )}
        </div>
      ) : !v ? (
        <div className="edi-fi-state" data-state="loading" aria-busy="true">
          <span className="edi-sk" />
          <span className="edi-sk" />
        </div>
      ) : (
        <>
          <ul className="edi-maq-trows">
            {v.rows.map((r) => (
              <li key={r.project} data-row={r.project} data-on={r.on || undefined} style={{ "--c": floorHue(r.project) } as CSSProperties}>
                <button type="button" className="edi-maq-tname" onClick={() => acts.onPiso?.(r.project)} title={r.title} data-control="tablero-piso">
                  <i className="edi-maq-lamp" data-s={r.on ? "on" : r.phase === "failed" ? "error" : "off"} aria-hidden />
                  {r.title}
                </button>
                <span className="edi-maq-tstate" data-word>
                  {r.word}
                </span>
                <code className="edi-maq-tport">{r.port ? `:${r.port}` : ""}</code>
                {!r.configured ? (
                  <button type="button" className="edi-btn edi-maq-sm" onClick={() => acts.onConfigurar?.(r.project)} disabled={acts.busy === `cfg:${r.project}`} data-control="tablero-configurar">
                    Configurar
                  </button>
                ) : r.phase === "running" && !r.managed ? (
                  <span className="edi-maq-tnote">fuera de Plania</span>
                ) : (
                  <button
                    type="button"
                    className="edi-maq-switch"
                    role="switch"
                    aria-checked={r.on}
                    aria-label={`${r.title}: ${r.on ? "apagar" : "encender"}`}
                    disabled={!!acts.busy || r.phase === "starting"}
                    onClick={() => acts.onSwitch?.(r.project, !r.on)}
                    data-control="tablero-switch"
                  >
                    <i aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="edi-fi-acts">
            <button type="button" className="edi-btn" onClick={acts.onApagarTodo} disabled={!v.stoppable.length || !!acts.busy} data-control="tablero-apagar-todo">
              {acts.busy === "todo" ? "…" : "Apagar todo"}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// The link in the sky line and its panel. The count is read every minute (and on open).
export const TableroLive = ({ onPiso, onConfigurado, onCount }: { onPiso: (slug: string) => void; onConfigurado?: (slug: string) => void; onCount?: (on: string[]) => void }) => {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const q = useQuery({ queryKey: ["maquinas-tablero"], queryFn: () => api.tablero(), refetchInterval: open ? 5000 : 60_000, retry: 1 });
  const onList = q.data ? tableroView(q.data).rows.filter((r) => r.on).map((r) => r.project) : [];
  const key = onList.join(",");
  useEffect(() => onCount?.(onList), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      opener.current?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  const [busy, setBusy] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: async (x: { key: string; call: () => Promise<unknown> }) => x.call(),
    onMutate: (x) => setBusy(x.key),
    onError: () => toast.error("No se pudo. Si la Mac está dormida, intenta al despertar."),
    onSettled: () => {
      setBusy(null);
      void client.invalidateQueries({ queryKey: ["maquinas-tablero"] });
      void client.invalidateQueries({ queryKey: ["maquinas"] });
      void client.invalidateQueries({ queryKey: ["captures"] });
    },
  });
  const count = q.data ? tableroView(q.data).count : 0;
  return (
    <span className="edi-maq-tlink">
      <button ref={opener} type="button" className="edi-mini" aria-expanded={open} onClick={() => setOpen((x) => !x)} data-control="tablero" data-tablero-n={count}>
        {tableroLabel(count)}
      </button>
      {open && (
        <Tablero
          read={{ status: q.isError ? "error" : q.data ? "ok" : "loading", data: q.data, retry: () => void q.refetch() }}
          acts={{
            busy,
            onClose: () => {
              setOpen(false);
              opener.current?.focus();
            },
            onPiso: (slug) => {
              setOpen(false);
              onPiso(slug);
            },
            onSwitch: (slug, on) => run.mutate({ key: `sw:${slug}`, call: () => api.prueba(slug, on ? "encender" : "apagar") }),
            onConfigurar: (slug) => run.mutate({ key: `cfg:${slug}`, call: async () => (await api.configurar(slug), onConfigurado?.(slug)) }),
            onApagarTodo: () => q.data && run.mutate({ key: "todo", call: () => apagarTodo(q.data!, (slug) => api.prueba(slug, "apagar")) }),
          }}
        />
      )}
    </span>
  );
};
