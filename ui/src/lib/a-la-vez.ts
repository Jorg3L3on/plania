// PLA-I60-5: «a la vez» in Motores. Pure: the console holds the state. The counts are a second part of the draft
// (next to model and effort): a seat's own count (null: del piso), the project's floor, and the machine's ceiling.
// previewAdmission mirrors the server's admission (src/runner/runner.ts admit) on the screen's data, so the footer
// can say what Guardar would start and the queue can say why each thing waits, with a one-click fix when a number
// would unblock it. It is a preview: the server decides.
// What Motores reads about «a la vez» (src/api/company-runner.ts). Tests load this file directly: its only import is
// the pure lib/i18n.ts (PLA-I2-10: the words in both languages).
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export const A_LA_VEZ = defineWords({
  es: {
    queueEmpty: "Cola vacía",
    queued: (queued: number, fits: number) => `${queued} en cola${fits ? ` · ${fits} ${fits === 1 ? "arranca" : "arrancan"}` : ""}`,
    waitMachine: (live: number, max: number, others: boolean) => `Esperando lugar en la máquina (${live} de ${max}${others ? ", contando otros proyectos" : ""})`,
    raiseCeiling: (next: number) => `Subir el tope de la máquina a ${next}`,
    planWould: (pct: number, guard: number) => `El plan llegaría a ${pct} % (tope ${guard} %); sigue cuando baje`,
    waitQuestions: (n: number) => `Esperando: ya hay ${n} ${n === 1 ? "pregunta" : "preguntas"} en curso`,
    allowQuestions: (next: number) => `Dejar ${next} preguntas a la vez`,
    waitProject: (project: string, work: number, max: number) => `Esperando lugar: ${project} ya tiene ${work} de ${max} trabajando`,
    allowProject: (next: number, project: string) => `Dejar ${next} a la vez en ${project}`,
    waitAgent: (who: string, used: number) => `Esperando: ${who} ya hace ${used} ${used === 1 ? "cosa" : "cosas"} a la vez`,
    allowAgent: (who: string, next: number) => `Dejar que ${who} haga ${next}`,
    heldProject: (running: number | string, cap: number | string) => `Esperando lugar en el proyecto (${running} de ${cap})`,
    heldAgent: (who: string, running: number | string) => `Esperando: ${who} ya hace ${running} a la vez`,
    heldCeiling: (running: number | string, cap: number | string) => `Esperando lugar en la máquina (${running} de ${cap})`,
    heldMachine: "La máquina está corta de memoria o disco; arranca en cuanto se libere",
    heldStartRate: (perMinute: number | string) => `Arrancando de a poco (${perMinute} por minuto)`,
    heldPlan: (pct: number | string, guard: number | string) => `El plan va en ${pct} % (tope ${guard} %); sigue cuando baje`,
    heldRest: (who: string) => `${who} descansa entre corridas`,
    heldLock: "Espera a que termine el trabajo en la misma rama o ticket",
    heldSeatPaused: (who: string) => `${who} está en pausa: lo reanudas desde su ficha en Equipo`,
    heldAreas: "Espera: otro trabajo toca los mismos archivos",
    heldAreasFiles: (other: string, files: string) => `Espera a ${other}: cambia ${files}`,
    heldAreasWith: (other: string) => `Espera a ${other}: toca los mismos archivos`,
    inQueue: "En cola",
    justStarted: "acaba de arrancar",
    forMin: (m: number) => `lleva ${m} min`,
    forHours: (h: number, m: number) => `lleva ${h} h ${m} min`,
  },
  en: {
    queueEmpty: "Queue empty",
    queued: (queued: number, fits: number) => `${queued} queued${fits ? ` · ${fits} ${fits === 1 ? "starts" : "start"}` : ""}`,
    waitMachine: (live: number, max: number, others: boolean) => `Waiting for room on the machine (${live} of ${max}${others ? ", counting other projects" : ""})`,
    raiseCeiling: (next: number) => `Raise the machine's limit to ${next}`,
    planWould: (pct: number, guard: number) => `The plan would reach ${pct} % (limit ${guard} %); it goes on when it drops`,
    waitQuestions: (n: number) => `Waiting: ${n} ${n === 1 ? "question is" : "questions are"} already in progress`,
    allowQuestions: (next: number) => `Allow ${next} questions at once`,
    waitProject: (project: string, work: number, max: number) => `Waiting for room: ${project} already has ${work} of ${max} working`,
    allowProject: (next: number, project: string) => `Allow ${next} at once in ${project}`,
    waitAgent: (who: string, used: number) => `Waiting: ${who} is already doing ${used} ${used === 1 ? "thing" : "things"} at once`,
    allowAgent: (who: string, next: number) => `Let ${who} do ${next}`,
    heldProject: (running: number | string, cap: number | string) => `Waiting for room in the project (${running} of ${cap})`,
    heldAgent: (who: string, running: number | string) => `Waiting: ${who} is already doing ${running} at once`,
    heldCeiling: (running: number | string, cap: number | string) => `Waiting for room on the machine (${running} of ${cap})`,
    heldMachine: "The machine is short on memory or disk; it starts as soon as some frees up",
    heldStartRate: (perMinute: number | string) => `Starting a few at a time (${perMinute} a minute)`,
    heldPlan: (pct: number | string, guard: number | string) => `The plan is at ${pct} % (limit ${guard} %); it goes on when it drops`,
    heldRest: (who: string) => `${who} rests between runs`,
    heldLock: "Waits for the work on the same branch or ticket to end",
    heldSeatPaused: (who: string) => `${who} is paused: resume it from its panel in Equipo`,
    heldAreas: "Waits: other work touches the same files",
    heldAreasFiles: (other: string, files: string) => `Waits for ${other}: it changes ${files}`,
    heldAreasWith: (other: string) => `Waits for ${other}: it touches the same files`,
    inQueue: "Queued",
    justStarted: "just started",
    forMin: (m: number) => `${m} min in`,
    forHours: (h: number, m: number) => `${h} h ${m} min in`,
  },
});
export type RunnerHeld = "project_cap" | "agent_cap" | "ceiling" | "machine" | "start_rate" | "plan" | "rest" | "lock" | "areas" | "seat_paused";
export type RunnerLive = { run_id: string; ticket: string | null; title: string | null; kind: "ticket" | "idea" | "pregunta" | "general"; since: string | null; model: string | null; effort: string | null };
export type RunnerQueued = {
  run_id: string;
  agent: string;
  lane: "work" | "consulta";
  ticket: string | null;
  title: string | null;
  kind: RunnerLive["kind"];
  waited_min: number;
  held_code: RunnerHeld | null;
  held_detail: Record<string, unknown> | null;
  weight: number;
};
export type RunnerSeat = { agent: string; max_parallel: number | null; cap: number; live: RunnerLive[]; queued: number };
export type RunnerView = {
  limits: { max_concurrent: number; consulta_slots: number; max_per_agent: number; serialize_areas: boolean };
  live: { work: number; consulta: number };
  ceiling: { max: number; live: number; live_other_projects: number; reserved: number; capacity: number };
  plan: { pct: number | null; read_at: string | null; guard: number; state: string; override: boolean; est_pct: number; live_weight: number };
  queue: RunnerQueued[];
  seats: RunnerSeat[];
};
// Structural stand-ins for api.ts's OrgMember and MotoresSave (only the fields used here).
type OrgMember = { agent: string; role: string };
type MotoresSave = {
  project: string;
  seats?: { agent: string; motor?: unknown; consulta_motor?: unknown; max_parallel?: number | null }[];
  floor?: { max_concurrent?: number; max_per_agent?: number; consulta_slots?: number };
  company?: { model?: string | null; effort?: string | null; max_concurrent?: number };
};

