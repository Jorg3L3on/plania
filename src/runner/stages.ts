// PLA-I60-4: who owns each idea stage, and the sweep that keeps an idea from sitting in a stage nobody works on.
//   idea → PO (darle forma), research → Research, design → Artist, planning → PO (pasos y tamaño), ready → nobody
//   (it waits for the owner's «Constrúyelo»). targetOf wakes the owner when the stage changes; sweepStalledIdeas
//   queues one retry each tick for an open idea whose owner has had no run on it since the stage last changed
//   (a wake that was dropped, coalesced away, or lost to a restart). The retry is a unique-key insert, so running the
//   sweep often, or from several processes, queues at most one run per idea.
import type { RunnerRole } from "./limits.js";
import { ownerEs } from "../owner.js";
import { defineWords, ownersEn, say } from "../words.js";

// PLA-I2-10: the idea stage's wake reason (the owner reads it in the queue, the PO in its prompt), in the install's
// language; the Spanish is unchanged.
export const STAGE_WORDS = defineWords({
  es: {
    idea: () =>
      `pedido ${ownerEs("de")} para darle forma: entrega la etapa con deliver_stage (stage idea: problem, who, why_now y tus dudas como decisions con la opción que recomiendas) y muévela a research`,
  },
  en: {
    idea: () =>
      `${ownersEn({ capital: true })} request to shape: deliver the stage with deliver_stage (stage idea: problem, who, why_now and your doubts as decisions with the option you recommend) and move it to research`,
  },
});

export type IdeaStage = "idea" | "research" | "design" | "planning" | "ready";

export const STAGE_OWNER: Record<IdeaStage, RunnerRole | null> = {
  idea: "product-owner",
  research: "research",
  design: "artist",
  planning: "product-owner",
  ready: null,
};

// AUDIT-8: each owner is told to deliver its stage as data (deliver_stage writes the doc), then to move the idea.
// The first words stay as they were: the queue's summaries and the prompts are matched on them.
export const STAGE_REASON: Record<IdeaStage, string> = {
  // PLA-I2-14: a getter, so it names the owner as they are called now. PLA-I2-10: and in the install's language.
  get idea() {
    return say(STAGE_WORDS).idea();
  },
  research: "idea stage research: deliver it with deliver_stage (stage research: learned, options, recommendation, unknowns) and move the idea to design",
  design: "idea stage design: deliver it with deliver_stage (stage design: approach, scope, out_of_scope) and move the idea to planning",
  planning: "idea stage planning: deliver it with deliver_stage (stage planning: steps with done_when and try_it, risks, size) and move the idea to ready",
  ready: "",
};

export const stageOwner = (stage: string | null | undefined): RunnerRole | null => (stage && stage in STAGE_OWNER ? STAGE_OWNER[stage as IdeaStage] : null);
