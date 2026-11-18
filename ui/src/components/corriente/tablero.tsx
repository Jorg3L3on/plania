// PLA-I62-6: La corriente's own board (boards B3 and B6). It does not change components/plan/stage-board.tsx, which
// /p/<slug> keeps with its .sb-* classes; it reads the same model (lib/etapas.ts boardOf, cardActs). Flat stations
// (Por hacer, Taller, QA, Revisión, Te toca, Hecho), one row per open initiative and Sueltos; Detener on the card a
// run works on and Hacer primero on the one that waits sit on the card; the chosen card gets the one action bar
// (Aceptar, Ver la entrega, Ver el paso, Quitar). An initiative whose steps are all done offers Cerrar iniciativa.
// A paso's detail: Hecho cuando, the evidence, PR and docs, its history, and its initiative with Cerrar.
import { useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { toast } from "sonner";
import { ApiError, api, type Decision, type OrgProject, type ProjectTicket } from "@/lib/api";
import { OPEN_STATIONS, STATIONS, boardOf, cardActs, closeLine, deliveryFor, runOn, type CardAct, type StationId, type Track } from "@/lib/etapas";
import { ETAPA_WORD } from "@/lib/etapas";
import { acceptWords } from "@/lib/evidencia";
import type { LogEntry } from "@/lib/types";
import type { CorrienteActs } from "./acts";
import { PLAN_ASK } from "./ahora";
import { Agent, Btn, Key, Label, ReadError, State, You } from "./parts";

const SUB: Record<StationId, (n: number, lit: boolean) => string> = {
  por: () => "el PO ordena",
  taller: (n, lit) => (lit ? "trabajando" : n ? `${n} en espera` : "vacía"),
  qa: (n, lit) => (lit ? "probando" : n ? `${n} en espera` : "vacía"),
  rev: () => "PR y pruebas",
  toca: (n) => (n ? (n === 1 ? "1 te espera" : `${n} te esperan`) : "nada"),
  hecho: (n) => String(n),
};
const SHOWN = 2;

export type BoardLinks = { paso: (key: string) => string; iniciativa: (key: string) => string; entrega: (d: Decision) => string; sueltos: string; doc: (id: string) => string };

/** Close an initiative (PLA-I56-2): the server accepts it only when every step is Done and says what is open. */
export function useCerrar() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (v: { slug: string; key: string; version: number }) => api.patchTask(v.slug, v.key, { status: "Done", version: v.version }),
    onSuccess: (_r, v) => {
      toast("Iniciativa cerrada: ya está en Completas.");
      void client.invalidateQueries({ queryKey: ["company"] });
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["task", v.slug] });
    },
    onError: (e) => {
      const open = e instanceof ApiError && Array.isArray(e.detail?.open) ? (e.detail.open as string[]) : [];
      toast.error(
        e instanceof ApiError && e.code === "INITIATIVE_CHILDREN_OPEN"
          ? `Todavía no se puede cerrar: ${open.length === 1 ? "queda 1 paso abierto" : `quedan ${open.length} pasos abiertos`}${open.length ? ` (${open.join(", ")})` : ""}.`
          : e instanceof ApiError && e.code === "STALE_VERSION"
            ? "Cambió mientras la veías. Ya está al día: vuelve a intentarlo."
            : "No se pudo cerrar la iniciativa.",
      );
      void client.invalidateQueries({ queryKey: ["company"] });
    },
  });
}

export const run = (slug: string, a: CardAct, acts: CorrienteActs) => {
  if (a.kind === "primero") return acts.pickNext(slug, a.key);
  if (a.kind === "quitar") return acts.cancelOrder(slug, a.key);
  if (a.kind === "detener") return acts.stopRun(a.runId);
  return acts.decisions.decide(a.decision, { action: a.action }, "aceptar");
};
export const busyOf = (a: CardAct, acts: CorrienteActs) =>
  a.kind === "primero" ? acts.busy === `next-${a.key}` : a.kind === "quitar" ? acts.busy === `cancel-${a.key}` : a.kind === "detener" ? acts.busy === `stop-${a.runId}` : acts.decisions.busy?.id === a.decision.id;

