// PLA-I39-6: the side page. One sheet, on the right on a Mac and from the bottom on a phone, opened by the address
// (?m=<slug>:<agent>, ?plan=<slug>, ?add=<slug>; sheetOf in lib/compania.ts), so a link reopens it. Esc and the close
// button close it and focus returns to what opened it (the Sheet's focus scope).
//   MemberPage  what a teammate is on and since when; Detener (a live run) or Reanudar (a stopped one); its queue;
//               the last thing it delivered; "Dile algo", a note on its current ticket or an order to the PO.
//   PlanPage    in progress, next and blocked (the project read); your orders with their stage, Hacer primero and
//               Quitar; goal and date (the goal dialog); Pausar; plan approval and the preview address.
//   AddPage     the role templates not on the team yet.
// The views are pure (state comes in as props) so tests call their handlers without a DOM.
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import type { OrgMember, OrgProject, OrgTemplate } from "@/lib/api";
import type { ProjectSheetData } from "@/lib/compania";
import { ago } from "@/lib/compania";
import { caption, sayTo, windowState, type Say } from "@/lib/edificio";
import { linkHref, roleName } from "@/lib/org";
import { orderText, rumboText } from "@/lib/v2";
import { BlockError, Dot, TONE_INK, eyebrow, pillGhost, pillPrimary } from "@/components/compania/parts";
import { Detalles, type Steer } from "@/components/compania/timon";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Glass } from "./window";

const pillSmall = "min-h-9 px-3.5 text-xs";
const input = "min-h-10 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

