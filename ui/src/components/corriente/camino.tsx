// PLA-I68-2 (PLA-IDEA32, Camino v4): a project's door «Camino», configuration only. The page head says how ready the
// path is and when it was last checked against GitHub, the services and this Mac (Volver a comprobar reads again).
// Left: the sections with their dot. Right: the open section. Resumen draws the path strip and the findings by
// severity, each with its one fix; Conexiones y llaves shows every account with how it was connected, what it can do,
// expiry and last use, Probar and Cambiar, and the service catalog; Propuestas lists the PRs by destination branch;
// Historial lists every change with where it went and how to undo it. Every word and rule is in @/lib/camino.
import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { ApiError, api, type OrgProject } from "@/lib/api";
import {
  agoText,
  caminoWords,
  cards,
  catalog,
  findings,
  isSetup,
  proposalGroups,
  readyLine,
  sections,
  serviceName,
  setupList,
  strip,
  type Card,
  type Finding,
  type Fix,
  type Section,
  type SectionId,
  type Sev,
} from "@/lib/camino";
import type { CaminoRead } from "@/lib/camino-types";
import { LOCALE } from "@/lib/locale";
import { Btn, ReadError } from "./parts";
import { caminoKey, useCamino } from "./camino-query";
import { useCambios } from "./camino-store";
import { CambiosBar } from "./camino-cambios";
import { Codigo } from "./camino-codigo";
import { Commits } from "./camino-commits";
import { Pruebas } from "./camino-pruebas";

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");
export type CaminoLinks = { hrefOf: (sec: SectionId) => string; prHref: (n: number) => string; ajustesHref: (sec: string) => string };

export const Dot = ({ sev }: { sev: Sev | "off" }) => <i className={cls("cam-dot", sev)} aria-hidden />;

/** A section's editor frame: its title, its lead and what is inside. */
export const Ed = ({ title, lead, right, children, id }: { title: string; lead: ReactNode; right?: ReactNode; children: ReactNode; id: string }) => (
  <section className="cam-ed" aria-labelledby={`cam-h-${id}`} data-camino-sec={id}>
    <header className="cam-ed-h">
      <div>
        <h3 id={`cam-h-${id}`}>{title}</h3>
        <p className="cor-text">{lead}</p>
      </div>
      {right}
    </header>
    {children}
  </section>
);

