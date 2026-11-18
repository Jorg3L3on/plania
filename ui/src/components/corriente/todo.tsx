// PLA-I64 (PLA-IDEA28, boards A1-A4): a project from the inside, one screen. Every thing of the project in one list
// (lib/cosas.ts), one row each: its name, its thread small and what it needs, grouped by what it needs (Te toca, Se
// mueve, En fila, Quieto, Hecho), always in that order. An empty group is one line; a long group folds («Ver las
// otras N»). A row opens today's view of the thing (the idea, the initiative, the step) and comes back here.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { Decision, OrgProject } from "@/lib/api";
import { GRUPO_NAME, TIPO_NAME, cosasOf, type Cosa, type Cosas, type Grupo, type Hecha } from "@/lib/cosas";
import { Hilo, HiloHead } from "./hilo";
import { useFicha } from "./listas";
import { Label, ReadError } from "./parts";

export type TodoLinks = {
  /** Where a row opens (today's view of the thing). */
  open: (c: Cosa) => string;
  hecha: (key: string) => string;
  /** Everything done (the Hecho door). */
  hecho: string;
};

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/** How many rows each group shows before it folds. The list measures its own height (ResizeObserver) and spends
 *  it in group order: a Te toca row costs more than a quiet one, a row in line or done costs least. Te toca always
 *  shows its first row; Hecho shows up to two rows while room is left. Measured at 1440×800 (PLA-I64-2). */
export const ROW_PX = { toca: 84, mueve: 62, fila: 52, quieto: 62, hecho: 46 } as const;
export const LINE_PX = 30;
export const FOLD = { perGroup: 3, hecho: 2, fallback: 420 } as const;
export function foldOf(c: Cosas, open: ReadonlySet<Grupo>, height: number = FOLD.fallback): Record<Grupo, number> {
  // Fixed lines: the column header, one line per group shown (empty groups share the next one), Hecho's line.
  const lines = 1 + c.grupos.filter((g) => g.cosas.length > 0).length + 1;
  let left = height - lines * LINE_PX;
  const out = {} as Record<Grupo, number>;
  for (const g of c.grupos) {
    const n = g.cosas.length;
    let show = 0;
    if (open.has(g.grupo)) show = n;
    else
      while (show < Math.min(n, g.grupo === "toca" ? n : FOLD.perGroup) && (left >= ROW_PX[g.grupo] || (g.grupo === "toca" && show === 0))) {
        show++;
        left -= ROW_PX[g.grupo];
      }
    if (open.has(g.grupo)) left -= n * ROW_PX[g.grupo];
    out[g.grupo] = show;
  }
  const h = c.hecho.iniciativas.length;
  out.hecho = open.has("hecho") ? h : Math.min(h, FOLD.hecho, Math.max(0, Math.floor(left / ROW_PX.hecho)));
  return out;
}

/** The words beside a group's name when it shows no rows (empty, or folded whole). */
export function groupLine(g: Exclude<Grupo, "hecho">, n: number, paused: boolean): string {
  if (n === 0) return { toca: "Nada te espera.", mueve: "Nadie trabaja ahora.", fila: "Nada espera turno.", quieto: "Nada está quieto." }[g];
  if (g === "toca") return n === 1 ? "una cosa te espera" : `${n} cosas te esperan`;
  if (g === "mueve") return n === 1 ? "alguien trabaja ahora" : "trabajan ahora";
  if (g === "fila") return paused ? "en pausa: arrancan solas cuando reanudes" : "arrancan solas o están en revisión; no te necesitan";
  return "no se mueven solas; cada una dice qué espera";
}

