// Inicio's pieces around "Te toca": the headline with its voice line, the pulse numbers, who is
// working now (and what comes next), what the Mac runs, and the projects as a compact rail.
import { ArrowRightIcon, CpuIcon } from "lucide-react";
import { Link } from "react-router";
import { accentInk, Glyph, Kicker, projectAccent, rise, TONE_TEXT, toneVar } from "@/components/plan/visuals";
import type { Flight, Headline, LiveServer, NextUp, Tile } from "@/lib/home";
import type { StationTone } from "@/lib/lanes";
import { ago, span } from "@/lib/time";
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

export type PulseItem = { n: number; label: string; tone: StationTone | "plain"; target: string };

// Four numbers that each jump to their section.
export function Pulso({ items }: { items: PulseItem[] }) {
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <ul className="grid animate-rise grid-cols-2 gap-2.5 sm:grid-cols-4 lg:min-w-[460px]" style={rise(1)}>
      {items.map((it) => (
        <li key={it.label}>
          <button
            type="button"
            onClick={() => go(it.target)}
            className="grid w-full gap-1 rounded-[16px] border px-3.5 py-3 text-left transition hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:hover:translate-y-0"
            style={it.tone === "plain" || it.n === 0 ? undefined : { ...tint(it.tone, 9), borderColor: `color-mix(in oklab, ${toneVar(it.tone)} 35%, transparent)` }}
          >
            <span className={cn("font-display text-[28px] leading-none font-extrabold", it.n === 0 ? "text-muted-foreground" : it.tone === "plain" ? "" : TONE_TEXT[it.tone])}>{it.n}</span>
            <span className="text-xs text-foreground/80">{it.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ProjectName({ slug, title, className }: { slug: string; title: string; className?: string }) {
  const [a] = projectAccent(slug);
  return <span className={cn("font-semibold", className)} style={{ color: accentInk(a) }}>{title}</span>;
}

function FlightCard({ f, nowMs }: { f: Flight; nowMs: number }) {
  const [a] = projectAccent(f.slug);
  const chip = "inline-flex h-[22px] items-center gap-1.5 rounded-full bg-foreground/[0.07] px-2 text-[11px]";
  return (
    <article className="grid gap-2 rounded-[16px] border bg-surface-sunken px-4 py-3" style={{ borderLeft: `3px solid ${a}` }}>
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground">
        <span>
          <ProjectName slug={f.slug} title={f.projectTitle} /> ·{" "}
          <Link to={`/p/${f.slug}?task=${encodeURIComponent(f.key)}`} className="font-mono underline-offset-4 hover:underline">{f.key}</Link>
        </span>
        {f.claimedAt && <span className="font-mono">desde hace {span(f.claimedAt, nowMs)}</span>}
      </p>
      <p className="text-sm leading-snug font-medium">{f.title}</p>
      <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className={chip}>{f.agent}{f.model && <span className="text-muted-foreground/80">· {f.model.replace(/^claude-/, "").replace(/-(\d)-(\d)$/, " $1.$2")}</span>}</span>
        {f.branch && <span className={cn(chip, "font-mono")}>{f.branch}</span>}
        {f.port && <span className={cn(chip, "font-mono text-ink-done")} style={tint("done")}>{f.port}</span>}
        {f.lastSeenAt && <span className="ml-auto">visto {ago(f.lastSeenAt, nowMs)}</span>}
      </p>
    </article>
  );
}

// Who is working now; under it, the first ticket an agent can take in each project.
export function EnVuelo({ flights, nextUp, nowMs }: { flights: Flight[]; nextUp: NextUp[]; nowMs: number }) {
  const live = flights.length > 0;
  return (
    <section
      id="en-vuelo"
      aria-label={live ? "En vuelo" : "Siguiente"}
      className={cn("grid min-w-0 content-start gap-3.5 rounded-[22px] border bg-card px-5 py-5", live && "border-status-now/30")}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Kicker className={live ? "text-ink-now" : "text-ink-ready"}>
          <Glyph tone={live ? "now" : "ready"} size={8} pulse={live} />
          {live ? `En vuelo · ${flights.length}` : "Siguiente"}
        </Kicker>
        <span className="text-xs text-muted-foreground">{live ? "quién trabaja ahora y dónde" : "lo primero que un agente puede tomar"}</span>
      </div>
      {flights.map((f) => <FlightCard key={`${f.slug}/${f.key}`} f={f} nowMs={nowMs} />)}
      {live && flights.length === 0 && null}
      {(nextUp.length > 0 || !live) && (
        <div className={cn("grid gap-2", live && "border-t pt-3")}>
          {live && <span className="text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">Siguiente que pueden tomar</span>}
          {nextUp.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nada listo para tomar en ningún proyecto.</p>
          ) : (
            <ul className="grid gap-1.5 text-[13px]">
              {nextUp.map((n) => (
                <li key={`${n.slug}/${n.key}`} className={cn("flex min-w-0 items-baseline gap-2",!live && "rounded-[14px] bg-surface-sunken px-3.5 py-2.5")}>
                  <ProjectName slug={n.slug} title={n.projectTitle} className="shrink-0 text-xs" />
                  <Link to={`/p/${n.slug}?task=${encodeURIComponent(n.key)}`} className="min-w-0 flex-1 truncate underline-offset-4 hover:underline" title={n.title}>
                    <span className="mr-1.5 font-mono text-xs text-muted-foreground">{n.key}</span>
                    {n.title}
                  </Link>
                  <span className={cn("shrink-0 text-[11px] font-semibold whitespace-nowrap", TONE_TEXT[n.hold.tone])}>{n.hold.word}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
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

function TileCard({ t, index }: { t: Tile; index: number }) {
  const [a] = projectAccent(t.slug);
  const pct = t.progress.total === 0 ? 0 : (t.progress.closed / t.progress.total) * 100;
  return (
    <li className="animate-rise" style={rise(index + 3)}>
      <Link
        to={`/p/${t.slug}`}
        className="lift grid h-full content-start gap-2.5 rounded-[18px] border bg-card px-4 py-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        style={{ borderTop: `3px solid ${a}` }}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-display text-[22px] leading-none font-extrabold tracking-tight">{t.title}</span>
          <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", TONE_TEXT[t.state.tone])}>
            <Glyph tone={t.state.tone} size={7} pulse={t.state.tone === "now"} />
            {t.state.word}
          </span>
        </span>
        {/* A week of activity: one bar per day, the busiest day full height. */}
        <span className="flex h-7 items-end gap-[3px]" aria-label="Actividad de la semana">
          {t.bars.map((h, i) => (
            <span key={i} className="flex-1 rounded-t-[3px]" style={{ height: `${Math.max(4, h)}%`, background: a, opacity: h === 0 ? 0.25 : 0.4 + (h / 100) * 0.6 }} />
          ))}
        </span>
        {t.progress.total > 0 && (
          <span className="flex items-center gap-2">
            <span className="h-[5px] flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
              <span className="block h-full rounded-full bg-status-done" style={{ width: `${pct}%` }} />
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">{t.progress.closed}/{t.progress.total}</span>
          </span>
        )}
        <span className="text-xs leading-snug text-foreground/70">{t.envLine}</span>
        <span className="line-clamp-2 text-[13px] leading-snug">
          <span className="font-semibold text-muted-foreground">Siguiente · </span>
          {t.nextKey && <span className="mr-1 font-mono text-[11px] text-muted-foreground">{t.nextKey}</span>}
          {t.nextText}
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
