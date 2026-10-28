import { QuestionCard } from "@/components/resume";
import type { Question } from "@/lib/types";

// Open human-only gates. One click on an answer button stores it. The session is the proof.
export function GatePanel({ items, onOpen }: { items: { project: string; question: Question }[]; onOpen: (project: string, key: string) => void }) {
  return (
    <section id="compuertas" className="grid gap-3">
      <h2 className="text-sm font-medium text-orange-600 dark:text-orange-400">Compuertas</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ninguna compuerta abierta.</p>
      ) : (
        items.map(({ project, question }) => (
          <QuestionCard key={question.id} slug={project} q={question} onOpen={(key) => onOpen(project, key)} />
        ))
      )}
    </section>
  );
}
