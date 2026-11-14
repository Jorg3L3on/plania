// Opens plania's store, once per process, and makes it what makeDb and withDb hand out.
// The store is devva (deploy/devva/README.md): DEVVA_HOST, DEVVA_PORT, DEVVA_TOKEN_FILE and
// PLANIA_DEVVA_PREFIX say which engine and which lobes.
import { useDb } from "../db/client.js";
import { DevvaStore } from "./devva.js";

let open: Promise<DevvaStore> | null = null;

export function openStore(): Promise<DevvaStore> {
  open ??= DevvaStore.open({ prefix: process.env.PLANIA_DEVVA_PREFIX || "plania" }).then((store) => {
    useDb(store.handle);
    return store;
  });
  return open;
}
