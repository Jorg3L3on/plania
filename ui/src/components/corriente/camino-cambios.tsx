// PLA-I68-3: the change set's bar (sticky at the bottom of Camino: how many changes, where each applies) and its
// review: grouped in the order they apply, each with its before → after (or its diff) and «Descartar», then «Aplicar»,
// which stops at the first failure and says why. Applied ones leave the set and land in Historial.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { cambiosWords, counts, groups, toSend, whyDetail, whyStopped, type Dest, type Staged } from "@/lib/camino-cambios";
import type { CaminoRead } from "@/lib/camino-types";
import { Btn } from "./parts";
import { caminoKey } from "./camino-query";
import type { Cambios } from "./camino-store";
import { lostRequired, requiredIn } from "@/lib/camino-ci";
import { requiredNames } from "./camino-pruebas";
import { baseBranch } from "@/lib/camino";

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/** A toggle with a title and a line under it (aria-pressed). */
export const Tg = ({ on, title, sub, onClick, disabled, ...rest }: { on: boolean; title: ReactNode; sub?: ReactNode; onClick: () => void; disabled?: boolean } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "title">) => (
  <button type="button" className="cam-tg" aria-pressed={on} onClick={onClick} disabled={disabled} {...rest}>
    <span className="cam-sw" aria-hidden />
    <span>
      <b>{title}</b>
      {sub && <span className="cam-tg-s">{sub}</span>}
    </span>
  </button>
);

export const Diff = ({ before, after }: { before: string; after: string }) => {
  const a = before.split("\n");
  const b = after.split("\n");
  // A line diff by longest common subsequence; enough for a workflow file.
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: { t: " " | "+" | "-"; s: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ t: " ", s: a[i]! });
      i++;
      j++;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) out.push({ t: "-", s: a[i++]! });
    else out.push({ t: "+", s: b[j++]! });
  }
  while (i < n) out.push({ t: "-", s: a[i++]! });
  while (j < m) out.push({ t: "+", s: b[j++]! });
  return (
    <pre className="cam-diff" tabIndex={0}>
      {out.map((l, k) => (
        <span key={k} className={cls("cam-dl", l.t === "+" && "add", l.t === "-" && "del")}>
          {`${l.t} ${l.s}`}
          {"\n"}
        </span>
      ))}
    </pre>
  );
};

export const CambiosBar = ({ r, cambios }: { r: CaminoRead; cambios: Cambios }) => {
  const w = cambiosWords();
  const [open, setOpen] = useState(false);
  if (!cambios.items.length && !open) return null;
  const n = counts(cambios.items);
  return (
    <>
      {cambios.items.length > 0 && (
        <div className="cam-pbar" role="region" aria-label={w.pending(cambios.items.length)} data-cambios={cambios.items.length}>
          <div className="cam-pbar-c">
            <b>{w.pending(cambios.items.length)}</b>
            {(Object.keys(n) as Dest[]).map((d) => (
              <span key={d} className={cls("cam-wtag", d)}>
                {`${n[d]} ${w.where[d]}`}
              </span>
            ))}
          </div>
          <div className="cam-acts">
            <Btn kind="quiet" small onClick={cambios.clear} data-control="camino-descartar-todo">
              {w.discardAll}
            </Btn>
            <Btn kind="primary" small onClick={() => setOpen(true)} data-control="camino-revisar">
              {w.review}
            </Btn>
          </div>
        </div>
      )}
      {open && <Review r={r} cambios={cambios} onClose={() => setOpen(false)} />}
    </>
  );
};

type Outcome = { ok: boolean; error?: string; detail?: Record<string, unknown>; note?: string; pr?: { number: number; url: string } } | "skipped";

