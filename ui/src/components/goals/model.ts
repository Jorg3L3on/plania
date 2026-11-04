// Screen shape of a goal. Same fields list_goals returns. Progress is Done tickets over every linked ticket.

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

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Activa",
  done: "Hecha",
  dropped: "Dejada",
};

export const GOAL_STATUSES = ["active", "done", "dropped"] as const;

export const progressText = (done: number, total: number) => `${done} de ${total} hechos`;
