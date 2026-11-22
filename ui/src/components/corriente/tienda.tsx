// PLA-I71-4: the skill store, a second place inside Equipo (PLA-IDEA34 board Habilidades). Every skill a seat of this
// project could carry: filters (all, factory, yours, brought, carried by nobody) with counts, a search, a card per
// skill (what it does, origin and version, who carries it, how often it was used of the runs that carried it). The
// selected one shows its text, a switch per seat, «Hacer mi copia» for a factory skill and «Probarla» (its card in
// the seat's panel, where trials live). «Nueva habilidad» creates one. GET …/tienda; writes reuse the seat routes.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, type OrgProject } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import { words } from "@/lib/i18n";
import { skillWords } from "@/lib/oficio";
import { ownerText } from "@/lib/owner-text";
import { FILTERS, filterCounts, matches, searchOf, seatListAfter, usageLine, type Filter, type Tienda, type TiendaSkill } from "@/lib/tienda";
import { TIENDA_WORDS } from "@/lib/tienda-words";
import { Btn, Label, ReadError, Switch, useOnce } from "./parts";
import { NewSkillPanel } from "./oficio-skill";

export type TiendaLinks = { pick: (slug: string | null) => string; tryIn: (agent: string, slug: string) => string; traer: string };
const tiendaKey = (slug: string) => ["tienda", slug];

const Side = ({ p, s, store, links }: { p: OrgProject; s: TiendaSkill; store: Tienda; links: TiendaLinks }) => {
  const w = words(TIENDA_WORDS);
  const client = useQueryClient();
  const seat = s.carriers.find((c) => c.on)?.agent ?? store.seats[0]?.agent ?? null;
  const card = useQuery({ queryKey: ["skill", p.slug, seat, s.slug], queryFn: () => api.skillCard(p.slug, seat!, s.slug), enabled: !!seat });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: tiendaKey(p.slug) });
    void client.invalidateQueries({ queryKey: ["oficio", p.slug] });
    void client.invalidateQueries({ queryKey: ["company"] });
  };
  const onceFlip = useOnce();
  const flip = useMutation({
    mutationFn: async ({ agent, on }: { agent: string; on: boolean }): Promise<unknown> => (s.origin === "factory" ? api.setSeatPacks(p.slug, agent, seatListAfter(store.skills, agent, s.slug, on)) : api.setSkillOn(p.slug, agent, s.slug, on)),
    onSuccess: refresh,
  });
  const onceCopy = useOnce();
  const navigate = useNavigate();
  // PLA-140: the copy is one seat's skill; the owner picks the seat (it was the first carrier, else the first seat, said
  // nowhere) and the store then opens the copy.
  const [copyFor, setCopyFor] = useState<string | null>(null);
  const copy = useMutation({
    mutationFn: (agent: string) => api.duplicateSkill(p.slug, agent, s.slug),
    onSuccess: (c) => {
      refresh();
      setCopyFor(null);
      navigate(links.pick(c.slug));
    },
  });
  const sw = skillWords(s);
  const wide = s.scope && s.scope !== "agent";
  return (
    <aside className="cor-card eq-side tda-side" aria-label={sw.name} data-tienda-skill={s.slug}>
      <span className="agt-post-head">
        <Label>{s.origin === "factory" ? w.sideFactory : s.origin === "brought" ? w.sideBrought : w.sideYours}</Label>
        <span className="org-tag ok">{w.textOnly}</span>
      </span>
      <b className="eq-side-name">{sw.name}</b>
      <p className="cor-text">{w.whenUsed(sw.line)}</p>
      <pre className="agt-pre tda-text" tabIndex={0}>
        {card.data ? ownerText(card.data.body) : "…"}
      </pre>
      {s.upstream && seat && (
        <Link className="cor-state warn tda-upstream" to={links.tryIn(seat, s.slug)} data-control="ver-version-nueva">
          {w.newVersionSee}
        </Link>
      )}
      <Label as="p">{w.whoCarries(p.title)}</Label>
      {wide && <p className="cor-cap">{w.scopeNote(s.scope!)}</p>}
      <ul className="tda-seats">
        {s.carriers.map((c) => {
          const role = store.seats.find((x) => x.agent === c.agent)?.role ?? c.agent;
          const m = p.team.find((x) => x.agent === c.agent);
          return (
            <li key={c.agent}>
              <Switch on={c.on} label={m?.puesto ?? seatName(role)} disabled={flip.isPending} onChange={(on) => onceFlip(() => flip.mutateAsync({ agent: c.agent, on }))} data-control={`lleva-${c.agent}`} />
            </li>
          );
        })}
      </ul>
      <p className="cor-cap" role="status">
        {flip.isPending || copy.isPending ? w.saving : flip.error || copy.error ? <span className="cor-state bad">{w.failed(((flip.error ?? copy.error) as ApiError)?.code ?? "NETWORK")}</span> : copy.isSuccess ? w.copied : flip.isSuccess ? w.saved : ""}
      </p>
      <div className="eq-side-foot">
        {s.origin === "factory" && seat && copyFor === null && (
          <Btn kind="secondary" onClick={() => setCopyFor(seat)} data-control="hacer-copia">
            {w.copy}
          </Btn>
        )}
        {s.origin === "factory" && copyFor !== null && (
          <span className="tda-copy" role="group" aria-label={w.copyFor}>
            <label className="cor-cap" htmlFor={`tda-copy-${s.slug}`}>
              {w.copyFor}
            </label>
            <select id={`tda-copy-${s.slug}`} className="cor-input" value={copyFor} onChange={(e) => setCopyFor(e.target.value)} data-control="copia-para">
              {store.seats.map((x) => (
                <option key={x.agent} value={x.agent}>
                  {p.team.find((m) => m.agent === x.agent)?.puesto ?? seatName(x.role)}
                </option>
              ))}
            </select>
            <Btn kind="primary" disabled={copy.isPending} onClick={() => onceCopy(() => copy.mutateAsync(copyFor))} data-control="hacer-copia-si">
              {w.copyGo}
            </Btn>
            <Btn kind="quiet" onClick={() => setCopyFor(null)} data-control="hacer-copia-no">
              {w.copyCancel}
            </Btn>
          </span>
        )}
        {seat && (
          <Link className="cor-btn secondary" to={links.tryIn(seat, s.slug)} data-control="probarla">
            {w.tryIt}
          </Link>
        )}
      </div>
    </aside>
  );
};

