// PLA-I68-5: «Pruebas (CI)». Flujos: each workflow read from the repo with its triggers, permissions, secrets, jobs and
// steps, its warnings each with a fix, steps paused/removed/reordered/added from package.json, on/off with the impact
// on rules shown first, a new workflow from the project's scripts, a workflow deleted; every edit is a PR in the change
// set, checked by actionlint first. Exigir: required checks picked only from the names GitHub reported. Corridas: the
// last runs, flaky ones, re-run what failed, minutes. Actualizaciones: the dependency bot, as a PR.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AUTO_PATCH_YML, dependabotYml, edits, fixEdit, flaky, minutesOf, newWorkflow, readWorkflow, requiredIn, runOf, UNSAFE_SCRIPT, warnings, type DepsForm, type Workflow } from "@/lib/camino-ci";
import { pruebasWords } from "@/lib/camino-pruebas-words";
import { agoText, baseBranch, baseBranches, caminoWords, githubStale, openProposalFor, protectedOn } from "@/lib/camino";
import type { Staged } from "@/lib/camino-cambios";
import type { BranchRule, CaminoRead } from "@/lib/camino-types";
import { Btn } from "./parts";
import { Blk, Ed, Experto, Recom } from "./camino";
import { Diff, Tg } from "./camino-cambios";
import type { Cambios } from "./camino-store";

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");
const TABS = ["flujos", "exigir", "corridas", "deps"] as const;
type Tab = (typeof TABS)[number];
const DEFAULT_RULE: BranchRule = { on: true, pr: true, nodel: true, agents: false };

/** Every check name some rule or Camino requires (on any branch). */
export function requiredNames(r: CaminoRead): string[] {
  const g = r.discovery?.github.ok ? r.discovery.github : null;
  return [...new Set([...Object.values(r.config.required_checks).flat(), ...(g?.rules.list.filter((x) => x.enforcement === "active").flatMap((x) => x.required_checks) ?? [])])];
}

export const Pruebas = ({ r, cambios }: { r: CaminoRead; cambios: Cambios }) => {
  const w = pruebasWords();
  const [tab, setTab] = useState<Tab>("flujos");
  const [open, setOpen] = useState(false);
  const g = r.discovery?.github.ok ? r.discovery.github : null;
  const nw = useNewWorkflow(r, cambios);
  const ex = caminoWords().expert.ci;
  const nWf = g?.workflows.length ?? 0;
  const base = baseBranch(r);
  const required = requiredNames(r);
  return (
    <Ed id="ci" title={caminoWords().sections.ci} lead={w.lead}>
      {/* PLA-I70-47: the recommendation first; the tabs wait behind «Modo experto». */}
      <Recom
        lines={nWf ? [ex.have(nWf), ...(required.length ? [] : [ex.require(g?.checks[0]?.name ?? "ci-ok", base)])] : [ex.none]}
        done={!!g && nWf > 0 && required.length > 0}
        disabled={githubStale(r) || nw.making}
        onUse={() => {
          if (!nWf) void nw.make();
          else {
            setTab("exigir");
            setOpen(true);
          }
        }}
      />
      <Experto id="ci" open={open} onToggle={setOpen}>
      {/* PLA-I70-36: the tabs pattern: one tab stop, arrows (and Home/End) move between them. */}
      <div
        className="cam-subtabs"
        role="tablist"
        aria-label={caminoWords().sections.ci}
        onKeyDown={(e) => {
          const i = TABS.indexOf(tab);
          const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
          if (next < 0) return;
          e.preventDefault();
          setTab(TABS[next]!);
          requestAnimationFrame(() => e.currentTarget.querySelector<HTMLElement>(`[data-subtab="${TABS[next]}"]`)?.focus());
        }}
      >
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" tabIndex={tab === t ? 0 : -1} aria-selected={tab === t} className="cam-subtab" onClick={() => setTab(t)} data-subtab={t}>
            {w.tabs[t]}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={w.tabs[tab]}>
        {tab === "flujos" && <Flujos r={r} cambios={cambios} />}
        {tab === "exigir" && <Exigir r={r} cambios={cambios} />}
        {tab === "corridas" && <Corridas r={r} />}
        {tab === "deps" && <Deps r={r} cambios={cambios} />}
      </div>
      </Experto>
    </Ed>
  );
};

