// PLA-I30-3 pieces kept by PLA-I33: the run list, a doc (/ceo?doc=<id>), the new-project dialog (4a/4b) and
// the limit editor. The project sheet became the project page and its preview; the Equipo sheet left with
// the per-role limits. Plain components so tests render them; the page wraps them in a Sheet or Dialog.
import { useState, type FormEvent } from "react";
import Markdown from "react-markdown";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import {
  ago,
  roleWord,
  tokens,
  ROLE_LABEL,
  RUN_WORD,
  type NewProjectResult,
  type RunBrief,
  type RunnerRole,
} from "@/lib/compania";
import { Dot, pillGhost, pillPrimary } from "@/components/compania/parts";

export const RunList = ({ runs, now, projectTitle }: { runs: RunBrief[]; now: number; projectTitle?: (slug: string) => string }) =>
  runs.length === 0 ? (
    <p className="text-sm text-muted-foreground">Ninguna corrida todavía.</p>
  ) : (
    <ul className="grid gap-1.5">
      {runs.map((run) => {
        const failed = !run.resolved && (run.status === "fail" || run.status === "stopped");
        const escalated = /escal/i.test(run.summary);
        return (
          <li key={run.id} className="flex items-center gap-2.5 text-sm" data-run-status={run.status}>
            <Dot tone={escalated || failed ? "stop" : run.status === "ok" ? "ok" : "idle"} />
            <span className="grid min-w-0 flex-1">
              <span className="truncate">
                <span className="font-semibold">{roleWord(run.role)}</span>
                {projectTitle ? ` · ${projectTitle(run.project)}` : ""}
                {run.ticket && (
                  <>
                    {" · "}
                    <span className="font-mono text-xs">{run.ticket}</span>
                  </>
                )}
                {" · "}
                {RUN_WORD[run.status] ?? run.status}
                {run.resolved && <span className="text-muted-foreground"> · resuelto</span>}
              </span>
              {run.summary && <span className={cn("truncate text-xs text-muted-foreground", run.resolved && "line-through")}>{run.summary}</span>}
            </span>
            <span className="shrink-0 text-right font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {tokens(run.tokens)} tok · {ago(run.ended_at ?? run.started_at, now)}
            </span>
          </li>
        );
      })}
    </ul>
  );

// ---- PLA-I30-6: Pedirle al PO. One sentence becomes a Ready ticket the PO owns; the PO wakes on it.

// ---- 2a / 2b

// ---- 3a / 3b: the real roles only. No names, no hire.

// ---- Prompt ↗

export const PromptDocBody = ({ doc }: { doc: { title: string; version: number; markdown: string } }) => (
  <div className="grid gap-2" data-testid="prompt-doc">
    <p className="text-xs text-muted-foreground">v{doc.version} · se lee en la primera corrida de cada sesión</p>
    <div className="grid gap-2 text-sm leading-relaxed break-words [&_code]:font-mono [&_code]:text-xs [&_h1]:font-display [&_h1]:text-lg [&_h1]:font-extrabold [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
      <Markdown>{doc.markdown}</Markdown>
    </div>
  </div>
);

// ---- 4a / 4b: a name and a goal sentence. The project starts paused.

export type NewProjectState = { kind: "idle" } | { kind: "busy" } | { kind: "missing" } | { kind: "error"; message: string } | { kind: "done"; result: NewProjectResult; name: string; goal: string };

