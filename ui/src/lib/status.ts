// Status colours come from the --status-* tokens in index.css, so both themes share one map.
// A tone is the meaning on screen: done, now, review, ready, blocked, jorge (waits on Jorge), pending (not started)
// or idle (parked).

export type Tone = "done" | "now" | "review" | "ready" | "blocked" | "jorge" | "pending" | "idle";

const TONE: Record<string, Tone> = {
  Backlog: "pending",
  Open: "pending",
  Planning: "pending",
  Ready: "ready",
  "In progress": "now",
  Active: "now",
  "In review": "review",
  Merged: "review",
  Released: "review",
  Shipping: "review",
  Blocked: "blocked",
  "Needs Jorge": "jorge",
  Done: "done",
  "On hold": "idle",
  "Won't do": "idle",
};

export const statusTone = (status: string): Tone => TONE[status] ?? "pending";

// Literal class names so Tailwind sees every one of them.
const DOT: Record<Tone, string> = {
  done: "bg-status-done",
  now: "bg-status-now",
  review: "bg-status-review",
  ready: "bg-status-ready",
  blocked: "bg-status-blocked",
  jorge: "bg-status-jorge",
  pending: "bg-status-pending",
  idle: "bg-status-idle/60",
};

export const statusDot = (status: string) => DOT[statusTone(status)];

const PRIORITY: Record<string, string> = {
  P0: "border-status-blocked/40 text-ink-blocked",
  P1: "border-status-now/50 text-foreground",
  P2: "border-border text-muted-foreground",
  P3: "border-border text-muted-foreground/70",
};

export const priorityTone = (p: string) => PRIORITY[p] ?? "border-border text-muted-foreground";
