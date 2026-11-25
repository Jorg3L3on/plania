// PLA-I75 (Conexiones): a seat's fifth tab. Its cables (each with what it did in 7 days, what failed and what was
// blocked, from the runs' own logs), an agent's amber request, and «Conectar otra», which widens the sheet to the
// reviewed catalog: its role's first, then by kind, and one of the owner's own in expert mode. Reading is on when a
// cable is connected; each write tool is turned on by itself. Keys are names only.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, type OrgMember, type OrgProject } from "@/lib/api";
import { words } from "@/lib/i18n";
import { CONEXIONES_WORDS } from "@/lib/conexiones-words";
import { cableTone, catalogSections, isPaid, type Cable, type CatalogItem, type ConexionesRead } from "@/lib/conexiones";
import { conexionesApi } from "@/lib/conexiones-api";
import { Btn, Label, ReadError, State, Switch } from "./parts";

const W = () => words(CONEXIONES_WORDS);
const nameOf = (id: string) => W().entries[id]?.name ?? id;
const codeOf = (e: unknown) => (e instanceof ApiError ? e.code : "NETWORK");

const useConexiones = (slug: string, agent: string) => useQuery({ queryKey: ["conexiones", slug, agent], queryFn: () => conexionesApi.read(slug, agent), refetchInterval: 30_000 });

/** One write for the tab: the answer is the fresh read, put straight in the cache. */
function useChange(slug: string, agent: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (run: () => Promise<ConexionesRead>) => run(),
    onSuccess: (read) => client.setQueryData(["conexiones", slug, agent], read),
  });
}

// ---- the tab

