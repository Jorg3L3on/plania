// PLA-I35: Compañía v2 (Design afdb15dd v2, canvas docs/company-mockups/compania-v2.html, frames 1a-3c).
//   TeToca          the strip on top: one row per decision; a proposal shows its named options (recommended first),
//                   Elegir each, "1 + 2" and Responder; Jorge's own ticket Hecho / Aplazar; a PR or delivery
//                   Fusionar / Aceptar / Pedir cambios. Acting writes the result in the row and dims it.
//   ProjectReport   the card as a report, in a fixed order: name and light · week of the plan with its bar and
//                   pace · this week · Siguiente with its owner · the PO's last line (pointing to Te toca) ·
//                   Ahora (only who runs or is stuck, else why nobody) · spent / limit · Abrir. No goal, no preview.
//   PausedList      paused projects as a list: what each keeps inside, and Reanudar.
//   AsistenteFolded box and suggestions, Asistente's latest message, the day folded to one line with Ver.
// Presentational: data and actions come in as props (test/compania-v2.test.ts renders them with fake data).
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { ago, clock } from "@/lib/compania";
import type { Decision, DecisionInput, OrgProject, Thread, ThreadMessage } from "@/lib/api";
import { budgetLine, lightOf, roleName, threadItems } from "@/lib/org";
import {
  SUGGESTIONS,
  TE_TOCA_EMPTY,
  foldLine,
  latestFromAsistente,
  lightWord,
  nobodyWhy,
  nowLines,
  ordered,
  ownerChip,
  paceText,
  pausedText,
  poLine,
  pointerFor,
  stateText,
  teToca,
  thisWeekText,
  todayMessages,
  weekBar,
} from "@/lib/v2";
import { Composer, MessageRow, PlumbingLink, type SendState } from "@/components/compania/org";
import { BlockError, Dot, TONE_INK, eyebrow, heading, panel, pillGhost, pillPrimary } from "@/components/compania/parts";

const pillSmall = "min-h-9 px-3.5 text-xs";

// ---- Te toca

export type DecisionBusy = { id: string; key: string } | null;