export type Counts = {
  seats: Record<string, number | null>;
  floor: { max_concurrent: number; max_per_agent: number; consulta_slots: number };
  ceiling: number;
};

export const MAX = { seat: 6, floor: 12, perAgent: 6, consulta: 6, ceiling: 12 };

export function countsOf(r: RunnerView | undefined, team: OrgMember[]): Counts | null {
  if (!r) return null;
  const seats: Record<string, number | null> = {};
  for (const m of team) seats[m.agent] = r.seats.find((s) => s.agent === m.agent)?.max_parallel ?? null;
  return { seats, floor: { max_concurrent: r.limits.max_concurrent, max_per_agent: r.limits.max_per_agent, consulta_slots: r.limits.consulta_slots }, ceiling: r.ceiling.max };
}

export const seatCap = (c: Counts, agent: string): number => c.seats[agent] ?? c.floor.max_per_agent;

export function pendingCounts(saved: Counts | null, draft: Counts | null): { seats: string[]; floor: boolean; ceiling: boolean; n: number } {
  if (!saved || !draft) return { seats: [], floor: false, ceiling: false, n: 0 };
  const seats = Object.keys(draft.seats).filter((a) => (saved.seats[a] ?? null) !== (draft.seats[a] ?? null));
  const floor = (["max_concurrent", "max_per_agent", "consulta_slots"] as const).filter((k) => saved.floor[k] !== draft.floor[k]).length;
  const ceiling = saved.ceiling !== draft.ceiling;
  return { seats, floor: floor > 0, ceiling, n: seats.length + floor + (ceiling ? 1 : 0) };
}

