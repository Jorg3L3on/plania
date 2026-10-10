import { EventEmitter } from "node:events";

// Change notifications for live screens. Every write in src/mcp/writes.ts publishes here,
// whether it came from an agent over MCP or from the UI.
export type PlaniaEvent = {
  type: "task" | "project" | "decision" | "footprint";
  // slug. "footprint" changes belong to the whole machine (many rows have no project): project is "",
  // which no per-project feed matches, while the global /api/events stream carries it to every screen.
  project: string;
  key?: string; // task key, for type "task"
};

export interface EventBus {
  publish(event: PlaniaEvent): void;
  // Returns an unsubscribe function.
  subscribe(listener: (event: PlaniaEvent) => void): () => void;
}

// One long-running process (the local launchd service) shares this in memory.
// On serverless hosts each request may run elsewhere: swap this for polling or a hosted pub/sub.
class InProcessBus implements EventBus {
  private emitter = new EventEmitter().setMaxListeners(0);

  publish(event: PlaniaEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: PlaniaEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}

export const bus: EventBus = new InProcessBus();
