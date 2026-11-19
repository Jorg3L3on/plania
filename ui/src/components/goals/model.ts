// Screen shape of a goal. Same fields list_goals returns. Progress is Done tickets over every linked ticket.
import { getLanguage, words, type Language } from "@/lib/i18n";
import { GOALS_WORDS } from "@/lib/goals-words";

export type GoalStatus = "active" | "done" | "dropped";

export type GoalInitiative = { key: string; title: string; status: string };

export type Goal = {
  id: string;
  title: string;
  why: string;
  status: GoalStatus;
  target_on: string | null;
  position: number;
  project: string | null;
  parent_id: string | null;
  progress: { done: number; total: number };
  initiatives: GoalInitiative[];
  children: Goal[];
};

export type GoalWrite = {
  project?: string | null;
  parent_id?: string | null;
  title?: string;
  why?: string;
  status?: string;
  target_on?: string | null;
};

// PLA-I2-10: in the screen's language (fixed for the life of the page).
export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = words(GOALS_WORDS).status;

export const GOAL_STATUSES = ["active", "done", "dropped"] as const;

export const progressText = (done: number, total: number, language: Language = getLanguage()) => words(GOALS_WORDS, language).progress(done, total);
