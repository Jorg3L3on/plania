// PLA-I59-3 (Motores): the words, colours and draft logic the floor's «Motores» console, the Equipo chips, the
// teammate's Motor card and Sumar share. Pure; the components hold the state.
// The rule the runner follows (src/runner/motor.ts): a seat's own value > the company default > the CLI's own.
// PLA-I2-10: the words are in MOTORES_LIB_WORDS, in both languages. MODELS, EFFORT_WORD and PRESETS keep their Spanish
// for their readers; the screen reads modelsOf(), effortWord() and presetsOf().
import type { MotorPatch, MotoresSave, MotorView, OrgMember } from "./api";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type ModelId = "haiku" | "sonnet" | "opus" | "fable";
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortId = (typeof EFFORTS)[number];
export type PresetId = "rapido" | "equilibrado" | "fondo" | "compania";

export const MOTORES_LIB_WORDS = defineWords({
  es: {
    note: { haiku: "Rápido y ligero", sonnet: "Equilibrado", opus: "El más usado hoy", fable: "Pruébalo en un puesto" } as Record<ModelId, string>,
    effort: { low: "Bajo", medium: "Medio", high: "Alto", xhigh: "Muy alto", max: "Máximo" } as Record<EffortId, string>,
    cli: "Modelo del CLI",
    preset: { rapido: "Rápido", equilibrado: "Equilibrado", fondo: "A fondo", compania: "Como la compañía" } as Record<PresetId, string>,
  },
  en: {
    note: { haiku: "Fast and light", sonnet: "Balanced", opus: "The most used today", fable: "Try it on one seat" },
    effort: { low: "Low", medium: "Medium", high: "High", xhigh: "Very high", max: "Max" },
    cli: "The CLI's model",
    preset: { rapido: "Fast", equilibrado: "Balanced", fondo: "Thorough", compania: "Same as the company" },
  },
});

const MODEL_LOOK: { id: ModelId; letter: string; name: string; color: string }[] = [
  { id: "haiku", letter: "H", name: "Haiku", color: "#3ddc97" },
  { id: "sonnet", letter: "S", name: "Sonnet", color: "#5ec8ff" },
  { id: "opus", letter: "O", name: "Opus", color: "#b094ff" },
  { id: "fable", letter: "F", name: "Fable", color: "#ff8fc4" },
];
export const modelsOf = (language: Language = getLanguage()): { id: ModelId; letter: string; name: string; note: string; color: string }[] =>
  MODEL_LOOK.map(({ color, ...m }) => ({ ...m, note: words(MOTORES_LIB_WORDS, language).note[m.id], color }));
/** The models with their Spanish notes, kept for their readers; the screen reads modelsOf(). */
export const MODELS: { id: ModelId; letter: string; name: string; note: string; color: string }[] = modelsOf("es");
export const AUTO_COLOR = "#8d94aa";

/** The Spanish words, kept for their readers; the screen reads effortWord(). */
export const EFFORT_WORD: Record<EffortId, string> = MOTORES_LIB_WORDS.es.effort;
export const effortWord = (e: EffortId, language: Language = getLanguage()): string => words(MOTORES_LIB_WORDS, language).effort[e];
export const EFFORT_COLOR: Record<EffortId, string> = { low: "#8d94aa", medium: "#5ec8ff", high: "#ffc145", xhigh: "#ff9f43", max: "#ff6b8a" };

// A stored model is an alias or a full id (claude-opus-5-5): its family, or null when it is none of the four.
export function familyOf(model: string | null | undefined): ModelId | null {
  if (!model) return null;
  const m = model.toLowerCase();
  return MODELS.find((x) => m === x.id || m.startsWith(`claude-${x.id}`))?.id ?? null;
}
export const modelInfo = (model: string | null | undefined) => MODELS.find((x) => x.id === familyOf(model)) ?? null;
export const effortOf = (e: string | null | undefined): EffortId | null => ((EFFORTS as readonly string[]).includes(e ?? "") ? (e as EffortId) : null);

