// PLA-I64 (PLA-IDEA28, boards A1-A4): a project from the inside, one screen. Every thing of the project in one list
// (lib/cosas.ts), one row each: its name, its thread small and what it needs, grouped by what it needs (Te toca, Se
// mueve, En fila, Quieto, Hecho), always in that order. An empty group is one line; a long group folds («Ver las
// otras N»). A row opens today's view of the thing (the idea, the initiative, the step) and comes back here.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, type Decision, type OrgProject, type Pulso } from "@/lib/api";
import { GRUPO_NAME, TIPO_NAME, cosasOf, type Cosa, type Cosas, type Frase, type Grupo, type Hecha } from "@/lib/cosas";
import { Hilo, HiloHead } from "./hilo";
import { useFicha } from "./listas";
import { Label, ReadError } from "./parts";

export type TodoLinks = {
  /** Where a row opens (today's view of the thing). */
  open: (c: Cosa) => string;
  hecha: (key: string) => string;
  idea: (key: string) => string;
  /** Everything done (the Hecho door). */
  hecho: string;
};

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/** How many rows each group shows before it folds. The list measures its own height (ResizeObserver) and spends
 *  it in group order: a Te toca row costs more than a quiet one, a row in line or done costs least. Te toca always
 *  shows its first row; Hecho shows up to two rows while room is left. Measured at 1440×800 (PLA-I64-2). */
