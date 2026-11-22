// PLA-I64 (PLA-IDEA28, boards A1-A4): a project from the inside, one screen. Every thing of the project in one list
// (lib/cosas.ts), one row each: its name, its thread small and what it needs, grouped by what it needs (Te toca, Se
// mueve, En fila, Quieto, Hecho), always in that order. An empty group is one line; a long group folds («Ver las
// otras N»). A row opens today's view of the thing (the idea, the initiative, the step) and comes back here.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, type Decision, type OrgProject, type Pulso } from "@/lib/api";
import { cosasOf, grupoName, tipoName, type Cosa, type Cosas, type Frase, type Grupo, type Hecha } from "@/lib/cosas";
import { cuentaAria, cuentasOf, filtrar, tokensLabel, tokensTitle, type Filtro } from "@/lib/fila";
import { Hilo, HiloHead } from "./hilo";
import { ladoFits } from "./lado";
import { useFicha } from "./listas";
import { Label, ReadError } from "./parts";
import { LOCALE } from "@/lib/locale";
import { getLanguage, words, type Language } from "@/lib/i18n";
import { TODO_WORDS } from "@/lib/todo-words";
import { TramosBoton, TramosHoja } from "./tramos";
import { tramoWords } from "@/lib/tramo";
import { pulsoLabel, reanudarLine, pulsoLine, reanudarLabel, type MetaLine } from "@/lib/barra";

export type TodoLinks = {
  /** Where a row opens (today's view of the thing). */
  open: (c: Cosa) => string;
  hecha: (key: string) => string;
  idea: (key: string) => string;
  /** PLA-I3-4: where a step of a row's thread opens (the step's page). PLA-I3-5: with Todo's onPaso, a step opens
   *  in the panel beside the list instead, and this is the phone's way (639 px and under). Absent: the thread stays
   *  decorative. */
  paso?: (key: string) => string;
  /** Everything done (the Hecho door). */
  hecho: string;
};

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/** How many rows each group shows before it folds. The list measures its own height (ResizeObserver) and spends
 *  it in group order: a Te toca row costs more than a quiet one, a row in line or done costs least. Te toca always
 *  shows its first row; Hecho shows up to two rows while room is left. Measured at 1440×800 (PLA-I64-2); PLA-I3-3
 *  re-measured them once titles and «qué toca» took two lines and initiatives a token line. */
