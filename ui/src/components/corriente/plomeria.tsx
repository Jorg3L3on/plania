// PLA-I62-8: Plomería (board D3), the plumbing that lives on /machine, redrawn in place with everything it has and in
// plain words: the company's state with Detener la compañía (with what it closes) and Reanudar; the plan's brake
// (Mover el freno, its own small form; «Seguir aunque el plan esté alto»); what the models spent this week; each
// project with Pausar / Reanudar and its app's switch, Configurar su app and Apagar todas las apps (the building's
// tablero); the last runs; the owner's code row. The calls are the ones /machine and the tablero make. P5: «Conectar
// Claude Code», the line with a token of its own.
import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { OWNER_CODE_WORDS, isOwnerCode } from "@/components/compania/sheets";
import { ApiError, api, type MachinePlumbing } from "@/lib/api";
import { tokens, type CompanyProjectRow, type RunBrief } from "@/lib/compania";
import { seatName, thousands } from "@/lib/corriente";
import { tableroView } from "@/lib/maquinas";
import { logWords } from "@/lib/calidad";
import { AYUDA, EXPORT_ALL_URL, HELP_REPORT_URL } from "@/lib/ayuda";
import { PLOMERIA } from "@/lib/plomeria-words";
import { getLanguage, words, type Language } from "@/lib/i18n";
import { NOVEDADES, versionLine } from "@/lib/version";
import { ACTUALIZAR, pendingKit } from "@/lib/actualizar";
import { Btn, BtnLink, Key, Label, Switch } from "./parts";
import { LIMITS_LINK, LIMITS_PATH } from "@/lib/limites";
import { LanguageSwitch } from "@/components/language-sync";
import { LOCALE } from "@/lib/locale";
import { LimitesCorrida } from "./limites-corrida";
import { CopyCommand } from "@/components/copy-command";
import { claudeMcpAddLine, conectarClaudeWords } from "@/lib/conectar-claude";

export const weekParts = (plumbing: MachinePlumbing) => {
  const w = plumbing.usage.week;
  const rows = [plumbing.usage.asistente, ...plumbing.usage.projects.map((p) => p.usage)];
  const sum = (k: "input" | "output" | "cache_read" | "cache_create") => (w ? (w[k] ?? 0) : rows.reduce((n, u) => n + (u[k] ?? 0), 0));
  return { main: w ? w.used : rows.reduce((n, u) => n + u.used, 0), cache_read: sum("cache_read"), cache_create: sum("cache_create") };
};

/** The headline: whether the company runs, and with or without the plan's brake. */
export function plumbingHead(p: MachinePlumbing, language: Language = getLanguage()): { title: string; sub: string; tone: "ok" | "warn" | "stop" } {
  const w = words(PLOMERIA, language);
  const n = p.usage.projects.filter((x) => !x.paused).length;
  if (p.company.paused) return { title: w.stoppedTitle, sub: w.stoppedSub, tone: "stop" };
  if (p.plan.override) return { title: w.overrideTitle, sub: w.overrideSub(n), tone: "warn" };
  const pct = p.plan.five_hour_pct;
  if (pct !== null && pct >= p.plan.guard_pct) return { title: w.brakedTitle, sub: w.brakedSub(Math.round(pct), p.plan.guard_pct), tone: "warn" };
  return { title: w.runningTitle, sub: w.runningSub(n), tone: "ok" };
}

// PLA-I2-10: a run's outcome, in the screen's language.
const runWord = (status: string, language: Language = getLanguage()): [string, "ok" | "bad" | undefined] | undefined => {
  const w = words(PLOMERIA, language);
  const all: Record<string, [string, "ok" | "bad" | undefined]> = { ok: [w.runOk, "ok"], fail: [w.runFail, "bad"], stopped: [w.runStopped, undefined], skipped: [w.runSkipped, "bad"], running: [w.runRunning, undefined] };
  return all[status];
};
const hm = (iso: string | null, tz?: string) => (iso ? new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso)) : "");
const mins = (a: string | null, b: string | null) => (a && b ? Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 60_000)) : null);

