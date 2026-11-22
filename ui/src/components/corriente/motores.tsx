// PLA-I62-8: Motores (board D1), the building's console redrawn on the same draft (lib/motores.ts) and «a la vez»
// counts (lib/a-la-vez.ts). One line per seat with its motor in words and Cambiar; open, the model and the effort as
// segmented choices and the seat's steps at a time; presets for all; the plan's use, how much work at once (project,
// per agent, the machine's ceiling) and the queue on the right; one save bar (PUT /company/motores, all or nothing).
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { MotoresSave, OrgProject } from "@/lib/api";
import { MAX, countsOf, pendingCounts, previewAdmission, seatCap, withCounts, type Counts } from "@/lib/a-la-vez";
import { seatName, thousands } from "@/lib/corriente";
import { words } from "@/lib/i18n";
import { EFFORTS, MODELS, applyPreset, effortWord, presetsOf, clearStrip, draftOf, isOwn, motorLine, pendingOf, planReadLine, saveOf, setEffort, setModel, shownOf, type Draft, type Strip } from "@/lib/motores";
import { MOTORES } from "@/lib/motores-words";
import { byRole } from "@/lib/org";
import { Btn, Label, Opt } from "./parts";
import type { CorrienteActs } from "./acts";
import { EQUIPO_WORDS } from "@/lib/equipo-words";
import { startsLine } from "@/lib/edificio";

// PLA-I71-1: the seats whose next step waits on nothing but a nudge, with «Que empiece ya» (or «Seguir de todos modos»
// past the plan's brake). It lived on Equipo's rows; Equipo is about the agents now.
export const PorArrancar = ({ p, acts, now, timeZone }: { p: OrgProject; acts: CorrienteActs; now: number; timeZone?: string }) => {
  const w = words(EQUIPO_WORDS);
  const rows = p.team.filter((m) => m.state !== "running" && m.next_start && (m.next_start.hold === "rest" || m.next_start.hold === "usage" || m.next_start.hold === "unqueued"));
  if (p.paused || rows.length === 0) return null;
  return (
    <ul className="cor-brief" data-por-arrancar>
      {rows.map((m) => {
        const n = m.next_start!;
        const past = n.hold === "usage";
        return (
          <li key={m.agent} data-member={m.agent}>
            <span>
              <b>{seatName(m.role)}</b> · {startsLine(n, now, timeZone)}{" "}
              <Btn kind="link" onClick={() => acts.start(p.slug, m.agent, past)} disabled={acts.busy === `${p.slug}:start`} data-control="arrancar">
                {past ? w.goAnyway : w.startNow}
              </Btn>
            </span>
          </li>
        );
      })}
    </ul>
  );
};

const Stepper = ({ value, min = 1, max, onChange, label }: { value: number; min?: number; max: number; onChange: (v: number) => void; label: string }) => {
  const w = words(MOTORES);
  return (
    <span className="cor-stepper" role="group" aria-label={label}>
      <Btn kind="quiet" small aria-label={w.less(label)} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </Btn>
      <b className="cor-mono" aria-live="polite">
        {value}
      </b>
      <Btn kind="quiet" small aria-label={w.more(label)} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </Btn>
    </span>
  );
};

// PLA-I2-10: own says the seat has its own motor (it was a comparison with the word «propio»).
const lineOf = (d: Draft, s: Strip) => {
  const w = words(MOTORES);
  const v = shownOf(d, s);
  const word = v.model || v.effort ? motorLine(v.model, v.effort) : w.auto;
  const inherited = !!(v.fromCompany.model && v.fromCompany.effort);
  const own = !inherited && isOwn(s);
  const from = inherited ? (s.sub ? w.followsPo : w.followsCompany) : own ? w.own : w.followsPo;
  return { word, from, own };
};