export const Blk = ({ cap, hint, children, ...rest }: { cap: string; hint?: ReactNode; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) => (
  <div className="cam-blk" {...rest}>
    <div className="cam-blk-h">
      <h4 className="cam-cap">{cap}</h4>
      {hint && <span className="cam-hint">{hint}</span>}
    </div>
    {children}
  </div>
);

const FixButton = ({ fix, links, onRecheck, busy }: { fix: Fix; links: CaminoLinks; onRecheck: () => void; busy: boolean }) => {
  if (fix.go) return <Link className="cor-btn secondary small cam-fix" to={links.hrefOf(fix.go)} data-fix={fix.go}>{fix.label}</Link>;
  if (fix.ajustes) return <Link className="cor-btn secondary small cam-fix" to={links.ajustesHref(fix.ajustes)} data-fix={`ajustes:${fix.ajustes}`}>{fix.label}</Link>;
  return (
    <Btn kind="secondary" small className="cam-fix" disabled={busy} onClick={onRecheck} data-fix="recheck">
      {fix.label}
    </Btn>
  );
};

const FindingRow = ({ f, links, onRecheck, busy }: { f: Finding; links: CaminoLinks; onRecheck: () => void; busy: boolean }) => (
  <li className={cls("cam-find", f.sev)} data-finding={f.id} data-sev={f.sev}>
    <Dot sev={f.sev} />
    <span className="cam-find-t">{f.title}</span>
    {f.detail && <span className="cam-find-s">{f.detail}</span>}
    {f.fix && (
      <span className="cam-find-a">
        <FixButton fix={f.fix} links={links} onRecheck={onRecheck} busy={busy} />
      </span>
    )}
  </li>
);

// ---- Resumen
const Resumen = ({ r, F, links, onRecheck, busy }: { r: CaminoRead; F: Finding[]; links: CaminoLinks; onRecheck: () => void; busy: boolean }) => {
  const w = caminoWords();
  const [all, setAll] = useState(false);
  const top = F.filter((f) => f.sev !== "ok");
  const ok = F.filter((f) => f.sev === "ok");
  const nodes = strip(r, F);
  const setup = isSetup(r);
  return (
    <Ed id="resumen" title={w.sections.resumen} lead={setup ? w.resumen.leadSetup : w.resumen.lead}>
      <div className="cam-strip" role="list" aria-label={w.title(r.title)}>
        {nodes.map((n, i) => (
          <div key={n.go} className="cam-strip-cell" role="listitem">
            {i > 0 && (
              <svg className="cam-arw" width="28" height="12" aria-hidden>
                <path d="M0 6 H24" />
                <path d="M19 1 L25 6 L19 11" className="head" />
              </svg>
            )}
            <Link to={links.hrefOf(n.go)} className={cls("cam-node", n.off && "off")} data-node={n.go}>
              <span className="cam-node-t">
                <Dot sev={n.dot} />
                {n.title}
              </span>
              <span className="cam-node-s">{n.sub}</span>
              <span className="cam-node-m">{n.meta}</span>
            </Link>
          </div>
        ))}
      </div>
      {setup && (
        <Blk cap={w.resumen.setup} data-camino-setup>
          <ul className="cam-list">
            {setupList(r).map((x) => (
              <li key={x.title} className="cam-task">
                <span className={cls("cam-mark", x.mark === "✓" ? "ok" : x.mark === "○" ? "warn" : "")} aria-hidden>
                  {x.mark}
                </span>
                <span>{x.title}</span>
                <small>{x.sub}</small>
                <Link className="cor-btn quiet small" to={links.hrefOf(x.go)} aria-label={`${w.resumen.open}: ${x.title}`}>
                  {w.resumen.open}
                </Link>
              </li>
            ))}
          </ul>
        </Blk>
      )}
      <Blk cap={w.resumen.attention(top.length)} hint={w.resumen.bySeverity} data-camino-findings={top.length}>
        {top.length === 0 ? (
          <p className="cam-hint">{w.resumen.nothing}</p>
        ) : (
          <ul className="cam-list">
            {(all ? top : top.slice(0, 6)).map((f) => (
              <FindingRow key={f.id} f={f} links={links} onRecheck={onRecheck} busy={busy} />
            ))}
          </ul>
        )}
        {top.length > 6 && (
          <Btn kind="link" onClick={() => setAll((x) => !x)} aria-expanded={all} data-control="camino-ver-todo">
            {all ? w.resumen.seeLess : w.resumen.seeAll(top.length)}
          </Btn>
        )}
      </Blk>
      {ok.length > 0 && (
        <Blk cap={w.resumen.good}>
          <ul className="cam-list">
            {ok.map((f) => (
              <FindingRow key={f.id} f={f} links={links} onRecheck={onRecheck} busy={busy} />
            ))}
          </ul>
        </Blk>
      )}
      <p className="cam-hint">{w.resumen.foot}</p>
    </Ed>
  );
};

// ---- Conexiones y llaves
function keyError(e: unknown): string {
  const w = caminoWords();
  if (!(e instanceof ApiError)) return w.conn.unreachable;
  if (e.code === "CAMINO_KEY_REJECTED") return w.conn.rejected((e.detail.status as number | null) ?? null, String(e.detail.message ?? ""));
  if (e.code === "CAMINO_KEY_INVALID") return w.conn.invalid;
  if (e.code === "CAMINO_KEY_STORE") return w.conn.storeFailed;
  return w.conn.unreachable;
}

const CardView = ({ r, c, now }: { r: CaminoRead; c: Card; now: Date }) => {
  const w = caminoWords();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [tested, setTested] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = () => void client.invalidateQueries({ queryKey: caminoKey(r.slug) });
  const save = useMutation({
    mutationFn: () => api.caminoSaveKey(r.slug, c.id, value),
    onSuccess: () => {
      setOpen(false);
      setValue("");
      refresh();
    },
  });
  const test = useMutation({
    mutationFn: () => api.caminoTestKey(r.slug, c.id),
    onSuccess: (t) => {
      setTested({ ok: t.ok, text: t.ok ? `✓ ${w.conn.works}${t.account ? ` · ${t.account}` : ""}` : w.conn.rejected(t.status, t.message).replace(/ No se guardó\.| Not saved\./, "") });
      refresh();
    },
    onError: (e) => setTested({ ok: false, text: keyError(e) }),
  });
  const remove = useMutation({ mutationFn: () => api.caminoRemoveKey(r.slug, c.id), onSuccess: refresh });
  const meta = r.config.connections[c.id] ?? null;
  const g = r.discovery?.github.ok ? r.discovery.github : null;
  const info = catalog().find((s) => s.id === c.id);
  const name = serviceName(c.id);
  const on = c.saved || (c.id === "github" && !!g) || c.via === "detected" || c.via === "mac";
  const how = meta
    ? meta.store === "keychain"
      ? w.conn.keychain(meta.last4)
      : w.conn.file(meta.last4)
    : c.via === "session"
      ? w.conn.ghSession
      : c.via === "file"
        ? w.conn.ghFile
        : c.via === "env" && g
          ? w.conn.ghEnv(g.token.source)
          : c.via === "detected"
            ? w.conn.detectedHow
            : c.via === "mac"
              ? w.conn.macHow
              : null;
  const scopes = c.id === "github" ? (g?.token.scopes ?? meta?.test?.scopes ?? null) : null;
  const can = c.id === "github" ? (scopes ? (scopes.includes("repo") ? w.conn.allRepos(scopes.join(", ")) : scopes.join(", ") || w.conn.onlyProject) : w.conn.onlyProject) : c.id === "local_postgres" ? w.conn.localDbs(r.discovery?.mac.postgres?.databases.length ?? 0) : (meta?.test?.account ?? w.conn.onlyProject);
  const exp = meta?.expires_at ?? (c.id === "github" ? (g?.token.expires_at ?? null) : null);
  const lastUse = meta?.last_used_at ?? (c.id === "github" && g ? r.checked_at : null);
  const works = c.id === "github" ? w.conn.ghWorks : on ? (info?.does ?? []) : [];
  const more = c.id === "github" ? (g ? [g.repo.admin ? null : w.conn.ghNeedsAdmin].filter((x): x is string => !!x) : []) : !on && info?.badge === "native" ? [w.conn.providerMore] : [];
  const keyable = c.id === "github" || !!info?.keyed;
  const busy = save.isPending || test.isPending || remove.isPending;
  return (
    <div className="cam-card" data-conn={c.id} data-conectado={on ? "si" : "no"}>
      <div className="cam-card-h">
        <span className="cam-card-n">
          <b>{name}</b>
          <span className={cls("cam-bdg", c.badge)}>{w.conn.badge[c.badge]}</span>
          {info?.paid && <span className="cam-bdg paid">{w.conn.paid}</span>}
        </span>
        <span className={cls("cam-chip", on ? "ok" : "warn")}>{on ? w.conn.connected : w.conn.notConnected}</span>
      </div>
      {on && (
        <dl className="cam-kv">
          <dt>{w.conn.how}</dt>
          <dd>{how}</dd>
          <dt>{w.conn.can}</dt>
          <dd>{can}</dd>
          {keyable && (
            <>
              <dt>{w.conn.expires}</dt>
              <dd>{exp ? new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" }).format(new Date(exp)) : w.conn.neverExpires}</dd>
              <dt>{w.conn.lastUse}</dt>
              <dd>{agoText(lastUse, now) ?? "—"}</dd>
            </>
          )}
        </dl>
      )}
      {(works.length > 0 || more.length > 0) && (
        <ul className="cam-verbs">
          {works.map((t) => (
            <li key={t}>
              <span className="ok-t" aria-hidden>✓</span>
              {t}
            </li>
          ))}
          {more.map((t) => (
            <li key={t}>
              <span className="warn-t" aria-hidden>◐</span>
              {t}
            </li>
          ))}
        </ul>
      )}
      {info?.paid && <p className="cam-hint bad-t">{info.paid}</p>}
      {open && (
        <form
          className="cam-keyform"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) save.mutate();
          }}
        >
          <label className="cam-field">
            <span className="cam-lab">{info?.token ?? w.conn.paste}</span>
            <span className="cam-acts">
              <input className="cor-input cor-mono" type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder={w.conn.paste} autoComplete="off" spellCheck={false} data-campo={`llave-${c.id}`} />
              <Btn kind="primary" small type="submit" disabled={!value.trim() || save.isPending} data-control={`guardar-llave-${c.id}`}>
                {save.isPending ? w.conn.saving : w.conn.save}
              </Btn>
            </span>
          </label>
          {save.isError ? (
            <p className="cam-hint bad-t" role="alert" data-llave-error>
              {keyError(save.error)}
            </p>
          ) : (
            <p className="cam-hint">{w.conn.keyNote}</p>
          )}
        </form>
      )}
      {keyable && (
        <div className="cam-acts">
          {c.saved ? (
            <>
              <Btn kind="secondary" small disabled={busy} onClick={() => test.mutate()} data-control={`probar-${c.id}`}>
                {test.isPending ? w.conn.testing : w.conn.test}
              </Btn>
              <Btn kind="quiet" small disabled={busy} onClick={() => setOpen((x) => !x)} aria-expanded={open} data-control={`cambiar-${c.id}`}>
                {w.conn.change}
              </Btn>
              <Btn kind="quiet" small disabled={busy} onClick={() => remove.mutate()} data-control={`quitar-${c.id}`}>
                {w.conn.remove}
              </Btn>
            </>
          ) : (
            <Btn kind={on ? "quiet" : "primary"} small onClick={() => setOpen((x) => !x)} aria-expanded={open} data-control={`conectar-${c.id}`}>
              {on ? w.conn.change : w.conn.connect}
            </Btn>
          )}
          {tested && (
            <span className={cls("cam-hint", tested.ok ? "ok-t" : "bad-t")} role="status" data-prueba={tested.ok ? "ok" : "falla"}>
              {tested.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

const Conexiones = ({ r, now }: { r: CaminoRead; now: Date }) => {
  const w = caminoWords();
  const list = cards(r);
  const cat = catalog();
  const [adding, setAdding] = useState<string | null>(null);
  const extra = adding && !list.some((c) => c.id === adding) ? [{ id: adding as Card["id"], badge: "native" as const, saved: false, via: null }] : [];
  return (
    <Ed id="conn" title={w.sections.conn} lead={r.plania.keys_store === "file" ? w.conn.leadFile : w.conn.lead}>
      <div className="cam-cards">
        {[...list, ...extra].map((c) => (
          <CardView key={c.id} r={r} c={c} now={now} />
        ))}
      </div>
      <Blk cap={w.conn.addTitle} hint={w.conn.addHint}>
        {(["server", "db"] as const).map((kind) => (
          <div key={kind} className="cam-field">
            <span className="cam-lab">{kind === "server" ? w.conn.servers : w.conn.dbs}</span>
            <div className="cam-chips">
              {cat
                .filter((s) => s.kind === kind)
                .map((s) =>
                  s.keyed && !list.some((c) => c.id === s.id) ? (
                    <button key={s.id} type="button" className="cam-chip btn" onClick={() => setAdding(s.id)} aria-pressed={adding === s.id} data-catalogo={s.id}>
                      {s.name} <span className={cls("cam-bdg", s.badge)}>{w.conn.badge[s.badge]}</span>
                      {s.paid && <span className="cam-bdg paid">{w.conn.paid}</span>}
                    </button>
                  ) : (
                    <span key={s.id} className="cam-chip" data-catalogo={s.id}>
                      {s.name} <span className={cls("cam-bdg", s.badge)}>{w.conn.badge[s.badge]}</span>
                      {s.paid && <span className="cam-bdg paid">{w.conn.paid}</span>}
                    </span>
                  ),
                )}
            </div>
          </div>
        ))}
        <p className="cam-hint">{w.conn.manualNote}</p>
      </Blk>
    </Ed>
  );
};

// ---- Propuestas
const Propuestas = ({ r, links }: { r: CaminoRead; links: CaminoLinks }) => {
  const w = caminoWords();
  const groups = proposalGroups(r);
  return (
    <Ed id="propuestas" title={w.sections.propuestas} lead={w.prop.lead}>
      {groups.length === 0 && <p className="cam-hint">{w.prop.none}</p>}
      {groups.map((g) => (
        <Blk key={g.base ?? "-"} cap={g.base ? w.prop.into(g.base) : w.prop.noBase} hint={`${g.items.length}`} data-propuestas-hacia={g.base ?? ""}>
          <ul className="cam-list">
            {g.items.map((x) => (
              <li key={x.number} className="cam-pr" data-pr={x.number}>
                <Link to={links.prHref(x.number)} className="cam-pr-a">
                  <span className="cor-key">#{x.number}</span>
                  <span className="cor-ellipsis">{x.title}</span>
                </Link>
                <span className={cls("cam-chip", x.state === "open" ? "live" : "dim")}>{x.state === "open" ? w.prop.open : x.merged_at ? w.prop.merged : w.prop.closed}</span>
                {x.ci_state && <span className={cls("cam-hint", x.ci_state === "failure" ? "bad-t" : x.ci_state === "success" ? "ok-t" : "")}>{w.prop.ci[x.ci_state] ?? x.ci_state}</span>}
                {x.head_branch && <span className="cam-mono cam-hint">{x.head_branch}</span>}
              </li>
            ))}
          </ul>
        </Blk>
      ))}
    </Ed>
  );
};

// ---- Historial
const Historial = ({ r }: { r: CaminoRead }) => {
  const w = caminoWords();
  const fmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <Ed id="hist" title={w.sections.hist} lead={w.hist.lead}>
      {r.history.length === 0 ? (
        <p className="cam-hint">{w.hist.none}</p>
      ) : (
        <div className="cam-tw" tabIndex={0} role="region" aria-label={w.hist.table}>
          <table className="cam-tbl" data-historial={r.history.length}>
            <thead>
              <tr>
                <th scope="col">{w.hist.when}</th>
                <th scope="col">{w.hist.who}</th>
                <th scope="col">{w.hist.what}</th>
                <th scope="col">{w.hist.where}</th>
                <th scope="col">{w.hist.undo}</th>
              </tr>
            </thead>
            <tbody>
              {r.history.map((h, i) => (
                <tr key={`${h.at}-${i}`}>
                  <td>{fmt.format(new Date(h.at))}</td>
                  <td>{h.who === "owner" ? w.hist.whoOwner : h.who === "outside" ? w.hist.whoOutside : h.who}</td>
                  <td>{h.label}</td>
                  <td>{w.hist.dest[h.dest] ?? h.dest}</td>
                  <td>{h.undo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Ed>
  );
};

const Pronto = ({ s }: { s: Section }) => (
  <Ed id={s.id} title={s.name} lead={s.sub}>
    <p className="cam-hint">{caminoWords().soon}</p>
  </Ed>
);

// ---- the door
export const Camino = ({ p, sec, hrefOf, prHref, ajustesHref }: { p: Pick<OrgProject, "slug" | "title">; sec: string } & CaminoLinks) => {
  const w = caminoWords();
  const q = useCamino(p.slug);
  const client = useQueryClient();
  const recheck = useMutation({ mutationFn: () => api.caminoRecheck(p.slug), onSuccess: (d) => client.setQueryData(caminoKey(p.slug), d) });
  const links: CaminoLinks = { hrefOf, prHref, ajustesHref };
  const cambios = useCambios(p.slug);
  if (q.isError && !q.data) return <ReadError what={w.readError} onRetry={() => void q.refetch()} />;
  const r = q.data;
  if (!r) return <div className="cor-skel" style={{ height: 420 }} role="status" aria-busy="true" aria-label={w.reading} />;
  const now = new Date();
  const F = findings(r, now);
  const S = sections(r, F);
  const ready = readyLine(F);
  const all = [...S.main, ...S.envs, S.hist];
  const current = all.find((s) => s.id === sec) ?? S.main[0]!;
  const checking = recheck.isPending || r.checking;
  const ago = agoText(r.checked_at, now);
  const onRecheck = () => recheck.mutate();
  const body = (() => {
    switch (current.id) {
      case "resumen":
        return <Resumen r={r} F={F} links={links} onRecheck={onRecheck} busy={checking} />;
      case "conn":
        return <Conexiones r={r} now={now} />;
      case "propuestas":
        return <Propuestas r={r} links={links} />;
      case "hist":
        return <Historial r={r} />;
      case "codigo":
        return <Codigo r={r} cambios={cambios} />;
      case "commits":
        return <Commits r={r} cambios={cambios} />;
      case "ci":
        return <Pruebas r={r} cambios={cambios} />;
      default:
        return <Pronto s={current} />;
    }
  })();
  const navRow = (s: Section) => (
    <Link key={s.id} to={hrefOf(s.id)} className="cam-sec" aria-current={s.id === current.id ? "page" : undefined} data-sec={s.id}>
      <Dot sev={s.dot === "ok" ? "ok" : s.dot} />
      <b>{s.name}</b>
      <small>{s.sub}</small>
    </Link>
  );
  return (
    <div className="cor-camino" data-camino-de={r.slug}>
      <header className="cam-head">
        <div>
          <h2 className="cor-door-h">{w.title(r.title)}</h2>
          <p className="cor-text">{w.lead}</p>
        </div>
        <div className="cam-head-r">
          <div className="cam-ready" data-ready={ready.dot}>
            <Dot sev={ready.dot} />
            <b>{ready.text}</b>
            {ready.more && <span className="warn-t">{ready.more}</span>}
          </div>
          <div className="cam-checked" role="status">
            <span>{checking ? w.checking : ago ? w.checkedAgo(ago) : w.neverChecked}</span>
            <Btn kind="link" disabled={checking} onClick={onRecheck} data-control="camino-recheck">
              {w.recheck}
            </Btn>
          </div>
        </div>
      </header>
      <div className="cam-cfg">
        <nav className="cam-secs" aria-label={w.title(r.title)}>
          {S.main.map(navRow)}
          <div className="cam-sep" />
          <span className="cam-cap">{w.sections.envs}</span>
          {S.envs.map(navRow)}
          <div className="cam-sep" />
          {navRow(S.hist)}
        </nav>
        <div className="cam-main">{body}</div>
      </div>
      <CambiosBar r={r} cambios={cambios} />
    </div>
  );
};
