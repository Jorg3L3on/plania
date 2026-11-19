// PLA-I62-8: Plomería (board D3), the plumbing that lives on /machine, redrawn in place with everything it has and in
// plain words: the company's state with Detener la compañía (with what it closes) and Reanudar; the plan's brake
// (Mover el freno, its own small form; «Seguir aunque el plan esté alto»); what the models spent this week; each
// project with Pausar / Reanudar and its app's switch, Configurar su app and Apagar todas las apps (the building's
// tablero); the last runs; the owner's code row. The calls are the ones /machine and the tablero make.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { OWNER_CODE_WORDS, isOwnerCode } from "@/components/compania/sheets";
import { ApiError, api, type MachinePlumbing } from "@/lib/api";
import { tokens, type CompanyProjectRow, type RunBrief } from "@/lib/compania";
import { seatName, thousands } from "@/lib/corriente";
import { tableroView } from "@/lib/maquinas";
import { logWords } from "@/lib/calidad";
import { Btn, Key, Label, Switch } from "./parts";

export const weekParts = (plumbing: MachinePlumbing) => {
  const w = plumbing.usage.week;
  const rows = [plumbing.usage.asistente, ...plumbing.usage.projects.map((p) => p.usage)];
  const sum = (k: "input" | "output" | "cache_read" | "cache_create") => (w ? (w[k] ?? 0) : rows.reduce((n, u) => n + (u[k] ?? 0), 0));
  return { main: w ? w.used : rows.reduce((n, u) => n + u.used, 0), cache_read: sum("cache_read"), cache_create: sum("cache_create") };
};

/** The headline: whether the company runs, and with or without the plan's brake. */
export function plumbingHead(p: MachinePlumbing): { title: string; sub: string; tone: "ok" | "warn" | "stop" } {
  const n = p.usage.projects.filter((x) => !x.paused).length;
  if (p.company.paused) return { title: "La compañía está detenida.", sub: "Nada arranca hasta que la reanudes. No se borra nada.", tone: "stop" };
  if (p.plan.override) return { title: "La compañía trabaja sin el freno del plan.", sub: `Nada corre ahora y ${n === 1 ? "el proyecto puede" : `los ${n} proyectos pueden`} arrancar. Le dijiste que siga aunque tu plan de Claude esté alto: solo se detiene si Claude ya no acepta más uso.`, tone: "warn" };
  const pct = p.plan.five_hour_pct;
  if (pct !== null && pct >= p.plan.guard_pct) return { title: "El freno del plan está puesto.", sub: `Tu plan va en ${Math.round(pct)}% y el freno está en ${p.plan.guard_pct}%: nada nuevo arranca hasta que baje.`, tone: "warn" };
  return { title: "La compañía está en marcha.", sub: `${n === 1 ? "El proyecto puede" : `Los ${n} proyectos pueden`} arrancar. Arriba del freno del plan no arranca nada nuevo.`, tone: "ok" };
}

const RUN_WORD: Record<string, [string, "ok" | "bad" | undefined]> = { ok: ["Terminó bien", "ok"], fail: ["Falló", "bad"], stopped: ["La detuviste", undefined], skipped: ["No arrancó", "bad"], running: ["Corriendo", undefined] };
const hm = (iso: string | null, tz?: string) => (iso ? new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso)) : "");
const mins = (a: string | null, b: string | null) => (a && b ? Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 60_000)) : null);

