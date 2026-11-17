// PLA-I59-3 (Motores): the floor's «Motores» tab in the ventanal, a mixing desk with one channel strip per teammate
// (a PO's Preguntar as its dashed sub-strip) and the «Compañía» master strip; the teammate's «Motor en <proyecto>»
// card; the engine chip on each Equipo seat. A strip: «De la compañía» / «Propio · ↺», the model knob (Auto H S O F),
// the effort fader (Auto → Máximo) and this week's share. Presets set every strip; Guardar sends one
// save (lib/motores.ts saveOf). Changes apply from each seat's next run; a live run keeps its flags.
import { useMemo, useState, type CSSProperties } from "react";
import { api, type MotoresSave, type OrgMember, type OrgProject, type RunnerLive, type RunnerView } from "@/lib/api";
import { MAX, countsOf, heldText, pendingCounts, previewAdmission, seatCap, sinceText, withCounts, type Counts, type Verdict } from "@/lib/a-la-vez";
import {
  AUTO_COLOR,
  EFFORTS,
  EFFORT_COLOR,
  EFFORT_WORD,
  MODELS,
  PRESETS,
  applyPreset,
  modelInfo,
  clearStrip,
  draftOf,
  hintOf,
  isOwn,
  motorLine,
  pendingOf,
  saveOf,
  setEffort,
  setModel,
  shownOf,
  type Draft,
  type EffortId,
  type ModelId,
  type Strip,
} from "@/lib/motores";
import { byRole, roleName } from "@/lib/org";
import { Figure } from "./figure";

export type MotorDefault = { model: string | null; effort: string | null } | undefined;
export type MotorSaveFn = (save: MotoresSave) => Promise<unknown>;

// Knob positions: Auto at the top, then H S O F round the dial.
const ANGLE: Record<string, number> = { auto: 0, haiku: -128, sonnet: -58, opus: 58, fable: 128 };
const colorOf = (m: ModelId | null) => MODELS.find((x) => x.id === m)?.color ?? AUTO_COLOR;
const nameOf = (m: ModelId | null) => MODELS.find((x) => x.id === m)?.name ?? "Auto";
const effortIndex = (e: EffortId | null) => (e ? EFFORTS.indexOf(e) + 1 : 0);

const Knob = ({ id, value, auto, label, onPick }: { id: string; value: ModelId | null; auto: string; label: string; onPick: (m: ModelId | null) => void }) => {
  const order: (ModelId | null)[] = [null, "haiku", "sonnet", "opus", "fable"];
  const next = order[(order.indexOf(value) + 1) % order.length]!;
  return (
    <div className="edi-mtr-knob" style={{ "--kc": colorOf(value) } as CSSProperties}>
      <div className="edi-mtr-lbls" role="radiogroup" aria-label={`Modelo de ${label}`}>
      <button type="button" className="edi-mtr-lbl" data-pos="auto" role="radio" aria-checked={value === null} onClick={() => onPick(null)} title={auto} aria-label={`Auto: ${auto}`} data-control="motor-modelo">
        A
      </button>
      {MODELS.map((m) => (
        <button key={m.id} type="button" className="edi-mtr-lbl" data-pos={m.id} role="radio" aria-checked={value === m.id} onClick={() => onPick(m.id)} title={`${m.name}: ${m.note}`} aria-label={m.name} data-control="motor-modelo">
          {m.letter}
        </button>
      ))}
      </div>
      <button type="button" className="edi-mtr-dial" id={id} style={{ transform: `rotate(${ANGLE[value ?? "auto"]}deg)` }} onClick={() => onPick(next)} aria-label={`Girar: ${nameOf(next)}`} data-control="motor-perilla" />
    </div>
  );
};

