// PLA-I46-11: what the owner changed in a leg's plan before accepting it (an answer, a line of the check list, the
// words for Cambiar algo). One small store per page, so Ahora's Aceptar plan, the Tú window's and the phone bar's
// send the same answers and list (runOf in now.tsx reads planInput). Nothing is saved until he accepts.
import { useSyncExternalStore } from "react";
import type { Decision, DecisionInput } from "@/lib/api";

export type PlanDraft = { answers: number[]; checklist: string[]; changing: boolean; text: string; open: boolean };

const drafts = new Map<string, PlanDraft>();
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const snapshot = () => version;

// A plan for a leg (the floor's plan to accept); an order's plan (PLA-I36-8) is not one.
export const isLegPlan = (d: Decision | null | undefined): d is Decision => !!d && d.kind === "plan" && !!d.plan?.leg;

export function draftOf(d: Decision): PlanDraft {
  const kept = drafts.get(d.id);
  if (kept) return kept;
  return { answers: (d.plan?.questions ?? []).map((q) => q.suggested), checklist: [...(d.plan?.checklist ?? [])], changing: false, text: "", open: false };
}

export function setDraft(d: Decision, patch: Partial<PlanDraft>) {
  drafts.set(d.id, { ...draftOf(d), ...patch });
  version++;
  for (const fn of listeners) fn();
}

export function useDraft(d: Decision): PlanDraft {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return draftOf(d);
}

// What Aceptar plan sends: the answers and the list as he left them. Empty for anything that is not a leg plan.
export function planInput(d: Decision | undefined, action: string): Partial<DecisionInput> {
  if (!isLegPlan(d) || action !== "empezar") return {};
  const x = draftOf(d);
  return { answers: x.answers, checklist: x.checklist.map((c) => c.trim()) };
}

// The leg plan on this floor that is still open, if any.
export const legPlanOf = (slug: string, decisions: Decision[]): Decision | null => decisions.find((d) => d.project === slug && isLegPlan(d) && d.state === null) ?? null;
