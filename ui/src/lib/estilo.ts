// PLA-I69-4: Marca → Estilo, the screen's logic and words. The values the screen shows while the owner drags are made
// here with the same rules as the server's files (src/brand/style.ts); test/i69-estilo checks brand.css comes out the
// same from both. Easy first (a direction, a colour, a font from a list), every value and its code for an expert.
import { defineWords, words } from "./i18n.js";
import { HEX, contrast, fromLch, onColor, oklchCss, scale, toLch, distance } from "./color.js";

export type Neutral = "frio" | "neutro" | "calido";
export type Style = {
  brand: string; brandTie: "sigue" | "fijo"; accent: string; neutral: Neutral;
  head: string; body: string; mono: string; base: number; ratio: number; wHead: number; lh: number;
  radius: number; pill: boolean; shadow: "plana" | "suave" | "marcada"; border: 0 | 1 | 2; density: "compacto" | "comodo" | "amplio";
  lib: string; stroke: number; fill: boolean; motion: "ninguno" | "calmo" | "normal" | "vivo";
};
export type RepoStyle = { brand?: string; accent?: string; head?: string; body?: string; radius?: number; theme?: string; dark?: boolean; shadcn?: boolean; files: string[] };
// PLA-130: fields, the settings of a part that reach the files and differ from where the style started.
// base "start": the repo does not set this value, so it is compared with where the style started (PLA-130).
export type StyleChange = { part: "color" | "letra" | "forma" | "espacio" | "iconos" | "mov"; from: string; to: string; fields?: (keyof Style)[]; base?: "start" };
export type StyleRead = {
  style: Style | null;
  base: Style;
  start?: Style;
  repo: RepoStyle;
  changes: StyleChange[];
  old: { path: string; n: number; colors: string[] }[];
  versions: number;
  versionsList: { v: number; at: string; current: boolean }[];
  pedido: { key: string; status: string } | null;
  framework: "next-app" | "vite" | "static";
  root: string;
  css: string;
  json: string;
  fonts: string[];
  logo: { theme: string | null; colors: string[] };
  cssOpts: CssOpts;
};

export const SYSTEM = "system-ui";
export type FontCat = "sans" | "serif" | "display" | "mono";
/** The fonts offered, each with its kind (the same list as the server's FONTS; all OFL, with ñ and accents). */
export const FONT_CAT: Record<string, FontCat> = {
  Geist: "sans", Inter: "sans", "DM Sans": "sans", Manrope: "sans", "Plus Jakarta Sans": "sans", "Nunito Sans": "sans", "IBM Plex Sans": "sans", "Atkinson Hyperlegible": "sans",
  Outfit: "display", Sora: "display", "Space Grotesk": "display", "Bricolage Grotesque": "display", Nunito: "display",
  Fraunces: "serif", "Playfair Display": "serif", Lora: "serif", "Source Serif 4": "serif", "Instrument Serif": "serif",
  "JetBrains Mono": "mono",
};
export const PAIRS: [string, string, string][] = [["moderna", "Geist", "Geist"], ["caracter", "Bricolage Grotesque", "Geist"], ["editorial", "Fraunces", "Inter"], ["amable", "Nunito", "Nunito Sans"], ["tecnica", "Space Grotesk", "IBM Plex Sans"], ["legible", "Atkinson Hyperlegible", "Atkinson Hyperlegible"]];
export const RATIOS = [1.125, 1.2, 1.25, 1.333] as const;
// PLA-130: Imágenes and Logo left Estilo: neither reached the repo or an agent (the logo is changed in Caras).
export const SECS = ["color", "letra", "forma", "espacio", "iconos", "mov", "trato"] as const;
export type Sec = (typeof SECS)[number];
export const LIBS = ["Lucide", "Phosphor", "Tabler", "Heroicons", "Material Symbols"] as const;

/** Google Fonts' CSS for one family (loaded only when the owner looks at it). */
export const fontHref = (f: string) => (f === SYSTEM ? null : `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;600;700&display=swap`);
export const family = (f: string) => (f === SYSTEM ? "system-ui, -apple-system, Arial, sans-serif" : `"${f}", system-ui, sans-serif`);