export const TiendaPage = ({ p, selected, links, nav }: { p: OrgProject; selected: string | null; links: TiendaLinks; nav: React.ReactNode }) => {
  const w = words(TIENDA_WORDS);
  const q = useQuery({ queryKey: tiendaKey(p.slug), queryFn: () => api.tienda(p.slug), staleTime: 15_000 });
  const [filter, setFilter] = useState<Filter>("todas");
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const all = q.data?.skills ?? [];
  const counts = useMemo(() => filterCounts(all), [all]);
  const shown = searchOf(all.filter((s) => matches(s, filter)), text);
  const chosen = all.find((s) => s.slug === selected) ?? null;
  const po = p.team.find((m) => m.template === "product-owner")?.agent ?? p.team[0]?.agent ?? null;
  const oficio = useQuery({ queryKey: ["oficio", p.slug, po], queryFn: () => api.oficio(p.slug, po!), enabled: creating && !!po });
  return (
    <div className="tda" data-tienda={all.length}>
      <h2 className="sr-only">{w.inCompany}</h2>
      <div className="eq-head">
        {nav}
        <span className="tda-tools">
          <input className="cor-input tda-search" type="search" placeholder={w.search} aria-label={w.searchLabel} value={text} onChange={(e) => setText(e.target.value)} data-control="buscar-habilidad" />
          <Link className="cor-btn secondary" to={links.traer} data-control="tienda-traer">
            {w.bring}
          </Link>
          <Btn kind="primary" onClick={() => setCreating(true)} disabled={!po} data-control="tienda-nueva">
            {w.newSkill}
          </Btn>
        </span>
      </div>
      {q.isError ? (
        <ReadError what={w.readError} onRetry={() => void q.refetch()} />
      ) : (
        <div className="tda-body">
          <nav className="tda-filters" aria-label={w.inCompany}>
            <Label as="p">{w.inCompany}</Label>
            <ul>
              {FILTERS.map((f) => (
                <li key={f}>
                  <button type="button" className="tda-filter" aria-pressed={filter === f} onClick={() => setFilter(f)} data-control={`filtro-${f}`}>
                    <span>{w.filters[f]}</span>
                    <span className="cor-cap">{counts[f]}</span>
                  </button>
                </li>
              ))}
            </ul>
            {/* PLA-I71-5: the open catalog: skills.sh and any repository or link, reviewed before install. */}
            <Label as="p">{w.openCatalog}</Label>
            <ul>
              <li>
                <Link className="tda-filter" to={links.traer} data-control="catalogo-skills-sh">
                  skills.sh
                </Link>
              </li>
              <li>
                <Link className="tda-filter" to={links.traer} data-control="catalogo-enlace">
                  {w.aRepo}
                </Link>
              </li>
            </ul>
            <p className="cor-cap">{w.outsideNote}</p>
          </nav>
          <div className="tda-grid-box">
            {!q.data ? (
              <p className="cor-text cor-muted" role="status" aria-busy="true">
                {w.loading}
              </p>
            ) : shown.length === 0 ? (
              <p className="cor-text cor-muted">{w.empty}</p>
            ) : (
              <ul className="tda-grid" aria-label={w.filters[filter]}>
                {shown.map((s) => {
                  const sw = skillWords(s);
                  return (
                    <li key={s.slug}>
                      <Link to={links.pick(s.slug === selected ? null : s.slug)} replace className={`tda-card ${s.slug === selected ? "sel" : ""}`} aria-current={s.slug === selected ? "true" : undefined} data-skill={s.slug}>
                        <span className="sum-card-top">
                          <b className="tda-name">{sw.name}</b>
                          <span className={`org-tag ${s.origin === "brought" ? "ok" : s.origin === "yours" ? "vi" : ""}`}>
                            {w.origin[s.origin]}
                            {s.origin !== "factory" && s.version.includes("@") ? ` · ${s.version.split("@")[1]!.slice(0, 7)}` : ""}
                          </span>
                        </span>
                        <span className="sum-card-line tda-line">{sw.line}</span>
                        <span className="tda-foot">
                          <span className="tda-who">
                            {s.carriers.map((c) => (
                              <span key={c.agent} className={`tda-seat ${c.on ? "on" : ""}`} title={seatName(q.data!.seats.find((x) => x.agent === c.agent)?.role ?? c.agent)}>
                                {seatName(q.data!.seats.find((x) => x.agent === c.agent)?.role ?? c.agent).slice(0, 2)}
                              </span>
                            ))}
                          </span>
                          {s.upstream ? <span className="org-tag am">{w.newVersion}</span> : <span className="cor-cap">{usageLine(s)}</span>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {creating && oficio.data ? (
            <aside className="cor-card eq-side tda-side" aria-label={w.newSkill}>
              <NewSkillPanel o={oficio.data} seat={seatName(oficio.data.role)} onClose={() => setCreating(false)} onOpen={() => setCreating(false)} />
            </aside>
          ) : chosen && q.data ? (
            <Side key={chosen.slug} p={p} s={chosen} store={q.data} links={links} />
          ) : (
            <aside className="cor-card eq-side eq-side-empty" aria-label={w.pick}>
              <p className="cor-text">{w.pick}</p>
            </aside>
          )}
        </div>
      )}
    </div>
  );
};