// ---- Flujos
function useStageFile(r: CaminoRead, cambios: Cambios) {
  const w = pruebasWords();
  const base = baseBranch(r);
  return (path: string, before: string, after: string | null, label: string) => {
    const key = `file:${path}`;
    if (after !== null && after === before) return cambios.drop(key);
    const staged: Staged = {
      key,
      change: { kind: "file_pr", label, path, content: after, base, title: w.prTitle(path), body: w.prBody },
      dest: "pr",
      from: before ? path : "—",
      to: after === null ? "—" : path,
      diff: { path, before, after: after ?? "" },
    };
    cambios.stage(staged);
    if (after !== null && /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path))
      void api
        .caminoLint(r.slug, path, after)
        .then((out) => {
          if (out.available && out.errors.length) cambios.stage({ ...staged, blocked: `${w.lintErrors(out.errors.length)} ${out.errors.map((e) => `${e.line}:${e.column} ${e.message}`).join(" · ")}` });
        })
        .catch(() => {});
  };
}

/** PLA-I70-24: a new workflow from the project's scripts, pinned to commits at once so it passes Plania's own pin check. */
function useNewWorkflow(r: CaminoRead, cambios: Cambios) {
  const stage = useStageFile(r, cambios);
  const g = r.discovery?.github.ok ? r.discovery.github : null;
  const mac = r.discovery?.mac;
  const pm = mac?.pm ?? "npm";
  const files = g?.workflow_files ?? [];
  const newPath = files.some((f) => f.path === ".github/workflows/ci.yml") ? ".github/workflows/ci-plania.yml" : ".github/workflows/ci.yml";
  const [making, setMaking] = useState(false);
  const make = async () => {
    setMaking(true);
    let text = newWorkflow(mac?.scripts ?? [], pm, baseBranches(r));
    try {
      const uses = [...text.matchAll(/uses: ([^\s@]+@[^\s]+)/g)].map((m) => m[1]!).filter((u) => !/@[0-9a-f]{40}$/.test(u));
      const shas = uses.length ? await api.caminoPins(r.slug, uses) : {};
      if (Object.keys(shas).length) text = edits.pin(text, shas);
    } catch {
      /* left unpinned: the card then offers «Fijar» */
    }
    setMaking(false);
    stage(newPath, "", text, pruebasWords().label.add(newPath));
  };
  return { make, making, newPath };
}

const Flujos = ({ r, cambios }: { r: CaminoRead; cambios: Cambios }) => {
  const w = pruebasWords();
  const g = r.discovery?.github.ok ? r.discovery.github : null;
  const mac = r.discovery?.mac;
  const stage = useStageFile(r, cambios);
  const files = g?.workflow_files ?? [];
  const pm = mac?.pm ?? "npm";
  const branches = baseBranches(r);
  const stale = githubStale(r);
  const nw = useNewWorkflow(r, cambios);
  const newPath = nw.newPath;
  const stagedNew = cambios.staged(`file:${newPath}`) as { content: string } | undefined;
  return (
    <div className="cam-wfs">
      {stale && <p className="cam-hint" data-obsoleto>{w.staleRead}</p>}
      {files.length === 0 && !stagedNew && !stale && <p className="cam-hint">{w.noWorkflows}</p>}
      {files.map((f) => (
        <WorkflowCard key={f.path} r={r} cambios={cambios} path={f.path} original={f.text} stage={stage} />
      ))}
      {stagedNew && <WorkflowCard r={r} cambios={cambios} path={newPath} original="" stage={stage} />}
      <div className="cam-acts">
        {!stagedNew && !stale && (
          <Btn
            kind={files.length ? "secondary" : "primary"}
            small
            disabled={nw.making}
            onClick={() => void nw.make()}
            data-control="nuevo-flujo"
          >
            {files.length ? w.newWfMore : w.newWf}
          </Btn>
        )}
        <span className="cam-hint">{stagedNew ? w.newWfNote(baseBranch(r)) : w.prNote}</span>
      </div>
    </div>
  );
};

