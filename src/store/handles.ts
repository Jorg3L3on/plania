// Plania's code passes a database handle around (the Db, or the handle of a write in progress). The store
// hands out opaque handles, registered here; storeOf, uowOf and readerOf in port.ts look a handle up here.
import type { Reader, Store, UnitOfWork } from "./types.js";

const stores = new WeakMap<object, { store: Store; reader: () => Reader }>();
const units = new WeakMap<object, UnitOfWork>();

export const registerStore = (handle: object, store: Store, reader: () => Reader): void => void stores.set(handle, { store, reader });
export const registerUnit = (handle: object, uow: UnitOfWork): void => void units.set(handle, uow);
export const storeOfHandle = (handle: object): { store: Store; reader: () => Reader } | undefined => stores.get(handle);
export const unitOfHandle = (handle: object): UnitOfWork | undefined => units.get(handle);
