// PLA-74 (F-17): Compañía showed an empty frame for 2–10 s on every load while /api/company ran. The last read is
// kept in this browser and drawn at once as placeholder data while the fresh one loads (TanStack Query refetches on
// mount, and a stale card's action is refused by the server, never applied twice). Older than maxAgeMs, or
// unreadable (private window, blocked storage), it is not used.
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const store = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export function lastRead<T>(key: string, maxAgeMs: number, now = Date.now(), s: Store | null = store()): T | undefined {
  try {
    const raw = s?.getItem(`plania.last.${key}`);
    if (!raw) return undefined;
    const got = JSON.parse(raw) as { at?: number; data?: T };
    if (typeof got.at !== "number" || got.data === undefined || now - got.at > maxAgeMs || got.at > now + 60_000) return undefined;
    return got.data;
  } catch {
    return undefined;
  }
}

export function keepRead<T>(key: string, data: T, now = Date.now(), s: Store | null = store()): void {
  try {
    s?.setItem(`plania.last.${key}`, JSON.stringify({ at: now, data }));
  } catch {
    // full or blocked storage: the next load waits for the server, as before
  }
}

/** On sign-out: nothing of the company stays in this browser. */
export function forgetReads(s: Store | null = store()): void {
  for (const key of ["company", "stream"]) {
    try {
      s?.removeItem(`plania.last.${key}`);
    } catch {
      // nothing to forget
    }
  }
}
