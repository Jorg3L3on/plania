// PLA-I66-2: the Marca door's words and pure logic (ui/src/components/corriente/marca.tsx). The server sends the
// checklist as codes (src/brand/check.ts); this module words them in the screen's language and works out what each card
// and the door's count show. Tested without a browser.
import { defineWords, words } from "./i18n.js";
import type { LogoRef } from "./logos.js";

export type Face = "nav" | "ios" | "and" | "pwa" | "share" | "cia";
export type RowState = "ok" | "falta" | "mal";
export type RowId = "ico" | "svg" | "apple" | "splash" | "man" | "a192" | "a512" | "mask" | "mono" | "og" | "pl" | "ios_app" | "and_app";
export type Coded = { k: string; v?: Record<string, string | number> };
export type MarcaRow = { id: RowId; face: Face; state: RowState; path: string | null; optional?: boolean; size?: string; note?: Coded; checks: (Coded & { ok: boolean })[] };
export type MarcaCandidate = { path: string; variant: "icon" | "mark"; mime: string; inUse: boolean };
export type MarcaRead = {
  slug: string;
  logo: (LogoRef & { versions: number; chosen: boolean }) | null;
  repo: "ok" | "none" | "no_code";
  /** PLA-120: the folder Plania reads the repo from. */
  folder?: string;
  /** PLA-122: the surfaces with their own icon. */
  surfaces?: Partial<Record<Surface, { file: string; bg: string | null; scale: number }>>;
  branch: string;
  commit: string | null;
  framework: "next-app" | "vite" | "static" | null;
  root: string;
  rows: MarcaRow[];
  candidates: MarcaCandidate[];
  splash: string | null;
  /** PLA-I66-6: the switch that adds the native app icons and the launch screens. */
  native: boolean;
  /** PLA-I66-4: the open ticket bringing icon files, and the rows it carries. */
  pedido: { key: string; status: string; rows: string[] } | null;
  /** PLA-I66-4: the repo shows another logo while the owner's choice leads. */
  drift: { path: string; sha: string } | null;
  checkedAt: string;
};
export type PlanItem = { key: string; path: string; op: "+" | "~" };
export type Plan = { items: PlanItem[]; edits: { path: string; what: string }[]; kept: number; framework: "next-app" | "vite" | "static"; mode: "faltan" | "todo" };

/** A row the open request carries and the repo does not have yet: it shows as on its way. */
export const onItsWay = (r: Pick<MarcaRead, "pedido">, row: MarcaRow): boolean => !!r.pedido?.rows.includes(row.id) && row.state !== "ok";
export type Mark = { id: string; name: string; idea: string; file: string; tile: string; variant: "icon" | "mark"; colors: string[]; tests: PixelTests };
export type MarksRequest = { id: string; slug: string; status: "drawing" | "ready" | "failed"; hints: { about: string; feel: string[]; avoid: string[]; colors: string[]; images: string[]; like?: string | null; change?: string | null }; at: string; marks: Mark[]; rejected: { name: string; why: string }[]; why?: string | null };
export const markUrl = (slug: string, id: string, file: string): string => `/api/company/projects/${encodeURIComponent(slug)}/logo/marks/${id}/${file}`;
export const passesAll = (t: PixelTests): boolean => t.small.ok && t.circle.ok && t.contrast.ok;
/** Up to six slots around the ring (x, y as a share of the radius), clockwise from the top. */
export const RING: [number, number][] = [[0, -1], [0.87, -0.5], [0.87, 0.5], [0, 1], [-0.87, 0.5], [-0.87, -0.5]];
export const zipUrl = (slug: string, mode: "faltan" | "todo" = "todo", surface?: Surface | null): string => `/api/company/projects/${encodeURIComponent(slug)}/marca/zip?mode=${mode}${surface ? `&surface=${surface}` : ""}`;
// PLA-122: a surface's own icon. The browser card is nav, iPhone ios, Android and.
export type Surface = "iphone" | "android" | "navegador";
export const SURFACE_OF: Partial<Record<Face, Surface>> = { nav: "navegador", ios: "iphone", and: "android" };
export const surfaceUrl = (slug: string, s: Surface, file: string): string => `/api/company/projects/${encodeURIComponent(slug)}/logo/surface/${s}?v=${file.slice(0, 12)}`;

