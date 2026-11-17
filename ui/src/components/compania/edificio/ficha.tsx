// PLA-I47-4: La ficha (Design frame 8). The card beside the floor: tabs Resumen, Ideas, Diseño, PRs and Docs, and
// the detail of whatever was clicked in their place, with a way back. Presentational and hook-free: the page reads
// (only what the open view needs: lib/ficha.ts needsRows, needsTask) and passes the reads in as loads, and what it
// already draws elsewhere (a teammate, the plan, Sumar, the app, Solo tú, Lo último) as slots.
import type { CSSProperties, ReactNode } from "react";
import Markdown from "react-markdown";
import type { FichaDoc, FichaIdea, FichaPr, OrgFicha, OrgProject, PedidoDetail, ProjectDocBody, ProjectTicket } from "@/lib/api";
import { PedidoTab, type PedidoActs, type PedidoSlots } from "./pedido";
import { pedidoWord, stopName } from "./tubo";
import { floorHue } from "@/lib/edificio";
import { FICHA_TABS, TAB_WORD, tabOf, type FichaRef, type FichaTab } from "@/lib/ficha";
import type { TaskDetail } from "@/lib/types";
import { rumboText } from "@/lib/v2";
import { columnOf, isDone, wordOf, whoLine, ciWord, STATIONS } from "@/lib/etapas";
import { ZonaTags } from "@/components/plan/zona-tags";

export type Load<T> = { status: "idle" | "loading" | "error" | "ok"; data?: T; retry?: () => void };
export type FichaSlots = { member?: ReactNode; plan?: ReactNode; sumar?: ReactNode; app?: ReactNode; solo?: ReactNode; last?: ReactNode; maq?: ReactNode };

const STAGES = ["idea", "research", "design", "planning", "ready"] as const;
const STAGE_WORD: Record<string, string> = { idea: "Idea", research: "Investigación", design: "Diseño", planning: "Planeación", ready: "Lista" };
const PR_STATE: Record<string, string> = { open: "Abierto", merged: "Fusionado", closed: "Cerrado" };
const CI_WORD: Record<string, string> = { success: "pruebas en verde", failure: "pruebas fallan", pending: "pruebas corriendo", none: "sin pruebas" };
const day = (iso: string, timeZone?: string) => new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone }).format(new Date(iso));

const Sec = ({ title, children, data }: { title: string; children: ReactNode; data?: string }) => (
  <section className="edi-fi-sec" data-fi-sec={data}>
    <h4 className="edi-eyebrow">{title}</h4>
    {children}
  </section>
);

// Loading, error and empty, the same in every tab and detail.
function whenLoaded<T>(load: Load<T>, what: string, draw: (d: T) => ReactNode): ReactNode {
  if (load.status === "error")
    return (
      <div className="edi-fi-state" data-state="error">
        <p>No se pudo leer {what}.</p>
        {load.retry && (
          <button type="button" className="edi-btn" onClick={load.retry} data-control="ficha-reintentar">
            Reintentar
          </button>
        )}
      </div>
    );
  if (load.status !== "ok" || load.data === undefined)
    return (
      <div className="edi-fi-state" data-state="loading" aria-busy="true">
        <span className="edi-sk" />
        <span className="edi-sk" />
        <span className="edi-sk" />
      </div>
    );
  return draw(load.data);
}
const Empty = ({ children }: { children: ReactNode }) => (
  <p className="edi-fi-empty" data-state="empty">
    {children}
  </p>
);

const Li = ({ onClick, lead, title, sub, tail, data }: { onClick: () => void; lead?: ReactNode; title: string; sub?: string; tail?: string; data: string }) => (
  <li>
    <button type="button" className="edi-fi-li" onClick={onClick} title={title} data-fi-row={data}>
      {lead !== undefined && <span className="edi-fi-num">{lead}</span>}
      <span className="edi-ftx">
        <b>{title}</b>
        {sub && <small>{sub}</small>}
      </span>
      {tail && <em>{tail}</em>}
    </button>
  </li>
);

// ---- the tabs