const DecisionRow = ({
  d,
  title,
  now,
  busy,
  error,
  onAct,
}: {
  d: Decision;
  title: string;
  now: number;
  busy: DecisionBusy;
  error?: string | null;
  onAct: (d: Decision, input: DecisionInput, key: string) => void;
}) => {
  const [reply, setReply] = useState(false);
  const [text, setText] = useState("");
  const acted = !!d.state;
  const busyHere = busy?.id === d.id;
  const options = ordered(d);
  const label = (key: string, word: string) => (busyHere && busy?.key === key ? "…" : word);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 2) return;
    onAct(d, { action: "responder", text: text.trim() }, "responder");
    setReply(false);
    setText("");
  };
  return (
    <li
      data-decision={d.id}
      data-kind={d.kind}
      data-acted={acted ? "1" : undefined}
      className={cn("grid min-w-0 gap-x-4 gap-y-2 border-t border-status-jorge/20 py-3 first:border-t-0 first:pt-1 sm:grid-cols-[9rem_minmax(0,1fr)]", acted && "opacity-60")}
    >
      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
        <span className={cn("inline-block size-2 shrink-0 rounded-full", acted ? "bg-status-idle" : "bg-status-jorge")} aria-hidden />
        <span className="truncate">{title}</span>
      </span>
      <div className="grid min-w-0 gap-1.5">
        <p className="min-w-0 text-sm break-words">
          <span className="font-semibold">{d.title}</span>
          {d.ref && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{d.ref}</span>}
          <span className="text-xs text-muted-foreground"> · {ago(d.at, now)}</span>
        </p>
        {d.detail && d.kind !== "proposal" && <p className="line-clamp-2 text-xs text-muted-foreground">{d.detail}</p>}
        {acted ? (
          <p className="text-xs font-semibold text-ink-done" data-state={d.state!.action}>
            ✓ {stateText(d.state!)}
          </p>
        ) : (
          <>
            {options.length > 0 && (
              <ol className="grid gap-1" data-options={options.length}>
                {options.map((o) => (
                  <li key={o.n} className="flex min-w-0 items-start gap-2.5 max-sm:flex-wrap" data-option={o.n} data-recommended={o.recommended ? "1" : undefined}>
                    <span className="w-4 shrink-0 pt-2 font-mono text-xs text-muted-foreground">{o.n}</span>
                    <span className={cn("min-w-0 flex-1 pt-1.5 text-sm break-words", o.recommended && "font-semibold")}>
                      {o.label}
                      {o.recommended && <span className="font-normal text-muted-foreground"> · recomendado</span>}
                    </span>
                    <button
                      type="button"
                      data-action="elegir"
                      className={cn(o.recommended ? pillPrimary : pillGhost, pillSmall, "max-sm:ml-6")}
                      disabled={busyHere}
                      onClick={() => onAct(d, { action: "elegir", option: o.n }, `elegir-${o.n}`)}
                    >
                      {label(`elegir-${o.n}`, "Elegir")}
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {d.kind === "proposal" && d.detail && <span className="mr-auto min-w-0 text-xs text-muted-foreground">{d.detail}</span>}
              {d.kind === "proposal" && options.length >= 2 && (
                <button
                  type="button"
                  data-action="combo"
                  className={cn(pillGhost, pillSmall)}
                  disabled={busyHere}
                  onClick={() => onAct(d, { action: "elegir", option: [1, 2] }, "combo")}
                >
                  {label("combo", "1 + 2")}
                </button>
              )}
              {d.actions.includes("hecho") && (
                <button type="button" data-action="hecho" className={cn(pillPrimary, pillSmall)} disabled={busyHere} onClick={() => onAct(d, { action: "hecho" }, "hecho")}>
                  {label("hecho", "Hecho")}
                </button>
              )}
              {d.actions.includes("aplazar") && (
                <button type="button" data-action="aplazar" className={cn(pillGhost, pillSmall)} disabled={busyHere} onClick={() => onAct(d, { action: "aplazar" }, "aplazar")}>
                  {label("aplazar", "Aplazar")}
                </button>
              )}
              {(d.actions.includes("fusionar") || d.actions.includes("aceptar")) && (
                <button
                  type="button"
                  data-action={d.actions.includes("fusionar") ? "fusionar" : "aceptar"}
                  className={cn(pillPrimary, pillSmall)}
                  disabled={busyHere}
                  onClick={() => onAct(d, { action: d.actions.includes("fusionar") ? "fusionar" : "aceptar" }, "aceptar")}
                >
                  {label("aceptar", d.actions.includes("fusionar") ? "Fusionar" : "Aceptar")}
                </button>
              )}
              {d.actions.includes("cambios") && (
                <button type="button" data-action="cambios" className={cn(pillGhost, pillSmall)} disabled={busyHere} aria-expanded={reply} onClick={() => setReply(!reply)}>
                  Pedir cambios
                </button>
              )}
              {d.actions.includes("responder") && (
                <button type="button" data-action="responder" className={cn(pillGhost, pillSmall)} disabled={busyHere} aria-expanded={reply} onClick={() => setReply(!reply)}>
                  Responder
                </button>
              )}
            </div>
            {reply && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  if (d.actions.includes("cambios")) {
                    e.preventDefault();
                    if (text.trim().length < 2) return;
                    onAct(d, { action: "cambios", text: text.trim() }, "cambios");
                    setReply(false);
                    setText("");
                  } else submit(e);
                }}
              >
                <input
                  aria-label={d.actions.includes("cambios") ? "Qué cambiar" : "Tu respuesta"}
                  className="min-h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder={d.actions.includes("cambios") ? "Qué cambiar, en una frase" : "Tu respuesta"}
                  value={text}
                  maxLength={2000}
                  onChange={(e) => setText(e.target.value)}
                  autoFocus
                />
                <button type="submit" className={cn(pillPrimary, "min-h-10 px-3 text-xs")} disabled={text.trim().length < 2}>
                  Enviar
                </button>
              </form>
            )}
          </>
        )}
        {error && <p className="text-xs text-ink-blocked">{error}</p>}
      </div>
    </li>
  );
};

export const TeToca = ({
  decisions,
  titles,
  now,
  busy,
  errors,
  onAct,
}: {
  decisions: Decision[];
  titles: Record<string, string>;
  now: number;
  busy: DecisionBusy;
  errors?: Record<string, string>;
  onAct: (d: Decision, input: DecisionInput, key: string) => void;
}) => {
  const { rows, waiting, more } = teToca(decisions);
  return (
    <section id="te-toca" aria-labelledby="te-toca-title" data-te-toca={waiting} className="grid min-w-0 scroll-mt-20 gap-2 rounded-[22px] bg-card p-4 ring-2 ring-status-jorge/50 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="te-toca-title" className={cn(eyebrow, "text-ink-jorge")}>
          Te toca <span className="ml-1 font-mono text-foreground">{waiting}</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Las cinco primeras ·{" "}
          <Link to="/inbox" className="underline-offset-2 hover:underline">
            Todo lo tuyo en Bandeja{more > 0 ? ` (${more} más)` : ""}
          </Link>
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-empty="te-toca">
          {TE_TOCA_EMPTY}
        </p>
      ) : (
        <ul className="grid min-w-0">
          {rows.map((d) => (
            <DecisionRow key={d.id} d={d} title={(d.project && titles[d.project]) || d.project || "Compañía"} now={now} busy={busy} error={errors?.[d.id] ?? null} onAct={onAct} />
          ))}
        </ul>
      )}
    </section>
  );
};

