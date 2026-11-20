// PLA-I68-2: saving, trying and removing a service's key from Camino's Conexiones y llaves. The owner's screen only
// (company routes, cookie). A key is tried before it is saved («Guardar y probar»): a refusal saves nothing and says
// the service's own reason. What is kept in the camino row is the metadata only (last 4, when, expiry, last test).
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { camino } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { findProject } from "../mcp/queries.js";
import { caminoKeys, KEY_SHAPE, last4 } from "./keys.js";
import { keyed, testKey, type KeyTest } from "./providers.js";
import { addHistory, caminoDeps, caminoRow, type CaminoDeps } from "./store.js";
import { caminoSay } from "./words.js";
import type { CaminoConfig, ConnMeta, ProviderId } from "./types.js";

async function setConnection(db: Db, projectId: string, provider: ProviderId, meta: ConnMeta | null) {
  const row = await caminoRow(db, projectId);
  const connections = { ...(row.config.connections ?? {}) };
  if (meta) connections[provider] = meta;
  else delete connections[provider];
  const config: CaminoConfig = { ...row.config, connections };
  await db
    .insert(camino)
    .values({ projectId, config, version: 1 })
    .onConflictDoUpdate({ target: camino.projectId, set: { config, version: sql`${camino.version} + 1`, updatedAt: new Date() } });
}

const testMeta = (t: KeyTest, at: string): NonNullable<ConnMeta["test"]> => ({ ok: t.ok, at, message: t.message, account: t.account, scopes: t.scopes });

export async function saveKey(db: Db, slug: string, provider: string, value: string, deps: CaminoDeps = caminoDeps) {
  if (!keyed(provider)) throw new ToolError("CAMINO_PROVIDER_UNKNOWN", { provider });
  const key = value.trim();
  if (!KEY_SHAPE.test(key)) throw new ToolError("CAMINO_KEY_INVALID");
  const p = await findProject(db, slug);
  const t = await testKey(provider, key, deps.fetch);
  if (!t.ok) throw new ToolError("CAMINO_KEY_REJECTED", { status: t.status, message: t.message });
  const store = caminoKeys();
  try {
    await store.set(p.slug, provider, key);
  } catch {
    throw new ToolError("CAMINO_KEY_STORE");
  }
  const at = deps.now().toISOString();
  const meta: ConnMeta = { last4: last4(key), saved_at: at, store: store.kind === "keychain" ? "keychain" : "file", expires_at: t.expires_at, last_used_at: at, test: testMeta(t, at) };
  await setConnection(db, p.id, provider, meta);
  await addHistory(db, p.id, { who: "owner", label: caminoSay().keySaved(provider, meta.last4), dest: "llavero", undo: caminoSay().undoKey });
  return { provider, meta };
}

export async function tryKey(db: Db, slug: string, provider: string, deps: CaminoDeps = caminoDeps) {
  if (!keyed(provider)) throw new ToolError("CAMINO_PROVIDER_UNKNOWN", { provider });
  const p = await findProject(db, slug);
  const key = await caminoKeys().get(p.slug, provider);
  if (!key) throw new ToolError("CAMINO_KEY_MISSING");
  const t = await testKey(provider, key, deps.fetch);
  const row = await caminoRow(db, p.id);
  const old = row.config.connections?.[provider];
  const at = deps.now().toISOString();
  if (old) await setConnection(db, p.id, provider, { ...old, expires_at: t.expires_at ?? old.expires_at ?? null, last_used_at: at, test: testMeta(t, at) });
  return { provider, ok: t.ok, status: t.status, message: t.message, account: t.account };
}

export async function removeKey(db: Db, slug: string, provider: string) {
  if (!keyed(provider)) throw new ToolError("CAMINO_PROVIDER_UNKNOWN", { provider });
  const p = await findProject(db, slug);
  await caminoKeys().delete(p.slug, provider);
  await setConnection(db, p.id, provider, null);
  await addHistory(db, p.id, { who: "owner", label: caminoSay().keyRemoved(provider), dest: "llavero" });
  return { provider, removed: true };
}

/** For tests and the audit: the camino row never holds a key. */
export async function storedConfigText(db: Db, projectId: string): Promise<string> {
  const [r] = await db.select({ c: camino.config }).from(camino).where(eq(camino.projectId, projectId));
  return JSON.stringify(r?.c ?? {});
}
