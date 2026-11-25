// PLA-I75: the calls behind a seat's Conexiones tab (src/api/company-conexiones.ts). Screen cookie only. Every write
// answers with the fresh read. No call sends or receives a key's value.
import { ApiError } from "./api";
import type { ConexionesRead } from "./conexiones";

const base = (slug: string, agent: string) => `/api/company/projects/${encodeURIComponent(slug)}/team/${encodeURIComponent(agent)}`;

async function call(method: string, url: string, body?: unknown): Promise<ConexionesRead> {
  const res = await fetch(url, { method, credentials: "same-origin", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    const { error, ...detail } = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    throw new ApiError(res.status, error ?? `HTTP_${res.status}`, detail);
  }
  return (await res.json()) as ConexionesRead;
}
const one = (slug: string, agent: string, server: string) => `${base(slug, agent)}/conexiones/${encodeURIComponent(server)}`;

export const conexionesApi = {
  read: (slug: string, agent: string) => call("GET", `${base(slug, agent)}/conexiones`),
  connect: (slug: string, agent: string, server: string, keys?: Record<string, string>) => call("PUT", one(slug, agent, server), keys ? { keys } : {}),
  setWrite: (slug: string, agent: string, server: string, tool: string, on: boolean) => call("PUT", `${one(slug, agent, server)}/writes/${encodeURIComponent(tool)}`, { on }),
  acceptVersion: (slug: string, agent: string, server: string) => call("POST", `${one(slug, agent, server)}/version`),
  review: (slug: string, agent: string, server: string) => call("POST", `${one(slug, agent, server)}/review`),
  disconnect: (slug: string, agent: string, server: string) => call("DELETE", one(slug, agent, server)),
  addCustom: (slug: string, agent: string, input: { server: string; package: string; version: string; args: string[] }) => call("POST", `${base(slug, agent)}/conexiones-propias`, input),
  decide: (slug: string, agent: string, id: string, accept: boolean) => call("POST", `${base(slug, agent)}/conexiones-pedidos/${encodeURIComponent(id)}`, { accept }),
};
