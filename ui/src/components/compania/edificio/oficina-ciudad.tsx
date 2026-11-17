// PLA-31: Oficina (?edificio) shows Inicio's city in place of Brief de hoy and the one-row-per-project facade.
// One district per running floor, in the tower's order; its towers are the open initiatives En curso or En revisión
// (workingCity), so a floor with nothing moving is an empty lot with its plate. The plate carries what the facade
// row said: the goal, Ahora's word and the delivery's legs; it opens the floor. Paused floors sit under the street.
// Reads the same three queries as Inicio (projects, inbox, machine); the page passes the company's own data.
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CiudadOficina } from "@/components/home/ciudad";
import type { Decision, OrgProject } from "@/lib/api";
import { api } from "@/lib/api";
import { cityOf, crewCity, waitingOf, type District } from "@/lib/city";
import { floorHue, floorOrder, nowLine, workingNow } from "@/lib/edificio";
import { headlineOf } from "@/lib/home";
import { legLooks } from "@/lib/legs";

export const OficinaCiudad = ({ projects, decisions, now, timeZone, companyPaused, pre, links, onPiso, onResume, resuming }: {
  projects: OrgProject[];
  decisions: Decision[];
  now: number;
  timeZone?: string;
  companyPaused?: boolean;
  pre: string;
  links?: ReactNode;
  onPiso?: (slug: string) => void;
  onResume?: (slug: string) => void;
  resuming?: string | null;
}) => {
  const list = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: () => api.inbox(), staleTime: 15_000 });
  const machine = useQuery({ queryKey: ["machine"], queryFn: api.machine, staleTime: 15_000 });

  const { floors, basement } = floorOrder(projects, decisions);
  const model = useMemo(() => {
    const all = cityOf(list.data ?? [], (inbox.data?.items ?? []).filter((i) => i.group !== "limpieza"));
    // PLA-32: one source. The headline, the plates and the cranes all count teammates whose run is live (Compañía's
    // reading), not Inicio's claims.
    const flights = workingNow(projects, companyPaused);
    const working = new Map(crewCity(all, flights).map((d) => [d.slug, d]));
    const headline = headlineOf({
      projects: list.data ?? [],
      flights,
      inbox: waitingOf(all, (inbox.data?.items ?? []).filter((i) => i.group !== "limpieza")),
      totals: machine.data?.totals ?? null,
      nowMs: now,
    });
    return { working, headline };
  }, [list.data, inbox.data, machine.data, now, projects, companyPaused]);

  // Districts with towers first (in the tower's order), then the empty lots, so what is moving is never off screen.
  const lots: District[] = floors.map((p) => model.working.get(p.slug) ?? { slug: p.slug, title: p.title, towers: [] });
  const districts = [...lots.filter((d) => d.towers.length > 0), ...lots.filter((d) => d.towers.length === 0)];
  const bySlug = new Map(projects.map((p) => [p.slug, p]));

  const plateFor = (d: District) => {
    const p = bySlug.get(d.slug);
    if (!p) return null;
    const line = nowLine(p, decisions, now, { companyPaused, timeZone });
    const legs = p.route?.legs ?? [];
    const { looks } = legLooks(legs);
    const c = floorHue(p.slug);
    return (
      <button
        type="button"
        className="city-plate"
        style={{ "--c": c } as CSSProperties}
        onClick={() => onPiso?.(p.slug)}
        aria-label={`Abrir el piso de ${p.title}`}
        data-plate={p.slug}
        data-empty={d.towers.length === 0 || undefined}
      >
        <span className="edi-bullet" aria-hidden>
          {p.title.charAt(0).toUpperCase()}
        </span>
        <span className="grid min-w-0 gap-0.5">
          <b className="city-plate-name">{p.title}</b>
          <small className="city-plate-line">
            <strong data-now={line.state}>{line.word}</strong>
            {" · "}
            <span title={p.rumbo?.goal ?? undefined}>{p.rumbo?.goal ?? "Sin meta"}</span>
          </small>
          {legs.length > 0 && (
            <span className="city-plate-legs edi-fa-bars" aria-hidden>
              {legs.map((l, i) => (
                <i key={l.key} data-look={looks[i]}>
                  <u style={{ width: `${l.total ? Math.round((l.done / l.total) * 100) : 0}%` }} />
                </i>
              ))}
            </span>
          )}
        </span>
      </button>
    );
  };

  const under =
    basement.length > 0 ? (
      <div className="city-under" data-fa-under={basement.length}>
        <p className="edi-eyebrow">Bajo la calle · en pausa</p>
        <div className="edi-fa-off">
          {basement.map((p) => (
            <span key={p.slug} className="edi-fa-offitem" style={{ "--c": floorHue(p.slug) } as CSSProperties}>
              <button type="button" onClick={() => onPiso?.(p.slug)} data-fa-off={p.slug}>
                <span className="edi-bullet" aria-hidden>
                  {p.title.charAt(0).toUpperCase()}
                </span>
                {p.title}
              </button>
              {onResume && (
                <button type="button" className="edi-mini" disabled={resuming === p.slug} onClick={() => onResume(p.slug)} data-control="fa-reanudar">
                  {resuming === p.slug ? "…" : "Reanudar"}
                </button>
              )}
            </span>
          ))}
        </div>
      </div>
    ) : (
      <div className="city-under" aria-hidden />
    );

  return <CiudadOficina districts={districts} pre={pre} headline={model.headline} links={links} plateFor={plateFor} under={under} />;
};
