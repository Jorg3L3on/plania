// PLA-I68-2: the services a key can be saved for, and how Plania tries a key (Probar, and before saving: «Guardar y
// probar»). One read-only call per service that needs nothing but the key. A refusal comes back with the service's own
// status and message so the screen can say why; the key itself is never in a reply, a log or an error.
import type { ProviderId } from "./types.js";

export type HttpFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;

export type KeyTest = { ok: boolean; status: number | null; message: string; account: string | null; scopes: string[] | null; expires_at: string | null };

type Probe = { url: string; method?: string; body?: string; headers: (key: string) => Record<string, string>; account: (body: any) => string | null };

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });
const PROBES: Partial<Record<ProviderId, Probe>> = {
  github: { url: "https://api.github.com/user", headers: (k) => ({ ...bearer(k), Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }), account: (b) => b?.login ?? null },
  vercel: { url: "https://api.vercel.com/v2/user", headers: bearer, account: (b) => b?.user?.username ?? b?.user?.email ?? null },
  netlify: { url: "https://api.netlify.com/api/v1/user", headers: bearer, account: (b) => b?.full_name ?? b?.slug ?? null },
  render: { url: "https://api.render.com/v1/owners?limit=1", headers: (k) => ({ ...bearer(k), Accept: "application/json" }), account: (b) => (Array.isArray(b) ? (b[0]?.owner?.name ?? null) : null) },
  railway: {
    url: "https://backboard.railway.com/graphql/v2",
    method: "POST",
    body: JSON.stringify({ query: "{ me { name email } }" }),
    headers: (k) => ({ ...bearer(k), "Content-Type": "application/json" }),
    account: (b) => b?.data?.me?.name ?? b?.data?.me?.email ?? null,
  },
  fly: { url: "https://api.machines.dev/v1/apps?org_slug=personal", headers: bearer, account: () => null },
  cloudflare: { url: "https://api.cloudflare.com/client/v4/user/tokens/verify", headers: bearer, account: (b) => b?.result?.status ?? null },
  neon: { url: "https://console.neon.tech/api/v2/projects?limit=1", headers: (k) => ({ ...bearer(k), Accept: "application/json" }), account: (b) => b?.projects?.[0]?.name ?? null },
  supabase: { url: "https://api.supabase.com/v1/projects", headers: bearer, account: (b) => (Array.isArray(b) ? (b[0]?.name ?? null) : null) },
  // A PlanetScale service token is «id:token».
  planetscale: { url: "https://api.planetscale.com/v1/organizations", headers: (k) => ({ Authorization: k, Accept: "application/json" }), account: (b) => b?.data?.[0]?.name ?? null },
};

/** The services whose key Camino can save and try. The rest are Detected or Manual: no key here. */
export const KEYED: ProviderId[] = Object.keys(PROBES) as ProviderId[];
export const keyed = (p: string): p is ProviderId => (KEYED as string[]).includes(p);

function reason(body: unknown): string {
  const b = body as Record<string, any> | null;
  const raw = b?.message ?? b?.error?.message ?? b?.error ?? b?.errors?.[0]?.message ?? b?.errors?.[0] ?? "";
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").slice(0, 200) : "";
}

/** One read-only call with the key. Never throws; a network failure is ok: false with status null. */
export async function testKey(provider: ProviderId, key: string, fetch: HttpFetch, timeoutMs = 10_000): Promise<KeyTest> {
  const probe = PROBES[provider];
  if (!probe) return { ok: false, status: null, message: "no_probe", account: null, scopes: null, expires_at: null };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(probe.url, { method: probe.method ?? "GET", headers: { "User-Agent": "plania", ...probe.headers(key) }, body: probe.body, signal: ctl.signal });
    const body = await res.json().catch(() => null);
    // GraphQL answers 200 with errors for a bad token.
    const gqlError = provider === "railway" && Array.isArray((body as any)?.errors) && !(body as any)?.data?.me;
    // Cloudflare's verify answers 200 for a token that is not active.
    const cfInactive = provider === "cloudflare" && (body as any)?.result?.status && (body as any).result.status !== "active";
    const ok = res.status >= 200 && res.status < 300 && !gqlError && !cfInactive;
    const scopes = provider === "github" ? (res.headers.get("x-oauth-scopes")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null) : null;
    const exp = provider === "github" ? res.headers.get("github-authentication-token-expiration") : provider === "cloudflare" ? ((body as any)?.result?.expires_on ?? null) : null;
    return { ok, status: res.status, message: ok ? "ok" : reason(body) || (cfInactive ? `status ${(body as any).result.status}` : ""), account: ok ? probe.account(body) : null, scopes, expires_at: exp ? new Date(exp).toISOString() : null };
  } catch (e) {
    return { ok: false, status: null, message: ctl.signal.aborted ? "timeout" : "network", account: null, scopes: null, expires_at: null };
  } finally {
    clearTimeout(timer);
  }
}