const Card = ({ p, t, acts, list, chosen, onChoose, now }: { p: OrgProject; t: ProjectTicket; acts: CorrienteActs; list: CardAct[]; chosen: boolean; onChoose: () => void; now: number }) => {
  const e = t.etapa;
  const live = e.live || !!runOn(t.key, p.team);
  const you = e.etapa === "te_toca";
  const inline = list.filter((a) => a.kind === "detener" || a.kind === "primero");
  const mins = e.since && live ? Math.max(0, Math.round((now - Date.parse(e.since)) / 60_000)) : null;
  return (
    <div className={`cor-bcard ${live ? "live" : ""} ${you ? "you" : ""} ${chosen ? "chosen" : ""}`} data-card={t.key} data-etapa={e.etapa}>
      <button type="button" className="cor-bcard-main" aria-pressed={chosen} onClick={onChoose} aria-label={`${t.key} · ${t.title}, ${ETAPA_WORD[e.etapa]}`}>
        <span className="cor-bcard-st">
          {live ? <Agent small /> : you ? <You small flat /> : <i className="cor-ring" aria-hidden />}
          {chosen && you ? "Elegida · te toca" : `${ETAPA_WORD[e.etapa]}${mins !== null ? ` · ${mins} min` : ""}`}
        </span>
        <span className="cor-bcard-t">
          <Key>{t.key}</Key> <span>{t.title}</span>
        </span>
      </button>
      {inline.map((a) => (
        <Btn key={a.kind} kind="secondary" small disabled={busyOf(a, acts)} onClick={() => run(p.slug, a, acts)} data-control={`tablero-${a.kind}`} aria-label={`${a.kind === "detener" ? "Detener" : "Hacer primero"}: ${t.title}`}>
          {a.kind === "detener" ? "Detener" : "Hacer primero"}
        </Btn>
      ))}
    </div>
  );
};

const TrackRow = ({ p, tr, acts, decisions, chosen, onChoose, links, now, open, onOpen }: { p: OrgProject; tr: Track; acts: CorrienteActs; decisions: Decision[]; chosen: string | null; onChoose: (key: string) => void; links: BoardLinks; now: number; open: Set<string>; onOpen: (cell: string) => void }) => {
  const pct = tr.total ? Math.round((tr.done / tr.total) * 100) : 0;
  const counts = OPEN_STATIONS.map((s) => tr.cells[s.id as Exclude<StationId, "hecho">].length);
  const review = (tr.cells.rev?.length ?? 0) + (tr.cells.toca?.length ?? 0);
  return (
    <div className="cor-brow" data-track={tr.key ?? "sueltos"} role="group" aria-label={tr.title}>
      <Link className="cor-brow-name" to={tr.key ? links.iniciativa(tr.key) : links.sueltos}>
        {tr.key && <Key>{tr.key}</Key>}
        <b>{tr.title}</b>
        <span className="cor-cap">{tr.key ? `${review} en revisión · ${counts[0]} por hacer` : "pasos sin iniciativa"}</span>
        {tr.key && tr.total > 0 && (
          <span className="cor-segbar" aria-hidden style={{ "--n": tr.total } as CSSProperties}>
            {Array.from({ length: Math.min(tr.total, 12) }, (_, i) => (
              <i key={i} className={i < Math.round((pct / 100) * Math.min(tr.total, 12)) ? "on" : ""} />
            ))}
          </span>
        )}
      </Link>
      {OPEN_STATIONS.map((s) => {
        const cell = tr.cells[s.id as Exclude<StationId, "hecho">];
        const id = `${tr.key ?? "s"}:${s.id}`;
        const show = open.has(id) ? cell : cell.slice(0, SHOWN);
        return (
          <div key={s.id} className={`cor-bcell ${s.id}`} data-station={s.id}>
            {show.map((t) => (
              <Card key={t.key} p={p} t={t} acts={acts} list={cardActs(t, { team: p.team, decisions, orders: p.orders, nextFirst: p.next_first })} chosen={chosen === t.key} onChoose={() => onChoose(t.key)} now={now} />
            ))}
            {cell.length > SHOWN && (
              <Btn kind="link" onClick={() => onOpen(id)} data-control="ver-otros">
                {open.has(id) ? "Ver menos" : `Ver ${cell.length - SHOWN === 1 ? "el otro" : `los otros ${cell.length - SHOWN}`}`}
              </Btn>
            )}
          </div>
        );
      })}
      <div className="cor-bcell hecho" data-station="hecho">
        {tr.hecho.count > 0 && (
          <Link className="cor-cap" to={tr.key ? links.iniciativa(tr.key) : links.sueltos} title={tr.hecho.last ?? undefined}>
            {tr.hecho.count} {tr.hecho.count === 1 ? "hecho" : "hechos"}
          </Link>
        )}
      </div>
    </div>
  );
};

