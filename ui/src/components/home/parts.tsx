// Inicio's pieces around the city: the headline with its voice line, what the machine runs, and the
// projects as a compact rail.
import { ArrowRightIcon, CalendarIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, type TargetAndTransition } from "motion/react";
import { Link } from "react-router";
import { ProjectMark } from "@/components/plania-mark";
import { Glyph, Kicker, accentInk, projectAccent, TONE_TEXT, toneVar } from "@/components/plan/visuals";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { dayText, type DateLine } from "@/lib/due";
import type { Headline, LiveServer, Tile } from "@/lib/home";
import type { StationTone } from "@/lib/lanes";
import { ago } from "@/lib/time";
import type { Machine } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LOCALE } from "@/lib/locale";
import { words } from "@/lib/i18n";
import { HOME_PARTS } from "@/lib/home-pieces-words";
import { Cifra } from "./cifra";

// Hover tints only where there is a real pointer, so a tap on a phone does not leave a row lit.
const HOVER_ROW = "transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-foreground/[0.05]";

const DATE = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long" });
const TIME = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });

function tint(tone: StationTone, pct = 12) {
  return { background: `color-mix(in oklab, ${toneVar(tone)} ${pct}%, transparent)` };
}

export function Titular({ headline, nowMs }: { headline: Headline; nowMs: number }) {
  const when = `${DATE.format(nowMs)} · ${TIME.format(nowMs)}`;
  return (
    <div className="grid max-w-[860px] animate-rise gap-3">
      <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase first-letter:uppercase">{when}</p>
      <h1 className="font-display text-4xl leading-[0.98] font-extrabold tracking-[-0.03em] sm:text-5xl lg:text-[56px]">{headline.title}</h1>
      <p className="font-voice text-2xl leading-[1.15] text-foreground/75 italic sm:text-[28px]">
        {headline.voice.map((part, i) => (
          <span key={i} className={cn(part.tone === "owner" && "text-ink-owner")}>{part.text}</span>
        ))}
      </p>
    </div>
  );
}