export const ROW_PX = { toca: 86, mueve: 58, fila: 52, quieto: 66, hecho: 46 } as const;
// The column header is 30px; a group's line is 30, or 48 when it carries a «Ver…» link (a 44px target).
export const LINE_PX = { head: 30, group: 30, folded: 48 } as const;
export const FOLD = { perGroup: 3, hecho: 2, fallback: 420 } as const;
export function foldOf(c: Cosas, open: ReadonlySet<Grupo>, height: number = FOLD.fallback): Record<Grupo, number> {
  // Fixed lines: the column header, one line per group shown (empty groups share the next one), Hecho's line.
  let left = height - LINE_PX.head - c.grupos.filter((g) => g.cosas.length > 0).length * LINE_PX.group - LINE_PX.folded;
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
    if (open.has(g.grupo)) left -= n * ROW_PX[g.grupo] + (LINE_PX.folded - LINE_PX.group);
    else if (show < n) left -= LINE_PX.folded - LINE_PX.group;
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
          {c.tipo !== "publicar" && c.tipo !== "decision" && c.tipo !== "jugada" && <span className="cor-key">{c.key}</span>}
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
  plan,
}: {
  p: OrgProject;
  cosas: Cosas;
  links: TodoLinks;
  timeZone?: string;
  companyPaused: boolean;
  actOf?: (c: Cosa) => ReactNode;
  /** PLA-I64-5: the empty project's «Arma el plan» (null: not offered, e.g. a plan is already asked for). */
  plan?: ReactNode;
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
      if (!ref.current) return;
      setOver(0);
      const pad = parseFloat(getComputedStyle(box).paddingBottom) || 0;
      setRoom(box.getBoundingClientRect().bottom - pad - ref.current.getBoundingClientRect().top + box.scrollTop - 4);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(box);
    const head = box.querySelector("[data-cabeza]");
    if (head) ro.observe(head);
    return () => ro.disconnect();
  }, []);
  // PLA-62: rows wrap taller than the estimate on narrow screens; what still overflows after a render is taken off the
  // room once (until the box changes size), so the fold settles on what really fits. Opened groups may scroll.
  const [over, setOver] = useState(0);
  const shown = foldOf(cosas, open, room === undefined ? undefined : room - over);
  useLayoutEffect(() => {
    const box = ref.current?.closest(".cor-todo-scroll") as HTMLElement | null;
    if (!box || open.size > 0) return;
    const extra = box.scrollHeight - box.clientHeight;
    if (extra > 2) setOver((o) => o + extra);
  });
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
  if (cosas.abiertas === 0 && hecho.iniciativas.length === 0 && hecho.sueltos === 0)
    return (
      <div className="cor-todo-list" ref={ref} data-todo={p.slug} data-abiertas={0} data-vacio>
        <div className="cor-cosa-head" aria-hidden>
          <span className="cor-label">Cada cosa</span>
          <HiloHead />
          <span className="cor-label">Qué toca</span>
        </div>
        <div className="cor-cosa ghost" data-fantasma>
          <div className="cor-cosa-nm">
            <span className="cor-label">Así se verá</span>
            <b className="cor-muted">Lo primero que pidas</b>
          </div>
          <Hilo h={{ idea: 0, ideaTono: "quieto", valvula: "cerrada", tramos: [], publicado: false, at: "buzon" }} />
          <div className="cor-cosa-que">
            <span className="cor-cosa-tx">
              <span className="cor-label">Aquí dirá qué toca</span>
              <span className="cor-cosa-espera">Quién la tiene, qué espera y, si te toca a ti, el botón para decidir.</span>
            </span>
          </div>
        </div>
        <div className="cor-grp" data-grupo-vacio="toca mueve fila quieto hecho">
          {(["toca", "mueve", "fila", "quieto", "hecho"] as const).map((g) => (
            <span key={g} className="cor-label">{`${GRUPO_NAME[g]} · 0`}</span>
          ))}
        </div>
        {plan && (
          <div className="cor-vacio-plan">
            <p className="cor-text">¿Prefieres que el PO proponga por dónde empezar? Arma el plan del proyecto: los entregables y los pasos de cada uno.</p>
            {plan}
          </div>
        )}
      </div>
    );
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
      {cosas.guardadas > 0 && (
        <section aria-label="Guardadas" data-guardadas={cosas.guardadas}>
          <div className="cor-grp">
            <h2 className="cor-label">{`Guardadas · ${cosas.guardadas}`}</h2>
            <span className="cor-grp-tx">fuera de la corriente; se restauran desde su «Más»</span>
            <button type="button" className="cor-btn link cor-grp-more" aria-expanded={open.has("guardadas" as Grupo)} onClick={() => toggle("guardadas" as Grupo)} data-control="ver-guardadas">
              {open.has("guardadas" as Grupo) ? "Ver menos" : cosas.guardadas === 1 ? "Verla" : `Ver las ${cosas.guardadas}`}
            </button>
          </div>
          {open.has("guardadas" as Grupo) && (
            <ul>
              {cosas.guardadasList.map((g) => (
                <li key={g.key} className="cor-cosa sm" data-guardada={g.key}>
                  <Link to={links.idea(g.key)} className="cor-cosa-nm row">
                    <span className="cor-key">{g.key}</span>
                    <b className="cor-ellipsis">{g.title}</b>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
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
  plan,
}: {
  p: OrgProject;
  decisions: Decision[];
  links: TodoLinks;
  timeZone?: string;
  companyPaused: boolean;
  actOf?: (c: Cosa, cosas: Cosas) => ReactNode;
  top?: (cosas: Cosas) => ReactNode;
  bottom?: (cosas: Cosas) => ReactNode;
  plan?: ReactNode;
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
        {f.isLoading ? <div className="cor-skel" role="status" style={{ height: 320, margin: "8px 0" }} aria-busy="true" aria-label="Leyendo las cosas del proyecto" /> : <TodoList p={p} cosas={cosas} links={links} timeZone={timeZone} companyPaused={companyPaused} actOf={actOf ? (c) => actOf(c, cosas) : undefined} plan={plan} />}
      </div>
      {bottom?.(cosas)}
    </div>
  );
};

// ---- PLA-I64-3: the sentence and the pulse (board A1, A2).

export const FraseView = ({ f }: { f: Frase }) => (
  <div className="cor-frase" data-frase>
    <h2 className="cor-frase-h">
      <span>{f.mueve}</span>
      {f.toca && (
        <span className="amber" data-frase-toca>
          {f.toca}
        </span>
      )}
      {f.sub && <span className="sub">{f.sub}</span>}
    </h2>
    <p className="cor-frase-falta">{f.falta}</p>
  </div>
);

const shortDay = (iso: string) => new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`)).replace(".", "").toUpperCase();

/** Steps done per day, the last 14 days; today lit. Read-only; the numbers are said in words for screen readers. */
export const PulsoView = ({ pulso }: { pulso: Pulso | null }) => {
  if (!pulso) return <div className="cor-pulso" aria-hidden />;
  const max = Math.max(1, ...pulso.days.map((d) => d.n));
  const first = pulso.days[0]?.day;
  return (
    <figure className="cor-pulso" data-pulso={pulso.total}>
      <figcaption className="cor-label">{`Últimos ${pulso.days.length} días · ${pulso.total} ${pulso.total === 1 ? "paso hecho" : "pasos hechos"}`}</figcaption>
      <div className="cor-pulso-bars" role="img" aria-label={`Pasos hechos por día: ${pulso.days.map((d) => `${shortDay(d.day)} ${d.n}`).join(", ")}`}>
        {pulso.days.map((d, i) => (
          <i key={d.day} className={cls(d.n === 0 && "z", i === pulso.days.length - 1 && "hoy")} style={{ height: d.n === 0 ? 2 : Math.max(4, Math.round((d.n / max) * 44)) }} />
        ))}
      </div>
      <div className="cor-pulso-ends" aria-hidden>
        <span>{first ? shortDay(first) : ""}</span>
        <span>HOY</span>
      </div>
    </figure>
  );
};

export const usePulso = (slug: string) => useQuery({ queryKey: ["pulso", slug], queryFn: () => api.pulso(slug), staleTime: 60_000, refetchInterval: 120_000, retry: 1 });

export const Cabeza = ({ f, slug, nudge }: { f: Frase; slug: string; nudge?: ReactNode }) => {
  const q = usePulso(slug);
  return (
    <div className="cor-cabeza" data-cabeza>
      <div className="cor-cabeza-l">
        <FraseView f={f} />
        {nudge && <div className="cor-nudge">{nudge}</div>}
      </div>
      <PulsoView pulso={q.data ?? null} />
    </div>
  );
};