export const Board = ({ p, decisions, acts, links, now, chosenKey, onChoose }: { p: OrgProject; decisions: Decision[]; acts: CorrienteActs; links: BoardLinks; now: number; chosenKey: string | null; onChoose: (key: string | null) => void }) => {
  const t = p.tablero ?? { initiatives: [], loose: [], loose_done: 0 };
  const b = boardOf(t);
  const cerrar = useCerrar();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const all = [...t.initiatives.flatMap((i) => i.tickets), ...t.loose];
  // The chosen card: the address's, else the one that waits on the owner.
  const chosen = all.find((x) => x.key === chosenKey) ?? all.find((x) => x.etapa.etapa === "te_toca") ?? null;
  const live = b.tracks.filter((tr) => !(tr.key && tr.canClose));
  const closable = b.tracks.filter((tr) => tr.key && tr.canClose);
  const counts = (id: StationId) => (id === "hecho" ? b.tracks.reduce((n, tr) => n + tr.hecho.count, 0) : b.tracks.reduce((n, tr) => n + tr.cells[id as Exclude<StationId, "hecho">].length, 0));
  const acts4 = chosen ? cardActs(chosen, { team: p.team, decisions, orders: p.orders, nextFirst: p.next_first }) : [];
  const accept = acts4.find((a) => a.kind === "aceptar") as Extract<CardAct, { kind: "aceptar" }> | undefined;
  const quitar = acts4.find((a) => a.kind === "quitar");
  const d = chosen ? deliveryFor(chosen.key, decisions) : null;
  const empty = b.tickets === 0;
  const doneInits = t.done_initiatives ?? [];
  return (
    <div className="cor-board" data-board={b.tickets}>
      <div className="cor-bhead" aria-hidden>
        <span className="cor-label">Iniciativa</span>
        {STATIONS.map((s) => {
          const n = counts(s.id);
          const lit = b.lit[s.id];
          return (
            <span key={s.id} className={`cor-bstation ${s.id} ${lit ? "lit" : ""} ${s.id === "toca" && n ? "you" : ""}`}>
              <span className="cor-label">{s.name}</span>
              <span className="cor-cap">{SUB[s.id](n, !!lit)}</span>
            </span>
          );
        })}
      </div>
      <div className="cor-brows">
        {empty ? (
          <div className="cor-empty" data-board="empty">
            <p className="cor-text">{p.route && p.route.legs.length > 0 ? "No hay iniciativas abiertas ni pasos sueltos." : "Aún no hay plan: ninguna iniciativa abierta ni pasos sueltos."}</p>
            {!p.paused && !(p.route && p.route.legs.length > 0) && (
              <Btn kind="secondary" onClick={() => acts.plan(p.slug, PLAN_ASK)} disabled={acts.busy === `${p.slug}:plan`} data-control="planear">
                Arma el plan
              </Btn>
            )}
          </div>
        ) : (
          live.map((tr) => <TrackRow key={tr.key ?? "sueltos"} p={p} tr={tr} acts={acts} decisions={decisions} chosen={chosen?.key ?? null} onChoose={(k) => onChoose(k === chosen?.key ? null : k)} links={links} now={now} open={open} onOpen={(id) => setOpen((s) => new Set(s.has(id) ? [...s].filter((x) => x !== id) : [...s, id]))} />)
        )}
        {closable.map((tr) => (
          <div key={tr.key} className="cor-bclose" data-close={tr.key}>
            <span>
              <Key>{tr.key}</Key>
              <b>{tr.title}</b>
            </span>
            <span className="cor-text">Todos sus pasos están hechos. Cerrarla la pasa a Completas.</span>
            <Btn kind="secondary" disabled={cerrar.isPending || tr.version === null} onClick={() => cerrar.mutate({ slug: p.slug, key: tr.key!, version: tr.version! })} data-control="cerrar-iniciativa">
              {cerrar.isPending && cerrar.variables?.key === tr.key ? "Cerrando…" : "Cerrar iniciativa"}
            </Btn>
          </div>
        ))}
      </div>
      {doneInits.length > 0 && (
        <details className="cor-bdone">
          <summary className="cor-btn link">{`Iniciativas completas · ${doneInits.length}`}</summary>
          <ul>
            {doneInits.slice(0, 6).map((i) => (
              <li key={i.key}>
                <Key>{i.key}</Key> {i.title}
              </li>
            ))}
          </ul>
        </details>
      )}
      {chosen && (
        <div className={`cor-bbar ${chosen.etapa.etapa === "te_toca" ? "you" : ""}`} data-bar={chosen.key} role="region" aria-label={`Paso elegido: ${chosen.key}`}>
          {chosen.etapa.etapa === "te_toca" ? <You /> : <i className="cor-ring" aria-hidden />}
          <span className="cor-bbar-text">
            <span>
              <Key>{chosen.key}</Key> <b>{chosen.title}</b>
            </span>
            <span className="cor-cap">{chosen.etapa.etapa === "te_toca" ? (d?.hold ?? (accept ? acceptWords(accept.decision).hint : "Falta tu decisión.")) : ETAPA_WORD[chosen.etapa.etapa]}</span>
          </span>
          {accept && (
            <Btn kind="primary" disabled={busyOf(accept, acts) || !!accept.decision.hold} aria-label={acceptWords(accept.decision).aria} onClick={() => run(p.slug, accept, acts)} data-control="tablero-aceptar">
              Aceptar
            </Btn>
          )}
          {d && (
            <Link className="cor-btn secondary" to={links.entrega(d)} data-control="ver-entrega">
              Ver la entrega
            </Link>
          )}
          <Link className="cor-btn quiet" to={links.paso(chosen.key)} data-control="ver-paso">
            Ver el paso
          </Link>
          {quitar && (
            <Btn kind="quiet" disabled={busyOf(quitar, acts)} onClick={() => run(p.slug, quitar, acts)} data-control="tablero-quitar">
              Quitar
            </Btn>
          )}
        </div>
      )}
    </div>
  );
};

