// PLA-I74-5: whose turn an open item is. Every open ticket is exactly one of five turns:
//   agent_working   a run is live on it (or an agent outside the runner holds its live lease)
//   agent_queued    an agent will take it: a run is queued, its agent is busy, it waits on another step, QA's queue
//   owner           the owner must act: a question, a delivery, a step of his, a postponed or paused one (a card)
//   outside         it waits on something outside Plania (CI, a deploy, the clock, an env) with a time limit
//   failed          its newest run could not start (a card with what to fix)
// and «nobody» is the gap the watchdog heals (src/jobs/turns.ts): a Ready step no wake reached, a step held by a run
// that ended (PLA-167), a lapsed lease, a sent-back delivery or a red CI nobody picked up, an outside wait past its
// limit. The board's working/queued/waiting text reads the turn, so «Taller trabaja» never shows without a live run.
// PLA-170: a merged step whose production build failed is not «waiting on the deploy» (that wait would only run out
// into a vague owner card): it is nobody's until its fix step exists (the watchdog asks for it), then it waits on it.
// Pure: turnFacts (src/state/turn-facts.ts) reads the facts.
import { ST } from "./status.js";

const MIN = 60_000;
// How long an outside wait may last before nobody is watching it any more.
export const OUTSIDE_LIMIT_MIN = { ci: 30, photos: 20, review: 30, merge: 15, deploy: 60, close: 30, env: 60 } as const;

export type QueueReason = "run_queued" | "agent_busy" | "waits_step" | "qa_queued";
export type OwnerCard = "question" | "delivery" | "own_step" | "action" | "postponed" | "backlog" | "blocked" | "paused";
export type OutsideOn = keyof typeof OUTSIDE_LIMIT_MIN | "time";
export type NobodyWhy = "not_woken" | "held_by_ended_run" | "lease_lapsed" | "sent_back" | "ci_red" | "overdue" | "deploy_failed";
// What one heal does: wake the agent that works the step (after releasing a hold an ended run left), or nothing
// (an overdue outside wait has no agent to wake: it goes straight to the owner's card).
// deploy_fix (PLA-170): ask Taller for the fix of the failed production build (src/api/deploy-fix.ts arregloDePaso).
export type Heal = { kind: "wake"; release: boolean; reason: string } | { kind: "deploy_fix" } | { kind: "none" };

export type Turn =
  | { turn: "agent_working"; agent: string | null; run_id: string | null; since: string | null }
  | { turn: "agent_queued"; agent: string | null; reason: QueueReason; detail: string | null }
  | { turn: "owner"; card: OwnerCard; detail: string | null }
  | { turn: "outside"; on: OutsideOn; until: string | null }
  | { turn: "failed"; detail: string | null };
export type Nobody = { turn: "nobody"; why: NobodyWhy; heal: Heal; agent: string | null };
export type TurnOrNobody = Turn | Nobody;
export const TURNS = ["agent_working", "agent_queued", "owner", "outside", "failed"] as const;

export type TurnInput = {
  key: string;
  status: string;
  statusChangedAt: Date | null;
  // The project's or the company's runs are paused.
  paused: boolean;
  // A run starting or running on this key.
  liveRun: { id: string; agent: string; since: Date | null } | null;
  // A run queued on this key.
  queuedRun: { id: string; agent: string } | null;
  // The live lease (lease_until in the future), if any; runnerEnded: a runner run's session holds it and that run is
  // not live any more (PLA-167).
  lease: { agent: string | null; runner: boolean; runnerEnded: boolean; since: Date | null } | null;
  // An open question on it.
  question: boolean;
  // The step's newest run failed before its process started (or Claude was signed out): what to fix.
  couldNotStart: string | null;
  onHold: boolean;
  personOwned: boolean;
  // Ready, unblocked, not On hold, not a person's, no live lease (src/state/workable.ts).
  workable: boolean;
  // The first unfinished ticket it waits on.
  waitsOnStep: string | null;
  // The first open typed blocker.
  typed: { type: string; at: string | null; text: string | null } | null;
  // The board's stage (src/api/etapa.ts), for In review.
  etapa: string | null;
  qa: string | null;
  ci: string | null;
  // The agent that works it (its owner agent, else Taller or the PO by work type), and whether that agent runs
  // something else now.
  worker: string | null;
  workerBusy: boolean;
  // PLA-170: the production build that carries this step's merge failed; fix: the Taller step asked for it, if any.
  deployFailed?: { fix: string | null } | null;
};

const plus = (d: Date | null, minutes: number, now: Date) => new Date((d ?? now).getTime() + minutes * MIN);
const isoOf = (d: Date | null) => (d ? d.toISOString() : null);

