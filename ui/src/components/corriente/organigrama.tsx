// PLA-I71-1: the project's org chart (PLA-IDEA34 board Main). One nested list in the DOM (the owner, the PO, the
// seats under whoever they report to), so a screen reader hears the hierarchy and the arrow keys walk it; on a wide
// screen the same list items are placed as compact cards over one SVG of right-angle lines (lib/organigrama.ts), and
// below 640 px the list shows as it is, indented. Of the work only the status dot stays.
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { OrgMember } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import { words } from "@/lib/i18n";
import { motorLine } from "@/lib/motores";
import { LIST_BELOW, dotOf, layoutOf, moveFrom, treeOf, walkOrder, type Dot, type OrgNode } from "@/lib/organigrama";
import { ORGANIGRAMA_WORDS } from "@/lib/organigrama-words";
import { ROLE_LINE } from "./equipo-roles";
import { SUMAR_PAGE_WORDS } from "@/lib/sumar-page-words";

const DotMark = ({ d }: { d: Dot }) => <i className={`org-dot ${d}`} aria-hidden />;

function tagsOf(m: OrgMember) {
  const w = words(ORGANIGRAMA_WORDS);
  const tags: { t: string; tone?: "vi" | "am" | "motor"; title?: string }[] = [];
  // Skills and lessons first and whole; the motor's model last: a tag that does not fit drops out whole (the panel has
  // everything), never cut in half.
  tags.push({ t: w.skills(m.skills_on ?? 0), tone: "vi" });
  const waiting = m.lessons?.proposed ?? 0;
  if (waiting) tags.push({ t: waiting === 1 ? w.lessonWaits : w.lessonsWait(waiting), tone: "am" });
  else tags.push({ t: w.lessons(m.lessons?.active ?? 0) });
  if (m.motor && (m.motor.model || m.motor.effort)) {
    const full = motorLine(m.motor.model, m.motor.effort);
    tags.push({ t: full.split(" · ")[0]!, tone: "motor", title: full });
  }
  return tags;
}

/** The words a card is read with: seat, its line, its state. */
export const cardLine = (m: OrgMember) => ROLE_LINE[m.template ?? m.role] ?? m.name ?? "";

/** PLA-I71-6: a chart drawn for a preview (adopting a team) names each card's fate and colours the arrivals. */
export type CardLook = { line: (m: OrgMember) => string | null; tone: (m: OrgMember) => string | null };

const Card = ({ m, paused, selected, focusable, loose, onPick, style, look }: { m: OrgMember; paused: boolean; selected: boolean; focusable: boolean; loose?: boolean; onPick: (agent: string) => void; style?: React.CSSProperties; look?: CardLook }) => {
  const w = words(ORGANIGRAMA_WORDS);
  const proposal = m.agent.startsWith("propuesta:");
  const d = proposal ? "espera" : dotOf(m, paused);
  const name = m.puesto ?? (proposal && seatName(m.role) === m.role ? (m.name ?? m.role) : seatName(m.role));
  const line = look?.line(m) ?? (proposal ? words(SUMAR_PAGE_WORDS).proposalLine : cardLine(m));
  const tone = look?.tone(m) ?? "";
  return (
    <button
      type="button"
      className={`org-card ${selected ? "sel" : ""} ${loose ? "loose" : ""} ${proposal ? "proposal" : ""} ${tone} ${d}`}
      style={style}
      aria-pressed={selected}
      tabIndex={focusable ? 0 : -1}
      data-org={m.agent}
      title={m.name && m.name !== name ? `${name} · ${m.name}` : undefined}
      onClick={() => onPick(m.agent)}
    >
      <span className="org-card-top">
        <span className="org-glyph" aria-hidden>
          {name.slice(0, 2)}
        </span>
        <span className="org-who">
          <b>{name}</b>
          <span className="org-line">{loose ? w.noBoss : line}</span>
        </span>
        <DotMark d={d} />
        <span className="sr-only">{w.dot[d]}</span>
      </span>
      <span className="org-tags">
        {(proposal || look ? [] : tagsOf(m)).map((t) => (
          <span key={t.t} className={`org-tag ${t.tone ?? ""}`} title={t.title}>
            {t.t}
          </span>
        ))}
      </span>
    </button>
  );
};