// PLA-I66-3: an upload as the server staged it, the pixel tests, a version.
export type UpCheck = Coded & { ok: boolean | "warn" };
export type Staged = { up: string; name: string; kind: "svg" | "png" | "jpeg" | "webp"; width: number; height: number; hasAlpha: boolean; checks: UpCheck[]; block: string | null; palette: string[]; corner: string };
export type PixelTests = { small: { ok: boolean; v: number }; circle: { ok: boolean; v: number }; contrast: { ok: boolean; v: number } };
export type VersionRef = { v: number; source: LogoRef["source"]; path: string | null; variant: "icon" | "mark"; active: boolean; chosen: boolean; at: string };

const lumOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
};
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
export const DARK_PLATE = "#18181f";

/**
 * Where an upload starts: a see-through logo gets room around it and the plate (white or near black) it stands out
 * on most, never its own colour; an opaque one fills its tile.
 */
export function startAdjust(s: Pick<Staged, "hasAlpha" | "palette" | "corner" | "width" | "height">): { scale: number; bg: string | null } {
  if (s.hasAlpha) {
    const ink = s.palette[0];
    if (!ink) return { scale: 70, bg: DARK_PLATE };
    const l = lumOf(ink);
    return { scale: 70, bg: ratio(l, 1) >= ratio(l, lumOf(DARK_PLATE)) ? "#ffffff" : DARK_PLATE };
  }
  const square = Math.abs(s.width - s.height) / Math.max(s.width, s.height) < 0.02;
  return { scale: 100, bg: square ? null : s.corner };
}

/** The three tests as worded lines. */
export function testLines(t: PixelTests, w: MarcaWords = marcaWords()): { ok: boolean; text: string }[] {
  return [
    { ok: t.small.ok, text: t.small.ok ? w.tests.smallOk : w.tests.smallBad(Math.round(t.small.v * 100)) },
    { ok: t.circle.ok, text: t.circle.ok ? w.tests.circleOk(Math.round(t.circle.v * 100)) : w.tests.circleBad(Math.round(t.circle.v * 100)) },
    { ok: t.contrast.ok, text: t.contrast.ok ? w.tests.contrastOk(t.contrast.v) : w.tests.contrastBad(t.contrast.v) },
  ];
}

