// PLA-I64-6 (PLA-IDEA28, boards B2 and B3): two doors of the project.
//   Archivo  what was written, drawn and merged, together: the project's own docs and each thing's, the designs and
//            the PRs. Every doc and PR is read (ficha ?todo=1), so the one opened is the one clicked; it opens in
//            today's detail (Docs, PRs, the idea's Diseño).
//   Hecho    what happened, day by day: steps done per day for 14 days, the initiatives closed, and a summary per day
//            capped at a few titles (the rest counted); «Ver antes» walks back 14 days at a time.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, type FichaDoc, type OrgProject } from "@/lib/api";
import { useFicha } from "./listas";
import { Btn, Label, ReadError } from "./parts";

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");
const dayShort = (iso: string | null, timeZone?: string) => (iso ? new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone }).format(new Date(iso)).replace(".", "").toUpperCase() : "");
const ymd = (d: string) => new Date(`${d}T12:00:00Z`);
const dayWords = (d: string) => new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(ymd(d)).replace(/\./g, "").toUpperCase();

export type ArchivoLinks = { doc: (id: string) => string; pr: (n: number) => string; idea: (key: string) => string; todo: string };

/** Docs grouped: the project's own (no thing), then each thing's, newest first. */
export function docGroups(docs: FichaDoc[]): { own: FichaDoc[]; things: { key: string; docs: FichaDoc[] }[] } {
  const own = docs.filter((d) => !d.task_key);
  const by = new Map<string, FichaDoc[]>();
  for (const d of docs) if (d.task_key) by.set(d.task_key, [...(by.get(d.task_key) ?? []), d]);
  return { own, things: [...by.entries()].map(([key, ds]) => ({ key, docs: ds })) };
}

const SHOW = { own: 6, things: 3, prs: 8 } as const;

/** The things' names the company read carries (open and done initiatives, loose steps). */
export const namesOf = (p: OrgProject): Map<string, string> =>
  new Map([...(p.tablero?.initiatives ?? []).map((i) => [i.key, i.title] as const), ...(p.tablero?.loose ?? []).map((t) => [t.key, t.title] as const), ...(p.tablero?.done_initiatives ?? []).map((i) => [i.key, i.title] as const)]);

