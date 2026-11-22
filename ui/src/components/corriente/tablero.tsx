// PLA-I62-6: a paso's (or an initiative's) detail, opened from the project's list. PLA-I64-7 retired the board
// itself (the list's rows and levers took its place). A paso's detail: Hecho cuando, the evidence, PR and docs, its history, and its initiative with Cerrar.
import { Trabajo } from "./trabajo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { toast } from "sonner";
import { ApiError, api, type Decision, type OrgProject, type ProjectTicket } from "@/lib/api";
import { actAria, actBusyKey, actLabel, cardActs, type CardAct } from "@/lib/etapas";
import { etapaWord, statusWord } from "@/lib/etapas";
import type { LogEntry } from "@/lib/types";
import type { CorrienteActs } from "./acts";
import { Btn, Key, Label, ReadError, State } from "./parts";
import { LOCALE } from "@/lib/locale";
import { words } from "@/lib/i18n";
import { TABLERO_WORDS } from "@/lib/tablero-words";
import { WAIVER_WORDS, waiverLine } from "@/lib/waiver";
import { TASK_PATCH_WORDS } from "@/lib/task-patch-words";
import { canReopen, prChip, reopenPatch } from "@/lib/paso";
import { useState, type FormEvent } from "react";

export type BoardLinks = { paso: (key: string) => string; iniciativa: (key: string) => string; entrega: (d: Decision) => string; sueltos: string; doc: (id: string) => string };

/** Close an initiative (PLA-I56-2): the server accepts it only when every step is Done and says what is open. */
export function useCerrar() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (v: { slug: string; key: string; version: number }) => api.patchTask(v.slug, v.key, { status: "Done", version: v.version }),
    onSuccess: (_r, v) => {
      toast(words(TABLERO_WORDS).closed);
      void client.invalidateQueries({ queryKey: ["company"] });
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["task", v.slug] });
    },
    onError: (e) => {
      const open = e instanceof ApiError && Array.isArray(e.detail?.open) ? (e.detail.open as string[]) : [];
      const w = words(TABLERO_WORDS);
      toast.error(e instanceof ApiError && e.code === "INITIATIVE_CHILDREN_OPEN" ? w.cantClose(open) : e instanceof ApiError && e.code === "STALE_VERSION" ? w.stale : w.closeFailed);
      void client.invalidateQueries({ queryKey: ["company"] });
    },
  });
}

// PLA-I65: the card's calls, shared with the ficha (ficha.tsx).
export const run = (slug: string, a: CardAct, acts: CorrienteActs) => {
  if (a.kind === "primero") return acts.pickNext(slug, a.key);
  if (a.kind === "quitar") return acts.cancelOrder(slug, a.key);
  if (a.kind === "detener") return acts.stopRun(a.runId);
  return acts.decisions.decide(a.decision, { action: a.action }, "aceptar");
};
export const busyOf = (a: CardAct, acts: CorrienteActs) =>
  a.kind === "primero" ? acts.busy === `next-${a.key}` : a.kind === "quitar" ? acts.busy === `cancel-${a.key}` : a.kind === "detener" ? acts.busy === `stop-${a.runId}` : acts.decisions.busy?.id === a.decision.id;

const RESULT_WORD = (v: string) => {
  const w = words(TABLERO_WORDS);
  return (v === "pass" ? [w.pass, "ok"] : v === "fail" ? [w.fail, "bad"] : [w.warning, undefined]) as [string, "ok" | "bad" | undefined];
};
function logLine(e: LogEntry): string {
  const w = words(TABLERO_WORDS);
  const p = e.payload ?? {};
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
  if (s("note")) return s("note")!;
  // PLA-112 (guided test PLA-86, F-4): the owner's words for the status («Quitar» read «Pasó a Won't do»).
  if (s("to")) return w.movedTo(statusWord(s("to")!));
  if (s("status")) return w.movedTo(statusWord(s("status")!));
  if (s("cite")) return s("cite")!;
  return e.type.replace(/^task\./, "").replace(/_/g, " ");
}
const dayOf = (iso: string) => new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" }).format(new Date(iso)).toUpperCase().replace(".", "");

