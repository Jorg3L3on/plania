export type TaskComment = {
  id: string;
  author_agent: string;
  body: string;
  created_at: string;
};

export type RoutineStatus = "ok" | "fail" | "skipped";

export type RoutineRun = {
  id: string;
  agent: string;
  routine: string;
  started_at: string;
  ended_at: string | null;
  status: RoutineStatus;
  summary: string;
  task_key: string | null;
};
