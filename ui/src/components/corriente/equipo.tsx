// PLA-I62-6 / PLA-I71-1: a project's team. Equipo is about the agents, not their tasks (PLA-IDEA34): the org chart
// of the project (components/corriente/organigrama.tsx) with one status dot per seat, and beside it the selected
// seat's card. What a seat works on, its queue, its last delivery and the levers on that work (Detener, Reanudar
// corrida, Dile algo, Que empiece ya) live on the work pages: the step's page and the Motores queue.
// PLA-I71-3: Sumar is its own page (components/corriente/sumar.tsx); a PO's proposal shows on the chart as an amber
// dashed card.
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { ApiError, api, type OrgMember, type OrgProject, type SeatProposalView } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import { SUMAR_PAGE_WORDS } from "@/lib/sumar-page-words";
import { words } from "@/lib/i18n";
import { EQUIPO_WORDS } from "@/lib/equipo-words";
import { ORGANIGRAMA_WORDS } from "@/lib/organigrama-words";
import { Btn, Label, useOnce } from "./parts";
import { ROLE_LINE } from "./equipo-roles";
import { Legend, Organigrama } from "./organigrama";
import { SumarPage } from "./sumar";
import { AgentePanel, bossOf, type FichaTab } from "./agente";

export { ROLE_LINE };

/** «Reporta a» (PLA-I71-1); the panel owns it now. */
export const bossName = bossOf;
export const reportsOf = (m: OrgMember, team: OrgMember[]) => team.filter((x) => x.reports_to === m.agent);

/** PLA-I71-3: a PO's open proposal drawn on the chart under the PO, as an amber dashed card. */
export const PROPOSAL = "propuesta:";
export function proposalSeats(team: OrgMember[], proposals: SeatProposalView[]): OrgMember[] {
  const po = team.find((m) => m.template === "product-owner")?.agent ?? null;
  return proposals.map((pr) => ({ agent: `${PROPOSAL}${pr.id}`, role: pr.role, template: pr.role, state: "idle", now: null, last: null, produced: null, waiting: null, reports_to: po, name: pr.title }));
}

const ProposalSide = ({ p, pr, back }: { p: OrgProject; pr: SeatProposalView; back: string }) => {
  const w = words(SUMAR_PAGE_WORDS);
  const client = useQueryClient();
  const navigate = useNavigate();
  const onceDecide = useOnce({ sticky: true, key: pr.id });
  const decide = useMutation({
    mutationFn: (accept: boolean) => api.decideProposal(p.slug, pr.id, accept),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["equipo", p.slug] });
      void client.invalidateQueries({ queryKey: ["company"] });
      navigate(back, { replace: true });
    },
  });
  const title = seatName(pr.role) === pr.role ? pr.title : seatName(pr.role);
  return (
    <aside className="cor-card eq-side eq-side-prop" aria-label={w.proposes(title)} data-proposal={pr.id}>
      <Label as="h3" tone="amber">
        {w.proposalLine}
      </Label>
      <b className="eq-side-name">{w.proposes(title)}</b>
      <p className="cor-text">{w.quoted(pr.reason)}</p>
      <p className="cor-cap">
        {w.proposalNote} {w.arrivesPaused}
      </p>
      <div className="eq-side-foot">
        <Btn kind="primary" disabled={decide.isPending || p.team.length >= 8} onClick={() => onceDecide(() => decide.mutateAsync(true))} data-control="propuesta-si">
          {w.yes(title)}
        </Btn>
        <Btn kind="secondary" disabled={decide.isPending} onClick={() => onceDecide(() => decide.mutateAsync(false))} data-control="propuesta-no">
          {w.notNow}
        </Btn>
      </div>
      {decide.isError && <p className="cor-state bad">{w.failed(decide.error instanceof ApiError ? decide.error.code : "NETWORK")}</p>}
      {p.team.length >= 8 && <p className="cor-cap">{w.full}</p>}
    </aside>
  );
};

export type EquipoLinks = { member: (agent: string) => string; equipo: string; motor: string; sumar: string; tab: (agent: string, t: FichaTab) => string; work: string; store?: string; teams?: string };

