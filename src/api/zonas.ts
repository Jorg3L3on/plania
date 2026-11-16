// PLA-I53-6: the zone tag. The owner asked whether a piece of work "is in backend"; no field says so, but every ticket
// has `areas`, the path globs it touches (claim warns on overlap). zonasOf turns those globs into at most four tags,
// shown on the board's card and in La ficha: Pantalla (the screen), Servidor (API, MCP, runner, scripts), Datos
// (schema and migrations) and Docs (docs and prompts). Pure, no migration.
//   One area gives one zone: the first rule that matches it, in the table's order (so `src/db/**` is Datos before
//   `src/**` makes it Servidor). An area no rule names is Servidor (code that is neither screen, data nor docs).
//   A ticket's zones are the distinct zones of its areas, in ZONAS order; no areas, no zones.
// The table is data: a project could pass its own (settings) later without touching the function.

export const ZONAS = ["pantalla", "servidor", "datos", "docs"] as const;
export type Zona = (typeof ZONAS)[number];

// A rule matches an area (leading «./» or «/» and a trailing «/**» or «/*» dropped) when the area is one of `prefix`
// or sits under it (prefix «src» takes «src/api/x.ts»), ends with one of `suffix`, or contains one of `contains`.
export type ZonaRule = { zona: Zona; prefix?: string[]; suffix?: string[]; contains?: string[] };

export const DEFAULT_ZONA_RULES: ZonaRule[] = [
  { zona: "datos", prefix: ["drizzle", "src/db", "migrations", "db"], suffix: [".sql"], contains: ["migration"] },
  { zona: "docs", prefix: ["docs", "prompts"], suffix: [".md", ".mdx"] },
  { zona: "pantalla", prefix: ["ui", "public"], suffix: [".tsx", ".jsx", ".css", ".html"] },
  { zona: "servidor", prefix: ["src", "scripts", "test", "config"], suffix: [".ts", ".mts", ".js"] },
];
// What an area no rule names becomes.
export const DEFAULT_ZONA: Zona = "servidor";

const clean = (area: string) =>
  area
    .trim()
    .replace(/^\.?\/+/, "")
    .replace(/\/\*\*?$/, "");

export function zonaOfArea(area: string, rules: ZonaRule[] = DEFAULT_ZONA_RULES, fallback: Zona = DEFAULT_ZONA): Zona | null {
  const a = clean(area);
  if (!a) return null;
  const lower = a.toLowerCase();
  for (const r of rules) {
    if (r.prefix?.some((p) => a === p || a.startsWith(`${p}/`))) return r.zona;
    if (r.suffix?.some((s) => lower.endsWith(s))) return r.zona;
    if (r.contains?.some((c) => lower.includes(c))) return r.zona;
  }
  return fallback;
}

export function zonasOf(areas: readonly string[] | null | undefined, rules: ZonaRule[] = DEFAULT_ZONA_RULES, fallback: Zona = DEFAULT_ZONA): Zona[] {
  const got = new Set<Zona>();
  for (const area of areas ?? []) {
    const z = zonaOfArea(area, rules, fallback);
    if (z) got.add(z);
  }
  return ZONAS.filter((z) => got.has(z));
}