// ---------- derived values (the same as src/brand/style.ts) ----------
export type Tokens = { light: Record<string, string>; dark: Record<string, string>; scale: string[]; chart: string[]; sizes: { base: number; h1: number; h2: number; h3: number; small: number }; radius: number; button: number; spacing: string; duration: number; ease: string; shadow: string };
export function tokens(s: Style): Tokens {
  const sc = scale(s.brand);
  const [, , bh] = toLch(s.brand);
  const nh = s.neutral === "frio" ? 255 : s.neutral === "calido" ? 65 : bh;
  const nc = s.neutral === "neutro" ? 0.004 : 0.013;
  const N = (L: number) => fromLch(L, nc, nh);
  const darkBg = N(0.17);
  const darkBrand = contrast(s.brand, darkBg) >= 3 ? s.brand : sc[3]!;
  // A field's border must reach 3:1 against its surface (WCAG 1.4.11); a hover is a step darker (lighter on dark).
  const [bL, bC] = toLch(s.brand);
  const [dL, dC, dH] = toLch(darkBrand);
  // PLA-130: the brand as text (links, the current tab): itself when it reads at 4.5 : 1, else the nearest darker
  // step of its own scale (lighter on dark), so a light brand colour never makes unreadable links.
  const firstReadable = (steps: string[], ...on: string[]) => steps.find((c) => on.every((bg) => contrast(c, bg) >= 4.5)) ?? steps[steps.length - 1]!;
  const brandText = firstReadable([s.brand, ...sc.slice(5)], N(0.985), "#ffffff");
  const darkBrandText = firstReadable([darkBrand, sc[3]!, sc[2]!, sc[1]!, sc[0]!], darkBg, N(0.215));
  const light = { background: N(0.985), card: "#ffffff", foreground: N(0.21), muted: N(0.5), border: N(0.91), input: N(0.6), brand: s.brand, "brand-hover": fromLch(Math.max(0.15, bL - 0.07), bC, bh), "on-brand": onColor(s.brand), "brand-text": brandText, tint: sc[1]!, "on-tint": sc[8]!, accent: s.accent, "on-accent": onColor(s.accent), success: "#166534", warning: "#92400e", danger: "#b91c1c" }; // PLA-130: success and warning text reach 4.5 : 1 on their own tint
  const dark = { background: darkBg, card: N(0.215), foreground: N(0.96), muted: N(0.72), border: N(0.3), input: N(0.52), brand: darkBrand, "brand-hover": fromLch(Math.min(0.95, dL + 0.07), dC, dH), "on-brand": onColor(darkBrand), "brand-text": darkBrandText, tint: sc[9]!, "on-tint": sc[1]!, accent: s.accent, "on-accent": onColor(s.accent), success: "#4ade80", warning: "#fbbf24", danger: "#f87171" };
  const chart = [0, 1, 2, 3, 4].map((i) => fromLch([0.52, 0.72, 0.62, 0.82, 0.45][i]!, 0.13, (bh + i * 72) % 360));
  const sizes = { base: s.base, h1: Math.round(s.base * s.ratio ** 3), h2: Math.round(s.base * s.ratio ** 2), h3: Math.round(s.base * s.ratio), small: Math.round(s.base / s.ratio) };
  const duration = { ninguno: 0, calmo: 320, normal: 200, vivo: 140 }[s.motion];
  return {
    light, dark, scale: sc, chart, sizes, radius: s.radius, button: s.pill ? 999 : s.radius,
    spacing: s.density === "compacto" ? "0.22rem" : s.density === "amplio" ? "0.3rem" : "0.25rem",
    duration, ease: s.motion === "vivo" ? "cubic-bezier(.34,1.56,.64,1)" : "cubic-bezier(.2,.8,.2,1)",
    shadow: s.shadow === "plana" ? "none" : s.shadow === "marcada" ? "0 8px 24px rgb(0 0 0 / .18)" : "0 1px 2px rgb(0 0 0 / .06), 0 4px 12px rgb(0 0 0 / .07)",
  };
}
const STEP = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
/** How the repo wires its CSS: next/font gives each family a variable (the family name itself is hashed), and
 * shadcn/ui owns --primary, --accent and --muted with its own meanings. */
// PLA-130: dark false = the repo has no dark mode; Plania writes none, so the app's themes stay as they are.
export type CssOpts = { next?: boolean; shadcn?: boolean; dark?: boolean };
export const fontVar = (f: string) => `--font-${f.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
/** brand.css: Tailwind 4 @theme for the utilities, and the same values as variables for light and dark. */
export function brandCss(s: Style, o: CssOpts = {}): string {
  const t = tokens(s);
  const ff = (f: string) => (f === SYSTEM ? "system-ui" : o.next ? `var(${fontVar(f)})` : `"${f}"`);
  const vars = (x: Record<string, string>) => Object.entries(x).map(([k, v]) => `  --${k}: ${v};`).join("\n");
  const side = (x: Record<string, string>): Record<string, string> =>
    o.shadcn
      ? {
          primary: x.brand!, "primary-hover": x["brand-hover"]!, "primary-foreground": x["on-brand"]!, "brand-text": x["brand-text"]!, ring: x.brand!, accent: x.tint!, "accent-foreground": x["on-tint"]!,
          background: x.background!, foreground: x.foreground!, card: x.card!, "card-foreground": x.foreground!, popover: x.card!, "popover-foreground": x.foreground!,
          border: x.border!, input: x.input!, "muted-foreground": x.muted!, destructive: x.danger!,
          "sidebar-primary": x.brand!, "sidebar-primary-foreground": x["on-brand"]!, "sidebar-ring": x.brand!, "sidebar-accent": x.tint!, "sidebar-accent-foreground": x["on-tint"]!,
          brand: x.brand!, "brand-accent": x.accent!, "on-brand-accent": x["on-accent"]!, success: x.success!, warning: x.warning!,
        }
      : x;
  return `/* The brand's style, kept by Plania (Marca → Estilo). Change it there; this file is remade from it. */
