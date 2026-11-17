// PLA-I62: La corriente's address. Pure, so the tests call it directly.
//   (nothing)                 the stream, every project by stage
//   ?v=tetoca|asistente|pedir|piezas   the global pages (piezas is the internal kit page)
//   ?proyecto=<slug>&t=<tab>  a project, one of its tabs
//   &ver=<kind>:<ref>         what a tab has open (a paso, a pedido, an idea, a PR, a doc, an entrega, a teammate…)
// The stream is the first screen; inside a project it shrinks to a strip on top.

export const VIEWS = ["corriente", "tetoca", "asistente", "pedir", "piezas"] as const;
export type View = (typeof VIEWS)[number];

export const WORK_TABS = ["ahora", "pedidos", "tablero", "ideas", "diseno", "prs", "docs"] as const;
export const SIDE_TABS = ["equipo", "motores", "maquinas"] as const;
export const TABS = [...WORK_TABS, ...SIDE_TABS] as const;
export type Tab = (typeof TABS)[number];
export const TAB_NAME: Record<Tab, string> = {
  ahora: "Ahora",
  pedidos: "Pedidos",
  tablero: "Tablero",
  ideas: "Ideas",
  diseno: "Diseño",
  prs: "PRs",
  docs: "Docs",
  equipo: "Equipo",
  motores: "Motores",
  maquinas: "Máquinas",
};

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
  | { kind: "maq"; what: string }
  | { kind: "tabla"; name: string };

export type At = { view: View; slug: string | null; tab: Tab; ver: Ver | null };

const VER_KINDS = ["paso", "iniciativa", "sueltos", "pedido", "idea", "guardadas", "pr", "doc", "lienzo", "entrega", "miembro", "sumar", "maq", "tabla"] as const;

export function verOf(raw: string | null): Ver | null {
  if (!raw) return null;
  const i = raw.indexOf(":");
  const kind = (i < 0 ? raw : raw.slice(0, i)) as Ver["kind"];
  const ref = i < 0 ? "" : raw.slice(i + 1);
  if (!(VER_KINDS as readonly string[]).includes(kind)) return null;
  if (kind === "sueltos" || kind === "guardadas" || kind === "sumar") return { kind };
  if (!ref) return null;
  if (kind === "pr") return Number.isFinite(Number(ref)) && Number(ref) > 0 ? { kind, n: Number(ref) } : null;
  if (kind === "doc" || kind === "entrega") return { kind, id: ref };
  if (kind === "miembro") return { kind, agent: ref };
  if (kind === "maq") return { kind, what: ref };
  if (kind === "tabla") return { kind, name: ref };
  return { kind, key: ref } as Ver;
}

export function verParam(v: Ver): string {
  switch (v.kind) {
    case "sueltos":
    case "guardadas":
    case "sumar":
      return v.kind;
    case "pr":
      return `pr:${v.n}`;
    case "doc":
    case "entrega":
      return `${v.kind}:${v.id}`;
    case "miembro":
      return `miembro:${v.agent}`;
    case "maq":
      return `maq:${v.what}`;
    case "tabla":
      return `tabla:${v.name}`;
    default:
      return `${v.kind}:${v.key}`;
  }
}

/** The tab a Ver lives in (a link to a paso opens the board, to a pedido the Pedidos tab). */
export function tabOfVer(v: Ver): Tab {
  switch (v.kind) {
    case "paso":
    case "iniciativa":
    case "sueltos":
      return "tablero";
    case "pedido":
    case "guardadas":
      return "pedidos";
    case "idea":
      return "ideas";
    case "lienzo":
      return "diseno";
    case "pr":
      return "prs";
    case "doc":
      return "docs";
    case "entrega":
      return "ahora";
    case "miembro":
    case "sumar":
      return "equipo";
    case "maq":
    case "tabla":
      return "maquinas";
  }
}

export function atOf(search: string): At {
  const q = new URLSearchParams(search);
  const slug = q.get("proyecto") || null;
  const ver = verOf(q.get("ver"));
  const t = q.get("t") as Tab | null;
  const tab: Tab = t && (TABS as readonly string[]).includes(t) ? t : ver ? tabOfVer(ver) : "ahora";
  const v = q.get("v") as View | null;
  const view: View = slug ? "corriente" : v && (VIEWS as readonly string[]).includes(v) ? v : "corriente";
  return { view, slug, tab, ver };
}

