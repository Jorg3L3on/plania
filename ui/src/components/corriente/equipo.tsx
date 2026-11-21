// PLA-I62-6 / PLA-I71-1: a project's team. Equipo is about the agents, not their tasks (PLA-IDEA34): the org chart
// of the project (components/corriente/organigrama.tsx) with one status dot per seat, and beside it the selected
// seat's card. What a seat works on, its queue, its last delivery and the levers on that work (Detener, Reanudar
// corrida, Dile algo, Que empiece ya) live on the work pages: the step's page and the Motores queue.
// Sumar: role, packs and motor, the building's form (GET /company/projects/:slug for the free roles, GET
// /company/packs, POST …/team).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { ApiError, api, type MotorPatch, type OrgMember, type OrgProject } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import { MODELS, motorLine, type ModelId } from "@/lib/motores";
import { firstFree, hireLabel, roleChoices, suggestedPacks } from "@/lib/sumar";
import { words } from "@/lib/i18n";
import { EQUIPO_WORDS } from "@/lib/equipo-words";
import { ORGANIGRAMA_WORDS } from "@/lib/organigrama-words";
import { Btn, Label } from "./parts";
import { ROLE_LINE } from "./equipo-roles";
import { Legend, Organigrama } from "./organigrama";
import { AgentePanel, bossOf, type FichaTab } from "./agente";

export { ROLE_LINE };

