// PLA-I68-3: the change set lives per project for the session, so moving between Camino's sections (or out and back)
// keeps what the owner staged. Nothing is applied until «Aplicar».
// PLA-I70-16: it also survives a reload (sessionStorage), and leaving with changes asks first.
// PLA-I70-15: `epoch` moves on every discard so uncontrolled fields remount with the stored value.
import { useEffect, useSyncExternalStore } from "react";
import { stageIn, type Staged } from "@/lib/camino-cambios";
import { cambiosWords } from "@/lib/camino-cambios";

const sets = new Map<string, Staged[]>();
const epochs = new Map<string, number>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const EMPTY: Staged[] = [];
const KEY = (slug: string) => `plania:camino:cambios:${slug}`;

function load(slug: string): Staged[] {
  if (sets.has(slug)) return sets.get(slug)!;
  let list: Staged[] = EMPTY;
  try {
    const raw = sessionStorage.getItem(KEY(slug));
    if (raw) list = JSON.parse(raw) as Staged[];
  } catch {
    /* no storage: the set lives in memory only */
  }
  sets.set(slug, list);
  return list;
}
function save(slug: string, list: Staged[]) {
  sets.set(slug, list);
  try {
    if (list.length) sessionStorage.setItem(KEY(slug), JSON.stringify(list));
    else sessionStorage.removeItem(KEY(slug));
  } catch {
    /* ignore */
  }
  emit();
}

export function useCambios(slug: string) {
  const items = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => load(slug),
  );
  // Closing the tab or reloading with changes not applied: the browser asks first.
  useEffect(() => {
    if (!items.length) return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = cambiosWords().leave;
      return e.returnValue;
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [items.length]);
  return {
    items,
    /** Changes whenever the set is discarded, so a field keyed on it shows the stored value again. */
    epoch: epochs.get(slug) ?? 0,
    stage: (s: Staged) => save(slug, stageIn(load(slug), s)),
    drop: (key: string) => {
      const next = load(slug).filter((x) => x.key !== key);
      if (next.length !== load(slug).length) epochs.set(slug, (epochs.get(slug) ?? 0) + 1);
      save(slug, next);
    },
    clear: () => {
      epochs.set(slug, (epochs.get(slug) ?? 0) + 1);
      save(slug, []);
    },
    /** The staged value of a key, when there is one. */
    staged: (key: string) => load(slug).find((x) => x.key === key)?.change,
  };
}
export type Cambios = ReturnType<typeof useCambios>;
