// PLA-I71-1: Equipo as the project's org chart (PLA-IDEA34, board Main). Pure: the tree from reports_to, the order
// the arrow keys walk, the status dot, the card's tags and where each card sits. The owner is the root; the PO (or
// any seat that reports to the company's seat, or to nobody) hangs from the owner; a seat that reports to a teammate
// hangs from it; a seat whose manager is not on the team (retired, another project's, or a loop) is listed apart
// with a warning instead of disappearing.
import type { OrgMember } from "./api";

export type OrgNode = { m: OrgMember; children: OrgNode[]; depth: number; parent: string | null };
export type OrgTree = { top: OrgNode[]; loose: OrgNode[] };

const ORDER = ["product-owner", "research", "artist", "taller", "qa"];
const rank = (m: OrgMember) => {
  const i = ORDER.indexOf(m.template ?? m.role);
  return i < 0 ? ORDER.length : i;
};
const byRank = (a: OrgMember, b: OrgMember) => rank(a) - rank(b) || a.agent.localeCompare(b.agent);

/** Company seats a project's PO reports to: they are not on the team and are drawn as the owner. */
export const COMPANY_SEATS = new Set(["ceo", "asistente"]);

export function treeOf(team: OrgMember[]): OrgTree {
  const on = new Map(team.map((m) => [m.agent, m]));
  const kids = new Map<string, OrgMember[]>();
  const top: OrgMember[] = [];
  const loose: OrgMember[] = [];
  for (const m of [...team].sort(byRank)) {
    const boss = m.reports_to ?? null;
    if (boss && boss !== m.agent && on.has(boss)) kids.set(boss, [...(kids.get(boss) ?? []), m]);
    else if (!boss || COMPANY_SEATS.has(boss)) top.push(m);
    else loose.push(m);
  }
  const seen = new Set<string>();
  const build = (m: OrgMember, depth: number, parent: string | null): OrgNode => {
    seen.add(m.agent);
    return { m, depth, parent, children: (kids.get(m.agent) ?? []).filter((c) => !seen.has(c.agent)).map((c) => build(c, depth + 1, m.agent)) };
  };
  const topNodes = top.map((m) => build(m, 1, null));
  // A loop (a reports to b, b to a) never reaches the owner: those seats are loose too.
  for (const m of [...team].sort(byRank)) if (!seen.has(m.agent) && !loose.includes(m)) loose.push(m);
  return { top: topNodes, loose: loose.map((m) => ({ m, depth: 1, parent: null, children: [] })) };
}

/** Depth first, the order Arriba/Abajo walk and Inicio/Fin jump to (the owner's card is not a control). */
export function walkOrder(t: OrgTree): string[] {
  const out: string[] = [];
  const go = (n: OrgNode) => {
    out.push(n.m.agent);
    n.children.forEach(go);
  };
  t.top.forEach(go);
  t.loose.forEach(go);
  return out;
}

const find = (t: OrgTree, agent: string): OrgNode | null => {
  let hit: OrgNode | null = null;
  const go = (n: OrgNode) => {
    if (n.m.agent === agent) hit = n;
    n.children.forEach(go);
  };
  [...t.top, ...t.loose].forEach(go);
  return hit;
};

/** Where a key moves the focus from `at`: ↑/↓ the previous or next card, ← its manager, → its first report,
 *  Inicio/Fin the first and last card. Null: the key is not the chart's. */
export function moveFrom(t: OrgTree, at: string, key: string): string | null {
  const order = walkOrder(t);
  if (!order.length) return null;
  const i = Math.max(0, order.indexOf(at));
  if (key === "Home") return order[0]!;
  if (key === "End") return order[order.length - 1]!;
  if (key === "ArrowDown") return order[Math.min(order.length - 1, i + 1)]!;
  if (key === "ArrowUp") return order[Math.max(0, i - 1)]!;
  const n = find(t, at);
  if (!n) return null;
  if (key === "ArrowRight") return n.children[0]?.m.agent ?? at;
  if (key === "ArrowLeft") return n.parent ?? at;
  return null;
}

export type Dot = "vivo" | "espera" | "libre" | "pausa";
/** The one sign of work the chart keeps. */
export function dotOf(m: OrgMember, paused: boolean): Dot {
  if (m.state === "running") return "vivo";
  if (paused || m.state === "paused" || m.paused_at) return "pausa";
  if (m.state === "waiting_owner") return "espera";
  return "libre";
}

// ---- layout (desktop): absolute cards over one SVG of right-angle lines. Phone width uses the nested list as is.
export const CARD = { w: 216, h: 84, gapX: 16, gapY: 40, ownerH: 60, stackGap: 12, indent: 24 };
/** Short of height (1280x720 with eight seats): cards without their tags row, closer together. */
export const COMPACT = { w: 216, h: 58, gapX: 16, gapY: 28, ownerH: 48, stackGap: 10, indent: 24 };
export type Sizes = typeof CARD;
export type Box = { id: string; x: number; y: number; w: number; h: number };
export type Line = { d: string; dashed?: boolean };
export type Layout = { boxes: Map<string, Box>; lines: Line[]; height: number; width: number; compact: boolean };

/** The full cards when they fit in maxH, else the compact ones. */
export function layoutOf(t: OrgTree, width: number, opts: { ghost?: boolean; maxH?: number } = {}): Layout {
  const full = placeOf(t, width, CARD, opts.ghost ?? true);
  if (!opts.maxH || full.height <= opts.maxH) return full;
  return { ...placeOf(t, width, COMPACT, opts.ghost ?? true), compact: true };
}

