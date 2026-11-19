// PLA-I30-3 pieces kept by PLA-I33: the run list, a doc (/ceo?doc=<id>) and
// the limit editor. The project sheet became the project page and its preview; the Equipo sheet left with
// the per-role limits. Plain components so tests render them; the page wraps them in a Sheet or Dialog.
// NEWPROJ-1: the unused new-project dialog left; the sheet «Nuevo proyecto» (corriente/hojas.tsx) is the one door.
import { useState } from "react";
import Markdown from "react-markdown";
import { cn } from "@/lib/utils";
import {
  ago,
  roleWord,
  tokens,
  ROLE_LABEL,
  runWord,
  type RunBrief,
  type RunnerRole,
} from "@/lib/compania";
import { Dot, pillGhost, pillPrimary } from "@/components/compania/parts";
import { getLanguage, words, type Language } from "@/lib/i18n";
import { COMPANIA_SHEETS } from "@/lib/compania-words";

export const RunList = ({ runs, now, projectTitle }: { runs: RunBrief[]; now: number; projectTitle?: (slug: string) => string }) =>
  runs.length === 0 ? (
    <p className="text-sm text-muted-foreground">{words(COMPANIA_SHEETS).noRuns}</p>
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
                {runWord(run.status)}
                {run.resolved && <span className="text-muted-foreground">{words(COMPANIA_SHEETS).resolved}</span>}
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
    <p className="text-xs text-muted-foreground">{words(COMPANIA_SHEETS).promptRead(doc.version)}</p>
    <div className="grid gap-2 text-sm leading-relaxed break-words [&_code]:font-mono [&_code]:text-xs [&_h1]:font-display [&_h1]:text-lg [&_h1]:font-extrabold [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
      <Markdown>{doc.markdown}</Markdown>
    </div>
  </div>
);

// ---- the owner-only number editor: the plan guard.

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
  const w = words(COMPANIA_SHEETS);
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
        <span className="font-semibold">{w.guardLabel}</span>
        <input
          inputMode="numeric"
          className="min-h-11 rounded-xl bg-background px-3 font-mono ring-1 ring-foreground/15 outline-none focus:ring-2 focus:ring-foreground/40"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="70"
        />
        <span className="text-xs text-muted-foreground">{w.guardHint}</span>
      </label>
      {error && <p className="text-sm text-ink-blocked">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={pillPrimary} disabled={!valid || busy}>
          {w.save}
        </button>
        <button type="button" className={pillGhost} onClick={onCancel}>
          {w.cancel}
        </button>
      </div>
    </form>
  );
};

export const limitTitle = (_t: LimitTarget, language: Language = getLanguage()) => words(COMPANIA_SHEETS, language).moveGuard;

// PLA-I36-11: the owner's six-digit code, from an authenticator app.
export const OwnerCodeInput = ({ value, onChange, why }: { value: string; onChange: (v: string) => void; why: string }) => {
  const w = words(COMPANIA_SHEETS);
  return (
  <label className="grid gap-1.5 text-sm" data-owner-code>
    <span className="font-semibold">{w.ownerCode}</span>
    <input
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      className="min-h-11 w-40 rounded-xl bg-background px-3 font-mono tracking-[0.3em] ring-1 ring-foreground/15 outline-none focus:ring-2 focus:ring-foreground/40"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      placeholder="000000"
      aria-label={w.ownerCode}
    />
    <span className="text-xs text-muted-foreground">{why}</span>
  </label>
  );
};

// PLA-I2-10: read by other files under the same name; the language is fixed for the page load.
export const OWNER_CODE_WORDS: Record<string, string> = words(COMPANIA_SHEETS).ownerCodeWords;

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
  const w = words(COMPANIA_SHEETS);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  return (
    <section className="grid gap-2 rounded-[18px] bg-card p-4 ring-1 ring-foreground/10" data-owner-code-row={enrolled ? "1" : "0"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-semibold">{w.ownerCode}</span>
          <span className="text-muted-foreground"> · {enrolled == null ? "…" : enrolled ? w.enrolled : w.notEnrolled}</span>
        </p>
        <button type="button" className={pillGhost} onClick={() => setOpen(!open)} aria-expanded={open}>
          {enrolled ? w.change : w.setUp}
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
            <span className="font-semibold">{w.planiaPassword}</span>
            <input type="password" className="min-h-11 rounded-xl bg-background px-3 ring-1 ring-foreground/15" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {enrolled && <OwnerCodeInput value={code} onChange={setCode} why={w.currentCode} />}
          {error && <p className="text-sm text-ink-blocked">{error}</p>}
          <button type="submit" className={pillPrimary} disabled={busy || !password || (!!enrolled && !isOwnerCode(code))}>
            {busy ? "…" : w.generate}
          </button>
        </form>
      )}
      {secret && (
        <div className="grid gap-1 text-sm" data-owner-secret>
          <p className="font-semibold">{w.addNow}</p>
          <p className="font-mono break-all">{secret.secret_base32}</p>
          <p className="text-xs break-all text-muted-foreground">{secret.otpauth_uri}</p>
        </div>
      )}
    </section>
  );
};
