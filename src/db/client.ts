// The handle plania's code passes around where it means "the store". It is opaque: the store that is open
// (src/store/open.ts) hands it out, and src/store/port.ts resolves it back to that store.
export type Db = { readonly __planiaStore: never };

let current: Db | null = null;

// Puts a store's handle in place, or removes it.
export function useDb(handle: Db | null): void {
  current = handle;
}

function handle(): Db {
  if (!current) throw new Error("the store is not open: call openStore() (src/store/open.ts) first");
  return current;
}

// The open store's handle. close is a no-op kept for callers written when each request had its own connection.
export function makeDb(): { db: Db; close: () => Promise<void> } {
  return { db: handle(), close: async () => {} };
}

// Runs fn with the store's handle, opening the store first when nothing has (a script's first call).
export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  if (!current) await (await import("../store/open.js")).openStore();
  return fn(handle());
}

// Closes the store this process opened, so a script can end. The server never calls it.
export async function closeStore(): Promise<void> {
  if (!current) return;
  (await (await import("../store/open.js")).openStore()).close();
  current = null;
}