@theme {
${t.scale.map((c, i) => `  --color-brand-${STEP[i]}: ${c};`).join("\n")}
  --color-brand: var(--brand);
  --color-${o.shadcn ? "brand-accent: var(--brand-accent)" : "accent: var(--accent)"};
${t.chart.map((c, i) => `  --color-chart-${i + 1}: ${c};`).join("\n")}
  --font-heading: ${ff(s.head)}, ui-sans-serif, system-ui, sans-serif;
  --font-sans: ${ff(s.body)}, ui-sans-serif, system-ui, sans-serif;
  --font-mono: ${ff(s.mono)}, ui-monospace, monospace;
  --text-base: ${s.base / 16}rem;
  --radius-md: ${t.radius}px;
  --spacing: ${t.spacing};
  --ease-brand: ${t.ease};
  --default-transition-duration: ${t.duration}ms;
}

:root {
${vars(side(t.light))}
  --radius: ${t.radius}px;
  --radius-button: ${t.button}px;
  --shadow-card: ${t.shadow};
  --heading-weight: ${s.wHead};
  --line-height: ${s.lh};
  --icon-stroke: ${s.stroke};
}

${o.dark === false ? "" : `.dark {
${vars(side(t.dark))}
}

`}svg.lucide { stroke-width: var(--icon-stroke); }

