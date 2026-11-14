// PLA-I46-10/15: one small store per page, so Ahora's evidence card and the decision layer show the same thing: the
// QA read of a delivery, the Devolver sheet as the owner left it (open, reason, line), and which decision is at the
// front. Same pattern as plan-draft.ts. Tests prefill a read with setRead (they render without a browser).
import { useEffect, useSyncExternalStore } from "react";
import { api, type QaRead } from "@/lib/api";
import { RETURN_REASONS } from "@/lib/evidencia";

export type ReturnDraft = { open: boolean; reason: string; line: string };
export type Layer = { slug: string; id: string } | null;

const reads = new Map<string, QaRead | null>();
const asked = new Set<string>();
const returns = new Map<string, ReturnDraft>();
let layer: Layer = null;
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const snapshot = () => version;
const bump = () => {
  version++;
  for (const fn of listeners) fn();
};
const useStore = () => useSyncExternalStore(subscribe, snapshot, snapshot);

// ---- the QA read, once per delivery (a new delivery is a new decision id)

const readKey = (slug: string, key: string, id: string) => `${slug}/${key}/${id}`;
export function setRead(slug: string, key: string, id: string, read: QaRead | null) {
  reads.set(readKey(slug, key, id), read);
  bump();
}
// undefined while it loads; null when there is nothing to read (no ticket, or the read failed).
export function useQaRead(slug: string, key: string | null, id: string): QaRead | null | undefined {
  useStore();
  const k = key ? readKey(slug, key, id) : null;
  useEffect(() => {
    if (!k || !key || reads.has(k) || asked.has(k)) return;
    asked.add(k);
    api.qa(slug, key).then(
      (r) => setRead(slug, key, id, r),
      () => setRead(slug, key, id, null),
    );
  }, [k, slug, key, id]);
  if (!k) return null;
  return reads.has(k) ? reads.get(k)! : undefined;
}

// ---- Devolver a Taller

export const returnOf = (id: string): ReturnDraft => returns.get(id) ?? { open: false, reason: RETURN_REASONS[0], line: "" };
export function setReturn(id: string, patch: Partial<ReturnDraft>) {
  returns.set(id, { ...returnOf(id), ...patch });
  bump();
}
export function useReturn(id: string): ReturnDraft {
  useStore();
  return returnOf(id);
}

// ---- Una decisión (PLA-I46-15): which decision is at the front, and what to focus when it closes

export const layerOf = () => layer;
export function openLayer(slug: string, id: string, from?: HTMLElement | null) {
  opener = from ?? (typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null);
  layer = { slug, id };
  bump();
}
// Focus goes back to the floor: the button that opened it, else the floor itself.
export function closeLayer() {
  const was = layer;
  const back = opener;
  layer = null;
  opener = null;
  bump();
  if (typeof document === "undefined" || !was) return;
  const floor = document.getElementById(`piso-${was.slug}`);
  const target = back && back.isConnected ? back : floor;
  target?.focus({ preventScroll: false });
}
export function useLayer(): Layer {
  useStore();
  return layer;
}