export const ROW_PX = { toca: 96, mueve: 94, fila: 80, quieto: 80, hecho: 46 } as const;
// The column header is 30px; the counts' row is 56 (44px controls); a group's line is 30, or 48 when it carries a
// «Ver…» link (a 44px target). Only groups with rows get a line (PLA-I3-3).
export const LINE_PX = { head: 30, cuentas: 56, group: 30, folded: 48 } as const;
export const FOLD = { perGroup: 3, hecho: 2, fallback: 420 } as const;
export function foldOf(c: Cosas, open: ReadonlySet<Grupo>, height: number = FOLD.fallback): Record<Grupo, number> {
  // Fixed lines: the column header, the counts, one line per group with rows, Hecho's line when it has any.
  const hechoLine = c.hecho.iniciativas.length > 0 || c.hecho.sueltos > 0 ? LINE_PX.folded : 0;
  let left = height - LINE_PX.head - LINE_PX.cuentas - c.grupos.filter((g) => g.cosas.length > 0).length * LINE_PX.group - hechoLine;
  const out = { toca: 0, mueve: 0, fila: 0, quieto: 0, hecho: 0 } as Record<Grupo, number>;
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
export function groupLine(g: Exclude<Grupo, "hecho">, n: number, paused: boolean, language: Language = getLanguage()): string {
  const w = words(TODO_WORDS, language);
  if (n === 0) return w.emptyLine[g];
  if (g === "toca") return w.tocaLine(n);
  if (g === "mueve") return w.mueveLine(n);
  if (g === "fila") return paused ? w.filaPaused : w.filaLive;
  return w.quietoLine;
}

// PLA-I3-3: an initiative's token line under its name: one figure, violet with a dot while one of its steps is live.
const TokensLine = ({ c }: { c: Cosa }) => {
  if (!c.tokens) return null;
  const live = c.hilo.tramos.some((t) => t.tono === "vivo");
  return (
    <span className={cls("cor-tokens", live && "live")} title={tokensTitle(c.tokens)} data-tokens={c.tokens.used}>
      {live && <i aria-hidden />}
      {tokensLabel(c.tokens.used)}
    </span>
  );
};

/** PLA-I3-5: the step open in the panel beside the list, and how a step's click opens it. */
export type Lado = { open: string | null; onPaso: (key: string) => void };

/** PLA-I3-7: an initiative's steps on a phone: one control on its card, and the sheet it opens. */
type Tramos = { open: string | null; onOpen: (key: string) => void };

const Row = ({ c, links, act, lado, tramos }: { c: Cosa; links: TodoLinks; act?: ReactNode; lado?: Lado; tramos?: Tramos }) => {
  const toca = c.grupo === "toca";
  const navigate = useNavigate();
  const paso = links.paso;
  // PLA-I3-5: the panel where it fits; on a phone the step's page.
  const onOpen = paso ? (k: string) => (lado && ladoFits() ? lado.onPaso(k) : navigate(paso(k))) : undefined;
  // PLA-I3-7: drawn only at 639 px and under (corriente.css), where it takes the thread's place.
  const control = !!paso && !!tramos && c.tipo === "iniciativa" && c.hilo.tramos.length > 0;
  return (
    <li className={cls("cor-cosa", toca && "you", c.grupo === "mueve" && "liv")} data-cosa={c.key} data-grupo={c.grupo}>
      <Link to={links.open(c)} className="cor-cosa-nm" data-control="abrir-cosa">
        <span className="cor-cosa-ids">
          <Label tone={toca ? "amber" : undefined}>{tipoName(c.tipo)}</Label>
          {c.tipo !== "publicar" && c.tipo !== "decision" && c.tipo !== "jugada" && <span className="cor-key">{c.key}</span>}
        </span>
        <b className="cor-cosa-t" title={c.full ?? c.title}>
          {c.title}
        </b>
        <TokensLine c={c} />
      </Link>
      <Hilo h={c.hilo} onOpen={onOpen} label={tramoWords().stepsOf(c.title)} openKey={lado ? lado.open : undefined} />
      {control && <TramosBoton c={c} open={tramos!.open === c.key} onOpen={() => tramos!.onOpen(c.key)} />}
      <div className="cor-cosa-que">
        <span className="cor-cosa-tx">
          <span className={cls("cor-label", toca && "amber")}>{c.cap}</span>
          <span className="cor-cosa-espera" title={c.espera}>
            {c.espera}
          </span>
        </span>
        {act}
      </div>
    </li>
  );
};

/** PLA-I3-3: the counts above the list (Todo, Te toca, Se mueve, En fila, Quieto), each a pressed-state button that
 *  filters it, and Hecho as the link to its door. They replace the line «TE TOCA · 0 SE MUEVE · 0 …». */
export const Cuentas = ({ cosas, filtro, onFiltro, hechoHref }: { cosas: Cosas; filtro: Filtro; onFiltro: (f: Filtro) => void; hechoHref: string }) => {
  const { cuentas, hecho } = cuentasOf(cosas);
  return (
    <div className="cor-cuentas" role="group" aria-label={words(TODO_WORDS).filterList} data-cuentas>
      {cuentas.map((k) => (
        <button key={k.id} type="button" className={cls("cor-cuenta", k.id === "toca" && k.n > 0 && "you")} aria-pressed={filtro === k.id} aria-label={cuentaAria(k)} onClick={() => onFiltro(k.id)} data-control={`filtro-${k.id}`}>
          <span className="cor-label">{k.label}</span>
          <b className="cor-cuenta-n">{k.n}</b>
        </button>
      ))}
      <Link className="cor-cuenta hecho" to={hechoHref} aria-label={words(TODO_WORDS).doneAria(hecho)} data-control="filtro-hecho">
        <span className="cor-label">{grupoName("hecho")}</span>
        <b className="cor-cuenta-n">{hecho}</b>
        <span className="cor-cuenta-go" aria-hidden>
          →
        </span>
      </Link>
    </div>
  );
};

const dayOf = (iso: string | null, timeZone?: string) => (iso ? new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone }).format(new Date(iso)).replace(".", "").toUpperCase() : "");

const HechaRow = ({ h, links, timeZone }: { h: Hecha; links: TodoLinks; timeZone?: string }) => (
  <li className="cor-cosa sm" data-hecha={h.key}>
    <Link to={links.hecha(h.key)} className="cor-cosa-nm row">
      <span className="cor-key">{h.key}</span>
      <b className="cor-ellipsis">{h.title}</b>
    </Link>
    <Hilo h={{ idea: h.idea_key ? 5 : null, ideaTono: h.idea_key ? "hecho" : null, valvula: "abierta", tramos: [{ key: h.key, title: h.title, etapa: "hecho", tono: "hecho" }], publicado: true, at: "publicado" }} small />
    <div className="cor-cosa-que">
      <span className="cor-cap">{[grupoName("hecho"), dayOf(h.done_at, timeZone), h.idea_key ? words(TODO_WORDS).doneOn(h.idea_key) : null].filter(Boolean).join(" · ").toUpperCase()}</span>
    </div>
  </li>
);