@layer base {
  h1, h2, h3, h4 { font-family: var(--font-heading); font-weight: var(--heading-weight); }
}

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
`;
}
export function tokensJson(s: Style, o: CssOpts = {}): string {
  const t = tokens(s);
  const c = (v: string) => ({ $type: "color", $value: v });
  return `${JSON.stringify(
    {
      color: { brand: c(s.brand), accent: c(s.accent), ...Object.fromEntries(t.scale.map((v, i) => [`brand-${STEP[i]}`, c(v)])), light: Object.fromEntries(Object.entries(t.light).map(([k, v]) => [k, c(v)])), ...(o.dark === false ? {} : { dark: Object.fromEntries(Object.entries(t.dark).map(([k, v]) => [k, c(v)])) }) },
      font: { heading: { $type: "fontFamily", $value: [s.head, "sans-serif"] }, body: { $type: "fontFamily", $value: [s.body, "sans-serif"] }, mono: { $type: "fontFamily", $value: [s.mono, "monospace"] } },
      dimension: { radius: { $type: "dimension", $value: { value: t.radius, unit: "px" } }, "text-base": { $type: "dimension", $value: { value: s.base, unit: "px" } } },
      duration: { base: { $type: "duration", $value: { value: t.duration, unit: "ms" } } },
    },
    null,
    2,
  )}\n`;
}
export type CodeFmt = "tailwind" | "shadcn" | "w3c";
export const codeOf = (s: Style, f: CodeFmt, o: CssOpts = {}) => (f === "w3c" ? tokensJson(s, o) : f === "shadcn" ? brandCss(s, { ...o, shadcn: true }) : brandCss(s, o));

/** An expert's code, read back: brand, accent, radius and the fonts Plania knows. What is not recognised is left. */
export function fromCode(txt: string, s: Style, fonts: string[]): { next: Style; n: number } {
  const next = { ...s };
  let n = 0;
  const m = (re: RegExp) => txt.match(re);
  const col = (v: string | undefined) => (v ? (HEX.test(v.trim()) ? v.trim().toLowerCase() : oklchCss(v)) : null);
  const b = col(m(/--(?:brand|primary)\s*:\s*([^;\n]+)/)?.[1]) ?? col(m(/"brand"\s*:\s*\{[^}]*"\$value"\s*:\s*"([^"]+)"/)?.[1]);
  if (b && b !== next.brand) { next.brand = b; next.brandTie = "fijo"; n++; }
  const a = col(m(/--accent\s*:\s*([^;\n]+)/)?.[1]) ?? col(m(/"accent"\s*:\s*\{[^}]*"\$value"\s*:\s*"([^"]+)"/)?.[1]);
  if (a && a !== next.accent) { next.accent = a; n++; }
  const px = m(/--radius(?:-md)?\s*:\s*(\d+(?:\.\d+)?)px/);
  const rem = m(/--radius\s*:\s*([\d.]+)rem/);
  const r = px ? Math.round(Number(px[1])) : rem ? Math.round(Number(rem[1]) * 16) : null;
  if (r !== null && r !== next.radius) { next.radius = Math.min(48, r); n++; }
  const font = (re: RegExp, k: "head" | "body" | "mono") => {
    const f = m(re)?.[1];
    if (f && fonts.includes(f) && f !== next[k]) { next[k] = f; n++; }
  };
  font(/--font-heading\s*:\s*"([^"]+)"/, "head");
  font(/--font-sans\s*:\s*"([^"]+)"/, "body");
  font(/--font-mono\s*:\s*"([^"]+)"/, "mono");
  font(/"heading"\s*:\s*\{[^}]*"\$value"\s*:\s*\[\s*"([^"]+)"/, "head");
  font(/"body"\s*:\s*\{[^}]*"\$value"\s*:\s*\[\s*"([^"]+)"/, "body");
  return { next, n };
}

/** The repo as a style, to draw its reflection: what the repo says, the rest plain. */
export function repoAsStyle(repo: RepoStyle, base: Style): Style {
  return { ...base, brand: repo.brand ?? repo.theme ?? "#6b7280", accent: repo.accent ?? repo.brand ?? "#6b7280", neutral: "neutro", head: repo.head ?? repo.body ?? SYSTEM, body: repo.body ?? SYSTEM, radius: repo.radius ?? 6, pill: false, shadow: "plana", density: "comodo", motion: "ninguno", wHead: 700 };
}

/** What differs from the repo, part by part (the server's changesOf, plus the parts the repo cannot say). */
export function changesOf(s: Style, repo: RepoStyle, start?: Style): StyleChange[] {
  const out: StyleChange[] = [];
  const rb = repo.brand ?? repo.theme;
  // PLA-130: a value the repo does not set is compared with where the style started, so undoing it clears the tag.
  if (!rb && start) { if (distance(start.brand, s.brand) > 0.02) out.push({ part: "color", from: start.brand, to: s.brand, base: "start" }); }
  else if (!rb || distance(rb, s.brand) > 0.02 || (repo.accent && distance(repo.accent, s.accent) > 0.02)) out.push({ part: "color", from: rb ?? "—", to: s.brand });
  if ((repo.body ?? SYSTEM) !== s.body || (repo.head ?? repo.body ?? SYSTEM) !== s.head) out.push({ part: "letra", from: repo.head ?? repo.body ?? SYSTEM, to: s.head === s.body ? s.head : `${s.head} + ${s.body}` });
  if (repo.radius === undefined && start) { if (start.radius !== s.radius) out.push({ part: "forma", from: `${start.radius} px`, to: `${s.radius} px`, base: "start" }); }
  else if ((repo.radius ?? -1) !== s.radius) out.push({ part: "forma", from: repo.radius === undefined ? "—" : `${repo.radius} px`, to: `${s.radius} px` });
  if (!start) return out;
  // PLA-130: the settings the repo cannot say, against where the style started; only those that reach brand.css,
  // tokens.json or Taller's note (borders, icon fill and images only change the preview).
  const extra: Record<StyleChange["part"], (keyof Style)[]> = {
    color: ["neutral", ...(repo.accent ? [] : (["accent"] as (keyof Style)[]))],
    letra: ["base", "ratio", "wHead", "lh", "mono"],
    forma: ["pill", "shadow"],
    espacio: ["density"],
    iconos: ["lib", "stroke"],
    mov: ["motion"],
  };
  for (const part of Object.keys(extra) as StyleChange["part"][]) {
    const fields = extra[part].filter((k) => s[k] !== start[k]);
    if (!fields.length) continue;
    const had = out.find((c) => c.part === part);
    if (had) had.fields = fields;
    else out.push({ part, from: "", to: "", fields });
  }
  return out;
}

export const ESTILO_WORDS = defineWords({
  es: {
    doors: { caras: "Logo", estilo: "Estilo", historial: "Historial" }, // PLA-130: the first tab is «Logo» (it was «Caras»)
    doorsLabel: "Partes de la marca",
    doorState: { files: (n: number) => (n === 1 ? "1 por llevar" : `${n} por llevar`), changes: (n: number) => (n === 1 ? "1 cambio" : `${n} cambios`), way: "en camino", ok: "al día" },
    loading: "Leyendo el estilo del repo…",
    readError: "el estilo",
    secs: { color: "Color", letra: "Letra", forma: "Forma", espacio: "Espacio", iconos: "Íconos", mov: "Movimiento", trato: "Trato" } as Record<string, string>,
    rail: "Partes del estilo",
    differs: "Distinto del repo",
    previewOnly: "Solo para la vista previa: no se escribe en el repo.",
    // PLA-130: «Cómo trata a la gente» moved here when Voz y nombre left Marca.
    tratoNote: "Taller, Artist y el bot del producto escriben los textos de la app con este trato. Se aplica al guardar: no hace falta pedido.",
    tratoSaved: "Guardado: los agentes ya tratan así a la gente.",
    // PLA-130: a «cambia» tag instead of a dot, what it changes from and to, and undoing one part.
    tag: "cambia",
    diff: (from: string, to: string) => `Hoy en el repo: ${from} → con este estilo: ${to}`,
    diffStart: (from: string, to: string) => `El repo no lo define; Plania empieza en ${from} → con este estilo: ${to}`,
    unset: "no lo define",
    undo: "Volver a lo del repo",
    undoStart: (v: string) => `Volver a ${v}`,
    undoNone: "El repo no lo define: Plania lo agrega.",
    fields: { neutral: "grises", accent: "color secundario", base: "tamaño del texto", ratio: "escala de títulos", wHead: "grosor de títulos", lh: "interlineado", mono: "letra de código", pill: "botones píldora", shadow: "sombras", density: "aire", lib: "librería", stroke: "trazo", motion: "movimiento" } as Record<string, string>,
    fieldsLine: (list: string) => `Cambia: ${list}`,
    yes: "sí",
    no: "no",
    undoAll: {
      button: "Deshacer cambios",
      title: "¿Volver todo a lo del repo?",
      lead: "Cada parte vuelve a lo que hay hoy en el repo. El estilo de ahora queda en Historial, por si lo quieres de vuelta.",
      back: (now: string, repo: string) => `${now} → ${repo}`,
      stays: "se queda: el repo no lo define",
      go: "Sí, volver a lo del repo",
      done: "Volvió a lo del repo. El estilo anterior está en Historial.",
    },
    sum: {
      follows: "sigue al logo",
      chosen: "elegido",
      pill: "píldora",
      shadow: (s: string) => `sombra ${s}`,
      stroke: (n: number) => `trazo ${n}`,
    },
    color: {
      // PLA-130: Material UI's words (primary, secondary); «ideas» are only suggestions for the main colour.
      brand: "Color principal",
      follows: "sigue al logo",
      followAgain: "Volver a seguir al logo",
      brandLabel: "Color principal",
      hexLabel: "Código del color",
      hexBad: "Escribe el código así: #RRGGBB",
      fromLogo: "del logo",
      ideas: "Otras opciones",
      scale: "La escala del color principal",
      accent: "Color secundario",
      accentNote: "acento",
      accentLabel: "Color secundario",
      greys: "Grises",
      neutral: { frio: "Fríos", neutro: "Neutros", calido: "Cálidos" } as Record<string, string>,
      contrast: "Contraste (WCAG 2.2 AA)",
      checks: ["Texto en el botón", "Principal como texto sobre el fondo", "Principal sobre fondo oscuro", "Secundario como texto"],
      onlyBig: "· solo grande",
      onlyBg: "· solo fondos",
      more: "Más: estados, gráficas y modo oscuro",
      states: "Estados",
      stateNames: ["Éxito", "Aviso", "Error"],
      charts: "Gráficas",
      chartsOk: "se distinguen también por luz",
      darkNote: "El modo oscuro sale solo de tu color: la marca se aclara si no se ve sobre el fondo oscuro.",
    },
    letra: {
      pairs: "Pares que ya funcionan",
      pairNames: { moderna: "Moderna", caracter: "Con carácter", editorial: "Editorial", amable: "Amable", tecnica: "Técnica", legible: "Fácil de leer" } as Record<string, string>,
      head: "Títulos",
      body: "Texto",
      mono: "Código y cifras",
      size: "Tamaño del texto",
      ratio: "Escala de títulos",
      ratios: ["Suave", "Media", "Marcada", "Dramática"],
      levels: ["Título", "Subtítulo", "Sección", "Texto", "Pequeño"],
      more: "Más: grosor, interlineado y letra de código",
      weight: "Grosor de títulos",
      lh: "Interlineado",
      note: "Se cargan con next/font (o Google Fonts) con el subconjunto latin-ext para ñ y acentos. Solo licencias libres.",
      search: "Buscar fuente…",
      cats: { todas: "Todas", sans: "Sin serifa", serif: "Con serifa", display: "Con carácter", mono: "Mono" } as Record<string, string>,
      sample: "Ññ áé ¿¡ — Así se lee",
      free: "OFL · libre",
      none: (q: string) => `Ninguna con «${q}» en la lista. Escribe el nombre exacto de una de Google Fonts y elige «Usar esta».`,
      useTyped: (q: string) => `Usar «${q}»`,
      footer: (w: string) => `${w} · todas con ñ y acentos`,
      say: {
        Geist: "moderna", Inter: "la más usada en apps", "DM Sans": "geométrica, amable", Manrope: "redonda, técnica", "Plus Jakarta Sans": "cálida, moderna", "Nunito Sans": "suave", "IBM Plex Sans": "técnica", "Atkinson Hyperlegible": "hecha para leer fácil",
        Outfit: "geométrica", Sora: "futurista", "Space Grotesk": "técnica con carácter", "Bricolage Grotesque": "con personalidad", Nunito: "redonda y amable",
        Fraunces: "editorial, blanda", "Playfair Display": "elegante, de contraste", Lora: "para leer largo", "Source Serif 4": "sobria", "Instrument Serif": "fina, de revista", "JetBrains Mono": "para código y cifras", "system-ui": "la del sistema",
      } as Record<string, string>,
    },
    forma: {
      corners: "Esquinas",
      tiles: ["Rectas", "Suaves", "Redondas", "Muy redondas"],
      radiusLabel: "Radio de esquinas",
      pill: "Botones en forma de píldora",
      shadows: "Sombras",
      shadow: { plana: "Planas", suave: "Suaves", marcada: "Marcadas" } as Record<string, string>,
      borders: "Bordes",
      border: ["Sin borde", "Finos", "Gruesos"],
    },
    espacio: {
      air: "Aire entre las cosas",
      density: { compacto: "Compacto", comodo: "Cómodo", amplio: "Amplio" } as Record<string, string>,
      note: "Compacto para tablas y paneles con mucho dato; cómodo para la mayoría; amplio para apps de lectura o de una cosa a la vez.",
    },
    iconos: {
      lib: "Biblioteca",
      libLabel: "Biblioteca de íconos",
      libs: { Lucide: "Lucide · recomendada, viene con shadcn/ui", Phosphor: "Phosphor · seis grosores", Tabler: "Tabler · más de 5,000", Heroicons: "Heroicons · de Tailwind", "Material Symbols": "Material Symbols · de Google" } as Record<string, string>,
      libNote: "Cambiar de biblioteca toca muchos archivos: Taller solo cambia donde ya se importan íconos y deja una nota si es mucho.",
      stroke: "Trazo",
      strokes: ["Fino", "Normal", "Grueso"],
      noStroke: "Material Symbols viene en un solo grosor: el trazo no le cambia nada.",
      style: "Estilo",
      fill: ["Contorno", "Relleno"],
      note: (lib: string) => `Muestra dibujada con los íconos de ${lib}; el trazo cambia en toda la app con una regla.`,
    },
    mov: {
      how: "Cómo se mueve",
      motion: { ninguno: "Quieto", calmo: "Calmo", normal: "Normal", vivo: "Vivo" } as Record<string, string>,
      play: "Ver el aviso",
      says: { ninguno: "sin animación", calmo: "320 ms, suave", normal: "200 ms", vivo: "140 ms, con rebote" } as Record<string, string>,
      note: "Si el teléfono pide «reducir movimiento», la app no anima nada, elijas lo que elijas.",
    },
    spec: {
      nav: ["Inicio", "Buscar", "Ajustes"],
      title: "Lo de hoy",
      sub: "Tres cosas esperan tu vista.",
      save: "Guardar",
      main: "Crear nuevo",
      search: "Buscar…",
      cards: ["Primera", "Segunda"],
      open: "Abierto",
      wait: "Pendiente",
      meta: ["12 elementos", "8 elementos"],
      toggle: "Avisarme si cambia",
      link: "Ver más",
      toast: "Guardado",
    },
    bar: {
      // PLA-130: the parts by name (the ones with a dot), not a count that reads like the file count.
      pending: (parts: string[]) => `Por llevar: ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}` : parts[0]}`,
      files: (n: number) => `en ${n} archivos`,
      same: "Igual que el repo",
      sendNone: "Llevar al repo",
      way: (k: string) => `En camino · ${k}`,
      saving: "Guardando…",
      saved: "Guardado en Plania",
    },
    caps: {
      // PLA-130: say it is a sample screen drawn in the style, not the project's own app.
      light: "▲ PANTALLA DE EJEMPLO CON ESTE ESTILO · CLARO",
      dark: "▲ LA MISMA, EN OSCURO",
      repo: (s: string) => `▼ LA MISMA PANTALLA CON LO QUE HAY HOY EN EL REPO · ${s}`,
      repoDark: "▼ LA MISMA PANTALLA CON LO QUE HAY HOY EN EL REPO · modo oscuro",
      noDark: "El repo no tiene modo oscuro.",
      darkLocked: "▲ MODO OSCURO",
      lockedDark: "Tu app no tiene modo oscuro",
      lockedDarkLine: "Plania no lo dibuja ni lo agrega: el pedido solo cambia el modo claro.",
      unknown: "Plania no reconoció colores ni letra en el repo: se muestra lo que usaría el navegador.",
      sys: "letra del sistema",
      corners: (n: number) => `esquinas ${n} px`,
    },
    send: {
      title: (n: number) => `Un pedido para Taller · ${n} archivos`,
      lead: "Taller pone el estilo en el repo y cambia los colores sueltos por variables. Nada cambia en el repo hasta que aceptes.",
      items: [["brand.css", "variables de Tailwind 4, claro y oscuro"], ["tokens.json", "los mismos valores, formato W3C"], ["las letras", "se cargan en el layout"]] as [string, string][],
      cssLight: "variables de Tailwind 4, solo modo claro",
      old: (n: number) => (n === 1 ? "1 archivo con colores viejos escritos a mano" : `${n} archivos con colores viejos escritos a mano`),
      cancel: "Cancelar",
      go: "Pedírselo a Taller",
      sent: (k: string) => `Pedido a Taller (${k}).`,
    },
    expert: {
      label: "Modo experto",
      code: "Código",
      fmts: { tailwind: "Tailwind 4", shadcn: "shadcn/ui", w3c: "Tokens W3C" } as Record<string, string>,
      codeLabel: "Código del estilo",
      importRepo: "Importar del repo",
      copy: "Copiar",
      apply: "Aplicar el código",
      applied: (n: number) => (n === 0 ? "Sin cambios que Plania reconozca" : n === 1 ? "1 cambio aplicado desde el código" : `${n} cambios aplicados desde el código`),
      imported: "Importado del repo: ahora es igual a lo que hay",
      copied: "Copiado",
      diff: (n: number) => `Diferencias con el repo · ${n}`,
      same: "Igual que el repo.",
      parts: { color: "Color", letra: "Letra", forma: "Forma", espacio: "Espacio", iconos: "Íconos", mov: "Movimiento" } as Record<string, string>,
      mode: { claro: "Claro", oscuro: "Oscuro" } as Record<string, string>,
      live: "la muestra cambia mientras editas",
      read: "Lo que Plania leyó del repo",
      readNone: "Nada reconocido: ni variables de color, ni radio, ni letras cargadas.",
    },
  },
  en: {
    doors: { caras: "Logo", estilo: "Style", historial: "History" },
    doorsLabel: "Parts of the brand",
    doorState: { files: (n: number) => (n === 1 ? "1 to bring" : `${n} to bring`), changes: (n: number) => (n === 1 ? "1 change" : `${n} changes`), way: "on its way", ok: "up to date" },
    loading: "Reading the repo's style…",
    readError: "the style",
    secs: { color: "Colour", letra: "Type", forma: "Shape", espacio: "Space", iconos: "Icons", mov: "Motion", trato: "Address" } as Record<string, string>,
    rail: "Parts of the style",
    differs: "Differs from the repo",
    previewOnly: "Preview only: it is not written into the repo.",
    tratoNote: "Taller, Artist and the product bot write the app's texts with this form of address. It applies when saved: no request needed.",
    tratoSaved: "Saved: the agents already address people this way.",
    tag: "changes",
    diff: (from: string, to: string) => `In the repo today: ${from} → with this style: ${to}`,
    diffStart: (from: string, to: string) => `The repo does not set it; Plania starts at ${from} → with this style: ${to}`,
    unset: "not set",
    undo: "Back to what the repo has",
    undoStart: (v: string) => `Back to ${v}`,
    undoNone: "The repo does not set it: Plania adds it.",
    fields: { neutral: "greys", accent: "secondary colour", base: "text size", ratio: "heading scale", wHead: "heading weight", lh: "line height", mono: "code font", pill: "pill buttons", shadow: "shadows", density: "spacing", lib: "library", stroke: "stroke", motion: "motion" } as Record<string, string>,
    fieldsLine: (list: string) => `Changes: ${list}`,
    yes: "yes",
    no: "no",
    undoAll: {
      button: "Undo changes",
      title: "Put everything back to what the repo has?",
      lead: "Each part goes back to what the repo has today. The current style stays in History, in case you want it back.",
      back: (now: string, repo: string) => `${now} → ${repo}`,
      stays: "stays: the repo does not set it",
      go: "Yes, back to the repo",
      done: "Back to what the repo has. The previous style is in History.",
    },
    sum: {
      follows: "follows the logo",
      chosen: "chosen",
      pill: "pill",
      shadow: (s: string) => `${s} shadow`,
      stroke: (n: number) => `stroke ${n}`,
    },
    color: {
      brand: "Primary colour",
      follows: "follows the logo",
      followAgain: "Follow the logo again",
      brandLabel: "Primary colour",
      hexLabel: "Colour code",
      hexBad: "Write the code like this: #RRGGBB",
      fromLogo: "from the logo",
      ideas: "Other options",
      scale: "The primary colour's scale",
      accent: "Secondary colour",
      accentNote: "accent",
      accentLabel: "Secondary colour",
      greys: "Greys",
      neutral: { frio: "Cool", neutro: "Neutral", calido: "Warm" } as Record<string, string>,
      contrast: "Contrast (WCAG 2.2 AA)",
      checks: ["Text on the button", "Primary as text on the background", "Primary on a dark background", "Secondary as text"],
      onlyBig: "· large only",
      onlyBg: "· backgrounds only",
      more: "More: states, charts and dark mode",
      states: "States",
      stateNames: ["Success", "Warning", "Error"],
      charts: "Charts",
      chartsOk: "also told apart by lightness",
      darkNote: "Dark mode comes from your colour alone: the brand gets lighter if it does not show on the dark background.",
    },
    letra: {
      pairs: "Pairs that already work",
      pairNames: { moderna: "Modern", caracter: "With character", editorial: "Editorial", amable: "Friendly", tecnica: "Technical", legible: "Easy to read" } as Record<string, string>,
      head: "Headings",
      body: "Text",
      mono: "Code and figures",
      size: "Text size",
      ratio: "Heading scale",
      ratios: ["Soft", "Medium", "Strong", "Dramatic"],
      levels: ["Title", "Subtitle", "Section", "Text", "Small"],
      more: "More: weight, line height and code font",
      weight: "Heading weight",
      lh: "Line height",
      note: "Loaded with next/font (or Google Fonts) with the latin-ext subset for ñ and accents. Open licences only.",
      search: "Search fonts…",
      cats: { todas: "All", sans: "Sans serif", serif: "Serif", display: "Display", mono: "Mono" } as Record<string, string>,
      sample: "Ññ áé ¿¡ — How it reads",
      free: "OFL · free",
      none: (q: string) => `None called «${q}» in the list. Type the exact name of a Google font and choose «Use this one».`,
      useTyped: (q: string) => `Use «${q}»`,
      footer: (w: string) => `${w} · all with ñ and accents`,
      say: {
        Geist: "modern", Inter: "the most used in apps", "DM Sans": "geometric, friendly", Manrope: "round, technical", "Plus Jakarta Sans": "warm, modern", "Nunito Sans": "soft", "IBM Plex Sans": "technical", "Atkinson Hyperlegible": "made to read easily",
        Outfit: "geometric", Sora: "futuristic", "Space Grotesk": "technical with character", "Bricolage Grotesque": "with personality", Nunito: "round and friendly",
        Fraunces: "editorial, soft", "Playfair Display": "elegant, high contrast", Lora: "for long reading", "Source Serif 4": "sober", "Instrument Serif": "thin, magazine", "JetBrains Mono": "for code and figures", "system-ui": "the system's",
      } as Record<string, string>,
    },
    forma: {
      corners: "Corners",
      tiles: ["Square", "Soft", "Round", "Very round"],
      radiusLabel: "Corner radius",
      pill: "Pill-shaped buttons",
      shadows: "Shadows",
      shadow: { plana: "Flat", suave: "Soft", marcada: "Strong" } as Record<string, string>,
      borders: "Borders",
      border: ["No border", "Thin", "Thick"],
    },
    espacio: {
      air: "Room between things",
      density: { compacto: "Compact", comodo: "Comfortable", amplio: "Roomy" } as Record<string, string>,
      note: "Compact for tables and dense panels; comfortable for most; roomy for reading apps or one-thing-at-a-time apps.",
    },
    iconos: {
      lib: "Library",
      libLabel: "Icon library",
      libs: { Lucide: "Lucide · recommended, comes with shadcn/ui", Phosphor: "Phosphor · six weights", Tabler: "Tabler · over 5,000", Heroicons: "Heroicons · from Tailwind", "Material Symbols": "Material Symbols · from Google" } as Record<string, string>,
      libNote: "Changing library touches many files: Taller only switches where icons are already imported and leaves a note if it is a lot.",
      stroke: "Stroke",
      strokes: ["Thin", "Normal", "Thick"],
      noStroke: "Material Symbols comes in one weight: the stroke changes nothing for it.",
      style: "Style",
      fill: ["Outline", "Filled"],
      note: (lib: string) => `Sample drawn with ${lib}'s shapes; the stroke changes across the app with one rule.`,
    },
    mov: {
      how: "How it moves",
      motion: { ninguno: "Still", calmo: "Calm", normal: "Normal", vivo: "Lively" } as Record<string, string>,
      play: "Play the notice",
      says: { ninguno: "no animation", calmo: "320 ms, smooth", normal: "200 ms", vivo: "140 ms, with a bounce" } as Record<string, string>,
      note: "If the phone asks to reduce motion, the app animates nothing, whatever you pick.",
    },
    spec: {
      nav: ["Home", "Search", "Settings"],
      title: "Today",
      sub: "Three things wait for you.",
      save: "Save",
      main: "Create new",
      search: "Search…",
      cards: ["First", "Second"],
      open: "Open",
      wait: "Pending",
      meta: ["12 items", "8 items"],
      toggle: "Tell me if it changes",
      link: "See more",
      toast: "Saved",
    },
    bar: {
      pending: (parts: string[]) => `To bring: ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]}`,
      files: (n: number) => `in ${n} files`,
      same: "Same as the repo",
      sendNone: "Bring to the repo",
      way: (k: string) => `On its way · ${k}`,
      saving: "Saving…",
      saved: "Saved in Plania",
    },
    caps: {
      light: "▲ A SAMPLE SCREEN IN THIS STYLE · LIGHT",
      dark: "▲ THE SAME, DARK",
      repo: (s: string) => `▼ THE SAME SCREEN WITH WHAT THE REPO HAS TODAY · ${s}`,
      repoDark: "▼ THE SAME SCREEN WITH WHAT THE REPO HAS TODAY · dark mode",
      noDark: "The repo has no dark mode.",
      darkLocked: "▲ DARK MODE",
      lockedDark: "Your app has no dark mode",
      lockedDarkLine: "Plania neither draws nor adds it: the request only changes light mode.",
      unknown: "Plania found no colours or fonts in the repo: this is what the browser would use.",
      sys: "system font",
      corners: (n: number) => `corners ${n} px`,
    },
    send: {
      title: (n: number) => `A request for Taller · ${n} files`,
      lead: "Taller puts the style in the repo and swaps loose colours for variables. Nothing changes in the repo until you accept.",
      items: [["brand.css", "Tailwind 4 variables, light and dark"], ["tokens.json", "the same values, W3C format"], ["the fonts", "loaded in the layout"]] as [string, string][],
      cssLight: "Tailwind 4 variables, light mode only",
      old: (n: number) => (n === 1 ? "1 file with old colours written by hand" : `${n} files with old colours written by hand`),
      cancel: "Cancel",
      go: "Ask Taller",
      sent: (k: string) => `Asked Taller (${k}).`,
    },
    expert: {
      label: "Expert mode",
      code: "Code",
      fmts: { tailwind: "Tailwind 4", shadcn: "shadcn/ui", w3c: "W3C tokens" } as Record<string, string>,
      codeLabel: "The style's code",
      importRepo: "Import from the repo",
      copy: "Copy",
      apply: "Apply the code",
      applied: (n: number) => (n === 0 ? "No changes Plania recognises" : n === 1 ? "1 change applied from the code" : `${n} changes applied from the code`),
      imported: "Imported from the repo: it now matches what is there",
      copied: "Copied",
      diff: (n: number) => `Differences with the repo · ${n}`,
      same: "Same as the repo.",
      parts: { color: "Colour", letra: "Type", forma: "Shape", espacio: "Space", iconos: "Icons", mov: "Motion" } as Record<string, string>,
      mode: { claro: "Light", oscuro: "Dark" } as Record<string, string>,
      live: "the sample changes as you edit",
      read: "What Plania read from the repo",
      readNone: "Nothing recognised: no colour variables, no radius, no loaded fonts.",
    },
  },
});
export const estiloWords = () => words(ESTILO_WORDS);
export type EstiloWords = ReturnType<typeof estiloWords>;
