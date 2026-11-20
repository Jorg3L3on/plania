// PLA-I68-3: the change set lives per project for the session, so moving between Camino's sections (or out and back)
// keeps what the owner staged. Nothing is applied until «Aplicar».
import { useSyncExternalStore } from "react";
import { stageIn, type Staged } from "@/lib/camino-cambios";

const sets = new Map<string, Staged[]>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const EMPTY: Staged[] = [];

export function useCambios(slug: string) {
  const items = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sets.get(slug) ?? EMPTY,
  );
  return {
    items,
    stage: (s: Staged) => {
      sets.set(slug, stageIn(sets.get(slug) ?? [], s));
      emit();
    },
    drop: (key: string) => {
      sets.set(slug, (sets.get(slug) ?? []).filter((x) => x.key !== key));
      emit();
    },
    clear: () => {
      sets.set(slug, []);
      emit();
    },
    /** The staged value of a key, when there is one. */
    staged: (key: string) => (sets.get(slug) ?? []).find((x) => x.key === key)?.change,
  };
}
export type Cambios = ReturnType<typeof useCambios>;
