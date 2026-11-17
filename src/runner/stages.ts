// PLA-I60-4: who owns each idea stage, and the sweep that keeps an idea from sitting in a stage nobody works on.
//   idea → PO (darle forma), research → Research, design → Artist, planning → PO (pasos y tamaño), ready → nobody
//   (it waits for the owner's «Constrúyelo»). targetOf wakes the owner when the stage changes; sweepStalledIdeas
//   queues one retry each tick for an open idea whose owner has had no run on it since the stage last changed
//   (a wake that was dropped, coalesced away, or lost to a restart). The retry is a unique-key insert, so running the
//   sweep often, or from several processes, queues at most one run per idea.
import type { RunnerRole } from "./limits.js";

export type IdeaStage = "idea" | "research" | "design" | "planning" | "ready";

export const STAGE_OWNER: Record<IdeaStage, RunnerRole | null> = {
  idea: "product-owner",
  research: "research",
  design: "artist",
  planning: "product-owner",
  ready: null,
};

export const STAGE_REASON: Record<IdeaStage, string> = {
  idea: "pedido de Jorge para darle forma",
  research: "idea stage research",
  design: "idea stage design",
  planning: "idea stage planning: write the Plan doc (steps and size) and move the idea to ready",
  ready: "",
};

export const stageOwner = (stage: string | null | undefined): RunnerRole | null => (stage && stage in STAGE_OWNER ? STAGE_OWNER[stage as IdeaStage] : null);