// P5: «Conectar Claude Code». A token of its own, made on the press and shown this once inside the line to run.
const ConectarClaude = () => {
  const w = conectarClaudeWords();
  const make = useMutation({ mutationFn: api.connectClaudeCode, onError: () => toast.error(w.fallo) });
  return (
    <section className="cor-pl-foot" aria-label={w.titulo} data-block="conectar-claude">
      <span className="cor-text">
        <b>{w.titulo}</b> · {w.texto}
      </span>
      {make.data && (
        <div className="grid gap-1" style={{ flexBasis: "100%" }}>
          <CopyCommand command={claudeMcpAddLine(make.data.url, make.data.secret)} />
          <span className="cor-cap">
            {w.unaVez}{" "}
            <Link to="/tokens" className="underline underline-offset-2">
              {w.revocar}
            </Link>
          </span>
        </div>
      )}
      <Btn kind="link" disabled={make.isPending} onClick={() => make.mutate()} data-control="conectar-claude">
        {make.isPending ? w.creando : make.data ? w.otra : w.boton}
      </Btn>
    </section>
  );
};

const OwnerCode = () => {
  const client = useQueryClient();
  const owner = useQuery({ queryKey: ["owner-code"], queryFn: api.ownerCode, staleTime: 60_000 });
  const enrol = useMutation({ mutationFn: api.enrolOwnerCode, onSuccess: () => void client.invalidateQueries({ queryKey: ["owner-code"] }) });
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const enrolled = owner.data?.enrolled ?? null;
  const w = words(PLOMERIA);
  const error = enrol.error instanceof ApiError ? (enrol.error.code === "INVALID_PASSWORD" ? w.wrongPassword : (OWNER_CODE_WORDS[enrol.error.code] ?? w.couldNot(enrol.error.code))) : null;
  return (
    <div className="cor-owner" data-owner-code-row={enrolled ? "1" : "0"}>
      <span className="cor-text">
        <b>{w.ownerCode}</b> · {enrolled == null ? "…" : enrolled ? w.ownerEnrolled : w.ownerNotEnrolled}
      </span>
      <Btn kind="link" aria-expanded={open} onClick={() => setOpen((x) => !x)} data-control="codigo-dueno">
        {enrolled ? w.change : w.configure}
      </Btn>
      {open && !enrol.data && (
        <form
          className="cor-ajuste-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) enrol.mutate({ password, code: enrolled ? code : undefined });
          }}
        >
          <input type="password" className="cor-input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-label={w.password} placeholder={w.yourPassword} />
          {enrolled && <input inputMode="numeric" maxLength={6} className="cor-input cor-mono" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} aria-label={w.currentCode} placeholder="000000" />}
          <Btn kind="secondary" type="submit" disabled={enrol.isPending || !password || (!!enrolled && !isOwnerCode(code))}>
            {w.generateCode}
          </Btn>
          {error && <span className="cor-state bad">{error}</span>}
        </form>
      )}
      {enrol.data && (
        <p className="cor-text" data-owner-secret>
          {w.secretLead} <span className="cor-mono">{enrol.data.secret_base32}</span>
        </p>
      )}
    </div>
  );
};

// PLA-I2-17: which release this is, with its notes one click away (words in lib/version.ts).
export const ReleaseLine = () => {
  const release = useQuery({ queryKey: ["release"], queryFn: api.releaseInfo, staleTime: 5 * 60_000 });
  if (!release.data) return null;
  const nw = words(NOVEDADES);
  const aw = words(ACTUALIZAR);
  return (
    <span className="cor-text" data-version={release.data.version}>
      <span data-version-line>{versionLine(release.data)}</span>{" "}
      <BtnLink kind="link" to="/novedades" data-control="novedades">
        {nw.link}
      </BtnLink>
      {/* PLA-I2-8: after an update, the owner's kit edits that the release also changed wait on Novedades. */}
      {pendingKit(release.data.last_update) > 0 && (
        <span className="cor-amber" data-kit-pending>
          {" "}· {aw.hint(pendingKit(release.data.last_update))}
        </span>
      )}
    </span>
  );
};

