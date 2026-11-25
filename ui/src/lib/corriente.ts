import { defineWords, getLanguage, words, type Language } from "./i18n.js";
import { LOCALE } from "./locale.js";
// PLA-I62: La corriente's address. Pure, so the tests call it directly.
// PLA-I2-10: the words are in CORRIENTE_LIB_WORDS, in both languages. TAB_NAME and MODES keep their Spanish for their
// readers; the screen reads tabName() and modesOf().
//   (nothing)                 the stream, every project by stage
//   ?v=tetoca|asistente|pedir|brief|piezas   the global pages (piezas is the internal kit page; brief is PLA-I63)
//   ?proyecto=<slug>[&t=<door>] a project: its list (PLA-I64), or a door (hecho, equipo, motores, maquinas, ajustes)
//   &ver=<kind>:<ref>         what a tab has open (a paso, a pedido, an idea, a PR, a doc, an entrega, a teammate…)
//   &paso=<K>                 PLA-I3-5: the step open in the side panel beside the list (the list stays); never with ver
// The stream is the first screen; inside a project it shrinks to a strip on top.

export const VIEWS = ["corriente", "tetoca", "asistente", "pedir", "brief", "piezas"] as const;
export type View = (typeof VIEWS)[number];

// PLA-I64-7: inside a project there is one list (todo, the entry) and its doors: Archivo, Hecho, Equipo (with
// Motores behind it) and Máquinas. The old tabs' addresses still open: each lands on its new place (OLD_TAB).
// NEWPROJ-6: Ajustes, the project's settings (where the code is, the release step, QA's list, the context notes).
// PLA-I66-2: Marca, the project's logo and its icon files, before Ajustes.
// PLA-I68-2: Camino, how the project's code reaches people (configuration only), before Ajustes; PRs live there now.
// PLA-135: Archivo is gone (the owner saw no use in a second list of the work: that is Todo). A thing's papers open
// from its ficha over Todo; the project's own docs live in Ajustes («Docs del proyecto»).
export const TABS = ["todo", "hecho", "equipo", "motores", "maquinas", "marca", "camino", "ajustes"] as const;
export type Tab = (typeof TABS)[number];
export const DOORS = ["equipo", "maquinas", "marca", "camino", "ajustes"] as const;
export const CORRIENTE_LIB_WORDS = defineWords({
  es: {
    tab: { todo: "Todo", hecho: "Hecho", equipo: "Equipo", motores: "Motores", maquinas: "Máquinas", marca: "Marca", camino: "Despliegue", ajustes: "Ajustes" } as Record<Tab, string>,
    // The ask box's three modes (the same words as the building's).
    modes: {
      forma: { name: "Darle forma", line: "El PO evalúa y aclara la idea. El desarrollo inicia con «Constrúyelo»." },
      ya: { name: "Hacerlo ya", line: "Cambios pequeños y claros que se agregan directamente al tablero." },
      pregunta: { name: "Preguntar", line: "El PO analiza el código y responde sin generar ideas ni tareas." },
    },
    // PLA-I3-6 «Un solo Pedir»: the bar's words.
    pedir: {
      placeholder: {
        forma: "Una idea para darle forma: el PO la entiende y te pregunta…",
        ya: "Un cambio pequeño y claro, directo al tablero…",
        pregunta: "¿Qué quieres saber? El PO lee el código y te contesta…",
      },
      sending: "Enviando…",
      ask: "Preguntar",
      send: "Pedir",
      past: "Lo pedido",
      picture: "Añadir una imagen",
      error: "No se pudo enviar. Si la máquina está dormida, intenta al despertar.",
      held: (title: string) => `En pausa. Reanuda ${title} para pedir algo nuevo; lo que ya pediste sigue aquí.`,
      chipAria: (mode: string) => `Cómo: ${mode}`,
      menu: "Cómo pedirlo",
    },
    // countWords(): a count in words up to ten.
    numbers: ["Cero", "Un", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez"],
    oneFem: "Una",
  },
  en: {
    tab: { todo: "All", hecho: "Done", equipo: "Team", motores: "Engines", maquinas: "Machines", marca: "Brand", camino: "Deploy", ajustes: "Settings" },
    modes: {
      forma: { name: "Shape it", line: "It comes in as an idea. The PO understands it, asks and moves it forward. Nobody writes code until you say “Build it”." },
      ya: { name: "Do it now", line: "A small, clear change. It goes straight to the board." },
      pregunta: { name: "Ask a question", line: "You only want to know something. The PO reads the code and answers you. It makes no idea and no step." },
    },
    pedir: {
      placeholder: {
        forma: "An idea to shape: the PO understands it and asks you…",
        ya: "A small, clear change, straight to the board…",
        pregunta: "What do you want to know? The PO reads the code and answers you…",
      },
      sending: "Sending…",
      ask: "Ask",
      send: "Ask",
      past: "Your requests",
      picture: "Add a picture",
      error: "It could not be sent. If the machine is asleep, try again when it wakes.",
      held: (title: string) => `Paused. Resume ${title} to ask for something new; what you already asked for stays here.`,
      chipAria: (mode: string) => `How: ${mode}`,
      menu: "How to ask",
    },
    numbers: ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"],
    oneFem: "One",
  },
});

/** The Spanish names, kept for their readers; the screen reads tabName(). */
export const TAB_NAME: Record<Tab, string> = CORRIENTE_LIB_WORDS.es.tab;
export const tabName = (tab: Tab, language: Language = getLanguage()): string => words(CORRIENTE_LIB_WORDS, language).tab[tab];
/** The retired tabs (PLA-I62) and where each one lives now. PLA-135: Archivo's address lands on the list, the old
 *  Docs tab on Ajustes (the project's docs). */
export const OLD_TAB: Record<string, Tab> = { ahora: "todo", pedidos: "todo", tablero: "todo", ideas: "todo", diseno: "todo", prs: "camino", docs: "ajustes", archivo: "todo" };
export const tabOf = (raw: string | null | undefined): Tab | null => (!raw ? null : (TABS as readonly string[]).includes(raw) ? (raw as Tab) : (OLD_TAB[raw] ?? null));

/** What a tab has open beside or over its list. */
export type Ver =
  | { kind: "paso"; key: string }
  | { kind: "iniciativa"; key: string }
  | { kind: "sueltos" }
  | { kind: "pedido"; key: string }
  | { kind: "idea"; key: string }
  | { kind: "guardadas" }
  | { kind: "pr"; n: number }
  | { kind: "doc"; id: string }
  | { kind: "lienzo"; key: string }
  | { kind: "entrega"; id: string }
  | { kind: "miembro"; agent: string }
  | { kind: "sumar" }
  // PLA-I71-4: Equipo's skill store, with the skill open (null: none).
  | { kind: "tienda"; skill: string | null }
  // PLA-I71-5: bring a skill from outside (a link or skills.sh).
  | { kind: "traer" }
  // PLA-I71-6: the team catalog, adopting one team, and the whole company in a file.
  | { kind: "equipos" }
  | { kind: "adoptar"; team: string }
  | { kind: "compania" }
  | { kind: "maq"; what: string }
  | { kind: "tabla"; name: string }
  // PLA-I68-2: the Camino section open (conn, codigo, commits, ci, propuestas, hist, env:<id>).
  | { kind: "camino"; sec: string };

/** PLA-I3-5: paso is the step open in the panel beside the list. Present only when the address has one, on a
 *  project's list (no ver, tab todo). */
export type At = { view: View; slug: string | null; tab: Tab; ver: Ver | null; paso?: string };

const VER_KINDS = ["paso", "iniciativa", "sueltos", "pedido", "idea", "guardadas", "pr", "doc", "lienzo", "entrega", "miembro", "oficio", "sumar", "tienda", "traer", "equipos", "adoptar", "compania", "maq", "tabla", "camino"] as const;

export function verOf(raw: string | null): Ver | null {
  if (!raw) return null;
  const i = raw.indexOf(":");
  const kind = (i < 0 ? raw : raw.slice(0, i)) as Ver["kind"] | "oficio";
  const ref = i < 0 ? "" : raw.slice(i + 1);
  if (!(VER_KINDS as readonly string[]).includes(kind)) return null;
  // PLA-I64-7: a pedido and a lienzo are their idea; Sueltos and Guardadas are lines of the list.
  if (kind === "sueltos" || kind === "guardadas") return null;
  if (kind === "sumar" || kind === "traer" || kind === "equipos" || kind === "compania") return { kind };
  if (kind === "adoptar") return ref ? { kind, team: ref } : null;
  if (kind === "tienda") return { kind, skill: ref || null };
  if (!ref) return null;
  if (kind === "pedido" || kind === "lienzo") return { kind: "idea", key: ref };
  if (kind === "pr") return Number.isFinite(Number(ref)) && Number(ref) > 0 ? { kind, n: Number(ref) } : null;
  if (kind === "doc" || kind === "entrega") return { kind, id: ref };
  // PLA-I71-2: the agent page is gone; its old address opens the chart with that agent selected.
  if (kind === "miembro" || kind === "oficio") return { kind: "miembro", agent: ref };
  if (kind === "maq") return { kind, what: ref };
  if (kind === "tabla") return { kind, name: ref };
  if (kind === "camino") return { kind, sec: ref };
  return { kind, key: ref } as Ver;
}

export function verParam(v: Ver): string {
  switch (v.kind) {
    case "sueltos":
    case "guardadas":
    case "sumar":
    case "traer":
    case "equipos":
    case "compania":
      return v.kind;
    case "adoptar":
      return `adoptar:${v.team}`;
    case "tienda":
      return v.skill ? `tienda:${v.skill}` : "tienda";
    case "pr":
      return `pr:${v.n}`;
    case "doc":
    case "entrega":
      return `${v.kind}:${v.id}`;
    case "miembro":
      return `${v.kind}:${v.agent}`;
    case "maq":
      return `maq:${v.what}`;
    case "tabla":
      return `tabla:${v.name}`;
    case "camino":
      return `camino:${v.sec}`;
    default:
      return `${v.kind}:${v.key}`;
  }
}

/** The tab a Ver lives in (PLA-I64-7: a thing of the project opens over the list). PLA-135: a doc opens over the list
 *  too, unless its address names Ajustes (a doc opened from «Docs del proyecto» goes back there). */
export function tabOfVer(v: Ver): Tab {
  switch (v.kind) {
    // PLA-I68-2: a PR opens from Camino's Propuestas.
    case "pr":
    case "camino":
      return "camino";
    case "miembro":
    case "sumar":
    case "tienda":
    case "traer":
    case "equipos":
    case "adoptar":
    case "compania":
      return "equipo";
    case "maq":
    case "tabla":
      return "maquinas";
    default:
      return "todo";
  }
}

export function atOf(search: string): At {
  const q = new URLSearchParams(search);
  const slug = q.get("proyecto") || null;
  const ver = verOf(q.get("ver"));
  const t = tabOf(q.get("t"));
  // An old tab whose ver lives elsewhere (t=tablero&ver=pr:3) follows the ver.
  const tab: Tab = ver && (!t || (q.get("t") && OLD_TAB[q.get("t")!] && tabOfVer(ver) !== t)) ? tabOfVer(ver) : (t ?? "todo");
  const v = q.get("v") as View | null;
  const view: View = slug ? "corriente" : v && (VIEWS as readonly string[]).includes(v) ? v : "corriente";
  const paso = slug && !ver && tab === "todo" ? q.get("paso")?.trim() : null;
  return paso ? { view, slug, tab, ver, paso } : { view, slug, tab, ver };
}

export function searchOf(at: Partial<At> & { extra?: Record<string, string> }): string {
  const q = new URLSearchParams();
  if (at.slug) {
    q.set("proyecto", at.slug);
    const tab = at.tab ?? (at.ver ? tabOfVer(at.ver) : "todo");
    if (tab !== "todo") q.set("t", tab);
    if (at.ver) q.set("ver", verParam(at.ver));
    else if (at.paso && tab === "todo") q.set("paso", at.paso);
  } else if (at.view && at.view !== "corriente") q.set("v", at.view);
  for (const [k, val] of Object.entries(at.extra ?? {})) q.set(k, val);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** PLA-I3-5: the list with step k open beside it (null: the list alone). */
export const pasoAt = (slug: string, k: string | null): Partial<At> => (k ? { slug, tab: "todo", paso: k } : { slug, tab: "todo" });

/** Where La corriente lives: Compañía (PLA-I62-9; it was built at /corriente, which now redirects here). */
export const HOME = "/ceo";
export const hrefOf = (at: Partial<At> & { extra?: Record<string, string> }) => `${HOME}${searchOf(at)}`;

/** PLA-113 (guided test PLA-86, F-2): the old project page (/p/<slug>) is reached on purpose only, from Ajustes
 * («Abrir la página del proyecto», with ?pagina). Every other link to it (Inicio, Bandeja, Máquina, the brief, a
 * thread) opens the project in La corriente, and ?task=KEY opens that step, idea or initiative there. Null: stay. */
export function oldProjectHref(slug: string, search: string): string | null {
  const q = new URLSearchParams(search);
  if (q.has("pagina") || !slug) return null;
  const key = q.get("task")?.trim();
  if (!key) return hrefOf({ slug });
  const ver: Ver = /-IDEA\d+$/i.test(key) ? { kind: "idea", key } : /-I\d+$/i.test(key) ? { kind: "iniciativa", key } : { kind: "paso", key };
  return hrefOf({ slug, ver });
}

/** Where each part still lives in the building (/ceo) while La corriente does not draw it yet. */
export function legacyHref(at: Partial<At>): string {
  const slug = at.slug ?? null;
  if (!slug) {
    if (at.view === "asistente") return "/ceo?asistente";
    if (at.view === "tetoca") return "/ceo?edificio";
    if (at.view === "brief") return "/ceo?v=brief";
    return "/ceo";
  }
  const piso = `piso=${encodeURIComponent(slug)}`;
  const v = at.ver;
  if (v) {
    const f =
      v.kind === "paso"
        ? `step:${v.key}`
        : v.kind === "iniciativa"
          ? `leg:${v.key}`
          : v.kind === "sueltos"
            ? "sueltos"
            : v.kind === "pedido"
              ? `pedido:${v.key}`
              : v.kind === "idea"
                ? `idea:${v.key}`
                : v.kind === "guardadas"
                  ? "guardadas"
                  : v.kind === "pr"
                    ? `pr:${v.n}`
                    : v.kind === "doc"
                      ? `doc:${v.id}`
                      : v.kind === "lienzo"
                        ? "tab:diseno"
                        : v.kind === "miembro"
                          ? `member:${v.agent}`
                          : v.kind === "sumar"
                            ? "sumar"
                            : null;
    if (v.kind === "entrega") return `/ceo?${piso}&decision=${encodeURIComponent(v.id)}`;
    if (v.kind === "maq") return `/ceo?${piso}&nivel=maquinas&f=${encodeURIComponent(`maq:${v.what}`)}`;
    if (v.kind === "tabla") return `/ceo?${piso}&nivel=maquinas&f=${encodeURIComponent(`maq:tabla:${v.name}`)}`;
    if (f) return `/ceo?${piso}&f=${encodeURIComponent(f)}`;
  }
  const tab = at.tab ?? "todo";
  if (tab === "maquinas") return `/ceo?${piso}&nivel=maquinas`;
  if (tab === "motores") return `/ceo?${piso}&f=${encodeURIComponent("tab:motores")}`;
  return `/ceo?${piso}`;
}

// ---- words

/** The seats, always with these names (one vocabulary). */
export const SEAT: Record<string, string> = {
  "product-owner": "PO",
  research: "Research",
  artist: "Artist",
  taller: "Taller",
  qa: "QA",
  asistente: "Asistente",
};
export const seatName = (role: string) => SEAT[role] ?? role.replace(/(^|-)(\w)/g, (_m, s: string, c: string) => `${s ? " " : ""}${c.toUpperCase()}`);

/** A project's logo: its first letter on its hue (the only place the project's colour shows). */
const HUES = ["#ff6f9f", "#a290ff", "#45cad6", "#ffd166", "#7bd88f", "#6ea8ff"] as const;
export function hueOf(slug: string): string {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length]!;
}
export const initialOf = (title: string) => (title.trim()[0] ?? "?").toLocaleUpperCase(LOCALE);

/** «Tres agentes trabajando.»: a count in words up to ten, then digits. */
export function countWords(n: number, one: string, many: string, fem = false, language: Language = getLanguage()): string {
  const w = words(CORRIENTE_LIB_WORDS, language);
  const word = n <= 10 ? (n === 1 && fem ? w.oneFem : w.numbers[n]!) : String(n);
  return `${word} ${n === 1 ? one : many}`;
}

export const thousands = (n: number) => n.toLocaleString("en-US");

/** «MAR 17 NOV · 15:06» in the screen's time zone. */
export function clockLine(now: number, timeZone?: string): string {
  const d = new Date(now);
  const day = new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short", timeZone })
    .formatToParts(d)
    .filter((p) => p.type !== "literal")
    .map((p) => p.value.replace(".", ""))
    .join(" ");
  const time = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(d);
  return `${day} · ${time}`.toUpperCase();
}

// ---- which parts La corriente draws already (each phase of PLA-I62 adds its own); the rest link to the building.
export const BUILT: { views: View[]; tabs: Tab[]; vers: Ver["kind"][] } = {
  views: [...VIEWS],
  tabs: [...TABS],
  vers: ["entrega", "pedido", "guardadas", "paso", "iniciativa", "sueltos", "miembro", "sumar", "tienda", "traer", "equipos", "adoptar", "compania", "idea", "lienzo", "pr", "doc", "maq", "tabla", "camino"],
};
export function isBuilt(at: Partial<At>): boolean {
  if (!at.slug) return BUILT.views.includes(at.view ?? "corriente");
  if (at.ver) return BUILT.vers.includes(at.ver.kind);
  return BUILT.tabs.includes(at.tab ?? "todo");
}
/** The address for a place: La corriente's when it is drawn here, else its place in the building. */
export const linkTo = (at: Partial<At>): string => (isBuilt(at) ? hrefOf(at) : legacyHref(at));

// ---- asking (the same words and limit as the building's ask box)
export type AskMode = "forma" | "ya" | "pregunta";
export type AskInput = { text: string; mode: AskMode; consulta?: string };
export const ASK_MAX = 2000;
const MODE_IDS: AskMode[] = ["forma", "ya", "pregunta"];
export const modesOf = (language: Language = getLanguage()): { id: AskMode; name: string; line: string }[] =>
  MODE_IDS.map((id) => ({ id, ...words(CORRIENTE_LIB_WORDS, language).modes[id] }));
/** The Spanish modes, kept for their readers; the screen reads modesOf(). */
export const MODES: { id: AskMode; name: string; line: string }[] = modesOf("es");

// PLA-I3-6 «Un solo Pedir»: the bar at the foot is the Pedir inside a project (ADR 0008: the ⌘K palette, lib/paleta.ts,
// is the Pedir for the rest of the app). Its words and its keys, tested without a browser.
/** The input's placeholder: the selected mode's line, short enough to read inside the bar. */
export const PEDIR_PLACEHOLDER: Record<AskMode, string> = CORRIENTE_LIB_WORDS.es.pedir.placeholder;
export const pedirPlaceholder = (mode: AskMode, language: Language = getLanguage()): string => words(CORRIENTE_LIB_WORDS, language).pedir.placeholder[mode];
/** The send button's word. */
export const pedirSendLabel = (mode: AskMode, sending = false, language: Language = getLanguage()): string => {
  const w = words(CORRIENTE_LIB_WORDS, language).pedir;
  return sending ? w.sending : mode === "pregunta" ? w.ask : w.send;
};
/** Shift+Tab from the input: the next mode, round. */
export const nextMode = (mode: AskMode): AskMode => MODE_IDS[(MODE_IDS.indexOf(mode) + 1) % MODE_IDS.length] ?? "forma";
// PLA-I2-10: the Spanish constants are kept for their readers; the screen reads the functions.
export const PEDIR_PAST = CORRIENTE_LIB_WORDS.es.pedir.past;
export const PEDIR_PICTURE = CORRIENTE_LIB_WORDS.es.pedir.picture;
export const PEDIR_ERROR = CORRIENTE_LIB_WORDS.es.pedir.error;
export const PEDIR_MENU = CORRIENTE_LIB_WORDS.es.pedir.menu;
export const pedirPast = (language: Language = getLanguage()): string => words(CORRIENTE_LIB_WORDS, language).pedir.past;
export const pedirPicture = (language: Language = getLanguage()): string => words(CORRIENTE_LIB_WORDS, language).pedir.picture;
export const pedirError = (language: Language = getLanguage()): string => words(CORRIENTE_LIB_WORDS, language).pedir.error;
export const pedirMenu = (language: Language = getLanguage()): string => words(CORRIENTE_LIB_WORDS, language).pedir.menu;
/** Paused: one sentence instead of a disabled input. */
export const pedirHeld = (title: string, language: Language = getLanguage()): string => words(CORRIENTE_LIB_WORDS, language).pedir.held(title);
/** PLA-I3-7: on a phone the mode is one chip; its menu holds the three modes, the picture button and «Lo pedido». */
export const pedirChipAria = (mode: AskMode, language: Language = getLanguage()): string =>
  words(CORRIENTE_LIB_WORDS, language).pedir.chipAria(modesOf(language).find((m) => m.id === mode)?.name ?? "");
/** The key hint: `/` at rest, `↵` while the input has focus. */
export const pedirKeyHint = (focused: boolean): string => (focused ? "↵" : "/");
/** `/` focuses the input unless a field already has focus, a modifier is held, or a sheet is open. */
export function slashFocuses(e: { key: string; meta?: boolean; ctrl?: boolean; alt?: boolean }, active: { tag: string; editable?: boolean } | null, sheetOpen: boolean): boolean {
  if (e.key !== "/" || e.meta || e.ctrl || e.alt || sheetOpen) return false;
  if (!active) return true;
  return !active.editable && !["INPUT", "TEXTAREA", "SELECT"].includes(active.tag.toUpperCase());
}

// ---- PLA-I62-9: the building's addresses, each to its screen in La corriente (null: nothing to move).
//   ?edificio (Oficina) → Te toca · ?asistente → Asistente · ?nuevo → the Nuevo proyecto sheet · ?decision=<id> → its card
//   in Te toca · ?piso=<slug> → the project (with ?nivel=maquinas → Máquinas) · ?f=<ficha ref> → its tab and what it
//   opens · ?m=<slug>:<agent> → the teammate · ?plan=<slug> → the board · ?add=<slug> → Sumar. ?doc=<id> stays (a sheet).
const FICHA_TAB: Record<string, Tab> = { resumen: "todo", pedido: "todo", ideas: "todo", diseno: "todo", prs: "camino", docs: "ajustes", motores: "motores" };
export function fromBuilding(search: string, ref: { kind: string; [k: string]: unknown } | null, refSlug: string | null): string | null {
  const q = new URLSearchParams(search);
  const legacy = ["edificio", "asistente", "nuevo", "decision", "piso", "f", "m", "plan", "add", "nivel"].some((k) => q.has(k));
  if (!legacy) return null;
  const keep: Record<string, string> = q.has("doc") ? { doc: q.get("doc")! } : {};
  if (q.has("asistente")) return searchOf({ view: "asistente", extra: keep });
  if (q.has("nuevo")) return searchOf({ view: "corriente", extra: { ...keep, hoja: "nuevo" } });
  const slug = refSlug ?? q.get("piso");
  if (q.has("decision") && !slug) return searchOf({ view: "tetoca", extra: { ...keep, decision: q.get("decision")! } });
  if (!slug) return searchOf({ view: q.has("edificio") ? "tetoca" : "corriente", extra: keep });
  if (q.has("decision")) return searchOf({ view: "tetoca", extra: { ...keep, decision: q.get("decision")! } });
  const maquinas = q.get("nivel") === "maquinas";
  if (!ref) return searchOf({ slug, tab: maquinas ? "maquinas" : "todo", extra: keep });
  const s = (v: unknown) => String(v ?? "");
  switch (ref.kind) {
    case "tab":
      return searchOf({ slug, tab: FICHA_TAB[s(ref.tab)] ?? "todo", extra: keep });
    case "step":
      return searchOf({ slug, ver: { kind: "paso", key: s(ref.key) }, extra: keep });
    case "leg":
      return searchOf({ slug, ver: { kind: "iniciativa", key: s(ref.key) }, extra: keep });
    case "idea":
      return searchOf({ slug, ver: { kind: "idea", key: s(ref.key) }, extra: keep });
    case "pedido":
      return searchOf({ slug, ver: { kind: "pedido", key: s(ref.key) }, extra: keep });
    case "guardadas":
      return searchOf({ slug, extra: keep });
    case "member":
      return searchOf({ slug, ver: { kind: "miembro", agent: s(ref.agent) }, extra: keep });
    case "pr":
      return searchOf({ slug, ver: { kind: "pr", n: Number(ref.n) }, extra: keep });
    case "doc":
      return searchOf({ slug, ver: { kind: "doc", id: s(ref.id) }, extra: keep });
    case "lienzo":
      // PLA-135: a design lives on its idea's Diseño stop.
      return ref.key ? searchOf({ slug, ver: { kind: "idea", key: s(ref.key) }, extra: keep }) : searchOf({ slug, extra: keep });
    case "sumar":
      return searchOf({ slug, ver: { kind: "sumar" }, extra: keep });
    case "app":
      return searchOf({ slug, tab: "maquinas", extra: keep });
    case "maq":
      return searchOf({ slug, ver: { kind: "maq", what: s(ref.what) }, extra: keep });
    case "maq-tabla":
      return searchOf({ slug, ver: { kind: "tabla", name: s(ref.name) }, extra: keep });
    default:
      // plan, sueltos: the list.
      return searchOf({ slug, extra: keep });
  }
}
