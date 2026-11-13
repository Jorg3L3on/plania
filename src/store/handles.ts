// Plania's code passes a database handle around (a Drizzle Db, or a transaction). A store that is not
// Postgres hands out opaque handles of its own, registered here, so the same code runs on it unchanged:
// pgStore, uowOf and readerOf in pg.ts look a handle up here before treating it as Drizzle's.
import type { Reader, Store, UnitOfWork } from "./types.js";

const stores = new WeakMap<object, { store: Store; reader: () => Reader }>();
const units = new WeakMap<object, UnitOfWork>();

export const registerStore = (handle: object, store: Store, reader: () => Reader): void => void stores.set(handle, { store, reader });
export const registerUnit = (handle: object, uow: UnitOfWork): void => void units.set(handle, uow);
export const storeOfHandle = (handle: object): { store: Store; reader: () => Reader } | undefined => stores.get(handle);
export const unitOfHandle = (handle: object): UnitOfWork | undefined => units.get(handle);