const OwnerCode = () => {
  const client = useQueryClient();
  const owner = useQuery({ queryKey: ["owner-code"], queryFn: api.ownerCode, staleTime: 60_000 });
  const enrol = useMutation({ mutationFn: api.enrolOwnerCode, onSuccess: () => void client.invalidateQueries({ queryKey: ["owner-code"] }) });
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const enrolled = owner.data?.enrolled ?? null;
  const error = enrol.error instanceof ApiError ? (enrol.error.code === "INVALID_PASSWORD" ? "Contraseña incorrecta." : (OWNER_CODE_WORDS[enrol.error.code] ?? `No se pudo (${enrol.error.code}).`)) : null;
  return (
    <div className="cor-owner" data-owner-code-row={enrolled ? "1" : "0"}>
      <span className="cor-text">
        <b>Código del dueño</b> · {enrolled == null ? "…" : enrolled ? "configurado; borrar un proyecto lo pide" : "sin configurar; solo se pide para borrar un proyecto"}
      </span>
      <Btn kind="link" aria-expanded={open} onClick={() => setOpen((x) => !x)} data-control="codigo-dueno">
        {enrolled ? "Cambiar" : "Configurar"}
      </Btn>
      {open && !enrol.data && (
        <form
          className="cor-ajuste-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) enrol.mutate({ password, code: enrolled ? code : undefined });
          }}
        >
          <input type="password" className="cor-input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-label="Contraseña" placeholder="Tu contraseña" />
          {enrolled && <input inputMode="numeric" maxLength={6} className="cor-input cor-mono" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} aria-label="Código del dueño actual" placeholder="000000" />}
          <Btn kind="secondary" type="submit" disabled={enrol.isPending || !password || (!!enrolled && !isOwnerCode(code))}>
            Generar código
          </Btn>
          {error && <span className="cor-state bad">{error}</span>}
        </form>
      )}
      {enrol.data && (
        <p className="cor-text" data-owner-secret>
          Agrégalo a tu app de autenticación ahora; no se vuelve a mostrar: <span className="cor-mono">{enrol.data.secret_base32}</span>
        </p>
      )}
    </div>
  );
};