const Fader = ({ value, shown, label, onPick }: { value: EffortId | null; shown: EffortId | null; label: string; onPick: (e: EffortId | null) => void }) => {
  const i = effortIndex(value);
  const pct = `${(effortIndex(shown) / 5) * 100}%`;
  return (
    <div className="edi-mtr-fader">
      <div className="edi-mtr-notches" aria-hidden>
        {["Auto", ...EFFORTS.map((e) => EFFORT_WORD[e])].map((w, n) => (
          <span key={w} data-on={n === effortIndex(shown) ? "1" : undefined}>
            {w}
          </span>
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={5}
        step={1}
        value={i}
        aria-label={`Esfuerzo de ${label}`}
        aria-valuetext={value ? EFFORT_WORD[value] : `Auto (${shown ? EFFORT_WORD[shown] : "del CLI"})`}
        style={{ "--p": pct, "--ec": shown ? EFFORT_COLOR[shown] : AUTO_COLOR } as CSSProperties}
        onChange={(e) => {
          const n = Number(e.currentTarget.value);
          onPick(n === 0 ? null : EFFORTS[n - 1]!);
        }}
        data-control="motor-esfuerzo"
      />
    </div>
  );
};

const pctOf = (m: OrgMember | undefined) => (m?.used_week ? Math.round(m.used_week.share * 100) : null);

// PLA-I60-5: a stepper («−  N  +») for a count.
const Stepper = ({ id, value, min, max, label, onPick }: { id: string; value: number; min: number; max: number; label: string; onPick: (n: number) => void }) => (
  <span className="edi-par-step" role="group" aria-label={label}>
    <button type="button" disabled={value <= min} onClick={() => onPick(value - 1)} aria-label={`Uno menos: ${label}`} data-control={`${id}-menos`}>
      −
    </button>
    <output aria-live="polite">{value}</output>
    <button type="button" disabled={value >= max} onClick={() => onPick(value + 1)} aria-label={`Uno más: ${label}`} data-control={`${id}-mas`}>
      +
    </button>
  </span>
);

// PLA-I60-5: the seat's «a la vez»: one window per place, lit while a run is live (click: which one), striped when
// live beyond a lowered count (it finishes, it is not replaced), dashed when Guardar would start something there.
export type ParView = { cap: number; own: boolean; live: RunnerLive[]; queued: number; ghosts: number; sub: boolean; onPick: (n: number | null) => void; onOpen: (r: RunnerLive, at: HTMLElement) => void; inherit: number };
const Windows = ({ par, role }: { par: ParView; role: string }) => {
  const n = Math.max(par.cap, par.live.length);
  const slots = Array.from({ length: n }, (_, i) => i);
  return (
    <span className="edi-par-wins">
      {par.queued > 0 && <span className="edi-par-q" title={`${par.queued} en cola`}>+{par.queued}</span>}
      {slots.map((i) => {
        const r = par.live[i];
        if (r)
          return (
            <button key={r.run_id} type="button" className="edi-par-win" data-on="1" data-over={i >= par.cap ? "1" : undefined} title={i >= par.cap ? "Termina lo que hace; no se repone" : (r.title ?? "Trabajando")} onClick={(e) => par.onOpen(r, e.currentTarget)} aria-label={`Ver en qué trabaja: ${r.title ?? "trabajo"}`} data-control="motor-ventana">
              <Figure role={role} />
            </button>
          );
        return <span key={`f${i}`} className="edi-par-win" data-ghost={i - par.live.length < par.ghosts ? "1" : undefined} title={i - par.live.length < par.ghosts ? "Arranca al guardar" : "Lugar libre"} />;
      })}
    </span>
  );
};

const StripView = ({ d, s, m, onChange, par }: { d: Draft; s: Strip; m: OrgMember | undefined; onChange: (s: Strip) => void; par?: ParView }) => {
  const shown = shownOf(d, s);
  const label = s.sub ? "Preguntar" : roleName(s.role);
  const pct = pctOf(m);
  const autoWord = s.sub ? "Sigue al PO" : "Sigue a la compañía";
  return (
    <div className="edi-mtr-strip" data-strip={s.key} data-sub={s.sub ? "1" : undefined} data-own={isOwn(s) ? "1" : "0"}>
      <div className="edi-mtr-who">
        {s.sub ? (
          <span className="edi-mtr-q" aria-hidden>
            ?
          </span>
        ) : (
          <span className="edi-seat" data-state={m?.state === "running" ? "work" : "idle"} aria-hidden>
            <span className="edi-seat-glass">
              <Figure role={s.role} />
            </span>
          </span>
        )}
        <b>{label}</b>
        <small data-on={par?.live.length ? "1" : undefined}>
          {s.sub ? (par?.live.length ? "contestando" : "cuando preguntas") : par ? (par.live.length ? `trabajando en ${par.live.length}` : "sin trabajo") : m?.state === "running" ? "trabajando" : "sin trabajo"}
        </small>
      </div>
      {isOwn(s) ? (
        <button type="button" className="edi-mtr-own" data-own="1" onClick={() => onChange(clearStrip(s))} title={`Volver a: ${autoWord.toLowerCase()}`} data-control="motor-volver">
          Propio · ↺
        </button>
      ) : (
        <span className="edi-mtr-own">{s.sub ? "Del PO" : "De la compañía"}</span>
      )}
      <Knob id={`knob-${s.key}`} value={s.ownModel ? s.model : null} auto={`${autoWord} (${nameOf(shown.model)})`} label={label} onPick={(v) => onChange(setModel(s, v))} />
      <span className="edi-mtr-name" style={{ "--kc": colorOf(shown.model) } as CSSProperties}>
        {shown.model ? nameOf(shown.model) : "Del CLI"}
      </span>
      <Fader value={s.ownEffort ? s.effort : null} shown={shown.effort} label={label} onPick={(v) => onChange(setEffort(s, v))} />
      {par && (
        <div className="edi-par" data-sub={par.sub ? "1" : undefined}>
          <span className="edi-par-h">
            <span>A la vez</span>
            {par.sub ? (
              <span className="edi-par-inh" title="Carril propio: no comparte lugares con el trabajo">aparte</span>
            ) : par.own ? (
              <button type="button" className="edi-par-inh" data-own="1" onClick={() => par.onPick(null)} title={`Volver al del piso (${par.inherit})`} data-control="motor-alavez-volver">
                propio ↺
              </button>
            ) : (
              <span className="edi-par-inh" title="Sigue al «por agente» del piso">del piso</span>
            )}
          </span>
          <Windows par={par} role={s.role} />
          <Stepper id={`motor-alavez-${s.key}`} value={par.cap} min={par.sub ? 0 : 1} max={par.sub ? MAX.consulta : MAX.seat} label={`A la vez: ${label}`} onPick={(n) => par.onPick(n)} />
        </div>
      )}
      <span className="edi-mtr-use" title="Tokens de esta semana (entrada + salida) en este proyecto">
        <small>
          <span>Semana</span>
          <span>{s.sub ? "en el PO" : pct === null ? "sin datos" : `${pct}%`}</span>
        </small>
        <i style={{ "--u": `${pct ?? 0}%` } as CSSProperties} />
      </span>
    </div>
  );
};

export const MotoresConsole = ({ project: p, def, onSave }: { project: OrgProject; def: MotorDefault; onSave: MotorSaveFn }) => {
  const team = useMemo(() => [...p.team].sort(byRole), [p.team]);
  const saved = useMemo(() => draftOf(team, def), [team, def]);
  const savedCounts = useMemo(() => countsOf(p.runner, team), [p.runner, team]);
  // The draft belongs to what was read; a new read (after Guardar, or another screen) starts from it again.
  const sig = JSON.stringify([saved, savedCounts]);
  const [state, setState] = useState<{ sig: string; draft: Draft; counts: Counts | null } | null>(null);
  const draft = state && state.sig === sig ? state.draft : saved;
  const counts = state && state.sig === sig ? state.counts : savedCounts;
  const set = (d: Draft) => setState({ sig, draft: d, counts });
  const setCounts = (c: Counts) => setState({ sig, draft, counts: c });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [colaOpen, setColaOpen] = useState(false);
  const [card, setCard] = useState<{ run: RunnerLive; agent: string; x: number; y: number } | null>(null);
  const pend = pendingOf(saved, draft);
  const pc = pendingCounts(savedCounts, counts);
  const n = pend.strips.length + (pend.company ? 1 : 0) + pc.n;
  const hint = hintOf(team, draft);
  const r = p.runner;
  const preview = r && counts ? previewAdmission(r, counts, team, p.title) : null;
  const starts = preview?.verdicts.filter((v) => v.starts) ?? [];
  const waiting = preview?.verdicts.filter((v) => !v.starts) ?? [];
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await onSave(withCounts(saveOf(p.slug, saved, draft), savedCounts, counts));
      const started = starts.map((v) => titleOf(v));
      setMsg({ tone: "ok", text: `Guardado: ${n} ${n === 1 ? "cambio" : "cambios"}.${started.length ? ` Arranca: ${started.join(", ")}.` : " Corre así desde su próximo arranque."}` });
    } catch {
      setMsg({ tone: "err", text: "No se pudo guardar. Nada cambió; intenta otra vez." });
    } finally {
      setBusy(false);
    }
  };
  const company = draft.company;
  const parOf = (s: Strip): ParView | undefined => {
    if (!r || !counts) return undefined;
    const open = (run: RunnerLive, at: HTMLElement) => {
      const host = at.closest(".edi-mtr")?.getBoundingClientRect();
      const b = at.getBoundingClientRect();
      setCard({ run, agent: s.agent, x: host ? b.left - host.left : 0, y: host ? b.top - host.top : 0 });
    };
    if (s.sub) {
      const live: RunnerLive[] = Array.from({ length: r.live.consulta }, (_, i) => ({ run_id: `q${i}`, ticket: null, title: "Una pregunta", kind: "pregunta", since: null, model: null, effort: null }));
      return {
        cap: counts.floor.consulta_slots,
        own: false,
        live,
        queued: r.queue.filter((q) => q.lane === "consulta").length,
        ghosts: starts.filter((v) => v.run.lane === "consulta").length,
        sub: true,
        inherit: counts.floor.consulta_slots,
        onPick: (v) => setCounts({ ...counts, floor: { ...counts.floor, consulta_slots: v ?? 1 } }),
        onOpen: () => undefined,
      };
    }
    const seat = r.seats.find((x) => x.agent === s.agent);
    return {
      cap: seatCap(counts, s.agent),
      own: counts.seats[s.agent] != null,
      live: seat?.live ?? [],
      queued: waiting.filter((v) => v.run.agent === s.agent && v.run.lane === "work").length,
      ghosts: starts.filter((v) => v.run.agent === s.agent && v.run.lane === "work").length,
      sub: false,
      inherit: counts.floor.max_per_agent,
      onPick: (v) => setCounts({ ...counts, seats: { ...counts.seats, [s.agent]: v } }),
      onOpen: open,
    };
  };
  return (
    <div className="edi-mtr" data-motores={p.slug}>
      <div className="edi-mtr-top">
        <div className="edi-mtr-title">
          <h4>Motores de {p.title}</h4>
          <p>{r ? "Modelo, esfuerzo y cuántas cosas a la vez hace cada puesto." : "Modelo y esfuerzo de cada puesto aquí. Lo que no cambies sigue a la compañía."}</p>
        </div>
        <div className="edi-mtr-presets" role="group" aria-label="Preajustes">
          {PRESETS.map((x) => (
            <button
              key={x.id}
              type="button"
              className="edi-mtr-preset"
              onClick={() => {
                const d = applyPreset(draft, x.id);
                const c = counts ? presetCounts(counts, x.id) : null;
                setState({ sig, draft: d, counts: c });
              }}
              data-control={`motor-preajuste-${x.id}`}
            >
              {x.label}
              {x.note && <small>{x.note}{r && x.id === "rapido" ? " · 2" : r && x.id === "fondo" ? " · 1" : ""}</small>}
            </button>
          ))}
        </div>
      </div>
      {r && <PlanMeter r={r} add={preview?.planAdd ?? 0} />}
      {hint && (
        <div className="edi-mtr-hint" data-hint={hint.agent}>
          <span>
            {roleName(hint.role)} usó <b>{hint.pct}%</b> de esta semana en {nameOf(hint.on)}. Con Sonnet gastaría menos de tu límite.
          </span>
          <button
            type="button"
            onClick={() => set({ ...draft, strips: draft.strips.map((s) => (s.agent === hint.agent && !s.sub ? setModel(s, "sonnet") : s)) })}
            data-control="motor-sugerencia"
          >
            Probar Sonnet
          </button>
        </div>
      )}
      <div className="edi-mtr-desk" role="group" aria-label={`Consola de motores de ${p.title}`}>
        <div className="edi-mtr-strips" data-par={r ? "1" : undefined}>
          {draft.strips.map((s) => (
            <StripView key={s.key} d={draft} s={s} m={team.find((m) => m.agent === s.agent)} par={parOf(s)} onChange={(x) => set({ ...draft, strips: draft.strips.map((y) => (y.key === x.key ? x : y)) })} />
          ))}
          {r && counts && <FloorStrip p={p} r={r} counts={counts} waiting={waiting.length} onCounts={setCounts} onCola={() => setColaOpen((o) => !o)} />}
          <div className="edi-mtr-strip" data-strip="compania" data-master="1" data-own="1">
            <div className="edi-mtr-who">
              <span className="edi-mtr-tower" aria-hidden>
                <i />
                <i />
                <i />
                <i />
              </span>
              <b>Compañía</b>
              <small>todos los proyectos</small>
            </div>
            <span className="edi-mtr-own" data-master="1">
              Predeterminado
            </span>
            <Knob id="knob-compania" value={company.model} auto="El del CLI" label="la compañía" onPick={(v) => set({ ...draft, company: { ...company, model: v } })} />
            <span className="edi-mtr-name" style={{ "--kc": colorOf(company.model) } as CSSProperties}>
              {company.model ? nameOf(company.model) : "Del CLI"}
            </span>
            <Fader value={company.effort} shown={company.effort} label="la compañía" onPick={(v) => set({ ...draft, company: { ...company, effort: v } })} />
            {r && counts ? (
              <div className="edi-par edi-mac">
                <span className="edi-par-h">
                  <span>Tope de la Mac</span>
                </span>
                <span className="edi-mac-bar" aria-hidden>
                  {Array.from({ length: Math.max(counts.ceiling, r.ceiling.live) }, (_, i) => (
                    <i key={i} data-other={i < r.ceiling.live_other_projects ? "1" : undefined} data-on={i >= r.ceiling.live_other_projects && i < r.ceiling.live ? "1" : undefined} />
                  ))}
                </span>
                <Stepper id="motor-tope-mac" value={counts.ceiling} min={1} max={MAX.ceiling} label="Tope de la Mac" onPick={(v) => setCounts({ ...counts, ceiling: v })} />
                <small>
                  {r.ceiling.live} en uso · memoria para ~{r.ceiling.capacity}
                </small>
              </div>
            ) : (
              <span className="edi-mtr-use">
                <small>
                  <span>Aplica a</span>
                  <span>cada piso</span>
                </small>
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="edi-mtr-foot" data-dirty={n ? "1" : undefined}>
        <i aria-hidden />
        <span role="status">
          {msg?.text ??
            (n
              ? r
                ? `${n} ${n === 1 ? "cambio" : "cambios"} sin guardar · ${starts.length ? `al guardar arranca: ${starts.map(titleOf).join(", ")}` : "al guardar no arranca nada nuevo"}.`
                : `${n} ${n === 1 ? "cambio" : "cambios"} sin guardar · aplican desde la próxima corrida; lo que corre ahora no cambia.`
              : r
                ? "Todo guardado. Ventana encendida = trabajando."
                : "Todo guardado. Uso de la semana: tokens de entrada + salida de cada puesto en este proyecto.")}
        </span>
        {r && (
          <button type="button" className="edi-par-cola" data-empty={waiting.length ? undefined : "1"} onClick={() => setColaOpen((o) => !o)} aria-expanded={colaOpen} data-control="motor-cola">
            En cola <b>{waiting.length}</b>
          </button>
        )}
        <span className="edi-mtr-acts">
          <button type="button" className="edi-btn" disabled={!n || busy} onClick={() => setState(null)} data-control="motor-descartar">
            Descartar
          </button>
          <button type="button" className="edi-btn edi-mtr-save" disabled={!n || busy} onClick={() => void save()} data-control="motor-guardar">
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </span>
      </div>
      {r && counts && colaOpen && <ColaCard p={p} verdicts={preview!.verdicts} team={team} dirty={n > 0} onFix={(c) => setCounts(c(counts))} onClose={() => setColaOpen(false)} />}
      {card && <RunCard card={card} team={team} onClose={() => setCard(null)} />}
    </div>
  );
};

const titleOf = (v: Verdict): string => (v.run.kind === "pregunta" ? "una pregunta" : `«${v.run.title ?? "trabajo"}»`);

// Presets set the counts too: Rápido 2 per seat, A fondo 1, Equilibrado leaves them, Como la compañía: del piso.
function presetCounts(c: Counts, id: string): Counts {
  const all = (n: number | null) => Object.fromEntries(Object.keys(c.seats).map((a) => [a, n]));
  if (id === "rapido") return { ...c, seats: all(2) };
  if (id === "fondo") return { ...c, seats: all(1) };
  if (id === "compania") return { ...c, seats: all(null) };
  return c;
}

// ① The plan meter: the last 5-hour reading, what the runs that would start add (hatched), and the guard.
const PlanMeter = ({ r, add }: { r: RunnerView; add: number }) => {
  const pct = r.plan.pct;
  const now = pct == null ? 0 : Math.min(100, pct + r.plan.live_weight);
  const plus = Math.max(0, Math.min(100 - now, add));
  const over = now + plus >= r.plan.guard;
  return (
    <div className="edi-plan" data-state={r.plan.state}>
      <span>
        PLAN 5 H <b>{pct == null ? "—" : `${Math.round(pct)}%`}</b>
      </span>
      <span className="edi-plan-bar" role="img" aria-label={`Plan de 5 horas: ${pct == null ? "sin lectura" : `${Math.round(pct)} por ciento`}, tope ${r.plan.guard} por ciento`}>
        <i className="edi-plan-now" style={{ width: `${now}%` }} />
        {plus > 0 && <i className="edi-plan-add" data-over={over ? "1" : undefined} style={{ left: `${now}%`, width: `${plus}%` }} />}
        <i className="edi-plan-guard" style={{ left: `${r.plan.guard}%` }} />
      </span>
      <span className="edi-plan-est">{pct == null ? "sin lectura del plan" : plus > 0 ? `+~${Math.round(plus)}% si arranca lo que cabe · tope ${r.plan.guard}%` : `tope ${r.plan.guard}% · lo que corre ya está contado`}</span>
    </div>
  );
};

// ④ The project's own strip: «Agentes a la vez» and «Por agente» (what the seats inherit).
const FloorStrip = ({ p, r, counts, waiting, onCounts, onCola }: { p: OrgProject; r: RunnerView; counts: Counts; waiting: number; onCounts: (c: Counts) => void; onCola: () => void }) => {
  const cells = Math.max(counts.floor.max_concurrent, r.live.work);
  return (
    <div className="edi-mtr-strip" data-strip="piso" data-floor="1">
      <div className="edi-mtr-who">
        <span className="edi-floor-mark" aria-hidden>
          {p.title.slice(0, 1)}
        </span>
        <b>Piso {p.title}</b>
        <small>este proyecto</small>
      </div>
      <span className="edi-mtr-own" data-floor="1">
        Agentes a la vez
      </span>
      <div className="edi-floor-meter">
        <span className="edi-floor-big">
          {r.live.work}
          <small>de {counts.floor.max_concurrent}</small>
        </span>
        <span className="edi-floor-cells" aria-hidden>
          {Array.from({ length: cells }, (_, i) => (
            <i key={i} data-on={i < r.live.work && i < counts.floor.max_concurrent ? "1" : undefined} data-over={i < r.live.work && i >= counts.floor.max_concurrent ? "1" : undefined} />
          ))}
        </span>
        <Stepper id="motor-piso" value={counts.floor.max_concurrent} min={0} max={MAX.floor} label={`Agentes a la vez en ${p.title}`} onPick={(v) => onCounts({ ...counts, floor: { ...counts.floor, max_concurrent: v } })} />
      </div>
      <div className="edi-par">
        <span className="edi-par-h" style={{ justifyContent: "center" }}>
          <span>Por agente</span>
        </span>
        <Stepper id="motor-por-agente" value={counts.floor.max_per_agent} min={1} max={MAX.perAgent} label="Por agente" onPick={(v) => onCounts({ ...counts, floor: { ...counts.floor, max_per_agent: v } })} />
      </div>
      <button type="button" className="edi-par-link" onClick={onCola} data-control="motor-piso-cola">
        {waiting ? `${waiting} en cola ›` : "Cola vacía"}
      </button>
    </div>
  );
};

// ⑤ The queue: why each thing waits, and the number that would unblock it (only the draft changes; Guardar applies).
const ColaCard = ({ p, verdicts, team, dirty, onFix, onClose }: { p: OrgProject; verdicts: Verdict[]; team: OrgMember[]; dirty: boolean; onFix: (apply: (c: Counts) => Counts) => void; onClose: () => void }) => (
  <section className="edi-cola" aria-label={`En cola en ${p.title}`}>
    <div className="edi-cola-h">
      <div>
        <h5>En cola en {p.title}</h5>
        <p>Por qué espera cada cosa, y qué la destraba.</p>
      </div>
      <button type="button" className="edi-btn" onClick={onClose} aria-label="Cerrar la cola" data-control="motor-cola-cerrar">
        ✕
      </button>
    </div>
    {verdicts.length === 0 && <p className="edi-cola-empty">Nada espera. Lo pedido está en curso o hecho.</p>}
    {verdicts.map((v) => {
      const m = team.find((x) => x.agent === v.run.agent);
      return (
        <div key={v.run.run_id} className="edi-cola-i">
          <span className="edi-seat" aria-hidden>
            <span className="edi-seat-glass">
              <Figure role={m?.role ?? ""} />
            </span>
          </span>
          <b>{v.run.kind === "pregunta" ? "Una pregunta tuya" : (v.run.title ?? "Trabajo")}</b>
          <small>
            {m ? roleName(m.role) : v.run.agent} · {v.run.kind === "idea" ? "idea" : v.run.kind === "pregunta" ? "pregunta" : v.run.kind === "general" ? "revisión" : "ticket"} · espera {v.run.waited_min} min
          </small>
          {v.starts ? (
            <span className="edi-cola-why" data-ok="1">
              {dirty ? "Arranca al guardar" : "Arranca en segundos"}
            </span>
          ) : (
            <span className="edi-cola-why">
              {v.text || heldText(v.code, v.run.held_detail, m ? roleName(m.role) : v.run.agent)}
              {v.fix && (
                <button type="button" className="edi-cola-fix" onClick={() => onFix(v.fix!.apply)} data-control="motor-cola-arreglo">
                  {v.fix.label}
                </button>
              )}
            </span>
          )}
        </div>
      );
    })}
    <p className="edi-cola-f">Un arreglo cambia el borrador; se aplica al Guardar. Nada que ya corre se detiene.</p>
  </section>
);

// The card a lit window opens: what that run works on, since when, the motor it started with, Detener.
const RunCard = ({ card, team, onClose }: { card: { run: RunnerLive; agent: string; x: number; y: number }; team: OrgMember[]; onClose: () => void }) => {
  const m = team.find((x) => x.agent === card.agent);
  const [stopped, setStopped] = useState(false);
  return (
    <section className="edi-runcard" style={{ left: Math.max(8, card.x - 110), top: Math.max(8, card.y - 150) }} aria-label="En qué trabaja">
      <small>{m ? roleName(m.role) : card.agent} trabaja en</small>
      <b>{card.run.title ?? (card.run.kind === "general" ? "Revisión del proyecto" : "Trabajo")}</b>
      <small>
        {card.run.kind === "idea" ? "Idea" : card.run.kind === "general" ? "Revisión" : "Ticket"} · {sinceText(card.run.since)}
      </small>
      <span className="edi-mtr-lcd">{motorLine(card.run.model, card.run.effort)} (con el que arrancó)</span>
      <span className="edi-mtr-acts">
        <button type="button" className="edi-btn" onClick={onClose} data-control="motor-run-cerrar">
          Cerrar
        </button>
        <button
          type="button"
          className="edi-btn"
          disabled={stopped}
          onClick={() => {
            setStopped(true);
            void api.stopRun(card.run.run_id).catch(() => setStopped(false));
          }}
          data-control="motor-run-detener"
        >
          {stopped ? "Deteniendo…" : "Detener"}
        </button>
      </span>
    </section>
  );
};

// ---- the teammate's card (③)

export const MotorCard = ({ project: p, member: m, def, onSave, onAll }: { project: OrgProject; member: OrgMember; def: MotorDefault; onSave: MotorSaveFn; onAll?: () => void }) => {
  const saved = useMemo(() => draftOf([m], def), [m, def]);
  const sig = JSON.stringify(saved);
  const [state, setState] = useState<{ sig: string; draft: Draft } | null>(null);
  const draft = state && state.sig === sig ? state.draft : saved;
  const s = draft.strips.find((x) => !x.sub)!;
  const shown = shownOf(draft, s);
  const set = (x: Strip) => setState({ sig, draft: { ...draft, strips: draft.strips.map((y) => (y.key === x.key ? x : y)) } });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = pendingOf(saved, draft).strips.includes(s.key);
  const save = async () => {
    setBusy(true);
    try {
      await onSave(saveOf(p.slug, saved, { ...draft, strips: draft.strips.filter((x) => x.key === s.key) }));
      setMsg("Guardado. Corre así desde su próxima corrida.");
    } catch {
      setMsg("No se pudo guardar. Nada cambió.");
    } finally {
      setBusy(false);
    }
  };
  const company = motorLine(def?.model ?? null, def?.effort ?? null);
  return (
    <section className="edi-mtr-card" data-motor-card={m.agent} style={{ "--kc": colorOf(shown.model) } as CSSProperties} aria-label={`Motor en ${p.title}`}>
      <div className="edi-mtr-card-h">
        <h4 className="edi-eyebrow">Motor en {p.title}</h4>
        <span className="edi-mtr-lcd">{motorLine(shown.model, shown.effort)}</span>
        <small>{isOwn(s) ? "Propio de este proyecto" : "Sigue a la compañía"}</small>
      </div>
      <div className="edi-mtr-seg" role="radiogroup" aria-label="Modelo">
        {MODELS.map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={shown.model === x.id} style={{ "--kc": x.color } as CSSProperties} onClick={() => set(setModel(s, x.id))} data-control="motor-card-modelo">
            <b>{x.name}</b>
            <small>{x.note}</small>
          </button>
        ))}
      </div>
      <label className="edi-mtr-eff">
        <span>
          Esfuerzo: cuánto piensa antes de actuar <b>{shown.effort ? EFFORT_WORD[shown.effort] : "Auto"}</b>
        </span>
        <input
          type="range"
          min={0}
          max={5}
          step={1}
          value={s.ownEffort ? effortIndex(s.effort) : 0}
          aria-valuetext={shown.effort ? EFFORT_WORD[shown.effort] : "Auto"}
          style={{ "--p": `${(effortIndex(shown.effort) / 5) * 100}%`, "--ec": shown.effort ? EFFORT_COLOR[shown.effort] : AUTO_COLOR } as CSSProperties}
          onChange={(e) => {
            const n = Number(e.currentTarget.value);
            set(setEffort(s, n === 0 ? null : EFFORTS[n - 1]!));
          }}
          data-control="motor-card-esfuerzo"
        />
        <span className="edi-mtr-ticks" aria-hidden>
          {["Auto", ...EFFORTS.map((e) => EFFORT_WORD[e])].map((w, n) => (
            <span key={w} data-on={n === effortIndex(shown.effort) ? "1" : undefined}>
              {w}
            </span>
          ))}
        </span>
      </label>
      <div className="edi-mtr-card-f">
        {isOwn(s) ? (
          <button type="button" className="edi-mtr-link" onClick={() => set(clearStrip(s))} data-control="motor-card-volver">
            Volver al de la compañía ({company})
          </button>
        ) : (
          <span>Cambiarlo aquí lo vuelve propio de {p.title}.</span>
        )}
        <span className="edi-mtr-acts">
          {dirty && (
            <>
              <button type="button" className="edi-btn" onClick={() => setState(null)} disabled={busy} data-control="motor-card-descartar">
                Descartar
              </button>
              <button type="button" className="edi-btn edi-mtr-save" onClick={() => void save()} disabled={busy} data-control="motor-card-guardar">
                {busy ? "Guardando…" : "Guardar"}
              </button>
            </>
          )}
          {onAll && (
            <button type="button" className="edi-btn" onClick={onAll} data-control="motor-card-todos">
              Ver todos en Motores
            </button>
          )}
        </span>
      </div>
      {msg && (
        <p className="edi-mtr-msg" role="status">
          {msg}
        </p>
      )}
    </section>
  );
};

// ---- the Equipo chip (①)

// wide (La sala): the model's name and effort word instead of the letter.
export const EngineChip = ({ m, wide = false }: { m: OrgMember; wide?: boolean }) => {
  const v = m.motor;
  if (!v) return null;
  const info = modelInfo(v.model);
  const level = v.effort ? EFFORTS.indexOf(v.effort as EffortId) + 1 : 0;
  const own = v.own_model || v.own_effort;
  return (
    <span className="edi-mtr-chip" data-own={own ? "1" : "0"} style={{ "--kc": info?.color ?? AUTO_COLOR } as CSSProperties} title={`${motorLine(v.model, v.effort)}${own ? "" : " (de la compañía)"}`} aria-hidden>
      {wide ? motorLine(v.model, v.effort) : (info?.letter ?? "·")}
      <span>
        {EFFORTS.map((e, i) => (
          <i key={e} data-on={i < level ? "1" : undefined} />
        ))}
      </span>
    </span>
  );
};