const InitiativeCard = ({ p, k, onCerrar, busy, links, here }: { p: OrgProject; k: string; onCerrar: (version: number) => void; busy: boolean; links: BoardLinks; here: string | null }) => {
  const init = p.tablero?.initiatives.find((i) => i.key === k);
  if (!init) return null;
  const left = init.total - (init.closed ?? init.done);
  const tickets = init.tickets.slice(0, 5);
  const w = words(TABLERO_WORDS);
  return (
    <aside className="cor-card cor-initcard" aria-label={w.initiativeAria(k)} data-iniciativa={k}>
      <Label>{w.initiativeLabel(k)}</Label>
      <h2 className="cor-h3">{init.title}</h2>
      <span className="cor-text">{w.counts(init.total - init.done, init.done, init.total)}</span>
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
              <State>{etapaWord(t.etapa.etapa)}</State>
            </Link>
          </li>
        ))}
      </ul>
      {init.tickets.length > tickets.length && <span className="cor-cap">{w.moreOnBoard(init.tickets.length - tickets.length)}</span>}
      <p className="cor-text">{init.can_close ? w.canClose : w.left(left)}</p>
      <Btn kind="secondary" disabled={!init.can_close || busy || init.version === undefined} onClick={() => init.version !== undefined && onCerrar(init.version)} data-control="cerrar-iniciativa">
        {busy ? w.closing : w.close}
      </Btn>
    </aside>
  );
};

/** PLA-I64-7: what the board's card offered on a step (Hacer primero, Detener, Quitar, Aceptar), now in its view. */
const PasoActs = ({ p, t, acts, decisions }: { p: OrgProject; t: ProjectTicket; acts: CorrienteActs; decisions: Decision[] }) => {
  const list = cardActs(t, { team: p.team, decisions, orders: p.orders, nextFirst: p.next_first });
  // PLA-62: a step that only sits in Backlog can be passed to Lista here too (the list's Quieto lever).
  const lista = t.status === "Backlog" && t.etapa.etapa === "despues" && !(t.etapa.reason ?? "").startsWith("Espera a");
  if (!list.length && !lista) return null;
  const w = words(TABLERO_WORDS);
  const go = (a: CardAct) =>
    a.kind === "primero" ? acts.pickNext(p.slug, a.key) : a.kind === "detener" ? acts.stopRun(a.runId) : a.kind === "quitar" ? acts.cancelOrder(p.slug, a.key) : acts.decisions.decide(a.decision, { action: a.action }, "paso-aceptar");
  const busy = (a: CardAct) => (a.kind === "aceptar" ? acts.decisions.busy?.id === a.decision.id : acts.busy === actBusyKey(a) || acts.busy === `stop-${a.kind === "detener" ? a.runId : ""}`);
  return (
    <div className="cor-acts" data-paso-acts={t.key}>
      {list.map((a) => (
        <Btn key={a.kind} kind={a.kind === "aceptar" ? "primary" : "secondary"} onClick={() => go(a)} disabled={busy(a)} aria-label={actAria(a, t.title)} data-control={`paso-${a.kind}`}>
          {actLabel(a)}
        </Btn>
      ))}
      {lista && (
        <Btn kind="secondary" onClick={() => acts.aLista(p.slug, t.key)} disabled={acts.busy === `lista-${t.key}`} aria-label={w.toListaAria(t.title)} data-control="paso-lista">
          {acts.busy === `lista-${t.key}` ? w.moving : w.toLista}
        </Btn>
      )}
    </div>
  );
};

/** PLA-157 (b): «Reabrir» on a closed step. The lifecycle's reopen is the owner's and needs a reason; it goes back to In review. */
const Reabrir = ({ slug, k, version, hasMuestra }: { slug: string; k: string; version: number; hasMuestra: boolean }) => {
  const client = useQueryClient();
  const w = words(TABLERO_WORDS);
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: (patch: { status: string; reason: string; version: number }) => api.patchTask(slug, k, patch),
    onSuccess: () => {
      toast(hasMuestra ? w.reopened : w.reopenedRedo);
      setReason("");
    },
    onError: (e) => toast.error((e instanceof ApiError && words(TASK_PATCH_WORDS).refused[e.code]) || w.reopenFailed),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["company"] });
      void client.invalidateQueries({ queryKey: ["task", slug] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const patch = reopenPatch(reason, version, hasMuestra);
    if (patch) m.mutate(patch);
  };
  return (
    <section className="cor-trabajo" aria-label={w.reopenLabel} data-reabrir={k}>
      <form className="cor-say" onSubmit={submit}>
        <Label as="p">{w.reopenLabel}</Label>
        <span className="cor-ajuste-row">
          <input className="cor-input" value={reason} maxLength={1000} required aria-label={w.reopenPlaceholder} placeholder={w.reopenPlaceholder} onChange={(e) => setReason(e.target.value)} />
          <Btn kind="secondary" type="submit" disabled={!reason.trim() || m.isPending} data-control="paso-reabrir">
            {m.isPending ? w.reopening : w.reopen}
          </Btn>
        </span>
        <span className="cor-cap">{hasMuestra ? w.reopenHint : w.reopenRedoHint}</span>
      </form>
    </section>
  );
};

