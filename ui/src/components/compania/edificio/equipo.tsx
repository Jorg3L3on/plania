// PLA-I58-1 (El timbre, idea PLA-IDEA23): the team leaves the index. In the floor's Encabezado sits a doorbell plate
// with one small window per teammate (dark while free, lit while working, orange while asking) and one line («1
// trabaja»). A click on the plate, or the E key, drops La sala under the head: a big window per teammate with its role,
// its state word and its line; a click opens that teammate in the ventanal, as the index did. Sumar is the last window.
// Esc, a click outside or E again closes it. While it is closed, a question still shows: «PO te pregunta» beside the
// plate opens the teammate who asks.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { OrgMember } from "@/lib/api";
import { roleName } from "@/lib/org";
import { Figure } from "./figure";
import type { SeatView } from "./indice";

const one = (n: number, a: string, b: string) => `${n} ${n === 1 ? a : b}`;

// The plate's line: who works and who asks, else «nadie trabaja».
export function teamLine(states: string[]): string {
  const working = states.filter((s) => s === "work" || s === "back").length;
  const asking = states.filter((s) => s === "ask").length;
  return [working ? one(working, "trabaja", "trabajan") : null, asking ? one(asking, "te pregunta", "te preguntan") : null].filter(Boolean).join(" · ") || "nadie trabaja";
}

// The word on a teammate's window in La sala.
const WORD: Record<string, string> = { work: "Trabaja", ask: "Te pregunta", back: "Arreglando", ghost: "Recibiría", off: "En pausa" };
export const stateWord = (state: string) => WORD[state] ?? "Libre";

// The E key must not fire while the owner types (Pedir, a reply, any field).
const typingIn = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
};

export const Timbre = ({
  title,
  team,
  seat,
  onMember,
  children,
  defaultOpen = false,
}: {
  title: string;
  team: OrgMember[];
  seat: (m: OrgMember) => SeatView;
  onMember?: (m: OrgMember, el: HTMLElement) => void;
  // The «+ Sumar» window, last in La sala.
  children?: ReactNode;
  // Tests render La sala open.
  defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const root = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLButtonElement>(null);
  const sala = useRef<HTMLElement>(null);
  const salaId = useId();
  const seats = team.map((m) => ({ m, v: seat(m) }));
  const line = teamLine(seats.map((x) => x.v.state));
  const asker = seats.find((x) => x.v.state === "ask");

  // E opens and closes La sala (the page uses M, I and 1-6; E is free).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "e" && e.key !== "E") || e.metaKey || e.ctrlKey || e.altKey || typingIn(e.target)) return;
      // Only the floor on screen answers (a hidden floor has no layout boxes).
      if (!root.current || root.current.getClientRects().length === 0) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // While open, Esc closes La sala only (caught first, as Tablero does, so the page does not also step out of the
  // floor or close La ficha), and a click outside closes it.
  useEffect(() => {
    if (!open) return;
    // On a small screen La sala can start low: bring it into view.
    sala.current?.scrollIntoView?.({ block: "nearest" });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
      plate.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div className="edi-timbre" ref={root} data-open={open ? "1" : "0"}>
      {asker && !open && (
        <button type="button" className="edi-timbre-ask" onClick={(e) => onMember?.(asker.m, e.currentTarget)} disabled={!onMember} data-control="timbre-pregunta" title={asker.v.line}>
          <i aria-hidden />
          {roleName(asker.m.role)} te pregunta
        </button>
      )}
      <button
        ref={plate}
        type="button"
        className="edi-timbre-plate"
        aria-expanded={open}
        aria-controls={salaId}
        aria-label={`Equipo de ${title}: ${line}. Tecla E`}
        title="Equipo (E)"
        onClick={() => setOpen((o) => !o)}
        data-control="timbre"
      >
        <span className="edi-timbre-wins" aria-hidden>
          {seats.map(({ m, v }) => (
            <i key={m.agent} data-state={v.state} />
          ))}
        </span>
        <span className="edi-timbre-lbl">
          <b>Equipo</b>
          <small>{line}</small>
        </span>
        <kbd aria-hidden>E</kbd>
      </button>
      <section ref={sala} id={salaId} className="dark edi-sala" aria-label={`Equipo de ${title}`} hidden={!open}>
        <div className="edi-sala-head">
          <h3>Equipo de {title}</h3>
          <small>{line}</small>
          <button type="button" className="edi-sala-x" onClick={() => setOpen(false)} data-control="sala-cerrar">
            <kbd aria-hidden>Esc</kbd> Cerrar
          </button>
        </div>
        <div className="edi-sala-mates" data-team={team.length}>
          {seats.map(({ m, v }) => (
            <button
              key={m.agent}
              type="button"
              className="edi-sala-mate"
              {...v.data}
              aria-label={v.label}
              onClick={(e) => {
                setOpen(false);
                onMember?.(m, e.currentTarget);
              }}
              disabled={!onMember}
              title={`${roleName(m.role)}: ${v.line}`}
              data-control="sala-equipo"
            >
              <span className="edi-seat" data-state={v.state} aria-hidden>
                <span className="edi-seat-glass">
                  <Figure role={m.role} />
                </span>
              </span>
              <span className="edi-sala-role">
                <b>{roleName(m.role)}</b>
                <span className="edi-sala-st" data-state={v.state}>
                  {stateWord(v.state)}
                </span>
              </span>
              <small>{v.line}</small>
            </button>
          ))}
          {children}
        </div>
      </section>
    </div>
  );
};
