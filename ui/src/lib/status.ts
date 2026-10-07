// One colour per status, used as a small dot next to the label.
const DOT: Record<string, string> = {
  Backlog: "bg-zinc-400",
  Planning: "bg-zinc-400",
  Ready: "bg-sky-500",
  "In progress": "bg-amber-500",
  Active: "bg-amber-500",
  "In review": "bg-violet-500",
  Shipping: "bg-violet-500",
  Blocked: "bg-red-500",
  Done: "bg-emerald-500",
  "On hold": "bg-zinc-300 dark:bg-zinc-600",
  "Won't do": "bg-zinc-300 dark:bg-zinc-600",
};

export const statusDot = (status: string) => DOT[status] ?? "bg-zinc-400";

const PRIORITY: Record<string, string> = {
  P0: "border-red-500/40 text-red-600 dark:text-red-400",
  P1: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  P2: "border-border text-muted-foreground",
  P3: "border-border text-muted-foreground/70",
};

export const priorityTone = (p: string) => PRIORITY[p] ?? "border-border text-muted-foreground";