export const Archivo = ({ p, links, timeZone }: { p: OrgProject; links: ArchivoLinks; timeZone?: string }) => {
  const f = useFicha(p.slug, true);
  const [more, setMore] = useState<{ own?: boolean; things?: boolean; prs?: boolean }>({});
  if (f.isError) return <ReadError what="el archivo" onRetry={() => void f.refetch()} />;
  if (!f.data) return <div className="cor-skel" role="status" style={{ height: 420, margin: "20px 32px" }} aria-busy="true" aria-label="Leyendo el archivo" />;
  const { own, things } = docGroups(f.data.docs);
  const prs = f.data.prs;
  const openPrs = prs.filter((x) => x.state === "open");
  const lienzos = f.data.lienzos ?? [];
  const linkOnly = f.data.designs.filter((d) => !lienzos.some((l) => l.key === d.idea_key));
  const linkIdeas = [...new Set(linkOnly.map((d) => d.idea_key))];
  const nDesigns = lienzos.length + linkIdeas.length;
  const names = namesOf(p);
  const title = (key: string) => names.get(key) || f.data!.ideas.find((i) => i.key === key)?.summary || f.data!.ideas.find((i) => i.key === key)?.title || "";
  const ownShown = more.own ? own : own.slice(0, SHOW.own);
  const thingsShown = more.things ? things : things.slice(0, SHOW.things);
  const prsShown = more.prs ? prs : prs.slice(0, SHOW.prs);
  return (
    <div className="cor-archivo" data-archivo={p.slug}>
      <header className="cor-door-head">
        <h2 className="cor-door-h">{`Archivo de ${p.title}`}</h2>
        <p className="cor-text">Lo que se escribió, se dibujó y se fusionó. Cada papel vive dentro de su cosa; aquí están todos juntos.</p>
      </header>
      <div className="cor-archivo-cols">
        <section aria-label="Docs" data-archivo-docs={f.data.counts.docs}>
          <div className="cor-grp">
            <h3 className="cor-label wh">{`Docs · ${f.data.counts.docs}`}</h3>
            <span className="cor-label">{`Del proyecto · ${own.length}`}</span>
            {own.length > SHOW.own && (
              <Btn kind="link" className="cor-grp-more" aria-expanded={!!more.own} onClick={() => setMore((m) => ({ ...m, own: !m.own }))} data-control="ver-docs">
                {more.own ? "Ver menos" : `Ver los otros ${own.length - SHOW.own}`}
              </Btn>
            )}
          </div>
          {own.length === 0 ? (
            <p className="cor-text cor-muted cor-door-empty">El proyecto no tiene docs propios todavía.</p>
          ) : (
            <ul className="cor-door-list">
              {ownShown.map((d) => (
                <li key={d.id}>
                  <Link to={links.doc(d.id)} className="cor-door-row" data-doc={d.id}>
                    <span className="cor-ellipsis">{d.title}</span>
                    <span className="cor-cap">{dayShort(d.updated_at, timeZone)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {things.length > 0 && (
            <>
              <div className="cor-grp">
                <h3 className="cor-label">{`De cada cosa · ${things.reduce((n, t) => n + t.docs.length, 0)} en ${things.length} ${things.length === 1 ? "cosa" : "cosas"}`}</h3>
                {things.length > SHOW.things && (
                  <Btn kind="link" className="cor-grp-more" aria-expanded={!!more.things} onClick={() => setMore((m) => ({ ...m, things: !m.things }))} data-control="ver-cosas">
                    {more.things ? "Ver menos" : `Ver las otras ${things.length - SHOW.things}`}
                  </Btn>
                )}
              </div>
              <ul className="cor-door-list">
                {thingsShown.map((t) => (
                  <li key={t.key}>
                    <Link to={links.doc(t.docs[0]!.id)} className="cor-door-row" data-doc-cosa={t.key}>
                      <span className="cor-ellipsis">
                        <span className="cor-key">{t.key}</span> {title(t.key) || t.docs.map((d) => d.title).join(", ")}
                      </span>
                      <span className="cor-cap">{`${t.docs.length} ${t.docs.length === 1 ? "DOC" : "DOCS"}`}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section aria-label="Diseños" data-archivo-disenos={nDesigns}>
          <div className="cor-grp">
            <h3 className="cor-label wh">{`Diseños · ${nDesigns}`}</h3>
          </div>
          {nDesigns === 0 ? (
            <p className="cor-text cor-muted cor-door-empty">Ningún diseño todavía: Artist dibuja cuando una idea llega a Diseño.</p>
          ) : (
            <ul className="cor-door-cards">
              {lienzos.map((l) => (
                <li key={l.key}>
                  <Link to={links.idea(l.key)} className="cor-card cor-lienzo-card" data-lienzo={l.key}>
                    <span className="cor-lienzo-thumbs" aria-hidden>
                      {l.thumbs.slice(0, 3).map((t) => (
                        <img key={t} src={t} alt="" loading="lazy" />
                      ))}
                    </span>
                    <span className="cor-ellipsis">
                      <span className="cor-key">{l.key}</span> {l.title}
                    </span>
                    <span className="cor-cap">{`${l.count} ${l.count === 1 ? "MARCO" : "MARCOS"} DE ARTIST${l.unseen ? ` · ${l.unseen} SIN VER` : ""}`}</span>
                  </Link>
                </li>
              ))}
              {linkIdeas.map((k) => (
                <li key={k}>
                  <Link to={links.idea(k)} className="cor-card cor-lienzo-card" data-lienzo={k}>
                    <span className="cor-ellipsis">
                      <span className="cor-key">{k}</span> {title(k)}
                    </span>
                    <span className="cor-cap">LIENZO EN CLAUDE.AI</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="PRs" data-archivo-prs={f.data.counts.prs}>
          <div className="cor-grp">
            <h3 className="cor-label wh">{`PRs · ${f.data.counts.prs}`}</h3>
            <span className="cor-label">{openPrs.length ? `${openPrs.length} ${openPrs.length === 1 ? "abierto" : "abiertos"}` : "Ninguno abierto"}</span>
          </div>
          {prs.length === 0 ? (
            <p className="cor-text cor-muted cor-door-empty">Ningún PR todavía.</p>
          ) : (
            <ul className="cor-door-list">
              {prsShown.map((x) => (
                <li key={x.number}>
                  <Link to={links.pr(x.number)} className="cor-door-row" data-pr={x.number}>
                    <span className="cor-ellipsis">
                      <span className="cor-key">#{x.number}</span> {x.title}
                    </span>
                    <span className={cls("cor-cap", x.state === "open" && "cor-state live")}>{x.merged_at ? dayShort(x.merged_at, timeZone) : x.state === "open" ? "ABIERTO" : "CERRADO"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {prs.length > SHOW.prs && (
            <Btn kind="link" aria-expanded={!!more.prs} onClick={() => setMore((m) => ({ ...m, prs: !m.prs }))} data-control="ver-prs">
              {more.prs ? "Ver menos" : `Ver los otros ${prs.length - SHOW.prs}`}
            </Btn>
          )}
        </section>
      </div>
    </div>
  );
};

// ---- Hecho

export type HechoLinks = { iniciativa: (key: string) => string; paso: (key: string) => string; antes: (hasta: string) => string; ahora: string };

const NUM = ["Cero", "Una", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez"];
const num = (n: number) => (n <= 10 ? NUM[n]! : String(n));

export const HechoView = ({ p, hasta, links, timeZone }: { p: OrgProject; hasta: string | null; links: HechoLinks; timeZone?: string }) => {
  const q = useQuery({ queryKey: ["hecho", p.slug, hasta ?? ""], queryFn: () => api.hecho(p.slug, hasta), staleTime: 30_000 });
  if (q.isError) return <ReadError what="lo hecho" onRetry={() => void q.refetch()} />;
  if (!q.data) return <div className="cor-skel" role="status" style={{ height: 420, margin: "20px 32px" }} aria-busy="true" aria-label="Leyendo lo hecho" />;
  const h = q.data;
  // Every day of the window, oldest first, for the bars.
  const span: { day: string; n: number }[] = [];
  for (let d = ymd(h.from); d <= ymd(h.to); d = new Date(d.getTime() + 86_400_000)) {
    const k = d.toISOString().slice(0, 10);
    span.push({ day: k, n: h.days.find((x) => x.day === k)?.n ?? 0 });
  }
  const max = Math.max(1, ...span.map((d) => d.n));
  const today = !hasta;
  const fromPedido = h.initiatives.filter((i) => i.origin === "jorge").length;
  const sentence = [
    `${h.total === 1 ? "Un paso hecho" : `${h.total} pasos hechos`} ${today ? "en 14 días" : `del ${dayShort(`${h.from}T12:00:00Z`, "UTC").toLowerCase()} al ${dayShort(`${h.to}T12:00:00Z`, "UTC").toLowerCase()}`}.`,
    h.initiatives.length ? `${num(h.initiatives.length)} ${h.initiatives.length === 1 ? "iniciativa cerrada" : "iniciativas cerradas"}${fromPedido ? `; ${fromPedido === 1 ? "una nació" : `${num(fromPedido).toLowerCase()} nacieron`} de un pedido tuyo` : ""}.` : "Ninguna iniciativa cerrada.",
  ].join(" ");
  return (
    <div className="cor-hecho" data-hecho={p.slug} data-desde={h.from}>
      <header className="cor-door-head">
        <h2 className="cor-door-h">{`Lo que pasó en ${p.title}`}</h2>
        <p className="cor-text">{sentence}</p>
      </header>
      <div className="cor-hecho-cols">
        <div className="cor-hecho-left">
          <figure className="cor-card cor-hecho-chart">
            <figcaption className="cor-label">Pasos hechos por día</figcaption>
            <div className="cor-hecho-bars" role="img" aria-label={`Pasos hechos por día: ${span.map((d) => `${dayWords(d.day).toLowerCase()} ${d.n}`).join(", ")}`}>
              {span.map((d, i) => (
                <span key={d.day} className="cor-hecho-bar">
                  <b className="cor-cap">{d.n || ""}</b>
                  <i className={cls(d.n === 0 && "z", today && i === span.length - 1 && "hoy")} style={{ height: d.n ? Math.max(6, Math.round((d.n / max) * 96)) : 2 }} />
                  <span className="cor-cap">{today && i === span.length - 1 ? "HOY" : String(ymd(d.day).getUTCDate())}</span>
                </span>
              ))}
            </div>
          </figure>
          <section aria-label="Iniciativas cerradas" data-cerradas={h.initiatives.length}>
            <div className="cor-grp">
              <h3 className="cor-label green">{`Iniciativas cerradas · ${h.initiatives.length}`}</h3>
            </div>
            {h.initiatives.length === 0 ? (
              <p className="cor-text cor-muted cor-door-empty">Ninguna en estos días.</p>
            ) : (
              <ul className="cor-door-list">
                {h.initiatives.slice(0, 6).map((i) => (
                  <li key={i.key}>
                    <Link to={links.iniciativa(i.key)} className="cor-door-row" data-cerrada={i.key}>
                      <span className="cor-ellipsis">
                        <span className="cor-key">{i.key}</span> {i.title}
                      </span>
                      <span className="cor-cap">{[dayShort(i.done_at, timeZone), `${i.steps} ${i.steps === 1 ? "PASO" : "PASOS"}`, i.idea ? (i.origin === "jorge" ? `ERA TU PEDIDO ${i.idea}` : `ERA ${i.idea}`) : null].filter(Boolean).join(" · ")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <section className="cor-hecho-days" aria-label="Día por día" data-dias={h.days.length}>
          <h3 className="cor-label">Día por día</h3>
          {h.days.length === 0 && <p className="cor-text cor-muted cor-door-empty">Nada aterrizó en estos días.</p>}
          <ol>
            {h.days.slice(0, 5).map((d) => (
              <li key={d.day} className="cor-hecho-day" data-dia={d.day}>
                <span className="cor-label wh">{`${dayWords(d.day)} · ${d.n} ${d.n === 1 ? "PASO" : "PASOS"}`}</span>
                <p className="cor-text">
                  {d.initiatives.length > 0 && (
                    <b>{d.initiatives.length === 1 ? `Se cerró «${d.initiatives[0]!.title}». ` : `Se cerraron ${num(d.initiatives.length).toLowerCase()} iniciativas: ${d.initiatives.map((i) => i.title).join(", ")}. `}</b>
                  )}
                  {d.steps.map((s) => s.title).join(", ")}
                  {d.more > 0 ? ` y ${d.more} más` : ""}
                  {d.steps.length ? "." : ""}
                  {d.prs > 0 ? ` ${d.prs === 1 ? "Un PR fusionado." : `${num(d.prs)} PRs fusionados.`}` : ""}
                </p>
              </li>
            ))}
          </ol>
          <div className="cor-hecho-nav">
            {h.before && (
              <Link className="cor-btn link" to={links.antes(h.before)} data-control="ver-antes">
                {`Ver antes del ${dayShort(`${h.from}T12:00:00Z`, "UTC").toLowerCase()}`}
              </Link>
            )}
            {!today && (
              <Link className="cor-btn link" to={links.ahora} data-control="ver-ultimos">
                Volver a los últimos 14 días
              </Link>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