const Row = ({ c, links, act }: { c: Cosa; links: TodoLinks; act?: ReactNode }) => {
  const toca = c.grupo === "toca";
  return (
    <li className={cls("cor-cosa", toca && "you", c.grupo === "mueve" && "liv")} data-cosa={c.key} data-grupo={c.grupo}>
      <Link to={links.open(c)} className="cor-cosa-nm" data-control="abrir-cosa">
        <span className="cor-cosa-ids">
          <Label tone={toca ? "amber" : undefined}>{TIPO_NAME[c.tipo]}</Label>
          {c.tipo !== "publicar" && c.tipo !== "decision" && <span className="cor-key">{c.key}</span>}
        </span>
        <b className="cor-ellipsis">{c.title}</b>
      </Link>
      <Hilo h={c.hilo} />
      <div className="cor-cosa-que">
        <span className="cor-cosa-tx">
          <span className={cls("cor-label", toca && "amber")}>{c.cap}</span>
          <span className="cor-cosa-espera">{c.espera}</span>
        </span>
        {act}
      </div>
    </li>
  );
};

const dayOf = (iso: string | null, timeZone?: string) => (iso ? new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone }).format(new Date(iso)).replace(".", "").toUpperCase() : "");

const HechaRow = ({ h, links, timeZone }: { h: Hecha; links: TodoLinks; timeZone?: string }) => (
  <li className="cor-cosa sm" data-hecha={h.key}>
    <Link to={links.hecha(h.key)} className="cor-cosa-nm row">
      <span className="cor-key">{h.key}</span>
      <b className="cor-ellipsis">{h.title}</b>
    </Link>
    <Hilo h={{ idea: h.idea_key ? 5 : null, ideaTono: h.idea_key ? "hecho" : null, valvula: "abierta", tramos: [{ key: h.key, title: h.title, etapa: "hecho", tono: "hecho" }], publicado: true, at: "publicado" }} small />
    <div className="cor-cosa-que">
      <span className="cor-cap">{["Hecho", dayOf(h.done_at, timeZone), h.idea_key ? `Era ${h.idea_key}` : null].filter(Boolean).join(" · ").toUpperCase()}</span>
    </div>
  </li>
);

