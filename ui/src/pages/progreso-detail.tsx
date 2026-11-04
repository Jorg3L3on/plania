import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import ReactMarkdown from "react-markdown";
import { DetailBack, useProgressScroll } from "@/components/progress/detail-frame";
import { LogEntryCard } from "@/components/progress/log-entry";
import { ProjectChip, recapGlass, recapKicker, Shot } from "@/components/progress/recap-bits";
import { RecapHero } from "@/components/progress/recap-hero";
import { RecapRhythm } from "@/components/progress/recap-rhythm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { formatDay, formatDayLong, projectColor } from "@/lib/progress";
import type { ProgressItem, ProgressSummary } from "@/lib/types";

const Missing = ({ text }: { text: string }) => (
  <div className="rounded-[26px] border border-white/10 px-5 py-10 text-center">
    <p className="font-display text-lg font-bold">{text}</p>
    <Button variant="outline" className="mt-3" asChild>
      <Link to="/progreso">Volver al progreso</Link>
    </Button>
  </div>
);

export const ProgressDayPage = () => {
  useProgressScroll();
  const { date = "" } = useParams();
  const summary = useQuery({
    queryKey: ["progress", "summary", "day", date],
    queryFn: () => api.progressSummary("day", date),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
  });
  const log = useQuery({
    queryKey: ["progress", "log", date, date],
    queryFn: () => api.progressLog({ from: date, to: date }),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return <Missing text="Ese día no existe" />;
  const day = log.data?.days[0];
  const projects = new Set(day?.entries.map((entry) => entry.project) ?? []).size;
  return (
    <div className="mx-auto w-full max-w-[960px]">
      <DetailBack title={formatDayLong(date)} hint={day ? `${day.total === 1 ? "1 cosa" : `${day.total} cosas`} · ${projects} proyectos` : "Tu día"} />
      {summary.isPending && <Skeleton className="h-64 rounded-[32px]" />}
      {summary.isError && <Missing text="No se pudo abrir ese día" />}
      {summary.data && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3.5">
            <RecapHero data={summary.data} />
            <RecapRhythm data={summary.data} />
          </div>
          <div className="flex flex-col gap-2.5">
            {log.data?.days.flatMap((block) => block.entries).map((entry) => (
              <LogEntryCard key={entry.id} entry={entry} q="" />
            ))}
            {log.data && (day?.entries.length ?? 0) === 0 && <p className="text-sm text-[#a1a1aa]">Nada cerrado este día.</p>}
          </div>
        </div>
      )}
    </div>
  );
};

export const ProgressYearPage = () => {
  useProgressScroll();
  const { year = "" } = useParams();
  const ok = /^\d{4}$/.test(year);
  const summary = useQuery({
    queryKey: ["progress", "summary", "year", year],
    queryFn: () => api.progressSummary("year", `${year}-07-01`),
    enabled: ok,
  });
  if (!ok) return <Missing text="Ese año no existe" />;
  return (
    <div className="mx-auto w-full max-w-[960px]">
      <DetailBack title={`Tu ${year}`} hint="Solo para ti. No se comparte." />
      {summary.isPending && <Skeleton className="h-80 rounded-[32px]" />}
      {summary.data && <YearBody data={summary.data} />}
    </div>
  );
};

const YearBody = ({ data }: { data: ProgressSummary }) => {
  const year = data.year;
  const ranked = year.by_project.filter((project) => project.count > 0).slice().sort((a, b) => b.count - a.count);
  const max = ranked[0]?.count ?? 1;
  const best = year.project_of_year;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#ff5b2e] via-[#ff2d75] to-[#6d28d9] px-6 py-7">
        <p className="text-[13px] font-black tracking-[0.2em]">TU {year.year} EN PLANIA</p>
        <p className="mt-6 font-display text-[120px] leading-[0.8] font-black tracking-tight">{year.finished}</p>
        <h2 className="mt-2 font-display text-3xl leading-none font-black">cosas terminadas.</h2>
        <div className="mt-4 flex gap-2">
          <Pill n={year.active_days} label="días activos" />
          <Pill n={year.prs} label="PRs" />
        </div>
      </section>
      <section className={`${recapGlass} px-5 py-5`}>
        <p className={recapKicker}>Tus récords</p>
        <p className="mt-3 font-display text-3xl leading-tight font-black">
          Tu mejor racha: <span className="bg-gradient-to-r from-white via-[#ffd2b8] to-[#ff8a5c] bg-clip-text text-transparent">{year.best_streak} días</span>
        </p>
        {year.best_day && (
          <p className="mt-4 text-xl font-black">
            Tu día más productivo: <span className="text-[#6ee7b7]">{formatDay(year.best_day.date)} · {year.best_day.count} cosas</span>
          </p>
        )}
        <p className="mt-4 text-xl font-black">Bugs aplastados: <span className="text-[#f472b6]">{year.bugs}</span></p>
      </section>
      <section className={`${recapGlass} px-5 py-5 lg:col-span-2`}>
        <p className={`${recapKicker} text-[#a7f3d0]`}>Tu proyecto del año</p>
        <h2 className="mt-1 font-display text-4xl font-black">{best ? best.title : "Todavía ninguno"}</h2>
        {best && <p className="text-xl font-black text-[#6ee7b7]">{best.count} cosas</p>}
        <div className="mt-4 flex h-48 items-end gap-2">
          {ranked.map((project) => (
            <Link key={project.slug} to={`/progreso/proyecto/${project.slug}`} className="flex min-w-0 flex-1 flex-col justify-end" style={{ height: `${Math.max(18, (project.count / max) * 100)}%` }}>
              <span className="rounded-t-2xl px-2 py-2 text-black" style={{ background: projectColor(project.slug) }}>
                <b className="block text-2xl font-black">{project.count}</b>
                <span className="text-[12px] font-extrabold">{project.title}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
};

const Pill = ({ n, label }: { n: number; label: string }) => (
  <span className="rounded-2xl bg-black/25 px-3 py-2">
    <b className="block text-xl font-black">{n}</b>
    <span className="text-[12px] font-bold">{label}</span>
  </span>
);

export const ProgressProjectPage = () => {
  useProgressScroll();
  const { slug = "" } = useParams();
  const summary = useQuery({
    queryKey: ["progress", "summary", "year", "now"],
    queryFn: () => api.progressSummary("year"),
  });
  const year = summary.data?.year.year;
  const log = useQuery({
    queryKey: ["progress", "log", "project", slug, year ?? 0],
    queryFn: () => api.progressLog({ from: `${year}-01-01`, to: `${year}-12-31`, project: slug }),
    enabled: slug.length > 0 && year !== undefined,
  });
  const project = summary.data?.year.by_project.find((item) => item.slug === slug);
  return (
    <div className="mx-auto w-full max-w-[960px]">
      <DetailBack title={project?.title ?? slug} hint={year ? `Historial · ${year}` : "Historial"} />
      {summary.data && !project && <Missing text="Ese proyecto no está en el año" />}
      {summary.data && project && log.data && (
        <ProjectBody slug={slug} title={project.title} year={summary.data.year.year} summary={summary.data} counts={log.data.counts} />
      )}
      {(summary.isPending || (Boolean(project) && log.isPending)) && <Skeleton className="h-64 rounded-[32px]" />}
    </div>
  );
};

const ProjectBody = ({ slug, title, year, summary, counts }: { slug: string; title: string; year: number; summary: ProgressSummary; counts: Record<string, number> }) => {
  const color = projectColor(slug);
  const months = summary.year.months;
  const mine = months.map((month) => month.by_project.find((project) => project.slug === slug)?.count ?? 0);
  const max = Math.max(...mine, 1);
  const marks = summary.year.highlights.filter((item) => item.project === slug);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <section className="rounded-[28px] border border-white/10 px-5 py-5" style={{ background: `radial-gradient(80% 80% at 100% 0%, ${color}55, #0b0b10 65%)` }}>
        <p className="text-[12px] font-extrabold tracking-[0.16em]" style={{ color }}>{title.toUpperCase()} · {year}</p>
        <p className="font-display text-[88px] leading-none font-black" style={{ color }}>{counts.all ?? 0}</p>
        <p className="text-lg font-bold">cosas terminadas</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Mini n={counts.bug ?? 0} label="Bugs" />
          <Mini n={counts.pr ?? 0} label="PRs" />
          <Mini n={counts.initiative ?? 0} label="Iniciativas" />
        </div>
      </section>
      <section className={`${recapGlass} px-4 py-4`}>
        <p className={`${recapKicker} mb-3`}>Mes a mes</p>
        <div className="flex h-28 items-end gap-1">
          {mine.map((count, index) => (
            <div key={months[index]?.month ?? index} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${months[index]?.label ?? ""}: ${count}`}>
              <div className="w-full rounded-t-md" style={{ height: `${Math.max(count ? 8 : 2, (count / max) * 96)}px`, background: color, opacity: count ? 0.45 + 0.55 * (count / max) : 0.2 }} />
            </div>
          ))}
        </div>
        <div className="mt-3">
          <p className={`${recapKicker} mb-2`}>Hitos</p>
          {marks.length === 0 && <p className="text-sm text-[#a1a1aa]">Sin hitos en este año.</p>}
          {marks.map((mark) => (
            <Link key={mark.key} to={`/progreso/${mark.project}/${mark.key}`} className="block border-t border-white/10 py-2 first:border-none">
              <b className="block text-[14px]">{mark.title}</b>
              <span className="text-[12px] text-[#a1a1aa]">{formatDay(mark.day)} · {mark.change || "Cerrada"}</span>
            </Link>
          ))}
        </div>
      </section>
      <div className="flex flex-wrap gap-2 lg:col-span-2">
        {summary.year.by_project.filter((item) => item.count > 0).map((item) => (
          <Link key={item.slug} to={`/progreso/proyecto/${item.slug}`} aria-current={item.slug === slug ? "page" : undefined}>
            <ProjectChip slug={item.slug}>{item.title}</ProjectChip>
          </Link>
        ))}
      </div>
    </div>
  );
};

const Mini = ({ n, label }: { n: number; label: string }) => (
  <div className="rounded-2xl border border-white/10 bg-black/30 px-2 py-2">
    <b className="block text-2xl font-black">{n}</b>
    <span className="text-[11px] text-[#c4c4cc]">{label}</span>
  </div>
);

export const ProgressItemPage = () => {
  useProgressScroll();
  const { slug = "", key = "" } = useParams();
  const item = useQuery({
    queryKey: ["progress", "item", slug, key],
    queryFn: () => api.progressItem(slug, key),
    retry: false,
  });
  return (
    <div className="mx-auto w-full max-w-[960px]">
      {item.isPending && <Skeleton className="h-64 rounded-[32px]" />}
      {item.isError && <Missing text={item.error instanceof ApiError && item.error.status === 404 ? "Eso no cuenta en el progreso" : "No se pudo abrir"} />}
      {item.data && <ItemBody item={item.data} />}
    </div>
  );
};

const ItemBody = ({ item }: { item: ProgressItem }) => {
  const color = projectColor(item.project);
  const when = item.day ? `${formatDayLong(item.day)}${item.time ? `, ${item.time}` : ""}` : "Sin fecha de cierre";
  return (
    <>
      <DetailBack title={item.key} hint={`${item.project_title} · ${when}`} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3.5">
          <section className={`${recapGlass} px-4 py-4`} style={{ borderColor: `${color}55` }}>
            <div className="flex flex-wrap items-center gap-2">
              <ProjectChip slug={item.project}>{item.project_title}</ProjectChip>
              <span className="text-[12px] font-bold text-[#e4e4e7]">{item.type_label}</span>
            </div>
            <h2 className="mt-3 font-display text-[28px] leading-tight font-black">{item.title}</h2>
            {item.summary && <p className="mt-2 text-[14px] leading-snug text-[#a1a1aa]">{item.summary}</p>}
          </section>
          {(item.images.before || item.images.after) && (
            <section className={`${recapGlass} px-4 py-4`}>
              <p className={`${recapKicker} mb-3`}>Antes y después</p>
              <div className="flex gap-2">
                <Shot src={item.images.before} label="ANTES" tone="before" alt={`Antes: ${item.title}`} />
                <Shot src={item.images.after} label="DESPUÉS" tone="after" alt={`Después: ${item.title}`} />
              </div>
            </section>
          )}
          {item.change && (
            <section className={`${recapGlass} px-4 py-4`}>
              <p className={recapKicker}>Qué cambió</p>
              <p className="mt-2 text-[14px] leading-snug">{item.change}</p>
              {item.doc && (
                <div className="prose prose-invert prose-sm mt-4 max-w-none text-[#d4d4d8]">
                  <ReactMarkdown>{item.doc}</ReactMarkdown>
                </div>
              )}
            </section>
          )}
        </div>
        <div className="flex flex-col gap-3.5">
          {item.kind === "initiative" && (
            <section className={`${recapGlass} px-4 py-4`}>
              <p className={recapKicker}>Tickets</p>
              <p className="mt-1 font-display text-3xl font-black" style={{ color }}>{item.child_done}/{item.child_total}</p>
              <ul>
                {item.children.map((child) => (
                  <li key={child.key} className="border-t border-white/10 py-2 first:border-none">
                    <Link to={`/progreso/${item.project}/${child.key}`} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <b className="block text-[14px]">{child.title}</b>
                        {child.summary && <span className="text-[12px] text-[#a1a1aa]">{child.summary}</span>}
                      </span>
                      {child.pr_number && <span className="text-[12px] font-extrabold text-[#c4b5fd]">#{child.pr_number}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {item.prs.length > 0 && (
            <section className={`${recapGlass} px-4 py-4`}>
              <p className={`${recapKicker} mb-2`}>Pull requests</p>
              {item.prs.map((pr) => (
                <a key={pr.number} href={pr.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 border-t border-white/10 py-2 text-[14px] first:border-none">
                  <span className="text-[#c4b5fd]">#{pr.number}</span>
                  <span className="min-w-0 flex-1">{pr.title}</span>
                </a>
              ))}
            </section>
          )}
          {item.timeline.length > 0 && (
            <section className={`${recapGlass} px-4 py-4`}>
              <p className={`${recapKicker} mb-2`}>Línea de tiempo</p>
              {item.timeline.map((step, index) => (
                <div key={`${step.day}-${step.time}-${index}`} className="border-t border-white/10 py-2 first:border-none">
                  <b className="block text-[14px]">{formatDayLong(step.day)} · {step.label}</b>
                  <p className="text-[13px] text-[#a1a1aa]">{step.text}</p>
                </div>
              ))}
            </section>
          )}
          {item.parent && (
            <Link to={`/progreso/${item.project}/${item.parent.key}`} className="text-[13px] font-bold text-[#ffd2b8]">
              Iniciativa {item.parent.key} · {item.parent.title}
            </Link>
          )}
        </div>
      </div>
    </>
  );
};