export function searchOf(at: Partial<At> & { extra?: Record<string, string> }): string {
  const q = new URLSearchParams();
  if (at.slug) {
    q.set("proyecto", at.slug);
    const tab = at.tab ?? (at.ver ? tabOfVer(at.ver) : "ahora");
    if (tab !== "ahora") q.set("t", tab);
    if (at.ver) q.set("ver", verParam(at.ver));
  } else if (at.view && at.view !== "corriente") q.set("v", at.view);
  for (const [k, val] of Object.entries(at.extra ?? {})) q.set(k, val);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Where La corriente lives. /corriente until PLA-I62-9 makes it /ceo. */
export const HOME = "/corriente";
export const hrefOf = (at: Partial<At> & { extra?: Record<string, string> }) => `${HOME}${searchOf(at)}`;

/** Where each part still lives in the building (/ceo) while La corriente does not draw it yet. */
export function legacyHref(at: Partial<At>): string {
  const slug = at.slug ?? null;
  if (!slug) {
    if (at.view === "asistente") return "/ceo?asistente";
    if (at.view === "tetoca") return "/ceo?edificio";
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
  const tab = at.tab ?? "ahora";
  if (tab === "maquinas") return `/ceo?${piso}&nivel=maquinas`;
  if (tab === "tablero" || tab === "ahora" || tab === "equipo") return `/ceo?${piso}`;
  const fichaTab = tab === "pedidos" ? "pedido" : tab;
  return `/ceo?${piso}&f=${encodeURIComponent(`tab:${fichaTab}`)}`;
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
export const initialOf = (title: string) => (title.trim()[0] ?? "?").toLocaleUpperCase("es-MX");

const NUM = ["Cero", "Un", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez"];
/** «Tres agentes trabajando.»: a count in words up to ten, then digits. */
export function countWords(n: number, one: string, many: string, fem = false): string {
  const word = n <= 10 ? (n === 1 ? (fem ? "Una" : "Un") : NUM[n]!) : String(n);
  return `${word} ${n === 1 ? one : many}`;
}

export const thousands = (n: number) => n.toLocaleString("en-US");

/** «MAR 17 NOV · 15:06» in the screen's time zone. */
export function clockLine(now: number, timeZone?: string): string {
  const d = new Date(now);
  const day = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone })
    .formatToParts(d)
    .filter((p) => p.type !== "literal")
    .map((p) => p.value.replace(".", ""))
    .join(" ");
  const time = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(d);
  return `${day} · ${time}`.toUpperCase();
}

// ---- which parts La corriente draws already (each phase of PLA-I62 adds its own); the rest link to the building.
export const BUILT: { views: View[]; tabs: Tab[]; vers: Ver["kind"][] } = {
  views: ["corriente", "piezas", "tetoca", "pedir", "asistente"],
  tabs: ["ahora", "pedidos", "tablero", "equipo", "ideas", "diseno", "prs", "docs"],
  vers: ["entrega", "pedido", "guardadas", "paso", "iniciativa", "sueltos", "miembro", "sumar", "idea", "lienzo", "pr", "doc"],
};
export function isBuilt(at: Partial<At>): boolean {
  if (!at.slug) return BUILT.views.includes(at.view ?? "corriente");
  if (at.ver) return BUILT.vers.includes(at.ver.kind);
  return BUILT.tabs.includes(at.tab ?? "ahora");
}
/** The address for a place: La corriente's when it is drawn here, else its place in the building. */
export const linkTo = (at: Partial<At>): string => (isBuilt(at) ? hrefOf(at) : legacyHref(at));

// ---- asking (the same words and limit as the building's ask box)
export type AskMode = "forma" | "ya" | "pregunta";
export type AskInput = { text: string; mode: AskMode; consulta?: string };
export const ASK_MAX = 2000;
export const MODES: { id: AskMode; name: string; line: string }[] = [
  { id: "forma", name: "Darle forma", line: "Entra como idea. El PO la entiende, pregunta y la avanza. Nadie escribe código hasta que digas «Constrúyelo»." },
  { id: "ya", name: "Hacerlo ya", line: "Un cambio pequeño y claro. Sube directo al tablero." },
  { id: "pregunta", name: "Preguntar", line: "Solo quieres saber algo. El PO lee el código y te contesta. No crea idea ni paso." },
];