const Review = ({ r, cambios, onClose }: { r: CaminoRead; cambios: Cambios; onClose: () => void }) => {
  const w = cambiosWords();
  const wc = w.guard;
  const client = useQueryClient();
  const box = useRef<HTMLDivElement>(null);
  const [sent, setSent] = useState<Staged[] | null>(null);
  const sentRef = useRef<Staged[]>([]);
  const [outcome, setOutcome] = useState<Map<string, Outcome>>(new Map());
  const [summary, setSummary] = useState<string | null>(null);
  const list = sent ?? groups(cambios.items).flatMap((g) => g.items);
  const apply = useMutation({
    mutationFn: () => {
      sentRef.current = groups(cambios.items).flatMap((g) => g.items);
      setSent(sentRef.current);
      return api.caminoApply(r.slug, { version: r.version, changes: toSend(cambios.items) });
    },
    onSuccess: (out) => {
      const order = sentRef.current;
      const m = new Map<string, Outcome>();
      order.forEach((s, i) => {
        const res = out.results.find((x) => x.index === i);
        m.set(s.key, res ? { ok: res.ok, error: res.error, detail: res.detail, note: res.note, pr: res.pr } : "skipped");
        if (res?.ok) cambios.drop(s.key);
      });
      setOutcome(m);
      setSummary(out.stopped ? w.stopped(out.applied, whyStopped(out.stopped.error ?? "", out.stopped.detail)) : w.done(out.applied));
      client.setQueryData(caminoKey(r.slug), out.read);
    },
    onError: (e) => {
      const stale = e instanceof ApiError && e.code === "STALE_VERSION";
      setStaleSet(stale);
      setSummary(stale ? w.stale : whyStopped(e instanceof ApiError ? e.code : "network"));
    },
  });
  // PLA-I70-12: a second tab's change leaves a way forward: read again and keep what is staged.
  const [staleSet, setStaleSet] = useState(false);
  const reread = useMutation({
    mutationFn: () => api.camino(r.slug),
    onSuccess: (read) => {
      client.setQueryData(caminoKey(r.slug), read);
      setStaleSet(false);
      setSent(null);
      setSummary(w.kept);
    },
  });
  useEffect(() => {
    // PLA-I70-36: focus lands on the dialog itself (not on ✕) and Tab stays inside it.
    if (!box.current?.contains(document.activeElement)) box.current?.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !apply.isPending) return onClose();
      if (e.key !== "Tab" || !box.current) return;
      const f = [...box.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], summary, [tabindex="0"]')];
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [apply.isPending, onClose]);
  const done = !!summary && !apply.isPending;
  // PLA-I68-5: what must be said before a set with workflow changes applies; some of it holds the set back.
  const required = requiredNames(r);
  const g = r.discovery?.github.ok ? r.discovery.github : null;
  const warns: { text: string; blocks: boolean }[] = [];
  for (const s of list) {
    if (s.blocked) warns.push({ text: `${s.change.label}: ${s.blocked}`, blocks: true });
    const ch = s.change as { kind: string; path?: string; content?: string | null; id?: number; enable?: boolean; name?: string };
    if (ch.kind === "file_pr" && ch.path && /^\.github\/workflows\//.test(ch.path)) {
      const lost = lostRequired(s.diff?.before ?? "", ch.content ?? null, ch.path, required);
      if (lost.length) warns.push({ text: wc.lost(ch.path, lost.join(", ")), blocks: true });
    }
    if (ch.kind === "workflow_state" && ch.enable === false) {
      const f = g?.workflow_files.find((x) => g.workflows.find((y) => y.id === ch.id)?.path === x.path);
      const needed = f ? requiredIn(f.text, f.path, required) : [];
      if (needed.length) warns.push({ text: wc.offImpact(ch.name ?? "", needed.join(", ")), blocks: false });
    }
  }
  const held = warns.some((x) => x.blocks);
  const byDest = (["plania", "proveedor", "github", "pr"] as Dest[]).map((dest) => ({ dest, items: list.filter((x) => x.dest === dest) })).filter((g) => g.items.length);
  const pub = baseBranch(r);
  return (
    <div className="cam-review" onMouseDown={(e) => e.target === e.currentTarget && !apply.isPending && onClose()}>
      <div className="cam-rv" role="dialog" aria-modal="true" aria-labelledby="cam-rv-h" ref={box} tabIndex={-1} data-revision>
        <div className="cam-rv-h">
          <div>
            <h3 id="cam-rv-h">{w.reviewTitle(list.length)}</h3>
            <p className="cam-hint">{w.reviewLead}</p>
          </div>
          <Btn kind="quiet" small onClick={onClose} disabled={apply.isPending} aria-label={w.close} data-control="camino-cerrar-revision">
            ✕
          </Btn>
        </div>
        <div className="cam-rv-b">
          {warns.map((x) => (
            <div key={x.text} className={cls("cam-box", x.blocks ? "bad" : "warn")} data-aviso-revision={x.blocks ? "bloquea" : "avisa"}>
              {x.text}
            </div>
          ))}
          {byDest.map((g) => (
            <section key={g.dest} className="cam-rvs" aria-label={w.where[g.dest]}>
              <h4>
                {w.where[g.dest].replace(/^./, (x) => x.toUpperCase())} <span>{g.dest === "pr" ? w.sub.pr(pub) : w.sub[g.dest]}</span>
              </h4>
              <ul>
                {g.items.map((s) => {
                  const o = outcome.get(s.key);
                  const st = o === "skipped" ? "skip" : o ? (o.ok ? "done" : "fail") : null;
                  // PLA-I70-14: a change with plain lines shows them instead of the raw before → after, until it fails, is skipped or has a note.
                  const plain = !!s.lines?.length && st !== "fail" && st !== "skip" && !(st === "done" && o !== "skipped" && o?.note);
                  return (
                    <li key={s.key} className={cls(st)} data-cambio={s.key} data-estado={st ?? "pendiente"}>
                      <span className="cam-st" aria-hidden>
                        {st === "done" ? "✓" : st === "fail" ? "✗" : st === "skip" ? "–" : "·"}
                      </span>
                      <span>{s.change.label}</span>
                      {!sent && (
                        <Btn kind="quiet" small onClick={() => cambios.drop(s.key)} data-control={`descartar-${s.key}`}>
                          {w.discard}
                        </Btn>
                      )}
                      {plain ? (
                        <ul className="cam-d cam-lines" data-lineas>
                          {s.lines!.map((l) => (
                            <li key={l}>{l}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="cam-d">
                          {st === "fail" && o !== "skipped" && o ? whyStopped(o.error ?? "", o.detail) : st === "skip" ? w.skipped : st === "done" && o !== "skipped" && o?.note ? o.note : w.beforeAfter(s.from, s.to)}
                          {st === "done" && o !== "skipped" && o?.pr && (
                            <>
                              {" "}
                              <a className="cor-inline" href={o.pr.url} target="_blank" rel="noreferrer" data-pr-abierta>
                                {w.prOpened(o.pr.number)}
                              </a>
                            </>
                          )}
                        </span>
                      )}
                      {st === "fail" && o !== "skipped" && o && whyDetail(o.error ?? "", o.detail) && (
                        <details className="cam-why">
                          <summary>{w.why.detail}</summary>
                          <p className="cam-hint">{whyDetail(o.error ?? "", o.detail)}</p>
                        </details>
                      )}
                      {s.diff && <Diff before={s.diff.before} after={s.diff.after} />}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <div className="cam-rv-f">
          {summary && (
            <span className={cls("cam-hint", apply.data?.stopped || apply.isError ? "bad-t" : "ok-t")} role="status" data-resultado>
              {summary}
            </span>
          )}
          {staleSet && (
            <Btn kind="secondary" small onClick={() => reread.mutate()} disabled={reread.isPending} data-control="camino-volver-a-leer">
              {w.keepMine}
            </Btn>
          )}
          {done ? (
            <Btn kind="primary" small onClick={onClose} data-control="camino-listo">
              {w.close}
            </Btn>
          ) : (
            <>
              <Btn kind="quiet" small onClick={onClose} disabled={apply.isPending}>
                {w.keepEditing}
              </Btn>
              <Btn kind="primary" small onClick={() => apply.mutate()} disabled={apply.isPending || !cambios.items.length || held} data-control="camino-aplicar">
                {apply.isPending ? w.applying : w.apply(list.length)}
              </Btn>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