// returnTo: what opened it (a window, the project's name, the "+" window). Closing hands focus back to it.
export const SidePage = ({
  open,
  wide,
  title,
  description,
  head,
  onClose,
  returnTo,
  children,
}: {
  open: boolean;
  wide: boolean;
  title: string;
  description: string;
  head?: ReactNode;
  onClose: () => void;
  returnTo?: () => HTMLElement | null;
  children: ReactNode;
}) => (
  <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
    <SheetContent
      side={wide ? "right" : "bottom"}
      className="max-h-[92svh] overflow-y-auto bg-background sm:max-h-none data-[side=right]:sm:max-w-[460px]"
      data-side-page
      onCloseAutoFocus={(e) => {
        const el = returnTo?.();
        if (el) {
          e.preventDefault();
          el.focus();
        }
      }}
    >
      <SheetHeader className="pr-10">
        <div className="flex min-w-0 items-center gap-3">
          {head}
          <div className="min-w-0">
            <SheetTitle className="font-display text-xl font-extrabold tracking-tight break-words">{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </div>
        </div>
      </SheetHeader>
      <div className="grid gap-5 px-4 pb-8">{children}</div>
    </SheetContent>
  </Sheet>
);

const Section = ({ title, children, data }: { title: string; children: ReactNode; data?: string }) => (
  <section className="grid min-w-0 gap-1.5" data-section={data}>
    <h3 className={eyebrow}>{title}</h3>
    {children}
  </section>
);

// ---- a teammate

export const memberTitle = (m: OrgMember, p: OrgProject) => `${roleName(m.role)} de ${p.title}`;
export const MemberHead = ({ m, companyPaused }: { m: OrgMember; companyPaused?: boolean }) => (
  <span className="edi-tile" aria-hidden>
    <Glass role={m.role} state={windowState(m, companyPaused)} />
  </span>
);

export const MemberPage = ({
  project: p,
  member: m,
  now,
  steer,
  text,
  setText,
  sent,
  onSay,
}: {
  project: OrgProject;
  member: OrgMember;
  now: number;
  steer: Pick<Steer, "onRun" | "busy">;
  text: string;
  setText: (v: string) => void;
  sent?: string | null;
  onSay: (say: Say) => void;
}) => {
  const c = caption(m, now);
  const live = m.state === "running" && m.now?.run_id;
  const stopped = !live && m.last?.status === "stopped" && m.last.run_id;
  const href = m.produced ? linkHref(m.produced, p.slug) : null;
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const say = sayTo(m, text);
    if (say) onSay(say);
  };
  return (
    <>
      <Section title="Ahora" data="ahora">
        {m.state === "running" ? (
          <p className="text-sm">
            <span className="font-semibold">{m.now?.title ?? "Trabajando"}</span>
            <span className="text-muted-foreground"> · {c.sub}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{c.doing === "Sin trabajo" ? "No está trabajando ahora." : c.doing}</p>
        )}
        {(live || stopped) && (
          <div className="flex flex-wrap gap-1.5">
            {live ? (
              <button type="button" className={cn(pillGhost, pillSmall)} disabled={steer.busy === m.now!.run_id} onClick={() => steer.onRun("stop", m.now!.run_id!)} data-control="detener">
                {steer.busy === m.now!.run_id ? "…" : "Detener"}
              </button>
            ) : (
              <button type="button" className={cn(pillPrimary, pillSmall)} disabled={steer.busy === m.last!.run_id} onClick={() => steer.onRun("resume", m.last!.run_id!)} data-control="reanudar-corrida">
                {steer.busy === m.last!.run_id ? "…" : "Reanudar"}
              </button>
            )}
          </div>
        )}
      </Section>
      <Section title="En fila" data="fila">
        {(m.queue ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada en fila para este puesto.</p>
        ) : (
          <ol className="grid gap-1 text-sm" data-queue={m.queue!.length}>
            {m.queue!.map((q, i) => (
              <li key={q.key} className="flex min-w-0 gap-2">
                <span className="w-4 shrink-0 font-mono text-xs text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 break-words">{q.title}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
      <Section title="Lo último que entregó" data="entrego">
        {m.produced ? (
          href ? (
            /^https?:/.test(href) ? (
              <a href={href} target="_blank" rel="noreferrer" className="text-sm font-semibold hover:underline" data-produced>
                {m.produced.title} ↗
              </a>
            ) : (
              <Link to={href} className="text-sm font-semibold hover:underline" data-produced>
                {m.produced.title}
              </Link>
            )
          ) : (
            <p className="text-sm font-semibold">{m.produced.title}</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">Todavía nada entregado.</p>
        )}
        {m.last && <p className="text-xs text-muted-foreground">Su última corrida: {ago(m.last.at, now)}</p>}
      </Section>
      <form className="grid gap-2" onSubmit={submit} data-say>
        <label htmlFor={`say-${m.agent}`} className={eyebrow}>
          Dile algo
        </label>
        <textarea
          id={`say-${m.agent}`}
          className={cn(input, "min-h-20 py-2")}
          placeholder={m.now?.ticket ? "Lo lee en su siguiente paso" : "Va al PO como pedido para este puesto"}
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={cn(pillPrimary, pillSmall)} disabled={text.trim().length < 2} data-control="decir">
            Enviar
          </button>
          <span className="text-xs text-muted-foreground">{m.now?.ticket ? "Se anota en lo que hace ahora." : "No está en nada: se lo pides al PO."}</span>
        </div>
        {sent && (
          <p className="text-xs font-semibold text-ink-done" role="status" data-sent>
            ✓ {sent}
          </p>
        )}
      </form>
    </>
  );
};

// The stateful wrapper: the text box and what happened after sending.
export const MemberSide = ({ project, member, now, steer }: { project: OrgProject; member: OrgMember; now: number; steer: Steer }) => {
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const onSay = async (say: Say) => {
    if (say.kind === "note") {
      steer.onNote(project.slug, say.key, say.text);
      setSent("Se lo dijiste; lo lee en su siguiente paso.");
    } else {
      try {
        await steer.onAsk(project.slug, { text: say.text, now: false });
        setSent("Se lo pediste al PO.");
      } catch {
        setSent(null);
      }
    }
    setText("");
  };
  return <MemberPage project={project} member={member} now={now} steer={steer} text={text} setText={setText} sent={sent} onSay={(s) => void onSay(s)} />;
};

// ---- the plan

export const PlanPage = ({
  project: p,
  sheet,
  loading,
  error,
  onRetry,
  now,
  steer,
  onFijar,
}: {
  project: OrgProject;
  sheet?: ProjectSheetData;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  now: number;
  steer: Steer;
  onFijar?: (p: OrgProject) => void;
}) => {
  const rumbo = rumboText(p);
  const orders = (p.orders ?? []).filter((o) => o.kind === "order");
  return (
    <>
      {loading ? (
        <div className="h-32 animate-pulse rounded-xl bg-muted" aria-hidden />
      ) : error ? (
        <BlockError what="el plan" onRetry={onRetry ?? (() => {})} />
      ) : sheet ? (
        <>
          <Section title="En curso" data="en-curso">
            {sheet.in_progress.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nada en curso.</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {sheet.in_progress.map((t) => (
                  <li key={t.key} className="min-w-0 break-words">
                    {t.title}
                    {t.owner && <span className="text-muted-foreground"> · {t.owner}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Sigue" data="sigue">
            {sheet.next.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nada listo para empezar.</p>
            ) : (
              <ol className="grid gap-1 text-sm">
                {sheet.next.map((t) => (
                  <li key={t.key} className="min-w-0 break-words">
                    {t.title}
                    {t.yours && <span className="font-semibold text-ink-jorge"> · te toca</span>}
                  </li>
                ))}
              </ol>
            )}
          </Section>
          <Section title="Bloqueado" data="bloqueado">
            {sheet.blocked.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nada bloqueado.</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {sheet.blocked.map((t) => (
                  <li key={t.key} className="min-w-0 break-words">
                    {t.title}
                    {t.why && <span className="text-muted-foreground"> · {t.why}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      ) : null}
      <Section title="Tus pedidos" data="pedidos">
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No has pedido nada todavía.</p>
        ) : (
          <ul className="grid gap-2">
            {orders.map((o) => {
              const st = orderText(o, now);
              const open = o.key && o.state !== "entregada" && o.state !== "cancelada" && o.stage !== "cancelada";
              return (
                <li key={o.id} className="grid min-w-0 gap-1 border-t border-border pt-2 text-sm first:border-t-0 first:pt-0" data-order={o.state}>
                  <span className="flex min-w-0 items-start justify-between gap-2">
                    <span className="min-w-0 break-words">{o.title}</span>
                    <span className={cn("inline-flex shrink-0 items-center gap-1.5 pt-0.5 text-xs font-semibold", TONE_INK[st.tone])}>
                      <Dot tone={st.tone} /> {st.text}
                    </span>
                  </span>
                  {open && (
                    <span className="flex flex-wrap gap-1.5">
                      <button type="button" className={cn(pillGhost, pillSmall)} disabled={steer.busy === `next-${o.key}`} onClick={() => steer.onPickNext(p.slug, o.key!)} data-control="hacer-primero">
                        Hacer primero
                      </button>
                      <button type="button" className={cn(pillGhost, pillSmall)} disabled={steer.busy === `cancel-${o.key}`} onClick={() => steer.onCancelOrder(p.slug, o.key!)} data-control="quitar">
                        Quitar
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title="Meta y fecha" data="meta">
        <p className="text-sm">
          {rumbo.missing ? <span className="text-muted-foreground">Sin meta ni fecha.</span> : <>{rumbo.goal} · {rumbo.date}</>}
          {onFijar && (
            <button type="button" className="ml-2 font-semibold hover:underline" onClick={() => onFijar(p)} data-control="fijar">
              {rumbo.missing ? "Fijar" : "Cambiar"}
            </button>
          )}
        </p>
      </Section>
      <div className="flex flex-wrap gap-1.5">
        {!p.paused && (
          <button type="button" className={cn(pillGhost, pillSmall)} onClick={() => steer.onPause(p)} data-control="pausar">
            Pausar
          </button>
        )}
        <Link to={`/p/${encodeURIComponent(p.slug)}`} className={cn(pillGhost, pillSmall)}>
          Abrir el proyecto
        </Link>
      </div>
      <Detalles project={p} steer={steer} />
    </>
  );
};

// ---- adding someone

export const AddPage = ({ templates, loading, busy, onAdd, added }: { templates?: OrgTemplate[]; loading?: boolean; busy?: string | null; onAdd: (template: string) => void; added?: string | null }) =>
  loading ? (
    <div className="h-24 animate-pulse rounded-xl bg-muted" aria-hidden />
  ) : (
    <>
      {templates && templates.length > 0 ? (
        <ul className="grid gap-2" data-templates={templates.length}>
          {templates.map((t) => (
            <li key={t.slug} className="flex min-w-0 items-center justify-between gap-2 text-sm">
              <span className="min-w-0 font-semibold">{t.title}</span>
              <button type="button" className={cn(pillPrimary, pillSmall)} disabled={busy === t.slug} onClick={() => onAdd(t.slug)} data-add={t.slug}>
                {busy === t.slug ? "…" : "Sumar"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground" data-empty="templates">
          Ya están todos los puestos que hay.
        </p>
      )}
      {added && (
        <p className="text-xs font-semibold text-ink-done" role="status" data-added>
          ✓ {added} se suma; su ventana aparece en el piso.
        </p>
      )}
    </>
  );