export const TodoList = ({
  p,
  cosas,
  links,
  timeZone,
  companyPaused,
  actOf,
}: {
  p: OrgProject;
  cosas: Cosas;
  links: TodoLinks;
  timeZone?: string;
  companyPaused: boolean;
  actOf?: (c: Cosa) => ReactNode;
}) => {
  const [open, setOpen] = useState<Set<Grupo>>(new Set());
  const paused = companyPaused || p.paused;
  // The room the list has (its scroll box), read on every resize.
  const ref = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const box = ref.current?.closest(".cor-todo-scroll") as HTMLElement | null;
    if (!box || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const above = ref.current ? ref.current.offsetTop - box.offsetTop : 0;
      setRoom(box.clientHeight - above - 8);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  const shown = foldOf(cosas, open, room);
  const toggle = (g: Grupo) => setOpen((s) => (s.has(g) ? new Set([...s].filter((x) => x !== g)) : new Set([...s, g])));
  // Empty groups share the line of the group after them (or one line of their own at the end).
  const blocks: ({ kind: "empty"; grupos: Exclude<Grupo, "hecho">[] } | { kind: "group"; i: number; lead: Exclude<Grupo, "hecho">[] })[] = [];
  let pend: Exclude<Grupo, "hecho">[] = [];
  cosas.grupos.forEach((g, i) => {
    if (g.cosas.length === 0) pend.push(g.grupo);
    else {
      blocks.push({ kind: "group", i, lead: pend });
      pend = [];
    }
  });
  if (pend.length) blocks.push({ kind: "empty", grupos: pend });
  const hecho = cosas.hecho;
  const hechoRows = hecho.iniciativas.slice(0, shown.hecho);
  return (
    <div className="cor-todo-list" ref={ref} data-todo={p.slug} data-abiertas={cosas.abiertas}>
      <div className="cor-cosa-head" aria-hidden>
        <span className="cor-label">Cada cosa</span>
        <HiloHead />
        <span className="cor-label">Qué toca</span>
      </div>
      {blocks.map((b) => {
        if (b.kind === "empty")
          return (
            <div key={b.grupos.join("-")} className="cor-grp" data-grupo-vacio={b.grupos.join(" ")}>
              {b.grupos.map((g) => (
                <h2 key={g} className="cor-label">{`${GRUPO_NAME[g]} · 0`}</h2>
              ))}
              <span className="cor-grp-tx">{b.grupos.length > 1 ? b.grupos.map((g) => groupLine(g, 0, paused)).join(" ") : groupLine(b.grupos[0]!, 0, paused)}</span>
            </div>
          );
        const g = cosas.grupos[b.i]!;
        const n = g.cosas.length;
        const k = shown[g.grupo];
        const more = n - k;
        return (
          <section key={g.grupo} aria-label={GRUPO_NAME[g.grupo]} data-grupo={g.grupo}>
            <div className="cor-grp">
              {b.lead.map((e) => (
                <span key={e} className="cor-label" data-grupo-vacio={e}>{`${GRUPO_NAME[e]} · 0`}</span>
              ))}
              <h2 className={cls("cor-label", g.grupo === "toca" && "amber")}>{`${GRUPO_NAME[g.grupo]} · ${n}`}</h2>
              {g.grupo !== "toca" && <span className="cor-grp-tx">{groupLine(g.grupo, n, paused)}</span>}
              {(more > 0 || open.has(g.grupo)) && (
                <button type="button" className="cor-btn link cor-grp-more" aria-expanded={open.has(g.grupo)} onClick={() => toggle(g.grupo)} data-control={`ver-${g.grupo}`}>
                  {open.has(g.grupo) ? "Ver menos" : k === 0 ? (n === 1 ? "Verla" : `Ver las ${n}`) : more === 1 ? "Ver la otra" : `Ver las otras ${more}`}
                </button>
              )}
            </div>
            {k > 0 && (
              <ul>
                {g.cosas.slice(0, k).map((c) => (
                  <Row key={c.key} c={c} links={links} act={actOf?.(c)} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
      <section aria-label="Hecho" data-grupo="hecho">
        <div className="cor-grp">
          <h2 className="cor-label green">{["Hecho", hecho.iniciativas.length ? `${hecho.iniciativas.length} ${hecho.iniciativas.length === 1 ? "iniciativa" : "iniciativas"}` : null, hecho.sueltos ? `${hecho.sueltos} ${hecho.sueltos === 1 ? "paso suelto" : "pasos sueltos"}` : null].filter(Boolean).join(" · ") || "Hecho · 0"}</h2>
          {!hecho.iniciativas.length && !hecho.sueltos && <span className="cor-grp-tx">Todavía nada.</span>}
          <Link className="cor-btn link cor-grp-more" to={links.hecho} data-control="ver-hecho">
            Ver todo lo hecho
          </Link>
        </div>
        {hechoRows.length > 0 && (
          <ul>
            {hechoRows.map((h) => (
              <HechaRow key={h.key} h={h} links={links} timeZone={timeZone} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

/** The list with its reads: the company's project (already loaded) and the ficha (ideas, promoted map). */
export const Todo = ({
  p,
  decisions,
  links,
  timeZone,
  companyPaused,
  actOf,
  top,
  bottom,
}: {
  p: OrgProject;
  decisions: Decision[];
  links: TodoLinks;
  timeZone?: string;
  companyPaused: boolean;
  actOf?: (c: Cosa, cosas: Cosas) => ReactNode;
  top?: (cosas: Cosas) => ReactNode;
  bottom?: ReactNode;
}) => {
  const f = useFicha(p.slug);
  const cosas = cosasOf({ p, decisions, ficha: f.data ?? null, companyPaused });
  return (
    <div className="cor-todo" data-todo-screen={p.slug}>
      <div className="cor-todo-scroll">
        {top?.(cosas)}
        {f.isError && !f.data ? (
          <div className="cor-todo-err">
            <ReadError what="las ideas del proyecto" onRetry={() => void f.refetch()} />
          </div>
        ) : null}
        {f.isLoading ? <div className="cor-skel" role="status" style={{ height: 320, margin: "8px 0" }} aria-busy="true" aria-label="Leyendo las cosas del proyecto" /> : <TodoList p={p} cosas={cosas} links={links} timeZone={timeZone} companyPaused={companyPaused} actOf={actOf ? (c) => actOf(c, cosas) : undefined} />}
      </div>
      {bottom}
    </div>
  );
};
