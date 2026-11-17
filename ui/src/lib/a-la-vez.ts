// PLA-I60-5: «a la vez» in Motores. Pure: the console holds the state. The counts are a second part of the draft
// (next to model and effort): a seat's own count (null: del piso), the project's floor, and the Mac's ceiling.
// previewAdmission mirrors the server's admission (src/runner/runner.ts admit) on the screen's data, so the footer
// can say what Guardar would start and the queue can say why each thing waits, with a one-click fix when a number
// would unblock it. It is a preview: the server decides.
// What Motores reads about «a la vez» (src/api/company-runner.ts). No imports: tests load this file directly.
export type RunnerHeld = "project_cap" | "agent_cap" | "ceiling" | "machine" | "start_rate" | "plan" | "rest" | "lock" | "areas";
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
  plan: { pct: number | null; guard: number; state: string; override: boolean; est_pct: number; live_weight: number };
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
export function queueLabel(queued: number, starts: number): string {
  if (queued === 0) return "Cola vacía";
  const fits = Math.min(starts, queued);
  return `${queued} en cola${fits ? ` · ${fits} ${fits === 1 ? "arranca" : "arrancan"}` : ""}`;
}

export type Fix = { label: string; apply: (c: Counts) => Counts };
export type Verdict = { run: RunnerQueued; starts: boolean; code: RunnerHeld | null; text: string; fix: Fix | null };

const nameOf = (agent: string, team: OrgMember[]) => {
  const role = team.find((m) => m.agent === agent)?.role;
  return role === "product-owner" ? "PO" : role === "research" ? "Research" : role === "artist" ? "Artist" : role === "taller" ? "Taller" : role === "qa" ? "QA" : agent;
};

// What admission would do with the queue under these counts. Holds the server set for reasons the counts cannot
// change (same branch, same files, rest, machine) are kept as they are.
export function previewAdmission(r: RunnerView, c: Counts, team: OrgMember[], project: string): { verdicts: Verdict[]; planAdd: number } {
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
      verdicts.push({ ...base, code: run.held_code, text: heldText(run.held_code, run.held_detail, who) });
      continue;
    }
    if (mac >= c.ceiling) {
      const next = c.ceiling + 1;
      verdicts.push({ ...base, code: "ceiling", text: `Esperando lugar en la Mac (${mac - r.ceiling.reserved} de ${c.ceiling}${r.ceiling.live_other_projects ? ", contando otros proyectos" : ""})`, fix: next <= MAX.ceiling ? { label: `Subir el tope de la Mac a ${next}`, apply: (x) => ({ ...x, ceiling: next }) } : null });
      continue;
    }
    if (r.plan.pct != null && !r.plan.override && plan + run.weight >= r.plan.guard) {
      verdicts.push({ ...base, code: "plan", text: `El plan llegaría a ${Math.round(plan + run.weight)} % (tope ${r.plan.guard} %); sigue cuando baje` });
      continue;
    }
    if (run.lane === "consulta") {
      if (ask >= c.floor.consulta_slots) {
        const next = c.floor.consulta_slots + 1;
        verdicts.push({ ...base, code: "project_cap", text: `Esperando: ya hay ${ask} ${ask === 1 ? "pregunta" : "preguntas"} en curso`, fix: next <= MAX.consulta ? { label: `Dejar ${next} preguntas a la vez`, apply: (x) => ({ ...x, floor: { ...x.floor, consulta_slots: next } }) } : null });
        continue;
      }
      ask += 1;
    } else {
      if (work >= c.floor.max_concurrent) {
        const next = c.floor.max_concurrent + 1;
        verdicts.push({ ...base, code: "project_cap", text: `Esperando lugar: ${project} ya tiene ${work} de ${c.floor.max_concurrent} trabajando`, fix: next <= MAX.floor ? { label: `Dejar ${next} a la vez en ${project}`, apply: (x) => ({ ...x, floor: { ...x.floor, max_concurrent: next } }) } : null });
        continue;
      }
      const used = perAgent.get(run.agent) ?? 0;
      const cap = seatCap(c, run.agent);
      if (used >= cap) {
        const next = cap + 1;
        verdicts.push({ ...base, code: "agent_cap", text: `Esperando: ${who} ya hace ${used} ${used === 1 ? "cosa" : "cosas"} a la vez`, fix: next <= MAX.seat ? { label: `Dejar que ${who} haga ${next}`, apply: (x) => ({ ...x, seats: { ...x.seats, [run.agent]: next } }) } : null });
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

export function heldText(code: RunnerHeld | null, d: Record<string, unknown> | null, who: string): string {
  const n = (k: string) => (typeof d?.[k] === "number" ? (d![k] as number) : null);
  switch (code) {
    case "project_cap":
      return `Esperando lugar en el proyecto (${n("running") ?? "?"} de ${n("cap") ?? "?"})`;
    case "agent_cap":
      return `Esperando: ${who} ya hace ${n("running") ?? "?"} a la vez`;
    case "ceiling":
      return `Esperando lugar en la Mac (${n("running") ?? "?"} de ${n("cap") ?? "?"})`;
    case "machine":
      return "La Mac está corta de memoria o disco; arranca en cuanto se libere";
    case "start_rate":
      return `Arrancando de a poco (${n("per_minute") ?? "?"} por minuto)`;
    case "plan":
      return `El plan va en ${n("pct") ?? "?"} % (tope ${n("guard") ?? "?"} %); sigue cuando baje`;
    case "rest":
      return `${who} descansa entre corridas`;
    case "lock":
      return "Espera a que termine el trabajo en la misma rama o ticket";
    case "areas":
      return "Espera: otro trabajo toca los mismos archivos";
    default:
      return "En cola";
  }
}

// «lleva 4 min», «acaba de arrancar».
export function sinceText(since: string | null, now = Date.now()): string {
  if (!since) return "acaba de arrancar";
  const m = Math.round((now - new Date(since).getTime()) / 60_000);
  return m < 1 ? "acaba de arrancar" : m < 60 ? `lleva ${m} min` : `lleva ${Math.floor(m / 60)} h ${m % 60} min`;
}
