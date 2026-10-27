// Ahora: four compact blocks — what Jorge should do, what is in flight, what is stuck, what is next.
// Same three queries as Inicio. LiveProvider already invalidates them, so there is no second refresh.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker, accentInk, projectAccent } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import { LIVENESS_WORD, URGENCY_WORD, bloqueadoOf, enCursoOf, siguienteOf, teTocaOf, type AhoraInboxItem, type Liveness } from "@/lib/ahora";
import { waitText } from "@/lib/inbox";
import { cn } from "@/lib/utils";

const LIVENESS_CLASS: Record<Liveness, string> = {
  live: "bg-status-done/12 text-ink-done",
  quiet: "bg-status-pending/40 text-muted-foreground",
  stale: "bg-status-now/16 text-ink-now",
};

function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

function Section({ id, title, tone, meta, children }: { id: string; title: string; tone: string; meta?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid content-start gap-3 rounded-[22px] border bg-card px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={`${id}-title`} className={cn("font-display text-[15px] font-bold tracking-[0.08em] uppercase", tone)}>{title}</h2>
        {meta && <p className="text-xs text-muted-foreground tabular-nums">{meta}</p>}
      </div>
      {children}
    </section>
  );
}

function ProjectName({ slug, title }: { slug: string; title: string }) {
  const [accent] = projectAccent(slug);
  return <span className="font-semibold" style={{ color: accentInk(accent) }}>{title}</span>;
}

function taskHref(slug: string, key: string) {
  return `/p/${slug}?task=${encodeURIComponent(key)}`;
}

function TeTocaRow({ item, title }: { item: AhoraInboxItem; title: string }) {
  const urgency = item.urgency ? URGENCY_WORD[item.urgency] : undefined;
  const href = item.key ? taskHref(item.project, item.key) : `/inbox?tab=${item.group === "pasos" ? "pasos" : "decisiones"}`;
  return (
    <Link to={href} className="grid min-h-11 gap-0.5 rounded-xl bg-surface-sunken px-3 py-2.5 transition hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
        <span className="min-w-0">
          <ProjectName slug={item.project} title={title} />
          {item.key && <span className="font-mono text-muted-foreground"> · {item.key}</span>}
        </span>
        <span className="text-muted-foreground">{urgency ? `${urgency} · ` : ""}espera {waitText(item.wait_s)}</span>
      </span>
      <span className="line-clamp-2 text-sm leading-snug">{item.why}</span>
    </Link>
  );
}

export function AhoraPage() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: () => api.inbox(), staleTime: 15_000 });
  const machine = useQuery({ queryKey: ["machine"], queryFn: api.machine, staleTime: 15_000 });
  const nowMs = useNow();

  const model = useMemo(() => {
    const list = projects.data ?? [];
    const prints = machine.data?.items ?? [];
    return {
      teToca: inbox.data ? teTocaOf(inbox.data) : null,
      curso: enCursoOf(list, prints, nowMs),
      bloqueado: bloqueadoOf(list, prints, nowMs),
      siguiente: siguienteOf(list),
    };
  }, [projects.data, inbox.data, machine.data, nowMs]);

  const titleOf = (slug: string) => projects.data?.find((p) => p.slug === slug)?.title ?? slug;

  if (projects.isError) return <p className="text-sm text-destructive">No se pudieron cargar los proyectos.</p>;
  if (!projects.data) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-40 rounded-[22px]" />
        <Skeleton className="h-40 rounded-[22px]" />
      </div>
    );
  }

  const teToca = model.teToca;
  const teTocaMeta = teToca && teToca.count > 0 ? (teToca.count === 1 ? "1 cosa" : `${teToca.count} cosas`) : undefined;

  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-5">
      <header className="grid gap-1">
        <Kicker className="text-muted-foreground">En este momento</Kicker>
        <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">Ahora</h1>
      </header>

      <Section id="te-toca" title="Te toca" tone="text-ink-jorge" meta={teTocaMeta}>
        {inbox.isPending && <Skeleton className="h-16 rounded-xl" />}
        {inbox.isError && <p className="text-sm text-destructive">No se pudo cargar la bandeja.</p>}
        {teToca && teToca.items.length === 0 && <p className="text-sm text-muted-foreground">Nada te toca.</p>}
        {teToca && teToca.items.length > 0 && (
          <ul className="grid gap-2">
            {teToca.items.map((item) => (
              <li key={item.id}>
                <TeTocaRow item={item} title={titleOf(item.project)} />
              </li>
            ))}
          </ul>
        )}
        {teToca && teToca.count > teToca.items.length && (
          <Link to="/inbox" className="inline-flex min-h-8 w-fit items-center text-[13px] font-semibold text-ink-jorge underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            Ver las {teToca.count} en la bandeja
          </Link>
        )}
      </Section>

      <Section id="en-curso" title="En curso" tone="text-ink-now">
        {model.curso.length === 0 && <p className="text-sm text-muted-foreground">Ningún proyecto.</p>}
        <ul className="grid gap-2">
          {model.curso.map((row) => (
            <li key={row.slug}>
              <Link to={`/p/${row.slug}`} className="grid min-h-11 gap-1 rounded-xl bg-surface-sunken px-3 py-2.5 transition hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <ProjectName slug={row.slug} title={row.title} />
                  {row.liveness && (
                    <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold", LIVENESS_CLASS[row.liveness])}>
                      {LIVENESS_WORD[row.liveness]}
                    </span>
                  )}
                </span>
                <span className="text-sm leading-snug text-foreground/80 wrap-anywhere">{row.line}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section id="bloqueado" title="Bloqueado" tone="text-ink-blocked">
          {model.bloqueado.length === 0 && <p className="text-sm text-muted-foreground">Nada bloqueado.</p>}
          {model.bloqueado.length > 0 && (
            <ul className="grid gap-2">
              {model.bloqueado.map((row) => (
                <li key={`${row.kind}/${row.slug}/${row.key}/${row.on}`}>
                  <Link to={taskHref(row.slug, row.key)} className="grid min-h-11 gap-0.5 rounded-xl bg-surface-sunken px-3 py-2.5 transition hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                    <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
                      <ProjectName slug={row.slug} title={row.title} />
                      <span className="font-mono text-muted-foreground">{row.key}</span>
                    </span>
                    <span className="text-sm leading-snug">{row.on}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="siguiente" title="Siguiente" tone="text-ink-ready">
          {model.siguiente.length === 0 && <p className="text-sm text-muted-foreground">Nada en cola.</p>}
          {model.siguiente.length > 0 && (
            <ul className="grid gap-2">
              {model.siguiente.map((row) => (
                <li key={row.slug}>
                  <Link to={taskHref(row.slug, row.key)} className="grid min-h-11 gap-0.5 rounded-xl bg-surface-sunken px-3 py-2.5 transition hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                    <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
                      <ProjectName slug={row.slug} title={row.title} />
                      <span className="font-mono text-muted-foreground">{row.key}</span>
                    </span>
                    <span className="text-sm leading-snug">{row.taskTitle}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