/** Places the owner, the company ghost, the first level (wrapped into rows when it does not fit, with a spine on the
 *  left that joins the rows) and each first-level card's reports as a stack under it (and theirs, indented). Loose
 *  seats go on a last row with no line. */
function placeOf(t: OrgTree, width: number, z: Sizes, ghost: boolean): Layout {
  const { w, h, gapX, gapY, ownerH, stackGap, indent } = z;
  const boxes = new Map<string, Box>();
  const lines: Line[] = [];
  const cx = width / 2;
  const owner: Box = { id: "__owner", x: cx - w / 2, y: 0, w, h: ownerH };
  boxes.set(owner.id, owner);
  if (ghost && width >= 2 * w + 3 * gapX + w / 2) {
    const g: Box = { id: "__ghost", x: owner.x + w + 3 * gapX, y: 0, w: Math.min(w, width - (owner.x + w + 3 * gapX)), h: ownerH };
    boxes.set(g.id, g);
    lines.push({ d: `M${owner.x + w} ${ownerH / 2}H${g.x}`, dashed: true });
  }
  // A PO alone at the first level sits under the owner, and its reports form the wrapped level below.
  const single = t.top.length === 1 ? t.top[0]! : null;
  let y = ownerH + gapY;
  let from = { x: cx, y: ownerH };
  if (single) {
    const b: Box = { id: single.m.agent, x: cx - w / 2, y, w, h };
    boxes.set(b.id, b);
    lines.push({ d: `M${cx} ${ownerH}V${y}` });
    from = { x: cx, y: y + h };
    y += h + gapY;
  }
  const level = single ? single.children : t.top;
  // One row when it fits at 160 px or more a card; else rows (at most as many as needed), leaving room on the left
  // for the spine that joins them.
  const fit = (room: number, cw: number) => Math.max(1, Math.floor((room + gapX) / (cw + gapX)));
  const oneRow = level.length <= fit(width, 160);
  const room = oneRow ? width : width - 2 * gapX;
  const want = oneRow ? level.length : Math.max(fit(room, w), Math.ceil(level.length / 2));
  const lw = Math.max(160, Math.min(w, Math.floor((room + gapX) / Math.max(1, want)) - gapX));
  const cols = Math.max(1, Math.min(level.length, fit(room, lw)));
  const firstW = Math.min(level.length, cols) * lw + (Math.min(level.length, cols) - 1) * gapX;
  // PLA-139: halfway between the first card and the edge, so the line that joins the rows is drawn whole (at x 0 half
  // its stroke fell outside the drawing and the rows looked unjoined).
  const spine = cx - firstW / 2 - gapX / 2;
  const stackH = (n: OrgNode): number => n.children.reduce((s, c) => s + stackGap + h + stackH(c), 0);
  let rowTop = y;
  let lastBus = 0;
  for (let r = 0; r * cols < level.length; r++) {
    const row = level.slice(r * cols, r * cols + cols);
    const rowW = row.length * lw + (row.length - 1) * gapX;
    const x0 = cx - rowW / 2;
    const bus = rowTop - gapY / 2;
    const xs = row.map((_, i) => x0 + i * (lw + gapX) + lw / 2);
    const many = level.length > cols;
    if (r === 0) lines.push({ d: `M${from.x} ${from.y}V${bus}` });
    else lines.push({ d: `M${spine} ${lastBus}V${bus}` });
    const left = many ? spine : Math.min(xs[0]!, from.x);
    lines.push({ d: `M${left} ${bus}H${Math.max(xs[xs.length - 1]!, r === 0 ? from.x : left)}` });
    lastBus = bus;
    let tallest = h;
    row.forEach((n, i) => {
      const b: Box = { id: n.m.agent, x: x0 + i * (lw + gapX), y: rowTop, w: lw, h };
      boxes.set(b.id, b);
      lines.push({ d: `M${xs[i]} ${bus}V${rowTop}` });
      // Its reports: a stack under the card, each one indented, joined by an elbow from the card's left side.
      const stack = (parent: Box, list: OrgNode[], top: number): number => {
        let yy = top;
        for (const c of list) {
          yy += stackGap;
          const cb: Box = { id: c.m.agent, x: parent.x + indent, y: yy, w: parent.w - indent, h };
          boxes.set(cb.id, cb);
          lines.push({ d: `M${parent.x + indent / 2} ${parent.y + parent.h}V${yy + h / 2}H${cb.x}` });
          yy += h;
          yy = stack(cb, c.children, yy);
        }
        return yy;
      };
      const end = stack(b, n.children, rowTop + h);
      tallest = Math.max(tallest, end - rowTop, h + stackH(n));
    });
    rowTop += tallest + gapY;
  }
  if (t.loose.length) {
    const lwl = Math.max(160, Math.min(w, Math.floor((width + gapX) / t.loose.length) - gapX));
    const rowW = t.loose.length * lwl + (t.loose.length - 1) * gapX;
    t.loose.forEach((n, i) => boxes.set(n.m.agent, { id: n.m.agent, x: Math.max(0, cx - rowW / 2) + i * (lwl + gapX), y: rowTop, w: lwl, h }));
  }
  const height = Math.max(...[...boxes.values()].map((b) => b.y + b.h));
  return { boxes, lines, height, width, compact: false };
}

/** Below this width the chart is the nested list itself (the phone). */
export const LIST_BELOW = 640;