// PLA-98: whether the list should take its overflow off the room once more (see the effect in Todo).
export const MAX_FIT_TRIES = 3;
export const shouldRefit = (extra: number, tries: number, over: number, room: number | undefined): boolean =>
  extra > 2 && tries < MAX_FIT_TRIES && (room === undefined || over < room);

export const TodoList = ({
  p,
  cosas,
  links,
  timeZone,
  companyPaused,
  actOf,
  plan,
  lado,
}: {
  p: OrgProject;
  cosas: Cosas;
  links: TodoLinks;
  timeZone?: string;
  companyPaused: boolean;
  actOf?: (c: Cosa) => ReactNode;
  lado?: Lado;
  /** PLA-I64-5: the empty project's «Arma el plan» (null: not offered, e.g. a plan is already asked for). */
  plan?: ReactNode;
}) => {
  const w = words(TODO_WORDS);
  const [open, setOpen] = useState<Set<Grupo>>(new Set());
  // PLA-I3-3: the count pressed above the list; a group's count shows that group whole.
  const [filtro, setFiltro] = useState<Filtro>("todo");
  // PLA-I3-7: the initiative whose steps' sheet is open (a phone's control opens it).
  const [tramosDe, setTramosDe] = useState<string | null>(null);
  const tramos = { open: tramosDe, onOpen: setTramosDe };
  const hojaDe = tramosDe ? (cosas.grupos.flatMap((g) => g.cosas).find((c) => c.key === tramosDe) ?? null) : null;
  const vista = filtrar(cosas, filtro);
  const abiertos: ReadonlySet<Grupo> = filtro === "todo" ? open : new Set<Grupo>([filtro]);
  const paused = companyPaused || p.paused;
  // The room the list has (its scroll box), read on every resize.
  const ref = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const box = ref.current?.closest(".cor-todo-scroll") as HTMLElement | null;
    if (!box || typeof ResizeObserver === "undefined") return;
    const read = () => {
      if (!ref.current) return;
      tries.current = 0;
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
  // PLA-98 (guided test PLA-86): in a short window (a 303 px pane) the list overflows even folded to its least, so this
  // took the overflow off again on every render until React stopped it («Maximum update depth exceeded») and the whole
  // floor went blank. It now corrects at most MAX_FIT_TRIES times per box size, and never past the room itself; what
  // still overflows then scrolls.
  const tries = useRef(0);
  const shown = foldOf(vista, abiertos, room === undefined ? undefined : room - over);
  useLayoutEffect(() => {
    const box = ref.current?.closest(".cor-todo-scroll") as HTMLElement | null;
    if (!box || abiertos.size > 0) return;
    const extra = box.scrollHeight - box.clientHeight;
    if (!shouldRefit(extra, tries.current, over, room)) return;
    tries.current += 1;
    setOver((o) => o + extra);
  });
  const toggle = (g: Grupo) => setOpen((s) => (s.has(g) ? new Set([...s].filter((x) => x !== g)) : new Set([...s, g])));
  // PLA-I3-3: the counts say every group's size, so only groups with rows get a header; a pressed count whose group is
  // empty says so in its line.
  const grupos = vista.grupos.filter((g) => g.cosas.length > 0 || filtro !== "todo");
  const cuentas = <Cuentas cosas={cosas} filtro={filtro} onFiltro={setFiltro} hechoHref={links.hecho} />;
  const hecho = vista.hecho;
  const hechoRows = hecho.iniciativas.slice(0, shown.hecho);
  if (cosas.abiertas === 0 && hecho.iniciativas.length === 0 && hecho.sueltos === 0)
    return (
      <div className="cor-todo-list" ref={ref} data-todo={p.slug} data-abiertas={0} data-vacio>
        <div className="cor-cosa-head" aria-hidden>
          <span className="cor-label">{w.eachThing}</span>
          <HiloHead />
          <span className="cor-label">{w.whatsNext}</span>
        </div>
        <div className="cor-cosa ghost" data-fantasma>
          <div className="cor-cosa-nm">
            <span className="cor-label">{w.ghostLabel}</span>
            <b className="cor-muted">{w.ghostTitle}</b>
          </div>
          <Hilo h={{ idea: 0, ideaTono: "quieto", valvula: "cerrada", tramos: [], publicado: false, at: "buzon" }} />
          <div className="cor-cosa-que">
            <span className="cor-cosa-tx">
              <span className="cor-label">{w.ghostNext}</span>
              <span className="cor-cosa-espera">{w.ghostWait}</span>
            </span>
          </div>
        </div>
        {cuentas}
        {plan && (
          <div className="cor-vacio-plan">
            <p className="cor-text">{w.planNudge}</p>
            {plan}
          </div>
        )}
      </div>
    );
  return (
    <div className="cor-todo-list" ref={ref} data-todo={p.slug} data-abiertas={cosas.abiertas}>
      <div className="cor-cosa-head" aria-hidden>
        <span className="cor-label">{w.eachThing}</span>
        <HiloHead />
        <span className="cor-label">{w.whatsNext}</span>
      </div>
      {cuentas}
      {grupos.map((g) => {
        const n = g.cosas.length;
        const k = shown[g.grupo];
        const more = n - k;
        return (
          <section key={g.grupo} aria-label={grupoName(g.grupo)} data-grupo={g.grupo}>
            <div className="cor-grp">
              <h2 className={cls("cor-label", g.grupo === "toca" && n > 0 && "amber")}>{`${grupoName(g.grupo)} · ${n}`}</h2>
              <span className="cor-grp-tx">{groupLine(g.grupo, n, paused)}</span>
              {filtro === "todo" && (more > 0 || open.has(g.grupo)) && (
                <button type="button" className="cor-btn link cor-grp-more" aria-expanded={open.has(g.grupo)} onClick={() => toggle(g.grupo)} data-control={`ver-${g.grupo}`}>
                  {open.has(g.grupo) ? w.seeLess : k === 0 ? (n === 1 ? w.seeIt : w.seeAll(n)) : more === 1 ? w.seeOther : w.seeOthers(more)}
                </button>
              )}
            </div>
            {k > 0 && (
              <ul>
                {g.cosas.slice(0, k).map((c) => (
                  <Row key={c.key} c={c} links={links} act={actOf?.(c)} lado={lado} tramos={tramos} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {(hecho.iniciativas.length > 0 || hecho.sueltos > 0) && (
        <section aria-label={grupoName("hecho")} data-grupo="hecho">
          <div className="cor-grp">
            <h2 className="cor-label green">{[grupoName("hecho"), hecho.iniciativas.length ? w.initiatives(hecho.iniciativas.length) : null, hecho.sueltos ? w.looseSteps(hecho.sueltos) : null].filter(Boolean).join(" · ")}</h2>
            <Link className="cor-btn link cor-grp-more" to={links.hecho} data-control="ver-hecho">
              {w.seeAllDone}
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
      )}
      {vista.guardadas > 0 && (
        <section aria-label={w.saved} data-guardadas={cosas.guardadas}>
          <div className="cor-grp">
            <h2 className="cor-label">{`${w.saved} · ${cosas.guardadas}`}</h2>
            <span className="cor-grp-tx">{w.savedLine}</span>
            <button type="button" className="cor-btn link cor-grp-more" aria-expanded={open.has("guardadas" as Grupo)} onClick={() => toggle("guardadas" as Grupo)} data-control="ver-guardadas">
              {open.has("guardadas" as Grupo) ? w.seeLess : cosas.guardadas === 1 ? w.seeIt : w.seeAll(cosas.guardadas)}
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
      {hojaDe && links.paso && <TramosHoja c={hojaDe} paso={links.paso} onClose={() => setTramosDe(null)} />}
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
  lado,
  panel,
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
  lado?: Lado;
  /** PLA-I3-5: the open step's panel, drawn over the list's right side (above the Pedir bar, never over it). */
  panel?: (cosas: Cosas) => ReactNode;
}) => {
  const w = words(TODO_WORDS);
  const f = useFicha(p.slug);
  const cosas = cosasOf({ p, decisions, ficha: f.data ?? null, companyPaused });
  return (
    <div className="cor-todo" data-todo-screen={p.slug}>
      <div className="cor-todo-mid">
        <div className="cor-todo-scroll">
          {top?.(cosas)}
          {f.isError && !f.data ? (
            <div className="cor-todo-err">
              <ReadError what={w.readWhat} onRetry={() => void f.refetch()} />
            </div>
          ) : null}
          {f.isLoading ? <div className="cor-skel" role="status" style={{ height: 320, margin: "8px 0" }} aria-busy="true" aria-label={w.reading} /> : <TodoList p={p} cosas={cosas} links={links} timeZone={timeZone} companyPaused={companyPaused} actOf={actOf ? (c) => actOf(c, cosas) : undefined} plan={plan} lado={lado} />}
        </div>
        {panel?.(cosas)}
      </div>
      {bottom?.(cosas)}
    </div>
  );
};

// ---- PLA-I64-3: the sentence and the pulse (board A1, A2). PLA-I3-2: the meta line sits above the sentence, the
// sentence takes the page's title size, Reanudar sits under it while the project is paused, and the pulse's count is
// a figure beside the bars.

export const FraseView = ({ f }: { f: Frase }) => (
  <div className="cor-frase" data-frase>
    <h2 className="cor-frase-h cor-h1">
      <span>{f.mueve}</span>
      {f.toca && (
        <span className="amber" data-frase-toca>
          {f.toca}
        </span>
      )}
      {f.sub && <span className="sub">{f.sub}</span>}
    </h2>
    {/* PLA-I3-2: paused, the same line sits beside Reanudar; it is not said twice. */}
    {f.falta !== reanudarLine() && <p className="cor-frase-falta">{f.falta}</p>}
  </div>
);

const shortDay = (iso: string) => new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`)).replace(".", "").toUpperCase();

/** Steps done per day, the last 14 days; today lit. Read-only; the numbers are said in words for screen readers. */
export const PulsoView = ({ pulso }: { pulso: Pulso | null }) => {
  const w = words(TODO_WORDS);
  if (!pulso) return <div className="cor-pulso" aria-hidden />;
  const max = Math.max(1, ...pulso.days.map((d) => d.n));
  const first = pulso.days[0]?.day;
  return (
    <figure className="cor-pulso" data-pulso={pulso.total}>
      <figcaption className="cor-pulso-n">
        <b className="cor-figure">{pulso.total}</b>
        <span className="cor-label">{pulsoLabel(pulso.days.length)}</span>
      </figcaption>
      <div className="cor-pulso-chart">
        <div className="cor-pulso-bars" role="img" aria-label={w.pulseAria(pulso.days.map((d) => `${shortDay(d.day)} ${d.n}`).join(", "))}>
          {pulso.days.map((d, i) => (
            <i key={d.day} className={cls(d.n === 0 && "z", i === pulso.days.length - 1 && "hoy")} style={{ height: d.n === 0 ? 2 : Math.max(4, Math.round((d.n / max) * 44)) }} />
          ))}
        </div>
        <div className="cor-pulso-ends" aria-hidden>
          <span>{first ? shortDay(first) : ""}</span>
          <span>{w.today}</span>
        </div>
      </div>
      {/* PLA-I3-7: a phone shows this line instead of the figure and the bars. */}
      <p className="cor-pulso-line" data-pulso-line>
        {pulsoLine(pulso.total, pulso.days.length)}
      </p>
    </figure>
  );
};

export const usePulso = (slug: string) => useQuery({ queryKey: ["pulso", slug], queryFn: () => api.pulso(slug), staleTime: 60_000, refetchInterval: 120_000, retry: 1 });

/** The meta line above the sentence: «Meta · Sin meta todavía · Fijar meta». */
export const MetaView = ({ m, href }: { m: MetaLine; href: string }) => (
  <div className="cor-pmeta" data-pmeta>
    <span className="cor-label">Meta</span>
    <span className="cor-pmeta-tx">{m.text}</span>
    <Link to={href} className="cor-btn link" data-control="fijar">
      {m.link}
    </Link>
  </div>
);

/** PLA-I3-2: the paused project's one white button, under its sentence. */
export const ReanudarView = ({ title, href }: { title: string; href: string }) => (
  <div className="cor-reanudar" data-reanudar>
    <Link className="cor-btn primary" to={href} data-control="reanudar">
      {reanudarLabel(title)}
    </Link>
    <span className="cor-text">{reanudarLine()}</span>
  </div>
);

export const Cabeza = ({ f, slug, nudge, meta, reanudar }: { f: Frase; slug: string; nudge?: ReactNode; meta?: { m: MetaLine; href: string }; reanudar?: { title: string; href: string } }) => {
  const q = usePulso(slug);
  return (
    <div className="cor-cabeza" data-cabeza>
      <div className="cor-cabeza-l">
        {meta && <MetaView m={meta.m} href={meta.href} />}
        <FraseView f={f} />
        {reanudar ? <ReanudarView title={reanudar.title} href={reanudar.href} /> : nudge && <div className="cor-nudge">{nudge}</div>}
      </div>
      <PulsoView pulso={q.data ?? null} />
    </div>
  );
};
