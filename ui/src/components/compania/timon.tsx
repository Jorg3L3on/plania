// PLA-I36 phases 3-4: the wheel on a project card (prototype on the initiative).
//   OrderBox     "Dile a <proyecto> qué sigue": Cambio / Dirección / Idea, then Enviar ahora (wakes the PO) or
//                En su turno. The PO answers with a plan in Te toca; "Cambiar algo" there puts the text back here.
//   RequestList  each request as one object: its four stages (Lo entendí · Trabajando · Pruébalo · Listo), the bot
//                working on it now (step, since, last action) with Detener, a stopped run with Seguir and Cancelar,
//                and Decirle algo (a note the agent reads at its next step).
//   Levers       Cambiar lo siguiente (pick which Ready ticket goes first) and Pausar.
//   Detalles     keys, branch words and switches live here only: plan approval and the preview address.
// Presentational: data and callbacks come in as props (test/i36-phase34.test.ts renders them with fake data).
import { useEffect, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import { clock } from "@/lib/compania";
import type { AskResult, OrderKind, OrgOrder, OrgProject } from "@/lib/api";
import { KIND_WORDS, STAGES, askText, orderText, runText, stageReached } from "@/lib/v2";
import { linkHref } from "@/lib/org";
import { Dot, TONE_INK, eyebrow, pillGhost, pillPrimary } from "@/components/compania/parts";

const pillSmall = "min-h-9 px-3.5 text-xs";

export type Steer = {
  onAsk: (slug: string, input: { text: string; kind: OrderKind; now: boolean }) => Promise<AskResult>;
  onPickNext: (slug: string, key: string) => void;
  onPause: (p: OrgProject) => void;
  onRun: (action: "stop" | "resume", runId: string) => void;
  onNote: (slug: string, key: string, text: string) => void;
  onCancelOrder: (slug: string, key: string) => void;
  onOptions: (slug: string, input: { plan_approval?: boolean; preview_url?: string | null }) => void;
  // Text handed back by "Cambiar algo", per project.
  prefill?: Record<string, string>;
  busy?: string | null;
};

// ---- the box

export const OrderBox = ({ project: p, steer }: { project: OrgProject; steer: Steer }) => {
  const [kind, setKind] = useState<OrderKind>("cambio");
  const [text, setText] = useState(steer.prefill?.[p.slug] ?? "");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    const back = steer.prefill?.[p.slug];
    if (back) setText(back);
  }, [steer.prefill, p.slug]);
  const send = async (now: boolean, e?: FormEvent) => {
    e?.preventDefault();
    if (text.trim().length < 3 || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await steer.onAsk(p.slug, { text: text.trim(), kind, now });
      setSent(askText(r));
      setText("");
    } catch {
      setError("No se pudo enviar. Si la Mac está dormida, intenta al despertar.");
    } finally {
      setSending(false);
    }
  };
  return (
    <form className="grid min-w-0 gap-2 rounded-2xl bg-muted/60 p-3" onSubmit={(e) => void send(true, e)} data-order-box>
      <label htmlFor={`box-${p.slug}`} className="text-sm font-semibold">
        Dile a {p.title} qué sigue
      </label>
      <div className="flex min-w-0 flex-wrap gap-1" role="radiogroup" aria-label="Qué es">
        {KIND_WORDS.map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={kind === k.id}
            title={k.hint}
            onClick={() => setKind(k.id)}
            className={cn("min-h-9 rounded-full px-3 text-xs font-semibold ring-1 ring-foreground/15", kind === k.id ? "bg-foreground text-background" : "bg-background")}
            data-kind={k.id}
          >
            {k.word}
          </button>
        ))}
      </div>
      <textarea
        id={`box-${p.slug}`}
        className="min-h-20 w-full min-w-0 resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder={kind === "cambio" ? "Por ejemplo: agrega un botón de WhatsApp en la portada" : kind === "direccion" ? "Por ejemplo: primero que funcione en el teléfono" : "Por ejemplo: ¿y si mandamos un recordatorio por correo?"}
        value={text}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <button type="submit" className={cn(pillPrimary, pillSmall)} disabled={sending || text.trim().length < 3} data-control="enviar-ahora">
          {sending ? "…" : "Enviar ahora"}
        </button>
        <button type="button" className={cn(pillGhost, pillSmall)} disabled={sending || text.trim().length < 3} onClick={() => void send(false)} data-control="en-su-turno">
          En su turno
        </button>
        <span className="min-w-0 text-xs text-muted-foreground max-sm:basis-full">{p.plan_approval ? "El PO te responde con un plan; nada empieza sin tu sí." : "El PO lo toma y empieza."}</span>
      </div>
      {sent && (
        <p className="text-xs font-semibold text-ink-done" role="status" data-sent>
          ✓ {sent}
        </p>
      )}
      {error && <p className="text-xs text-ink-blocked">{error}</p>}
    </form>
  );
};

