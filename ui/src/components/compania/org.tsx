// PLA-I33: Compañía como organización (ADR 31c1cead, Design 3a2c3385). The thread with Asistente or a PO,
// with Aceptar · Pedir cambios · Responder · Fusionar in line, and the team cards with one row per role.
// Presentational: data and actions come in as props, so test/compania-org.test.ts renders them with fake data.
// Spend is tokens, never money.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { clock, tokens, type RunBrief, type Tone } from "@/lib/compania";
import type { OrgMember, OrgPlumbing, OrgProject, Thread, ThreadAction, ThreadMessage } from "@/lib/api";
import {
  ACTION_LABEL,
  MESSAGE_MAX,
  THREAD_PAGE,
  actionStateText,
  budgetLine,
  byRole,
  isBareLink,
  lightOf,
  linkHref,
  linkLabel,
  memberLine,
  needsText,
  plumbingLine,
  roleName,
  threadItems,
  visibleMessages,
  waitsOnJorge,
} from "@/lib/org";
import { BlockError, Dot, TONE_INK, eyebrow, heading, panel, pillGhost, pillPrimary } from "@/components/compania/parts";

// ---- the one-line plumbing link to Máquina

export const PlumbingLink = ({ text, tone, className }: { text: string; tone: Tone; className?: string }) => (
  <Link
    to="/machine"
    data-plumbing={tone}
    className={cn("inline-flex min-h-8 min-w-0 items-center gap-1.5 text-xs font-medium tabular-nums hover:underline", tone === "ok" || tone === "idle" ? "text-muted-foreground" : TONE_INK[tone], className)}
  >
    <Dot tone={tone} />
    <span className="truncate">{text}</span>
    <span aria-hidden className="shrink-0">→ Máquina</span>
  </Link>
);
export const CompanyPlumbing = ({ plumbing }: { plumbing: OrgPlumbing }) => {
  const line = plumbingLine(plumbing);
  return <PlumbingLink text={`Plomería · ${line.text}`} tone={line.tone} />;
};

// ---- a link chip (MIA-01 · doc "Campos y flujos" · PR #12)

const Chip = ({ href, children }: { href: string | null; children: ReactNode }) => {
  const cls = "inline-flex max-w-full min-h-7 items-center rounded-full bg-muted px-2.5 text-xs font-medium";
  if (!href) return <span className={cn(cls, "truncate")}>{children}</span>;
  if (/^https?:/.test(href))
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cn(cls, "truncate hover:bg-muted/70 hover:underline")}>
        {children}
      </a>
    );
  return (
    <Link to={href} className={cn(cls, "truncate hover:bg-muted/70 hover:underline")}>
      {children}
    </Link>
  );
};

// ---- one message: author and role, time, text, chips, the buttons its links allow, then the result

export type MessageBusy = { id: string; action: ThreadAction } | null;