const WorkflowCard = ({ r, cambios, path, original, stage }: { r: CaminoRead; cambios: Cambios; path: string; original: string; stage: (path: string, before: string, after: string | null, label: string) => void }) => {
  const w = pruebasWords();
  const g = r.discovery?.github.ok ? r.discovery.github : null;
  const mac = r.discovery?.mac;
  const staged = cambios.items.find((x) => x.key === `file:${path}`);
  const stagedContent = staged ? (staged.change.content as string | null | undefined) : undefined;
  const deleted = !!staged && stagedContent === null;
  const text = staged && !deleted ? (stagedContent ?? original) : original;
  const wf: Workflow = readWorkflow(path, text);
  const required = requiredNames(r);
  const ghWf = g?.workflows.find((x) => x.path === path);
  const stateKey = `wf:${ghWf?.id ?? path}`;
  const stagedState = cambios.staged(stateKey) as { enable: boolean } | undefined;
  const active = stagedState ? stagedState.enable : ghWf ? ghWf.state === "active" : true;
  const [confirmOff, setConfirmOff] = useState(false);
  const [pinErr, setPinErr] = useState(false);
  const lastCommit = g?.commits[0]?.date;
  const quietDays = lastCommit ? Math.floor((Date.now() - new Date(lastCommit).getTime()) / 86_400_000) : null;
  const warns = warnings(wf, { required, publicRepo: !!g && !g.repo.private, quietDays });
  const pm = mac?.pm ?? "npm";
  // PLA-I70-26: while a proposal for this file is open, a second edit would open a conflicting one.
  const open = openProposalFor(r, path);
  const set = (next: string) => (open ? undefined : stage(path, original, next, original ? w.label.edit(path) : w.label.add(path)));
  const pins = useMutation({
    mutationFn: () => api.caminoPins(r.slug, wf.actions.filter((a) => !a.pinned).map((a) => a.uses)),
    onSuccess: (shas) => {
      if (!Object.keys(shas).length) return setPinErr(true);
      set(edits.pin(text, shas));
    },
    onError: () => setPinErr(true),
  });
  const needed = requiredIn(text, path, required);
  const changed = !!staged;
  return (
    <div className={cls("cam-wf", deleted && "gone")} data-flujo={path}>
      <div className="cam-wf-h">
        <span className="cam-acts">
          <b>{wf.name}</b>
          <span className="cor-mono cam-hint">{path}</span>
          {original && <span className="cam-src">{w.fromRepo}</span>}
          {changed && <span className="cam-chip warn">{w.unapplied}</span>}
          {open && (
            <a className="cam-chip live" href={open.url} target="_blank" rel="noreferrer" data-propuesta-abierta={open.number}>
              {w.openPr(open.number)}
            </a>
          )}
        </span>
        {ghWf && (
          <Tg
            on={active}
            title={active ? w.active : w.inactive}
            onClick={() => {
              if (active) setConfirmOff(true);
              else cambios.stage({ key: stateKey, change: { kind: "workflow_state", label: w.label.on(wf.name), id: ghWf.id, name: wf.name, enable: true }, dest: "github", from: w.inactive, to: w.active });
            }}
            className="cam-tg cam-tg-inline"
            data-control={`flujo-activo-${path}`}
          />
        )}
      </div>
      {open && (
        <p className="cam-hint warn-t" data-propuesta-nota>
          {w.openPrNote(open.number)}
        </p>
      )}
      {confirmOff && ghWf && (
        <div className="cam-box warn" role="alertdialog" aria-label={w.offTitle(wf.name)} data-impacto={needed.length ? "bloquea" : "nada"}>
          <b>{w.offTitle(wf.name)}.</b> {needed.length ? w.offRequired(w.quoted(needed)) : w.offFree} {w.offApply}
          <div className="cam-acts">
            <Btn
              kind="primary"
              small
              onClick={() => {
                cambios.stage({ key: stateKey, change: { kind: "workflow_state", label: w.label.off(wf.name), id: ghWf.id, name: wf.name, enable: false }, dest: "github", from: w.active, to: w.inactive });
                setConfirmOff(false);
              }}
              data-control="confirmar-apagar"
            >
              {w.turnOff}
            </Btn>
            <Btn kind="quiet" small onClick={() => setConfirmOff(false)}>
              {w.cancel}
            </Btn>
          </div>
        </div>
      )}
      {wf.error ? (
        <p className="cam-hint bad-t">{wf.error}</p>
      ) : (
        <>
          <div className="cam-chips">
            {wf.on.pr && <span className="cam-chip">{w.chips.pr(wf.on.pr === "*" ? w.chips.all : wf.on.pr.join(", "))}</span>}
            {wf.on.push && <span className="cam-chip">{w.chips.push(wf.on.push === "*" ? w.chips.all : wf.on.push.join(", "))}</span>}
            {wf.on.dispatch && <span className="cam-chip">{w.chips.dispatch}</span>}
            {wf.on.schedule.length > 0 && <span className="cam-chip">{w.chips.schedule}</span>}
            <span className={cls("cam-chip", wf.permissions === "read" || wf.permissions === "none" ? "ok" : "warn")}>{wf.permissions === "read" || wf.permissions === "none" ? w.chips.read : w.chips.write}</span>
            {wf.cancels && <span className="cam-chip ok">{w.chips.cancels}</span>}
            {wf.actions.length > 0 && <span className={cls("cam-chip", wf.actions.every((a) => a.pinned) ? "ok" : "warn")}>{wf.actions.every((a) => a.pinned) ? w.chips.pinned : w.chips.tags}</span>}
            <span className={cls("cam-chip", wf.secrets.length ? "bad" : "ok")}>{wf.secrets.length ? w.chips.secrets(wf.secrets.join(", ")) : w.chips.noSecrets}</span>
            {wf.jobs.some((j) => j.ok) && <span className="cam-chip ok">{w.chips.ok}</span>}
          </div>
          {warns.length > 0 && (
            <ul className="cam-list">
              {warns.map((x) => (
                <li key={x.id} className="cam-find warn" data-aviso={x.id}>
                  <i className="cam-dot warn" aria-hidden />
                  <span className="cam-find-t">{x.text}</span>
                  <span className="cam-find-s">{x.detail}</span>
                  {x.fix && (
                    <span className="cam-find-a">
                      <Btn
                        kind="secondary"
                        small
                        className="cam-fix"
                        disabled={x.fix.kind === "pin" && pins.isPending}
                        onClick={() => (x.fix!.kind === "pin" ? pins.mutate() : set(fixEdit(x.id, text, wf)))}
                        data-arreglo={x.id}
                      >
                        {x.fix.label}
                      </Btn>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {pinErr && <p className="cam-hint bad-t">{w.pinFailed}</p>}
          {staged?.blocked && (
            <p className="cam-hint bad-t" role="alert" data-actionlint>
              {staged.blocked}
            </p>
          )}
          {wf.jobs.map((j) => (
            <div key={j.id} className="cam-field">
              <span className="cam-lab">
                {w.job} <span className="cor-mono">{j.name}</span> <i>{w.jobMeta(j.timeout, j.matrix?.join(", ") ?? null)}</i>
              </span>
              <ol className="cam-steps">
                {j.steps.map((s) => (
                  <li key={s.i} className={cls("cam-step", s.off && "off")} data-paso={`${j.id}:${s.i}`}>
                    <span className="cam-step-n">{s.i + 1}</span>
                    <span className="cam-step-c">
                      {s.uses ? `uses ${s.uses.replace(/@([0-9a-f]{7})[0-9a-f]{33}/, "@$1…")}` : (s.name ?? s.run ?? "")}
                      {s.off && <span className="cam-chip dim">{w.paused}</span>}
                      {s.cont && <span className="cam-chip warn">{w.mayFail}</span>}
                    </span>
                    <span className="cam-acts cam-step-a">
                      {s.uses ? (
                        <span className="cam-hint">{w.system}</span>
                      ) : (
                        <>
                          <Btn kind="quiet" small disabled={s.i === 0} onClick={() => set(edits.stepMove(text, j.id, s.i, -1))} aria-label={`${w.up}: ${s.run ?? s.name}`}>
                            ↑
                          </Btn>
                          <Btn kind="quiet" small disabled={s.i === j.steps.length - 1} onClick={() => set(edits.stepMove(text, j.id, s.i, 1))} aria-label={`${w.down}: ${s.run ?? s.name}`}>
                            ↓
                          </Btn>
                          <Btn kind="quiet" small onClick={() => set(edits.stepPause(text, j.id, s.i))} data-control={`pausar-${j.id}-${s.i}`}>
                            {s.off ? w.resume : w.pause}
                          </Btn>
                          <Btn kind="quiet" small onClick={() => set(edits.stepRemove(text, j.id, s.i))} data-control={`quitar-${j.id}-${s.i}`}>
                            {w.remove}
                          </Btn>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
              {!j.ok && (mac?.scripts?.length ?? 0) > 0 && (
                <select className="cor-input cam-add" value="" aria-label={w.addStep} onChange={(e) => e.target.value && set(edits.stepAdd(text, j.id, runOf(pm, e.target.value)))} data-campo={`agregar-${j.id}`}>
                  <option value="">{w.addStep}</option>
                  {(mac?.scripts ?? [])
                    .filter((sc) => !j.steps.some((s) => s.run?.endsWith(` ${sc}`)))
                    .map((sc) => (
                      <option key={sc} value={sc} disabled={UNSAFE_SCRIPT.test(sc)}>
                        {`${runOf(pm, sc)}${UNSAFE_SCRIPT.test(sc) ? ` (${w.unsafe})` : ""}`}
                      </option>
                    ))}
                </select>
              )}
            </div>
          ))}
          <details className="cam-why">
            <summary>{changed ? w.seeDiff : w.seeFile}</summary>
            {changed ? <Diff before={original} after={text} /> : <pre className="cam-diff">{original}</pre>}
            <p className="cam-hint">{w.keepsComments}</p>
          </details>
          {original && !githubStale(r) && !open && (
            <div className="cam-acts">
              <Btn kind="quiet" small onClick={() => (deleted ? cambios.drop(`file:${path}`) : stage(path, original, null, w.label.del(path)))} data-control={`borrar-flujo-${path}`}>
                {deleted ? w.undoDeleteWf : w.deleteWf}
              </Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ---- Exigir
const Exigir = ({ r, cambios }: { r: CaminoRead; cambios: Cambios }) => {
  const w = pruebasWords().exigir;
  const g = r.discovery?.github.ok ? r.discovery.github : null;
  const cols = [...new Set([r.config.branches.integration, r.config.branches.published].filter((b): b is string => !!b))];
  const staged = (cambios.staged("required") as { patch: { required_checks: Record<string, string[]> } } | undefined)?.patch.required_checks;
  const req = staged ?? r.config.required_checks;
  const fromRules = (b: string) => g?.rules.list.filter((x) => x.enforcement === "active" && x.branches.includes(b)).flatMap((x) => x.required_checks) ?? [];
  const current = (b: string) => req[b] ?? fromRules(b);
  const priv = !!g && !g.rules.available;
  const noAdmin = !!g && !g.repo.admin && !priv;
  const okPending = !g?.checks.some((c) => c.name === "ci-ok") && (cambios.items.some((x) => x.change.kind === "file_pr" && String((x.change as { content?: string }).content ?? "").includes("ci-ok:")) || g?.workflow_files.some((f) => /\n\s{2}ci-ok:/.test(f.text)));
  // PLA-I70-13: what is staged is computed from the original read, so ticking and unticking leaves nothing behind.
  const orig = (b: string) => r.config.required_checks[b] ?? fromRules(b);
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((n) => y.includes(n));
  const toggle = (b: string, name: string, on: boolean) => {
    const list = current(b);
    const nextList = on ? [...new Set([...list, name])] : list.filter((x) => x !== name);
    const next = { ...req, [b]: nextList };
    const label = pruebasWords().label.required(b);
    if (Object.keys(next).every((k) => same(next[k]!, orig(k)))) cambios.drop("required");
    else cambios.stage({ key: "required", change: { kind: "config", label, patch: { required_checks: next } }, dest: "plania", from: Object.entries(r.config.required_checks).map(([k, v]) => `${k}: ${v.join(", ") || "—"}`).join(" · ") || "—", to: Object.entries(next).map(([k, v]) => `${k}: ${v.join(", ") || "—"}`).join(" · ") });
    // On a repo with rules, the branch's ruleset carries the checks (applied after the record, in the set's order).
    if (priv) return;
    if (same(nextList, orig(b))) return cambios.drop(`rule:${b}`);
    const rule = (cambios.staged(`rule:${b}`) as { rule: BranchRule } | undefined)?.rule ?? r.config.rules[b] ?? DEFAULT_RULE;
    const protects = !!r.config.rules[b]?.on || protectedOn(r, b);
    const pw = pruebasWords();
    cambios.stage({ key: `rule:${b}`, change: { kind: "ruleset", label: protects ? pw.label.rule(b) : pw.label.protectRequire(b, nextList.join(", ") || "—"), branch: b, rule: { ...rule, on: true } }, dest: "github", from: orig(b).join(", ") || "—", to: nextList.join(", ") || "—" });
  };
  return (
    <div className="cam-exigir">
      <p className="cam-hint">{w.lead}</p>
      <div className="cam-tw" tabIndex={0} role="region" aria-label={w.require}>
        <table className="cam-tbl" data-exigir>
          <thead>
            <tr>
              <th scope="col">{w.check}</th>
              <th scope="col">{w.source}</th>
              <th scope="col">{w.last}</th>
              {cols.map((b) => (
                <th key={b} scope="col">
                  {w.into(b)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {okPending && (
              <tr data-prueba="ci-ok">
                <td className="cor-mono">ci-ok</td>
                <td>{w.pendingSrc}</td>
                <td>—</td>
                {cols.map((b) => (
                  <td key={b} className="cam-hint">
                    {w.pending}
                  </td>
                ))}
              </tr>
            )}
            {(g?.checks ?? []).map((c) => (
              <tr key={c.name} data-prueba={c.name}>
                <td className="cor-mono">{c.name}</td>
                <td>{c.app ?? "—"}</td>
                <td>{agoText(c.last_at, new Date())}</td>
                {cols.map((b) => (
                  <td key={b}>
                    {c.branches.includes(b) ? (
                      <label className="cam-check">
                        <input type="checkbox" checked={current(b).includes(c.name)} onChange={(e) => toggle(b, c.name, e.target.checked)} data-exigir-en={b} />
                        {w.require}
                      </label>
                    ) : (
                      <span className="cam-hint">{w.notHere}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {priv && <div className="cam-box warn">{w.private}</div>}
      <Blk cap={w.existing}>
        {g?.rules.list.length ? (
          <ul className="cam-list">
            {g.rules.list.map((x) => {
              const ghost = x.required_checks.filter((n) => !g.checks.some((c) => c.name === n));
              const del = !!cambios.staged(`delrs:${x.id}`);
              return (
                <li key={x.id} className="cam-find" data-regla-gh={x.name}>
                  <i className={cls("cam-dot", ghost.length ? "warn" : "ok")} aria-hidden />
                  <span className="cam-find-t">{w.ruleLine(x.name, x.enforcement === "active" ? w.on : w.off, x.required_checks.join(", ") || "—")}</span>
                  <span className="cam-find-s">{ghost.length ? w.ghost : ""}</span>
                  {ghost.length > 0 && !x.plania && (
                    <span className="cam-find-a">
                      <Btn
                        kind="secondary"
                        small
                        className={del ? "" : "cam-fix"}
                        disabled={noAdmin && !del}
                        title={noAdmin ? pruebasWords().exigir.needAdmin : undefined}
                        onClick={() => (del ? cambios.drop(`delrs:${x.id}`) : cambios.stage({ key: `delrs:${x.id}`, change: { kind: "delete_ruleset", label: pruebasWords().label.delRuleset(x.name), id: x.id, name: x.name }, dest: "github", from: x.name, to: "—" }))}
                        data-control={`borrar-regla-${x.name}`}
                      >
                        {del ? w.undoDel : w.del}
                      </Btn>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="cam-hint">{w.none}</p>
        )}
      </Blk>
      <p className="cam-hint">{w.planiaToo}</p>
    </div>
  );
};

// ---- Corridas
const Corridas = ({ r }: { r: CaminoRead }) => {
  const w = pruebasWords().corridas;
  const g = r.discovery?.github.ok ? r.discovery.github : null;
  const runs = g?.runs ?? [];
  const fl = flaky(runs);
  const [asked, setAsked] = useState<Set<number>>(new Set());
  const rerun = useMutation({ mutationFn: (id: number) => api.caminoRerun(r.slug, id), onSuccess: (_d, id) => setAsked((s) => new Set(s).add(id)) });
  if (!runs.length) return <p className="cam-hint">{w.none}</p>;
  const minutes = minutesOf(runs);
  return (
    <div className="cam-corridas">
      <p className="cam-line">
        {w.summary(runs.length, runs.filter((x) => x.conclusion === "success").length, runs.filter((x) => x.conclusion === "failure").length, fl.size, minutes)} ·{" "}
        {g?.repo.private ? (
          // PLA-I70-34: «de pago» only when the month would pass the free 2,000 minutes (this is a 7-day sample).
          (minutes / 7) * 30 > 2000 ? (
            <>
              {w.paid(minutes)} <span className="cam-bdg paid">{w.paidBadge}</span>
            </>
          ) : (
            w.paidInside(minutes)
          )
        ) : (
          w.free
        )}
      </p>
      <div className="cam-tw" tabIndex={0} role="region" aria-label={pruebasWords().tabs.corridas}>
        <table className="cam-tbl" data-corridas={runs.length}>
          <thead>
            <tr>
              <th scope="col">{w.cols.wf}</th>
              <th scope="col">{w.cols.branch}</th>
              <th scope="col">{w.cols.by}</th>
              <th scope="col">{w.cols.result}</th>
              <th scope="col">{w.cols.when}</th>
              <th scope="col">
                <span className="sr-only">{w.rerun}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.slice(0, 20).map((x) => (
              <tr key={x.id} data-corrida={x.id}>
                <td>
                  <a className="cor-inline" href={x.url} target="_blank" rel="noreferrer">
                    {x.name}
                  </a>
                </td>
                <td className="cor-mono">{x.branch}</td>
                <td>{w.ev[x.event] ?? x.event}</td>
                <td className={x.conclusion === "success" ? "ok-t" : x.conclusion === "failure" ? "bad-t" : ""}>
                  {x.conclusion === "success" ? "✓" : x.conclusion === "failure" ? "✗" : x.status}
                  {fl.has(x.id) && <span className="cam-chip warn">{w.flaky}</span>}
                </td>
                <td>{agoText(x.updated_at, new Date())}</td>
                <td>
                  {x.conclusion === "failure" && (
                    <Btn kind="quiet" small disabled={rerun.isPending || asked.has(x.id)} onClick={() => rerun.mutate(x.id)} data-control={`volver-a-correr-${x.id}`}>
                      {asked.has(x.id) ? w.rerunDone : rerun.isPending && rerun.variables === x.id ? w.rerunning : w.rerun}
                    </Btn>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="cam-hint">{w.flakyHint}</p>
    </div>
  );
};

// ---- Actualizaciones
const DEPS_FILE = ".github/dependabot.yml";
const AUTO_FILE = ".github/workflows/dependabot-auto-merge.yml";
const Deps = ({ r, cambios }: { r: CaminoRead; cambios: Cambios }) => {
  const w = pruebasWords().deps;
  const pw = pruebasWords();
  const g = r.discovery?.github.ok ? r.discovery.github : null;
  const stage = useStageFile(r, cambios);
  const existing = g?.dependabot?.text ?? "";
  const orig: DepsForm = { ...r.config.deps, on: r.config.deps.on || !!existing, target: r.config.deps.target ?? baseBranch(r) };
  const f = (cambios.staged("deps") as { patch: { deps: DepsForm } } | undefined)?.patch.deps ?? orig;
  const ecosystems = [...(r.discovery?.mac.scripts ? ["npm"] : []), ...(g?.workflows.length ? ["github-actions"] : [])];
  const required = (f.target && r.config.required_checks[f.target]?.length) || g?.rules.list.some((x) => x.enforcement === "active" && x.required_checks.length && f.target && x.branches.includes(f.target));
  const set = (patch: Partial<DepsForm>) => {
    const next = { ...f, ...patch };
    if (!required) next.auto_patch = false;
    cambios.stage({ key: "deps", change: { kind: "config", label: pw.label.depsCfg, patch: { deps: next } }, dest: "plania", from: orig.on ? `${orig.interval} → ${orig.target}` : "—", to: next.on ? `${next.interval} → ${next.target}` : "—" });
    stage(DEPS_FILE, existing, next.on ? dependabotYml(next, ecosystems.length ? ecosystems : ["npm"]) : existing ? null : "", pw.label.deps);
    if (!next.on && !existing) cambios.drop(`file:${DEPS_FILE}`);
    const autoNow = g?.workflow_files.find((x) => x.path === AUTO_FILE)?.text ?? "";
    if (next.on && next.auto_patch) stage(AUTO_FILE, autoNow, AUTO_PATCH_YML, pw.label.autoMerge);
    else cambios.drop(`file:${AUTO_FILE}`);
  };
  const branches = baseBranches(r);
  return (
    <div className="cam-deps">
      <Tg on={f.on} title={w.on} sub={w.onSub} onClick={() => set({ on: !f.on })} data-control="dependabot" />
      {existing && <p className="cam-hint">{w.current}</p>}
      {f.on && (
        <>
          <div className="cam-grid3">
            <label className="cam-field">
              <span className="cam-lab">{w.interval}</span>
              <select className="cor-input" value={f.interval} onChange={(e) => set({ interval: e.target.value as DepsForm["interval"] })} data-campo="intervalo">
                {(["daily", "weekly", "monthly"] as const).map((v) => (
                  <option key={v} value={v}>
                    {w.intervals[v]}
                  </option>
                ))}
              </select>
            </label>
            <label className="cam-field">
              <span className="cam-lab">{w.target}</span>
              <select className="cor-input cor-mono" value={f.target ?? ""} onChange={(e) => set({ target: e.target.value })} data-campo="destino">
                {branches.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
          </div>
          <Tg on={f.group} title={w.group} sub={w.groupSub} onClick={() => set({ group: !f.group })} />
          <Tg on={f.auto_patch} title={w.auto} sub={required ? w.autoSub : w.autoNeeds} disabled={!required} onClick={() => set({ auto_patch: !f.auto_patch })} data-control="auto-parches" />
          {g && <div className="cam-box info">{w.security(g.repo.default_branch, f.target ?? g.repo.default_branch)}</div>}
        </>
      )}
      <p className="cam-hint">{w.file}</p>
    </div>
  );
};
