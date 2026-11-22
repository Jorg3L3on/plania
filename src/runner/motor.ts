// PLA-I59-1 (Motores): which model and effort a run asks the Claude CLI for. One rule for every run:
//   QA lane model (its review size picks it, src/runner/qa-settings.ts) > the seat's own value (a Preguntar run reads
//   the seat's consulta_* first) > the company default (runner_settings) > nothing (no flag: the CLI's default, as
//   before Motores). Model and effort resolve on their own. A change applies from the next run; a live run keeps
//   the flags it started with.
// Stored in their own columns, never in adapter_config: that one holds environment-variable names only, and a
// non-empty config makes untouchedAdapter (runner/team.ts) stop repairing the agent.

export const MODEL_ALIASES = ["haiku", "sonnet", "opus", "fable"] as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

// An alias, or a full id such as claude-opus-5-5 (optionally with the CLI's [1m] context suffix).
const MODEL_RE = /^(haiku|sonnet|opus|fable|claude-[a-z0-9.-]{3,60}(\[1m\])?)$/;
export const MODEL_HINT = "haiku, sonnet, opus, fable or a full id like claude-opus-5-5";
export const EFFORT_HINT = "low, medium, high, xhigh or max";

export const isModel = (v: string): boolean => MODEL_RE.test(v);
export const isEffort = (v: string): v is Effort => (EFFORTS as readonly string[]).includes(v);

// Trims and lowercases; "" means clear (null). Returns undefined for a value that is not allowed.
export function cleanModel(v: string | null | undefined): string | null | undefined {
  if (v === null) return null;
  if (v === undefined) return undefined;
  const t = v.trim().toLowerCase();
  if (t === "") return null;
  return isModel(t) ? t : undefined;
}
export function cleanEffort(v: string | null | undefined): Effort | null | undefined {
  if (v === null) return null;
  if (v === undefined) return undefined;
  const t = v.trim().toLowerCase();
  if (t === "") return null;
  return isEffort(t) ? t : undefined;
}

export type MotorSource = "qa" | "consulta" | "seat" | "company" | "cli" | "step";
export type Motor = { model: string | null; effort: Effort | null; source: { model: MotorSource; effort: MotorSource } };

export type MotorInput = {
  // The QA lane's model for this review (null: the lane leaves it to the rule below).
  qaModel?: string | null;
  // A Preguntar run: the seat's consulta_* values are read first.
  consulta?: boolean;
  seat: { model: string | null; effort: string | null; consultaModel?: string | null; consultaEffort?: string | null };
  company: { model: string | null; effort: string | null };
  // PLA-I73-6: the effort the plan gave this step (high for the skeleton), over the seat's.
  stepEffort?: string | null;
};

const effortOf = (v: string | null | undefined): Effort | null => (v && isEffort(v) ? v : null);

export function resolveMotor(i: MotorInput): Motor {
  const pick = <T>(cands: [T | null | undefined, MotorSource][]): [T | null, MotorSource] => {
    for (const [v, s] of cands) if (v !== null && v !== undefined && v !== "") return [v, s];
    return [null, "cli"];
  };
  const [model, ms] = pick<string>([
    [i.qaModel, "qa"],
    [i.consulta ? i.seat.consultaModel : null, "consulta"],
    [i.seat.model, "seat"],
    [i.company.model, "company"],
  ]);
  const [effort, es] = pick<Effort>([
    [i.consulta ? effortOf(i.seat.consultaEffort) : null, "consulta"],
    [i.consulta ? null : effortOf(i.stepEffort), "step"],
    [effortOf(i.seat.effort), "seat"],
    [effortOf(i.company.effort), "company"],
  ]);
  return { model, effort, source: { model: ms, effort: es } };
}