export const MessageRow = ({
  message,
  project,
  timeZone,
  readOnly,
  busy,
  error,
  onAction,
  className,
}: {
  message: ThreadMessage;
  project: string | null;
  timeZone?: string;
  readOnly?: boolean;
  busy: MessageBusy;
  error?: string | null;
  onAction: (message: ThreadMessage, action: ThreadAction, text?: string) => void;
  className?: string;
}) => {
  const [open, setOpen] = useState<ThreadAction | null>(null);
  const [text, setText] = useState("");
  const [full, setFull] = useState(false);
  const mine = message.author.role === "jorge" || message.author.agent === "jorge";
  const waiting = waitsOnJorge(message);
  const busyHere = busy?.id === message.id;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!open || text.trim().length < 2) return;
    onAction(message, open, text.trim());
    setText("");
    setOpen(null);
  };
  const long = message.body.length > 280;
  return (
    <li
      data-message={message.id}
      data-waiting={waiting ? "1" : undefined}
      className={cn("grid min-w-0 gap-1.5 rounded-2xl p-3", className, mine ? "ml-6 bg-muted/70" : "bg-card ring-1 ring-foreground/10", waiting && !readOnly && "ring-2 ring-status-jorge/60")}
    >
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate">
          <span className="font-semibold">{mine ? "Tú" : roleName(message.author.role)}</span>
          {!mine && message.author.agent !== message.author.role && <span className="text-muted-foreground"> · {message.author.agent}</span>}
        </span>
        <time className="shrink-0 font-mono text-muted-foreground tabular-nums" dateTime={message.at}>
          {clock(message.at, timeZone)}
        </time>
      </div>
      <p className={cn("text-sm leading-relaxed break-words whitespace-pre-line", long && !full && "line-clamp-6")}>{message.body}</p>
      {long && (
        <button type="button" className="justify-self-start text-xs text-muted-foreground hover:text-foreground" onClick={() => setFull(!full)}>
          {full ? "Ver menos" : "Ver todo"}
        </button>
      )}
      {message.links.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {message.links.map((l) => (
            <Chip key={`${l.kind}-${l.ref}`} href={linkHref(l, project)}>
              {linkLabel(l)}
            </Chip>
          ))}
        </div>
      )}
      {message.action_state ? (
        <p className="text-xs font-semibold text-ink-done" data-action-state={message.action_state.action}>
          {actionStateText(message.action_state)}
        </p>
      ) : message.actions.length > 0 && !readOnly ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-1.5" data-actions={message.actions.join(" ")}>
            {message.actions.map((a) => (
              <button
                key={a}
                type="button"
                data-action={a}
                className={cn(a === "aceptar" || a === "fusionar" ? pillPrimary : pillGhost, "min-h-9 px-3 text-xs")}
                disabled={busyHere}
                aria-expanded={needsText(a) ? open === a : undefined}
                onClick={() => (needsText(a) ? setOpen(open === a ? null : a) : onAction(message, a))}
              >
                {busyHere && busy?.action === a ? "…" : ACTION_LABEL[a]}
              </button>
            ))}
          </div>
          {open && (
            <form className="flex gap-2" onSubmit={submit}>
              <input
                aria-label={open === "responder" ? "Tu respuesta" : "Qué cambiar"}
                className="min-h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={open === "responder" ? "Tu respuesta" : "Qué cambiar, en una frase"}
                value={text}
                maxLength={MESSAGE_MAX}
                onChange={(e) => setText(e.target.value)}
                autoFocus
              />
              <button type="submit" className={cn(pillPrimary, "min-h-10 px-3 text-xs")} disabled={text.trim().length < 2}>
                Enviar
              </button>
            </form>
          )}
          {error && <p className="text-xs text-ink-blocked">{error}</p>}
        </div>
      ) : null}
    </li>
  );
};

// ---- the text box at the foot of a thread

export type SendState = { kind: "idle" } | { kind: "busy" } | { kind: "done"; text: string } | { kind: "error"; message: string };

export const Composer = ({ placeholder, state, disabled, onSend }: { placeholder: string; state: SendState; disabled?: string | null; onSend: (body: string) => void }) => {
  const [body, setBody] = useState("");
  const link = isBareLink(body);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (disabled || state.kind === "busy" || body.trim().length < 2) return;
    onSend(body.trim());
    setBody("");
  };
  return (
    <form className="grid gap-1.5" onSubmit={submit} data-testid="composer">
      <div className="flex items-end gap-2">
        <textarea
          aria-label={placeholder}
          rows={2}
          className="min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          placeholder={disabled ?? placeholder}
          value={body}
          maxLength={MESSAGE_MAX}
          disabled={!!disabled || state.kind === "busy"}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
          }}
        />
        <button type="submit" className={cn(pillPrimary, "min-h-11")} disabled={!!disabled || state.kind === "busy" || body.trim().length < 2}>
          {state.kind === "busy" ? "Enviando…" : "Enviar"}
        </button>
      </div>
      {link && <p className="text-xs text-muted-foreground">Un enlace suelto: Asistente lo guarda en la biblioteca de diseño.</p>}
      {state.kind === "done" && (
        <p className="text-xs" data-sent>
          {state.text}
        </p>
      )}
      {state.kind === "error" && <p className="text-xs text-ink-blocked">{state.message}</p>}
    </form>
  );
};

// ---- the thread: last 30 messages with day separators, folded to its last message on a phone