export const ConexionesTab = ({ p, m, onCatalog }: { p: OrgProject; m: OrgMember; onCatalog: () => void }) => {
  const w = W();
  const q = useConexiones(p.slug, m.agent);
  const change = useChange(p.slug, m.agent);
  if (q.isError) return <ReadError what={w.readError} onRetry={() => void q.refetch()} />;
  const r = q.data;
  if (!r)
    return (
      <p className="cor-text cor-muted" role="status" aria-busy="true">
        {w.loading}
      </p>
    );
  return (
    <div className="cnx" data-conexiones>
      {r.requests.map((req) => (
        <section key={req.id} className="cor-card cnx-request" aria-label={w.requestHead(nameOf(req.server))} data-pedido={req.id}>
          <Label as="h3" tone="amber">
            {w.requestHead(nameOf(req.server))}
          </Label>
          <p className="cor-text">{req.reason}</p>
          <div className="cnx-row">
            <Btn kind="primary" small disabled={change.isPending} onClick={() => change.mutate(() => conexionesApi.decide(p.slug, m.agent, req.id, true))} data-control={`pedido-si-${req.server}`}>
              {w.accept}
            </Btn>
            <Btn kind="quiet" small disabled={change.isPending} onClick={() => change.mutate(() => conexionesApi.decide(p.slug, m.agent, req.id, false))} data-control={`pedido-no-${req.server}`}>
              {w.decline}
            </Btn>
          </div>
        </section>
      ))}
      {r.connections.length === 0 ? (
        <p className="cor-text cor-muted">{r.role === "qa" ? w.onlyPlaniaQa : w.onlyPlania}</p>
      ) : (
        r.connections.map((c) => <CableCard key={c.server} slug={p.slug} agent={m.agent} c={c} />)
      )}
      {r.blocked.length > 0 && (
        <section className="cnx-blocked" aria-label={w.blockedHead}>
          <Label as="h3">{w.blockedHead}</Label>
          <ul className="cnx-tools">
            {r.blocked.slice(0, 8).map((b) => (
              <li key={`${b.run}-${b.server}-${b.tool}`}>
                <span className="cor-mono">{w.blockedLine(`${nameOf(b.server)} · ${b.tool}`, b.n)}</span>
                <span className="cor-cap">{new Date(b.at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {change.isError && <p className="cor-cap"><span className="cor-state bad">{w.failedSave(codeOf(change.error))}</span></p>}
      <Btn kind="secondary" onClick={onCatalog} data-control="conectar-otra">
        {w.connectOther}
      </Btn>
    </div>
  );
};

const CableCard = ({ slug, agent, c }: { slug: string; agent: string; c: Cable }) => {
  const w = W();
  const change = useChange(slug, agent);
  const busy = change.isPending;
  const e = w.entries[c.server];
  return (
    <section className={`cor-card cnx-cable ${cableTone(c) ?? ""}`} aria-label={nameOf(c.server)} data-cable={c.server}>
      <div className="cnx-head">
        <b>{nameOf(c.server)}</b>
        <span className="cor-cap cor-mono">{c.custom ? `${c.custom.package}@${c.custom.version}` : w.version(c.version)}</span>
        {isPaid(c.price) && <State tone="amber">{c.price === "pago" ? w.paid : w.price[c.price!]}</State>}
        {c.custom && !c.reviewed && <State tone="amber">{w.unreviewed}</State>}
      </div>
      {e && <p className="cor-cap">{e.para}</p>}
      {c.problem && <p className="cor-cap cnx-warn">{w.problem[c.problem]}</p>}
      {c.change && (
        <div className="cnx-change" data-version-change>
          <p className="cor-cap cnx-warn">{w.change(c.change.from, c.change.to)}</p>
          <p className="cor-cap">
            {c.change.added.length || c.change.removed.length || c.change.nowWrites.length
              ? [c.change.added.length ? w.added(c.change.added.join(", ")) : "", c.change.removed.length ? w.removed(c.change.removed.join(", ")) : "", c.change.nowWrites.length ? w.nowWrites(c.change.nowWrites.join(", ")) : ""].filter(Boolean).join(" ")
              : w.noToolChange}
          </p>
          <Btn kind="secondary" small disabled={busy} onClick={() => change.mutate(() => conexionesApi.acceptVersion(slug, agent, c.server))} data-control={`aceptar-version-${c.server}`}>
            {w.acceptVersion}
          </Btn>
        </div>
      )}
      {c.custom && !c.reviewed && (
        <Btn kind="secondary" small disabled={busy} onClick={() => change.mutate(() => conexionesApi.review(slug, agent, c.server))} data-control={`revisar-${c.server}`}>
          {w.review}
        </Btn>
      )}
      <p className="cor-cap" data-uso>
        {w.usage(c.usage.calls, c.usage.runs)}
        {c.usage.failed > 0 && <> · {w.failed(c.usage.failed)}</>}
        {c.usage.blocked > 0 && <> · <span className="cnx-warn">{w.blocked(c.usage.blocked)}</span></>}
      </p>
      {c.usage.tools.length > 0 && (
        <details className="cnx-did">
          <summary className="cor-cap">{w.whatItDid}</summary>
          <ul className="cnx-tools">
            {c.usage.tools.slice(0, 12).map((t) => (
              <li key={t.tool}>
                <span className="cor-mono">{t.tool}</span>
                <span className="cor-cap cor-mono">
                  {t.ok}
                  {t.failed ? ` · ${w.failed(t.failed)}` : ""}
                  {t.blocked ? ` · ${w.blocked(t.blocked)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {c.keys.length > 0 && (
        <ul className="cnx-tools">
          {c.keys.map((k) => (
            <li key={k.env}>
              <span className="cor-mono">{k.name}</span>
              <span className={`cor-cap ${k.set ? "" : "cnx-warn"}`}>{k.set ? w.keySet : w.keyMissing}</span>
            </li>
          ))}
        </ul>
      )}
      {c.writes.length > 0 && (
        <div className="cnx-writes" role="group" aria-label={w.writeTools}>
          <Label as="p">{w.writeTools}</Label>
          {c.writes.map((t) => (
            <Switch key={t.tool} on={t.on} label={t.tool} disabled={busy} onChange={(on) => change.mutate(() => conexionesApi.setWrite(slug, agent, c.server, t.tool, on))} data-control={`escribe-${c.server}-${t.tool}`} />
          ))}
          <p className="cor-cap">{w.writeHint}</p>
        </div>
      )}
      {c.never.length > 0 && <p className="cor-cap">{w.never(c.never.join(", "))}</p>}
      {change.isError && <p className="cor-cap"><span className="cor-state bad">{w.failedSave(codeOf(change.error))}</span></p>}
      <Btn kind="quiet" small disabled={busy} onClick={() => change.mutate(() => conexionesApi.disconnect(slug, agent, c.server))} data-control={`desconectar-${c.server}`}>
        {w.disconnect}
      </Btn>
    </section>
  );
};

// ---- the catalog, wide

export const CatalogPanel = ({ p, m, seat, onClose }: { p: OrgProject; m: OrgMember; seat: string; onClose: () => void }) => {
  const w = W();
  const q = useConexiones(p.slug, m.agent);
  const r = q.data;
  return (
    <section className="cor-card ofi-side-card cnx-catalog" aria-label={w.catalogTitle} data-catalogo>
      <div className="ofi-side-head">
        <Label as="h3">{`${w.catalogTitle} · ${seat}`}</Label>
        <Btn kind="quiet" small onClick={onClose} data-control="volver-conexiones">
          {w.back}
        </Btn>
      </div>
      <p className="cor-cap">{w.catalogHint}</p>
      {q.isError ? (
        <ReadError what={w.readError} onRetry={() => void q.refetch()} />
      ) : !r ? (
        <p className="cor-text cor-muted" role="status" aria-busy="true">
          {w.loading}
        </p>
      ) : (
        <>
          {catalogSections(r.catalog).map((s) => (
            <div key={s.id} className="cnx-section" data-section={s.id}>
              <Label as="h3" tone={s.id === "recomendadas" ? "violet" : undefined}>
                {w.groups[s.id]}
              </Label>
              <div className="cnx-grid">
                {s.items.map((it) => (
                  <CatalogCard key={it.id} slug={p.slug} agent={m.agent} it={it} llaves={r.llaves} />
                ))}
              </div>
            </div>
          ))}
          <ExpertForm slug={p.slug} agent={m.agent} />
        </>
      )}
    </section>
  );
};

const CatalogCard = ({ slug, agent, it, llaves }: { slug: string; agent: string; it: CatalogItem; llaves: string[] }) => {
  const w = W();
  const e = w.entries[it.id];
  const change = useChange(slug, agent);
  const [keys, setKeys] = useState<Record<string, string>>(() => Object.fromEntries(it.keys.map((k) => [k.env, k.name])));
  const listId = `cnx-llaves-${it.id}`;
  return (
    <article className={`cnx-entry ${it.unattended ? "" : "off"}`} data-entrada={it.id}>
      <div className="cnx-head">
        <b>{e?.name ?? it.id}</b>
        <span className="cor-cap cor-mono">{w.version(it.version)}</span>
      </div>
      {e && <p className="cor-cap">{e.para}</p>}
      <p className="cor-cap">
        {isPaid(it.price) ? <span className="cnx-warn">{w.price[it.price]}</span> : w.price[it.price]} · {w.reads(it.reads)} · {w.writesOff(it.writes.length)}
      </p>
      {e && <p className="cor-cap cor-muted">{e.ojo}</p>}
      {it.needs && <p className="cor-cap">{w.needs[it.needs]}</p>}
      {!it.unattended ? (
        <p className="cor-cap cnx-warn">{w.needsLogin}</p>
      ) : (
        <>
          {it.keys.map((k) => (
            <label key={k.env} className="ofi-field">
              <Label>{k.optional ? w.keyOptional : w.key}</Label>
              <input className="cor-input cor-mono" list={listId} maxLength={80} value={keys[k.env] ?? ""} onChange={(ev) => setKeys({ ...keys, [k.env]: ev.target.value.toUpperCase() })} data-control={`llave-${it.id}-${k.env}`} />
            </label>
          ))}
          {it.keys.length > 0 && (
            <>
              <datalist id={listId}>
                {llaves.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <p className="cor-cap cor-muted">{w.keyHint}</p>
            </>
          )}
          {change.isError && <p className="cor-cap"><span className="cor-state bad">{w.failedSave(codeOf(change.error))}</span></p>}
          <Btn kind="primary" small disabled={change.isPending} onClick={() => change.mutate(() => conexionesApi.connect(slug, agent, it.id, it.keys.length ? keys : undefined))} data-control={`conectar-${it.id}`}>
            {change.isPending ? w.connecting : w.connect}
          </Btn>
        </>
      )}
    </article>
  );
};

const ExpertForm = ({ slug, agent }: { slug: string; agent: string }) => {
  const w = W();
  const change = useChange(slug, agent);
  const [d, setD] = useState({ server: "", package: "", version: "", args: "" });
  const ready = d.server.trim() && d.package.trim() && d.version.trim();
  return (
    <details className="cnx-expert">
      <summary className="cor-cap">{w.expert}</summary>
      <p className="cor-cap cor-muted">{w.expertHint}</p>
      {(["server", "package", "version", "args"] as const).map((f) => (
        <label key={f} className="ofi-field">
          <Label>{f === "server" ? w.expertName : f === "package" ? w.expertPackage : f === "version" ? w.expertVersion : w.expertArgs}</Label>
          <input className="cor-input cor-mono" maxLength={120} value={d[f]} onChange={(ev) => setD({ ...d, [f]: f === "server" ? ev.target.value.toLowerCase() : ev.target.value })} data-control={`propia-${f}`} />
        </label>
      ))}
      {change.isError && <p className="cor-cap"><span className="cor-state bad">{w.failedSave(codeOf(change.error))}</span></p>}
      <Btn
        kind="secondary"
        small
        disabled={!ready || change.isPending}
        onClick={() =>
          change.mutate(() => conexionesApi.addCustom(slug, agent, { server: d.server.trim(), package: d.package.trim(), version: d.version.trim(), args: d.args.split(/\s+/).filter(Boolean) }), {
            onSuccess: () => setD({ server: "", package: "", version: "", args: "" }),
          })
        }
        data-control="propia-agregar"
      >
        {w.expertAdd}
      </Btn>
    </details>
  );
};