// «Sonnet · alto», «Del CLI» when nothing is set.
export function motorLine(model: string | null, effort: string | null, language: Language = getLanguage()): string {
  const m = modelInfo(model)?.name ?? (model ? model : words(MOTORES_LIB_WORDS, language).cli);
  const e = effortOf(effort);
  return e ? `${m} · ${effortWord(e, language).toLowerCase()}` : m;
}

// ---- the console's draft

// One strip: a seat, or a PO's Preguntar (sub). own_* is what this strip sets itself; the rest follows the company.
export type Strip = { key: string; agent: string; role: string; sub: boolean; model: ModelId | null; effort: EffortId | null; ownModel: boolean; ownEffort: boolean };
export type Draft = { company: { model: ModelId | null; effort: EffortId | null }; strips: Strip[] };

const stripOf = (key: string, m: OrgMember, v: MotorView | null | undefined, sub: boolean): Strip => ({
  key,
  agent: m.agent,
  role: m.role,
  sub,
  model: v?.own_model ? familyOf(v.model) : null,
  effort: v?.own_effort ? effortOf(v.effort) : null,
  ownModel: !!v?.own_model,
  ownEffort: !!v?.own_effort,
});

// A Preguntar strip follows its PO seat before the company: its own values only are kept here.
export function draftOf(team: OrgMember[], def: { model: string | null; effort: string | null } | undefined): Draft {
  const strips: Strip[] = [];
  for (const m of team) {
    strips.push(stripOf(m.agent, m, m.motor, false));
    if (m.consulta_motor) strips.push(stripOf(`${m.agent}#preguntar`, m, m.consulta_motor, true));
  }
  return { company: { model: familyOf(def?.model), effort: effortOf(def?.effort) }, strips };
}

// What a strip runs on with this draft: its own part, else (Preguntar) its PO seat's, else the company's.
export function shownOf(d: Draft, s: Strip): { model: ModelId | null; effort: EffortId | null; fromCompany: { model: boolean; effort: boolean } } {
  const seat = s.sub ? d.strips.find((x) => x.agent === s.agent && !x.sub) : undefined;
  const model = s.ownModel ? s.model : seat?.ownModel ? seat.model : d.company.model;
  const effort = s.ownEffort ? s.effort : seat?.ownEffort ? seat.effort : d.company.effort;
  return { model, effort, fromCompany: { model: !s.ownModel && !seat?.ownModel, effort: !s.ownEffort && !seat?.ownEffort } };
}

export const setModel = (s: Strip, model: ModelId | null): Strip => ({ ...s, model, ownModel: model !== null });
export const setEffort = (s: Strip, effort: EffortId | null): Strip => ({ ...s, effort, ownEffort: effort !== null });
export const clearStrip = (s: Strip): Strip => ({ ...s, model: null, effort: null, ownModel: false, ownEffort: false });
export const isOwn = (s: Strip) => s.ownModel || s.ownEffort;

const same = (a: Strip, b: Strip) => a.ownModel === b.ownModel && a.ownEffort === b.ownEffort && (!a.ownModel || a.model === b.model) && (!a.ownEffort || a.effort === b.effort);

// The strips that differ from the saved draft, and whether the company default does.
export function pendingOf(saved: Draft, draft: Draft): { strips: string[]; company: boolean } {
  const strips = draft.strips.filter((s) => {
    const was = saved.strips.find((x) => x.key === s.key);
    return !was || !same(was, s);
  });
  const company = saved.company.model !== draft.company.model || saved.company.effort !== draft.company.effort;
  return { strips: strips.map((s) => s.key), company };
}