export const ThreadSkeleton = () => (
  <div className={cn(panel, "grid gap-2 p-4")} aria-hidden data-testid="thread-skeleton">
    {[0, 1, 2].map((i) => (
      <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />
    ))}
  </div>
);

export const ThreadPanel = ({
  title,
  subtitle,
  thread,
  loading,
  error,
  onRetry,
  project,
  now,
  timeZone,
  placeholder,
  readOnly,
  send,
  onSend,
  busy,
  actionError,
  onAction,
  expanded,
  onToggle,
  shown = THREAD_PAGE,
  onMore,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  thread: Thread | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  project: string | null;
  now: number;
  timeZone?: string;
  placeholder: string;
  readOnly?: string | null;
  send: SendState;
  onSend: (body: string) => void;
  busy: MessageBusy;
  actionError?: { id: string; message: string } | null;
  onAction: (message: ThreadMessage, action: ThreadAction, text?: string) => void;
  expanded: boolean;
  onToggle: () => void;
  shown?: number;
  onMore?: () => void;
  className?: string;
}) => {
  const { messages, hidden } = visibleMessages(thread?.messages ?? [], shown);
  const items = threadItems(messages, now, timeZone);
  const waiting = (thread?.messages ?? []).filter(waitsOnJorge).length;
  const total = thread?.messages.length ?? 0;
  // The newest message is at the bottom: open there, and follow new ones.
  const list = useRef<HTMLOListElement>(null);
  const newest = thread?.messages.reduce((m, x) => (x.at > m ? x.at : m), "") ?? "";
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [newest, loading]);
  return (
    <section aria-labelledby="hilo-title" data-thread={thread?.kind ?? "loading"} className={cn(panel, "grid min-w-0 content-start gap-3 p-4", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="hilo-title" className={heading}>
          {title}
        </h2>
        {waiting > 0 && !readOnly && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-jorge" data-waiting-count={waiting}>
            <Dot tone="stop" /> {waiting === 1 ? "1 te espera" : `${waiting} te esperan`}
          </span>
        )}
      </div>
      {subtitle}
      {readOnly && (
        <p role="status" className="rounded-xl bg-surface-sunken px-3 py-2 text-xs text-muted-foreground" data-readonly>
          {readOnly}
        </p>
      )}
      {loading ? (
        <div className="grid gap-2" aria-hidden data-testid="thread-skeleton">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : error ? (
        <BlockError what="el hilo" onRetry={onRetry} />
      ) : total === 0 ? (
        <p className="text-sm text-muted-foreground" data-empty="thread">
          Todavía no hay mensajes. Escribe lo que quieres y {project ? "el PO" : "Asistente"} lo vuelve trabajo.
        </p>
      ) : (
        <>
          {hidden > 0 && onMore && (
            <button type="button" className={cn("justify-self-center text-xs text-muted-foreground hover:text-foreground", !expanded && "max-sm:hidden")} onClick={onMore}>
              Ver anteriores ({hidden})
            </button>
          )}
          <ol ref={list} className="grid min-w-0 gap-2 lg:max-h-[min(62svh,720px)] lg:overflow-y-auto lg:pr-1" aria-label={`Mensajes con ${title}`}>
            {items.map((item) =>
              item.kind === "day" ? (
                <li key={`d-${item.key}`} className={cn("py-1 text-center text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase", !expanded && "max-sm:hidden")} data-day>
                  {item.label}
                </li>
              ) : (
                <MessageRow
                  key={item.message.id}
                  message={item.message}
                  project={project}
                  timeZone={timeZone}
                  readOnly={!!readOnly}
                  busy={busy}
                  error={actionError?.id === item.message.id ? actionError.message : null}
                  onAction={onAction}
                  className={!expanded && !item.last ? "max-sm:hidden" : undefined}
                />
              ),
            )}
          </ol>
          {total > 1 && (
            <button type="button" className="justify-self-start text-xs font-semibold text-muted-foreground hover:text-foreground sm:hidden" onClick={onToggle} aria-expanded={expanded} data-control="fold">
              {expanded ? "Plegar el hilo" : `Ver el hilo (${total})`}
            </button>
          )}
        </>
      )}
      <Composer placeholder={placeholder} state={send} disabled={readOnly ? "En pausa: no se le puede escribir." : null} onSend={onSend} />
    </section>
  );
};

// ---- the team: one row per role (card: short; project page: with ticket, turn and tokens)

export const TeamRows = ({ team, project, now, runs, detail }: { team: OrgMember[]; project: string; now: number; runs?: RunBrief[]; detail?: boolean }) =>
  team.length === 0 ? (
    <p className="text-sm text-muted-foreground" data-empty="team">
      Sin equipo todavía.
    </p>
  ) : (
    <ul className="grid min-w-0 gap-2" aria-label="Equipo">
      {[...team].sort(byRole).map((m) => {
        const line = memberLine(m, now);
        const run = detail ? runs?.find((r) => r.agent === m.agent) : undefined;
        const produced = m.produced ? { href: linkHref(m.produced, project), label: linkLabel(m.produced) } : null;
        return (
          <li key={m.agent} className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-2 text-sm" data-role-row={m.role} data-state={m.state} data-still={line.still ? "1" : undefined}>
            <span className="flex min-w-0 items-center gap-1.5 font-semibold">
              <Dot tone={line.tone} live={m.state === "running"} />
              <span className="truncate">{roleName(m.role)}</span>
            </span>
            <span className="grid min-w-0 gap-0.5">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate font-mono text-xs" title={line.doing}>
                  {line.doing}
                </span>
                {line.when && <span className={cn("shrink-0 text-xs whitespace-nowrap", line.still ? "text-ink-now" : "text-muted-foreground")}>{line.when}</span>}
              </span>
              {detail && (
                <span className="truncate text-xs text-muted-foreground">
                  {m.agent}
                  {run ? ` · ${run.ticket ?? "sin ticket"} · ${tokens(run.tokens)} tokens` : ""}
                </span>
              )}
              {produced && (
                <span className="min-w-0 truncate text-xs">
                  <Chip href={produced.href}>{produced.label}</Chip>
                </span>
              )}
              {m.waiting && <span className="line-clamp-2 text-xs text-ink-jorge">espera: {m.waiting}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );

export const TeamCard = ({ project, now, onPreview }: { project: OrgProject; now: number; onPreview?: (slug: string) => void }) => {
  const light = lightOf(project.light);
  const paused = project.light === "paused" || project.paused;
  const plumbing = budgetLine(project.budget, { paused });
  const unread = project.thread?.unread ?? 0;
  return (
    <li
      data-card={project.slug}
      data-light={project.light}
      className={cn(
        "grid min-w-0 content-start gap-3 rounded-[20px] p-4 ring-1",
        paused ? "bg-surface-sunken text-muted-foreground ring-foreground/10" : "bg-card ring-foreground/10",
        light.tone === "stop" && !paused && "ring-2 ring-status-blocked/60",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <h3 className={cn("line-clamp-2 min-w-0 font-display text-lg font-extrabold tracking-tight break-words", paused && "opacity-70")} title={project.title}>
          {project.title}
        </h3>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 pt-1 text-xs font-semibold", TONE_INK[light.tone])} data-light-word>
          <Dot tone={light.tone} /> {light.word}
        </span>
      </div>
      {project.goal ? (
        <p className="line-clamp-2 font-voice text-[17px] leading-snug break-words italic" title={project.goal}>
          {project.goal}
        </p>
      ) : (
        <p className="text-sm text-ink-now">Sin meta: su PO no propone ideas sin una.</p>
      )}
      <TeamRows team={project.team} project={project.slug} now={now} />
      {unread > 0 && (
        <p className="text-xs font-semibold text-ink-jorge" data-unread={unread}>
          {unread === 1 ? "1 mensaje nuevo del PO" : `${unread} mensajes nuevos del PO`}
        </p>
      )}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border pt-2">
        <PlumbingLink text={plumbing.text} tone={plumbing.tone} className="max-w-full" />
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {onPreview && (
            <button type="button" className="inline-flex min-h-9 items-center px-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => onPreview(project.slug)}>
              Vista previa
            </button>
          )}
          <Link to={`/p/${encodeURIComponent(project.slug)}`} className="inline-flex min-h-9 items-center px-1 text-sm font-semibold hover:underline">
            Abrir →
          </Link>
        </span>
      </div>
    </li>
  );
};

export const TeamCards = ({ projects, now, onPreview, onNew }: { projects: OrgProject[]; now: number; onPreview?: (slug: string) => void; onNew: () => void }) => (
  <section id="proyectos" aria-labelledby="cia-equipos" className="grid min-w-0 scroll-mt-20 content-start gap-3">
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <h2 id="cia-equipos" className={heading}>
        Equipos <span className="font-mono text-sm font-normal text-muted-foreground">{projects.length}</span>
      </h2>
      <button type="button" className={cn(pillPrimary, "min-h-9 px-3 text-[13px]")} onClick={onNew}>
        + Nuevo proyecto
      </button>
    </div>
    {projects.length === 0 ? (
      <div className={cn(panel, "grid justify-items-start gap-3 p-5")} data-empty="projects">
        <p className="font-display text-lg font-extrabold tracking-tight">Todavía no hay proyectos</p>
        <p className="text-sm text-muted-foreground">Un proyecto es un nombre y una meta. Llega con su equipo: PO, Research, Artist y Taller.</p>
        <button type="button" className={pillPrimary} onClick={onNew}>
          Crear el primer proyecto
        </button>
      </div>
    ) : (
      <ul className="grid min-w-0 gap-3 md:grid-cols-2" data-testid="team-cards">
        {projects.map((p) => (
          <TeamCard key={p.slug} project={p} now={now} onPreview={onPreview} />
        ))}
      </ul>
    )}
  </section>
);

export const TeamCardsSkeleton = () => (
  <div className="grid gap-3 md:grid-cols-2" aria-hidden data-testid="cards-skeleton">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="h-60 animate-pulse rounded-[22px] bg-muted" />
    ))}
  </div>
);

// ---- the ?vista=<slug> sheet: header, team, last 3 messages, Abrir

export const ProjectPreview = ({ project, messages, now, timeZone }: { project: OrgProject; messages: ThreadMessage[]; now: number; timeZone?: string }) => {
  const light = lightOf(project.light);
  const last = [...messages].sort((a, b) => a.at.localeCompare(b.at)).slice(-3);
  return (
    <div className="grid gap-4" data-testid="project-preview">
      <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", TONE_INK[light.tone])}>
        <Dot tone={light.tone} /> {light.word}
      </span>
      {project.goal && <p className="font-voice text-xl leading-snug break-words italic">{project.goal}</p>}
      <div className="grid gap-2">
        <p className={eyebrow}>Equipo</p>
        <TeamRows team={project.team} project={project.slug} now={now} />
      </div>
      <div className="grid gap-2">
        <p className={eyebrow}>Últimos mensajes con el PO</p>
        {last.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay mensajes.</p>
        ) : (
          <ol className="grid gap-2">
            {last.map((m) => (
              <MessageRow key={m.id} message={m} project={project.slug} timeZone={timeZone} readOnly busy={null} onAction={() => {}} />
            ))}
          </ol>
        )}
      </div>
      <Link to={`/p/${encodeURIComponent(project.slug)}`} className={cn(pillPrimary, "justify-self-start")}>
        Abrir {project.title}
      </Link>
    </div>
  );
};

// ---- PLA-I33-2: the project page's top (/p/<slug>): light, goal with Editar, plumbing line, Pausar/Reanudar

export const ProjectOrgBar = ({
  project,
  companyPaused,
  canEdit,
  onEditGoal,
  onPause,
  onResume,
}: {
  project: OrgProject;
  companyPaused: boolean;
  canEdit: boolean;
  onEditGoal: () => void;
  onPause: () => void;
  onResume: () => void;
}) => {
  const light = lightOf(project.light);
  const paused = project.paused || project.light === "paused";
  const plumbing = budgetLine(project.budget, { paused });
  return (
    <section aria-label="Proyecto" data-testid="project-org-bar" className={cn(panel, "grid min-w-0 gap-3 p-4", paused && "bg-surface-sunken")}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", TONE_INK[light.tone])} data-light-word>
          <Dot tone={light.tone} /> {light.word}
        </span>
        <PlumbingLink text={plumbing.text} tone={plumbing.tone} className="max-w-full" />
        {canEdit &&
          (project.paused ? (
            <button type="button" className={cn(pillPrimary, "min-h-9 px-3 text-xs")} onClick={onResume} data-control="reanudar">
              Reanudar
            </button>
          ) : (
            <button type="button" className={cn(pillGhost, "min-h-9 px-3 text-xs")} onClick={onPause} data-control="pausar">
              Pausar
            </button>
          ))}
      </div>
      <div className="grid min-w-0 gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={eyebrow}>Meta</p>
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={onEditGoal} data-control="editar-meta">
            Editar
          </button>
        </div>
        {project.goal ? (
          <p className="line-clamp-3 font-voice text-xl leading-snug break-words italic" title={project.goal}>
            {project.goal}
          </p>
        ) : (
          <p className="text-sm text-ink-now">Sin meta: su PO no propone ideas sin una.</p>
        )}
      </div>
      {paused && <p className="text-xs text-muted-foreground">En pausa: nada arranca aquí. Su PO despierta cuando lo reanudes.</p>}
      {!paused && companyPaused && <p className="text-xs text-muted-foreground">La compañía está detenida: nada arranca hasta reanudarla en Máquina.</p>}
    </section>
  );
};

// ---- Añadir al equipo: pick a role template and the agent is created

export type AddState = { kind: "idle" } | { kind: "busy" } | { kind: "done"; agent: string } | { kind: "error"; message: string };

export const AddToTeam = ({ templates, team, state, onAdd }: { templates: { slug: string; title: string }[]; team: OrgMember[]; state: AddState; onAdd: (template: string) => void }) => {
  const have = new Set(team.map((m) => m.template));
  const free = templates.filter((t) => !have.has(t.slug));
  const [pick, setPick] = useState(free[0]?.slug ?? "");
  if (templates.length === 0) return null;
  return (
    <form
      className="grid gap-1.5 border-t border-border pt-3"
      data-testid="add-to-team"
      onSubmit={(e) => {
        e.preventDefault();
        if (pick && state.kind !== "busy") onAdd(pick);
      }}
    >
      <label className={eyebrow} htmlFor="add-template">
        Añadir al equipo
      </label>
      {free.length === 0 ? (
        <p className="text-xs text-muted-foreground">Ya tiene todas las plantillas.</p>
      ) : (
        <div className="flex gap-2">
          <select
            id="add-template"
            className="min-h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            {free.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.title}
              </option>
            ))}
          </select>
          <button type="submit" className={cn(pillGhost, "min-h-10")} disabled={!pick || state.kind === "busy"}>
            {state.kind === "busy" ? "Añadiendo…" : "Añadir"}
          </button>
        </div>
      )}
      {state.kind === "done" && <p className="text-xs">Listo: {state.agent} lee su prompt y las notas del proyecto.</p>}
      {state.kind === "error" && <p className="text-xs text-ink-blocked">{state.message}</p>}
      {state.kind === "idle" && free.length > 0 && <p className="text-xs text-muted-foreground">Una plantilla de rol; el agente nuevo comparte el presupuesto del proyecto.</p>}
    </form>
  );
};

export const ProjectTeam = ({
  project,
  team,
  runs,
  templates,
  now,
  add,
  onAdd,
  canEdit,
}: {
  project: string;
  team: OrgMember[];
  runs?: RunBrief[];
  templates: { slug: string; title: string }[];
  now: number;
  add: AddState;
  onAdd: (template: string) => void;
  canEdit: boolean;
}) => (
  <section aria-labelledby="equipo-title" className={cn(panel, "grid min-w-0 content-start gap-3 p-4")} data-testid="project-team">
    <h2 id="equipo-title" className={heading}>
      Equipo <span className="font-mono text-sm font-normal text-muted-foreground">{team.length}</span>
    </h2>
    <TeamRows team={team} project={project} now={now} runs={runs} detail />
    {canEdit && <AddToTeam templates={templates} team={team} state={add} onAdd={onAdd} />}
  </section>
);
