// PLA-I66-2: the Marca door's words and pure logic (ui/src/components/corriente/marca.tsx). The server sends the
// checklist as codes (src/brand/check.ts); this module words them in the screen's language and works out what each card
// and the door's count show. Tested without a browser.
import { defineWords, words } from "./i18n.js";
import type { LogoRef } from "./logos.js";

export type Face = "nav" | "ios" | "and" | "pwa" | "share" | "cia";
export type RowState = "ok" | "falta" | "mal";
export type RowId = "ico" | "svg" | "apple" | "splash" | "man" | "a192" | "a512" | "mask" | "mono" | "og" | "pl";
export type Coded = { k: string; v?: Record<string, string | number> };
export type MarcaRow = { id: RowId; face: Face; state: RowState; path: string | null; optional?: boolean; size?: string; note?: Coded; checks: (Coded & { ok: boolean })[] };
export type MarcaCandidate = { path: string; variant: "icon" | "mark"; mime: string; inUse: boolean };
export type MarcaRead = {
  slug: string;
  logo: (LogoRef & { versions: number }) | null;
  repo: "ok" | "none" | "no_code";
  branch: string;
  commit: string | null;
  framework: "next-app" | "vite" | "static" | null;
  root: string;
  rows: MarcaRow[];
  candidates: MarcaCandidate[];
  splash: string | null;
  checkedAt: string;
};

export const FACES: { id: Face; side: "l" | "r" }[] = [
  { id: "nav", side: "l" },
  { id: "ios", side: "l" },
  { id: "and", side: "l" },
  { id: "pwa", side: "r" },
  { id: "share", side: "r" },
  { id: "cia", side: "r" },
];
const ORDER: Face[] = FACES.map((f) => f.id);
const RANK: Record<RowState, number> = { mal: 3, falta: 2, ok: 1 };