export const Plomeria = ({ plumbing, inventory, onInventory, macLine }: { plumbing: MachinePlumbing; inventory: boolean; onInventory: () => void; macLine: string }) => {
  const client = useQueryClient();
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
    onSuccess: (r) => (toast(r.paused ? `Compañía detenida${r.stopped ? ` · ${r.stopped} corridas cerrándose` : ""}` : "Compañía en marcha"), setStopping(null), refresh()),
    onError: () => toast.error("No se pudo cambiar el interruptor"),
  });
  const projectSwitch = useMutation({
    mutationFn: ({ slug, paused }: { slug: string; paused: boolean }) => api.setProjectPaused(slug, paused),
    onSuccess: (r) => (toast(r.paused ? `${titles.get(r.project) ?? r.project} en pausa` : `${titles.get(r.project) ?? r.project} reanudado`), setStopping(null), refresh()),
    onError: () => toast.error("No se pudo cambiar el interruptor del proyecto"),
  });
  const saveGuard = useMutation({
    mutationFn: (v: number) => api.setRunnerSettings({ plan_guard_pct: v }),
    onSuccess: () => (toast("Guardado"), setGuard(null), refresh()),
    onError: () => toast.error("No se pudo guardar"),
  });
  const override = useMutation({ mutationFn: (on: boolean) => api.setRunnerSettings({ guard_override: on }), onSuccess: (_r, on) => (toast(on ? "Límite del plan ignorado" : "Freno del plan activo"), refresh()), onError: () => toast.error("No se pudo guardar") });
  const tablero = useQuery({ queryKey: ["maquinas-tablero"], queryFn: () => api.tablero(), refetchInterval: 15_000, retry: 1 });
  const tv = tablero.data ? tableroView(tablero.data) : null;
  const [busy, setBusy] = useState<string | null>(null);
  const appRun = useMutation({
    mutationFn: async (x: { key: string; call: () => Promise<unknown> }) => x.call(),
    onMutate: (x) => setBusy(x.key),
    onError: () => toast.error("No se pudo. Si la Mac está dormida, intenta al despertar."),
    onSettled: () => (setBusy(null), refresh(), void client.invalidateQueries({ queryKey: ["maquinas"] })),
  });
  const head = plumbingHead(plumbing);
  const w = weekParts(plumbing);
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
      <section className="cor-pl-hero" aria-label="Estado de la compañía">
        <div>
          <Label>Plomería · esta semana</Label>
          <h1 className="cor-h2" data-pl-head>
            {head.tone !== "ok" && <span className={head.tone === "stop" ? "cor-state bad" : "cor-amber"} aria-hidden>{head.tone === "stop" ? "■ " : "▲ "}</span>}
            {head.title}
          </h1>
          <p className="cor-text">{head.sub}</p>
        </div>
        {canEdit &&
          (plumbing.company.paused ? (
            <Btn kind="primary" disabled={companySwitch.isPending} onClick={() => companySwitch.mutate(false)} data-control="reanudar-compania">
              Reanudar la compañía
            </Btn>
          ) : stopping?.kind === "company" ? (
            <div className="cor-card cor-confirm" role="alertdialog" aria-label="¿Detener la compañía?" data-confirm="company">
              <p className="cor-text">
                <b>¿Detener la compañía?</b> {live.length ? `Se cierran ${live.length === 1 ? "la corrida" : `las ${live.length} corridas`} que están corriendo` : "Nada está corriendo"} y nada nuevo arranca. Se puede deshacer.
              </p>
              <span className="cor-acts">
                <Btn kind="danger" disabled={companySwitch.isPending} onClick={() => companySwitch.mutate(true)} data-control="detener-si">
                  Sí, detener
                </Btn>
                <Btn kind="quiet" onClick={() => setStopping(null)}>
                  Cancelar
                </Btn>
              </span>
            </div>
          ) : (
            <span className="cor-pl-stop">
              <Btn kind="danger" onClick={() => setStopping({ kind: "company" })} data-control="detener-compania">
                Detener la compañía
              </Btn>
              <span className="cor-cap">Cierra lo que esté corriendo y nada nuevo arranca. Se puede deshacer.</span>
            </span>
          ))}
      </section>
      <div className="cor-pl-grid">
        <section aria-label="Lo que gastaron los modelos esta semana" data-block="tokens">
          <Label as="h2">Lo que gastaron los modelos esta semana</Label>
          <p className="cor-pl-big">
            <span className="cor-figure">{thousands(w.main)}</span> <span className="cor-text">tokens (lo que leen + lo que escriben)</span>
          </p>
          <p className="cor-cap">Sin límite propio. El freno es el de tu plan.</p>
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
                <span className="cor-cap">{spent.length > 2 ? tokens(spent.slice(2).reduce((n, p) => n + p.usage.used, 0)) : "sin reporte"}</span>
              </li>
            )}
          </ul>
          <p className="cor-cap">{`Aparte, lo que releyeron de memoria (más barato, no cuenta arriba): ${thousands(w.cache_read)} leídos y ${thousands(w.cache_create)} guardados.`}</p>
        </section>
        <section aria-label="Freno del plan" data-block="freno">
          <Label as="h2">Freno del plan</Label>
          <div className="cor-planline">
            <span className="cor-text">Tu plan, últimas 5 horas</span>
            <span className="cor-cap">{`${pct === null ? "—" : `${Math.round(pct)}%`}${plumbing.plan.resets_at ? ` · a cero ${hm(plumbing.plan.resets_at, tz)}` : ""}`}</span>
          </div>
          <span className="cor-meter" aria-hidden>
            <i style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
            <u style={{ left: `${plumbing.plan.guard_pct}%` }} />
          </span>
          <p className="cor-cap">{`La raya es el freno (${plumbing.plan.guard_pct}%): arriba no arranca nada nuevo.`}</p>
          <div className="cor-krow">
            <span className="cor-text">{`Uso de la semana ${plumbing.plan.seven_day_pct === null ? "—" : `${Math.round(plumbing.plan.seven_day_pct)}%`}`}</span>
            {canEdit && guard === null && (
              <Btn kind="secondary" onClick={() => setGuard(String(plumbing.plan.guard_pct))} data-control="mover-guardia">
                Mover el freno
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
              <Label as="p">Al tocar «Mover el freno» · solo tú lo mueves</Label>
              <span className="cor-ajuste-row">
                <label className="cor-text" htmlFor="freno-pct">
                  Freno, % de 5 horas
                </label>
                <input id="freno-pct" inputMode="numeric" className="cor-input cor-mono" style={{ width: 90 }} value={guard} onChange={(e) => setGuard(e.target.value)} />
                <Btn kind="quiet" onClick={() => setGuard(null)}>
                  Cancelar
                </Btn>
                <Btn kind="secondary" type="submit" disabled={!guardValid || saveGuard.isPending} data-control="guardar-freno">
                  Guardar
                </Btn>
              </span>
            </form>
          )}
          <label className={`cor-card cor-override ${plumbing.plan.override ? "on" : ""}`} data-inline-ok>
            <input type="checkbox" checked={plumbing.plan.override === true} disabled={!canEdit || override.isPending} onChange={(e) => override.mutate(e.target.checked)} data-control="seguir-sin-guardia" />
            <span>
              <b>Seguir aunque el plan esté alto</b>
              <span className="cor-cap">{plumbing.plan.override ? "Encendido: el freno no se usa." : "Apagado: el freno detiene lo nuevo al llegar."}</span>
            </span>
          </label>
        </section>
        <section aria-label="Proyectos, agentes y app en tu Mac" data-block="proyectos">
          <div className="cor-side-head">
            <Label as="h2">Proyectos · agentes y app en tu Mac</Label>
            {tv && tv.stoppable.length > 0 && (
              <Btn kind="quiet" disabled={busy === "todo"} onClick={() => appRun.mutate({ key: "todo", call: () => Promise.all(tv.stoppable.map((slug) => api.prueba(slug, "apagar"))) })} data-control="apagar-todo">
                Apagar todas las apps
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
                    <span className="cor-cap">{p.paused ? "EN PAUSA" : plumbing.company.paused ? "DETENIDA" : "EN MARCHA"}</span>
                  </span>
                  {app && !app.configured ? (
                    <Btn kind="link" disabled={busy === `cfg:${p.slug}`} onClick={() => appRun.mutate({ key: `cfg:${p.slug}`, call: () => api.configurar(p.slug) })} data-control="configurar-app">
                      Configurar su app
                    </Btn>
                  ) : app && app.phase === "running" && !app.managed ? (
                    <span className="cor-cap">ENCENDIDA FUERA DE AQUÍ</span>
                  ) : app ? (
                    <Switch on={app.on} label={app.on ? `App encendida${app.port ? ` :${app.port}` : ""}` : "App apagada"} onChange={(v) => appRun.mutate({ key: `sw:${p.slug}`, call: () => api.prueba(p.slug, v ? "encender" : "apagar") })} disabled={busy === `sw:${p.slug}`} data-control="app-switch" aria-label={`App de ${p.title}`} />
                  ) : (
                    <span />
                  )}
                  {canEdit &&
                    (p.paused ? (
                      <Btn kind="quiet" disabled={projectSwitch.isPending} onClick={() => projectSwitch.mutate({ slug: p.slug, paused: false })} data-control="reanudar-proyecto">
                        Reanudar
                      </Btn>
                    ) : stopping?.kind === "project" && stopping.p.slug === p.slug ? (
                      <Btn kind="danger" disabled={projectSwitch.isPending} onClick={() => projectSwitch.mutate({ slug: p.slug, paused: true })} data-control="pausar-si">
                        ¿Pausar? Sí
                      </Btn>
                    ) : (
                      <Btn kind="quiet" onClick={() => setStopping({ kind: "project", p })} data-control="pausar-proyecto">
                        Pausar
                      </Btn>
                    ))}
                </li>
              );
            })}
          </ul>
          <p className="cor-cap">Pausar no borra nada.</p>
        </section>
      </div>
      <section className="cor-pl-log" aria-label="Lo último que corrió" data-block="bitacora">
        <div className="cor-side-head">
          <Label as="h2">Lo último que corrió</Label>
          {plumbing.log.length > 3 && (
            <Btn kind="link" onClick={() => setLogAll((x) => !x)} data-control="bitacora">
              {logAll ? "Ver menos" : "Ver toda la bitácora"}
            </Btn>
          )}
        </div>
        <ul className={logAll ? "cor-scrollbox" : ""} tabIndex={logAll ? 0 : undefined}>
          {log.map((x) => {
            const [word, tone] = x.resolved ? (["Ya resuelto", undefined] as [string, undefined]) : (RUN_WORD[x.status] ?? [x.status, undefined]);
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
                <span className="cor-cap">{`HOY ${hm(x.ended_at ?? x.started_at, tz)}${m ? ` · ${m} MIN` : ""}`}</span>
              </li>
            );
          })}
          {plumbing.log.length === 0 && <li className="cor-text">Nada ha corrido todavía.</li>}
        </ul>
      </section>
      <div className="cor-pl-foot">
        <OwnerCode />
        <span className="cor-text">
          <b>En tu Mac</b> · {macLine}
        </span>
        <Btn kind="link" aria-expanded={inventory} onClick={onInventory} data-control="ver-que-corre">
          {inventory ? "Ocultar lo que corre" : "Ver qué corre"}
        </Btn>
      </div>
    </div>
  );
};