// The one request Guardar sends: per changed seat, its motor and/or Preguntar motor; the default when it moved.
export function saveOf(project: string, saved: Draft, draft: Draft): MotoresSave {
  const p = pendingOf(saved, draft);
  const patch = (s: Strip): MotorPatch | null => (isOwn(s) ? { model: s.ownModel ? s.model : null, effort: s.ownEffort ? s.effort : null } : null);
  const byAgent = new Map<string, { agent: string; motor?: MotorPatch | null; consulta_motor?: MotorPatch | null }>();
  for (const key of p.strips) {
    const s = draft.strips.find((x) => x.key === key)!;
    const row = byAgent.get(s.agent) ?? { agent: s.agent };
    if (s.sub) row.consulta_motor = patch(s);
    else row.motor = patch(s);
    byAgent.set(s.agent, row);
  }
  return {
    project,
    ...(byAgent.size ? { seats: [...byAgent.values()] } : {}),
    ...(p.company ? { company: { model: draft.company.model, effort: draft.company.effort } } : {}),
  };
}

// ---- presets

const PRESET_NOTE: Partial<Record<PresetId, string>> = { rapido: "Sonnet", fondo: "Opus" };
export const presetsOf = (language: Language = getLanguage()): { id: PresetId; label: string; note?: string }[] =>
  (["rapido", "equilibrado", "fondo", "compania"] as const).map((id) => ({
    id,
    label: words(MOTORES_LIB_WORDS, language).preset[id],
    ...(PRESET_NOTE[id] ? { note: PRESET_NOTE[id] } : {}),
  }));
/** The Spanish presets, kept for their readers; the screen reads presetsOf(). */
export const PRESETS: { id: PresetId; label: string; note?: string }[] = presetsOf("es");
type Pair = [ModelId, EffortId];
const PRESET_PAIRS: Record<Exclude<PresetId, "compania">, { seat: (role: string) => Pair; ask: Pair }> = {
  rapido: { seat: (r) => (r === "taller" || r === "artist" ? ["sonnet", "high"] : ["sonnet", "medium"]), ask: ["sonnet", "low"] },
  equilibrado: { seat: (r) => (r === "taller" || r === "artist" ? ["opus", "high"] : ["sonnet", "high"]), ask: ["sonnet", "medium"] },
  fondo: { seat: () => ["opus", "xhigh"], ask: ["opus", "high"] },
};

export function applyPreset(d: Draft, id: PresetId): Draft {
  if (id === "compania") return { ...d, strips: d.strips.map(clearStrip) };
  const p = PRESET_PAIRS[id];
  return {
    ...d,
    strips: d.strips.map((s) => {
      const [model, effort] = s.sub ? p.ask : p.seat(s.role);
      return { ...s, model, effort, ownModel: true, ownEffort: true };
    }),
  };
}

// ---- the usage hint

// One line when a seat that used a big share of this week's tokens runs on the heaviest models.
export const HINT_SHARE = 0.4;
export function hintOf(team: OrgMember[], d: Draft): { agent: string; role: string; pct: number; on: ModelId } | null {
  const big = [...team].filter((m) => (m.used_week?.share ?? 0) >= HINT_SHARE).sort((a, b) => (b.used_week!.share ?? 0) - (a.used_week!.share ?? 0))[0];
  if (!big) return null;
  const s = d.strips.find((x) => x.agent === big.agent && !x.sub);
  const on = s ? shownOf(d, s).model : null;
  if (on !== "opus" && on !== "fable") return null;
  return { agent: big.agent, role: big.role, pct: Math.round((big.used_week!.share ?? 0) * 100), on };
}

// PLA-144: the line under the plan meter. pct is null when the server judged the last reading stale (or there is none).
export function planReadLine(
  plan: { pct: number | null; read_at: string | null },
  now: number,
  w: { planRead: (ago: string) => string; planStale: (ago: string | null) => string; ago: (min: number) => string },
): string {
  const at = plan.read_at ? Date.parse(plan.read_at) : NaN;
  const ago = Number.isFinite(at) ? w.ago(Math.max(0, Math.floor((now - at) / 60_000))) : null;
  if (plan.pct === null) return w.planStale(ago);
  return ago ? w.planRead(ago) : "";
}