export const MARCA_WORDS = defineWords({
  es: {
    door: "Marca",
    title: (name: string) => `La marca de ${name}`,
    lead: "Un logo y todo lo que sale de él. Plania revisa el repo cada vez que algo llega a la rama de inicio.",
    loading: "Leyendo el repo",
    readError: "la marca",
    face: {
      nav: { name: "Navegador", what: "La pestaña, los favoritos y el historial." },
      ios: { name: "iPhone", what: "La pantalla de inicio al agregar la app, y la pantalla mientras abre." },
      and: { name: "Android", what: "El ícono instalado: cada marca de teléfono lo recorta con su forma." },
      pwa: { name: "Instalar la app", what: "El aviso de instalar y la ventana propia de la app." },
      share: { name: "Compartir", what: "La vista previa cuando alguien pega el enlace en un chat." },
      cia: { name: "Compañía", what: "Donde tú la ves: los carriles, la tira, la cabecera y el brief." },
    } as Record<Face, { name: string; what: string }>,
    row: {
      ico: { name: "favicon.ico", spec: "16 · 32 · 48 px" },
      svg: { name: "Ícono SVG", spec: "escalable, nítido a cualquier tamaño" },
      apple: { name: "apple-touch-icon", spec: "180 × 180 · sin transparencia" },
      splash: { name: "Pantallas de arranque", spec: "opcional: si se instala en iPhone" },
      man: { name: "manifest", spec: "nombre, colores e íconos" },
      a192: { name: "Ícono 192", spec: "192 × 192" },
      a512: { name: "Ícono 512", spec: "512 × 512" },
      mask: { name: "Ícono adaptable", spec: "512 · dibujo dentro del 40 %" },
      mono: { name: "Ícono monocromo", spec: "opcional: íconos temáticos de Android" },
      og: { name: "Imagen para compartir", spec: "1200 × 630" },
      pl: { name: "La copia de Plania", spec: "el original, en Plania" },
    } as Record<RowId, { name: string; spec: string }>,
    state: { ok: "en el repo", falta: "falta", mal: "mal" } as Record<RowState, string>,
    plState: { ok: "en Plania", falta: "falta", mal: "mal" } as Record<RowState, string>,
    check: {
      exists: "Existe",
      linked: "Enlazado",
      linked_conv: "El framework lo enlaza solo",
      ico_sizes: (v: Record<string, string | number>) => `Trae ${v.sizes} px`,
      ico_sizes_missing: (v: Record<string, string | number>) => `Trae ${v.sizes || "ningún tamaño legible"}; faltan 16 o 32 px`,
      template: "Es el ícono de la plantilla del framework, no el del proyecto",
      size: (v: Record<string, string | number>) => (v.got ? `Mide ${v.got}; debe medir ${v.want}` : `${v.want}`),
      opaque: "Sin transparencia",
      opaque_ios: "Tiene partes transparentes: iPhone las pinta de negro",
      splash_count: (v: Record<string, string | number>) => `${v.n} imágenes`,
      man_name: "Nombre de la app",
      man_colors: "theme_color y background_color",
      man_display: "Se abre como app (display)",
      in_manifest: (v: Record<string, string | number>) => `En el manifest como ${v.px} × ${v.px}`,
      png_file: "El archivo está en el repo y es un PNG",
      mask_entry: "El manifest trae un ícono maskable",
      mask_own: "Entrada propia en el manifest (no «any maskable»)",
      safe_zone: (v: Record<string, string | number>) => `Zona segura: el dibujo llega al ${v.pct} del ancho (máx. 40 %)`,
      mono_entry: "En el manifest como monochrome",
      og_code: "Hecha en código: se revisa, no se reemplaza",
      og_meta: "Declarada en los metadatos",
      pl_kept: "Plania guarda el original",
      pl_used: "Es el que usa Compañía",
    } as Record<string, string | ((v: Record<string, string | number>) => string)>,
    note: {
      copies: (v: Record<string, string | number>) => `Hay ${v.n} copias iguales (${v.list}). Funciona; basta una.`,
      svg_unlinked: (v: Record<string, string | number>) => `${v.path} existe, pero nada lo enlaza como ícono: el navegador usa los PNG.`,
      mask_edge: "Pasa, pero al límite del círculo.",
      og_code: "La dibuja el código: Plania la revisa, no la reemplaza.",
      pl_none: "Sin original, Compañía dibuja la inicial del proyecto.",
    } as Record<string, string | ((v: Record<string, string | number>) => string)>,
    count: { ok: "en el repo", missing: (n: number): string => (n === 1 ? "falta" : "faltan"), wrong: "mal" },
    doorCount: (n: number) => (n === 1 ? "1 FALTA" : `${n} FALTAN`),
    doorComplete: "COMPLETA",
    faceCount: (ok: number, n: number) => `${ok} de ${n}`,
    files: "Archivos",
    checked: (time: string, branch: string) => `revisado ${time} · rama ${branch}`,
    back: "← Todos los archivos",
    original: "El original",
    version: (v: number) => `v${v}`,
    source: { repo: "Encontrado en el repo", upload: "Subido por ti", artist: "Elegido de las marcas de Artist" } as Record<LogoRef["source"], string>,
    variant: { icon: "ícono con fondo", mark: "marca sola" } as Record<"icon" | "mark", string>,
    noOriginal: "Todavía no hay logo",
    noOriginalLead: "Plania no encontró uno en el repo: Compañía muestra la inicial.",
    noRepo: "El proyecto todavía no tiene código: la lista espera al repo.",
    colors: "del logo",
    newTab: "Nueva pestaña",
    darker: "Ver en oscuro",
    lighter: "Ver en claro",
    zoom: "16 px",
    shapes: { circle: "Círculo", squircle: "Squircle", drop: "Gota" },
    themed: "Temático",
    noIcon: "sin ícono",
    splashNone: "en blanco",
    install: "¿Instalar la app?",
    ownWindow: "se abre en su propia ventana",
    cancel: "Cancelar",
    installBtn: "Instalar",
    noImage: "sin imagen: el enlace sale sin foto",
    lane: (has: boolean): string => (has ? "en carriles, tira y brief" : "hoy: una letra"),
    optional: "opcional",
    reread: "Revisar el repo ahora",
  },
  en: {
    door: "Brand",
    title: (name: string) => `${name}'s brand`,
    lead: "One logo and everything made from it. Plania checks the repo whenever something lands on the start branch.",
    loading: "Reading the repo",
    readError: "the brand",
    face: {
      nav: { name: "Browser", what: "The tab, bookmarks and history." },
      ios: { name: "iPhone", what: "The home screen when the app is added, and the screen while it opens." },
      and: { name: "Android", what: "The installed icon: each phone maker crops it with its own shape." },
      pwa: { name: "Install the app", what: "The install prompt and the app's own window." },
      share: { name: "Sharing", what: "The preview when someone pastes the link in a chat." },
      cia: { name: "Company", what: "Where you see it: the lanes, the strip, the header and the brief." },
    } as Record<Face, { name: string; what: string }>,
    row: {
      ico: { name: "favicon.ico", spec: "16 · 32 · 48 px" },
      svg: { name: "SVG icon", spec: "scalable, sharp at any size" },
      apple: { name: "apple-touch-icon", spec: "180 × 180 · no transparency" },
      splash: { name: "Launch screens", spec: "optional: when installed on iPhone" },
      man: { name: "manifest", spec: "name, colours and icons" },
      a192: { name: "Icon 192", spec: "192 × 192" },
      a512: { name: "Icon 512", spec: "512 × 512" },
      mask: { name: "Adaptive icon", spec: "512 · drawing inside 40 %" },
      mono: { name: "Monochrome icon", spec: "optional: Android themed icons" },
      og: { name: "Share image", spec: "1200 × 630" },
      pl: { name: "Plania's copy", spec: "the original, in Plania" },
    } as Record<RowId, { name: string; spec: string }>,
    state: { ok: "in the repo", falta: "missing", mal: "wrong" } as Record<RowState, string>,
    plState: { ok: "in Plania", falta: "missing", mal: "wrong" } as Record<RowState, string>,
    check: {
      exists: "Exists",
      linked: "Linked",
      linked_conv: "The framework links it by itself",
      ico_sizes: (v: Record<string, string | number>) => `Holds ${v.sizes} px`,
      ico_sizes_missing: (v: Record<string, string | number>) => `Holds ${v.sizes || "no readable size"}; 16 or 32 px missing`,
      template: "It is the framework template's icon, not the project's",
      size: (v: Record<string, string | number>) => (v.got ? `Measures ${v.got}; should be ${v.want}` : `${v.want}`),
      opaque: "No transparency",
      opaque_ios: "Has transparent parts: iPhone paints them black",
      splash_count: (v: Record<string, string | number>) => `${v.n} images`,
      man_name: "App name",
      man_colors: "theme_color and background_color",
      man_display: "Opens as an app (display)",
      in_manifest: (v: Record<string, string | number>) => `In the manifest as ${v.px} × ${v.px}`,
      png_file: "The file is in the repo and is a PNG",
      mask_entry: "The manifest has a maskable icon",
      mask_own: "Its own manifest entry (not “any maskable”)",
      safe_zone: (v: Record<string, string | number>) => `Safe zone: the drawing reaches ${v.pct} of the width (max 40 %)`,
      mono_entry: "In the manifest as monochrome",
      og_code: "Drawn in code: checked, never replaced",
      og_meta: "Declared in the metadata",
      pl_kept: "Plania keeps the original",
      pl_used: "It is what Company shows",
    } as Record<string, string | ((v: Record<string, string | number>) => string)>,
    note: {
      copies: (v: Record<string, string | number>) => `There are ${v.n} identical copies (${v.list}). It works; one is enough.`,
      svg_unlinked: (v: Record<string, string | number>) => `${v.path} exists, but nothing links it as the icon: the browser uses the PNGs.`,
      mask_edge: "It passes, but right at the edge of the circle.",
      og_code: "Code draws it: Plania checks it, never replaces it.",
      pl_none: "Without an original, Company draws the project's initial.",
    } as Record<string, string | ((v: Record<string, string | number>) => string)>,
    count: { ok: "in the repo", missing: (_n: number) => "missing", wrong: "wrong" },
    doorCount: (n: number) => `${n} MISSING`,
    doorComplete: "COMPLETE",
    faceCount: (ok: number, n: number) => `${ok} of ${n}`,
    files: "Files",
    checked: (time: string, branch: string) => `checked ${time} · branch ${branch}`,
    back: "← All files",
    original: "The original",
    version: (v: number) => `v${v}`,
    source: { repo: "Found in the repo", upload: "Uploaded by you", artist: "Picked from Artist's marks" } as Record<LogoRef["source"], string>,
    variant: { icon: "icon with background", mark: "bare mark" } as Record<"icon" | "mark", string>,
    noOriginal: "No logo yet",
    noOriginalLead: "Plania found none in the repo: Company shows the initial.",
    noRepo: "The project has no code yet: the list waits for the repo.",
    colors: "from the logo",
    newTab: "New tab",
    darker: "See in dark",
    lighter: "See in light",
    zoom: "16 px",
    shapes: { circle: "Circle", squircle: "Squircle", drop: "Teardrop" },
    themed: "Themed",
    noIcon: "no icon",
    splashNone: "blank",
    install: "Install the app?",
    ownWindow: "opens in its own window",
    cancel: "Cancel",
    installBtn: "Install",
    noImage: "no image: the link shows without a picture",
    lane: (has: boolean) => (has ? "in lanes, strip and brief" : "today: a letter"),
    optional: "optional",
    reread: "Check the repo now",
  },
});

