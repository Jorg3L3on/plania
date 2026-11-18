// PLA-I62-7: a project's Ideas, Diseño, PRs and Docs tabs (boards C1, C3, C4, C5), from the building's ficha read
// (GET /company/projects/:slug/ficha). Ideas: each one on its six stops, grouped (a delivery not seen, advancing,
// ready to build, saved), with Abrir, Despertar, Constrúyelo and Restaurar as today. Diseño: Artist's canvases with
// the unseen marked. PRs: the list and the open one beside it (Rama, Fusionado, Ver la entrega, Ver el paso, GitHub).
// Docs: by initiative, the open one beside it.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router";
import { api, type Decision, type FichaIdea, type OrgFicha, type OrgPedido, type OrgProject, type PedidoStop } from "@/lib/api";
import { deliveryFor } from "@/lib/etapas";
import type { CorrienteActs } from "./acts";
import { STOPS } from "./idea";
import { Agent, Btn, Dot, Key, Label, ReadError, State, You } from "./parts";

const STAGE_STOP: Record<string, PedidoStop> = { idea: "entendido", research: "investigacion", design: "diseno", planning: "plan", ready: "lista" };
const dayOf = (iso: string | null) => (iso ? new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(new Date(iso)).replace(".", "") : "");

export function useFicha(slug: string) {
  return useQuery({ queryKey: ["company-ficha", slug], queryFn: () => api.companyFicha(slug), staleTime: 15_000 });
}

type Row = { key: string; title: string; stop: PedidoStop; who: string; unseen: number; pedido: OrgPedido | null; group: "nuevo" | "avanza" | "lista" | "guardada" };
export function ideaRows(ideas: FichaIdea[], pedidos: OrgPedido[]): Row[] {
  const byKey = new Map(pedidos.map((x) => [x.key, x]));
  const rows: Row[] = ideas.map((i) => {
    const pd = byKey.get(i.key) ?? null;
    const stop = pd?.stop ?? STAGE_STOP[i.stage ?? "idea"] ?? "entendido";
    const unseen = i.unseen ?? pd?.unseen ?? 0;
    const group: Row["group"] = pd?.guardada ? "guardada" : unseen > 0 ? "nuevo" : stop === "lista" ? "lista" : "avanza";
    // «Doc Plan» (what the stage still needs) said in words, as the building does.
    // PLA-I64-1: a promoted idea is already its initiative; it never waits on «Constrúyelo».
    const who = i.promoted_to ? `Ya es ${i.promoted_to}` : i.waits ? i.waits.replace(/^Doc (\w+)$/, (_m, d: string) => `Falta el doc ${d}`) : "";
    return { key: i.key, title: i.summary || i.title, stop, who, unseen, pedido: pd, group };
  });
  // Saved requests that the ideas read does not list.
  for (const pd of pedidos.filter((x) => x.guardada && !rows.some((r) => r.key === x.key))) rows.push({ key: pd.key, title: pd.title, stop: pd.stop, who: "", unseen: 0, pedido: pd, group: "guardada" });
  return rows;
}

const Journey = ({ r }: { r: Row }) => {
  const at = STOPS.findIndex((s) => s.id === r.stop);
  const live = r.pedido?.state === "trabajando";
  const you = r.pedido?.state === "espera";
  return (
    <span className="cor-journey" aria-hidden>
      {STOPS.map((s, i) => (
        <span key={s.id} className="cor-jstop">
          {i === at ? r.unseen > 0 ? <span className="cor-unseen" /> : you ? <You small /> : live ? <Agent small /> : <Dot grey={r.group === "guardada"} /> : i < at ? <Dot /> : <i className="cor-ring" />}
        </span>
      ))}
    </span>
  );
};

const GROUP_NAME: Record<Row["group"], string> = { nuevo: "Con una entrega sin ver", avanza: "Avanzando", lista: "Listas para construir", guardada: "Guardadas" };