// ---- a paso and its initiative (board B6)

const RESULT_WORD = (v: string) => (v === "pass" ? ["Pasa", "ok"] : v === "fail" ? ["Falla", "bad"] : ["Aviso", undefined]) as [string, "ok" | "bad" | undefined];
function logLine(e: LogEntry): string {
  const p = e.payload ?? {};
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
  if (s("note")) return s("note")!;
  if (s("to")) return `Pasó a ${s("to")}`;
  if (s("status")) return `Pasó a ${s("status")}`;
  if (s("cite")) return s("cite")!;
  return e.type.replace(/^task\./, "").replace(/_/g, " ");
}
const dayOf = (iso: string) => new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(new Date(iso)).toUpperCase().replace(".", "");

const InitiativeCard = ({ p, k, onCerrar, busy, links, here }: { p: OrgProject; k: string; onCerrar: (version: number) => void; busy: boolean; links: BoardLinks; here: string | null }) => {
  const init = p.tablero?.initiatives.find((i) => i.key === k);
  if (!init) return null;
  const left = init.total - (init.closed ?? init.done);
  const tickets = init.tickets.slice(0, 5);
  return (
    <aside className="cor-card cor-initcard" aria-label={`Iniciativa ${k}`} data-iniciativa={k}>
      <Label>{`Iniciativa · ${k}`}</Label>
      <h2 className="cor-h3">{init.title}</h2>
      <span className="cor-text">{`${init.total - init.done} abiertos · ${init.done} de ${init.total} hechos`}</span>
      <span className="cor-segbar" aria-hidden>
        {Array.from({ length: Math.min(init.total, 12) }, (_, i) => (
          <i key={i} className={i < Math.round((init.done / Math.max(1, init.total)) * Math.min(init.total, 12)) ? "on" : ""} />
        ))}
      </span>
      <ul>
        {tickets.map((t) => (
          <li key={t.key}>
            <Link className="cor-row" to={links.paso(t.key)} aria-current={t.key === here ? "true" : undefined}>
              <Key>{t.key}</Key>
              <span className="cor-ellipsis" style={{ flex: 1 }}>
                {t.title}
              </span>
              <State>{ETAPA_WORD[t.etapa.etapa]}</State>
            </Link>
          </li>
        ))}
      </ul>
      {init.tickets.length > tickets.length && <span className="cor-cap">{`y ${init.tickets.length - tickets.length} más en el tablero`}</span>}
      <p className="cor-text">{init.can_close ? "Todos sus pasos están hechos: ciérrala y pasa a Completas." : `Le ${left === 1 ? "falta 1 paso" : `faltan ${left} pasos`} por terminar. Cuando todos estén hechos, aquí la cierras y pasa a Completas.`}</p>
      <Btn kind="secondary" disabled={!init.can_close || busy || init.version === undefined} onClick={() => init.version !== undefined && onCerrar(init.version)} data-control="cerrar-iniciativa">
        {busy ? "Cerrando…" : "Cerrar iniciativa"}
      </Btn>
    </aside>
  );
};