// ---- the card as a report

export const ProjectReport = ({ project: p, decisions, now, companyPaused, timeZone }: { project: OrgProject; decisions: Decision[]; now: number; companyPaused: boolean; timeZone?: string }) => {
  const light = lightOf(p.light);
  const pace = p.plan ? paceText(p.plan) : null;
  const po = poLine(p);
  const pointer = pointerFor(decisions, p.slug);
  const working = nowLines(p);
  const plumbing = budgetLine(p.budget, { paused: p.paused || p.light === "paused" });
  const next = p.next ? ownerChip(p.next.owner) : null;
  return (
    <li data-card={p.slug} data-light={p.light} className={cn(panel, "grid min-w-0 content-start gap-3 p-4 sm:p-5", light.tone === "stop" && "ring-2 ring-status-jorge/50")}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <h3 className="line-clamp-2 min-w-0 font-display text-2xl font-extrabold tracking-tight break-words" title={p.title}>
          {p.title}
        </h3>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 pt-1.5 text-xs font-semibold", TONE_INK[light.tone])} data-light-word>
          <Dot tone={light.tone} /> {lightWord(p, light.word, now)}
        </span>
      </div>

      {p.plan && (
        <div className="grid gap-1.5" data-plan>
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
            <span className="min-w-0">
              <span className="font-semibold">
                Semana {p.plan.week} de {p.plan.weeks}
              </span>
              <span className="text-muted-foreground max-sm:hidden"> · {p.plan.initiative.title}</span>
              <span className="text-muted-foreground">
                {" "}
                · {p.plan.done} de {p.plan.total} hechos
              </span>
            </span>
            {pace && (
              <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold", TONE_INK[pace.tone])} data-pace={p.plan.pace}>
                <Dot tone={pace.tone} /> {pace.text}
              </span>
            )}
          </div>
          <div className="flex gap-1" aria-hidden>
            {weekBar(p.plan).map((fill, i) => (
              <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-status-done" style={{ width: `${fill}%` }} />
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-sm text-muted-foreground max-sm:hidden" data-this-week>
        {thisWeekText(p, now)}
      </p>

      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-next>
        <span className={eyebrow}>Siguiente</span>
        {p.next ? (
          <>
            <span className="min-w-0 break-words">{p.next.title}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", next!.jorge ? "bg-status-jorge/15 text-ink-jorge" : "bg-muted text-muted-foreground")}>{next!.text}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Sin tickets listos</span>
        )}
      </p>

      {po && (
        <div className="grid min-w-0 gap-1 rounded-2xl bg-muted/60 p-3" data-po-line>
          <p className="text-xs">
            <span className="font-semibold">{roleName(po.role)}</span>
            <span className="text-muted-foreground"> · {ago(po.at, now)}</span>
          </p>
          <p className="line-clamp-2 text-sm leading-relaxed break-words">{po.body}</p>
          {pointer && (
            <a href="#te-toca" className="justify-self-start text-xs font-semibold text-ink-jorge hover:underline" data-pointer>
              {pointer}
            </a>
          )}
        </div>
      )}
      {!po && pointer && (
        <a href="#te-toca" className="justify-self-start text-xs font-semibold text-ink-jorge hover:underline" data-pointer>
          {pointer}
        </a>
      )}

      <div className="grid gap-1 text-sm max-sm:hidden" data-now>
        {working.length > 0 ? (
          working.map((w, i) => (
            <p key={i} className="flex min-w-0 items-center gap-2" data-role-row={w.role}>
              <Dot tone={w.tone} live={w.tone === "ok"} />
              <span className="font-semibold">{w.role}</span>
              <span className="min-w-0 truncate">{w.text}</span>
              {w.since && <span className="shrink-0 text-xs text-muted-foreground">· desde {clock(w.since, timeZone)}</span>}
            </p>
          ))
        ) : p.light === "no_budget" ? (
          <p className="text-muted-foreground">
            Gastó {plumbing.text.split(" · ")[0]} esta semana ·{" "}
            <Link to="/machine" className="font-semibold text-foreground hover:underline">
              Subir límite
            </Link>
          </p>
        ) : (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Dot tone="idle" /> Nadie trabaja ahora · <span className="font-semibold text-foreground">{nobodyWhy(p, decisions, companyPaused)}</span>
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border pt-2">
        <PlumbingLink text={plumbing.text} tone={plumbing.tone} className="max-w-full" />
        <Link to={`/p/${encodeURIComponent(p.slug)}`} className="ml-auto inline-flex min-h-9 items-center px-1 text-sm font-semibold hover:underline">
          Abrir →
        </Link>
      </div>
    </li>
  );
};

export const ProjectsSkeleton = () => (
  <div className="grid gap-3" aria-hidden data-testid="cards-skeleton">
    {[0, 1].map((i) => (
      <div key={i} className="h-56 animate-pulse rounded-[22px] bg-muted" />
    ))}
  </div>
);

// ---- En pausa

export const PausedList = ({ projects, now, busy, onResume }: { projects: OrgProject[]; now: number; busy?: string | null; onResume: (slug: string) => void }) => {
  const [all, setAll] = useState(false);
  if (projects.length === 0) return null;
  const rest = projects.slice(1);
  return (
    <section aria-labelledby="en-pausa" className="grid min-w-0 gap-1 rounded-[22px] bg-surface-sunken p-4 ring-1 ring-foreground/10" data-paused-list={projects.length}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="en-pausa" className={eyebrow}>
          En pausa <span className="ml-1 font-mono text-foreground">{projects.length}</span>
        </h2>
        <p className="text-xs text-muted-foreground max-sm:hidden">Nada arranca aquí hasta que reanudes</p>
      </div>
      <ul className="grid min-w-0">
        {projects.map((p, i) => (
          <li
            key={p.slug}
            data-paused={p.slug}
            className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-border py-2.5 first:border-t-0 sm:grid-cols-[8rem_minmax(0,1fr)_auto]", i > 0 && !all && "max-sm:hidden")}
          >
            <Link to={`/p/${encodeURIComponent(p.slug)}`} className="truncate font-semibold hover:underline">
              {p.title}
            </Link>
            <span className="min-w-0 truncate text-sm text-muted-foreground max-sm:col-start-1 max-sm:row-start-2">{pausedText(p, now)}</span>
            <button type="button" className={cn(pillGhost, pillSmall, "max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-1")} disabled={busy === p.slug} onClick={() => onResume(p.slug)} data-control="reanudar">
              {busy === p.slug ? "…" : "Reanudar"}
            </button>
          </li>
        ))}
      </ul>
      {rest.length > 0 && !all && (
        <button type="button" className="flex min-w-0 items-center justify-between gap-2 pt-1 text-left text-sm text-muted-foreground sm:hidden" onClick={() => setAll(true)} data-control="mas-pausa">
          <span className="truncate">{rest.map((p) => p.title).join(", ")}</span>
          <span className="shrink-0 font-semibold text-foreground">{rest.length} más</span>
        </button>
      )}
    </section>
  );
};

// ---- Asistente folded

export const AsistenteFolded = ({
  thread,
  loading,
  error,
  onRetry,
  projects,
  now,
  timeZone,
  send,
  onSend,
  expanded,
  onToggle,
  readOnly,
}: {
  thread: Thread | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  projects: OrgProject[];
  now: number;
  timeZone?: string;
  send: SendState;
  onSend: (body: string) => void;
  expanded: boolean;
  onToggle: () => void;
  readOnly?: string | null;
}) => {
  const messages = thread?.messages ?? [];
  const latest = latestFromAsistente(messages);
  const today = todayMessages(messages, now, timeZone);
  const items = threadItems(messages, now, timeZone);
  const row = (m: ThreadMessage) => (
    <MessageRow key={m.id} message={m} project={null} timeZone={timeZone} readOnly busy={null} onAction={() => {}} className={m.actions.length > 0 && !m.action_state ? "ring-status-jorge/40" : undefined} />
  );
  return (
    <section aria-labelledby="asistente-title" data-thread="company" data-folded={expanded ? "0" : "1"} className={cn(panel, "grid min-w-0 content-start gap-3 p-4")}>
      <div className="flex items-start gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground" aria-hidden>
          A
        </span>
        <div className="min-w-0">
          <h2 id="asistente-title" className={heading}>
            Asistente
          </h2>
          <p className="text-xs text-muted-foreground max-sm:hidden">Tu canal con la compañía. Pregunta o pide; va al PO correcto.</p>
        </div>
      </div>
      <Composer placeholder="Dile a Asistente…" state={send} disabled={readOnly ?? null} onSend={onSend} suggestions={SUGGESTIONS(projects)} />
      {loading ? (
        <div className="h-24 animate-pulse rounded-2xl bg-muted" aria-hidden data-testid="thread-skeleton" />
      ) : error ? (
        <BlockError what="el hilo" onRetry={onRetry} />
      ) : !latest ? (
        <p className="rounded-2xl bg-muted/60 p-3 text-sm text-muted-foreground" data-empty="thread">
          Todavía no hay mensajes. Pregúntame cómo va un proyecto o dime qué quieres y se lo paso a su PO.
        </p>
      ) : expanded ? (
        <ol className="grid min-w-0 gap-2 lg:max-h-[min(62svh,720px)] lg:overflow-y-auto lg:pr-1" aria-label="Mensajes con Asistente">
          {items.map((item) =>
            item.kind === "day" ? (
              <li key={`d-${item.key}`} className="py-1 text-center text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase" data-day>
                {item.label}
              </li>
            ) : (
              row(item.message)
            ),
          )}
        </ol>
      ) : (
        <ol className="grid min-w-0 gap-2" data-latest>
          {row(latest)}
        </ol>
      )}
      {latest && latest.actions.length > 0 && !latest.action_state && !expanded && (
        <a href="#te-toca" className="text-xs font-semibold text-ink-jorge hover:underline" data-pointer>
          ↑ Decidir en Te toca
        </a>
      )}
      {messages.length > 1 && (
        <button
          type="button"
          className="flex min-h-10 min-w-0 items-center justify-between gap-2 rounded-xl px-3 text-left text-xs ring-1 ring-foreground/10 hover:bg-muted"
          onClick={onToggle}
          aria-expanded={expanded}
          data-control="fold"
        >
          <span className="min-w-0 truncate">
            <span className="font-semibold">{today.length > 0 ? foldLine(today.length) : `Conversación · ${messages.length} mensajes`}</span>
          </span>
          <span className="shrink-0 font-semibold">{expanded ? "Plegar" : "Ver"}</span>
        </button>
      )}
    </section>
  );
};