function fmtKb(kb: number) {
  const gb = kb / 1024 / 1024;
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.round(kb / 1024)} MB`;
}

/** A tile's dot and word for how the project goes. Only "en marcha" moves (agents are on it right now). */
function Estado({ t }: { t: Tile }) {
  const reducido = useReducedMotion() ?? false;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-medium", TONE_TEXT[t.state.tone])} data-estado={t.rank}>
      <Glyph tone={t.state.tone} size={7} pulse={t.state.tone === "now"} />
      {/* The word crossfades when the project changes state, so a project that starts running is noticed. */}
      <span className="inline-grid">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={t.state.word}
            className="col-start-1 row-start-1"
            initial={{ opacity: 0, filter: reducido ? "none" : "blur(2px)" }}
            animate={{ opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
            exit={{ opacity: 0, transition: { duration: motionTokens.duration.exit } }}
            transition={{ duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}
          >
            {t.state.word}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}

// One project. Read top to bottom: which one and how it goes; how much is left; what needs the owner; prod. A line
// with nothing to say is left out (no "nothing waits" filler): an empty space is the all-clear. The project's
// colour lives in its mark only, no stripe on the card.
function TileCard({ t, puertos }: { t: Tile; puertos: LiveServer[] }) {
  const w = words(HOME_PARTS);
  const pct = t.progress.total === 0 ? 0 : t.progress.closed / t.progress.total;
  const allDone = t.left.initiatives === 0 && t.left.tickets === 0;
  // What needs a look, most urgent first. Decisions carry the owner's colour; the rest are quiet notes.
  const signals = [
    t.waiting > 0 && { text: w.decisions(t.waiting), cls: "font-medium text-ink-owner" },
    t.orden > 0 && { text: w.toSort(t.orden), cls: "text-amber-700 dark:text-amber-400", title: w.toSortTitle },
    t.onHold > 0 && { text: w.onHold(t.onHold), cls: "text-muted-foreground" },
  ].filter((x): x is { text: string; cls: string; title?: string } => Boolean(x));
  return (
    <Link
      to={`/p/${t.slug}`}
      className="grid h-full content-start gap-4 rounded-2xl border bg-card p-4 transition-[border-color,background-color,scale] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.985] motion-reduce:transition-none sm:p-5 [@media(hover:hover)_and_(pointer:fine)]:hover:border-foreground/25"
      data-tile={t.slug}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <ProjectMark slug={t.slug} className="size-5 shrink-0" />
          <span className="truncate font-display text-lg leading-tight font-bold tracking-tight">{t.title}</span>
        </span>
        {/* Waiting on the owner says itself below, with the count; the word would only repeat it. */}
        {t.rank !== 1 ? <Estado t={t} /> : null}
      </span>

      {/* The number that matters: initiatives left, then the tasks' bar. Both move only when they change. */}
      <span className="grid gap-2">
        {allDone ? (
          <span className="text-sm text-muted-foreground">{w.allDone}</span>
        ) : (
          <span className="flex items-baseline gap-2">
            <Cifra value={t.left.initiatives} className="font-display text-3xl leading-none font-extrabold" />
            <span className="text-sm text-muted-foreground">{w.initiativesLeft(t.left.initiatives)}</span>
          </span>
        )}
        {t.progress.total > 0 && (
          <span className="grid gap-1.5" title={w.tasksDone(t.progress.closed, t.progress.total)}>
            <span className="h-1 overflow-hidden rounded-full bg-foreground/[0.08]" role="presentation">
              <span
                className="block h-full origin-left bg-status-done transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
                style={{ transform: `scaleX(${pct})` }}
              />
            </span>
            <span className="text-xs text-muted-foreground">
              <Cifra value={t.left.tickets} /> {w.tasksOpen(t.left.tickets)}
            </span>
          </span>
        )}
      </span>

      {signals.length > 0 && (
        <span className="grid gap-1 text-sm leading-snug">
          {signals.map((s) => (
            <span key={s.text} className={s.cls} title={s.title}>
              {s.text}
            </span>
          ))}
        </span>
      )}

      {/* Its live ports here on the machine, then prod in plain words: when it last got code and what it still lacks. */}
      <span className="mt-auto grid gap-0.5 border-t pt-3 text-xs leading-snug text-muted-foreground">
        <PuertosTile puertos={puertos} />
        <span>{t.deploy.text}</span>
        {t.deploy.lag && <span className="text-amber-700 dark:text-amber-400">{t.deploy.lag}</span>}
      </span>
    </Link>
  );
}

/** A tile's live ports: the first one, and how many more (the machine page lists them all). */
function PuertosTile({ puertos }: { puertos: LiveServer[] }) {
  const w = words(HOME_PARTS);
  const [primero, ...resto] = puertos;
  if (!primero) return null;
  return (
    <span className="inline-flex items-center gap-1.5" title={puertos.map((s) => s.port).join(", ")}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-status-done" />
      <span className="font-mono tabular-nums">{w.port(primero.port, primero.up)}</span>
      {resto.length > 0 && <span>{w.morePorts(resto.length)}</span>}
    </span>
  );
}

// La máquina is where every project lives, so it holds them: a quiet header (the machine, when it was seen, its
// figures and the ports no project owns), the audit's warning when there is one, and then the projects, the part the
// owner uses every day and the largest thing in it. Each tile carries its own live ports.
//
// Motion: one entrance for the block. A project that changes rank glides to its new place (a spring, no bounce); a
// project added or gone fades and scales from 0.97. Figures roll only when they change, and the warning and the
// project-less ports fold in and out. Reduced motion keeps the fades only.
export function LaMaquina({ machine, servers, tiles, cifras, nowMs }: { machine: Machine | undefined; servers: LiveServer[]; tiles: Tile[]; cifras: boolean; nowMs: number }) {
  const w = words(HOME_PARTS);
  const reducido = useReducedMotion() ?? false;
  const t = machine?.totals;
  const warn = machine && t ? t.orphan + t.stale + machine.findings.length : 0;
  const seen = machine?.items.reduce((m, it) => (it.last_seen_at && it.last_seen_at > m ? it.last_seen_at : m), "") ?? "";
  const porProyecto = new Map<string, LiveServer[]>();
  for (const s of servers) if (s.slug) porProyecto.set(s.slug, [...(porProyecto.get(s.slug) ?? []), s]);
  const sueltos = servers.filter((s) => !s.slug || !tiles.some((x) => x.slug === s.slug));
  const moving = tiles.filter((x) => x.rank === 0).length;
  const waiting = tiles.filter((x) => x.rank === 1).length;
  const still = tiles.length - moving - waiting;
  const parts = [moving > 0 && w.moving(moving), waiting > 0 && w.waiting(waiting), still > 0 && w.still(still)].filter(Boolean);
  const sale: TargetAndTransition = reducido ? { opacity: 0 } : { opacity: 0, height: 0, transition: { duration: motionTokens.duration.exit, ease: [...motionTokens.ease.standard] } };
  const entra: TargetAndTransition = reducido ? { opacity: 0 } : { opacity: 0, height: 0 };
  const queda: TargetAndTransition = { opacity: 1, height: "auto", transition: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] } };

  return (
    <section id="la-mac" aria-labelledby="proyectos-titulo" className="grid animate-rise gap-4 rounded-2xl border bg-muted/30 p-3 sm:p-4" data-maquina>
      {/* The machine: small and to one side. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <Link to="/machine" className="font-medium text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground">
            {w.machine}
          </Link>
          {seen && <span className="text-xs text-muted-foreground">{w.seen(ago(seen, nowMs))}</span>}
        </p>
        {cifras && t ? (
          <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div className="flex items-baseline gap-1">
              <dd className="order-1">
                <Cifra value={t.databases} className="text-sm font-semibold text-foreground" />
              </dd>
              <dt className="order-2">{w.databases}</dt>
            </div>
            <div className="flex items-baseline gap-1">
              <dd className="order-1">
                <Cifra value={fmtKb(t.worktree_kb)} className="text-sm font-semibold text-foreground" />
              </dd>
              <dt className="order-2">{w.inWorktrees}</dt>
            </div>
          </dl>
        ) : null}
      </header>

      {/* Ports no project owns (a tool, another repo): one quiet line, folding in and out. */}
      <AnimatePresence initial={false}>
        {sueltos.length > 0 && (
          <motion.p key="sueltos" className="overflow-hidden px-1 text-xs text-muted-foreground" initial={entra} animate={queda} exit={sale}>
            <span className="mr-2">{w.otherPorts}:</span>
            {sueltos.map((s, n) => (
              <span key={`${s.owner}/${s.port}`} className="whitespace-nowrap">
                {n > 0 ? " · " : ""}
                <span className="font-mono tabular-nums">{s.port}</span> {s.owner}
              </span>
            ))}
          </motion.p>
        )}
      </AnimatePresence>

      {/* The audit's warning: only when it found something. */}
      <AnimatePresence initial={false}>
        {machine && t && warn > 0 && (
          <motion.div key="aviso" className="overflow-hidden" initial={entra} animate={queda} exit={sale}>
            <Link to="/machine" className="grid gap-1 rounded-lg border border-status-now/40 px-3 py-2.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none" style={tint("now", 8)} role="status">
              <span className="text-sm font-medium text-ink-now">
                {[machine.findings.length > 0 && w.findings(machine.findings.length), t.orphan > 0 && w.orphan(t.orphan), t.stale > 0 && w.stale(t.stale)].filter(Boolean).join(" · ")}
              </span>
              {machine.findings[0] && <span className="text-xs leading-snug wrap-anywhere text-muted-foreground">{machine.findings[0].detail}</span>}
            </Link>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The projects: what the owner looks at every day, so the largest heading and most of the room. */}
      <div className="grid gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
          <h2 id="proyectos-titulo" className="font-display text-xl font-bold tracking-tight">
            {w.projects}
          </h2>
          <span className="text-sm text-muted-foreground">{parts.join(" · ")}</span>
        </div>
        {/* auto-fill, not auto-fit: one project keeps a tile's width instead of stretching across the page. */}
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] items-stretch gap-3">
          <AnimatePresence initial={false}>
            {tiles.map((x) => (
              <motion.li
                key={x.slug}
                layout={reducido ? false : "position"}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97, transition: { duration: motionTokens.duration.exit } }}
                transition={{ ...motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.standard } }}
                className="min-w-0"
              >
                <TileCard t={x} puertos={porProyecto.get(x.slug) ?? []} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>

      <Link
        to="/machine"
        className="group inline-flex min-h-11 w-fit items-center gap-1.5 px-1 text-sm font-medium text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-8 [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground"
      >
        {w.seeMachine}
        <ArrowRightIcon className="size-3.5 transition-transform duration-150 ease-out motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </section>
  );
}

// 2.10: "Próximo", one line per date in the next two weeks; what is past its due day comes first, in warning tone.
export function Proximo({ lines, names, nowMs }: { lines: DateLine[]; names: (slug: string) => string; nowMs: number }) {
  const w = words(HOME_PARTS);
  if (lines.length === 0) return null;
  return (
    <section aria-label={w.next} className="grid animate-rise gap-3 rounded-[22px] border bg-card px-5 py-4" style={{ animationDelay: "200ms" }}>
      <Kicker>
        <CalendarIcon className="size-3.5" aria-hidden />
        {w.next}
      </Kicker>
      <ul className="grid gap-1">
        {lines.map((l) => {
          const [a] = projectAccent(l.project);
          return (
            <li key={`${l.project}:${l.key}:${l.kind}`}>
              <Link
                to={`/p/${l.project}?task=${encodeURIComponent(l.key)}`}
                className={cn(
                  "flex min-h-11 flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-xl px-2.5 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-9",
                  HOVER_ROW,
                  l.overdue && "bg-status-blocked/10",
                )}
              >
                <span className={cn("w-16 shrink-0 font-mono text-xs tabular-nums", l.overdue ? "font-semibold text-ink-blocked" : "text-muted-foreground")}>{dayText(l.on, nowMs)}</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: accentInk(a) }}>
                  <span aria-hidden className="size-1.5 rounded-full" style={{ background: a }} />
                  {names(l.project)}
                </span>
                <span className="min-w-0 flex-1 truncate"><span className="mr-1.5 font-mono text-[11px] text-muted-foreground">{l.key}</span>{l.title}</span>
                <span className={cn("text-xs", l.overdue ? "font-medium text-ink-blocked" : "text-muted-foreground")}>
                  {l.overdue ? w.overdue : l.kind === "due" ? w.due : w.notBefore}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
