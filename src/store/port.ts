// From a handle to the store behind it. Plania's functions receive a handle (the store's, or a write's) and
// ask here for what they need: the store, the unit of work they are inside, or a reader.
import type { Db } from "../db/client.js";
import { storeOfHandle, unitOfHandle } from "./handles.js";
import type { Reader, Store, UnitOfWork } from "./types.js";

export function storeOf(db: Db): Store {
  const found = storeOfHandle(db);
  if (!found) throw new Error("store: this handle belongs to no open store");
  return found.store;
}

// Inside a write, that write's unit of work.
export function uowOf(q: Db): UnitOfWork {
  const uow = unitOfHandle(q);
  if (!uow) throw new Error("store: not inside a write");
  return uow;
}

// Inside a write it is that write's unit of work, so reads see its changes; anywhere else, committed state.
export function readerOf(q: Db): Reader {
  const reader = unitOfHandle(q) ?? storeOfHandle(q)?.reader();
  if (!reader) throw new Error("store: this handle belongs to no open store");
  return reader;
}
