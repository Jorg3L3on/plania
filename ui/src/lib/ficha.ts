// PLA-I47-4: La ficha's address (Design frame 8). The right card shows a tab of the open floor or the detail of
// whatever was clicked; ?f=<kind>:<ref> carries it so a link reopens it. The old side-page links still land:
// ?m=<slug>:<agent> is a teammate, ?plan=<slug> the plan, ?add=<slug> adding someone (sheetOf keeps reading them for
// the floor they name). Pure; the page owns the navigation.
// PLA-I54-3: Pedido, the owner's requests taking shape (a capsule in the tube opens there).
// PLA-I59-3: Motores, the model and effort of each teammate on this floor (motores.tsx).
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export const FICHA_TABS = ["resumen", "pedido", "ideas", "diseno", "prs", "docs", "motores"] as const;
export type FichaTab = (typeof FICHA_TABS)[number];
// PLA-I2-10: the tabs' names in both languages; TAB_WORD keeps the Spanish for callers that read the constant.
export const TAB_WORDS = defineWords({
  es: { resumen: "Resumen", pedido: "Pedido", ideas: "Ideas", diseno: "Diseño", prs: "PRs", docs: "Docs", motores: "Motores" } as Record<FichaTab, string>,
  en: { resumen: "Summary", pedido: "Request", ideas: "Ideas", diseno: "Design", prs: "PRs", docs: "Docs", motores: "Engines" },
});
export const TAB_WORD: Record<FichaTab, string> = TAB_WORDS.es;
export const tabWord = (tab: FichaTab, language: Language = getLanguage()): string => words(TAB_WORDS, language)[tab];

export type FichaRef =
  | { kind: "tab"; tab: FichaTab }
  | { kind: "step"; key: string }
  // PLA-I61: an idea opened from the Diseño tab goes back there: ?f=idea:<key>~diseno.
  | { kind: "idea"; key: string; from?: "diseno" }
  // PLA-I54-3: one request of the owner's (?f=pedido:<key>) and the shelf of saved ones (?f=guardadas).
  | { kind: "pedido"; key: string }
  | { kind: "guardadas" }
  | { kind: "leg"; key: string }
  | { kind: "member"; agent: string }
  | { kind: "pr"; n: number }
  | { kind: "doc"; id: string }
  | { kind: "lienzo"; url: string }
  | { kind: "plan" }
  | { kind: "app" }
  | { kind: "sumar" }
  // PLA-I53-3: the board's Sueltos track (tickets under no open initiative).
  | { kind: "sueltos" }
  // PLA-I48-5/6: Máquinas. ?f=maq:servidor, maq:base, maq:llaves, maq:pruebas, maq:probar and maq:tabla:<name>.
  | { kind: "maq"; what: MaqWhat }
  | { kind: "maq-tabla"; name: string };

export const MAQ_WHAT = ["servidor", "base", "llaves", "pruebas", "probar"] as const;
export type MaqWhat = (typeof MAQ_WHAT)[number];
const TABLE = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/;

const LIENZO = /^https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+$/;
const KEY = /^[A-Z][A-Z0-9]*-(?:I|IDEA)?\d+(?:-\d+)?$/;
const UUID = /^[0-9a-f-]{36}$/i;

// What the address asks the ficha to show, and the floor it belongs to (null keeps the open one).
export function fichaOf(search: string): { ref: FichaRef; slug: string | null } | null {
  const q = new URLSearchParams(search);
  const f = q.get("f");
  if (f) {
    const at = f.indexOf(":");
    const kind = at < 0 ? f : f.slice(0, at);
    const ref = at < 0 ? "" : f.slice(at + 1);
    const one = (r: FichaRef | null) => (r ? { ref: r, slug: null } : null);
    if (kind === "tab") return one((FICHA_TABS as readonly string[]).includes(ref) ? { kind: "tab", tab: ref as FichaTab } : null);
    if (kind === "idea") {
      const [k, from] = ref.split("~");
      return one(KEY.test(k ?? "") ? (from === "diseno" ? { kind, key: k!, from } : { kind, key: k! }) : null);
    }
    if (kind === "step" || kind === "leg" || kind === "pedido") return one(KEY.test(ref) ? { kind, key: ref } : null);
    if (kind === "member") return one(ref ? { kind, agent: ref } : null);
    if (kind === "pr") return one(/^\d{1,7}$/.test(ref) ? { kind, n: Number(ref) } : null);
    if (kind === "doc") return one(UUID.test(ref) ? { kind, id: ref } : null);
    if (kind === "lienzo") return one(LIENZO.test(ref) ? { kind, url: ref } : null);
    if (kind === "plan" || kind === "app" || kind === "sumar" || kind === "sueltos" || kind === "guardadas") return one({ kind });
    if (kind === "maq") {
      if (ref.startsWith("tabla:")) return one(TABLE.test(ref.slice(6)) ? { kind: "maq-tabla", name: ref.slice(6) } : null);
      return one((MAQ_WHAT as readonly string[]).includes(ref) ? { kind: "maq", what: ref as MaqWhat } : null);
    }
    return null;
  }
  const m = q.get("m");
  if (m && m.indexOf(":") > 0) return { ref: { kind: "member", agent: m.slice(m.indexOf(":") + 1) }, slug: m.slice(0, m.indexOf(":")) };
  const plan = q.get("plan");
  if (plan) return { ref: { kind: "plan" }, slug: plan };
  const add = q.get("add");
  if (add) return { ref: { kind: "sumar" }, slug: add };
  return null;
}

