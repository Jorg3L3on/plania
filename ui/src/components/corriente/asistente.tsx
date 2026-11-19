// PLA-I62-5: Asistente as a page (board A4), the building's side panel (ThreadPanel) redrawn. The thread, newest at
// the bottom: each answer of Asistente says what it understood and the work it made (a request or a paso, with its
// link); a message that waits on the owner is marked; its actions (Aceptar, Pedir ajuste, Responder) are the
// thread's own. One box to write. The data and calls are useThread's (GET /threads/:id, POST messages and actions).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useThread } from "@/components/compania/use-thread";
import type { ThreadAction, ThreadMessage } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import { ACTION_EFFECT, actionStateText, visibleMessages, waitsOnOwner } from "@/lib/org";
import { plainWords } from "@/lib/plain-words";
import { Btn, Label, Live, ReadError, You } from "./parts";

const LABEL: Record<ThreadAction, string> = { aceptar: "Aceptar", fusionar: "Aceptar", cambios: "Pedir ajuste", responder: "Responder" };
const needsText = (a: ThreadAction) => a === "cambios" || a === "responder";
const clockOf = (iso: string, timeZone?: string) => new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso)).toUpperCase();

const Message = ({ m, timeZone, busy, error, onAction, workTo, last }: { m: ThreadMessage; timeZone?: string; busy: { id: string; action: ThreadAction } | null; error: string | null; onAction: (m: ThreadMessage, a: ThreadAction, text?: string) => void; workTo: (kind: string, ref: string) => string | null; last: boolean }) => {
  const [open, setOpen] = useState<ThreadAction | null>(null);
  const [text, setText] = useState("");
  const [full, setFull] = useState(false);
  const mine = m.author.role === "owner" || m.author.agent === "owner";
  const waiting = !mine && waitsOnOwner(m);
  const here = busy?.id === m.id;
  const long = m.body.length > 320;
  const work = m.links.filter((l) => l.kind === "ticket" || l.kind === "idea");
  const effect = m.actions.map((a) => ACTION_EFFECT[a]).find(Boolean);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!open || text.trim().length < 2) return;
    onAction(m, open, text.trim());
    setText("");
    setOpen(null);
  };
  return (
    <li className={`cor-msg ${mine ? "mine" : ""} ${waiting ? "you" : ""}`} data-message={m.id} data-waiting={waiting || undefined}>
      <div className="cor-msg-head">
        <b>{mine ? "Tú" : seatName(m.author.role)}</b>
        {waiting && last ? <span className="cor-state amber">Sin leer · te pregunta</span> : <time className="cor-cap">{clockOf(m.at, timeZone)}</time>}
      </div>
      <p className={`cor-msg-body ${long && !full ? "cor-clamp4" : ""}`}>{mine ? m.body : plainWords(m.body)}</p>
      {long && (
        <Btn kind="link" onClick={() => setFull((x) => !x)}>
          {full ? "Ver menos" : "Ver todo"}
        </Btn>
      )}
      {work.map((l) => {
        const to = workTo(l.kind, l.ref);
        return (
          <div key={`${l.kind}-${l.ref}`} className="cor-msg-work" data-work={l.ref}>
            <span className="cor-label">Lo volvió trabajo</span>
            <span className="cor-ellipsis">
              <span className="cor-key">{l.ref}</span> {l.title}
            </span>
            {to && (
              <Link className="cor-btn link" to={to}>
                {l.kind === "idea" ? "Ver el pedido" : "Ver el paso"}
              </Link>
            )}
          </div>
        );
      })}
      {m.action_state ? (
        <p className="cor-state ok" data-action-state={m.action_state.action}>
          {actionStateText(m.action_state)}
        </p>
      ) : (
        m.actions.length > 0 && (
          <>
            <div className="cor-acts" data-actions={m.actions.join(" ")}>
              {m.actions.map((a) => (
                <Btn key={a} kind={a === "aceptar" || a === "fusionar" ? "primary" : "secondary"} disabled={here} aria-expanded={needsText(a) ? open === a : undefined} onClick={() => (needsText(a) ? setOpen(open === a ? null : a) : onAction(m, a))} data-action={a}>
                  {here && busy?.action === a ? "…" : LABEL[a]}
                </Btn>
              ))}
            </div>
            {effect && <p className="cor-cap">{effect}</p>}
            {open && (
              <form className="cor-ajuste-row" onSubmit={submit}>
                <input className="cor-input" value={text} maxLength={4000} aria-label={open === "responder" ? "Tu respuesta" : "Qué cambiar"} placeholder={open === "responder" ? "Tu respuesta" : "Qué cambiar, en una frase"} onChange={(e) => setText(e.target.value)} autoFocus />
                <Btn kind="secondary" type="submit" disabled={text.trim().length < 2}>
                  Enviar
                </Btn>
              </form>
            )}
          </>
        )
      )}
      {error && (
        <p className="cor-state bad" role="alert">
          {error}
        </p>
      )}
    </li>
  );
};