export const Plomeria = ({ plumbing, inventory, onInventory, macLine }: { plumbing: MachinePlumbing; inventory: boolean; onInventory: () => void; macLine: string }) => {
  const client = useQueryClient();
  const w = words(PLOMERIA);
  const ayuda = words(AYUDA);
  const tz = plumbing.week.timezone;
  const canEdit = plumbing.viewer?.can_edit_limits ?? true;
  const [stopping, setStopping] = useState<{ kind: "company" } | { kind: "project"; p: CompanyProjectRow } | null>(null);
  const [guard, setGuard] = useState<string | null>(null);
  const [logAll, setLogAll] = useState(false);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["machine"] });
    void client.invalidateQueries({ queryKey: ["company"] });
    void client.invalidateQueries({ queryKey: ["maquinas-tablero"] });
  };
  const titles = new Map(plumbing.usage.projects.map((p) => [p.slug, p.title]));
  const companySwitch = useMutation({
    mutationFn: (paused: boolean) => api.setCompanyPaused(paused),
    onSuccess: (r) => (toast(r.paused ? w.companyStopped(r.stopped) : w.companyRunning), setStopping(null), refresh()),
    onError: () => toast.error(w.switchFailed),
  });
  const projectSwitch = useMutation({
    mutationFn: ({ slug, paused }: { slug: string; paused: boolean }) => api.setProjectPaused(slug, paused),
    onSuccess: (r) => (toast(r.paused ? w.projectPaused(titles.get(r.project) ?? r.project) : w.projectResumed(titles.get(r.project) ?? r.project)), setStopping(null), refresh()),
    onError: () => toast.error(w.projectSwitchFailed),
  });
  const saveGuard = useMutation({
    mutationFn: (v: number) => api.setRunnerSettings({ plan_guard_pct: v }),
    onSuccess: () => (toast(w.saved), setGuard(null), refresh()),
    onError: () => toast.error(w.saveFailed),
  });
  const override = useMutation({ mutationFn: (on: boolean) => api.setRunnerSettings({ guard_override: on }), onSuccess: (_r, on) => (toast(on ? w.overrideOn : w.overrideOff), refresh()), onError: () => toast.error(w.saveFailed) });
  const tablero = useQuery({ queryKey: ["maquinas-tablero"], queryFn: () => api.tablero(), refetchInterval: 15_000, retry: 1 });
  const tv = tablero.data ? tableroView(tablero.data) : null;
  const [busy, setBusy] = useState<string | null>(null);
  const appRun = useMutation({
    mutationFn: async (x: { key: string; call: () => Promise<unknown> }) => x.call(),
    onMutate: (x) => setBusy(x.key),
    onError: () => toast.error(w.appFailed),
    onSettled: () => (setBusy(null), refresh(), void client.invalidateQueries({ queryKey: ["maquinas"] })),
  });
  const head = plumbingHead(plumbing);
  const week = weekParts(plumbing);
  const spent = [...plumbing.usage.projects.filter((p) => p.usage.used > 0)].sort((a, b) => b.usage.used - a.usage.used);
  const quiet = plumbing.usage.projects.filter((p) => p.usage.used === 0).map((p) => p.title);
  const max = Math.max(1, ...spent.map((p) => p.usage.used));
  const pct = plumbing.plan.five_hour_pct;
  const gv = guard === null ? null : Number(guard);
  const guardValid = gv !== null && Number.isInteger(gv) && gv >= 0 && gv <= 100;
  const live = plumbing.runs.live;
  const log: RunBrief[] = logAll ? plumbing.log : plumbing.log.slice(0, 3);
  return (
    <div className="cor-plomeria" data-plomeria={head.tone}>
      <section className="cor-pl-hero" aria-label={w.stateLabel}>
        <div>
          <Label>{w.kicker}</Label>
          <h1 className="cor-h2" data-pl-head>
            {head.tone !== "ok" && <span className={head.tone === "stop" ? "cor-state bad" : "cor-amber"} aria-hidden>{head.tone === "stop" ? "■ " : "▲ "}</span>}
            {head.title}
          </h1>
          <p className="cor-text">{head.sub}</p>
        </div>
        {canEdit &&
          (plumbing.company.paused ? (
            <Btn kind="primary" disabled={companySwitch.isPending} onClick={() => companySwitch.mutate(false)} data-control="reanudar-compania">
              {w.resumeCompany}
            </Btn>
          ) : stopping?.kind === "company" ? (
            <div className="cor-card cor-confirm" role="alertdialog" aria-label={w.stopQuestion} data-confirm="company">
              <p className="cor-text">
                <b>{w.stopQuestion}</b> {w.stopBody(live.length)}
              </p>
              <span className="cor-acts">
                <Btn kind="danger" disabled={companySwitch.isPending} onClick={() => companySwitch.mutate(true)} data-control="detener-si">
                  {w.yesStop}
                </Btn>
                <Btn kind="quiet" onClick={() => setStopping(null)}>
                  {w.cancel}
                </Btn>
              </span>
            </div>
          ) : (
            <span className="cor-pl-stop">
              <Btn kind="danger" onClick={() => setStopping({ kind: "company" })} data-control="detener-compania">
                {w.stopCompany}
              </Btn>
              <span className="cor-cap">{w.stopCap}</span>
            </span>
          ))}
      </section>
      <div className="cor-pl-grid">
        <section aria-label={w.spentTitle} data-block="tokens">
          <Label as="h2">{w.spentTitle}</Label>
          <p className="cor-pl-big">
            <span className="cor-figure">{thousands(week.main)}</span> <span className="cor-text">{w.tokensUnit}</span>
          </p>
          <p className="cor-cap">{w.noOwnLimit}</p>
          <ul className="cor-pl-usage">
            {spent.slice(0, 2).map((p) => (
              <li key={p.slug}>
                <span>{p.title}</span>
                <span className="cor-mono">{thousands(p.usage.used)}</span>
                <i style={{ width: `${(p.usage.used / max) * 100}%` }} aria-hidden />
              </li>
            ))}
            <li>
              <span>Asistente</span>
              <span className="cor-mono">{thousands(plumbing.usage.asistente.used)}</span>
            </li>
            {(quiet.length > 0 || spent.length > 2) && (
              <li>
                <span className="cor-ellipsis">{[...spent.slice(2).map((p) => p.title), ...quiet].join(", ")}</span>
                <span className="cor-cap">{spent.length > 2 ? tokens(spent.slice(2).reduce((n, p) => n + p.usage.used, 0)) : w.noReport}</span>
              </li>
            )}
          </ul>
          <p className="cor-cap">{w.cacheLine(thousands(week.cache_read), thousands(week.cache_create))}</p>
        </section>
        <section aria-label={w.brakeTitle} data-block="freno">
          <Label as="h2">{w.brakeTitle}</Label>
          <div className="cor-planline">
            <span className="cor-text">{w.planWindow}</span>
            <span className="cor-cap">{`${pct === null ? "—" : `${Math.round(pct)}%`}${plumbing.plan.resets_at ? w.resetsAt(hm(plumbing.plan.resets_at, tz)) : ""}`}</span>
          </div>
          <span className="cor-meter" aria-hidden>
            <i style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
            <u style={{ left: `${plumbing.plan.guard_pct}%` }} />
          </span>
          <p className="cor-cap">{w.brakeLine(plumbing.plan.guard_pct)}</p>
          <div className="cor-krow">
            <span className="cor-text">{w.weekUse(plumbing.plan.seven_day_pct === null ? "—" : `${Math.round(plumbing.plan.seven_day_pct)}%`)}</span>
            {canEdit && guard === null && (
              <Btn kind="secondary" onClick={() => setGuard(String(plumbing.plan.guard_pct))} data-control="mover-guardia">
                {w.moveBrake}
              </Btn>
            )}
          </div>
          {guard !== null && (
            <form
              className="cor-card cor-confirm"
              onSubmit={(e) => {
                e.preventDefault();
                if (guardValid) saveGuard.mutate(gv!);
              }}
              data-guard-form
            >
              <Label as="p">{w.brakeFormLabel}</Label>
              <span className="cor-ajuste-row">
                <label className="cor-text" htmlFor="freno-pct">
                  {w.brakeField}
                </label>
                <input id="freno-pct" inputMode="numeric" className="cor-input cor-mono" style={{ width: 90 }} value={guard} onChange={(e) => setGuard(e.target.value)} />
                <Btn kind="quiet" onClick={() => setGuard(null)}>
                  {w.cancel}
                </Btn>
                <Btn kind="secondary" type="submit" disabled={!guardValid || saveGuard.isPending} data-control="guardar-freno">
                  {w.save}
                </Btn>
              </span>
            </form>
          )}
          <label className={`cor-card cor-override ${plumbing.plan.override ? "on" : ""}`} data-inline-ok>
            <input type="checkbox" checked={plumbing.plan.override === true} disabled={!canEdit || override.isPending} onChange={(e) => override.mutate(e.target.checked)} data-control="seguir-sin-guardia" />
            <span>
              <b>{w.overrideLabel}</b>
              <span className="cor-cap">{plumbing.plan.override ? w.overrideOnCap : w.overrideOffCap}</span>
            </span>
          </label>
        </section>
        <LimitesCorrida settings={plumbing.settings} canEdit={canEdit} onSaved={refresh} />
        <section aria-label={w.projectsLabel} data-block="proyectos">
          <div className="cor-side-head">
            <Label as="h2">{w.projectsTitle}</Label>
            {tv && tv.stoppable.length > 0 && (
              <Btn kind="quiet" disabled={busy === "todo"} onClick={() => appRun.mutate({ key: "todo", call: () => Promise.all(tv.stoppable.map((slug) => api.prueba(slug, "apagar"))) })} data-control="apagar-todo">
                {w.stopAllApps}
              </Btn>
            )}
          </div>
          <ul className="cor-pl-projects">
            {plumbing.usage.projects.map((p) => {
              const app = tv?.rows.find((r) => r.project === p.slug);
              const off = plumbing.company.paused || p.paused;
              return (
                <li key={p.slug} data-switch={p.slug}>
                  <span className="cor-pl-name">
                    <span className={`cor-state ${off ? "" : "ok"}`}>{off ? "○" : "●"}</span>
                    <b>{p.title}</b>
                    <span className="cor-cap">{p.paused ? w.projectPausedTag : plumbing.company.paused ? w.companyStoppedTag : w.runningTag}</span>
                  </span>
                  {app && !app.configured ? (
                    <Btn kind="link" disabled={busy === `cfg:${p.slug}`} onClick={() => appRun.mutate({ key: `cfg:${p.slug}`, call: () => api.configurar(p.slug) })} data-control="configurar-app">
                      {w.configureApp}
                    </Btn>
                  ) : app && app.phase === "running" && !app.managed ? (
                    <span className="cor-cap">{w.appElsewhere}</span>
                  ) : app ? (
                    <Switch on={app.on} label={app.on ? w.appOn(app.port ? ` :${app.port}` : "") : w.appOff} onChange={(v) => appRun.mutate({ key: `sw:${p.slug}`, call: () => api.prueba(p.slug, v ? "encender" : "apagar") })} disabled={busy === `sw:${p.slug}`} data-control="app-switch" aria-label={w.appOf(p.title)} />
                  ) : (
                    <span />
                  )}
                  {canEdit &&
                    (p.paused ? (
                      <Btn kind="quiet" disabled={projectSwitch.isPending} onClick={() => projectSwitch.mutate({ slug: p.slug, paused: false })} data-control="reanudar-proyecto">
                        {w.resume}
                      </Btn>
                    ) : stopping?.kind === "project" && stopping.p.slug === p.slug ? (
                      <Btn kind="danger" disabled={projectSwitch.isPending} onClick={() => projectSwitch.mutate({ slug: p.slug, paused: true })} data-control="pausar-si">
                        {w.pauseYes}
                      </Btn>
                    ) : (
                      <Btn kind="quiet" onClick={() => setStopping({ kind: "project", p })} data-control="pausar-proyecto">
                        {w.pause}
                      </Btn>
                    ))}
                </li>
              );
            })}
          </ul>
          <p className="cor-cap">{w.pauseCap}</p>
        </section>
      </div>
      <section className="cor-pl-log" aria-label={w.logTitle} data-block="bitacora">
        <div className="cor-side-head">
          <Label as="h2">{w.logTitle}</Label>
          {plumbing.log.length > 3 && (
            <Btn kind="link" onClick={() => setLogAll((x) => !x)} data-control="bitacora">
              {logAll ? w.seeLess : w.seeAll}
            </Btn>
          )}
        </div>
        <ul className={logAll ? "cor-scrollbox" : ""} tabIndex={logAll ? 0 : undefined}>
          {log.map((x) => {
            const [word, tone] = x.resolved ? ([w.runResolved, undefined] as [string, undefined]) : (runWord(x.status) ?? [x.status, undefined]);
            const m = mins(x.started_at, x.ended_at);
            return (
              <li key={x.id} className="cor-row">
                <span className="cor-pl-who">
                  <b>{seatName(x.role)}</b> · {titles.get(x.project) ?? x.project}
                </span>
                {x.ticket ? <Key>{x.ticket}</Key> : <span />}
                <span className="cor-ellipsis" style={{ flex: 1 }} title={logWords(x.summary)}>
                  <span className={`cor-state ${tone ?? ""}`}>{word}</span> · {logWords(x.summary)}
                </span>
                <span className="cor-cap">{w.when(hm(x.ended_at ?? x.started_at, tz), m)}</span>
              </li>
            );
          })}
          {plumbing.log.length === 0 && <li className="cor-text">{w.nothingRan}</li>}
        </ul>
      </section>
      <div className="cor-pl-foot">
        <OwnerCode />
        <span className="cor-text">
          <b>{w.onYourMachine}</b> · {macLine}
        </span>
        <Btn kind="link" aria-expanded={inventory} onClick={onInventory} data-control="inventario">
          {inventory ? w.hideRunning : w.showRunning}
        </Btn>
        <ReleaseLine />
        {/* PLA-I2-10: one language for the screen and the brief. */}
        <LanguageSwitch />
        {/* PLA-I2-7: the page of limits. */}
        <Link to={LIMITS_PATH} className="cor-text underline underline-offset-2" data-control="limites">
          {LIMITS_LINK}
        </Link>
      </div>
      <ConectarClaude />
      {/* PLA-I2-18: two downloads; the owner decides what to do with each file. */}
      <section className="cor-pl-foot" aria-label={ayuda.title} data-block="ayuda">
        <span className="cor-text">
          <a className="cor-btn link" href={HELP_REPORT_URL} download data-control="informe-ayuda">
            {ayuda.report}
          </a>
          <span className="cor-cap"> {ayuda.reportCap}</span>
        </span>
        <span className="cor-text">
          <a className="cor-btn link" href={EXPORT_ALL_URL} download data-control="exportar-todo">
            {ayuda.exportAll}
          </a>
          <span className="cor-cap"> {ayuda.exportAllCap}</span>
        </span>
        <span className="cor-cap">{ayuda.leaveCap}</span>
      </section>
    </div>
  );
};
