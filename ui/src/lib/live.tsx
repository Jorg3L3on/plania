import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { LiveEvent } from "./types";

// One EventSource per tab. Each change invalidates the affected queries, and rows changed
// by someone else (an agent over MCP) are flagged for a short highlight.
// A phone suspends a home-screen app and can leave the stream closed for good, so it is
// reopened whenever the page comes back into view or the network returns.

const HIGHLIGHT_MS = 2500;
const LOCAL_ECHO_MS = 3000;

type LiveState = {
  connected: boolean;
  online: boolean;
  isFresh: (slug: string, key: string) => boolean;
  markLocal: (slug: string, key: string) => void;
};

const LiveContext = createContext<LiveState>({ connected: false, online: true, isFresh: () => false, markLocal: () => {} });

function subscribeOnline(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

// Whether the device has a network at all (not whether Plania answers).
export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const online = useOnline();
  const [fresh, setFresh] = useState<Map<string, number>>(new Map());
  const local = useRef(new Map<string, number>());

  useEffect(() => {
    function open() {
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
        void queryClient.invalidateQueries({ queryKey: ["inbox"] });
        // 2.12: Inicio's Hoy strip reads the digest since this device's cursor.
        void queryClient.invalidateQueries({ queryKey: ["digest"] });
        // The machine job and register/release_footprint tell every screen the inventory changed.
        if (event.type === "footprint") void queryClient.invalidateQueries({ queryKey: ["machine"] });
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
      source.onerror = () => setConnected(false); // EventSource retries on its own until it gives up (CLOSED)
      return source;
    }

    let source = open();
    function reopen() {
      if (document.visibilityState !== "visible" || source.readyState !== EventSource.CLOSED) return;
      source = open();
    }
    document.addEventListener("visibilitychange", reopen);
    window.addEventListener("pageshow", reopen);
    window.addEventListener("online", reopen);
    return () => {
      document.removeEventListener("visibilitychange", reopen);
      window.removeEventListener("pageshow", reopen);
      window.removeEventListener("online", reopen);
      source.close();
    };
  }, [queryClient]);

  const isFresh = useCallback((slug: string, key: string) => fresh.has(`${slug}/${key}`), [fresh]);
  const markLocal = useCallback((slug: string, key: string) => {
    local.current.set(`${slug}/${key}`, Date.now());
  }, []);

  return <LiveContext.Provider value={{ connected, online, isFresh, markLocal }}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);
