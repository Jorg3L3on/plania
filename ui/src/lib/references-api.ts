// PLA-I67-4: the calls behind an agent's references (src/api/company-oficio-refs.ts). Screen cookie only.
import { ApiError } from "./api";
import type { Reference, ReferenceFields, SeatRun } from "./references";

const base = (slug: string, agent: string) => `/api/company/projects/${encodeURIComponent(slug)}/team/${encodeURIComponent(agent)}/references`;

async function call<T>(method: string, url: string, body?: BodyInit, type?: string): Promise<T> {
  const res = await fetch(url, { method, credentials: "same-origin", headers: type ? { "Content-Type": type } : undefined, body });
  if (!res.ok) {
    const { error, ...detail } = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    throw new ApiError(res.status, error ?? `HTTP_${res.status}`, detail);
  }
  return (await res.json()) as T;
}
const json = (v: unknown) => JSON.stringify(v);

export const refsApi = {
  list: (slug: string, agent: string) => call<{ references: Reference[] }>("GET", base(slug, agent)).then((r) => r.references),
  runs: (slug: string, agent: string) => call<{ runs: SeatRun[] }>("GET", `${base(slug, agent)}/runs`).then((r) => r.runs),
  addLink: (slug: string, agent: string, url: string, fields: ReferenceFields = {}) =>
    call<{ reference: Reference; error: { code: string; message: string } | null }>("POST", `${base(slug, agent)}/link`, json({ url, ...fields }), "application/json"),
  // The raw bytes; the server reads the type from them, never from the name.
  addFile: (slug: string, agent: string, file: Blob, name?: string) =>
    call<{ reference: Reference }>("POST", `${base(slug, agent)}/file${name ? `?name=${encodeURIComponent(name)}` : ""}`, file, file.type || "application/octet-stream").then((r) => r.reference),
  update: (slug: string, agent: string, id: string, fields: ReferenceFields) =>
    call<{ reference: Reference }>("PATCH", `${base(slug, agent)}/${encodeURIComponent(id)}`, json(fields), "application/json").then((r) => r.reference),
  retry: (slug: string, agent: string, id: string) => call<{ reference: Reference; error: { code: string; message: string } | null }>("POST", `${base(slug, agent)}/${encodeURIComponent(id)}/retry`),
  remove: (slug: string, agent: string, id: string) => call<{ deleted: true }>("DELETE", `${base(slug, agent)}/${encodeURIComponent(id)}`),
};

