// La ciudad: Inicio's night skyline. Each open initiative is a tower in its project's district;
// its windows are its tickets, lit from the ground up as they close. A crane means agents are on
// it, a red beacon that it is shipping, scaffolding that it is still being planned, and a
// searchlight that it waits on Jorge. Tapping a tower opens its ficha, where whatever waits on
// Jorge is decided in place, the same writes the Bandeja makes.
import { ArrowRightIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { ProjectMark } from "@/components/plania-mark";
import { accentInk, projectAccent } from "@/components/plan/visuals";
import { defaultTower, stageLabel, towerLabel, type District, type Stage, type Tower, type WindowTone } from "@/lib/city";
import type { Headline } from "@/lib/home";
import type { InboxItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Titular } from "./parts";
import { TeTocaItems } from "./te-toca";

type Names = (slug: string) => string;

const LOOSE = "__loose";
const FICHA_W = 368;

// Fixed so the sky doesn't reshuffle on every render: [left %, top %, delay s].
const STARS: [number, number, number][] = [
  [6, 9, 0.2], [14, 22, 2.4], [23, 7, 1.1], [31, 30, 3.3], [37, 16, 2], [45, 5, 0.9], [52, 24, 0.6], [58, 12, 2.7],
  [61, 33, 1.7], [68, 6, 3.6], [74, 19, 2.8], [79, 36, 0.4], [83, 10, 0.9], [88, 27, 2.1], [93, 8, 2.3], [97, 21, 1.4],
];

function useWide() {
  const query = "(min-width: 48rem)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/** Floors from the top down, each `cols` wide; the top floor is padded so the grid fills bottom-left first. */
function floorsOf(windows: WindowTone[], cols: number): (WindowTone | null)[] {
  const list: (WindowTone | null)[] = windows.length > 0 ? [...windows] : Array.from({ length: cols }, () => "dark" as const);
  const floors: (WindowTone | null)[][] = [];
  for (let i = 0; i < list.length; i += cols) floors.push(list.slice(i, i + cols));
  const top = floors[floors.length - 1]!;
  while (top.length < cols) top.push(null);
  return floors.reverse().flat();
}

const STAGE_TAG: Record<Stage, string> = {
  planning: "bg-foreground/[0.08] text-muted-foreground",
  building: "bg-status-now/15 text-ink-now",
  shipping: "bg-status-review/15 text-ink-review",
  paused: "bg-foreground/[0.06] text-muted-foreground",
};

const modelWord = (m: string | null) => (m ? m.replace(/^claude-/, "").replace(/-(\d)-(\d)$/, " $1.$2") : null);

function Crane({ lights }: { lights: number }) {
  // Where the lights hang on the jib, up to four.
  const spots: CSSProperties[] = [
    { left: "85%", top: "36%" },
    { left: "23%", top: "23%" },
    { left: "64%", top: "20%" },
    { left: "41%", top: "3%" },
  ];
  return (
    <span className="city-crane" aria-hidden>
      <svg viewBox="0 0 110 64" className="absolute inset-0 size-full" fill="none" stroke="#8d94aa" strokeWidth="1.5">
        <path d="M46 64V10M46 10H96M46 10L28 18M56 15L46 10M66 16l-20 -6M76 17L46 10M96 10v16M46 18l6 -8M46 26l6 -8M46 34l6 -8M46 42l6 -8M46 50l6 -8M46 58l6 -8M52 10v54" />
      </svg>
      {spots.slice(0, Math.min(4, lights)).map((s, i) => <i key={i} style={{ ...s, animationDelay: `${i * 0.35}s` }} />)}
    </span>
  );
}

function TowerView({ t, projectTitle, selected, onSelect, index }: { t: Tower; projectTitle: string; selected: boolean; onSelect: (key: string) => void; index: number }) {
  const [accent] = projectAccent(t.slug);
  const cells = floorsOf(t.windows, t.columns);
  const searchlight = t.waits && !t.awaitsGo && t.agents.length === 0;
  return (
    <button
      type="button"
      data-key={t.key}
      data-stage={t.stage}
      data-paused={t.stage === "paused" || undefined}
      aria-pressed={selected}
      aria-label={towerLabel(t, projectTitle)}
      onClick={() => onSelect(t.key)}
      className="city-tower animate-rise"
      style={{ "--cols": t.columns, animationDelay: `${120 + index * 70}ms` } as CSSProperties}
    >
      {searchlight && <span className="city-beam" aria-hidden style={{ animationDelay: `${-(index * 1.7) % 7}s` }} />}
      {t.agents.length > 0 && (
        <span className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-status-now/15 px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap text-ink-now">
          <span className="city-dot" aria-hidden />
          {t.agents.length} {t.agents.length === 1 ? "agente" : "agentes"}
        </span>
      )}
      {t.agents.length > 0 && <Crane lights={t.agents.length} />}
      {t.awaitsGo && (
        <span className="mb-2 rounded-full border border-dashed border-status-jorge/55 px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap text-ink-jorge">espera tu go</span>
      )}
      {t.stage === "shipping" && t.agents.length === 0 && <span className="city-beacon" aria-hidden />}
      <span className="city-bld" aria-hidden>
        {cells.map((w, i) => (w ? <span key={i} className="city-win" data-tone={w} /> : <span key={i} />))}
        <span className="city-door" />
      </span>
      <span className="city-lbl grid h-[60px] w-full content-start justify-items-center gap-0.5 px-1 pt-2 text-center" aria-hidden>
        <span className="font-mono text-[10px] tracking-wide" style={{ color: accentInk(accent) }}>{t.key}</span>
        <span className="line-clamp-2 text-[11px] leading-tight text-foreground/75 md:text-xs">{t.title}</span>
      </span>
    </button>
  );
}

function DistrictView({ d, envLine, selected, onSelect, offset }: { d: District; envLine: string; selected: string | null; onSelect: (key: string) => void; offset: number }) {
  const [accent] = projectAccent(d.slug);
  return (
    <div className="relative z-[1] flex flex-col">
      <div className="flex items-end justify-center gap-1 px-1 md:gap-1.5">
        {d.towers.map((t, i) => <TowerView key={t.key} t={t} projectTitle={d.title} selected={selected === t.key} onSelect={onSelect} index={offset + i} />)}
      </div>
      <Link
        to={`/p/${d.slug}`}
        className="flex min-w-[190px] items-center gap-2.5 px-3 transition hover:brightness-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        style={{ height: "var(--street-h)", background: `linear-gradient(to bottom, color-mix(in oklab, ${accent} 17%, transparent), transparent 75%)` }}
      >
        <ProjectMark slug={d.slug} className="size-5 md:size-[22px]" />
        <span className="grid min-w-0">
          <span className="font-display text-[15px] leading-tight font-extrabold tracking-tight md:text-lg" style={{ color: accentInk(accent) }}>{d.title}</span>
          <span className="truncate text-[10.5px] text-muted-foreground md:text-[11.5px]">{envLine}</span>
        </span>
      </Link>
    </div>
  );
}

function Legend() {
  const win = (tone: WindowTone) => <span className="city-win !h-2.5 w-2.5 !animate-none" data-tone={tone} aria-hidden />;
  return (
    <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[11px] text-muted-foreground" aria-label="Leyenda">
      <li className="flex items-center gap-1.5">{win("lit")}hecho</li>
      <li className="flex items-center gap-1.5">{win("now")}en curso</li>
      <li className="flex items-center gap-1.5">{win("review")}en revisión</li>
      <li className="flex items-center gap-1.5">{win("ready")}lista</li>
      <li className="flex items-center gap-1.5">{win("dark")}backlog</li>
      <li className="flex items-center gap-1.5"><span className="city-dot" aria-hidden />grúa = agentes</li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-0 w-0 border-x-[5px] border-b-[11px] border-x-transparent border-b-status-jorge/70" />haz = te toca
      </li>
    </ul>
  );
}

function FichaFrame({ children, onClose, style, className }: { children: ReactNode; onClose: () => void; style?: CSSProperties; className?: string }) {
  return (
    <aside
      aria-label="Ficha"
      className={cn("grid content-start gap-3 overflow-y-auto rounded-[18px] border border-white/15 bg-card/85 px-4 py-4 shadow-[0_24px_60px_rgb(0_0_0/0.5)] backdrop-blur-xl", className)}
      style={style}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar ficha"
        className="absolute top-2.5 right-2.5 inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <XIcon className="size-4" aria-hidden />
      </button>
      {children}
    </aside>
  );
}

function TowerFicha({ t, names }: { t: Tower; names: Names }) {
  const [accent] = projectAccent(t.slug);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 pr-9">
        <span className="font-mono text-[11px]" style={{ color: accentInk(accent) }}>{t.key} · {names(t.slug)}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", STAGE_TAG[t.stage])}>{stageLabel(t)}</span>
      </div>
      <h3 className="font-display text-lg leading-tight font-bold tracking-tight">{t.title}</h3>
      {t.note && (
        <p className="text-[13px] leading-snug whitespace-pre-wrap text-foreground/80">
          {t.waits && <span className="mr-1 font-semibold text-ink-jorge">Te toca ·</span>}
          {t.note}
        </p>
      )}
      {t.inProgress && t.inProgress !== t.note && <p className="text-xs leading-snug text-muted-foreground">{t.inProgress}</p>}
      {t.agents.length > 0 && (
        <ul className="grid gap-1.5" aria-label="Agentes trabajando">
          {t.agents.map((a) => (
            <li key={a.key} className="flex min-w-0 items-baseline gap-2 rounded-xl bg-surface-sunken px-3 py-2 text-xs">
              <span className="city-dot shrink-0 self-center" aria-hidden />
              <Link to={`/p/${t.slug}?task=${encodeURIComponent(a.key)}`} className="min-w-0 flex-1 truncate underline-offset-4 hover:underline" title={a.title}>
                <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">{a.key}</span>
                {a.title}
              </Link>
              <span className="shrink-0 text-[11px] text-muted-foreground">{modelWord(a.model) ?? a.agent}</span>
            </li>
          ))}
        </ul>
      )}
      <TeTocaItems items={t.inbox} names={names} />
      <Link
        to={`/p/${t.slug}?task=${encodeURIComponent(t.key)}`}
        className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-xl bg-foreground px-3.5 text-[13px] font-semibold text-background transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        Abrir {t.key} <ArrowRightIcon className="size-3.5" aria-hidden />
      </Link>
    </>
  );
}

function LooseFicha({ items, names }: { items: InboxItem[]; names: Names }) {
  return (
    <>
      <p className="pr-9 text-[11px] font-bold tracking-[0.12em] text-ink-jorge uppercase">Te toca · fuera de las torres</p>
      <TeTocaItems items={items} names={names} />
      <Link to="/inbox" className="inline-flex min-h-8 w-fit items-center gap-1.5 text-[13px] font-semibold text-ink-jorge hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        Abrir la bandeja completa <ArrowRightIcon className="size-3.5" aria-hidden />
      </Link>
    </>
  );
}

type Place = { left: number; top: number; maxHeight: number };

export function Ciudad({ districts, loose, headline, envLines, names, nowMs }: {
  districts: District[];
  loose: InboxItem[];
  headline: Headline;
  envLines: Record<string, string>;
  names: Names;
  nowMs: number;
}) {
  const wide = useWide();
  const sceneRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The ficha opens on what waits on Jorge; once he picks or closes one, his choice stays.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const towers = districts.flatMap((d) => d.towers);
  const fallback = defaultTower(districts) ?? (loose.length > 0 ? LOOSE : null);
  const wanted = picked === undefined ? fallback : picked;
  const selected = wanted === LOOSE ? (loose.length > 0 ? LOOSE : null) : towers.some((t) => t.key === wanted) ? wanted : null;
  const tower = towers.find((t) => t.key === selected) ?? null;
  const onSelect = (key: string) => setPicked((cur) => ((cur === undefined ? fallback : cur) === key ? null : key));

  // On a wide screen the ficha floats in the sky beside its tower.
  const [place, setPlace] = useState<Place | null>(null);
  const measure = useCallback(() => {
    const scene = sceneRef.current;
    const head = headRef.current;
    if (!wide || !selected || !scene || !head) return setPlace(null);
    const anchor = scene.querySelector<HTMLElement>(`[data-key="${CSS.escape(selected)}"]`);
    if (!anchor) return setPlace(null);
    const s = scene.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    let left = a.right - s.left + 14;
    if (left + FICHA_W > s.width - 16) left = a.left - s.left - FICHA_W - 14;
    left = Math.max(16, Math.min(left, s.width - FICHA_W - 16));
    const top = selected === LOOSE ? a.bottom - s.top + 10 : head.offsetTop + head.offsetHeight + 8;
    setPlace({ left, top, maxHeight: Math.max(220, s.height - top - 24) });
  }, [wide, selected]);
  useLayoutEffect(measure, [measure, districts]);
  useEffect(() => {
    const scene = sceneRef.current;
    const scroller = scrollRef.current;
    if (!scene) return;
    const ro = new ResizeObserver(measure);
    ro.observe(scene);
    scroller?.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      scroller?.removeEventListener("scroll", measure);
    };
  }, [measure]);

  const ficha = selected && (
    <FichaFrame
      key={selected}
      onClose={() => setPicked(null)}
      className={wide ? "absolute z-[4] animate-rise" : "relative animate-rise"}
      style={wide && place ? { left: place.left, top: place.top, width: FICHA_W, maxHeight: place.maxHeight } : wide ? { visibility: "hidden" } : undefined}
    >
      {tower ? <TowerFicha t={tower} names={names} /> : <LooseFicha items={loose} names={names} />}
    </FichaFrame>
  );

  let offset = 0;
  return (
    <div className="grid gap-3">
      <section
        ref={sceneRef}
        aria-label="Las iniciativas en curso y en revisión"
        className="city dark relative overflow-hidden rounded-[22px] border border-white/[0.07] text-foreground md:rounded-[26px]"
      >
        {STARS.map(([x, y, d], i) => <span key={i} aria-hidden className="city-star" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${d}s` }} />)}

        <div ref={headRef} className="pointer-events-none relative z-[3] flex flex-wrap items-start justify-between gap-x-8 gap-y-3 px-5 pt-6 md:px-10 md:pt-8">
          <Titular headline={headline} nowMs={nowMs} />
          <div className="pointer-events-auto grid justify-items-start gap-2.5 md:justify-items-end md:pt-1">
            <Legend />
            {loose.length > 0 && (
              <button
                type="button"
                data-key={LOOSE}
                aria-pressed={selected === LOOSE}
                onClick={() => onSelect(LOOSE)}
                className="inline-flex min-h-8 items-center gap-2 rounded-full border border-status-jorge/45 bg-status-jorge/12 px-3 text-xs font-semibold text-ink-jorge transition hover:bg-status-jorge/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {loose.length} {loose.length === 1 ? "cosa suelta te espera" : "cosas sueltas te esperan"}
              </button>
            )}
          </div>
        </div>

        <div ref={scrollRef} className="relative -mt-24 overflow-x-auto overscroll-x-contain [scrollbar-width:none] md:-mt-36 [&::-webkit-scrollbar]:hidden">
          <div className="relative flex w-max min-w-full items-end justify-between gap-4 px-3 pt-36 md:gap-8 md:px-8 md:pt-52">
            <div aria-hidden className="absolute inset-x-0 bottom-0 border-t border-white/10" style={{ height: "var(--street-h)", background: "var(--street)" }} />
            {districts.length === 0 ? (
              <p className="relative z-[1] w-full pb-32 text-center font-voice text-2xl text-foreground/70 italic">Nada en curso ni en revisión. La ciudad duerme.</p>
            ) : (
              districts.map((d) => {
                const view = <DistrictView key={d.slug} d={d} envLine={envLines[d.slug] ?? ""} selected={selected} onSelect={onSelect} offset={offset} />;
                offset += d.towers.length;
                return view;
              })
            )}
          </div>
        </div>

        {/* On a phone the skyline scrolls sideways: a fade on the right says there is more city. */}
        {!wide && <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-[2] w-10 bg-gradient-to-l from-[#0f1220] to-transparent" />}
        {wide && ficha}
      </section>
      {!wide && ficha && <div className="dark text-foreground">{ficha}</div>}
    </div>
  );
}
