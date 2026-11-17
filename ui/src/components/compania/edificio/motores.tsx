// PLA-I59-3 (Motores): the floor's «Motores» tab in the ventanal, a mixing desk with one channel strip per teammate
// (a PO's Preguntar as its dashed sub-strip) and the «Compañía» master strip; the teammate's «Motor en <proyecto>»
// card; the engine chip on each Equipo seat. A strip: «De la compañía» / «Propio · ↺», the model knob (Auto H S O F),
// the effort fader (Auto → Máximo) and this week's share. Presets set every strip; Guardar sends one
// save (lib/motores.ts saveOf). Changes apply from each seat's next run; a live run keeps its flags.
import { useMemo, useState, type CSSProperties } from "react";
import type { MotoresSave, OrgMember, OrgProject } from "@/lib/api";
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

const StripView = ({ d, s, m, onChange }: { d: Draft; s: Strip; m: OrgMember | undefined; onChange: (s: Strip) => void }) => {
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
        <small>{s.sub ? "cuando preguntas" : m?.state === "running" ? "trabajando" : "sin trabajo"}</small>
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
  // The draft belongs to what was read; a new read (after Guardar, or another screen) starts from it again.
  const sig = JSON.stringify(saved);
  const [state, setState] = useState<{ sig: string; draft: Draft } | null>(null);
  const draft = state && state.sig === sig ? state.draft : saved;
  const set = (d: Draft) => setState({ sig, draft: d });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const pend = pendingOf(saved, draft);
  const n = pend.strips.length + (pend.company ? 1 : 0);
  const hint = hintOf(team, draft);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await onSave(saveOf(p.slug, saved, draft));
      setMsg({ tone: "ok", text: `Guardado: ${n} ${n === 1 ? "cambio" : "cambios"}. Corre así desde su próxima corrida.` });
    } catch {
      setMsg({ tone: "err", text: "No se pudo guardar. Nada cambió; intenta otra vez." });
    } finally {
      setBusy(false);
    }
  };
  const company = draft.company;
  return (
    <div className="edi-mtr" data-motores={p.slug}>
      <div className="edi-mtr-top">
        <div className="edi-mtr-title">
          <h4>Motores de {p.title}</h4>
          <p>Modelo y esfuerzo de cada puesto aquí. Lo que no cambies sigue a la compañía.</p>
        </div>
        <div className="edi-mtr-presets" role="group" aria-label="Preajustes">
          {PRESETS.map((x) => (
            <button key={x.id} type="button" className="edi-mtr-preset" onClick={() => set(applyPreset(draft, x.id))} data-control={`motor-preajuste-${x.id}`}>
              {x.label}
              {x.note && <small>{x.note}</small>}
            </button>
          ))}
        </div>
      </div>
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
        <div className="edi-mtr-strips">
          {draft.strips.map((s) => (
            <StripView key={s.key} d={draft} s={s} m={team.find((m) => m.agent === s.agent)} onChange={(x) => set({ ...draft, strips: draft.strips.map((y) => (y.key === x.key ? x : y)) })} />
          ))}
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
            <span className="edi-mtr-use">
              <small>
                <span>Aplica a</span>
                <span>cada piso</span>
              </small>
            </span>
          </div>
        </div>
      </div>
      <div className="edi-mtr-foot" data-dirty={n ? "1" : undefined}>
        <i aria-hidden />
        <span role="status">
          {msg?.text ?? (n ? `${n} ${n === 1 ? "cambio" : "cambios"} sin guardar · aplican desde la próxima corrida; lo que corre ahora no cambia.` : "Todo guardado. Uso de la semana: tokens de entrada + salida de cada puesto en este proyecto.")}
        </span>
        <span className="edi-mtr-acts">
          <button type="button" className="edi-btn" disabled={!n || busy} onClick={() => setState(null)} data-control="motor-descartar">
            Descartar
          </button>
          <button type="button" className="edi-btn edi-mtr-save" disabled={!n || busy} onClick={() => void save()} data-control="motor-guardar">
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </span>
      </div>
    </div>
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
