import { statusStageTone } from "./etapas";

// Status colours come from the --status-* tokens in index.css, so both themes share one map.
// A tone is the meaning on screen: done, now, review, ready, blocked, owner (waits on the owner), pending (not started)
// or idle (parked).

export type Tone = "done" | "now" | "review" | "ready" | "blocked" | "owner" | "pending" | "idle";

// PLA-I53-5: a ticket status takes its stage's tone from lib/etapas.ts (Merged and Released are done, not review);
// only an initiative's own statuses are listed here.
const INITIATIVE_TONE: Record<string, Tone> = {
  Open: "pending",
  Planning: "pending",
  Active: "now",
  Shipping: "review",
  "On hold": "idle",
  "Won't do": "idle",
};

export const statusTone = (status: string): Tone => INITIATIVE_TONE[status] ?? statusStageTone(status) ?? "pending";

// Literal class names so Tailwind sees every one of them.
const DOT: Record<Tone, string> = {
  done: "bg-status-done",
  now: "bg-status-now",
  review: "bg-status-review",
  ready: "bg-status-ready",
  blocked: "bg-status-blocked",
  owner: "bg-status-owner",
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
