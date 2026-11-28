// PLA-I75 (Conexiones): what a seat's fifth tab reads (src/runner/conexiones-store.ts ConexionesRead), and the pure
// rules of the tab: the catalog's order (its role's first, then by kind) and a cable's one line. Tested without a
// browser (test/i75-conexiones-ui.test.ts).
export type ConexionPrice = "gratis" | "gratis-limite" | "por-confirmar" | "pago";
export type ConexionGroup = "interfaz" | "navegador" | "codigo" | "errores";

export type CatalogItem = {
  id: string;
  group: ConexionGroup;
  recommended: boolean;
  price: ConexionPrice;
  version: string;
  keys: { env: string; name: string; optional: boolean }[];
  reads: number;
  writes: string[];
  never: string[];
  unattended: boolean;
  needs: string | null;
  connected: boolean;
};

export type Cable = {
  server: string;
  version: string;
  custom: { package: string; version: string; args: string[] } | null;
  reviewed: boolean;
  paid: boolean;
  price: ConexionPrice | null;
  keys: { env: string; name: string; optional: boolean; set: boolean }[];
  reads: string[];
  writes: { tool: string; on: boolean }[];
  never: string[];
  change: { from: string; to: string; added: string[]; removed: string[]; nowWrites: string[] } | null;
  usage: { calls: number; failed: number; blocked: number; runs: number; tools: { tool: string; ok: number; failed: number; blocked: number }[] };
  problem: "needs-key" | "not-a-copy" | "needs-review" | null;
};

export type ConexionesRead = {
  agent: string;
  role: string | null;
  catalog: CatalogItem[];
  connections: Cable[];
  requests: { id: string; server: string; reason: string; at: string }[];
  blocked: { run: string; at: string; server: string; tool: string; n: number; task: string | null }[];
  llaves: string[];
};

export const GROUP_ORDER: readonly ConexionGroup[] = ["interfaz", "navegador", "codigo", "errores"];

/** The catalog as the wide sheet lists it: what its role uses first, then the rest by kind; connected ones stay out. */
export function catalogSections(catalog: CatalogItem[]): { id: "recomendadas" | ConexionGroup; items: CatalogItem[] }[] {
  const open = catalog.filter((c) => !c.connected);
  const rec = open.filter((c) => c.recommended && c.unattended);
  const rest = open.filter((c) => !rec.includes(c));
  const out: { id: "recomendadas" | ConexionGroup; items: CatalogItem[] }[] = [];
  if (rec.length) out.push({ id: "recomendadas", items: rec });
  for (const g of GROUP_ORDER) {
    // Within a kind, the ones a run can use first.
    const items = rest.filter((c) => c.group === g).sort((a, b) => Number(b.unattended) - Number(a.unattended));
    if (items.length) out.push({ id: g, items });
  }
  return out;
}

/** Paid or to confirm: the card and the summary say so (the design: nothing paid is connected unsaid). */
export const isPaid = (price: ConexionPrice | null): boolean => price === "pago" || price === "por-confirmar";

/** A cable's tone: amber when the owner has something to do (a version to read, a key, a review), else none. */
export const cableTone = (c: Cable): "amber" | null => (c.problem || c.change ? "amber" : null);

/** Whether a run of this seat gets the cable as it stands. */
export const cableRides = (c: Cable): boolean => !c.problem;
