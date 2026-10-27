import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Every ticket on the redesigned screen opens the side panel (?task=KEY). One real <button> each,
// with data-key so live changes can find the card that moved.
export function TicketButton({
  taskKey,
  onOpen,
  className,
  title,
  label,
  children,
}: {
  taskKey: string;
  onOpen: (key: string) => void;
  className?: string;
  title?: string;
  label?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-key={taskKey}
      title={title}
      aria-label={label}
      onClick={() => onOpen(taskKey)}
      className={cn(
        "group/ticket cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      {children}
    </button>
  );
}
