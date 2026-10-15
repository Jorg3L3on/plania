import { dueText, isOverdue } from "@/lib/due";
import { cn } from "@/lib/utils";

/** "vence 24 oct" beside a ticket; past its day it turns to the overdue tone. */
export function DueTag({ task, className }: { task: { due_on?: string | null; status: string }; className?: string }) {
  const text = dueText(task);
  if (!text) return null;
  const late = isOverdue(task);
  return <span className={cn("text-xs whitespace-nowrap", late ? "font-medium text-ink-blocked" : "text-muted-foreground", className)}>{text}</span>;
}