// Merge the counts into the Motores save.
export function withCounts<S extends MotoresSave>(save: S, saved: Counts | null, draft: Counts | null): S {
  const p = pendingCounts(saved, draft);
  if (!draft || p.n === 0) return save;
  const seats = [...(save.seats ?? [])];
  for (const agent of p.seats) {
    const row = seats.find((x) => x.agent === agent);
    if (row) row.max_parallel = draft.seats[agent] ?? null;
    else seats.push({ agent, max_parallel: draft.seats[agent] ?? null } as NonNullable<S["seats"]>[number]);
  }
  const floor: NonNullable<MotoresSave["floor"]> = {};
  for (const k of ["max_concurrent", "max_per_agent", "consulta_slots"] as const) if (saved!.floor[k] !== draft.floor[k]) floor[k] = draft.floor[k];
  return {
    ...save,
    ...(seats.length ? { seats } : {}),
    ...(p.floor ? { floor } : {}),
    ...(p.ceiling ? { company: { ...(save.company ?? {}), max_concurrent: draft.ceiling } } : {}),
  };
}

// PLA-57: what the queue link says. It counts what is really queued (the server's list), not what the preview
// thinks would not start: a run whose stored hold is a cap the owner just raised reads as «starts» in the preview
// while it still sits in the queue (and admission may then hold it for machine room). «Cola vacía» only when empty.
export function queueLabel(queued: number, starts: number, language: Language = getLanguage()): string {
  const w = words(A_LA_VEZ, language);
  if (queued === 0) return w.queueEmpty;
  return w.queued(queued, Math.min(starts, queued));
}

export type Fix = { label: string; apply: (c: Counts) => Counts };
export type Verdict = { run: RunnerQueued; starts: boolean; code: RunnerHeld | null; text: string; fix: Fix | null };

const nameOf = (agent: string, team: OrgMember[]) => {
  const role = team.find((m) => m.agent === agent)?.role;
  return role === "product-owner" ? "PO" : role === "research" ? "Research" : role === "artist" ? "Artist" : role === "taller" ? "Taller" : role === "qa" ? "QA" : agent;
};