// The turn of one open item, or null when it is closed (Done, Won't do).
export function turnOf(f: TurnInput, now: Date): TurnOrNobody | null {
  if (f.status === ST.done || f.status === ST.wontDo) return null;
  const nobody = (why: NobodyWhy, heal: Heal): Nobody => ({ turn: "nobody", why, heal, agent: f.worker });
  const wake = (reason: string, release = false): Heal => ({ kind: "wake", release, reason });
  const outside = (on: OutsideOn, until: Date): TurnOrNobody =>
    until.getTime() < now.getTime() ? nobody("overdue", { kind: "none" }) : { turn: "outside", on, until: until.toISOString() };
  const wait = (on: keyof typeof OUTSIDE_LIMIT_MIN) => outside(on, plus(f.statusChangedAt, OUTSIDE_LIMIT_MIN[on], now));

  if (f.liveRun) return { turn: "agent_working", agent: f.liveRun.agent, run_id: f.liveRun.id, since: isoOf(f.liveRun.since) };
  // A live lease whose holder still works: a session outside the runner (an agent in its own terminal), or a live run
  // that claimed this step while woken on another key.
  if (f.lease && !f.lease.runnerEnded) return { turn: "agent_working", agent: f.lease.agent, run_id: null, since: isoOf(f.lease.since) };
  if (f.question || f.status === ST.needsOwner) return { turn: "owner", card: "question", detail: null };
  if (f.queuedRun) return { turn: "agent_queued", agent: f.queuedRun.agent, reason: "run_queued", detail: null };
  if (f.paused) return { turn: "owner", card: "paused", detail: null };
  if (f.couldNotStart && (f.status === ST.ready || f.status === ST.inProgress)) return { turn: "failed", detail: f.couldNotStart };

  const typed = (): TurnOrNobody | null => {
    if (!f.typed) return null;
    if (f.typed.type === "human_action") return { turn: "owner", card: "action", detail: f.typed.text };
    if (f.typed.type === "time_after" && f.typed.at) return outside("time", new Date(new Date(f.typed.at).getTime() + 5 * MIN));
    return wait("env");
  };
  const waitsStep = (): Turn | null => (f.waitsOnStep ? { turn: "agent_queued", agent: f.worker, reason: "waits_step", detail: f.waitsOnStep } : null);

  switch (f.status) {
    case ST.ready: {
      if (f.onHold) return { turn: "owner", card: "postponed", detail: null };
      if (f.personOwned) return { turn: "owner", card: "own_step", detail: null };
      const t = typed() ?? waitsStep();
      if (t) return t;
      if (f.etapa === "devuelto") return f.workerBusy ? { turn: "agent_queued", agent: f.worker, reason: "agent_busy", detail: null } : nobody("sent_back", wake("sent back, nobody took it"));
      if (f.workerBusy) return { turn: "agent_queued", agent: f.worker, reason: "agent_busy", detail: null };
      return nobody("not_woken", wake("ready, no wake reached it"));
    }
    case ST.inProgress:
      if (f.lease?.runnerEnded) return nobody("held_by_ended_run", wake("its run ended holding it", true));
      return nobody("lease_lapsed", wake("its lease lapsed", true));
    case ST.blocked:
      return typed() ?? waitsStep() ?? { turn: "owner", card: "blocked", detail: null };
    case ST.backlog:
      if (f.onHold) return { turn: "owner", card: "postponed", detail: null };
      return waitsStep() ?? { turn: "owner", card: "backlog", detail: null };
    case ST.inReview:
      if (f.etapa === "en_qa" && f.qa === "running") return { turn: "agent_working", agent: "qa", run_id: null, since: null };
      if (f.etapa === "en_qa") return { turn: "agent_queued", agent: "qa", reason: "qa_queued", detail: null };
      if (f.etapa === "te_toca") return { turn: "owner", card: "delivery", detail: null };
      if (f.etapa === "devuelto") return f.workerBusy ? { turn: "agent_queued", agent: f.worker, reason: "agent_busy", detail: null } : nobody("sent_back", wake("sent back, nobody took it"));
      if (f.etapa === "integrado") return wait("merge");
      if (f.ci === "failure") return f.workerBusy ? { turn: "agent_queued", agent: f.worker, reason: "agent_busy", detail: null } : nobody("ci_red", wake("ci red, nobody took it"));
      if (f.ci === "pending") return wait("ci");
      return wait("review");
    case ST.merged:
      if (f.deployFailed) return f.deployFailed.fix ? { turn: "agent_queued", agent: f.worker, reason: "waits_step", detail: f.deployFailed.fix } : nobody("deploy_failed", { kind: "deploy_fix" });
      return wait("deploy");
    case ST.released:
      return wait("close");
  }
  // Initiatives and ideas have no turn of their own here: their steps do.
  return null;
}