const Sumar = ({ p, motorDefault, focus }: { p: OrgProject; motorDefault?: { model: string | null; effort: string | null }; focus: boolean }) => {
  const w = words(EQUIPO_WORDS);
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ["company-project", p.slug], queryFn: () => api.companyProject(p.slug) });
  const packs = useQuery({ queryKey: ["company-packs"], queryFn: () => api.packs() });
  const choices = roleChoices(detail.data?.hire ?? []);
  const free = [...choices.main, ...choices.otros].filter((c) => c.state === "free");
  const [picked, setPicked] = useState<string | null>(null);
  const role = picked && free.some((c) => c.slug === picked) ? picked : firstFree(choices);
  const [chosen, setChosen] = useState<{ role: string | null; packs: string[] } | null>(null);
  const pk = chosen && chosen.role === role ? chosen.packs : suggestedPacks(role, packs.data?.packs ?? []);
  const [model, setModel] = useState<ModelId | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: (v: { template: string; packs: string[]; motor?: MotorPatch }) => api.addToTeam(p.slug, v.template, v.packs, v.motor),
    onSuccess: (_r, v) => {
      setAdded(hireLabel(v.template));
      void client.invalidateQueries({ queryKey: ["company"] });
      void client.invalidateQueries({ queryKey: ["company-project", p.slug] });
    },
  });
  if (p.team.length >= 8) return null;
  return (
    <aside className={`cor-card cor-sumar ${focus ? "focus" : ""}`} aria-label={w.addSomeone} data-sumar>
      <Label>{w.addSomeone}</Label>
      {detail.isPending ? (
        // PLA-82 (F-5): an empty grey box for ~2 s read as broken; it says what it is doing.
        <p className="cor-text cor-muted" style={{ minHeight: 160 }} role="status" aria-busy="true" data-sumar-loading>
          {w.lookingSeats}
        </p>
      ) : free.length === 0 ? (
        <p className="cor-text">{w.allSeatsTaken}</p>
      ) : (
        <>
          <h3 className="cor-h3">{role ? w.emptySeat(hireLabel(role)) : w.pickSeat}</h3>
          {role && ROLE_LINE[role] && <p className="cor-text">{ROLE_LINE[role]}.</p>}
          <label className="cor-label" htmlFor="sumar-rol">
            {w.seatTemplate}
          </label>
          <select id="sumar-rol" className="cor-select" value={role ?? ""} onChange={(e) => setPicked(e.target.value)} data-control="sumar-plantilla">
            {free.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
          <details className="cor-sumar-more">
            <summary className="cor-btn link">{w.packs(pk.length)}</summary>
            {packs.isError ? (
              <p className="cor-cap">{w.packsFailed}</p>
            ) : (
              <ul>
                {(packs.data?.packs ?? []).map((x) => (
                  <li key={x.slug}>
                    <label className="cor-check" data-inline-ok>
                      <input type="checkbox" checked={pk.includes(x.slug)} onChange={() => setChosen({ role, packs: pk.includes(x.slug) ? pk.filter((s) => s !== x.slug) : [...pk, x.slug] })} data-pack={x.slug} />
                      <span>{x.name}</span>
                    </label>
                  </li>
                ))}
                {(packs.data?.packs ?? []).length === 0 && <li className="cor-cap">{w.noPacks}</li>}
              </ul>
            )}
          </details>
          <label className="cor-label" htmlFor="sumar-motor">
            {w.motor}
          </label>
          <select id="sumar-motor" className="cor-select" value={model ?? ""} onChange={(e) => setModel((e.target.value || null) as ModelId | null)} data-control="sumar-modelo">
            <option value="">{w.companyMotor(motorLine(motorDefault?.model ?? null, motorDefault?.effort ?? null))}</option>
            {MODELS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <Btn kind="secondary" disabled={!role || add.isPending} onClick={() => role && add.mutate({ template: role, packs: pk, motor: model ? { model } : undefined })} data-control="sumar-rol">
            {add.isPending ? w.adding : w.addToTeam}
          </Btn>
          {add.isError && <p className="cor-state bad">{add.error instanceof ApiError ? w.addFailed(add.error.code) : w.notNow}</p>}
          {added && (
            <p className="cor-state ok" role="status">
              ✓ {w.joins(added)}
            </p>
          )}
          <p className="cor-cap">{w.sumarHint}</p>
        </>
      )}
    </aside>
  );
};

/** «Reporta a» (PLA-I71-1); the panel owns it now. */
export const bossName = bossOf;
export const reportsOf = (m: OrgMember, team: OrgMember[]) => team.filter((x) => x.reports_to === m.agent);

export type EquipoLinks = { member: (agent: string) => string; equipo: string; motor: string; sumar: string; tab: (agent: string, t: FichaTab) => string; work: string; store?: string };

export const EquipoNav = ({ links, at }: { links: { equipo: string; motor: string }; at: "chart" | "motores" }) => {
  const w = words(ORGANIGRAMA_WORDS);
  return (
    <nav className="eq-places" aria-label={w.places}>
      <Link to={links.equipo} aria-current={at === "chart" ? "page" : undefined} data-control="lugar-organigrama">
        {w.chart}
      </Link>
      <Link to={links.motor} aria-current={at === "motores" ? "page" : undefined} data-control="lugar-motores">
        {w.motors}
      </Link>
    </nav>
  );
};

export const Equipo = ({ p, companyPaused, focus, tab = "perfil", links, motorDefault }: { p: OrgProject; companyPaused: boolean; focus: string | null; tab?: FichaTab; links: EquipoLinks; motorDefault?: { model: string | null; effort: string | null } }) => {
  const paused = companyPaused || p.paused;
  const navigate = useNavigate();
  const w = words(ORGANIGRAMA_WORDS);
  const we = words(EQUIPO_WORDS);
  const selected = focus && focus !== "sumar" ? (p.team.find((m) => m.agent === focus) ?? null) : null;
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
          <Organigrama team={p.team} project={p.title} paused={paused} selected={selected?.agent ?? null} onPick={(agent) => navigate(agent === selected?.agent ? links.equipo : links.member(agent), { replace: true })} />
        )}
      </div>
      {focus === "sumar" ? (
        <Sumar p={p} motorDefault={motorDefault} focus />
      ) : selected ? (
        <AgentePanel
          key={selected.agent}
          p={p}
          m={selected}
          paused={paused}
          tab={tab}
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