export const Motores = ({ p, def, signIn, onSave, planTo, acts, now = Date.now(), timeZone }: { p: OrgProject; def?: { model: string | null; effort: string | null }; signIn?: string; onSave: (s: MotoresSave) => Promise<unknown>; planTo: string; acts?: CorrienteActs; now?: number; timeZone?: string }) => {
  const w = words(MOTORES);
  const team = useMemo(() => [...p.team].sort(byRole), [p.team]);
  const saved = useMemo(() => draftOf(team, def), [team, def]);
  const savedCounts = useMemo(() => countsOf(p.runner, team), [p.runner, team]);
  const sig = JSON.stringify([saved, savedCounts]);
  const [state, setState] = useState<{ sig: string; draft: Draft; counts: Counts | null } | null>(null);
  const draft = state && state.sig === sig ? state.draft : saved;
  const counts = state && state.sig === sig ? state.counts : savedCounts;
  const set = (d: Draft) => setState({ sig, draft: d, counts });
  const setCounts = (c: Counts) => setState({ sig, draft, counts: c });
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pend = pendingOf(saved, draft);
  const pc = pendingCounts(savedCounts, counts);
  const n = pend.strips.length + (pend.company ? 1 : 0) + pc.n;
  const r = p.runner;
  const preview = r && counts ? previewAdmission(r, counts, team, p.title) : null;
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await onSave(withCounts(saveOf(p.slug, saved, draft), savedCounts, counts));
      setMsg({ ok: true, text: w.saved(n) });
    } catch {
      setMsg({ ok: false, text: w.saveFailed });
    } finally {
      setBusy(false);
    }
  };
  const changeWords = () => {
    const first = pend.strips[0] ? draft.strips.find((s) => s.key === pend.strips[0]) : null;
    if (first) return w.seatChange(seatName(first.role), !!first.sub, lineOf(draft, first).word);
    if (pend.company) return w.companyChange(motorLine(draft.company.model, draft.company.effort));
    return w.countsChange;
  };
  const row = (s: Strip) => {
    const m = team.find((x) => x.agent === s.agent);
    const l = lineOf(draft, s);
    const isOpen = open === s.key;
    const dirty = pend.strips.includes(s.key);
    const tokens = !s.sub && m?.used_week ? thousands(m.used_week.tokens) : "—";
    const live = !s.sub && m?.state === "running";
    return (
      <li key={s.key} className={`cor-mrow ${isOpen ? "open" : ""} ${s.sub ? "sub" : ""}`} data-strip={s.key}>
        <div className="cor-mrow-line">
          <span className="cor-mrow-who">
            {live && <i className="cor-live" aria-hidden />}
            <b>{s.sub ? w.whenAnswering : seatName(s.role)}</b>
          </span>
          <span className="cor-mrow-motor">
            {l.word}
            <span className={`cor-state ${dirty ? "amber" : l.own ? "live" : ""}`}>{dirty ? w.unsavedAfter(l.from) : l.from}</span>
          </span>
          <span className="cor-cap">{tokens}</span>
          <Btn kind="quiet" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.key)} data-control="motor-cambiar">
            {isOpen ? w.close : w.change}
          </Btn>
        </div>
        {isOpen && (
          <div className="cor-mrow-edit">
            <div>
              <Label as="p">{w.model}</Label>
              <span className="cor-seg" role="radiogroup" aria-label={w.modelOf(seatName(s.role))}>
                <button type="button" role="radio" aria-checked={!s.ownModel} className="cor-opt" onClick={() => set({ ...draft, strips: draft.strips.map((x) => (x.key === s.key ? setModel(x, null) : x)) })}>
                  {w.auto}
                </button>
                {MODELS.map((mo) => (
                  <button key={mo.id} type="button" role="radio" aria-checked={s.ownModel && s.model === mo.id} className="cor-opt" onClick={() => set({ ...draft, strips: draft.strips.map((x) => (x.key === s.key ? setModel(x, mo.id) : x)) })} data-model={mo.id}>
                    {mo.name}
                  </button>
                ))}
              </span>
            </div>
            <div>
              <Label as="p">{w.effort}</Label>
              <span className="cor-seg" role="radiogroup" aria-label={w.effortOf(seatName(s.role))}>
                <button type="button" role="radio" aria-checked={!s.ownEffort} className="cor-opt" onClick={() => set({ ...draft, strips: draft.strips.map((x) => (x.key === s.key ? setEffort(x, null) : x)) })}>
                  {w.auto}
                </button>
                {EFFORTS.map((e) => (
                  <button key={e} type="button" role="radio" aria-checked={s.ownEffort && s.effort === e} className="cor-opt" onClick={() => set({ ...draft, strips: draft.strips.map((x) => (x.key === s.key ? setEffort(x, e) : x)) })} data-effort={e}>
                    {effortWord(e)}
                  </button>
                ))}
              </span>
            </div>
            {!s.sub && counts && r && (
              <div>
                <Label as="p">{w.steps}</Label>
                <Stepper value={seatCap(counts, s.agent)} max={MAX.seat} onChange={(v) => setCounts({ ...counts, seats: { ...counts.seats, [s.agent]: v } })} label={w.stepsOf(seatName(s.role))} />
              </div>
            )}
            <Btn kind="quiet" onClick={() => set({ ...draft, strips: draft.strips.map((x) => (x.key === s.key ? clearStrip(x) : x)) })} data-control="motor-auto">
              {w.backToAuto}
            </Btn>
          </div>
        )}
      </li>
    );
  };
  const companyOpen = open === "compania";
  const planPct = r?.plan.pct ?? null;
  return (
    <div className="cor-motores" data-motores={p.slug}>
      <div className="cor-motores-main">
        <div className="cor-pedidos-head" style={{ borderBottom: 0, paddingBottom: 0 }}>
          <span>
            <h2 className="cor-h3" style={{ fontSize: 22 }}>
              {w.title}
            </h2>
            <span className="cor-text">{w.lead}</span>
            {signIn && (
              <span className="cor-cap" data-motores-sign-in style={{ display: "block" }}>
                {signIn}
              </span>
            )}
          </span>
          <span className="cor-acts" style={{ marginTop: 0 }} role="group" aria-label={w.setAll}>
            <Label>{w.setAll}</Label>
            {presetsOf().map((x) => (
              <Btn key={x.id} kind={x.id === "compania" ? "quiet" : "secondary"} onClick={() => set(applyPreset(draft, x.id))} data-control={`motor-preajuste-${x.id}`}>
                {x.label}
              </Btn>
            ))}
          </span>
        </div>
        <div className="cor-mhead" aria-hidden>
          <span className="cor-label">{w.seat}</span>
          <span className="cor-label">{w.motor}</span>
          <span className="cor-label">{w.tokens}</span>
          <span />
        </div>
        <ul className="cor-mlist">
          <li className={`cor-mrow ${companyOpen ? "open" : ""}`} data-strip="compania">
            <div className="cor-mrow-line">
              <span className="cor-mrow-who">
                <b>{w.company}</b>
                <span className="cor-cap">{w.inherited}</span>
              </span>
              <span className="cor-mrow-motor">
                {draft.company.model || draft.company.effort ? motorLine(draft.company.model, draft.company.effort) : w.companyUnset}
                {pend.company && <span className="cor-state amber">{w.unsaved}</span>}
              </span>
              <span className="cor-cap">—</span>
              <Btn kind="quiet" aria-expanded={companyOpen} onClick={() => setOpen(companyOpen ? null : "compania")} data-control="motor-cambiar">
                {companyOpen ? w.close : w.change}
              </Btn>
            </div>
            {companyOpen && (
              <div className="cor-mrow-edit">
                <div>
                  <Label as="p">{w.model}</Label>
                  <span className="cor-seg" role="radiogroup" aria-label={w.companyModel}>
                    <Opt on={!draft.company.model} onClick={() => set({ ...draft, company: { ...draft.company, model: null } })}>
                      {w.fromCli}
                    </Opt>
                    {MODELS.map((mo) => (
                      <Opt key={mo.id} on={draft.company.model === mo.id} onClick={() => set({ ...draft, company: { ...draft.company, model: mo.id } })}>
                        {mo.name}
                      </Opt>
                    ))}
                  </span>
                </div>
                <div>
                  <Label as="p">{w.effort}</Label>
                  <span className="cor-seg" role="radiogroup" aria-label={w.companyEffort}>
                    <Opt on={!draft.company.effort} onClick={() => set({ ...draft, company: { ...draft.company, effort: null } })}>
                      {w.fromCli}
                    </Opt>
                    {EFFORTS.map((e) => (
                      <Opt key={e} on={draft.company.effort === e} onClick={() => set({ ...draft, company: { ...draft.company, effort: e } })}>
                        {effortWord(e)}
                      </Opt>
                    ))}
                  </span>
                </div>
              </div>
            )}
          </li>
          {draft.strips.map(row)}
        </ul>
        {(n > 0 || msg) && (
          <div className="cor-savebar" data-pending={n} role="region" aria-label={w.unsavedRegion}>
            <p className="cor-text">{n > 0 ? <><b>{w.unsavedCount(n)}</b> {changeWords()}</> : <span className={`cor-state ${msg!.ok ? "ok" : "bad"}`}>{msg!.text}</span>}</p>
            {n > 0 && (
              <>
                <Btn kind="quiet" onClick={() => setState(null)} disabled={busy} data-control="motor-descartar">
                  {w.discard}
                </Btn>
                <Btn kind="primary" onClick={() => void save()} disabled={busy} data-control="motor-guardar">
                  {busy ? w.saving : w.save}
                </Btn>
              </>
            )}
          </div>
        )}
      </div>
      {r && counts && (
        <aside className="cor-motores-side">
          <section aria-label={w.planUse}>
            <Label as="h2">{w.planUseHead}</Label>
            <div className="cor-planline">
              <span className="cor-figure">{planPct === null ? "—" : `${Math.round(planPct)}%`}</span>
              <span className="cor-cap">{w.brake(r.plan.guard, r.plan.override)}</span>
            </div>
            <span className="cor-meter" aria-hidden>
              <i style={{ width: `${Math.min(100, planPct ?? 0)}%` }} />
              <u style={{ left: `${r.plan.guard}%` }} />
            </span>
            <p className="cor-text" data-plan-read>{planReadLine(r.plan, now, w)}</p>
            <p className="cor-text">
              {r.plan.override ? w.brakeOffLine : w.brakeLine}{" "}
              <Link className="cor-inline" to={planTo}>
                {w.plomeria}
              </Link>
              .
            </p>
          </section>
          <section aria-label={w.atOnce}>
            <Label as="h2">{w.atOnce}</Label>
            <ul>
              <li className="cor-krow">
                <span>
                  {w.agentsIn(p.title)}
                  <span className="cor-cap">{w.workingNow(r.live.work)}</span>
                </span>
                <Stepper value={counts.floor.max_concurrent} max={MAX.floor} onChange={(v) => setCounts({ ...counts, floor: { ...counts.floor, max_concurrent: v } })} label={w.agentsIn(p.title)} />
              </li>
              <li className="cor-krow">
                <span>
                  {w.perAgent}
                  <span className="cor-cap">{w.perAgentHint}</span>
                </span>
                <Stepper value={counts.floor.max_per_agent} max={MAX.perAgent} onChange={(v) => setCounts({ ...counts, floor: { ...counts.floor, max_per_agent: v } })} label={w.perAgent} />
              </li>
              <li className="cor-krow">
                <span>
                  {w.ceiling}
                  <span className="cor-cap">{w.ceilingHint}</span>
                </span>
                <Stepper value={counts.ceiling} max={MAX.ceiling} onChange={(v) => setCounts({ ...counts, ceiling: v })} label={w.ceiling} />
              </li>
            </ul>
          </section>
          <section aria-label={w.queue}>
            <Label as="h2">{w.queue}</Label>
            {preview && preview.verdicts.length ? (
              <ul className="cor-brief">
                {preview.verdicts.slice(0, 3).map((v) => (
                  <li key={v.run.run_id}>
                    <span>
                      <b>{v.run.title ?? v.run.ticket ?? w.aStep}</b> · {v.starts ? w.startsOnSave : v.text}
                      {v.fix && (
                        <>
                          {" "}
                          <Btn kind="link" onClick={() => setCounts(v.fix!.apply(counts))}>
                            {v.fix.label}
                          </Btn>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="cor-text" style={{ paddingTop: 8 }}>
                {w.nothingWaits}
              </p>
            )}
            {acts && <PorArrancar p={p} acts={acts} now={now} timeZone={timeZone} />}
          </section>
        </aside>
      )}
    </div>
  );
};
