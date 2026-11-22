// PLA-I71-2: one seat managed in place, beside the org chart (PLA-IDEA34 boards Main and Ancho). Four tabs: Perfil
// (who it reports to, who reports to it, its post and your manner, its work), Motor (model, effort, steps at once,
// this week's share; PUT /company/motores), Habilidades (what its next run carries, a switch per skill, the store),
// Aprendizaje (the proposed lesson, its lessons, references, what changed, first-time deliveries). The teach bar sits
// at the foot on every tab. Reading or writing long text (the post and your manner, a skill, a version, a reference,
// a trial) widens the panel over the chart; Esc narrows it first, then closes the panel. It replaces the separate
// agent page (PLA-I67-1), whose panels it reuses.
import { useEffect, useState } from "react";
import { ownerText } from "@/lib/owner-text";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, type OrgMember, type OrgProject } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import { words } from "@/lib/i18n";
import { EQUIPO_WORDS } from "@/lib/equipo-words";
import { OFICIO_WORDS } from "@/lib/oficio-words";
import { AGENTE_WORDS } from "@/lib/agente-words";
import { ORGANIGRAMA_WORDS } from "@/lib/organigrama-words";
import { EFFORTS, MODELS, effortWord, type EffortId, type ModelId } from "@/lib/motores";
import { MAX } from "@/lib/a-la-vez";
import { numWord, shelfNext, skillWords, type Oficio } from "@/lib/oficio";
import { dotOf } from "@/lib/organigrama";
import { Btn, Label, Opt, ReadError, Switch, useOnce } from "./parts";
import { NewSkillPanel, PuestoPanel, SkillPanel } from "./oficio-skill";
import { ImportPanel, TrialCompare, TrialPanel } from "./oficio-trial";
import { IMPORT_WORDS } from "@/lib/oficio-trial-words";
import { SKILL_CARD_WORDS } from "@/lib/oficio-skill-words";
import { BudgetBar, HistoryPanel, LessonsPanel, ProposalCard, Reading, TeachBar } from "./oficio-lessons";
import { refsApi } from "@/lib/references-api";
import { RefCard, RefPanel, useRefUpload } from "./oficio-refs";
import { cardLine } from "./organigrama";
import { SUMAR_PAGE_WORDS } from "@/lib/sumar-page-words";

export const FICHA_TABS = ["perfil", "motor", "habilidades", "aprendizaje"] as const;
export type FichaTab = (typeof FICHA_TABS)[number];
export const fichaTabOf = (raw: string | null | undefined): FichaTab => ((FICHA_TABS as readonly string[]).includes(raw ?? "") ? (raw as FichaTab) : "perfil");

/** What widens the panel over the chart. */
export type Wide =
  | { kind: "puesto" }
  | { kind: "skill"; slug: string }
  | { kind: "new" }
  | { kind: "import" }
  | { kind: "trial"; slug: string; show: string | null }
  | { kind: "lessons" }
  | { kind: "historia" }
  | { kind: "refs" }
  | { kind: "ref"; id: string };

export type AgenteLinks = { equipo: string; tab: (t: FichaTab) => string; work: string; store?: string };

/** «Reporta a»: its teammate's seat, or the owner when it reports to the company's seat or nobody. */
export function bossOf(m: OrgMember, team: OrgMember[]): string {
  const w = words(ORGANIGRAMA_WORDS);
  const boss = m.reports_to ? team.find((x) => x.agent === m.reports_to) : null;
  if (boss) return seatName(boss.role);
  return !m.reports_to || m.reports_to === "ceo" || m.reports_to === "asistente" ? w.you : w.noBoss;
}

