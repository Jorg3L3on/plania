import { GoalsBoard } from "@/components/goals/goals-board";

export function GoalsPage() {
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid gap-1">
        <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">Metas</h1>
        <p className="text-sm text-muted-foreground">Meta de la empresa → meta del proyecto → iniciativa. Cada tarea muestra su porqué.</p>
      </div>
      <GoalsBoard />
    </div>
  );
}
