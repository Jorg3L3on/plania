// Inicio's pieces around the city: the headline with its voice line, what the Mac runs, and the
// projects as a compact rail.
import { ArrowRightIcon, CalendarIcon, CheckIcon, CpuIcon, MessageCircleQuestionIcon, PauseIcon, RocketIcon, TriangleAlertIcon } from "lucide-react";
import { Link } from "react-router";
import { ProjectMark } from "@/components/plania-mark";
import { Glyph, Kicker, accentInk, projectAccent, rise, TONE_TEXT, toneVar } from "@/components/plan/visuals";
import { dayText, type DateLine } from "@/lib/due";
import type { Headline, LiveServer, Tile } from "@/lib/home";
import type { StationTone } from "@/lib/lanes";
import { ago } from "@/lib/time";
import type { Machine } from "@/lib/types";
import { cn } from "@/lib/utils";

const DATE = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long" });
const TIME = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });

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
          <span key={i} className={cn(part.tone === "jorge" && "text-ink-jorge")}>{part.text}</span>
        ))}
      </p>
    </div>
  );
}

function fmtKb(kb: number) {
  const gb = kb / 1024 / 1024;
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.round(kb / 1024)} MB`;
}

// What the Mac runs for the agents: the live ports, the counts, and the first thing the audit found.
export function LaMac({ machine, servers, names, nowMs }: { machine: Machine; servers: LiveServer[]; names: (slug: string) => string; nowMs: number }) {
  const t = machine.totals;
  const warn = t.orphan + t.stale + machine.findings.length;
  const seen = machine.items.reduce((m, it) => (it.last_seen_at && it.last_seen_at > m ? it.last_seen_at : m), "");
  return (
    <section id="la-mac" aria-label="La Mac" className="grid content-start gap-3.5 rounded-[22px] border bg-card px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Kicker className="text-ink-done">
          <CpuIcon className="size-3.5" aria-hidden />
          La Mac
        </Kicker>
        {seen && <span className="text-xs text-muted-foreground">vista {ago(seen, nowMs)}</span>}
      </div>
      <div className="grid gap-1.5">
        <span className="text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{servers.length === 0 ? "Ningún puerto vivo" : "Puertos vivos"}</span>
        {servers.map((s) => {
          const [a] = s.slug ? projectAccent(s.slug) : ["var(--status-idle)"];
          return (
            <Link key={`${s.owner}/${s.port}`} to="/machine" className="flex h-9 items-center gap-2.5 rounded-xl bg-surface-sunken px-2.5 transition hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <span aria-hidden className="size-2 rounded-full" style={{ background: a }} />
              <span className="font-mono text-[13px] font-medium">{s.port}</span>
              <span className="truncate text-xs text-foreground/80">{s.slug ? names(s.slug) : s.owner}</span>
              {s.up && <span className="ml-auto text-[11px] whitespace-nowrap text-muted-foreground">{s.up}</span>}
            </Link>
          );
        })}
      </div>
      <ul className="grid grid-cols-2 gap-2">
        <li className="grid gap-0.5 rounded-xl bg-surface-sunken px-3 py-2.5">
          <span className="font-display text-[22px] leading-none font-extrabold">{t.databases}</span>
          <span className="text-[11px] text-muted-foreground">bases de datos</span>
        </li>
        <li className="grid gap-0.5 rounded-xl bg-surface-sunken px-3 py-2.5">
          <span className="font-display text-[22px] leading-none font-extrabold">{fmtKb(t.worktree_kb)}</span>
          <span className="text-[11px] text-muted-foreground">en worktrees</span>
        </li>
      </ul>
      {warn > 0 && (
        <div className="grid gap-1 rounded-xl border border-status-now/40 px-3 py-2.5" style={tint("now", 8)}>
          <span className="text-[11px] font-bold tracking-[0.12em] text-ink-now uppercase">
            {[machine.findings.length > 0 && `${machine.findings.length} ${machine.findings.length === 1 ? "hallazgo" : "hallazgos"}`, t.orphan > 0 && `${t.orphan} sin dueño`, t.stale > 0 && `${t.stale} ${t.stale === 1 ? "obsoleto" : "obsoletos"}`].filter(Boolean).join(" · ")}
          </span>
          {machine.findings[0] && <span className="text-xs leading-snug wrap-anywhere text-foreground/80">{machine.findings[0].detail}</span>}
        </div>
      )}
      <Link to="/machine" className="inline-flex min-h-8 w-fit items-center gap-1.5 text-[13px] font-semibold text-ink-done hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        Ver la máquina <ArrowRightIcon className="size-3.5" aria-hidden />
      </Link>
    </section>
  );
}

const many = (n: number, one: string, other: string) => (n === 1 ? one : other);

function TileCard({ t, index }: { t: Tile; index: number }) {
  const [a] = projectAccent(t.slug);
  const pct = t.progress.total === 0 ? 0 : (t.progress.closed / t.progress.total) * 100;
  const allDone = t.left.initiatives === 0 && t.left.tickets === 0;
  // What needs a look, most urgent first; nothing here means nothing waits.
  const signals = [
    t.waiting > 0 && { icon: MessageCircleQuestionIcon, text: `${t.waiting} ${many(t.waiting, "decisión te espera", "decisiones te esperan")}`, cls: "text-ink-jorge font-semibold" },
    t.onHold > 0 && { icon: PauseIcon, text: `${t.onHold} ${many(t.onHold, "iniciativa en pausa", "iniciativas en pausa")}`, cls: "text-foreground/75" },
    t.orden > 0 && { icon: TriangleAlertIcon, text: `${t.orden} ${many(t.orden, "cosa por ordenar", "cosas por ordenar")}`, cls: "text-amber-700 dark:text-amber-400", title: "Lo que encontró la última revisión de Orden" },
  ].filter((x): x is { icon: typeof PauseIcon; text: string; cls: string; title?: string } => Boolean(x));
  return (
    <li className="animate-rise" style={rise(index + 3)}>
      <Link
        to={`/p/${t.slug}`}
        className="lift grid h-full content-start gap-3 rounded-[18px] border bg-card px-4 py-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        style={{ borderTop: `3px solid ${a}` }}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-2 font-display text-[22px] leading-none font-extrabold tracking-tight">
            <ProjectMark slug={t.slug} className="size-[22px]" />
            {t.title}
          </span>
          <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", TONE_TEXT[t.state.tone])}>
            <Glyph tone={t.state.tone} size={7} pulse={t.state.tone === "now"} />
            {t.state.word}
          </span>
        </span>

        {/* What is left to do: open initiatives big, open tickets under it with the bar. */}
        <span className="grid gap-1.5">
          {allDone ? (
            <span className="flex items-baseline gap-1.5 text-[15px] font-semibold text-muted-foreground">
              <CheckIcon className="size-4 self-center text-status-done" aria-hidden /> Todo hecho
            </span>
          ) : (
            <span className="flex items-baseline gap-1.5">
              <span className="font-display text-[30px] leading-none font-extrabold tabular-nums">{t.left.initiatives}</span>
              <span className="text-[14px] text-foreground/75">{many(t.left.initiatives, "iniciativa por hacer", "iniciativas por hacer")}</span>
            </span>
          )}
          {t.progress.total > 0 && (
            <span className="flex items-center gap-2" title={`${t.progress.closed} de ${t.progress.total} tareas hechas`}>
              <span className="h-[5px] flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
                <span className="block h-full rounded-full bg-status-done" style={{ width: `${pct}%` }} />
              </span>
              <span className="text-[12px] text-muted-foreground tabular-nums">
                {t.left.tickets} {many(t.left.tickets, "tarea abierta", "tareas abiertas")}
              </span>
            </span>
          )}
        </span>

        <span className="grid gap-1 text-[13px] leading-snug">
          {signals.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <CheckIcon className="size-3.5" aria-hidden /> Nada te espera
            </span>
          ) : (
            signals.map((s) => (
              <span key={s.text} className={cn("inline-flex items-center gap-1.5", s.cls)} title={s.title}>
                <s.icon className="size-3.5 shrink-0" aria-hidden /> {s.text}
              </span>
            ))
          )}
        </span>

        {/* Prod in plain words: when it last got code and what it still lacks. */}
        <span className="mt-auto grid gap-0.5 border-t pt-2.5 text-xs leading-snug text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <RocketIcon className="size-3.5 shrink-0" aria-hidden /> {t.deploy.text}
          </span>
          {t.deploy.lag && <span className="pl-5 text-amber-700 dark:text-amber-400">{t.deploy.lag}</span>}
        </span>
      </Link>
    </li>
  );
}

// The projects, as a rail: which one moves, how it goes, what its prod runs, what comes next.
export function Proyectos({ tiles }: { tiles: Tile[] }) {
  const moving = tiles.filter((t) => t.rank === 0).length;
  const waiting = tiles.filter((t) => t.rank === 1).length;
  const still = tiles.length - moving - waiting;
  const parts = [
    moving > 0 && `${moving} en marcha`,
    waiting > 0 && `${waiting} ${waiting === 1 ? "te espera" : "te esperan"}`,
    still > 0 && `${still} ${still === 1 ? "quieto" : "quietos"}`,
  ].filter(Boolean);
  return (
    <section aria-label="Proyectos" className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-[15px] font-bold tracking-[0.08em] text-muted-foreground uppercase">Proyectos</h2>
        <span className="text-[13px] text-muted-foreground">{parts.join(" · ")}</span>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,230px),1fr))] items-stretch gap-3">
        {tiles.map((t, i) => <TileCard key={t.slug} t={t} index={i} />)}
      </ul>
    </section>
  );
}

// 2.10: "Próximo", one line per date in the next two weeks; what is past its due day comes first, in warning tone.
export function Proximo({ lines, names, nowMs }: { lines: DateLine[]; names: (slug: string) => string; nowMs: number }) {
  if (lines.length === 0) return null;
  return (
    <section aria-label="Próximo" className="grid animate-rise gap-3 rounded-[22px] border bg-card px-5 py-4" style={{ animationDelay: "200ms" }}>
      <Kicker>
        <CalendarIcon className="size-3.5" aria-hidden />
        Próximo
      </Kicker>
      <ul className="grid gap-1">
        {lines.map((l) => {
          const [a] = projectAccent(l.project);
          return (
            <li key={`${l.project}:${l.key}:${l.kind}`}>
              <Link
                to={`/p/${l.project}?task=${encodeURIComponent(l.key)}`}
                className={cn(
                  "flex min-h-9 flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-xl px-2.5 py-1.5 text-sm transition hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
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
                  {l.overdue ? "venció" : l.kind === "due" ? "vence" : "no antes de"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
