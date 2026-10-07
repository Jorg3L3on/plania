import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { LiveEvent } from "./types";

// One EventSource per tab. Each change invalidates the affected queries, and rows changed
// by someone else (an agent over MCP) are flagged for a short highlight.

const HIGHLIGHT_MS = 2500;
const LOCAL_ECHO_MS = 3000;

type LiveState = {
  connected: boolean;
  isFresh: (slug: string, key: string) => boolean;
  markLocal: (slug: string, key: string) => void;
};

const LiveContext = createContext<LiveState>({ connected: false, isFresh: () => false, markLocal: () => {} });

export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [fresh, setFresh] = useState<Map<string, number>>(new Map());
  const local = useRef(new Map<string, number>());

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.addEventListener("ready", () => {
      setConnected(true);
      // Catch up on anything missed while disconnected.
      void queryClient.invalidateQueries();
    });
    source.addEventListener("change", (msg) => {
      const event = JSON.parse((msg as MessageEvent).data) as LiveEvent;
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project", event.project] });
      if (!event.key) return;
      const id = `${event.project}/${event.key}`;
      if (Date.now() - (local.current.get(id) ?? 0) < LOCAL_ECHO_MS) return; // our own write
      setFresh((m) => new Map(m).set(id, Date.now()));
      setTimeout(() => setFresh((m) => {
        const next = new Map(m);
        next.delete(id);
        return next;
      }), HIGHLIGHT_MS);
    });
    source.onerror = () => setConnected(false); // EventSource reconnects on its own
    return () => source.close();
  }, [queryClient]);

  const isFresh = useCallback((slug: string, key: string) => fresh.has(`${slug}/${key}`), [fresh]);
  const markLocal = useCallback((slug: string, key: string) => {
    local.current.set(`${slug}/${key}`, Date.now());
  }, []);

  return <LiveContext.Provider value={{ connected, isFresh, markLocal }}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);
