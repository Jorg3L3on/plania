import { GoalsBoard } from "@/components/goals/goals-board";

export function GoalsPage() {
  return (
    <div className="grid grid-cols-1 gap-5">
      <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">Metas</h1>
      <GoalsBoard />
    </div>
  );
}