// ---- Habilidades: its next run's list (the shelf of PLA-I67-2, now a tab).
const Shelf = ({ o, onOpen }: { o: Oficio; onOpen: (slug: string) => void }) => {
  const w = words(OFICIO_WORDS);
  const ws = words(SKILL_CARD_WORDS);
  const client = useQueryClient();
  // PLA-I67-2: the seat's own list holds the factory skills only; an owner skill switches its own state.
  const carried = o.skills.filter((s) => s.on && !s.owner).map((s) => s.slug);
  const onCount = o.skills.filter((s) => s.on).length;
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["oficio", o.project, o.agent] });
    void client.invalidateQueries({ queryKey: ["skill", o.project, o.agent] });
    void client.invalidateQueries({ queryKey: ["lessons", o.project, o.agent] });
    void client.invalidateQueries({ queryKey: ["company"] });
    void client.invalidateQueries({ queryKey: ["tienda", o.project] });
  };
  const own = useMutation({ mutationFn: ({ slug, on }: { slug: string; on: boolean }) => api.setSkillOn(o.project, o.agent, slug, on), onSuccess: refresh });
  const save = useMutation({ mutationFn: (list: string[]) => api.setSeatPacks(o.project, o.agent, list), onSuccess: refresh });
  // PLA-140: a seat whose list became its own can go back to its role's factory set; the line says what the last
  // switch did (on or off).
  const reset = useMutation({ mutationFn: () => api.resetSeatPacks(o.project, o.agent), onSuccess: refresh });
  const [lastOn, setLastOn] = useState(true);
  const failed = save.error ?? reset.error;
  const err = failed instanceof ApiError ? (failed.code === "TOO_MANY_PACKS" ? w.tooManyCode : w.saveFailed(failed.code)) : failed ? words(EQUIPO_WORDS).notNow : null;
  const groups: [string, typeof o.skills][] = [
    [ws.groupYours(o.skills.filter((s) => s.source === "owner").length), o.skills.filter((s) => s.source === "owner")],
    [w.groupFactory(o.skills.filter((s) => s.source === "kit").length), o.skills.filter((s) => s.source === "kit")],
    [w.groupDocs(o.skills.filter((s) => s.source === "doc").length), o.skills.filter((s) => s.source === "doc")],
  ];
  return (
    <>
      <p className="cor-cap ofi-shelf-hint" role="status">
        {save.isPending || own.isPending || reset.isPending ? w.saving : err ? <span className="cor-state bad">{err}</span> : reset.isSuccess && !o.own ? w.backDone : save.isSuccess || own.isSuccess ? (lastOn ? w.savedNext : w.savedOff) : <>{w.onCount(numWord(onCount, undefined, true), onCount)} {onCount > 6 ? `${w.focusHint} ${w.tooMany}` : o.own ? w.ownKit : w.defaultKit}</>}
        {o.own && !save.isPending && !reset.isPending && (
          <>
            {" "}
            <Btn kind="link" onClick={() => (reset.reset(), save.reset(), own.reset(), reset.mutate())} data-control="volver-a-fabrica">
              {w.backToFactory}
            </Btn>
          </>
        )}
      </p>
      {groups.map(
        ([label, list]) =>
          list.length > 0 && (
            <div key={label}>
              <Label as="p" className="ofi-shelf-group">
                {label}
              </Label>
              <ul className="ofi-shelf-list">
                {list.map((s) => {
                  const sw = skillWords(s);
                  return (
                    <li key={s.slug} data-shelf={s.slug}>
                      <Switch on={s.on} label={sw.name} disabled={save.isPending || own.isPending} onChange={(on) => (setLastOn(on), reset.reset(), s.owner ? own.mutate({ slug: s.slug, on }) : save.mutate(shelfNext(carried, s.slug, on)))} data-control={`estante-${s.slug}`} />
                      <button type="button" className="ofi-shelf-open cor-cap" onClick={() => onOpen(s.slug)} aria-label={ws.openCard(sw.name)} data-control={`ver-${s.slug}`}>
                        <span className="ofi-shelf-line">{sw.line}</span>
                        <span aria-hidden>›</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ),
      )}
    </>
  );
};

// ---- Motor: the same save as Motores, for this one seat.
const MotorTab = ({ p, m }: { p: OrgProject; m: OrgMember }) => {
  const w = words(AGENTE_WORDS);
  const client = useQueryClient();
  const seatRunner = p.runner?.seats.find((s) => s.agent === m.agent);
  const saved = { model: (m.motor?.own_model ? m.motor.model : null) as ModelId | null, effort: (m.motor?.own_effort ? m.motor.effort : null) as EffortId | null, at: seatRunner?.max_parallel ?? null };
  const [d, setD] = useState(saved);
  useEffect(() => setD(saved), [m.agent, m.motor?.model, m.motor?.effort, seatRunner?.max_parallel]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = d.model !== saved.model || d.effort !== saved.effort || d.at !== saved.at;
  const onceSave = useOnce();
  const save = useMutation({
    mutationFn: () => api.saveMotores({ project: p.slug, seats: [{ agent: m.agent, motor: { model: d.model, effort: d.effort }, ...(d.at !== saved.at ? { max_parallel: d.at } : {}) }] }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["company"] }),
  });
  const floor = p.runner?.limits.max_per_agent ?? 1;
  const at = d.at ?? floor;
  const share = m.used_week?.share;
  return (
    <div className="agt-motor" data-motor-tab>
      <div className="agt-field" role="group" aria-label={w.model}>
        <Label as="p">{w.model}</Label>
        <div className="agt-opts">
          <Opt on={d.model === null} onClick={() => setD({ ...d, model: null })} data-control="modelo-auto">
            {w.auto}
          </Opt>
          {MODELS.map((x) => (
            <Opt key={x.id} on={d.model === x.id} onClick={() => setD({ ...d, model: x.id })} data-control={`modelo-${x.id}`}>
              {x.name}
            </Opt>
          ))}
        </div>
      </div>
      <div className="agt-field" role="group" aria-label={w.effort}>
        <Label as="p">{w.effort}</Label>
        <div className="agt-opts">
          {EFFORTS.map((e) => (
            <Opt key={e} on={(d.effort ?? m.motor?.effort) === e} onClick={() => setD({ ...d, effort: e })} data-control={`esfuerzo-${e}`}>
              {effortWord(e)}
            </Opt>
          ))}
        </div>
      </div>
      <div className="agt-kv">
        <span>{w.atOnce}</span>
        <span className="cor-stepper" role="group" aria-label={w.atOnce}>
          <Btn kind="quiet" small aria-label={w.less} disabled={at <= 1} onClick={() => setD({ ...d, at: at - 1 })}>
            −
          </Btn>
          <b className="cor-mono" aria-live="polite">
            {at}
          </b>
          <Btn kind="quiet" small aria-label={w.more} disabled={at >= MAX.seat} onClick={() => setD({ ...d, at: at + 1 })}>
            +
          </Btn>
        </span>
      </div>
      <div className="agt-kv">
        <span>{w.use7}</span>
        <span className="cor-mono">{share == null ? w.useNone : w.useShare(Math.round(share * 100))}</span>
      </div>
      <p className="cor-cap">{w.motorHint}</p>
      <p className="cor-cap" role="status">
        {save.isPending ? w.savingMotor : save.isError ? <span className="cor-state bad">{w.motorFailed(save.error instanceof ApiError ? save.error.code : "NETWORK")}</span> : save.isSuccess && !changed ? w.savedMotor : ""}
      </p>
      <Btn kind="primary" disabled={!changed || save.isPending} onClick={() => onceSave(() => save.mutateAsync())} data-control="guardar-motor">
        {w.saveMotor}
      </Btn>
    </div>
  );
};

// ---- PLA-I71-3: move, pause, retire (Perfil). Runs never do these; only the owner's session reaches the routes.
const MoveRow = ({ p, m }: { p: OrgProject; m: OrgMember }) => {
  const w = words(SUMAR_PAGE_WORDS);
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<string>("");
  const below = useQuery({ queryKey: ["below", p.slug, m.agent], queryFn: () => api.seatBelow(p.slug, m.agent), enabled: open });
  const onceMove = useOnce();
  const move = useMutation({
    mutationFn: () => api.moveSeat(p.slug, m.agent, to === "__owner" ? null : to),
    onSuccess: () => {
      setOpen(false);
      void client.invalidateQueries({ queryKey: ["company"] });
      void client.invalidateQueries({ queryKey: ["below", p.slug] });
    },
  });
  const blocked = new Set(below.data?.below ?? [m.agent]);
  const current = m.reports_to && p.team.some((x) => x.agent === m.reports_to) ? m.reports_to : "__owner";
  return (
    <>
      <div>
        <dt>{words(AGENTE_WORDS).reportsTo}</dt>
        <dd>
          {bossOf(m, p.team)}{" "}
          <Btn kind="link" aria-expanded={open} onClick={() => (setOpen(!open), setTo(current))} data-control="mover">
            {w.move}
          </Btn>
        </dd>
      {open && (
        <dd className="agt-move" data-move>
          <label className="sr-only" htmlFor="agt-move-to">
            {w.moveTo}
          </label>
          <select id="agt-move-to" className="cor-select" value={to} onChange={(e) => setTo(e.target.value)} data-control="mover-a">
            <option value="__owner">{words(SUMAR_PAGE_WORDS).you}</option>
            {p.team.map((x) => (
              <option key={x.agent} value={x.agent} disabled={blocked.has(x.agent)}>
                {x.puesto ?? seatName(x.role)}
              </option>
            ))}
          </select>
          <Btn kind="secondary" disabled={move.isPending || to === current} onClick={() => onceMove(() => move.mutateAsync())} data-control="mover-guardar">
            {w.moveSave}
          </Btn>
          <Btn kind="quiet" onClick={() => setOpen(false)}>
            {w.moveCancel}
          </Btn>
          <span className="cor-cap" role="status">
            {move.error instanceof ApiError ? (move.error.code === "MANAGER_LOOP" ? w.moveLoop : w.failed(move.error.code)) : w.moveNotOwn}
          </span>
        </dd>
      )}
      </div>
    </>
  );
};

const SeatActions = ({ p, m, onGone }: { p: OrgProject; m: OrgMember; onGone: () => void }) => {
  const w = words(SUMAR_PAGE_WORDS);
  const client = useQueryClient();
  const [asking, setAsking] = useState(false);
  const paused = !!m.paused_at;
  const refresh = () => void client.invalidateQueries({ queryKey: ["company"] });
  const oncePause = useOnce();
  const pause = useMutation({ mutationFn: () => api.pauseSeat(p.slug, m.agent, !paused), onSuccess: refresh });
  const onceRetire = useOnce({ sticky: true, key: m.agent });
  const retire = useMutation({
    mutationFn: () => api.retireSeat(p.slug, m.agent),
    onSuccess: () => {
      refresh();
      onGone();
    },
  });
  const po = m.template === "product-owner";
  return (
    <div className="agt-seat" data-seat-actions>
      {paused && <p className="cor-cap cor-state warn">{w.pausedLine}</p>}
      {asking ? (
        <div className="agt-retire" role="group" aria-label={w.retire}>
          <p className="cor-text">{w.retireAsk(m.puesto ?? seatName(m.role))}</p>
          <Btn kind="secondary" disabled={retire.isPending} onClick={() => onceRetire(() => retire.mutateAsync())} data-control="retirar-si">
            {w.retireYes}
          </Btn>
          <Btn kind="quiet" onClick={() => setAsking(false)} data-control="retirar-no">
            {w.retireNo}
          </Btn>
        </div>
      ) : (
        <div className="agt-seat-row">
          <Btn kind="secondary" disabled={pause.isPending} onClick={() => oncePause(() => pause.mutateAsync())} data-control={paused ? "reanudar-puesto" : "pausar-puesto"}>
            {paused ? w.resume : w.pause}
          </Btn>
          <Btn kind="quiet" disabled={po} title={po ? w.retirePo : undefined} onClick={() => setAsking(true)} data-control="retirar">
            {w.retire}
          </Btn>
        </div>
      )}
      {(pause.error || retire.error) && <p className="cor-state bad">{w.failed((pause.error ?? retire.error) instanceof ApiError ? ((pause.error ?? retire.error) as ApiError).code : "NETWORK")}</p>}
    </div>
  );
};

// ---- the wide state: the post (read only) beside your manner; or a skill, a version, a reference, a trial.
const PuestoWide = ({ o, seat, motorLink, onClose }: { o: Oficio; seat: string; motorLink: string; onClose: () => void }) => {
  const w = words(AGENTE_WORDS);
  const q = useQuery({ queryKey: ["puesto", o.project, o.agent], queryFn: () => api.puesto(o.project, o.agent) });
  return (
    <div className="agt-post">
      <section className="agt-post-text" aria-label={w.postReadOnly}>
        <span className="agt-post-head">
          <Label as="h3">{w.postReadOnly}</Label>
          <span className="org-tag">{w.readOnly}</span>
        </span>
        <pre className="agt-pre" tabIndex={0}>
          {q.data ? (q.data.role_text ? ownerText(q.data.role_text) : w.noRoleText) : "…"}
        </pre>
      </section>
      <PuestoPanel o={o} seat={seat} motorLink={motorLink} onClose={onClose} />
    </div>
  );
};

export const AgentePanel = ({ p, m, paused, tab, links, onTab, motorLink, openSkill = null, children }: { p: OrgProject; m: OrgMember; paused: boolean; tab: FichaTab; links: AgenteLinks; onTab: (t: FichaTab) => void; motorLink: string; openSkill?: string | null; children?: React.ReactNode }) => {
  const w = words(AGENTE_WORDS);
  const wo = words(ORGANIGRAMA_WORDS);
  const navigate = useNavigate();
  const seat = m.puesto ?? seatName(m.role);
  const q = useQuery({ queryKey: ["oficio", p.slug, m.agent], queryFn: () => api.oficio(p.slug, m.agent), refetchInterval: 30_000 });
  const lq = useQuery({ queryKey: ["lessons", p.slug, m.agent], queryFn: () => api.lessons(p.slug, m.agent), refetchInterval: 30_000 });
  const refsQ = useQuery({ queryKey: ["refs", p.slug, m.agent], queryFn: () => refsApi.list(p.slug, m.agent) });
  const puesto = useQuery({ queryKey: ["puesto", p.slug, m.agent], queryFn: () => api.puesto(p.slug, m.agent) });
  // PLA-I71-4: «Probarla» from the store opens that skill's card here, wide (&skill=<slug>).
  const [wide, setWide] = useState<Wide | null>(openSkill ? { kind: "skill", slug: openSkill } : null);
  const upload = useRefUpload(p.slug, m.agent, (r) => setWide({ kind: "ref", id: r.id }));
  const trialSlug = wide?.kind === "trial" ? wide.slug : null;
  const trialCard = useQuery({ queryKey: ["skill", p.slug, m.agent, trialSlug], queryFn: () => api.skillCard(p.slug, m.agent, trialSlug!), enabled: !!trialSlug });
  useEffect(() => setWide(openSkill ? { kind: "skill", slug: openSkill } : null), [m.agent, openSkill]);
  // Esc narrows the wide panel before the page's Esc closes the panel.
  useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setWide(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [wide]);
  const o = q.data;
  const lessons = lq.data?.lessons ?? [];
  const waiting = lessons.filter((l) => l.state === "proposed");
  const active = lessons.filter((l) => l.state === "active");
  const reports = p.team.filter((x) => x.reports_to === m.agent);
  const manner = puesto.data?.manner?.trim();
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = FICHA_TABS.indexOf(tab);
    const to = e.key === "ArrowRight" ? FICHA_TABS[(i + 1) % 4] : e.key === "ArrowLeft" ? FICHA_TABS[(i + 3) % 4] : e.key === "Home" ? FICHA_TABS[0] : e.key === "End" ? FICHA_TABS[3] : null;
    if (!to) return;
    e.preventDefault();
    e.stopPropagation();
    onTab(to);
    requestAnimationFrame(() => document.getElementById(`agt-tab-${to}`)?.focus());
  };
  const wideBody = (o: Oficio) => {
    if (!wide) return null;
    const back = () => setWide(null);
    switch (wide.kind) {
      case "puesto":
        return <PuestoWide o={o} seat={seat} motorLink={motorLink} onClose={back} />;
      case "skill":
        return <SkillPanel o={o} seat={seat} slug={wide.slug} onClose={back} onOpen={(slug) => setWide({ kind: "skill", slug })} onTry={(slug) => setWide({ kind: "trial", slug, show: null })} />;
      case "new":
        return <NewSkillPanel o={o} seat={seat} onClose={back} onOpen={(slug) => setWide({ kind: "skill", slug })} />;
      case "import":
        return <ImportPanel o={o} seat={seat} onClose={back} onOpen={(slug) => setWide({ kind: "skill", slug })} />;
      case "trial":
        return wide.show ? (
          <TrialCompare o={o} id={wide.show} card={trialCard.data} onClose={() => setWide({ ...wide, show: null })} />
        ) : (
          <TrialPanel o={o} slug={wide.slug} name={trialCard.data?.name ?? wide.slug} n={trialCard.data?.n ?? 1} now={Date.now()} onClose={() => setWide({ kind: "skill", slug: wide.slug })} onShow={(id) => setWide({ ...wide, show: id })} />
        );
      case "lessons":
        return <LessonsPanel o={o} l={lq.data} onClose={back} />;
      case "historia":
        return <HistoryPanel l={lq.data} now={Date.now()} onClose={back} />;
      case "refs":
        return <RefPanel slug={p.slug} agent={m.agent} seat={seat} refs={refsQ.data ?? []} upload={upload} onOpen={(id) => setWide({ kind: "ref", id })} onClose={back} />;
      case "ref": {
        const r = refsQ.data?.find((x) => x.id === wide.id);
        return r ? <RefCard key={r.id} slug={p.slug} agent={m.agent} seat={seat} r={r} now={Date.now()} onClose={() => setWide({ kind: "refs" })} /> : null;
      }
    }
  };
  return (
    <aside className={`cor-card eq-side agt ${wide ? "wide" : ""}`} aria-label={w.tabsOf(seat)} data-ficha={m.agent} data-wide={wide?.kind}>
      <div className="eq-side-head">
        <span className="org-glyph" aria-hidden>
          {seat.slice(0, 2)}
        </span>
        <span className="org-who">
          <b className="eq-side-name">{wide?.kind === "puesto" ? w.postTitle(seat) : seat}</b>
          <span className="org-line">{wide ? w.wideHint : cardLine(m)}</span>
        </span>
        {wide ? (
          <Btn kind="secondary" onClick={() => setWide(null)} data-control="ficha-angosta">
            {w.wideBack}
          </Btn>
        ) : (
          <>
            <span className="cor-label">{wo.dot[dotOf(m, paused)]}</span>
            <Link to={links.equipo} className="cor-btn quiet small agt-x" aria-label={w.close} data-control="cerrar-ficha">
              ×
            </Link>
          </>
        )}
      </div>
      {q.isError ? (
        <ReadError what={w.readError} onRetry={() => void q.refetch()} />
      ) : !o ? (
        <p className="cor-text cor-muted" role="status" aria-busy="true">
          {w.loading}
        </p>
      ) : wide ? (
        <div className="agt-wide-body">{wideBody(o)}</div>
      ) : (
        <>
          <div className="agt-tabs" role="tablist" aria-label={w.tabsOf(seat)} onKeyDown={onTabKey}>
            {FICHA_TABS.map((t) => (
              <Link
                key={t}
                id={`agt-tab-${t}`}
                role="tab"
                to={links.tab(t)}
                replace
                aria-selected={tab === t}
                aria-controls="agt-panel"
                tabIndex={tab === t ? 0 : -1}
                className="agt-tab"
                onClick={(e) => {
                  e.preventDefault();
                  onTab(t);
                }}
                data-control={`ficha-${t}`}
              >
                {w.tabs[t]}
                {t === "habilidades" && <span className="cor-cap"> {o.skills.filter((s) => s.on).length}</span>}
                {t === "aprendizaje" && waiting.length > 0 && <i className="org-dot espera" aria-hidden />}
              </Link>
            ))}
          </div>
          <div className="agt-body" id="agt-panel" role="tabpanel" aria-labelledby={`agt-tab-${tab}`} tabIndex={0}>
            {tab === "perfil" && (
              <>
                <dl className="eq-kv">
                  <MoveRow p={p} m={m} />
                  {children}
                  <div>
                    <dt>{w.inCharge}</dt>
                    <dd>{reports.length ? reports.map((r) => seatName(r.role)).join(", ") : w.nobody}</dd>
                  </div>
                  <div>
                    <dt>{w.post}</dt>
                    <dd>
                      <Btn kind="link" onClick={() => setWide({ kind: "puesto" })} data-control="leer-puesto">
                        {w.readText}
                      </Btn>
                    </dd>
                  </div>
                  <div>
                    <dt>{w.manner}</dt>
                    <dd className="agt-manner">
                      <Btn kind="link" onClick={() => setWide({ kind: "puesto" })} data-control="abrir-manera">
                        {manner ? w.mannerPreview(manner.split("\n")[0]!.slice(0, 28), manner.length > 28) : w.mannerNone}
                      </Btn>
                    </dd>
                  </div>
                  <div>
                    <dt>{w.work}</dt>
                    <dd>
                      <Link className="cor-btn link" to={links.work} data-control="ver-trabajo">
                        {w.seeInTodo}
                      </Link>
                    </dd>
                  </div>
                </dl>
                <SeatActions p={p} m={m} onGone={() => navigate(links.equipo, { replace: true })} />
              </>
            )}
            {tab === "motor" && <MotorTab p={p} m={m} />}
            {tab === "habilidades" && (
              <>
                <BudgetBar b={lq.data?.budget} />
                <div className="ofi-actions ofi-actions-two">
                  <Btn kind="secondary" onClick={() => setWide({ kind: "new" })} data-control="nueva-habilidad">
                    {words(SKILL_CARD_WORDS).newSkill}
                  </Btn>
                  <Btn kind="quiet" onClick={() => setWide({ kind: "import" })} data-control="traer-de-enlace">
                    {words(IMPORT_WORDS).open}
                  </Btn>
                </div>
                <Shelf o={o} onOpen={(slug) => setWide({ kind: "skill", slug })} />
                {links.store && (
                  <Link className="cor-btn link" to={links.store} data-control="ir-tienda">
                    {w.toStore}
                  </Link>
                )}
              </>
            )}
            {tab === "aprendizaje" && (
              <>
                <Reading l={lq.data} />
                {waiting[0] && <ProposalCard key={waiting[0].id} o={o} seat={seat} lesson={waiting[0]} />}
                {active.length === 0 && !waiting.length && <p className="cor-text cor-muted">{w.noLessons}</p>}
                <ul className="agt-links">
                  <li>
                    <Btn kind="link" onClick={() => setWide({ kind: "lessons" })} data-control="abrir-lecciones">
                      {w.lessons(active.length)}
                    </Btn>
                  </li>
                  <li>
                    <Btn kind="link" onClick={() => setWide({ kind: "refs" })} data-control="agregar-referencia">
                      {w.refs(refsQ.data?.length ?? 0)}
                    </Btn>
                  </li>
                  <li>
                    <Btn kind="link" onClick={() => setWide({ kind: "historia" })} data-control="abrir-cambios">
                      {w.changes}
                    </Btn>
                  </li>
                </ul>
                {/* «A la primera» stays as one line (the deliveries drawing went with the agent page). */}
                <p className="cor-cap" data-primera>
                  {o.counts.closed ? w.firstTime(o.counts.first_time, o.counts.closed) : w.firstTimeNone}
                </p>
              </>
            )}
          </div>
        </>
      )}
      {o && <TeachBar o={o} seat={seat} onSkill={() => setWide({ kind: "new" })} />}
    </aside>
  );
};
