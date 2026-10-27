import { questionMarkLabels } from "@/lib/inbox";

// The gate chip (A, B or C) and the "Solo tú" badge on a question card.
export function QuestionMarks({ gate, humanOnly }: { gate?: string | null; humanOnly?: boolean }) {
  const labels = questionMarkLabels(gate, humanOnly);
  if (!labels.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {labels.map((label) => (
        <span
          key={label}
          className="inline-flex h-5 items-center rounded-full border border-orange-500/40 bg-orange-500/10 px-2 text-[11px] font-semibold text-orange-700 dark:text-orange-300"
          aria-label={label}
        >
          {label}
        </span>
      ))}
    </span>
  );
}
