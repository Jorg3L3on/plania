// PLA-I62-8: Motores (board D1), the building's console redrawn on the same draft (lib/motores.ts) and «a la vez»
// counts (lib/a-la-vez.ts). One line per seat with its motor in words and Cambiar; open, the model and the effort as
// segmented choices and the seat's steps at a time; presets for all; the plan's use, how much work at once (project,
// per agent, the Mac's ceiling) and the queue on the right; one save bar (PUT /company/motores, all or nothing).
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { MotoresSave, OrgProject } from "@/lib/api";
import { MAX, countsOf, pendingCounts, previewAdmission, seatCap, withCounts, type Counts } from "@/lib/a-la-vez";
import { seatName, thousands } from "@/lib/corriente";
import { EFFORTS, EFFORT_WORD, MODELS, PRESETS, applyPreset, clearStrip, draftOf, isOwn, motorLine, pendingOf, saveOf, setEffort, setModel, shownOf, type Draft, type Strip } from "@/lib/motores";
import { byRole } from "@/lib/org";
import { Btn, Label, Opt } from "./parts";

const Stepper = ({ value, min = 1, max, onChange, label }: { value: number; min?: number; max: number; onChange: (v: number) => void; label: string }) => (
  <span className="cor-stepper" role="group" aria-label={label}>
    <Btn kind="quiet" small aria-label={`Menos: ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
      −
    </Btn>
    <b className="cor-mono" aria-live="polite">
      {value}
    </b>
    <Btn kind="quiet" small aria-label={`Más: ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
      +
    </Btn>
  </span>
);

const lineOf = (d: Draft, s: Strip) => {
  const v = shownOf(d, s);
  const word = v.model || v.effort ? motorLine(v.model, v.effort) : "Auto";
  const from = v.fromCompany.model && v.fromCompany.effort ? (s.sub ? "sigue al PO" : "sigue a la compañía") : isOwn(s) ? "propio" : "sigue al PO";
  return { word, from };
};

export const Motores = ({ p, def, onSave, planTo }: { p: OrgProject; def?: { model: string | null; effort: string | null }; onSave: (s: MotoresSave) => Promise<unknown>; planTo: string }) => {
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
      setMsg({ ok: true, text: `Guardado: ${n} ${n === 1 ? "cambio" : "cambios"}. Corre así desde su próximo arranque.` });
    } catch {
      setMsg({ ok: false, text: "No se pudo guardar. Nada cambió; intenta otra vez." });
    } finally {
      setBusy(false);
    }
  };
  const changeWords = () => {
    const first = pend.strips[0] ? draft.strips.find((s) => s.key === pend.strips[0]) : null;
    if (first) return `${seatName(first.role)}${first.sub ? " al contestar Preguntar" : ""} pasa a ${lineOf(draft, first).word} desde su próximo paso; lo que corre ahora no cambia.`;
    if (pend.company) return `La compañía pasa a ${motorLine(draft.company.model, draft.company.effort)}.`;
    return "Cambia cuánto trabajo va a la vez.";
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
            <b>{s.sub ? "al contestar Preguntar" : seatName(s.role)}</b>
          </span>
          <span className="cor-mrow-motor">
            {l.word}
            <span className={`cor-state ${dirty ? "amber" : l.from === "propio" ? "live" : ""}`}>{dirty ? `${l.from} · sin guardar` : l.from}</span>
          </span>
          <span className="cor-cap">{tokens}</span>
          <Btn kind="quiet" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.key)} data-control="motor-cambiar">
            {isOpen ? "Cerrar" : "Cambiar"}
          </Btn>
        </div>
        {isOpen && (
          <div className="cor-mrow-edit">
            <div>
              <Label as="p">Modelo</Label>
              <span className="cor-seg" role="radiogroup" aria-label={`Modelo de ${seatName(s.role)}`}>
                <button type="button" role="radio" aria-checked={!s.ownModel} className="cor-opt" onClick={() => set({ ...draft, strips: draft.strips.map((x) => (x.key === s.key ? setModel(x, null) : x)) })}>
                  Auto
                </button>
                {MODELS.map((mo) => (
                  <button key={mo.id} type="button" role="radio" aria-checked={s.ownModel && s.model === mo.id} className="cor-opt" onClick={() => set({ ...draft, strips: draft.strips.map((x) => (x.key === s.key ? setModel(x, mo.id) : x)) })} data-model={mo.id}>
                    {mo.name}
                  </button>
                ))}
              </span>
            </div>
            <div>
              <Label as="p">Esfuerzo</Label>
              <span className="cor-seg" role="radiogroup" aria-label={`Esfuerzo de ${seatName(s.role)}`}>
                <button type="button" role="radio" aria-checked={!s.ownEffort} className="cor-opt" onClick={() => set({ ...draft, strips: draft.strips.map((x) => (x.key === s.key ? setEffort(x, null) : x)) })}>
                  Auto
                </button>
                {EFFORTS.map((e) => (
                  <button key={e} type="button" role="radio" aria-checked={s.ownEffort && s.effort === e} className="cor-opt" onClick={() => set({ ...draft, strips: draft.strips.map((x) => (x.key === s.key ? setEffort(x, e) : x)) })} data-effort={e}>
                    {EFFORT_WORD[e]}
                  </button>
                ))}
              </span>
            </div>
            {!s.sub && counts && r && (
              <div>
                <Label as="p">Pasos a la vez</Label>
                <Stepper value={seatCap(counts, s.agent)} max={MAX.seat} onChange={(v) => setCounts({ ...counts, seats: { ...counts.seats, [s.agent]: v } })} label={`Pasos a la vez de ${seatName(s.role)}`} />
              </div>
            )}
            <Btn kind="quiet" onClick={() => set({ ...draft, strips: draft.strips.map((x) => (x.key === s.key ? clearStrip(x) : x)) })} data-control="motor-auto">
              Volver a Auto
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
              Con qué trabaja cada puesto
            </h2>
            <span className="cor-text">Auto sigue a la compañía. Más esfuerzo gasta más plan.</span>
          </span>
          <span className="cor-acts" style={{ marginTop: 0 }} role="group" aria-label="Poner a todos en">
            <Label>Poner a todos en</Label>
            {PRESETS.map((x) => (
              <Btn key={x.id} kind={x.id === "compania" ? "quiet" : "secondary"} onClick={() => set(applyPreset(draft, x.id))} data-control={`motor-preajuste-${x.id}`}>
                {x.label}
              </Btn>
            ))}
          </span>
        </div>
        <div className="cor-mhead" aria-hidden>
          <span className="cor-label">Puesto</span>
          <span className="cor-label">Motor</span>
          <span className="cor-label">Tokens / semana</span>
          <span />
        </div>
        <ul className="cor-mlist">
          <li className={`cor-mrow ${companyOpen ? "open" : ""}`} data-strip="compania">
            <div className="cor-mrow-line">
              <span className="cor-mrow-who">
                <b>Compañía</b>
                <span className="cor-cap">la heredan todos</span>
              </span>
              <span className="cor-mrow-motor">
                {draft.company.model || draft.company.effort ? motorLine(draft.company.model, draft.company.effort) : "Sin fijar · usa el modelo que traiga Claude Code"}
                {pend.company && <span className="cor-state amber">sin guardar</span>}
              </span>
              <span className="cor-cap">—</span>
              <Btn kind="quiet" aria-expanded={companyOpen} onClick={() => setOpen(companyOpen ? null : "compania")} data-control="motor-cambiar">
                {companyOpen ? "Cerrar" : "Cambiar"}
              </Btn>
            </div>
            {companyOpen && (
              <div className="cor-mrow-edit">
                <div>
                  <Label as="p">Modelo</Label>
                  <span className="cor-seg" role="radiogroup" aria-label="Modelo de la compañía">
                    <Opt on={!draft.company.model} onClick={() => set({ ...draft, company: { ...draft.company, model: null } })}>
                      Del CLI
                    </Opt>
                    {MODELS.map((mo) => (
                      <Opt key={mo.id} on={draft.company.model === mo.id} onClick={() => set({ ...draft, company: { ...draft.company, model: mo.id } })}>
                        {mo.name}
                      </Opt>
                    ))}
                  </span>
                </div>
                <div>
                  <Label as="p">Esfuerzo</Label>
                  <span className="cor-seg" role="radiogroup" aria-label="Esfuerzo de la compañía">
                    <Opt on={!draft.company.effort} onClick={() => set({ ...draft, company: { ...draft.company, effort: null } })}>
                      Del CLI
                    </Opt>
                    {EFFORTS.map((e) => (
                      <Opt key={e} on={draft.company.effort === e} onClick={() => set({ ...draft, company: { ...draft.company, effort: e } })}>
                        {EFFORT_WORD[e]}
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
          <div className="cor-savebar" data-pending={n} role="region" aria-label="Cambios sin guardar">
            <p className="cor-text">{n > 0 ? <><b>{n === 1 ? "1 cambio sin guardar." : `${n} cambios sin guardar.`}</b> {changeWords()}</> : <span className={`cor-state ${msg!.ok ? "ok" : "bad"}`}>{msg!.text}</span>}</p>
            {n > 0 && (
              <>
                <Btn kind="quiet" onClick={() => setState(null)} disabled={busy} data-control="motor-descartar">
                  Descartar
                </Btn>
                <Btn kind="primary" onClick={() => void save()} disabled={busy} data-control="motor-guardar">
                  {busy ? "Guardando…" : "Guardar"}
                </Btn>
              </>
            )}
          </div>
        )}
      </div>
      {r && counts && (
        <aside className="cor-motores-side">
          <section aria-label="Uso del plan">
            <Label as="h2">Uso del plan en las últimas 5 horas</Label>
            <div className="cor-planline">
              <span className="cor-figure">{planPct === null ? "—" : `${Math.round(planPct)}%`}</span>
              <span className="cor-cap">{`FRENO EN ${r.plan.guard}%${r.plan.override ? " · SIN FRENO" : ""}`}</span>
            </div>
            <span className="cor-meter" aria-hidden>
              <i style={{ width: `${Math.min(100, planPct ?? 0)}%` }} />
              <u style={{ left: `${r.plan.guard}%` }} />
            </span>
            <p className="cor-text">
              Arriba del freno no arranca nada nuevo. Se mueve en{" "}
              <Link className="cor-inline" to={planTo}>
                Plomería
              </Link>
              .
            </p>
          </section>
          <section aria-label="Cuánto trabajo a la vez">
            <Label as="h2">Cuánto trabajo a la vez</Label>
            <ul>
              <li className="cor-krow">
                <span>
                  Agentes en {p.title}
                  <span className="cor-cap">{`${r.live.work} trabajando ahora`}</span>
                </span>
                <Stepper value={counts.floor.max_concurrent} max={MAX.floor} onChange={(v) => setCounts({ ...counts, floor: { ...counts.floor, max_concurrent: v } })} label={`Agentes en ${p.title}`} />
              </li>
              <li className="cor-krow">
                <span>
                  Pasos por agente<span className="cor-cap">lo hereda cada puesto</span>
                </span>
                <Stepper value={counts.floor.max_per_agent} max={MAX.perAgent} onChange={(v) => setCounts({ ...counts, floor: { ...counts.floor, max_per_agent: v } })} label="Pasos por agente" />
              </li>
              <li className="cor-krow">
                <span>
                  Tope de la Mac<span className="cor-cap">todos los proyectos juntos</span>
                </span>
                <Stepper value={counts.ceiling} max={MAX.ceiling} onChange={(v) => setCounts({ ...counts, ceiling: v })} label="Tope de la Mac" />
              </li>
            </ul>
          </section>
          <section aria-label="En cola">
            <Label as="h2">En cola</Label>
            {preview && preview.verdicts.length ? (
              <ul className="cor-brief">
                {preview.verdicts.slice(0, 3).map((v) => (
                  <li key={v.run.run_id}>
                    <span>
                      <b>{v.run.title ?? v.run.ticket ?? "Un paso"}</b> · {v.starts ? "arranca al guardar" : v.text}
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
                Nada espera turno.
              </p>
            )}
          </section>
        </aside>
      )}
    </div>
  );
};
