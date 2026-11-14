// PLA-I47-4: La ficha (Design frame 8). The card beside the floor: tabs Resumen, Ideas, Diseño, PRs and Docs, and
// the detail of whatever was clicked in their place, with a way back. Presentational and hook-free: the page reads
// (only what the open view needs: lib/ficha.ts needsRows, needsTask) and passes the reads in as loads, and what it
// already draws elsewhere (a teammate, the plan, Sumar, the app, Solo tú, Lo último) as slots.
import type { CSSProperties, ReactNode } from "react";
import Markdown from "react-markdown";
import type { FichaDoc, FichaIdea, FichaPr, OrgFicha, OrgProject, ProjectDocBody } from "@/lib/api";
import { floorHue } from "@/lib/edificio";
import { FICHA_TABS, TAB_WORD, tabOf, type FichaRef, type FichaTab } from "@/lib/ficha";
import type { TaskDetail } from "@/lib/types";
import { rumboText } from "@/lib/v2";
import { Steps } from "./route";

export type Load<T> = { status: "idle" | "loading" | "error" | "ok"; data?: T; retry?: () => void };
export type FichaSlots = { member?: ReactNode; plan?: ReactNode; sumar?: ReactNode; app?: ReactNode; solo?: ReactNode; last?: ReactNode };

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
  const ojo = [p.light_reason && p.light !== "ok" ? p.light_reason.text : null, ...(p.stale_requests ?? []).map((s) => `Nadie tomó «${s.title}»`)].filter((x): x is string => !!x);
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

const Detail = ({ p, r, rows, task, doc, onRef, slots, now, timeZone }: { p: OrgProject; r: Exclude<FichaRef, { kind: "tab" }>; rows: Load<OrgFicha>; task: Load<TaskDetail>; doc: Load<ProjectDocBody>; onRef: (r: FichaRef) => void; slots: FichaSlots; now: number; timeZone?: string }) => {
  switch (r.kind) {
    case "step":
      return whenLoaded(task, "el paso", (t) => (
        <>
          <Title eyebrow="Paso" title={t.title} state={t.status} />
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
      const leg = p.route?.legs.find((l) => l.key === r.key);
      if (!leg) return <Empty>Esa entrega ya no está en la ruta.</Empty>;
      return (
        <>
          <Title eyebrow="Entrega" title={leg.title} state={`${leg.done} de ${leg.total} pasos${leg.note ? ` · ${leg.note}` : ""}`} />
          {leg.state === "here" ? <Steps project={p} now={now} timeZone={timeZone} /> : <Empty>Los pasos se ven cuando es la entrega en curso.</Empty>}
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
      return slots.plan ?? <Empty>Sin plan.</Empty>;
    case "sumar":
      return slots.sumar ?? <Empty>El equipo está completo.</Empty>;
    case "app":
      return slots.app ?? <Empty>Este proyecto no tiene app que mirar.</Empty>;
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
}: {
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
  const n: Partial<Record<FichaTab, number>> = counts ? { ideas: counts.ideas, diseno: counts.designs, prs: counts.prs, docs: counts.docs } : {};
  return (
    <aside className="edi-ficha" aria-label={`Ficha de ${p.title}`} data-ficha={fref.kind === "tab" ? fref.tab : fref.kind} style={{ "--c": floorHue(p.slug) } as CSSProperties}>
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
          ) : (
            <ListTab tab={fref.tab} rows={rows} onRef={onRef} timeZone={timeZone} />
          )
        ) : (
          <Detail p={p} r={fref} rows={rows} task={task} doc={doc} onRef={onRef} slots={slots} now={now} timeZone={timeZone} />
        )}
      </div>
    </aside>
  );
};
