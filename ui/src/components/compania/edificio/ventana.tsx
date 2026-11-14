// PLA-I46-7: la Ventana a la app. Next to Ahora, the latest stills of the project's test copy (desktop 1280 and
// phone 390), a caption with the capture time, and Abrir ↗. Five states (lib/ventana.ts ventanaView): con captura,
// vacío, cargando, error (the last good capture in grey, Reintentar / Ver detalle) and apagada (the last capture in
// grey). PLA-I46-8: apagada and vacío carry «Encenderla», which starts the test copy on the Mac (only on this click);
// it moves to Cargando, takes fresh stills and says «En vivo», with Apagar beside it. At 390 it stacks under the
// Ahora text (CSS). Ventana is presentational (the tests render it with fake reads); VentanaLive holds the calls.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { ventanaPoll, ventanaView, type CapturesRead, type Still, type VentanaAct, type VentanaView } from "@/lib/ventana";

const Img = ({ still, phone, label }: { still: Still | null; phone?: boolean; label: string }) =>
  still ? (
    <img className={`edi-vshot${phone ? " edi-vph" : ""}`} src={still.image_url} width={still.width} height={still.height ?? undefined} alt={`${label}, ${phone ? "teléfono" : "escritorio"}`} loading="lazy" decoding="async" />
  ) : (
    <span className={`edi-vshot edi-vnone${phone ? " edi-vph" : ""}`} aria-hidden />
  );

export const Ventana = ({
  view: v,
  title,
  busy,
  onAct,
  onApagar,
  onPage,
}: {
  view: VentanaView;
  title: string; // the project's name, for the labels
  busy?: VentanaAct | "apagar" | null;
  onAct?: (a: VentanaAct) => void;
  onApagar?: () => void;
  onPage?: (key: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const label = v.page ? `${v.page.label} de ${title}` : title;
  const grey = v.state === "apagada" || v.state === "error";
  const hasShot = !!(v.desktop || v.phone);
  const detail = v.detail && (
    <button type="button" className="edi-vlink" aria-expanded={open} onClick={() => setOpen((x) => !x)} data-control="ventana-detalle">
      Ver detalle
    </button>
  );
  const button = v.button && onAct && (
    <button type="button" className={`edi-btn${v.button.act === "encender" && v.state !== "error" ? " edi-btn-primary" : ""}`} onClick={() => onAct(v.button!.act)} disabled={!!busy} data-control={`ventana-${v.button.act}`}>
      {busy === v.button.act ? "…" : v.button.label}
    </button>
  );
  return (
    <section className="edi-vent" data-ventana={v.state} aria-label={`Ventana a la app de ${title}`} aria-busy={v.state === "cargando" || undefined}>
      <div className="edi-vhead">
        <span className="edi-eyebrow">Ventana a la app</span>
        {v.open && (v.state === "captura" || v.state === "vivo") && (
          <a className="edi-vopen" href={v.open} target="_blank" rel="noreferrer" data-control="ventana-abrir">
            Abrir ↗
          </a>
        )}
      </div>
      {v.pages.length > 1 && (
        <div className="edi-vpages" role="group" aria-label="Página">
          {v.pages.map((p) => (
            <button key={p.key} type="button" className="edi-vpage" aria-pressed={p.key === v.page?.key} onClick={() => onPage?.(p.key)} data-page={p.key}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      {v.state === "cargando" ? (
        <div className="edi-vframe" data-skeleton>
          <span className="edi-vskel" />
          <span className="edi-vskel edi-vph" />
        </div>
      ) : v.state === "vacio" || (grey && !hasShot) ? (
        <div className="edi-vempty" data-v={v.state}>
          <b>{v.state === "vacio" ? "Todavía no hay nada que ver" : v.title}</b>
          <span className="edi-vacts">
            {button}
            {detail}
          </span>
        </div>
      ) : (
        <div className="edi-vframe" data-v={grey ? v.state : undefined}>
          <Img still={v.desktop} label={label} />
          <Img still={v.phone} phone label={label} />
          {grey && (
            <div className="edi-vover">
              <b data-v-title>{v.title}</b>
              <span className="edi-vacts">
                {button}
                {detail}
              </span>
            </div>
          )}
        </div>
      )}
      <p className="edi-vcap" data-v-caption>
        {v.state === "vivo" ? <span className="edi-vlive">{v.caption}</span> : <span>{v.caption}</span>}
        {v.apagar && onApagar && (
          <button type="button" className="edi-vlink" onClick={onApagar} disabled={!!busy} data-control="ventana-apagar">
            {busy === "apagar" ? "…" : "Apagar"}
          </button>
        )}
      </p>
      {open && v.detail && (
        <pre className="edi-vdetail" data-v-detail>
          {v.detail}
        </pre>
      )}
    </section>
  );
};

const FAIL: Record<string, string> = {
  INVALID_FILTER: "Este proyecto no tiene cómo encender su copia de prueba.",
  PROJECT_NOT_FOUND: "No encuentro el proyecto.",
};

// The floor's Ventana with its reads and clicks. Nothing for a project without capture settings.
export const VentanaLive = ({ slug, title, timeZone }: { slug: string; title: string; timeZone?: string }) => {
  const client = useQueryClient();
  const [page, setPage] = useState<string | null>(null);
  const key = ["captures", slug];
  const q = useQuery<CapturesRead>({ queryKey: key, queryFn: () => api.captures(slug), refetchInterval: (x) => ventanaPoll(x.state.data), retry: 1 });
  const act = useMutation({
    mutationFn: (a: "encender" | "tomar" | "apagar") => api.prueba(slug, a),
    onSuccess: (r) => client.setQueryData<CapturesRead>(key, (old) => (old ? { ...old, prueba: r.prueba } : old)),
    onError: (e) => toast.error(e instanceof ApiError ? (FAIL[e.code] ?? `No se pudo (${e.code}).`) : "No se pudo. Si la Mac está dormida, intenta al despertar."),
    onSettled: () => void client.invalidateQueries({ queryKey: key }),
  });
  if (q.data && !q.data.configured) return null;
  if (q.error instanceof ApiError && q.error.status === 404) return null;
  const view = ventanaView(q.data, { pending: q.isPending, failed: q.isError, page, timeZone });
  const busy = act.isPending ? (act.variables ?? null) : null;
  return (
    <Ventana
      view={view}
      title={title}
      busy={busy}
      onAct={(a) => (a === "leer" ? void q.refetch() : act.mutate(a))}
      onApagar={() => act.mutate("apagar")}
      onPage={setPage}
    />
  );
};