const Resumen = ({ p, onRef, slots }: { p: OrgProject; onRef: (r: FichaRef) => void; slots: FichaSlots }) => {
  const r = rumboText(p);
  const ojo = [p.light_reason && p.light !== "ok" && p.light !== "needs_jorge" ? p.light_reason.text : null, ...(p.stale_requests ?? []).map((s) => `Nadie tomó «${s.title}»`)].filter((x): x is string => !!x);
  return (
    <>
      <Sec title="Rumbo" data="rumbo">
        <p className="edi-fi-p">{r.goal ?? "Sin meta todavía."}</p>
        {r.date && (
          <p className="edi-fi-p" data-fi-date>
            Entrega <b>{r.date}</b>
            {r.forecast && <> · {r.forecast.text}</>}
          </p>
        )}
        {p.plan?.today_pct != null && p.plan.done_pct != null && (
          <span className="edi-fi-cal" aria-hidden>
            <i style={{ width: `${p.plan.done_pct}%` }} />
            <u style={{ left: `${p.plan.today_pct}%` }} />
          </span>
        )}
      </Sec>
      <Sec title="Esta semana" data="semana">
        <div className="edi-fi-stats">
          <div>
            <b>{p.this_week.done}</b>
            <span>pasos</span>
          </div>
          <div>
            <b>{p.this_week.prs}</b>
            <span>PRs</span>
          </div>
          <div>
            <b>{p.this_week.docs}</b>
            <span>docs</span>
          </div>
        </div>
      </Sec>
      {ojo.length > 0 && (
        <Sec title="Ojo" data="ojo">
          <ul className="edi-fi-ojo">
            {ojo.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </Sec>
      )}
      {slots.solo}
      {slots.last}
      <div className="edi-fi-acts">
        <button type="button" className="edi-btn" onClick={() => onRef({ kind: "plan" })} data-control="ficha-plan">
          El plan
        </button>
        <button type="button" className="edi-btn" onClick={() => onRef({ kind: "app" })} data-control="ficha-app">
          La app
        </button>
      </div>
    </>
  );
};

// PLA-I54-3: the Pedido tab: the requests taking shape (the tube's capsules) and the shelf. A row opens the request.
const PedidoList = ({ p, onRef, shelf }: { p: OrgProject; onRef: (r: FichaRef) => void; shelf?: boolean }) => {
  const all = p.pedidos ?? [];
  const list = all.filter((x) => !!x.guardada === !!shelf);
  const saved = all.filter((x) => x.guardada).length;
  return (
    <>
      {shelf && <Title eyebrow="Pedidos" title="Guardadas" state="Ideas que apartaste. No se pierden y nadie las trabaja." />}
      {list.length === 0 ? (
        <Empty>{shelf ? "Ninguna guardada." : "Ningún pedido tomando forma. Pide algo con «Darle forma» y toca su cápsula en el tubo."}</Empty>
      ) : (
        <ul className="edi-fi-lis" data-fi-list={shelf ? "guardadas" : "pedido"}>
          {list.map((x) => (
            <Li key={x.key} onClick={() => onRef({ kind: "pedido", key: x.key })} title={x.title} sub={shelf ? `Guardada · ${stopName(x.stop)}` : `${pedidoWord(x)} · ${stopName(x.stop)}`} tail={x.key} data={x.key} />
          ))}
        </ul>
      )}
      {!shelf && saved > 0 && (
        <div className="edi-fi-acts">
          <button type="button" className="edi-btn" onClick={() => onRef({ kind: "guardadas" })} data-control="ficha-guardadas">
            Guardadas · {saved}
          </button>
        </div>
      )}
    </>
  );
};

const ideaLine = (i: FichaIdea) => `${STAGE_WORD[i.stage ?? "idea"] ?? i.stage}${i.waits ? ` · ${i.waits}` : ""}`;
const prLine = (pr: FichaPr) => [PR_STATE[pr.state] ?? pr.state, pr.ci_state ? CI_WORD[pr.ci_state] : null].filter(Boolean).join(" · ");
const docLine = (d: FichaDoc, timeZone?: string) => `${d.task_key ?? "del proyecto"} · ${day(d.updated_at, timeZone)}`;

const ListTab = ({ tab, rows, onRef, timeZone }: { tab: Exclude<FichaTab, "resumen">; rows: Load<OrgFicha>; onRef: (r: FichaRef) => void; timeZone?: string }) =>
  whenLoaded(rows, "la ficha", (f) => {
    if (tab === "ideas")
      return f.ideas.length === 0 ? (
        <Empty>No hay ideas abiertas.</Empty>
      ) : (
        <ul className="edi-fi-lis">
          {f.ideas.map((i) => (
            <Li key={i.key} data={i.key} title={i.title} sub={ideaLine(i)} onClick={() => onRef({ kind: "idea", key: i.key })} />
          ))}
        </ul>
      );
    if (tab === "diseno")
      return f.designs.length === 0 ? (
        <Empty>Ninguna idea tiene lienzo todavía.</Empty>
      ) : (
        <ul className="edi-fi-lis">
          {f.designs.map((d) => (
            <Li key={d.url} data={d.url} title={f.ideas.find((i) => i.key === d.idea_key)?.title ?? "Lienzo"} sub={`Lienzo · ${d.idea_key}`} onClick={() => onRef({ kind: "lienzo", url: d.url })} />
          ))}
        </ul>
      );
    if (tab === "prs")
      return f.prs.length === 0 ? (
        <Empty>Este proyecto no tiene PRs.</Empty>
      ) : (
        <ul className="edi-fi-lis">
          {f.prs.map((pr) => (
            <Li key={pr.number} data={`pr-${pr.number}`} lead={`#${pr.number}`} title={pr.title || `PR #${pr.number}`} sub={prLine(pr)} onClick={() => onRef({ kind: "pr", n: pr.number })} />
          ))}
        </ul>
      );
    return f.docs.length === 0 ? (
      <Empty>Este proyecto no tiene docs.</Empty>
    ) : (
      <ul className="edi-fi-lis">
        {f.docs.map((d) => (
          <Li key={d.id} data={d.id} title={d.title} sub={docLine(d, timeZone)} onClick={() => onRef({ kind: "doc", id: d.id })} />
        ))}
      </ul>
    );
  });

// ---- the details

const Title = ({ eyebrow, title, state }: { eyebrow: string; title: string; state?: ReactNode }) => (
  <header className="edi-fi-head">
    <p className="edi-eyebrow">{eyebrow}</p>
    <h3 className="edi-fi-title">{title}</h3>
    {state && <p className="edi-fi-state-line">{state}</p>}
  </header>
);

const TaskBody = ({ t, onRef, timeZone }: { t: TaskDetail; onRef: (r: FichaRef) => void; timeZone?: string }) => (
  <>
    {t.checks.length > 0 && (
      <Sec title="Hecho cuando" data="checks">
        <ul className="edi-fi-checks">
          {t.checks.map((c) => (
            <li key={c.n} data-ok={c.done ? "" : undefined}>
              {c.text}
            </li>
          ))}
        </ul>
      </Sec>
    )}
    {t.results.length > 0 && (
      <Sec title="Evidencia" data="evidencia">
        <ul className="edi-fi-ev">
          {t.results.slice(-3).map((r) => (
            <li key={r.id} data-verdict={r.verdict}>
              <i aria-hidden>{r.verdict === "pass" ? "✓" : r.verdict === "fail" ? "✕" : "!"}</i>
              <span>{r.cite}</span>
            </li>
          ))}
        </ul>
      </Sec>
    )}
    {(t.pr?.url || t.pr_url) && (
      <Sec title="PR" data="pr">
        <a className="edi-fi-link" href={t.pr?.url ?? t.pr_url!} target="_blank" rel="noreferrer">
          {t.pr?.number ? `PR #${t.pr.number}` : "Ver el PR"} ↗
        </a>
      </Sec>
    )}
    {t.docs.length > 0 && (
      <Sec title="Docs" data="docs">
        <ul className="edi-fi-lis">
          {t.docs.map((d) => (
            <Li key={d.id} data={d.id} title={d.title} sub={`v${d.version}`} onClick={() => onRef({ kind: "doc", id: d.id })} />
          ))}
        </ul>
      </Sec>
    )}
    {t.log.length > 0 && (
      <Sec title="Historia" data="historia">
        <ul className="edi-fi-hist">
          {t.log.slice(-5).reverse().map((e) => (
            <li key={e.id}>
              <span>{day(e.at, timeZone)}</span>
              {e.type.replace(/^task\./, "").replace(/_/g, " ")}
            </li>
          ))}
        </ul>
      </Sec>
    )}
  </>
);

// PLA-I53-3: a ticket's stage as the board says it: the word, who has it and since when, the PR checks, the why.
const ticketOf = (p: OrgProject, key: string): ProjectTicket | null =>
  p.tablero ? ([...p.tablero.initiatives.flatMap((i) => i.tickets), ...p.tablero.loose].find((x) => x.key === key) ?? null) : null;
const StageLine = ({ p, k, fallback, now }: { p: OrgProject; k: string; fallback: string; now: number }) => {
  const t = ticketOf(p, k);
  if (!t) return <>{fallback}</>;
  const e = t.etapa;
  const station = STATIONS.find((s) => s.id === columnOf(e))?.name;
  const bits = [whoLine(e, now), ciWord(e.ci)].filter(Boolean).join(" · ");
  return (
    <span data-fi-etapa={e.etapa}>
      <b>{wordOf(e)}</b>
      {station && ` · ${station}`}
      {bits && ` · ${bits}`}
      {t.zonas && t.zonas.length > 0 && <> · <ZonaTags zonas={t.zonas} /></>}
      {e.reason && <span className="edi-fi-why">{e.reason}</span>}
    </span>
  );
};
// Open tickets first (in the board's order), then the done ones newest first: every one opens its own detail.
const TicketLists = ({ tickets, now, onRef }: { tickets: ProjectTicket[]; now: number; onRef: (r: FichaRef) => void }) => {
  const open = tickets.filter((t) => !isDone(t.etapa));
  const done = tickets.filter((t) => isDone(t.etapa)).sort((a, b) => Date.parse(b.etapa.since ?? "0") - Date.parse(a.etapa.since ?? "0"));
  const row = (t: ProjectTicket) => <Li key={t.key} data={t.key} title={t.title} sub={[t.key, wordOf(t.etapa), whoLine(t.etapa, now)].filter(Boolean).join(" · ")} onClick={() => onRef({ kind: "step", key: t.key })} />;
  return (
    <>
      {open.length > 0 && (
        <Sec title="Abiertos" data="abiertos">
          <ul className="edi-fi-lis">{open.map(row)}</ul>
        </Sec>
      )}
      {done.length > 0 && (
        <Sec title={`Hechos · ${done.length}`} data="hechos">
          <ul className="edi-fi-lis">{done.map(row)}</ul>
        </Sec>
      )}
      {open.length === 0 && done.length === 0 && <Empty>Todavía no tiene pasos.</Empty>}
    </>
  );
};

type PedidoProps = { pedido?: Load<PedidoDetail>; pedidoActs?: PedidoActs; pedidoSlots?: PedidoSlots };
const Detail = ({ p, r, rows, task, doc, onRef, slots, now, timeZone, pedido, pedidoActs, pedidoSlots }: { p: OrgProject; r: Exclude<FichaRef, { kind: "tab" }>; rows: Load<OrgFicha>; task: Load<TaskDetail>; doc: Load<ProjectDocBody>; onRef: (r: FichaRef) => void; slots: FichaSlots; now: number; timeZone?: string } & PedidoProps) => {
  switch (r.kind) {
    // PLA-I54-3: one request of the owner's, and the shelf.
    case "pedido":
      return whenLoaded(pedido ?? { status: "loading" }, "el pedido", (d) => <PedidoTab d={d} now={now} timeZone={timeZone} acts={{ ...pedidoActs, onDoc: (id) => onRef({ kind: "doc", id }) }} slots={pedidoSlots} />);
    case "guardadas":
      return <PedidoList p={p} onRef={onRef} shelf />;
    case "step":
      return whenLoaded(task, "el paso", (t) => (
        <>
          <Title eyebrow={`Paso · ${t.key}`} title={t.title} state={<StageLine p={p} k={t.key} fallback={t.status} now={now} />} />
          <TaskBody t={t} onRef={onRef} timeZone={timeZone} />
        </>
      ));
    case "idea":
      return whenLoaded(task, "la idea", (t) => {
        const row = rows.data?.ideas.find((i) => i.key === r.key);
        const here = STAGES.indexOf((t.stage ?? "idea") as (typeof STAGES)[number]);
        return (
          <>
            <Title eyebrow="Idea" title={t.title} state={row?.waits ?? t.waits ?? undefined} />
            <ol className="edi-fi-tube" aria-label="Etapas">
              {STAGES.map((s, i) => (
                <li key={s} data-on={i <= here ? "" : undefined} data-here={i === here ? "" : undefined}>
                  <i aria-hidden />
                  <span>{STAGE_WORD[s]}</span>
                </li>
              ))}
            </ol>
            <TaskBody t={t} onRef={onRef} timeZone={timeZone} />
          </>
        );
      });
    case "leg": {
      // PLA-I53-3: an open initiative lists its tickets by stage from the board's read; a completed one says so.
      const ini = p.tablero?.initiatives.find((i) => i.key === r.key);
      const leg = p.route?.legs.find((l) => l.key === r.key);
      if (ini)
        return (
          <>
            <Title eyebrow={`Iniciativa · ${ini.key}`} title={ini.title} state={`${ini.done} de ${ini.total} hechos${ini.status === "On hold" ? " · en pausa" : ""}`} />
            <TicketLists tickets={ini.tickets} now={now} onRef={onRef} />
          </>
        );
      const closed = p.tablero?.done_initiatives?.find((i) => i.key === r.key);
      if (!leg && closed)
        return (
          <>
            <Title eyebrow={`Iniciativa · ${closed.key}`} title={closed.title} state={closed.done_at ? `Completa · ${day(closed.done_at, timeZone)}` : "Completa"} />
            <Empty>Está completa: sus pasos ya no están en el tablero.</Empty>
          </>
        );
      if (!leg) return <Empty>Esa iniciativa ya no está en el plan.</Empty>;
      const complete = leg.state === "done" || (leg.total > 0 && leg.done === leg.total);
      return (
        <>
          <Title eyebrow={`Iniciativa · ${leg.key}`} title={leg.title} state={`${complete ? "Completa · " : ""}${leg.done} de ${leg.total} hechos`} />
          <Empty>{complete ? "Está completa: sus pasos ya no están en el tablero." : "Este piso todavía no trae los pasos de esta iniciativa."}</Empty>
        </>
      );
    }
    case "sueltos": {
      const t = p.tablero;
      if (!t) return <Empty>Este piso todavía no trae su tablero.</Empty>;
      return (
        <>
          <Title eyebrow="Sueltos" title="Trabajo sin iniciativa" state={`${t.loose.length} abiertos · ${t.loose_done} hechos`} />
          <TicketLists tickets={t.loose} now={now} onRef={onRef} />
          {t.loose_done > 0 && <Empty>{`${t.loose_done === 1 ? "1 suelto hecho" : `${t.loose_done} sueltos hechos`}${t.loose_done_title ? `; el último: «${t.loose_done_title}»` : ""}.`}</Empty>}
        </>
      );
    }
    case "pr":
      return whenLoaded(rows, "los PRs", (f) => {
        const pr = f.prs.find((x) => x.number === r.n);
        if (!pr) return <Empty>Ese PR ya no está en la lista.</Empty>;
        return (
          <>
            <Title eyebrow={`PR #${pr.number}`} title={pr.title || `PR #${pr.number}`} state={prLine(pr)} />
            <dl className="edi-fi-kv">
              {pr.head_branch && (
                <>
                  <dt>Rama</dt>
                  <dd>{pr.head_branch}</dd>
                </>
              )}
              {pr.merged_at && (
                <>
                  <dt>Fusionado</dt>
                  <dd>{day(pr.merged_at, timeZone)}</dd>
                </>
              )}
            </dl>
            <div className="edi-fi-acts">
              <a className="edi-btn edi-fi-ext" href={pr.url} target="_blank" rel="noreferrer">
                Abrir en GitHub ↗
              </a>
              {pr.task_key && (
                <button type="button" className="edi-btn" onClick={() => onRef({ kind: "step", key: pr.task_key! })} data-control="ficha-pr-paso">
                  Ver el paso
                </button>
              )}
            </div>
          </>
        );
      });
    case "doc":
      return whenLoaded(doc, "el doc", (d) => (
        <>
          <Title eyebrow={d.task_key ? `Doc de ${d.task_key}` : "Doc del proyecto"} title={d.title} state={`v${d.version}`} />
          <div className="edi-fi-md">
            <Markdown>{d.markdown}</Markdown>
          </div>
        </>
      ));
    case "lienzo": {
      const d = rows.data?.designs.find((x) => x.url === r.url);
      return (
        <>
          <Title eyebrow="Lienzo" title={(d && rows.data?.ideas.find((i) => i.key === d.idea_key)?.title) ?? "Lienzo de diseño"} state={d ? `De ${d.idea_key}` : undefined} />
          <div className="edi-fi-acts">
            <a className="edi-btn edi-fi-ext" href={r.url} target="_blank" rel="noreferrer" data-control="ficha-lienzo-abrir">
              Abrir el lienzo ↗
            </a>
            {d && (
              <button type="button" className="edi-btn" onClick={() => onRef({ kind: "doc", id: d.doc_id })}>
                Ver el doc Design
              </button>
            )}
          </div>
        </>
      );
    }
    case "member":
      return slots.member ?? <Empty>Esa persona ya no está en el equipo.</Empty>;
    case "plan":
      return (
        <>
          <Title eyebrow="El plan" title={p.title} />
          {slots.plan ?? <Empty>Sin plan.</Empty>}
        </>
      );
    case "sumar":
      return (
        <>
          <Title eyebrow="Sumar al equipo" title={p.title} />
          {slots.sumar ?? <Empty>El equipo está completo.</Empty>}
        </>
      );
    case "app":
      return (
        <>
          <Title eyebrow="La app" title={p.title} />
          {slots.app ?? <Empty>Este proyecto no tiene app que mirar.</Empty>}
        </>
      );
    // PLA-I48-5/6: the Máquinas kinds are drawn by the page (maquinas-ficha.tsx), which holds their reads.
    case "maq":
    case "maq-tabla":
      return slots.maq ?? <Empty>Baja a Máquinas para ver esto.</Empty>;
  }
};

export const Ficha = ({
  project: p,
  fref,
  rows,
  task,
  doc,
  slots,
  now,
  timeZone,
  onRef,
  onClose,
  pedido,
  pedidoActs,
  pedidoSlots,
}: PedidoProps & {
  project: OrgProject;
  fref: FichaRef;
  rows: Load<OrgFicha>;
  task: Load<TaskDetail>;
  doc: Load<ProjectDocBody>;
  slots: FichaSlots;
  now: number;
  timeZone?: string;
  onRef: (r: FichaRef) => void;
  onClose: () => void;
}) => {
  const tab = tabOf(fref);
  const counts = rows.status === "ok" && rows.data ? rows.data.counts : null;
  const live = (p.pedidos ?? []).filter((x) => !x.guardada).length;
  const n: Partial<Record<FichaTab, number>> = { ...(counts ? { ideas: counts.ideas, diseno: counts.designs, prs: counts.prs, docs: counts.docs } : {}), ...(live ? { pedido: live } : {}) };
  return (
    // dark: the parts it borrows from the app (a teammate, the plan, Sumar) use the app's tokens; the card is a night
    // panel in both themes, like the question bubbles (PLA-I47-7).
    <aside className="dark edi-ficha" aria-label={`Ficha de ${p.title}`} data-ficha={fref.kind === "tab" ? fref.tab : fref.kind} style={{ "--c": floorHue(p.slug) } as CSSProperties}>
      <div className="edi-fi-top">
        <div className="edi-fi-tabs" role="tablist" aria-label="Ficha">
          {FICHA_TABS.map((t, i) => (
            <button key={t} type="button" role="tab" className="edi-fi-tab" aria-selected={t === tab} onClick={() => onRef({ kind: "tab", tab: t })} data-control={`ficha-tab-${t}`} aria-keyshortcuts={String(i + 1)}>
              {TAB_WORD[t]}
              {n[t] !== undefined && <small>{n[t]}</small>}
            </button>
          ))}
        </div>
        <button type="button" className="edi-fi-x" onClick={onClose} aria-label="Cerrar la ficha" aria-keyshortcuts="I" data-control="ficha-cerrar">
          ✕
        </button>
      </div>
      <div className="edi-fi-s" role="tabpanel">
        {fref.kind !== "tab" && (
          <button type="button" className="edi-fi-back" onClick={() => onRef({ kind: "tab", tab })} data-control="ficha-volver">
            ← {TAB_WORD[tab]}
          </button>
        )}
        {fref.kind === "tab" ? (
          fref.tab === "resumen" ? (
            <Resumen p={p} onRef={onRef} slots={slots} />
          ) : fref.tab === "pedido" ? (
            <PedidoList p={p} onRef={onRef} />
          ) : (
            <ListTab tab={fref.tab} rows={rows} onRef={onRef} timeZone={timeZone} />
          )
        ) : (
          <Detail p={p} r={fref} rows={rows} task={task} doc={doc} onRef={onRef} slots={slots} now={now} timeZone={timeZone} pedido={pedido} pedidoActs={pedidoActs} pedidoSlots={pedidoSlots} />
        )}
      </div>
    </aside>
  );
};