export const Ideas = ({ p, acts, links }: { p: OrgProject; acts: CorrienteActs; links: { idea: (key: string) => string; pedir: string } }) => {
  const f = useFicha(p.slug);
  const [allSaved, setAllSaved] = useState(false);
  if (f.isError) return <ReadError what="las ideas" onRetry={() => void f.refetch()} />;
  if (!f.data) return <div className="cor-skel" style={{ height: 300 }} aria-busy="true" aria-label="Leyendo las ideas" />;
  const rows = ideaRows(f.data.ideas, p.pedidos ?? []);
  const groups = (["nuevo", "avanza", "lista", "guardada"] as const).map((g) => ({ g, rows: rows.filter((r) => r.group === g) })).filter((x) => x.rows.length);
  return (
    <div className="cor-ideas" data-ideas={rows.length}>
      <div className="cor-pedidos-head" style={{ borderBottom: 0, paddingBottom: 0 }}>
        <p className="cor-text" style={{ maxWidth: 720 }}>
          Cada idea avanza sola por sus seis paradas. Con un punto blanco, lo que el equipo ya entregó y todavía no has visto; nada se detiene si no lo ves.
        </p>
        <Link className="cor-btn secondary" to={links.pedir} data-control="pedir-idea">
          Pedir una idea
        </Link>
      </div>
      <div className="cor-prow-head ideas" aria-hidden>
        <span className="cor-label">Idea</span>
        {STOPS.map((s) => (
          <span key={s.id} className="cor-label">
            {s.name}
          </span>
        ))}
        <span className="cor-label">Quién la tiene</span>
      </div>
      {rows.length === 0 ? (
        <p className="cor-empty cor-text" data-sin-ideas>
          Todavía no hay ideas. Pide una con «Darle forma» y aparece aquí, parada por parada.
        </p>
      ) : (
        <div className="cor-ideas-list">
          {groups.map(({ g, rows: rs }) => {
            const shown = g === "guardada" && !allSaved ? rs.slice(0, 1) : rs;
            return (
              <section key={g} aria-label={GROUP_NAME[g]} data-group={g}>
                <div className="cor-ideas-g">
                  <Label as="h2">{g === "guardada" ? `${GROUP_NAME[g]} · ${rs.length}` : GROUP_NAME[g]}</Label>
                  {g === "guardada" && rs.length > 1 && (
                    <Btn kind="link" onClick={() => setAllSaved((x) => !x)}>
                      {allSaved ? "Ver menos" : "Ver todas las guardadas"}
                    </Btn>
                  )}
                </div>
                <ul>
                  {shown.map((r) => {
                    const quiet = r.pedido?.state === "quieta" && r.stop !== "lista" && r.group !== "guardada";
                    return (
                      <li key={r.key} className="cor-plane idea" data-idea-row={r.key}>
                        <Link className="cor-plane-name" to={links.idea(r.key)}>
                          <b className="cor-ellipsis">{r.title}</b>
                          <span className="cor-cap">{[r.key, STOPS.find((s) => s.id === r.stop)?.name, r.unseen ? `${r.unseen} sin ver` : null].filter(Boolean).join(" · ").toUpperCase()}</span>
                        </Link>
                        <Journey r={r} />
                        <span className="cor-idea-who cor-ellipsis">{r.group === "guardada" ? "Fuera de la corriente" : r.stop === "lista" && !r.who.startsWith("Ya es") ? "Espera tu «Constrúyelo»" : quiet ? "Nadie la trabaja" : r.who || "En camino"}</span>
                        {r.group === "guardada" ? (
                          <Btn kind="secondary" onClick={() => acts.pedido(p.slug, r.key, "restaurar")} disabled={acts.busy === `pedido-${r.key}:restaurar`} data-control="restaurar">
                            Restaurar
                          </Btn>
                        ) : r.stop === "lista" && r.pedido && !r.who.startsWith("Ya es") ? (
                          <Btn kind="secondary" onClick={() => acts.pedido(p.slug, r.key, "construir")} disabled={acts.busy === `pedido-${r.key}:construir`} data-control="construyelo">
                            Constrúyelo
                          </Btn>
                        ) : quiet ? (
                          <Btn kind="secondary" onClick={() => acts.despertar(p.slug, r.key)} disabled={acts.busy === `pedido-${r.key}:despertar`} data-control="despertar">
                            Despertar
                          </Btn>
                        ) : (
                          <Link className="cor-btn quiet" to={links.idea(r.key)} data-control="abrir">
                            Abrir ›
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const Disenos = ({ p, links }: { p: OrgProject; links: { idea: (key: string) => string } }) => {
  const f = useFicha(p.slug);
  if (f.isError) return <ReadError what="los diseños" onRetry={() => void f.refetch()} />;
  if (!f.data) return <div className="cor-skel" style={{ height: 300 }} aria-busy="true" aria-label="Leyendo los diseños" />;
  const lienzos = f.data.lienzos ?? [];
  const aparte = f.data.designs;
  const title = (key: string) => f.data!.ideas.find((i) => i.key === key)?.title ?? key;
  return (
    <div className="cor-disenos" data-disenos={lienzos.length}>
      <p className="cor-text">Los lienzos de Artist, uno por idea. Ábrelo para ver los marcos grandes y dejar notas sobre ellos.</p>
      {lienzos.length === 0 && aparte.length === 0 ? (
        <p className="cor-empty cor-text" data-sin-disenos>
          Todavía no hay diseños. Cuando Artist entregue los marcos de una idea, aparecen aquí.
        </p>
      ) : (
        <ul className="cor-gallery">
          {lienzos.slice(0, 8).map((l) => (
            <li key={l.key}>
              <Link className="cor-card cor-lienzo" to={links.idea(l.key)} data-lienzo={l.key}>
                <span className="cor-lienzo-thumbs">
                  {[0, 1, 2].map((i) => (l.thumbs[i] ? <img key={i} src={l.thumbs[i]} alt="" loading="lazy" /> : <span key={i} />))}
                </span>
                <b className="cor-ellipsis">{l.title}</b>
                <span className="cor-lienzo-foot">
                  <span className="cor-cap">{`${l.key} · ${l.count} ${l.count === 1 ? "marco" : "marcos"}`}</span>
                  {l.unseen > 0 ? (
                    <span className="cor-state live">
                      <span className="cor-unseen" aria-hidden /> Sin ver
                    </span>
                  ) : (
                    <State>Visto</State>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {aparte.length > 0 && (
        <section aria-label="Lienzos que se abren aparte">
          <Label as="h2">Lienzos que se abren aparte</Label>
          <ul>
            {aparte.map((x) => (
              <li key={x.url}>
                <a className="cor-row" href={x.url} target="_blank" rel="noreferrer">
                  <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                    <b style={{ fontWeight: 500 }}>{title(x.idea_key)}</b>
                    <span className="cor-cap">{`LIENZO · ${x.idea_key}`}</span>
                  </span>
                  <span className="cor-btn link">Abrir el lienzo ↗</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export const Prs = ({ p, decisions, open, links }: { p: OrgProject; decisions: Decision[]; open: number | null; links: { pr: (n: number) => string; paso: (key: string) => string; entrega: (d: Decision) => string } }) => {
  const f = useFicha(p.slug);
  if (f.isError) return <ReadError what="los PRs" onRetry={() => void f.refetch()} />;
  if (!f.data) return <div className="cor-skel" style={{ height: 300 }} aria-busy="true" aria-label="Leyendo los PRs" />;
  const prs = f.data.prs;
  const sel = prs.find((x) => x.number === open) ?? prs[0] ?? null;
  const openOnes = prs.filter((x) => x.state === "open" || (!x.merged_at && x.state !== "closed"));
  const merged = prs.filter((x) => !openOnes.includes(x));
  const waits = (key: string | null) => (key ? deliveryFor(key, decisions) : null);
  const row = (x: OrgFicha["prs"][number]) => {
    const d = waits(x.task_key);
    return (
      <li key={x.number}>
        <Link className="cor-prrow" to={links.pr(x.number)} aria-current={sel?.number === x.number ? "true" : undefined} data-pr={x.number}>
          <span className="cor-key">#{x.number}</span>
          <span className="cor-ellipsis">{x.title}</span>
          <span className="cor-cap">{x.task_key ?? "—"}</span>
          {d ? (
            <span className="cor-amber cor-prstate">
              <You small flat /> Te toca aceptarla
            </span>
          ) : (
            <span className="cor-prstate cor-body">{x.merged_at ? `Fusionado · ${dayOf(x.merged_at)}` : x.state === "closed" ? "Cerrado" : "Abierto"}</span>
          )}
        </Link>
      </li>
    );
  };
  const d = sel ? waits(sel.task_key) : null;
  return (
    <div className="cor-prs" data-prs={prs.length}>
      <div className="cor-prs-list">
        <div className="cor-prrow head" aria-hidden>
          <span className="cor-label">PR</span>
          <span className="cor-label">Título</span>
          <span className="cor-label">Paso</span>
          <span className="cor-label">Estado</span>
        </div>
        {prs.length === 0 ? (
          <p className="cor-empty cor-text" data-sin-prs>
            Todavía no hay PRs en este proyecto.
          </p>
        ) : (
          <>
            {openOnes.length > 0 && (
              <section aria-label="Abiertos">
                <Label as="h2">Abiertos</Label>
                <ul>{openOnes.slice(0, 6).map(row)}</ul>
              </section>
            )}
            {merged.length > 0 && (
              <section aria-label="Fusionados">
                <Label as="h2">Fusionados</Label>
                <ul>{merged.slice(0, openOnes.length ? 4 : 8).map(row)}</ul>
              </section>
            )}
          </>
        )}
      </div>
      {sel && (
        <aside className="cor-card cor-prdetail" aria-label={`PR #${sel.number}`} data-pr-detail={sel.number}>
          <Label>{`PR #${sel.number} · ${sel.merged_at ? "fusionado" : sel.state === "closed" ? "cerrado" : "abierto"}`}</Label>
          <h2 className="cor-h3">{sel.title}</h2>
          {d && (
            <p className="cor-amber">
              <You small flat /> Te toca aceptar la entrega de {sel.task_key}.
            </p>
          )}
          <dl className="cor-ev">
            <div>
              <dt>Paso</dt>
              <dd style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {sel.task_key ? (
                  <>
                    <Key>{sel.task_key}</Key>
                    <Link className="cor-btn link" to={links.paso(sel.task_key)} style={{ marginLeft: "auto" }} data-control="ver-paso">
                      Ver el paso ›
                    </Link>
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>Rama</dt>
              <dd className="cor-mono">{sel.head_branch ?? "—"}</dd>
            </div>
            <div>
              <dt>Fusionado</dt>
              <dd>{sel.merged_at ? dayOf(sel.merged_at) : "Todavía no"}</dd>
            </div>
          </dl>
          <div className="cor-acts">
            {d && (
              <Link className="cor-btn primary" to={links.entrega(d)} data-control="ver-entrega">
                Ver la entrega
              </Link>
            )}
            <a className="cor-btn secondary" href={sel.url} target="_blank" rel="noreferrer" data-control="github">
              Abrir en GitHub ↗
            </a>
          </div>
        </aside>
      )}
    </div>
  );
};

export const Docs = ({ p, open, links }: { p: OrgProject; open: string | null; links: { doc: (id: string) => string; iniciativa: (key: string) => string } }) => {
  const f = useFicha(p.slug);
  const docs = f.data?.docs ?? [];
  const sel = docs.find((x) => x.id === open) ?? docs[0] ?? null;
  const body = useQuery({ queryKey: ["ficha-doc", p.slug, sel?.id], queryFn: () => api.projectDoc(p.slug, sel!.id), enabled: !!sel });
  const [others, setOthers] = useState(false);
  if (f.isError) return <ReadError what="los docs" onRetry={() => void f.refetch()} />;
  if (!f.data) return <div className="cor-skel" style={{ height: 300 }} aria-busy="true" aria-label="Leyendo los docs" />;
  // Grouped by initiative: the open one's first, then the project's own docs.
  const groups = new Map<string, typeof docs>();
  for (const d of docs) groups.set(d.task_key ?? "", [...(groups.get(d.task_key ?? "") ?? []), d]);
  const keys = [...groups.keys()].sort((a, b) => (a === (sel?.task_key ?? "") ? -1 : b === (sel?.task_key ?? "") ? 1 : a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  const shownKeys = others ? keys : keys.slice(0, 2);
  return (
    <div className="cor-docs" data-docs={docs.length}>
      <nav className="cor-docs-list" aria-label="Docs del proyecto">
        {docs.length === 0 && (
          <p className="cor-text" data-sin-docs>
            Todavía no hay docs.
          </p>
        )}
        {shownKeys.map((k) => (
          <section key={k || "proyecto"}>
            <Label as="h2">{k ? `De ${k}` : "Del proyecto"}</Label>
            <ul>
              {groups
                .get(k)!
                .slice(0, 5)
                .map((d) => (
                  <li key={d.id}>
                    <Link className="cor-docrow" to={links.doc(d.id)} aria-current={sel?.id === d.id ? "true" : undefined} data-doc={d.id}>
                      <b className="cor-ellipsis">{d.title}</b>
                      <span className="cor-cap">{`${k || "del proyecto"} · ${dayOf(d.updated_at)}`.toUpperCase()}</span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
        {keys.length > 2 && (
          <Btn kind="link" onClick={() => setOthers((x) => !x)}>
            {others ? "Ver menos" : "Ver los de otras iniciativas"}
          </Btn>
        )}
      </nav>
      {sel && (
        <article className="cor-card cor-docview" aria-label={sel.title} data-doc-open={sel.id}>
          <div className="cor-docview-head">
            <span>
              <Label>{`Doc${sel.task_key ? ` de ${sel.task_key}` : ""}${body.data ? ` · v${body.data.version}` : ""} · ${dayOf(sel.updated_at)}`}</Label>
              <h2 className="cor-h2">{sel.title}</h2>
            </span>
            {sel.task_key && (
              <Link className="cor-btn secondary" to={links.iniciativa(sel.task_key)} data-control="ver-iniciativa">
                Ver la iniciativa ›
              </Link>
            )}
          </div>
          <div className="cor-md cor-docbody" data-doc-body tabIndex={0} role="region" aria-label={`Texto de ${sel.title}`}>
            {body.isError ? <ReadError what="el doc" onRetry={() => void body.refetch()} /> : body.data ? <Markdown remarkPlugins={[remarkGfm]}>{body.data.markdown}</Markdown> : <div className="cor-skel" style={{ height: 200 }} />}
          </div>
        </article>
      )}
    </div>
  );
};