// ---- the requests

const StageDots = ({ stage }: { stage: OrgOrder["stage"] }) => {
  const reached = stageReached(stage);
  return (
    <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" aria-label="Etapas" data-stage={stage ?? "enviada"}>
      {STAGES.map((s, i) => (
        <li key={s.id} className={cn("inline-flex items-center gap-1", i < reached ? "font-semibold text-foreground" : "text-muted-foreground")} aria-current={i === reached - 1 ? "step" : undefined}>
          <span className={cn("inline-block size-1.5 rounded-full", i < reached ? "bg-status-done" : "bg-muted-foreground/30")} aria-hidden />
          {s.word}
        </li>
      ))}
    </ol>
  );
};

const Request = ({ o, slug, now, timeZone, steer }: { o: OrgOrder; slug: string; now: number; timeZone?: string; steer?: Steer }) => {
  const [note, setNote] = useState(false);
  const [text, setText] = useState("");
  const st = orderText(o, now);
  const href = o.link ? linkHref(o.link, slug) : null;
  const run = o.run ?? null;
  const busy = steer?.busy;
  const cancelled = o.stage === "cancelada" || o.state === "cancelada";
  return (
    <li className="grid min-w-0 gap-1 border-t border-border pt-2 text-sm first:border-t-0 first:pt-0" data-order={o.state} data-order-kind={o.kind}>
      <span className="flex min-w-0 items-start justify-between gap-2">
        <span className="min-w-0 break-words">{o.title}</span>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 pt-0.5 text-xs font-semibold", TONE_INK[st.tone])}>
          <Dot tone={st.tone} /> {st.text}
        </span>
      </span>
      {!cancelled && <StageDots stage={o.stage} />}
      {o.understood && <span className="min-w-0 text-xs break-words text-muted-foreground">El PO entendió: {o.understood}</span>}
      {o.plan && !o.plan.approved && o.plan.needs_approval && !cancelled && (
        <a href="#te-toca" className="justify-self-start text-xs font-semibold text-ink-jorge hover:underline" data-pointer="plan">
          ↑ Su plan espera tu sí en Te toca
        </a>
      )}
      {o.plan?.approved && (
        <span className="text-xs text-muted-foreground" data-plan-progress>
          {o.plan.done} de {o.plan.steps} pasos hechos
        </span>
      )}
      {run && (
        <div className="grid min-w-0 gap-1 rounded-xl bg-muted/60 px-2.5 py-2" data-run={run.status}>
          <p className="flex min-w-0 items-start gap-2 text-xs">
            <Dot tone={run.status === "running" ? "ok" : "warn"} live={run.status === "running"} />
            <span className="min-w-0 break-words">{runText(run, (iso) => clock(iso, timeZone))}</span>
          </p>
          {steer && (
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {run.status === "running" ? (
                <button type="button" className={cn(pillGhost, pillSmall)} disabled={busy === run.id} onClick={() => steer.onRun("stop", run.id)} data-control="detener">
                  {busy === run.id ? "…" : "Detener"}
                </button>
              ) : (
                <>
                  <button type="button" className={cn(pillPrimary, pillSmall)} disabled={busy === run.id} onClick={() => steer.onRun("resume", run.id)} data-control="seguir">
                    Seguir
                  </button>
                  {o.key && (
                    <button type="button" className={cn(pillGhost, pillSmall)} onClick={() => steer.onCancelOrder(slug, o.key!)} data-control="cancelar-pedido">
                      Cancelar
                    </button>
                  )}
                </>
              )}
              <button type="button" className={cn(pillGhost, pillSmall)} aria-expanded={note} onClick={() => setNote(!note)} data-control="decirle">
                Decirle algo
              </button>
            </div>
          )}
          {note && steer && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim().length < 2) return;
                steer.onNote(slug, run.ticket, text.trim());
                setText("");
                setNote(false);
              }}
            >
              <input
                aria-label="Qué decirle"
                className="min-h-9 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm"
                placeholder="Lo lee en su siguiente paso"
                value={text}
                maxLength={1000}
                onChange={(e) => setText(e.target.value)}
              />
              <button type="submit" className={cn(pillPrimary, "min-h-9 px-3 text-xs")} disabled={text.trim().length < 2}>
                Enviar
              </button>
            </form>
          )}
        </div>
      )}
      {o.state === "entregada" && href && (
        <a href={href} {...(/^https?:/.test(href) ? { target: "_blank", rel: "noreferrer" } : {})} className="justify-self-start text-xs font-semibold hover:underline" data-order-link={o.link!.kind}>
          Ver lo que salió
        </a>
      )}
      {!run && !cancelled && o.state !== "entregada" && o.key && steer && (
        <button type="button" className="justify-self-start text-xs text-muted-foreground hover:underline" onClick={() => steer.onCancelOrder(slug, o.key!)} data-control="cancelar-pedido">
          Cancelar este pedido
        </button>
      )}
    </li>
  );
};

