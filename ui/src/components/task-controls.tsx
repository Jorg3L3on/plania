import { PriorityLabel, StatusLabel } from "@/components/task-row";
import type { TaskRow } from "@/lib/types";

// Read-only for now; phase 4 turns these into status and priority menus.
export function TaskControls({ task }: { slug: string; task: TaskRow }) {
  return (
    <>
      {task.priority && <PriorityLabel priority={task.priority} />}
      <StatusLabel status={task.status} />
    </>
  );
}