export const EquipoNav = ({ links, at }: { links: { equipo: string; motor: string; store?: string; teams?: string }; at: "chart" | "motores" | "store" | "teams" }) => {
  const w = words(ORGANIGRAMA_WORDS);
  // PLA-138: when the places scroll sideways (a phone), the current one is brought into view.
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = nav.current;
    const cur = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && cur && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, cur.offsetLeft - (el.clientWidth - cur.offsetWidth) / 2);
  }, [at]);
  return (
    <nav ref={nav} className="eq-places" aria-label={w.places}>
      <Link to={links.equipo} aria-current={at === "chart" ? "page" : undefined} data-control="lugar-organigrama">
        {w.chart}
      </Link>
      {links.store && (
        <Link to={links.store} aria-current={at === "store" ? "page" : undefined} data-control="lugar-habilidades">
          {w.store}
        </Link>
      )}
      {links.teams && (
        <Link to={links.teams} aria-current={at === "teams" ? "page" : undefined} data-control="lugar-equipos">
          {w.teams}
        </Link>
      )}
      <Link to={links.motor} aria-current={at === "motores" ? "page" : undefined} data-control="lugar-motores">
        {w.motors}
      </Link>
    </nav>
  );
};

export const Equipo = ({ p, companyPaused, focus, tab = "perfil", openSkill = null, links }: { p: OrgProject; companyPaused: boolean; focus: string | null; tab?: FichaTab; openSkill?: string | null; links: EquipoLinks; motorDefault?: { model: string | null; effort: string | null } }) => {
  const paused = companyPaused || p.paused;
  const navigate = useNavigate();
  const w = words(ORGANIGRAMA_WORDS);
  const we = words(EQUIPO_WORDS);
  const eq = useQuery({ queryKey: ["equipo", p.slug], queryFn: () => api.equipo(p.slug), staleTime: 15_000 });
  const proposals = eq.data?.proposals ?? [];
  const chartTeam = [...p.team, ...proposalSeats(p.team, proposals)];
  const proposal = focus?.startsWith(PROPOSAL) ? (proposals.find((x) => `${PROPOSAL}${x.id}` === focus) ?? null) : null;
  const selected = focus && focus !== "sumar" ? (p.team.find((m) => m.agent === focus) ?? null) : null;
  // PLA-I71-3: Sumar is its own page inside Equipo (board Sumar).
  if (focus === "sumar") return <SumarPage p={p} back={links.equipo} />;
  return (
    <div className={`eq ${selected ? "has-panel" : ""}`} data-equipo={p.team.length}>
      <div className="eq-main">
        <div className="eq-head">
          <EquipoNav links={links} at="chart" />
          {p.team.length < 8 && (
            <Link className="cor-btn primary" to={links.sumar} data-control="sumar">
              {we.addSomeone}
            </Link>
          )}
        </div>
        <h2 className="eq-title">
          {w.headline(p.team.length, p.title)} <Legend />
        </h2>
        {p.team.length === 0 ? (
          <div className="cor-card cor-empty" data-nadie>
            <p className="cor-text">
              <b>{w.emptyTitle}</b> {w.emptyLine}
            </p>
          </div>
        ) : (
          <Organigrama team={chartTeam} project={p.title} paused={paused} selected={selected?.agent ?? (proposal ? focus : null)} onPick={(agent) => navigate(agent === selected?.agent ? links.equipo : links.member(agent), { replace: true })} />
        )}
      </div>
      {proposal ? (
        <ProposalSide p={p} pr={proposal} back={links.equipo} />
      ) : selected ? (
        <AgentePanel
          key={selected.agent}
          p={p}
          m={selected}
          paused={paused}
          tab={tab}
          openSkill={openSkill}
          motorLink={links.motor}
          links={{ equipo: links.equipo, tab: (t) => links.tab(selected.agent, t), work: links.work, store: links.store }}
          onTab={(t) => navigate(links.tab(selected.agent, t), { replace: true })}
        />
      ) : (
        <aside className="cor-card eq-side eq-side-empty" aria-label={w.pickOne}>
          <Label as="h3">{w.pickOne}</Label>
          <p className="cor-text">{w.pickLine}</p>
        </aside>
      )}
    </div>
  );
};