export const Paso = ({ p, k, links, back }: { p: OrgProject; k: string; links: BoardLinks; back: string }) => {
  const q = useQuery({ queryKey: ["task", p.slug, k], queryFn: () => api.task(p.slug, k) });
  const cerrar = useCerrar();
  const t = q.data;
  const all = [...(p.tablero?.initiatives.flatMap((i) => i.tickets) ?? []), ...(p.tablero?.loose ?? [])];
  const here = all.find((x) => x.key === k);
  const parent = t?.kind === "initiative" ? t.key : (t?.parent_key ?? here?.parent_key ?? null);
  return (
    <div className="cor-paso" data-paso={k}>
      <div className="cor-paso-main">
        <div className="cor-entrega-head">
          <Link to={back} className="cor-strip-back" data-control="volver-tablero">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9.5 3.5 5 8l4.5 4.5" />
            </svg>
            Tablero
          </Link>
          <span className="cor-label violet">{t?.kind === "initiative" ? "Iniciativa" : "Paso"} ·</span>
          <Key>{k}</Key>
          <h2 className="cor-ellipsis">{t?.title ?? here?.title ?? ""}</h2>
          {here && <span className="cor-state" style={{ marginLeft: "auto" }}>{ETAPA_WORD[here.etapa.etapa]}</span>}
        </div>
        {q.isError ? (
          <ReadError what="el paso" onRetry={() => void q.refetch()} />
        ) : !t ? (
          <div className="cor-skel" style={{ height: 300 }} aria-busy="true" aria-label="Leyendo el paso" />
        ) : (
          <>
            <section aria-label="Hecho cuando">
              <Label as="h3">Hecho cuando</Label>
              <ul>
                {t.checks.slice(0, 4).map((c) => (
                  <li key={c.n} className="cor-row">
                    <State tone={c.done ? "ok" : c.waived ? undefined : undefined}>{c.done ? "Hecho" : c.waived ? "No aplica" : "Falta"}</State>
                    <span className="cor-ellipsis" title={c.text}>
                      {c.text}
                    </span>
                  </li>
                ))}
                {t.checks.length === 0 && <li className="cor-row cor-muted">Sin condiciones escritas.</li>}
                {t.checks.length > 4 && <li className="cor-cap">{`y ${t.checks.length - 4} más`}</li>}
              </ul>
            </section>
            <section aria-label="Evidencia">
              <Label as="h3">Evidencia · las tres últimas</Label>
              <ul>
                {[...t.results]
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .slice(0, 3)
                  .map((r) => {
                    const [w, tone] = RESULT_WORD(r.verdict);
                    return (
                      <li key={r.id} className="cor-row">
                        <State tone={tone}>{w}</State>
                        <span className="cor-ellipsis" title={r.cite}>
                          {r.cite}
                        </span>
                      </li>
                    );
                  })}
                {t.results.length === 0 && <li className="cor-row cor-muted">Todavía sin evidencia.</li>}
              </ul>
            </section>
            <div className="cor-paso-two">
              <section aria-label="PR y docs">
                <Label as="h3">PR y docs</Label>
                <ul>
                  {t.pr?.url && (
                    <li>
                      <a className="cor-row" href={t.pr.url} target="_blank" rel="noreferrer">
                        <span style={{ flex: 1 }}>{t.pr.number ? `PR #${t.pr.number}` : "PR"}</span>
                        <State>{t.status === "Merged" || t.status === "Released" || t.status === "Done" ? "Fusionado" : "Abierto"}</State>
                      </a>
                    </li>
                  )}
                  {t.docs.slice(0, 2).map((d) => (
                    <li key={d.id}>
                      <Link className="cor-row" to={links.doc(d.id)}>
                        <span className="cor-ellipsis" style={{ flex: 1 }}>
                          {d.title}
                        </span>
                        <State>{`v${d.version}`}</State>
                      </Link>
                    </li>
                  ))}
                  {!t.pr?.url && t.docs.length === 0 && <li className="cor-row cor-muted">Sin PR ni docs.</li>}
                </ul>
              </section>
              <section aria-label="Historia">
                <Label as="h3">Historia · lo más reciente</Label>
                <ul>
                  {[...t.log]
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .slice(0, 2)
                    .map((e) => (
                      <li key={e.id} className="cor-row">
                        <span className="cor-cap">{dayOf(e.at)}</span>
                        <span className="cor-ellipsis" title={logLine(e)}>
                          {logLine(e)}
                        </span>
                      </li>
                    ))}
                  {t.log.length === 0 && <li className="cor-row cor-muted">Sin movimientos.</li>}
                </ul>
              </section>
            </div>
            <p className="cor-cap">Lo que puedes hacer con un paso (Hacer primero, Detener, Quitar, Aceptar) está en su tarjeta del tablero.</p>
          </>
        )}
      </div>
      {parent && <InitiativeCard p={p} k={parent} onCerrar={(version) => cerrar.mutate({ slug: p.slug, key: parent, version })} busy={cerrar.isPending} links={links} here={k} />}
    </div>
  );
};