export const NewProjectForm = ({ state, onSubmit, onCancel }: { state: NewProjectState; onSubmit: (input: { name: string; goal: string }) => void; onCancel: () => void }) => {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && goal.trim()) onSubmit({ name: name.trim(), goal: goal.trim() });
  };
  return (
    <form className="grid gap-4" onSubmit={submit} data-testid="new-project-form">
      <label className="grid gap-1.5 text-sm">
        <span className="font-semibold">Nombre</span>
        <input
          className="min-h-11 rounded-xl bg-background px-3 ring-1 ring-foreground/15 outline-none focus:ring-2 focus:ring-foreground/40"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder="Viajia"
          required
        />
      </label>
      <label className="grid gap-1.5 text-sm">
        <span className="font-semibold">Meta, en una oración</span>
        <textarea
          className="min-h-20 rounded-xl bg-background px-3 py-2 ring-1 ring-foreground/15 outline-none focus:ring-2 focus:ring-foreground/40"
          value={goal}
          maxLength={240}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Que alguien arme su viaje en diez minutos."
          required
        />
        <span className="text-xs text-muted-foreground">Lo que tendría que ser cierto cuando el proyecto vaya bien; el PO la lee en cada corrida.</span>
      </label>
      {state.kind === "missing" && (
        <p role="alert" className="rounded-xl bg-status-now/10 p-3 text-sm text-ink-now ring-1 ring-status-now/40">
          Todavía no se pueden crear proyectos desde aquí: el servidor no tiene esa ruta (llega con PLA-I31-3). No se creó nada.
        </p>
      )}
      {state.kind === "error" && (
        <p role="alert" className="rounded-xl bg-status-blocked/10 p-3 text-sm text-ink-blocked ring-1 ring-status-blocked/40">
          {state.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">Empieza en pausa. Su PO despierta cuando lo reanudes.</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={pillPrimary} disabled={state.kind === "busy" || !name.trim() || !goal.trim()}>
          {state.kind === "busy" ? "Creando…" : "Crear proyecto"}
        </button>
        <button type="button" className={pillGhost} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
};

export const NewProjectDone = ({ state, onOpen, onClose }: { state: Extract<NewProjectState, { kind: "done" }>; onOpen: (slug: string) => void; onClose: () => void }) => {
  const promptLink = state.result.prompt_doc_id ? `/ceo?doc=${encodeURIComponent(state.result.prompt_doc_id)}` : null;
  return (
    <div className="grid gap-4" data-testid="new-project-done">
      <p className="font-voice text-lg leading-snug italic">{state.goal}</p>
      <ul className="grid gap-2 text-sm">
        <li className="flex items-center gap-2">
          <Dot tone="ok" /> Proyecto creado · clave <span className="font-mono">{state.result.key_prefix}</span>
        </li>
        <li className="flex items-center gap-2">
          <Dot tone="ok" /> Product owner creado de la plantilla
          {promptLink && (
            <Link to={promptLink} className="text-xs font-semibold hover:underline">
              Prompt ↗
            </Link>
          )}
        </li>
        <li className="flex items-center gap-2">
          <Dot tone="idle" /> Empieza en pausa · Su PO despierta cuando lo reanudes
        </li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={pillPrimary} onClick={() => onOpen(state.result.slug)}>
          Ver {state.name}
        </button>
        <button type="button" className={pillGhost} onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
};

// ---- Jorge-only number editor: the plan guard.

// PLA-21: the only limit left on screen is the plan guard (no token budgets).
export type LimitTarget = { kind: "guard"; current: number };

// PLA-I36-11: the owner's code. Six digits, nothing else.
export const isOwnerCode = (c: string) => c.length === 6 && !/\D/.test(c);

export const LimitForm = ({
  target,
  busy,
  onSave,
  onCancel,
  error,
}: {
  target: LimitTarget;
  busy?: boolean;
  onSave: (value: number) => void;
  onCancel: () => void;
  error?: string | null;
}) => {
  const [value, setValue] = useState(String(target.current));
  const parsed = value.trim() === "" ? null : Number(value.replace(/[_\s,]/g, ""));
  const valid = parsed !== null && Number.isInteger(parsed) && parsed >= 0 && parsed <= 100;
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(parsed);
      }}
    >
      <label className="grid gap-1.5 text-sm">
        <span className="font-semibold">Guardia del plan (% de la ventana de 5 h)</span>
        <input
          inputMode="numeric"
          className="min-h-11 rounded-xl bg-background px-3 font-mono ring-1 ring-foreground/15 outline-none focus:ring-2 focus:ring-foreground/40"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="70"
        />
        <span className="text-xs text-muted-foreground">Arriba de este % no arranca nada nuevo, para que te quede plan a ti.</span>
      </label>
      {error && <p className="text-sm text-ink-blocked">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={pillPrimary} disabled={!valid || busy}>
          Guardar
        </button>
        <button type="button" className={pillGhost} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
};

export const limitTitle = (_t: LimitTarget) => "Mover guardia";

// PLA-I36-11: the owner's six-digit code, from an authenticator app.
export const OwnerCodeInput = ({ value, onChange, why }: { value: string; onChange: (v: string) => void; why: string }) => (
  <label className="grid gap-1.5 text-sm" data-owner-code>
    <span className="font-semibold">Código del dueño</span>
    <input
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      className="min-h-11 w-40 rounded-xl bg-background px-3 font-mono tracking-[0.3em] ring-1 ring-foreground/15 outline-none focus:ring-2 focus:ring-foreground/40"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      placeholder="000000"
      aria-label="Código del dueño"
    />
    <span className="text-xs text-muted-foreground">{why}</span>
  </label>
);

export const OWNER_CODE_WORDS: Record<string, string> = {
  OWNER_CODE_REQUIRED: "Esto pide el código del dueño.",
  OWNER_CODE_INVALID: "Ese código no es válido o ya se usó; espera el siguiente.",
  OWNER_CODE_UNSET: "Falta configurar el código del dueño en Máquina.",
};

// PLA-I36-11: the owner's code in Máquina. Enrolled or not; set it up (or replace it) with the Plania password
// (and the current code, to replace). The secret shows once, to add it to the authenticator.
export const OwnerCodeRow = ({
  enrolled,
  busy,
  error,
  secret,
  onEnrol,
}: {
  enrolled: boolean | null;
  busy?: boolean;
  error?: string | null;
  secret?: { secret_base32: string; otpauth_uri: string } | null;
  onEnrol: (input: { password: string; code?: string }) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  return (
    <section className="grid gap-2 rounded-[18px] bg-card p-4 ring-1 ring-foreground/10" data-owner-code-row={enrolled ? "1" : "0"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-semibold">Código del dueño</span>
          <span className="text-muted-foreground"> · {enrolled == null ? "…" : enrolled ? "configurado: borrar un proyecto lo pide" : "sin configurar: solo hace falta para borrar un proyecto"}</span>
        </p>
        <button type="button" className={pillGhost} onClick={() => setOpen(!open)} aria-expanded={open}>
          {enrolled ? "Cambiar" : "Configurar"}
        </button>
      </div>
      {open && !secret && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) onEnrol({ password, code: enrolled ? code : undefined });
          }}
        >
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">Contraseña de Plania</span>
            <input type="password" className="min-h-11 rounded-xl bg-background px-3 ring-1 ring-foreground/15" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {enrolled && <OwnerCodeInput value={code} onChange={setCode} why="Para cambiarlo, el código actual." />}
          {error && <p className="text-sm text-ink-blocked">{error}</p>}
          <button type="submit" className={pillPrimary} disabled={busy || !password || (!!enrolled && !isOwnerCode(code))}>
            {busy ? "…" : "Generar código"}
          </button>
        </form>
      )}
      {secret && (
        <div className="grid gap-1 text-sm" data-owner-secret>
          <p className="font-semibold">Agrégalo a tu app de autenticación ahora; no se vuelve a mostrar.</p>
          <p className="font-mono break-all">{secret.secret_base32}</p>
          <p className="text-xs break-all text-muted-foreground">{secret.otpauth_uri}</p>
        </div>
      )}
    </section>
  );
};
