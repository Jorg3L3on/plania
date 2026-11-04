import { LogEntryCard } from "@/components/progress/log-entry";
import { LogScrubber } from "@/components/progress/log-scrubber";
import { ProjectChip } from "@/components/progress/recap-bits";
import { projectColor, typeChip } from "@/lib/progress";
import type { ProgressLog, ProgressLogEntry, ProgressProjectCount } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  log: ProgressLog;
  projects: ProgressProjectCount[];
  today: string;
  project: string;
  type: string;
  q: string;
  month: string | null;
  loadingMore: boolean;
  onProject: (slug: string) => void;
  onType: (type: string) => void;
  onSearch: (q: string) => void;
  onMonth: (month: string | null) => void;
  onMore: () => void;
  onClear: () => void;
};

const CHIP_ORDER = ["bug", "code", "initiative", "pr", "idea", "ops", "research", "decision-needed", "debt"];

export const LogList = ({ log, projects, today, project, type, q, month, loadingMore, onProject, onType, onSearch, onMonth, onMore, onClear }: Props) => {
  const total = log.days.reduce((sum, day) => sum + day.entries.length, 0);
  const types = CHIP_ORDER.filter((id) => (log.counts[id] ?? 0) > 0 || id === type);
  const handleSearch = (value: string) => onSearch(value);
  return (
    <section id="bitacora" className="relative scroll-mt-16 pr-10" aria-label="Bitácora">
      <header className="mb-3">
        <h2 className="font-display text-2xl font-black tracking-tight">Lo que hice</h2>
        <p className="text-[12px] font-semibold text-[#a1a1aa]">
          {log.from} – {log.to}
          {total > 0 && ` · ${total} en esta vista`}
        </p>
      </header>
      <label className="mb-2.5 flex h-[42px] items-center gap-2 rounded-[14px] border border-white/10 bg-white/5 px-3.5 text-[13.5px] focus-within:border-[#ff7a2e88] focus-within:shadow-[0_0_0_4px_#ff7a2e22]">
        <span aria-hidden className="text-[#71717a]">⌕</span>
        <input
          value={q}
          onChange={(event) => handleSearch(event.target.value)}
          placeholder='Buscar "login", un proyecto, #293…'
          aria-label="Buscar en la bitácora"
          className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-[#71717a]"
        />
        {q && (
          <button type="button" aria-label="Borrar búsqueda" onClick={() => handleSearch("")} className="text-[#71717a]">
            ✕
          </button>
        )}
      </label>
      <div className="mb-1.5 flex gap-1.5 overflow-x-auto pb-1" role="toolbar" aria-label="Tipo">
        <Filter on={!type} onClick={() => onType("")}>
          Todo {log.counts.all ?? 0}
        </Filter>
        {types.map((id) => (
          <Filter key={id} on={type === id} onClick={() => onType(type === id ? "" : id)}>
            {typeChip(id)} {log.counts[id] ?? 0}
          </Filter>
        ))}
      </div>
      <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1" role="toolbar" aria-label="Proyecto">
        <Filter on={!project} onClick={() => onProject("")}>
          {projects.length || "Todos"} proyectos
        </Filter>
        {projects.map((item) => (
          <button key={item.slug} type="button" aria-pressed={project === item.slug} onClick={() => onProject(project === item.slug ? "" : item.slug)} className={cn(project === item.slug && "rounded-full ring-2 ring-white")}>
            <ProjectChip slug={item.slug}>{item.title}</ProjectChip>
          </button>
        ))}
      </div>
      {q.trim() && <p className="mt-2 mb-1 text-[11px] font-extrabold tracking-[0.16em] text-[#8e8e98] uppercase">{total === 1 ? "1 resultado" : `${total} resultados`}</p>}
      {log.days.length === 0 && <LogEmpty q={q} onClear={onClear} />}
      <div className="mt-2">
        {log.days.map((day) => (
          <DayBlock key={day.date} day={day} q={q} />
        ))}
      </div>
      {log.next_cursor && (
        <button type="button" onClick={onMore} disabled={loadingMore} className="mt-3 w-full rounded-2xl border border-white/10 py-3 text-[13px] font-bold text-[#ffd2b8]">
          {loadingMore ? "Cargando…" : "Días anteriores"}
        </button>
      )}
      <LogScrubber today={today} active={month} onJump={(next) => onMonth(next === month ? null : next)} />
    </section>
  );
};

const DayBlock = ({ day, q }: { day: ProgressLog["days"][number]; q: string }) => {
  const [y, m, d] = day.date.split("-");
  const month = ["", "ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"][Number(m)] ?? "";
  return (
    <div className="mb-4">
      <div className="mb-2.5 flex items-center gap-2.5">
        <div className="flex h-[50px] w-[46px] shrink-0 flex-col items-center justify-center rounded-[14px] border border-white/15 bg-gradient-to-b from-white/10 to-white/5 leading-none">
          <b className="text-[20px] font-black">{Number(d)}</b>
          <small className="mt-0.5 text-[9px] font-extrabold tracking-wider text-[#ff8a5c]">{month}</small>
        </div>
        <div className="min-w-0">
          <h3 className="text-[16px] font-extrabold">{day.weekday}</h3>
          <p className="text-[12px] text-[#a1a1aa]">
            {day.total === 1 ? "1 cosa" : `${day.total} cosas`}
            {day.best && " · tu mejor día de la vista"}
          </p>
        </div>
        <div className="ml-auto flex h-1.5 w-16 overflow-hidden rounded-full" aria-hidden>
          {day.by_project.filter((item) => item.count > 0).map((item) => (
            <span key={item.slug} className="block h-full" style={{ flexGrow: item.count, background: projectColor(item.slug) }} />
          ))}
        </div>
      </div>
      <div className="relative ml-3 border-l border-white/10 pl-4">
        <div className="flex flex-col gap-2.5">
          {day.entries.map((entry: ProgressLogEntry) => (
            <LogEntryCard key={entry.id} entry={entry} q={q} />
          ))}
        </div>
      </div>
      <span className="sr-only">{y}</span>
    </div>
  );
};

const Filter = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    aria-pressed={on}
    onClick={onClick}
    className={cn(
      "shrink-0 rounded-full border px-2.5 py-1.5 text-[12px] font-bold",
      on ? "border-white bg-white text-black" : "border-white/10 bg-white/5 text-[#d4d4d8]",
    )}
  >
    {children}
  </button>
);

const LogEmpty = ({ q, onClear }: { q: string; onClear: () => void }) => (
  <div className="mt-3 rounded-[26px] border border-white/10 bg-gradient-to-b from-white/[0.06] to-transparent px-5 py-8 text-center">
    <p className="text-5xl" aria-hidden>🔭</p>
    <h3 className="mt-2 font-display text-lg font-black">{q.trim() ? `Nada con «${q.trim()}»` : "Nada en este periodo"}</h3>
    <p className="mt-1 text-[13px] text-[#a1a1aa]">Prueba otra palabra o quita filtros.</p>
    <button type="button" onClick={onClear} className="mt-3 rounded-full border border-white/10 px-3 py-1.5 text-[12px] font-bold">
      Quitar filtros
    </button>
  </div>
);