/** The chart's width, and the height left under its top on the screen (the chart fits one screen at 100%). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number, number] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, room: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, room: Math.max(0, window.innerHeight - el.getBoundingClientRect().top - 20) });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    window.addEventListener("resize", read);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", read);
    };
  }, []);
  return [ref, size.w, size.room];
}

export const Organigrama = ({ team, project, paused, selected, onPick, look }: { team: OrgMember[]; project: string; paused: boolean; selected: string | null; onPick: (agent: string) => void; look?: CardLook }) => {
  const w = words(ORGANIGRAMA_WORDS);
  const tree = useMemo(() => treeOf(team), [team]);
  const order = useMemo(() => walkOrder(tree), [tree]);
  const [box, width, room] = useWidth<HTMLDivElement>();
  // The server render and the first paint have no width: the list shows until it is measured.
  const wide = width >= LIST_BELOW;
  const lay = useMemo(() => (wide ? layoutOf(tree, width, { maxH: room }) : null), [tree, width, wide, room]);
  const [focus, setFocus] = useState<string | null>(null);
  const tabbable = (focus && order.includes(focus) ? focus : null) ?? (selected && order.includes(selected) ? selected : order[0]);
  const at = (id: string): React.CSSProperties | undefined => {
    const b = lay?.boxes.get(id);
    return b ? { position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h } : undefined;
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = (e.target as HTMLElement).closest<HTMLElement>("[data-org]")?.dataset.org;
    if (!from) return;
    const to = moveFrom(tree, from, e.key);
    if (!to) return;
    e.preventDefault();
    // The page's ↑/↓ change project: inside the chart they move between cards only.
    e.stopPropagation();
    setFocus(to);
    box.current?.querySelector<HTMLElement>(`[data-org="${CSS.escape(to)}"]`)?.focus();
  };
  const node = (n: OrgNode) => (
    <li key={n.m.agent} className="org-li">
      <Card m={n.m} paused={paused} selected={selected === n.m.agent} focusable={tabbable === n.m.agent} onPick={onPick} style={at(n.m.agent)} look={look} />
      {n.children.length > 0 && <ul className="org-ul">{n.children.map(node)}</ul>}
    </li>
  );
  return (
    <div ref={box} className={`org ${wide ? "wide" : "list"} ${lay?.compact ? "compact" : ""}`} style={lay ? { height: lay.height } : undefined} onKeyDown={onKey} data-organigrama={team.length}>
      {lay && (
        <svg className="org-lines" width={lay.width} height={lay.height} aria-hidden>
          {lay.lines.map((l, i) => (
            <path key={i} d={l.d} className={l.dashed ? "dashed" : undefined} />
          ))}
        </svg>
      )}
      <ul className="org-ul org-root" aria-label={w.chartOf(project)}>
        <li className="org-li">
          <div className="org-card owner" style={at("__owner")}>
            <span className="org-card-top">
              <span className="org-glyph you" aria-hidden>
                {w.you.slice(0, 1)}
              </span>
              <span className="org-who">
                <b>{w.you}</b>
                <span className="org-line">{w.youLine}</span>
              </span>
            </span>
          </div>
          {tree.top.length > 0 && <ul className="org-ul">{tree.top.map(node)}</ul>}
        </li>
      </ul>
      {lay?.boxes.get("__ghost") && (
        <div className="org-card ghost" style={at("__ghost")} data-ghost>
          <span className="org-card-top">
            <span className="org-who">
              <b>{w.asistente}</b>
              <span className="org-line">{w.asistenteLine}</span>
            </span>
          </span>
        </div>
      )}
      {tree.loose.length > 0 && (
        <ul className="org-ul org-loose" aria-label={w.noBoss}>
          {tree.loose.map((n) => (
            <li key={n.m.agent} className="org-li">
              <Card m={n.m} paused={paused} selected={selected === n.m.agent} focusable={tabbable === n.m.agent} loose onPick={onPick} style={at(n.m.agent)} />
            </li>
          ))}
        </ul>
      )}
      <p className="sr-only">{w.keysHint}</p>
    </div>
  );
};

export const Legend = () => {
  const w = words(ORGANIGRAMA_WORDS);
  return (
    <span className="org-legend cor-cap">
      <span>
        <DotMark d="vivo" /> {w.legendLive}
      </span>
      <span>
        <DotMark d="espera" /> {w.legendWaits}
      </span>
      <span>
        <DotMark d="libre" /> {w.legendFree}
      </span>
      {/* PLA-139: new and adopted seats arrive paused; the legend says what their mark means. */}
      <span>
        <DotMark d="pausa" /> {w.legendPaused}
      </span>
    </span>
  );
};