// What admission would do with the queue under these counts. Holds the server set for reasons the counts cannot
// change (same branch, same files, rest, machine) are kept as they are.
export function previewAdmission(r: RunnerView, c: Counts, team: OrgMember[], project: string, language: Language = getLanguage()): { verdicts: Verdict[]; planAdd: number } {
  const w = words(A_LA_VEZ, language);
  const fixed = new Set<RunnerHeld>(["lock", "areas", "rest", "machine", "start_rate"]);
  let mac = r.ceiling.live + r.ceiling.reserved;
  let work = r.live.work;
  let ask = r.live.consulta;
  const perAgent = new Map(r.seats.map((s) => [s.agent, s.live.length]));
  let plan = (r.plan.pct ?? 0) + r.plan.live_weight;
  let planAdd = 0;
  const verdicts: Verdict[] = [];
  for (const run of r.queue) {
    const who = nameOf(run.agent, team);
    const base = { run, starts: false, fix: null as Fix | null };
    if (run.held_code && fixed.has(run.held_code)) {
      verdicts.push({ ...base, code: run.held_code, text: heldText(run.held_code, run.held_detail, who, language) });
      continue;
    }
    if (mac >= c.ceiling) {
      const next = c.ceiling + 1;
      verdicts.push({ ...base, code: "ceiling", text: w.waitMachine(mac - r.ceiling.reserved, c.ceiling, !!r.ceiling.live_other_projects), fix: next <= MAX.ceiling ? { label: w.raiseCeiling(next), apply: (x) => ({ ...x, ceiling: next }) } : null });
      continue;
    }
    if (r.plan.pct != null && !r.plan.override && plan + run.weight >= r.plan.guard) {
      verdicts.push({ ...base, code: "plan", text: w.planWould(Math.round(plan + run.weight), r.plan.guard) });
      continue;
    }
    if (run.lane === "consulta") {
      if (ask >= c.floor.consulta_slots) {
        const next = c.floor.consulta_slots + 1;
        verdicts.push({ ...base, code: "project_cap", text: w.waitQuestions(ask), fix: next <= MAX.consulta ? { label: w.allowQuestions(next), apply: (x) => ({ ...x, floor: { ...x.floor, consulta_slots: next } }) } : null });
        continue;
      }
      ask += 1;
    } else {
      if (work >= c.floor.max_concurrent) {
        const next = c.floor.max_concurrent + 1;
        verdicts.push({ ...base, code: "project_cap", text: w.waitProject(project, work, c.floor.max_concurrent), fix: next <= MAX.floor ? { label: w.allowProject(next, project), apply: (x) => ({ ...x, floor: { ...x.floor, max_concurrent: next } }) } : null });
        continue;
      }
      const used = perAgent.get(run.agent) ?? 0;
      const cap = seatCap(c, run.agent);
      if (used >= cap) {
        const next = cap + 1;
        verdicts.push({ ...base, code: "agent_cap", text: w.waitAgent(who, used), fix: next <= MAX.seat ? { label: w.allowAgent(who, next), apply: (x) => ({ ...x, seats: { ...x.seats, [run.agent]: next } }) } : null });
        continue;
      }
      perAgent.set(run.agent, used + 1);
      work += 1;
    }
    mac += 1;
    plan += run.weight;
    planAdd += run.weight;
    verdicts.push({ ...base, starts: true, code: null, text: "" });
  }
  return { verdicts, planAdd };
}

export function heldText(code: RunnerHeld | null, d: Record<string, unknown> | null, who: string, language: Language = getLanguage()): string {
  const w = words(A_LA_VEZ, language);
  const n = (k: string) => (typeof d?.[k] === "number" ? (d![k] as number) : null);
  switch (code) {
    case "project_cap":
      return w.heldProject(n("running") ?? "?", n("cap") ?? "?");
    case "agent_cap":
      return w.heldAgent(who, n("running") ?? "?");
    case "ceiling":
      return w.heldCeiling(n("running") ?? "?", n("cap") ?? "?");
    case "machine":
      return w.heldMachine;
    case "start_rate":
      return w.heldStartRate(n("per_minute") ?? "?");
    case "plan":
      return w.heldPlan(n("pct") ?? "?", n("guard") ?? "?");
    case "rest":
      return w.heldRest(who);
    case "lock":
      return w.heldLock;
    case "seat_paused":
      return w.heldSeatPaused(who);
    case "areas": {
      // PLA-58: which ticket, and which files («Espera a MIA-I7-2: cambia src/components/ui/native-select.tsx»).
      const other = typeof d?.with === "string" ? d.with : null;
      const files = Array.isArray(d?.files) ? (d!.files as unknown[]).filter((f): f is string => typeof f === "string") : [];
      if (!other) return w.heldAreas;
      return files.length ? w.heldAreasFiles(other, files.join(", ")) : w.heldAreasWith(other);
    }
    default:
      return w.inQueue;
  }
}

// «lleva 4 min», «acaba de arrancar».
export function sinceText(since: string | null, now = Date.now(), language: Language = getLanguage()): string {
  const w = words(A_LA_VEZ, language);
  if (!since) return w.justStarted;
  const m = Math.round((now - new Date(since).getTime()) / 60_000);
  return m < 1 ? w.justStarted : m < 60 ? w.forMin(m) : w.forHours(Math.floor(m / 60), m % 60);
}