export const marcaWords = () => words(MARCA_WORDS);
export type MarcaWords = ReturnType<typeof marcaWords>;

/** A check's or a note's sentence. */
export function sentence(table: Record<string, string | ((v: Record<string, string | number>) => string)>, c: Coded): string {
  const w = table[c.k];
  if (!w) return c.k;
  return typeof w === "function" ? w(c.v ?? {}) : w;
}

/** The rows in card order (browser first, Compañía last). */
export const sortedRows = (rows: MarcaRow[]): MarcaRow[] => [...rows].sort((a, b) => ORDER.indexOf(a.face) - ORDER.indexOf(b.face));

/** Missing counts what the app needs: an optional file that is absent is not a gap. */
export function counts(rows: MarcaRow[]): { ok: number; missing: number; wrong: number } {
  let ok = 0, missing = 0, wrong = 0;
  for (const r of rows) {
    if (r.state === "ok") ok++;
    else if (r.state === "mal") wrong++;
    else if (!r.optional) missing++;
  }
  return { ok, missing, wrong };
}

/** A card's worst state among its required files (an optional absent file leaves it as it is) and its tally. */
export function faceState(rows: MarcaRow[], face: Face): { worst: RowState; ok: number; n: number } {
  const fs = rows.filter((r) => r.face === face);
  let worst: RowState = "ok";
  for (const r of fs) if (!(r.optional && r.state === "falta") && RANK[r.state] > RANK[worst]) worst = r.state;
  return { worst, ok: fs.filter((r) => r.state === "ok").length, n: fs.length };
}

/** The door's count: what is missing or wrong, or complete. */
export function doorCount(rows: MarcaRow[], w: MarcaWords = marcaWords()): string {
  const c = counts(rows);
  const bad = c.missing + c.wrong;
  return bad ? w.doorCount(bad) : w.doorComplete;
}

export const has = (rows: MarcaRow[], id: RowId): boolean => rows.find((r) => r.id === id)?.state === "ok";

/** A repo file's address for a card (the read lists which files may be fetched). */
export const fileUrl = (slug: string, p: string): string => `/api/company/projects/${encodeURIComponent(slug)}/marca/file?path=${encodeURIComponent(p)}`;