export const Asistente = ({ threadId, unread, waiting, timeZone, workTo, pedirTo, invalidate }: { threadId: string; unread: number; waiting: boolean; timeZone?: string; workTo: (kind: string, ref: string) => string | null; pedirTo: string; invalidate: string[][] }) => {
  const t = useThread(threadId, { who: "Asistente", invalidate });
  const [text, setText] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const { messages, hidden } = visibleMessages(t.thread?.messages ?? [], t.shown);
  useEffect(() => {
    list.current?.scrollTo?.({ top: list.current.scrollHeight });
  }, [messages.length]);
  useEffect(() => {
    if (t.send.kind === "done") setText("");
  }, [t.send]);
  const lastTheirs = [...messages].reverse().find((m) => m.author.role !== "owner" && m.author.agent !== "owner")?.id;
  return (
    <div className="cor-asist" data-asistente>
      <section className="cor-asist-main" aria-label="Conversación con Asistente">
        <div className="cor-asist-head">
          <h1 className="cor-h2">
            <Live /> Asistente
          </h1>
          {(unread > 0 || waiting) && (
            <span className="cor-label amber" data-unread={unread}>
              <You flat /> {unread === 1 ? "1 mensaje sin leer" : unread > 1 ? `${unread} mensajes sin leer` : "Te espera"}
              {unread > 0 && waiting ? " · te espera" : ""}
            </span>
          )}
        </div>
        {t.error && !t.thread ? (
          <ReadError what="la conversación" onRetry={t.onRetry} />
        ) : (
          <ol className="cor-msgs" ref={list} aria-busy={t.loading || undefined} tabIndex={0} aria-label="Mensajes">
            {hidden > 0 && (
              <li>
                <Btn kind="link" onClick={t.onMore}>
                  {`Ver ${hidden === 1 ? "el anterior" : `los ${hidden} anteriores`}`}
                </Btn>
              </li>
            )}
            {t.loading && <li className="cor-skel" style={{ height: 120 }} />}
            {!t.loading && messages.length === 0 && <li className="cor-text">Todavía no le has escrito. Dile qué necesitas: él lo reparte al PO correcto.</li>}
            {messages.map((m) => (
              <Message key={m.id} m={m} timeZone={timeZone} busy={t.busy} error={t.actionError?.id === m.id ? t.actionError.message : null} onAction={t.onAction} workTo={workTo} last={m.id === lastTheirs} />
            ))}
          </ol>
        )}
        <form
          className="cor-composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length < 1 || t.send.kind === "busy") return;
            t.onSend(text.trim());
          }}
        >
          <label className="cor-label" htmlFor="asist-texto">
            Tu mensaje
          </label>
          <textarea
            id="asist-texto"
            className="cor-pedir-area"
            rows={2}
            value={text}
            maxLength={4000}
            placeholder="Dile a Asistente…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (text.trim()) t.onSend(text.trim());
              }
            }}
            data-asist-text
          />
          <div className="cor-composer-foot">
            <span className="cor-cap" role="status" aria-live="polite" data-send={t.send.kind}>
              {t.send.kind === "done" ? `✓ ${t.send.text}` : t.send.kind === "error" ? <span className="cor-state bad">{t.send.message}</span> : "Un enlace suelto se guarda en la biblioteca de diseño."}
            </span>
            <Btn kind="primary" type="submit" disabled={!text.trim() || t.send.kind === "busy"} data-control="enviar-asistente">
              {t.send.kind === "busy" ? "Enviando…" : "Enviar"}
            </Btn>
          </div>
        </form>
      </section>
      <aside className="cor-tetoca-side">
        <section aria-label="Para qué sirve">
          <Label as="h2">Para qué sirve</Label>
          <ul className="cor-brief">
            <li>
              <span>
                <b>Vuelve trabajo lo que escribes.</b> Si no sabes de qué proyecto es, él lo reparte al PO correcto.
              </span>
            </li>
            <li>
              <span>
                <b>Firma el Brief de hoy.</b> Lo que cambió y lo que te espera, cada mañana.
              </span>
            </li>
            <li>
              <span>
                <b>Guarda enlaces.</b> Un enlace suelto va a la biblioteca de diseño.
              </span>
            </li>
          </ul>
        </section>
        <section aria-label="Si ya sabes el proyecto">
          <Label as="h2">Si ya sabes el proyecto</Label>
          <p className="cor-text" style={{ padding: "10px 0" }}>
            Pedir va directo a su PO y te deja elegir si le da forma, lo hace ya o solo contesta.
          </p>
          <Link className="cor-btn secondary" to={pedirTo} data-control="abrir-pedir">
            Abrir Pedir
          </Link>
        </section>
      </aside>
    </div>
  );
};
