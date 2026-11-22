// PLA-I68-6: one environment of the project, any number of them. What runs there (a branch, each PR, another
// environment's tested build, tags), its address, its server and database picked from a catalog with honest badges
// (what it can do, what its rollback restores, anything paid shown before it is chosen), projects picked from what the
// saved key opens, the database's data, users, migration tool and history, when it migrates (Publicar reads it), SQL
// review, approval and backup, the variables it lacks (names only), the pages to open after releasing and a freeze
// window. Every edit is one staged change of the project's environments.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "@/lib/api";
import { caminoWords, catalog, serviceName } from "@/lib/camino";
import { entornosWords, envChanges, envFocus, KINDS, LISTABLE, MIGRATE_WHEN, newEnv, prodRecommended, rollbackOf, rolesSql, varsDiff, whoMigrates } from "@/lib/camino-entornos";
import type { CaminoEnv, CaminoRead, EnvKind, ProviderId } from "@/lib/camino-types";
import { Btn } from "./parts";
import { Blk, Ed, Experto, Recom, type CaminoLinks } from "./camino";
import { Tg } from "./camino-cambios";
import type { Cambios } from "./camino-store";

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/** The environments as staged (or as read). */
export const envsOf = (r: CaminoRead, cambios: Cambios): CaminoEnv[] => (cambios.staged("envs") as { patch: { envs: CaminoEnv[] } } | undefined)?.patch.envs ?? r.config.envs;

/** One line per environment: what runs there, its server, its database and when it migrates. */
const sayEnvs = (envs: CaminoEnv[]): string =>
  envs.map((e) => [e.name, e.server.provider ?? "—", e.database ? `${e.database.provider ?? "—"} · ${e.database.migrate_when}` : "—"].join(" · ")).join(" | ") || "—";

export function useSetEnvs(r: CaminoRead, cambios: Cambios) {
  const w = entornosWords();
  return (next: CaminoEnv[], what: string) => {
    // Back to what was read: nothing to apply.
    if (JSON.stringify(next) === JSON.stringify(r.config.envs)) return cambios.drop("envs");
    const from = sayEnvs(r.config.envs);
    const to = sayEnvs(next);
    cambios.stage({ key: "envs", change: { kind: "config", label: w.label(what), patch: { envs: next } }, dest: "plania", from, to: to === from ? `${to} · ${w.edited}` : to, lines: envChanges(r.config.envs, next, undefined, (id) => serviceName(id as ProviderId)) });
  };
}

