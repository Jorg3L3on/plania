// PLA-I46-10/15: one small store per page, so Ahora's evidence card and the decision layer show the same thing: the
// QA read of a delivery, the Devolver sheet as the owner left it (open, reason, line), and which decision is at the
// front. Same pattern as plan-draft.ts. Tests prefill a read with setRead (they render without a browser).
import { useEffect, useSyncExternalStore } from "react";
import { api, type Marca, type ProbadorRead, type QaRead } from "@/lib/api";
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

// ---- PLA-I52-4: El Probador's read, once per delivery, and the view the owner was looking at

const probs = new Map<string, ProbadorRead | null>();
const probAsked = new Set<string>();
const views = new Map<string, string>();
export function setProbador(slug: string, key: string, id: string, read: ProbadorRead | null) {
  probs.set(readKey(slug, key, id), read);
  bump();
}
// undefined while it loads; null when there is nothing (no ticket, or the read failed).
export function useProbador(slug: string, key: string | null, id: string): ProbadorRead | null | undefined {
  useStore();
  const k = key ? readKey(slug, key, id) : null;
  useEffect(() => {
    if (!k || !key || probs.has(k) || probAsked.has(k)) return;
    probAsked.add(k);
    api.probador(slug, key).then(
      (r) => setProbador(slug, key, id, r),
      () => setProbador(slug, key, id, null),
    );
  }, [k, slug, key, id]);
  if (!k) return null;
  return probs.has(k) ? probs.get(k)! : undefined;
}
export const viewOf = (id: string): string | null => views.get(id) ?? null;
// PLA-I52-6: the pins the owner put on a delivery's pictures; they go with Devolver a Taller.
const pins = new Map<string, Marca[]>();
export const pinsOf = (id: string): Marca[] => pins.get(id) ?? [];
export function setPins(id: string, list: Marca[]) {
  pins.set(id, list);
  bump();
}
export function usePins(id: string): Marca[] {
  useStore();
  return pinsOf(id);
}
export function setView(id: string, key: string) {
  views.set(id, key);
  bump();
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