export const RequestList = ({ project: p, now, timeZone, steer }: { project: OrgProject; now: number; timeZone?: string; steer?: Steer }) => {
  if (!p.orders?.length) return null;
  return (
    <div className="grid min-w-0 gap-1" data-orders={p.orders.length}>
      <p className={eyebrow}>Tus pedidos</p>
      <ul className="grid min-w-0 gap-2">
        {p.orders.map((o) => (
          <Request key={o.id} o={o} slug={p.slug} now={now} timeZone={timeZone} steer={steer} />
        ))}
      </ul>
    </div>
  );
};

// ---- the levers

export const Levers = ({ project: p, steer }: { project: OrgProject; steer: Steer }) => {
  const [open, setOpen] = useState(false);
  const ready = p.ready ?? [];
  return (
    <div className="grid min-w-0 gap-1.5" data-levers>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {ready.length > 1 && (
          <button type="button" className={cn(pillGhost, pillSmall)} aria-expanded={open} onClick={() => setOpen(!open)} data-control="cambiar-siguiente">
            Cambiar lo siguiente
          </button>
        )}
        <button type="button" className={cn(pillGhost, pillSmall)} onClick={() => steer.onPause(p)} data-control="pausar">
          Pausar
        </button>
      </div>
      {open && (
        <ol className="grid min-w-0 gap-1" data-ready={ready.length}>
          {ready.map((t, i) => (
            <li key={t.key} className="flex min-w-0 items-center justify-between gap-2 text-sm">
              <span className="min-w-0 break-words">{t.title}</span>
              {i === 0 ? (
                <span className="shrink-0 text-xs text-muted-foreground">va primero</span>
              ) : (
                <button
                  type="button"
                  className={cn(pillGhost, pillSmall, "shrink-0")}
                  disabled={steer.busy === `next-${t.key}`}
                  onClick={() => {
                    steer.onPickNext(p.slug, t.key);
                    setOpen(false);
                  }}
                  data-pick={t.key}
                >
                  Que vaya primero
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

// ---- Detalles: keys and switches, out of the main lines (PLA-I36-11)

export const Detalles = ({ project: p, steer }: { project: OrgProject; steer?: Steer }) => {
  const [url, setUrl] = useState(p.preview_url ?? "");
  const keys = [
    p.plan ? `Iniciativa ${p.plan.initiative.key}` : "",
    p.next ? `Siguiente ${p.next.key}` : "",
    ...(p.orders ?? []).filter((o) => o.key).map((o) => `Pedido ${o.key}`),
  ].filter(Boolean);
  return (
    <details className="min-w-0 text-xs text-muted-foreground" data-detalles>
      <summary className="cursor-pointer font-semibold select-none">Detalles</summary>
      <div className="grid min-w-0 gap-2 pt-2">
        {keys.length > 0 && <p className="font-mono break-words">{keys.join(" · ")}</p>}
        {steer && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!p.plan_approval} onChange={(e) => steer.onOptions(p.slug, { plan_approval: e.target.checked })} data-control="aprobar-planes" />
            Aprobar el plan antes de que empiece el trabajo
          </label>
        )}
        {steer && (
          <form
            className="flex min-w-0 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              steer.onOptions(p.slug, { preview_url: url.trim() || null });
            }}
          >
            <input
              aria-label="Dirección de la vista previa"
              className="min-h-9 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm"
              placeholder="https://… vista previa"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button type="submit" className={cn(pillGhost, "min-h-9 px-3 text-xs")}>
              Guardar
            </button>
          </form>
        )}
      </div>
    </details>
  );
};