export const Paso = ({ p, k, links, back, backLabel = words(TABLERO_WORDS).back, acts, decisions = [] }: { p: OrgProject; k: string; links: BoardLinks; back: string; backLabel?: string; acts?: CorrienteActs; decisions?: Decision[] }) => {
  const q = useQuery({ queryKey: ["task", p.slug, k], queryFn: () => api.task(p.slug, k) });
  const cerrar = useCerrar();
  const w = words(TABLERO_WORDS);
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
            {backLabel}
          </Link>
          <span className="cor-label violet">{t?.kind === "initiative" ? w.initiative : w.step} ·</span>
          <Key>{k}</Key>
          <h2 className="cor-ellipsis">{t?.title ?? here?.title ?? ""}</h2>
          {here && <span className="cor-state" style={{ marginLeft: "auto" }}>{etapaWord(here.etapa.etapa)}</span>}
        </div>
        {q.isError ? (
          <ReadError what={w.readWhat} onRetry={() => void q.refetch()} />
        ) : !t ? (
          <div className="cor-skel" style={{ height: 300 }} role="status" aria-busy="true" aria-label={w.reading} />
        ) : (
          <>
            <section aria-label={w.doneWhen}>
              <Label as="h3">{w.doneWhen}</Label>
              <ul>
                {t.checks.slice(0, 4).map((c) => (
                  <li key={c.n} className="cor-row">
                    <State tone={c.done ? "ok" : undefined}>{c.done ? w.done : c.waived ? words(WAIVER_WORDS).state : w.missing}</State>
                    <span className="cor-ellipsis" title={c.waived ? `${c.text} · ${waiverLine(c.waived)}` : c.text}>
                      {c.text}
                      {/* PLA-I74-11: who waived it and why, never a bare «No aplica». */}
                      {c.waived && <span className="cor-cap" data-waived-by> · {waiverLine(c.waived)}</span>}
                    </span>
                  </li>
                ))}
                {t.checks.length === 0 && <li className="cor-row cor-muted">{w.noChecks}</li>}
                {t.checks.length > 4 && <li className="cor-cap">{w.more(t.checks.length - 4)}</li>}
              </ul>
            </section>
            <section aria-label={w.evidence}>
              <Label as="h3">{w.evidenceLabel}</Label>
              <ul>
                {[...t.results]
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .slice(0, 3)
                  .map((r) => {
                    const [word, tone] = RESULT_WORD(r.verdict);
                    return (
                      <li key={r.id} className="cor-row">
                        <State tone={tone}>{word}</State>
                        <span className="cor-ellipsis" title={r.cite}>
                          {r.cite}
                        </span>
                      </li>
                    );
                  })}
                {t.results.length === 0 && <li className="cor-row cor-muted">{w.noEvidence}</li>}
              </ul>
            </section>
            <div className="cor-paso-two">
              <section aria-label={w.prDocs}>
                <Label as="h3">{w.prDocs}</Label>
                <ul>
                  {t.pr?.url && (
                    <li>
                      <a className="cor-row" href={t.pr.url} target="_blank" rel="noreferrer">
                        <span style={{ flex: 1 }}>{t.pr.number ? `PR #${t.pr.number}` : "PR"}</span>
                        <State>{{ merged: w.merged, open: w.open, closed: w.closedPr }[prChip(t.status, t.pr.state)]}</State>
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
                  {!t.pr?.url && t.docs.length === 0 && <li className="cor-row cor-muted">{w.noPrDocs}</li>}
                </ul>
              </section>
              <section aria-label={w.history}>
                <Label as="h3">{w.historyLabel}</Label>
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
                  {t.log.length === 0 && <li className="cor-row cor-muted">{w.noHistory}</li>}
                </ul>
              </section>
            </div>
            {acts && here && <PasoActs p={p} t={here} acts={acts} decisions={decisions} />}
            {canReopen(t) && <Reabrir slug={p.slug} k={k} version={t.version} hasMuestra={!!t.muestra} />}
            {/* PLA-I71-1: «Dile algo» and «Reanudar corrida», moved here from Equipo. */}
            {acts && t.kind !== "initiative" && <Trabajo p={p} k={k} acts={acts} />}
          </>
        )}
      </div>
      {parent && <InitiativeCard p={p} k={parent} onCerrar={(version) => cerrar.mutate({ slug: p.slug, key: parent, version })} busy={cerrar.isPending} links={links} here={k} />}
    </div>
  );
};