const Picker = ({ r, provider, value, onPick, project, label, links }: { r: CaminoRead; provider: ProviderId; value: string | null; onPick: (v: string, url?: string | null) => void; project?: string; label: string; links: CaminoLinks }) => {
  const w = entornosWords();
  const q = useQuery({ queryKey: ["camino-list", r.slug, provider, project ?? ""], queryFn: () => api.caminoProviderList(r.slug, provider, project), staleTime: 60_000 });
  if (q.isPending) return <span className="cam-hint">{w.loading}</span>;
  if (!q.data?.connected) return null;
  // PLA-I70-23: a refused key says so, with the way to fix it.
  if (q.data.refused)
    return (
      <span className="cam-hint bad-t" role="alert" data-llave-rechazada>
        {w.keyRefused(serviceName(provider))}{" "}
        <Link className="cor-inline" to={links.hrefOf("conn")}>
          {w.connect}
        </Link>
      </span>
    );
  if (!q.data.items.length) return <span className="cam-hint">{w.nothingThere}</span>;
  return (
    <label className="cam-field">
      <span className="cam-lab">{label}</span>
      <select className="cor-input cor-mono" value={value ?? ""} onChange={(e) => onPick(e.target.value, q.data!.items.find((x) => x.id === e.target.value || x.name === e.target.value)?.url ?? null)} data-campo={`lista-${provider}`}>
        <option value="">—</option>
        {q.data.items.map((x) => (
          <option key={x.id} value={x.name}>
            {x.name}
            {x.note ? ` · ${x.note}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
};

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const ENV_RECORD = /^[a-z][a-z0-9_-]{0,29}$/;
type VercelCfg = { project_id: string; team_id: string | null; token_env: string | null; targets: Record<string, string> | null };

/** PLA-133: «Qué cuenta como publicado» (settings.release_on) and the environment that counts (settings.release_target),
 * moved here from Ajustes › Avanzado. Empty is Plania's default for each. */
const Publicado = ({ r, cambios, envs }: { r: CaminoRead; cambios: Cambios; envs: CaminoEnv[] }) => {
  const w = entornosWords();
  const staged = cambios.staged("release_rule") as { on: "env" | "branch" | null; target: string | null } | undefined;
  const read = { on: r.settings.release_on ?? null, target: r.settings.release_target ?? null };
  const cur = staged ?? read;
  const records = [...new Set(["prod", ...envs.map((x) => x.record).filter((x): x is string => !!x && ENV_RECORD.test(x)), ...(cur.target ? [cur.target] : [])])];
  const say = (x: typeof cur) => `${w.publishedOpts[x.on ?? "auto"]} · ${x.target ?? w.targetDefault}`;
  const put = (next: typeof cur) =>
    next.on === read.on && next.target === read.target
      ? cambios.drop("release_rule")
      : cambios.stage({ key: "release_rule", change: { kind: "release_rule", label: w.publishedLabel, ...next }, dest: "plania", from: say(read), to: say(next) });
  return (
    <div className="cam-grid2" data-publicado>
      <label className="cam-field">
        <span className="cam-lab">
          {w.published} <i>{w.publishedSub}</i>
        </span>
        <select className="cor-input" value={cur.on ?? ""} onChange={(ev) => put({ ...cur, on: (ev.target.value || null) as typeof cur.on })} data-campo="cuenta-publicado">
          <option value="">{w.publishedOpts.auto}</option>
          <option value="env">{w.publishedOpts.env}</option>
          <option value="branch">{w.publishedOpts.branch}</option>
        </select>
      </label>
      <label className="cam-field">
        <span className="cam-lab">{w.target}</span>
        {/* prod is the default: picking it on a project that never said keeps the setting unset. */}
        <select className="cor-input cor-mono" value={cur.target ?? "prod"} onChange={(ev) => put({ ...cur, target: ev.target.value === "prod" && read.target === null ? null : ev.target.value })} data-campo="entorno-cuenta">
          {records.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
};

/** PLA-133: which Vercel project the deploy poller reads (settings.vercel), moved here from Ajustes › Avanzado. Shown on
 * an environment whose server is Vercel. The poller keeps reading settings.vercel: this is where it is edited. */
const VercelLee = ({ r, cambios }: { r: CaminoRead; cambios: Cambios }) => {
  const w = entornosWords();
  const read: VercelCfg | null = r.settings.vercel_config ?? null;
  const staged = cambios.staged("vercel") as { config: VercelCfg | null } | undefined;
  const cur = staged ? staged.config : read;
  const [open, setOpen] = useState(!!cur);
  const [bad, setBad] = useState<string | null>(null);
  const on = open || !!cur;
  const sayCfg = (c: VercelCfg | null) => (c ? `${w.vercelOn} · ${c.project_id}${c.team_id ? ` · ${c.team_id}` : ""}${c.token_env ? ` · ${c.token_env}` : ""}` : w.vercelOff);
  const put = (next: VercelCfg | null) =>
    JSON.stringify(next) === JSON.stringify(read) ? cambios.drop("vercel") : cambios.stage({ key: "vercel", change: { kind: "vercel", label: w.vercelLabel, config: next }, dest: "plania", from: sayCfg(read), to: sayCfg(next) });
  const form = (el: HTMLElement) => {
    const box = el.closest("[data-vercel]")!;
    const val = (k: string) => ((box.querySelector(`[data-campo="${k}"]`) as HTMLInputElement | null)?.value ?? "").trim();
    const project_id = val("vercel-proyecto");
    const team_id = val("vercel-equipo") || null;
    const token_env = val("vercel-llave") || null;
    const prodT = val("vercel-produccion");
    const prevT = val("vercel-vista");
    if (!project_id) return setBad(w.vercelNeedsId);
    if (token_env && !ENV_NAME.test(token_env)) return setBad(w.varBad);
    if ((prodT && !ENV_RECORD.test(prodT)) || (prevT && !ENV_RECORD.test(prevT))) return setBad(w.vercelTargetBad);
    setBad(null);
    // Targets other than production and preview, set before, are kept.
    const { production: _p, preview: _v, ...rest } = cur?.targets ?? read?.targets ?? {};
    const targets = { ...rest, ...(prodT ? { production: prodT } : {}), ...(prevT ? { preview: prevT } : {}) };
    put({ project_id, team_id, token_env, targets: Object.keys(targets).length ? targets : null });
  };
  const field = (k: string, label: string, hint: string, value: string, placeholder?: string) => (
    <label className="cam-field">
      <span className="cam-lab">
        {label} <i>{hint}</i>
      </span>
      <input key={`${k}-${cambios.epoch}`} className="cor-input cor-mono" defaultValue={value} placeholder={placeholder} onBlur={(ev) => form(ev.target)} autoComplete="off" spellCheck={false} data-campo={k} />
    </label>
  );
  return (
    <div className="cam-field" data-vercel={on ? "si" : "no"}>
      <Tg
        on={on}
        title={w.vercelRead}
        sub={w.vercelReadSub}
        onClick={() => {
          if (on) {
            setOpen(false);
            setBad(null);
            put(null);
          } else setOpen(true);
        }}
        data-control="leer-vercel"
      />
      {on && (
        <>
          <div className="cam-grid3">
            {field("vercel-proyecto", w.vercelProject, w.vercelProjectHint, cur?.project_id ?? "", "prj_…")}
            {field("vercel-equipo", w.vercelTeam, w.vercelTeamHint, cur?.team_id ?? "", "team_…")}
            {field("vercel-llave", w.vercelKey, w.vercelKeyHint, cur?.token_env ?? "", "VERCEL_TOKEN")}
          </div>
          <div className="cam-grid3">
            {field("vercel-produccion", w.vercelProd, "", cur?.targets?.production ?? "", r.settings.release_target ?? "prod")}
            {field("vercel-vista", w.vercelPreview, "", cur?.targets?.preview ?? "", "preview")}
          </div>
          {bad && (
            <span className="cam-hint bad-t" role="alert">
              {bad}
            </span>
          )}
        </>
      )}
    </div>
  );
};

export const Entorno = ({ r, cambios, id, links }: { r: CaminoRead; cambios: Cambios; id: string; links: CaminoLinks }) => {
  const w = entornosWords();
  const cw = caminoWords();
  const xe = cw.expert.env;
  const envs = envsOf(r, cambios);
  const setEnvs = useSetEnvs(r, cambios);
  const navigate = useNavigate();
  const e = envs.find((x) => x.id === id);
  const orig = r.config.envs.find((x) => x.id === id);
  const g = r.discovery?.github.ok ? r.discovery.github : null;
  const mac = r.discovery?.mac;
  const cat = catalog();
  const [count, setCount] = useState<number | null>(null);
  const [present, setPresent] = useState<string[] | null>(null);
  useEffect(() => setCount(null), [id]);
  // PLA-158 (F-25): a link that names a part of this environment (#env-<id>-base, -cuando: «Decir quién migra», a
  // finding's fix) opens Modo experto and lands on that field.
  const location = useLocation();
  const [expert, setExpert] = useState<boolean | undefined>(undefined);
  const land = (anchor: string) => {
    setExpert(true);
    requestAnimationFrame(() => {
      const el = document.getElementById(anchor);
      el?.scrollIntoView({ block: "center" });
      el?.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    const h = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (h === envFocus(id, "base") || h === envFocus(id, "cuando")) land(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash, id]);
  const vars = useQuery({
    queryKey: ["camino-vars", r.slug, e?.server.provider ?? "", e?.server.project ?? ""],
    queryFn: () => api.caminoProviderVars(r.slug, e!.server.provider!, e!.server.project!, e!.kind === "produccion" ? "production" : "preview"),
    enabled: !!e?.server.provider && !!e.server.project && e.server.provider === "vercel",
    staleTime: 60_000,
  });
  if (!e) return null;
  const set = (patch: Partial<CaminoEnv>) => setEnvs(envs.map((x) => (x.id === id ? { ...x, ...patch } : x)), e.name);
  const setDb = (patch: Partial<NonNullable<CaminoEnv["database"]>>) => set({ database: { ...(e.database ?? { provider: null, name: null, data: "falsos", roles_split: false, migrate_when: "llegar", lock: false, sql_review: false, approve_destructive: false, backup: "ninguna" }), ...patch } });
  const prod = e.kind === "produccion";
  const branches = g?.branches.map((b) => b.name).filter((n) => !/^(dependabot|renovate)\//.test(n)) ?? [r.config.branches.published];
  const server = e.server.provider ? cat.find((s) => s.id === e.server.provider) : null;
  const dbInfo = e.database?.provider ? cat.find((s) => s.id === e.database!.provider) : null;
  const saved = (p: ProviderId | null) => !!p && !!r.config.connections[p];
  const example = mac?.env_example ?? [];
  const have = vars.data?.connected ? vars.data.names : (present ?? e.vars);
  const diff = varsDiff(example, have);
  const pages = ["/", ...(r.settings.capture_pages ?? [])];
  const who = whoMigrates(e);
  const tool = mac?.migrations;
  // PLA-158 (F-25): a database service with a saved key counts as known for production's recommendation.
  const knownDb = (Object.keys(r.config.connections) as ProviderId[]).find((p) => cat.find((s) => s.id === p)?.kind === "db") ?? null;
  const rec = e.database ? prodRecommended(e.database, knownDb) : null;
  // PLA-132: «Fusionar desde Plania» (settings.release.mode), moved here from Ajustes.
  const release = r.settings.release;
  const merge = ((cambios.staged("release_mode") as { mode: "command" | "merge" } | undefined)?.mode ?? release?.mode ?? "command") === "merge";
  return (
    <Ed id={`env-${e.id}`} title={e.name} lead={`${w.leadKind[e.kind]}${e.record ? ` · ${w.record(e.record)}` : ""}`} right={<span className={cls("cam-chip", prod && "warn")}>{w.kinds[e.kind]}</span>}>
      <div className="cam-grid3">
        <label className="cam-field">
          <span className="cam-lab">{w.name}</span>
          <input key={`n-${cambios.epoch}`} className="cor-input" defaultValue={e.name} onBlur={(ev) => ev.target.value.trim() && ev.target.value.trim() !== e.name && set({ name: ev.target.value.trim() })} data-campo="nombre-entorno" />
        </label>
        <div className="cam-field">
          <span className="cam-lab">{w.kind}</span>
          <div className="cam-chips" role="group" aria-label={w.kind}>
            {KINDS.map((k) => (
              <button key={k} type="button" className="cam-pill" aria-pressed={e.kind === k} onClick={() =>
                // PLA-I70-18: the migration moment follows the kind: production has no «al llegar a la rama», the others no «dentro del build».
                set({ kind: k, ...(e.database ? { database: { ...e.database, migrate_when: k === "produccion" && e.database.migrate_when === "llegar" ? "paso" : k !== "produccion" && e.database.migrate_when === "build" ? "llegar" : e.database.migrate_when } } : {}) })
              }>
                {w.kinds[k]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {prod && e.database && rec && (
        <Recom
          lines={[...(rec.missing ? [xe.pickDb(e.name)] : []), xe.sql, xe.approve, xe.backup, xe.when]}
          done={rec.done}
          onUse={() => {
            setDb(rec.patch);
            // PLA-158 (F-25): the service is the owner's to pick: open that part.
            if (rec.missing) land(envFocus(e.id, "base"));
          }}
        />
      )}
      <Experto id={`env-${e.id}`} open={expert} onToggle={setExpert}>
      <Blk cap={w.runs}>
        <div className="cam-grid3">
          <label className="cam-field">
            <span className="cam-lab">{w.runs}</span>
            <select
              className="cor-input"
              value={e.runs.kind}
              onChange={(ev) => {
                const k = ev.target.value;
                set({ runs: k === "branch" ? { kind: "branch", branch: r.config.branches.published } : k === "pr" ? { kind: "pr" } : k === "promote" ? { kind: "promote", from: envs.find((x) => x.id !== e.id)?.id ?? "" } : k === "tags" ? { kind: "tags", pattern: "v*" } : { kind: "none" } });
              }}
              data-campo="corre"
            >
              {(["branch", "pr", "promote", "tags", "none"] as const).map((k) => (
                <option key={k} value={k}>
                  {w.runsOpts[k]}
                </option>
              ))}
            </select>
          </label>
          {e.runs.kind === "branch" && (
            <label className="cam-field">
              <span className="cam-lab">{w.branch}</span>
              <select className="cor-input cor-mono" value={e.runs.branch} onChange={(ev) => set({ runs: { kind: "branch", branch: ev.target.value } })} data-campo="rama-entorno">
                {[...new Set([e.runs.branch, ...branches])].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
          )}
          {e.runs.kind === "promote" && (
            <label className="cam-field">
              <span className="cam-lab">{w.from}</span>
              <select className="cor-input" value={e.runs.from} onChange={(ev) => set({ runs: { kind: "promote", from: ev.target.value } })}>
                {envs
                  .filter((x) => x.id !== e.id)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {e.runs.kind === "tags" && (
            <label className="cam-field">
              <span className="cam-lab">{w.pattern}</span>
              <input key={`p-${cambios.epoch}`} className="cor-input cor-mono" defaultValue={e.runs.pattern} onBlur={(ev) => set({ runs: { kind: "tags", pattern: ev.target.value.trim() || "v*" } })} />
            </label>
          )}
        </div>
        {e.runs.kind === "promote" && <p className="cam-hint">{w.promoteNote}</p>}
      </Blk>

      <Blk cap={w.server} hint={server ? <span className={cls("cam-bdg", server.badge)}>{cw.conn.badge[server.badge]}</span> : undefined}>
        <div className="cam-chips" role="group" aria-label={w.server}>
          <button type="button" className="cam-pill" aria-pressed={!e.server.provider} onClick={() => set({ server: { provider: null, project: null, note: null } })}>
            {w.none}
          </button>
          {cat
            .filter((s) => s.kind === "server")
            .map((s) => (
              <button key={s.id} type="button" className="cam-pill" aria-pressed={e.server.provider === s.id} onClick={() => set({ server: { provider: s.id, project: null, note: null } })} data-servidor={s.id}>
                {s.name}
                {s.paid ? ` · ${w.paid}` : ""}
              </button>
            ))}
        </div>
        {server && (
          <>
            <ul className="cam-verbs">
              {server.does.map((t) => (
                <li key={t}>
                  <span className="ok-t" aria-hidden>✓</span>
                  {t}
                </li>
              ))}
            </ul>
            {server.paid && <p className="cam-hint bad-t">{server.paid}</p>}
            {rollbackOf(server.id) && (
              <dl className="cam-kv">
                <dt>{w.rollback}</dt>
                <dd>{rollbackOf(server.id)!.rollback}</dd>
              </dl>
            )}
            {LISTABLE.includes(server.id) &&
              (saved(server.id) || server.id === "github_releases" ? (
                <Picker r={r} provider={server.id} value={e.server.project} onPick={(v, url) => set({ server: { ...e.server, project: v || null }, ...(url && !e.url ? { url } : {}) })} label={w.project} links={links} />
              ) : (
                <p className="cam-hint">
                  {w.connectToPick(server.name)}{" "}
                  <Link className="cor-inline" to={links.hrefOf("conn")}>
                    {w.connect}
                  </Link>
                </p>
              ))}
          </>
        )}
        {server?.id === "vercel" && <VercelLee r={r} cambios={cambios} />}
        {server?.badge === "manual" && (
          // PLA-I70-19: a Manual service's own commands and checklist. Stored and shown; Plania never runs them.
          <div className="cam-field" data-manual={server.id}>
            <span className="cam-lab">{w.manualTitle}</span>
            <span className="cam-hint">{w.manualLead}</span>
            <label className="cam-field">
              <span className="cam-lab">{w.manualDeploy}</span>
              <input
                key={`md-${cambios.epoch}`}
                className="cor-input cor-mono"
                defaultValue={e.server.manual?.deploy ?? ""}
                onBlur={(ev) => (ev.target.value.trim() || null) !== (e.server.manual?.deploy ?? null) && set({ server: { ...e.server, manual: { deploy: ev.target.value.trim() || null, rollback: e.server.manual?.rollback ?? null, check: e.server.manual?.check ?? [] } } })}
                autoComplete="off"
                spellCheck={false}
                data-campo="manual-despliega"
              />
            </label>
            <label className="cam-field">
              <span className="cam-lab">{w.manualRollback}</span>
              <input
                key={`mr-${cambios.epoch}`}
                className="cor-input cor-mono"
                defaultValue={e.server.manual?.rollback ?? ""}
                onBlur={(ev) => (ev.target.value.trim() || null) !== (e.server.manual?.rollback ?? null) && set({ server: { ...e.server, manual: { deploy: e.server.manual?.deploy ?? null, rollback: ev.target.value.trim() || null, check: e.server.manual?.check ?? [] } } })}
                autoComplete="off"
                spellCheck={false}
                data-campo="manual-vuelve"
              />
            </label>
            <label className="cam-field">
              <span className="cam-lab">{w.manualCheck}</span>
              <textarea
                key={`mc-${cambios.epoch}`}
                className="cor-input cam-ta"
                defaultValue={(e.server.manual?.check ?? []).join("\n")}
                onBlur={(ev) => {
                  const check = ev.target.value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 20);
                  if (check.join("\n") !== (e.server.manual?.check ?? []).join("\n")) set({ server: { ...e.server, manual: { deploy: e.server.manual?.deploy ?? null, rollback: e.server.manual?.rollback ?? null, check } } });
                }}
                data-campo="manual-comprobar"
              />
            </label>
          </div>
        )}
        <label className="cam-field">
          <span className="cam-lab">
            {w.url} <i>{w.urlHint}</i>
          </span>
          <input className="cor-input cor-mono" defaultValue={e.url ?? ""} key={`${e.url ?? ""}-${cambios.epoch}`} onBlur={(ev) => (ev.target.value.trim() || null) !== e.url && set({ url: ev.target.value.trim() || null })} placeholder="https://" data-campo="url-entorno" />
        </label>
      </Blk>

      {e.kind !== "versiones" && (
        <Blk id={envFocus(e.id, "base")} tabIndex={-1} cap={w.db} hint={dbInfo ? <span className={cls("cam-bdg", dbInfo.badge)}>{cw.conn.badge[dbInfo.badge]}</span> : undefined}>
          <div className="cam-chips" role="group" aria-label={w.db}>
            <button type="button" className="cam-pill" aria-pressed={!e.database} onClick={() => set({ database: null })}>
              {w.noneDb}
            </button>
            {cat
              .filter((s) => s.kind === "db")
              .map((s) => (
                <button key={s.id} type="button" className="cam-pill" aria-pressed={e.database?.provider === s.id} onClick={() => setDb({ provider: s.id, name: null })} data-base={s.id}>
                  {s.name}
                  {s.paid ? ` · ${w.paid}` : ""}
                </button>
              ))}
          </div>
          {e.database && (
            <>
              {dbInfo?.paid && <p className="cam-hint bad-t">{dbInfo.paid}</p>}
              {dbInfo && rollbackOf(dbInfo.id) && (
                <dl className="cam-kv">
                  <dt>{w.rollback}</dt>
                  <dd>{rollbackOf(dbInfo.id)!.rollback}</dd>
                  <dt>{w.window}</dt>
                  <dd>{rollbackOf(dbInfo.id)!.window}</dd>
                </dl>
              )}
              {e.database.provider === "local_postgres" && (
                <label className="cam-field">
                  <span className="cam-lab">
                    {w.dbName} <i>{w.dbNameHint}</i>
                  </span>
                  <select className="cor-input cor-mono" value={e.database.name ?? ""} onChange={(ev) => setDb({ name: ev.target.value || null })} data-campo="base-local">
                    <option value="">—</option>
                    {/* PLA-158 (F-26): Plania's own test and copy bases are gone from the list; the project's own leads it. */}
                    {[...new Set([...(mac?.postgres?.databases ?? []), ...(e.database.name ? [e.database.name] : [])])].map((d) => (
                      <option key={d} value={d}>
                        {d === mac?.postgres?.own ? `${d} · ${w.ownDb}` : d}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {e.database.provider === "neon" &&
                (saved("neon") ? <Picker r={r} provider="neon" value={e.database.name} onPick={(v) => setDb({ name: v || null })} label={w.project} links={links} /> : <p className="cam-hint">{w.connectToPick("Neon")}</p>)}
              <div className="cam-field">
                <span className="cam-lab">{w.data}</span>
                <div className="cam-chips" role="group" aria-label={w.data}>
                  {(["falsos", "copia", "real"] as const).map((v) => (
                    <button key={v} type="button" className="cam-pill" aria-pressed={e.database!.data === v} onClick={() => setDb({ data: v })}>
                      {w.dataOpts[v]}
                    </button>
                  ))}
                </div>
                {e.database.data === "real" && <span className="cam-hint">{w.realNote}</span>}
              </div>
              {tool && (
                <p className="cam-line">
                  <span className="cor-mono">{w.tool(tool.tool ?? "SQL", tool.dir)}</span> <span className="cam-src">{w.detected}</span>
                  {e.database.provider === "local_postgres" && e.database.name && tool.tool && (
                    <>
                      {count !== null ? (
                        <span className={count < tool.count ? "warn-t" : "ok-t"}>{w.history(count, tool.count)}</span>
                      ) : (
                        <Btn kind="link" small onClick={() => api.caminoMigrations(r.slug, e.database!.name!, tool.tool!).then((x) => setCount(x.count))} data-control="leer-migraciones">
                          {w.historyRead}
                        </Btn>
                      )}
                    </>
                  )}
                </p>
              )}
              <Tg on={e.database.roles_split} title={w.roles} sub={w.rolesSub} onClick={() => setDb({ roles_split: !e.database!.roles_split })} />
              {e.database.roles_split && <pre className="cam-preview">{rolesSql(e.database.name ?? e.id)}</pre>}
              <div className="cam-field" id={envFocus(e.id, "cuando")} tabIndex={-1}>
                <span className="cam-lab">{w.when}</span>
                <div className="cam-grid3" role="group" aria-label={w.when}>
                  {MIGRATE_WHEN.filter((k) => (prod ? k !== "llegar" : k !== "build")).map((k) => (
                    <button key={k} type="button" className="cam-choice" aria-pressed={e.database!.migrate_when === k} disabled={k === "nunca"} onClick={() => setDb({ migrate_when: k })} data-migrar={k}>
                      <b>
                        {w.whenOpts[k].name}
                        {k === "paso" && prod && <span className="cam-bdg rec">{w.recommended}</span>}
                        {orig?.database?.migrate_when === k && <span className="cam-bdg">{w.today}</span>}
                      </b>
                      <span>{w.whenOpts[k].sub}</span>
                    </button>
                  ))}
                </div>
                {e.database.migrate_when === "build" && <Tg on={e.database.lock} title={w.lock} sub={w.lockSub} onClick={() => setDb({ lock: !e.database!.lock })} />}
              </div>
              {prod && (
                <>
                  <div className="cam-grid2">
                    <Tg on={e.database.sql_review} title={w.sqlReview} sub={w.sqlReviewSub} onClick={() => setDb({ sql_review: !e.database!.sql_review })} data-control="revisar-sql" />
                    <Tg on={e.database.approve_destructive} title={w.approve} sub={w.approveSub} onClick={() => setDb({ approve_destructive: !e.database!.approve_destructive })} data-control="aprobar-borrado" />
                  </div>
                  <label className="cam-field">
                    <span className="cam-lab">{w.backup}</span>
                    <select className="cor-input" value={e.database.backup} onChange={(ev) => setDb({ backup: ev.target.value as NonNullable<CaminoEnv["database"]>["backup"] })} data-campo="copia">
                      {(["proveedor", "dump", "ninguna"] as const).map((v) => (
                        <option key={v} value={v}>
                          {w.backupOpts[v]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="cam-box info">{w.restoreNote}</div>
                </>
              )}
            </>
          )}
          {prod && who && (
            <p className="cam-hint" data-quien-migra={who}>
              {w.publicar(w.who[who]!)}
            </p>
          )}
        </Blk>
      )}

      <Blk cap={w.vars} hint={w.varsHint}>
        {example.length === 0 ? (
          <p className="cam-hint">{w.varsNone}</p>
        ) : (
          <>
            {!vars.data?.connected && <p className="cam-hint">{w.varsNoKey}</p>}
            <div className="cam-chips" data-variables={diff.missing.length}>
              {example.map((n) => {
                const ok = diff.ok.includes(n);
                return vars.data?.connected ? (
                  <span key={n} className={cls("cam-chip", ok ? "ok" : "warn")}>
                    {ok ? `✓ ${n}` : w.missing(n)}
                  </span>
                ) : (
                  <button
                    key={n}
                    type="button"
                    className="cam-pill"
                    aria-pressed={ok}
                    onClick={() => {
                      const next = ok ? have.filter((x) => x !== n) : [...have, n];
                      setPresent(next);
                      set({ vars: next });
                    }}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Blk>

      {e.kind !== "versiones" && (
        <Blk cap={w.health}>
          <label className="cam-field">
            <span className="cam-lab">
              {w.healthUrl} <i>{w.healthHint}</i>
            </span>
            <input key={`h-${cambios.epoch}`} className="cor-input cor-mono" defaultValue={e.health.url ?? ""} onBlur={(ev) => (ev.target.value.trim() || null) !== e.health.url && set({ health: { ...e.health, url: ev.target.value.trim() || null } })} placeholder="/api/salud" data-campo="salud" />
          </label>
          <div className="cam-field">
            <span className="cam-lab">
              {w.pages} <i>{w.pagesHint}</i>
            </span>
            <div className="cam-chips" role="group" aria-label={w.pages}>
              {[...new Set([...pages, ...e.health.pages])].map((pg) => (
                <button key={pg} type="button" className="cam-pill" aria-pressed={e.health.pages.includes(pg)} onClick={() => set({ health: { ...e.health, pages: e.health.pages.includes(pg) ? e.health.pages.filter((x) => x !== pg) : [...e.health.pages, pg] } })}>
                  {pg}
                </button>
              ))}
            </div>
          </div>
          {prod && <Tg on={e.freeze} title={w.freeze} sub={w.freezeSub} onClick={() => set({ freeze: !e.freeze })} data-control="congelar" />}
        </Blk>
      )}

      <Blk cap={w.whoPublishes}>
        <p className="cam-line">{w.onlyYou}</p>
        {prod && <Publicado r={r} cambios={cambios} envs={envs} />}
        {prod && release && (
          <Tg
            on={merge}
            title={w.merge}
            sub={w.mergeSub}
            onClick={() => cambios.stage({ key: "release_mode", change: { kind: "release_mode", label: w.merge, mode: merge ? "command" : "merge" }, dest: "plania", from: release.mode === "merge" ? w.mergeOn : w.mergeOff, to: merge ? w.mergeOff : w.mergeOn })}
            data-control="fusionar-desde-plania"
          />
        )}
        <div className="cam-acts">
          <Btn kind="quiet" small onClick={() => {
              setEnvs(envs.filter((x) => x.id !== id), e.name);
              // PLA-I70-39: the page this URL named is gone; go to Resumen.
              navigate(links.hrefOf("resumen"));
            }} data-control="quitar-entorno">
            {w.remove}
          </Btn>
          <span className="cam-hint">{w.removeNote}</span>
        </div>
      </Blk>
      </Experto>
    </Ed>
  );
};

/** «+ Agregar entorno»: a name and a kind, staged; the new environment opens. */
export const AddEnv = ({ r, cambios, onAdded }: { r: CaminoRead; cambios: Cambios; onAdded: (id: string) => void }) => {
  const w = entornosWords();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<EnvKind>("permanente");
  const setEnvs = useSetEnvs(r, cambios);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener("camino:add-env", on);
    return () => window.removeEventListener("camino:add-env", on);
  }, []);
  if (!open)
    return (
      <button type="button" className="cam-sec cam-add-env" onClick={() => setOpen(true)} data-control="agregar-entorno">
        <span />
        <b>{w.add}</b>
      </button>
    );
  return (
    <form
      className="cam-add-form"
      aria-label={w.addTitle}
      onKeyDown={(ev) => {
        // PLA-I70-36: Esc closes the form.
        if (ev.key === "Escape") {
          ev.stopPropagation();
          setOpen(false);
          setName("");
        }
      }}
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!name.trim()) return;
        const envs = envsOf(r, cambios);
        const e = newEnv(envs, kind, name.trim(), kind === "produccion" ? r.config.branches.published : (r.config.branches.integration ?? r.config.branches.published));
        setEnvs([...envs, e], e.name);
        setOpen(false);
        setName("");
        onAdded(e.id);
      }}
    >
      <input className="cor-input" value={name} onChange={(ev) => setName(ev.target.value)} placeholder={w.addName} aria-label={w.addName} autoFocus data-campo="nuevo-entorno" />
      <select className="cor-input" value={kind} onChange={(ev) => setKind(ev.target.value as EnvKind)} aria-label={w.kind}>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {w.kinds[k]}
          </option>
        ))}
      </select>
      <Btn kind="secondary" small type="submit" disabled={!name.trim()} data-control="crear-entorno">
        {w.addCreate}
      </Btn>
      <Btn kind="quiet" small onClick={() => (setOpen(false), setName(""))} data-control="cancelar-entorno">
        {w.addCancel}
      </Btn>
    </form>
  );
};