export const versionUrl = (slug: string, v: number): string => `/api/company/projects/${encodeURIComponent(slug)}/logo/versions/${v}`;

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
      ios_app: { name: "Ícono de la app de iOS", spec: "1024 × 1024, opaco" },
      and_app: { name: "Ícono adaptable de Android", spec: "frente, fondo y monocromo" },
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
      splash_full: (v: Record<string, string | number>) => `Cubre los ${v.n} tamaños de iPhone y iPad`,
      native_expo: "App de Expo (app.json)",
      native_capacitor: "App de Capacitor",
      native_app: "El repo tiene una app nativa",
      adaptive_fg: "Capa de frente",
      adaptive_bg: "Capa de fondo",
      adaptive_mono: "Capa monocroma (íconos temáticos)",
    } as Record<string, string | ((v: Record<string, string | number>) => string)>,
    note: {
      copies: (v: Record<string, string | number>) => `Hay ${v.n} copias iguales (${v.list}). Funciona; basta una.`,
      svg_unlinked: (v: Record<string, string | number>) => `${v.path} existe, pero nada lo enlaza como ícono: el navegador usa los PNG.`,
      mask_edge: "Pasa, pero al límite del círculo.",
      og_code: "La dibuja el código: Plania la revisa, no la reemplaza.",
      pl_none: "Sin original, Compañía dibuja la inicial del proyecto.",
      web_only: "El repo no tiene app nativa todavía: Plania deja listos los archivos en assets/.",
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
    noRepoFound: (folder: string) => `Plania no encuentra el repo en ${folder}. Elige la carpeta del proyecto en Ajustes y la lista se llena sola.`,
    noRepoLink: "Elegir la carpeta",
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
    native: "App nativa y pantallas de arranque",
    gen: {
      menu: "Pedir marcas a Artist",
      menuHint: "desde pistas e inspiración",
      title: (name: string) => `Marcas de Artist para ${name}`,
      lead: "Artist dibuja seis marcas en SVG. Plania prueba cada una sobre sus píxeles antes de mostrarla. No cuesta nada aparte.",
      about: "De qué trata",
      aboutPh: "Qué hace la app y para quién",
      inspiration: "Inspiración",
      add: "Agregar imagen",
      feel: "Que se sienta",
      avoid: "Que no tenga",
      wordPh: "Una palabra y Enter",
      colors: "Colores",
      colorsHint: "o escribe uno",
      colorPh: "#c48b9f y Enter",
      changePh: "Qué le cambiarías (opcional)",
      go: "Generar 6 marcas",
      again: "Otra tanda de 6",
      more: "Más como esta",
      use: "Usar esta",
      drawing: "Artist dibuja…",
      failed: "Artist no entregó marcas. Puedes intentar otra vez.",
      failedWhy: (why: string): string => (/paused/.test(why) ? "El proyecto está en pausa: Artist no puede dibujar. Reanúdalo y pide otra vez." : why === "no agent" ? "El proyecto no tiene Artist en su equipo. Súmalo en Equipo y pide otra vez." : "Artist no pudo empezar. Puedes intentar otra vez."),
      none: "Aquí aparecen las marcas de Artist",
      pick: "Elige una",
      passed: (n: number, of: number) => `${n} de ${of} pasan las tres pruebas`,
      how: "Cómo elige Plania",
      tests: [
        ["Se lee a 16 px", "los trazos de menos de un píxel en la pestaña se pierden"],
        ["Cabe en el círculo", "Android recorta el ícono; el dibujo debe quedar dentro del 40 %"],
        ["Tiene contraste", "3 : 1 entre el dibujo y su fondo"],
      ] as [string, string][],
      back: "Volver",
      used: "Es el nuevo original. Las otras marcas quedan en esta tanda.",
      remove: (w: string) => `Quitar ${w}`,
    },
    sheet: {
      open: "Ponerlos en el repo",
      zip: "Descargar .zip",
      title: (name: string) => `Poner la marca en el repo de ${name}`,
      lead: "Plania arma los archivos desde el original, en esta máquina. Taller solo los pone donde van y los enlaza; no los redibuja.",
      changes: "Lo que cambia",
      framework: { "next-app": "Next.js · App Router", vite: "Vite", static: "Sitio estático" } as Record<string, string>,
      faltan: "Solo lo que falta",
      todo: "Rehacer todo desde el original",
      kept: (n: number) => `${n} ya están bien: no se tocan`,
      edits: "Código que enlaza",
      edit: {
        manifest_icons: "íconos del manifest",
        manifest_mono: "ícono monocromo en el manifest",
        layout_svg: "enlaza el SVG en la metadata",
        layout_theme: "themeColor y appleWebApp",
        html_links: "enlaces de íconos en el head",
        html_manifest: "enlace al manifest",
        layout_splash: "pantallas de arranque en appleWebApp.startupImage",
        html_splash: "enlaces apple-touch-startup-image",
        expo_icons: "icon, ios.icon y android.adaptiveIcon",
        capacitor_assets: "correr @capacitor/assets con estas fuentes",
      } as Record<string, string>,
      file: { splash: "19 pantallas de arranque", ios_app: "1024 × 1024, opaco", and_app: "frente, monocromo y fondo", ico: "favicon 16 · 32 · 48", svg: "ícono SVG", apple: "180 × 180, opaco", a192: "192 × 192", a512: "512 × 512", mask: "512, dibujo dentro del 40 %", mono: "silueta para íconos temáticos", og: "1200 × 630", manifest: "nombre, colores e íconos" } as Record<string, string>,
      way: "Cómo llega",
      steps: [
        ["Plania arma los archivos", "Desde el original, con tamaños exactos. Sin servicios de pago."],
        ["Taller abre un PR", "Rama nueva desde la rama de inicio; pone y enlaza los archivos."],
        ["QA corre la lista", "La lista de verificación del proyecto."],
        ["El Probador muestra antes y después", "La pestaña, el ícono y la imagen para compartir."],
        ["Tú aceptas", "Y la lista vuelve a revisar el repo sola."],
      ] as [string, string][],
      count: (n: number) => (n === 1 ? "1 cambio · un pedido para Taller" : `${n} cambios · un pedido para Taller`),
      cancel: "Cancelar",
      send: "Pedírselo a Taller",
      sent: (key: string) => `Taller tiene el pedido «Los íconos de la marca» (${key}). Las filas se ponen verdes cuando llega a la rama de inicio.`,
      loading: "Armando los archivos…",
    },
    inPr: (key: string) => `Taller trabaja · ${key}`,
    camino: "en el PR de Taller",
    drift: {
      text: (p: string) => `El repo trae otro logo: ${p}. Plania sigue con el tuyo hasta que decidas.`,
      use: "Usar el del repo",
      keep: "Mantener el mío",
    },
    change: "Cambiar el logo",
    menu: {
      upload: "Subir uno",
      uploadHint: "SVG, o PNG de 1024 px",
      repo: "Otro del repo",
      repoHint: (n: number) => (n === 1 ? "1 encontrado" : `${n} encontrados`),
      versions: "Versiones",
      versionsHint: (n: number) => `${n} guardadas`,
      release: "Que mande el repo",
      releaseHint: "Plania vuelve a elegir del repo",
    },
    repoTitle: "Logos en el repo",
    repoLead: (branch: string) => `Lo que Plania encontró en la rama ${branch}. Un SVG gana a un PNG; uno grande a uno chico.`,
    inUse: "en uso",
    useThis: "Usar este",
    versionsTitle: "Versiones del logo",
    versionsLead: "Cada cambio guarda una versión. Volver a una la deja como tu elección.",
    goBack: "Volver a esta",
    active: "activa",
    when: (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
    solo: {
      btn: "Solo este",
      own: "Propio",
      send: "Ponerlo en el repo",
      back: "Volver al original",
      name: { navegador: "el navegador", iphone: "iPhone", android: "Android" } as Record<Surface, string>,
      title: (s: string, name: string) => `El ícono de ${s} para ${name}`,
      lead: (s: string) => `Ajusta el tamaño y el fondo, o suelta otra imagen. Solo cambian los archivos de ${s}; los demás siguen con el original.`,
      use: (s: string) => `Usar solo en ${s}`,
      saved: (s: string) => `${s} ya tiene su propio ícono. Ponlo en el repo para que llegue a la app.`,
      reset: (s: string) => `${s} vuelve a usar el original.`,
      sheet: (s: string) => `Solo ${s}`,
      preview: "así se verá",
      waits: (s: string, key: string) => `${s} ya tiene su propio ícono. Taller sigue con ${key}: cuando lo aceptes, ponlo en el repo.`,
    },
    up: {
      title: (name: string) => `Subir un logo para ${name}`,
      lead: "SVG o PNG de 1024 px o más. Plania lo revisa al momento y te muestra cómo queda en cada lugar.",
      drop: "Suelta tu logo aquí",
      dropHint: "o toca para elegir un archivo · SVG, PNG, JPG o WebP",
      reading: "Revisando el archivo…",
      circle: "Círculo de Android",
      iphone: "Recorte de iPhone",
      other: "Otro archivo",
      size: "Tamaño dentro del ícono",
      background: "Fondo",
      none: "Sin fondo",
      checks: (name: string) => `Revisión de ${name}`,
      use: "Usar este logo",
      back: "Volver",
      saved: "Es el nuevo original. El anterior queda en Versiones.",
      faces: { tab: "Pestaña · 16 px", ios: "iPhone · 180 px", and: "Android · círculo", pwa: "Instalar", share: "Compartir · 1200 × 630", cia: "Compañía" },
      empty: "Aquí ves cómo queda en las seis caras antes de usarlo.",
      rules: [
        ["Formato", "SVG gana; PNG, JPG o WebP también sirven"],
        ["Tamaño", "1024 px o más; menos de 512 no se acepta"],
        ["Forma", "cuadrado o casi; si no, se centra en un cuadro"],
        ["Fondo", "si es transparente, eliges uno para iPhone y Android"],
        ["Limpieza", "un SVG con scripts o enlaces de afuera se limpia"],
        ["16 px, círculo y contraste", "las pruebas de cada logo, sobre sus píxeles"],
      ] as [string, string][],
      rulesTitle: "Lo que Plania revisa",
    },
    upCheck: {
      format: (v: Record<string, string | number>) => `${v.kind} de ${v.w} × ${v.h} px`,
      svg_clean: "SVG limpio: sin scripts ni enlaces de afuera",
      svg_cleaned: "Tenía scripts o enlaces de afuera: se quitaron",
      too_small: (v: Record<string, string | number>) => `Muy chico: ${v.px} px. Súbelo de 1024 px o en SVG`,
      small: (v: Record<string, string | number>) => `Sirve, pero 1024 px es mejor (tiene ${v.px})`,
      big_enough: "1024 px o más",
      square: "Cuadrado",
      not_square: (v: Record<string, string | number>) => `No es cuadrado (${v.w} × ${v.h}): se centra en un cuadro`,
      transparent: "Fondo transparente: elige uno para iPhone y Android",
      own_background: "Trae su propio fondo",
    } as Record<string, string | ((v: Record<string, string | number>) => string)>,
    tests: {
      smallOk: "Se lee a 16 px",
      smallBad: (pct: number) => `A 16 px se pierde el ${pct} % del dibujo`,
      circleOk: (pct: number) => `Cabe en el círculo de Android (llega al ${pct} %)`,
      circleBad: (pct: number) => `Se sale del círculo de Android (llega al ${pct} %, máx. 40)`,
      contrastOk: (v: number) => `Contraste ${v} : 1`,
      contrastBad: (v: number) => `Poco contraste: ${v} : 1 (mín. 3)`,
    },
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
      ios_app: { name: "iOS app icon", spec: "1024 × 1024, opaque" },
      and_app: { name: "Android adaptive icon", spec: "foreground, background and monochrome" },
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
      splash_full: (v: Record<string, string | number>) => `Covers the ${v.n} iPhone and iPad sizes`,
      native_expo: "Expo app (app.json)",
      native_capacitor: "Capacitor app",
      native_app: "The repo holds a native app",
      adaptive_fg: "Foreground layer",
      adaptive_bg: "Background layer",
      adaptive_mono: "Monochrome layer (themed icons)",
    } as Record<string, string | ((v: Record<string, string | number>) => string)>,
    note: {
      copies: (v: Record<string, string | number>) => `There are ${v.n} identical copies (${v.list}). It works; one is enough.`,
      svg_unlinked: (v: Record<string, string | number>) => `${v.path} exists, but nothing links it as the icon: the browser uses the PNGs.`,
      mask_edge: "It passes, but right at the edge of the circle.",
      og_code: "Code draws it: Plania checks it, never replaces it.",
      pl_none: "Without an original, Company draws the project's initial.",
      web_only: "The repo has no native app yet: Plania leaves the files ready in assets/.",
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
    noRepoFound: (folder: string) => `Plania cannot find the repo in ${folder}. Pick the project's folder in Settings and the list fills itself.`,
    noRepoLink: "Pick the folder",
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
    native: "Native app and launch screens",
    gen: {
      menu: "Ask Artist for marks",
      menuHint: "from hints and inspiration",
      title: (name: string) => `Artist's marks for ${name}`,
      lead: "Artist draws six marks in SVG. Plania tests each one on its pixels before showing it. It costs nothing extra.",
      about: "What it is about",
      aboutPh: "What the app does and for whom",
      inspiration: "Inspiration",
      add: "Add an image",
      feel: "It should feel",
      avoid: "It must not have",
      wordPh: "A word and Enter",
      colors: "Colours",
      colorsHint: "or type one",
      colorPh: "#c48b9f and Enter",
      changePh: "What would you change (optional)",
      go: "Draw 6 marks",
      again: "Another round of 6",
      more: "More like this one",
      use: "Use this one",
      drawing: "Artist is drawing…",
      failed: "Artist delivered no marks. You can try again.",
      failedWhy: (why: string): string => (/paused/.test(why) ? "The project is paused: Artist cannot draw. Resume it and ask again." : why === "no agent" ? "The project has no Artist on its team. Add one in Team and ask again." : "Artist could not start. You can try again."),
      none: "Artist's marks show up here",
      pick: "Pick one",
      passed: (n: number, of: number) => `${n} of ${of} pass the three tests`,
      how: "How Plania judges",
      tests: [
        ["Reads at 16 px", "strokes under a pixel vanish in the tab"],
        ["Fits the circle", "Android crops the icon; the drawing stays inside 40 %"],
        ["Has contrast", "3 : 1 between the drawing and its background"],
      ] as [string, string][],
      back: "Back",
      used: "It is the new original. The other marks stay in this round.",
      remove: (w: string) => `Remove ${w}`,
    },
    sheet: {
      open: "Put them in the repo",
      zip: "Download .zip",
      title: (name: string) => `Put the brand in ${name}'s repo`,
      lead: "Plania makes the files from the original, on this machine. Taller only puts them where they go and links them; it never redraws them.",
      changes: "What changes",
      framework: { "next-app": "Next.js · App Router", vite: "Vite", static: "Static site" } as Record<string, string>,
      faltan: "Only what is missing",
      todo: "Redo everything from the original",
      kept: (n: number) => `${n} are already right: left alone`,
      edits: "Code that links them",
      edit: {
        manifest_icons: "the manifest's icons",
        manifest_mono: "monochrome icon in the manifest",
        layout_svg: "links the SVG in the metadata",
        layout_theme: "themeColor and appleWebApp",
        html_links: "icon links in the head",
        html_manifest: "a link to the manifest",
        layout_splash: "launch screens in appleWebApp.startupImage",
        html_splash: "apple-touch-startup-image links",
        expo_icons: "icon, ios.icon and android.adaptiveIcon",
        capacitor_assets: "run @capacitor/assets with these sources",
      } as Record<string, string>,
      file: { splash: "19 launch screens", ios_app: "1024 × 1024, opaque", and_app: "foreground, monochrome and background", ico: "favicon 16 · 32 · 48", svg: "SVG icon", apple: "180 × 180, opaque", a192: "192 × 192", a512: "512 × 512", mask: "512, drawing inside 40 %", mono: "silhouette for themed icons", og: "1200 × 630", manifest: "name, colours and icons" } as Record<string, string>,
      way: "How it arrives",
      steps: [
        ["Plania makes the files", "From the original, at exact sizes. No paid services."],
        ["Taller opens a PR", "A new branch from the start branch; it places and links the files."],
        ["QA runs the list", "The project's verify list."],
        ["El Probador shows before and after", "The tab, the icon and the share image."],
        ["You accept", "And the list checks the repo again by itself."],
      ] as [string, string][],
      count: (n: number) => `${n} changes · one request for Taller`,
      cancel: "Cancel",
      send: "Ask Taller",
      sent: (key: string) => `Taller has the request «The brand's icons» (${key}). The rows turn green when it lands on the start branch.`,
      loading: "Making the files…",
    },
    inPr: (key: string) => `Taller is working · ${key}`,
    camino: "in Taller's PR",
    drift: {
      text: (p: string) => `The repo shows another logo: ${p}. Plania keeps yours until you decide.`,
      use: "Use the repo's",
      keep: "Keep mine",
    },
    change: "Change the logo",
    menu: {
      upload: "Upload one",
      uploadHint: "SVG, or a 1024 px PNG",
      repo: "Another from the repo",
      repoHint: (n: number) => `${n} found`,
      versions: "Versions",
      versionsHint: (n: number) => `${n} kept`,
      release: "Let the repo lead",
      releaseHint: "Plania picks from the repo again",
    },
    repoTitle: "Logos in the repo",
    repoLead: (branch: string) => `What Plania found on the ${branch} branch. An SVG beats a PNG; a big one beats a small one.`,
    inUse: "in use",
    useThis: "Use this one",
    versionsTitle: "Logo versions",
    versionsLead: "Every change keeps a version. Going back to one makes it your choice.",
    goBack: "Go back to this one",
    active: "active",
    when: (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
    solo: {
      btn: "Only this one",
      own: "Own",
      send: "Put it in the repo",
      back: "Back to the original",
      name: { navegador: "the browser", iphone: "iPhone", android: "Android" } as Record<Surface, string>,
      title: (s: string, name: string) => `The ${s} icon for ${name}`,
      lead: (s: string) => `Change the size and background, or drop another picture. Only ${s}'s files change; the rest keep the original.`,
      use: (s: string) => `Use only on ${s}`,
      saved: (s: string) => `${s} has its own icon now. Put it in the repo so the app gets it.`,
      reset: (s: string) => `${s} uses the original again.`,
      sheet: (s: string) => `${s} only`,
      preview: "how it will look",
      waits: (s: string, key: string) => `${s} has its own icon. Taller is still on ${key}: once you accept it, put this in the repo.`,
    },
    up: {
      title: (name: string) => `Upload a logo for ${name}`,
      lead: "SVG or a PNG of 1024 px or more. Plania checks it right away and shows how it looks everywhere.",
      drop: "Drop your logo here",
      dropHint: "or tap to pick a file · SVG, PNG, JPG or WebP",
      reading: "Checking the file…",
      circle: "Android circle",
      iphone: "iPhone crop",
      other: "Another file",
      size: "Size inside the icon",
      background: "Background",
      none: "No background",
      checks: (name: string) => `Checks on ${name}`,
      use: "Use this logo",
      back: "Back",
      saved: "It is the new original. The previous one stays in Versions.",
      faces: { tab: "Tab · 16 px", ios: "iPhone · 180 px", and: "Android · circle", pwa: "Install", share: "Sharing · 1200 × 630", cia: "Company" },
      empty: "Here you see how it looks on the six faces before using it.",
      rules: [
        ["Format", "SVG wins; PNG, JPG or WebP work too"],
        ["Size", "1024 px or more; under 512 is refused"],
        ["Shape", "square or nearly; otherwise it is centred in a square"],
        ["Background", "if it is transparent, you pick one for iPhone and Android"],
        ["Cleaning", "an SVG with scripts or outside links is cleaned"],
        ["16 px, circle and contrast", "every logo's tests, on its pixels"],
      ] as [string, string][],
      rulesTitle: "What Plania checks",
    },
    upCheck: {
      format: (v: Record<string, string | number>) => `${v.kind} of ${v.w} × ${v.h} px`,
      svg_clean: "Clean SVG: no scripts or outside links",
      svg_cleaned: "It had scripts or outside links: they were removed",
      too_small: (v: Record<string, string | number>) => `Too small: ${v.px} px. Upload it at 1024 px or as SVG`,
      small: (v: Record<string, string | number>) => `It works, but 1024 px is better (it has ${v.px})`,
      big_enough: "1024 px or more",
      square: "Square",
      not_square: (v: Record<string, string | number>) => `Not square (${v.w} × ${v.h}): it is centred in a square`,
      transparent: "Transparent background: pick one for iPhone and Android",
      own_background: "Brings its own background",
    } as Record<string, string | ((v: Record<string, string | number>) => string)>,
    tests: {
      smallOk: "Reads at 16 px",
      smallBad: (pct: number) => `At 16 px ${pct} % of the drawing is lost`,
      circleOk: (pct: number) => `Fits Android's circle (reaches ${pct} %)`,
      circleBad: (pct: number) => `Leaves Android's circle (reaches ${pct} %, max 40)`,
      contrastOk: (v: number) => `Contrast ${v} : 1`,
      contrastBad: (v: number) => `Low contrast: ${v} : 1 (min 3)`,
    },
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