export function fichaParam(ref: FichaRef): string {
  switch (ref.kind) {
    case "tab":
      return `tab:${ref.tab}`;
    case "idea":
      return `idea:${ref.key}${ref.from ? `~${ref.from}` : ""}`;
    case "step":
    case "leg":
    case "pedido":
      return `${ref.kind}:${ref.key}`;
    case "member":
      return `member:${ref.agent}`;
    case "pr":
      return `pr:${ref.n}`;
    case "doc":
      return `doc:${ref.id}`;
    case "lienzo":
      return `lienzo:${ref.url}`;
    case "maq":
      return `maq:${ref.what}`;
    case "maq-tabla":
      return `maq:tabla:${ref.name}`;
    default:
      return ref.kind;
  }
}

// The address for a floor and what its ficha shows. PLA-I48: the level (?nivel=maquinas) stays.
export function fichaSearch(slug: string | null, ref: FichaRef | null, nivel?: "trabajo" | "maquinas"): string {
  const q = new URLSearchParams();
  if (slug) q.set("piso", slug);
  if (nivel === "maquinas") q.set("nivel", "maquinas");
  // PLA-I55-1: Resumen is named too; an address with no ?f= is the ventanal's home tab (Te toca / Ahora).
  if (ref) q.set("f", fichaParam(ref));
  const s = q.toString();
  return s ? `?${s}` : "";
}

// The tab a detail sits under, so «Volver» lands where it came from.
export function tabOf(ref: FichaRef): FichaTab {
  if (ref.kind === "tab") return ref.tab;
  if (ref.kind === "idea") return ref.from ?? "ideas";
  if (ref.kind === "pedido" || ref.kind === "guardadas") return "pedido";
  if (ref.kind === "lienzo") return "diseno";
  if (ref.kind === "pr") return "prs";
  if (ref.kind === "doc") return "docs";
  return "resumen";
}

// Esc: a detail goes back to its tab; a tab closes the ficha (PLA-I55-1: back to the ventanal's home tab).
export function escStep(ref: FichaRef): FichaRef | "close" {
  return ref.kind === "tab" ? "close" : { kind: "tab", tab: tabOf(ref) };
}

// Which reads a view needs: the ficha rows only for the four list tabs and their details (never for Resumen).
export const needsRows = (ref: FichaRef) => ref.kind === "idea" || ref.kind === "pr" || ref.kind === "lienzo" || ref.kind === "doc" || (ref.kind === "tab" && ref.tab !== "resumen" && ref.tab !== "pedido" && ref.tab !== "motores");
export const isMaq = (ref: FichaRef) => ref.kind === "maq" || ref.kind === "maq-tabla";
export const needsTask = (ref: FichaRef): string | null => (ref.kind === "step" ? ref.key : null);
// PLA-I61: an idea and an owner's request both open La idea abierta (GET …/ideas/:key).
export const needsIdea = (ref: FichaRef): string | null => (ref.kind === "idea" || ref.kind === "pedido" ? ref.key : null);

// PLA-148 (F-3): the stops that only ask for a look. Entendido, Investigación, Diseño and the plan go on by themselves
// when the owner says nothing (the PO's reading, the recommended option, the frames as drawn), so their bar reads
// «Para revisar», not «Te toca»: Todo counts nothing there. «Te toca» is kept for what waits on him (a PO's question,
// «Constrúyelo», a step to accept, closing an initiative).
export const SOFT_REVIEW_STOPS = ["entendido", "investigacion", "diseno", "plan"] as const;
export type StopBar = "review" | "you";
export const stopBar = (stop: string): StopBar => ((SOFT_REVIEW_STOPS as readonly string[]).includes(stop) ? "review" : "you");
