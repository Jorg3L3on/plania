// PLA-I39: the whole building for /ceo, from GET /api/company. Presentational: data and callbacks come in as
// props (test/edificio-ui.test.ts renders it with fake data).
//   sky        the moment in one sentence (companyLine) and Asistente's last summary
//   roof       Tu oficina (roof.tsx)
//   tower      one floor per running project, those that need the owner first
//   empty      no projects: an empty lot with the door "Abrir el primer piso"
import type { ReactNode } from "react";
import type { Decision, OrgCompany, OrgMember } from "@/lib/api";
import { floorOrder, hourIn } from "@/lib/edificio";
import { companyLine } from "@/lib/v2";
import { Floor } from "./floor";
import { Roof } from "./roof";
import { EdificioSkeleton, Scene } from "./scene";
import { BlockError } from "@/components/compania/parts";

const firstLine = (s: string, n = 160) => {
  const one = (s.split("\n").find((l) => l.trim()) ?? "").replace(/[*_#`]/g, "").trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};

export type BuildingProps = {
  company: OrgCompany;
  decisions: Decision[];
  now: number;
  timeZone?: string;
  hello: string;
  day: string;
  meta?: ReactNode;
  onNew: () => void;
  onOpen?: (project: string, m: OrgMember, el: HTMLElement) => void;
  onChip?: (d: Decision, onTeam: boolean) => void;
};

export const Building = ({ company, decisions, now, timeZone, hello, day, meta, onNew, onOpen, onChip }: BuildingProps) => {
  const { floors } = floorOrder(company.projects, decisions);
  const paused = company.company.paused;
  const summary = company.asistente.last_run?.summary ? firstLine(company.asistente.last_run.summary) : "";
  const empty = company.projects.length === 0;
  return (
    <Scene
      hour={hourIn(now, timeZone)}
      pre={`${hello}, Jorge · ${day}`}
      line={empty ? "Todavía no hay pisos." : `${companyLine(company.projects).replace(/^./, (c) => c.toUpperCase())}.`}
      meta={meta}
      by={
        summary ? (
          <>
            <span className="edi-face" aria-hidden>
              A
            </span>
            <span className="min-w-0" data-asistente-line>
              {summary}
            </span>
          </>
        ) : null
      }
    >
      {!empty && <Roof decisions={decisions} projects={company.projects} plumbing={company.plumbing} onChip={onChip} />}
      <div className="edi-tower" data-tower={floors.length}>
        {empty ? (
          <div className="edi-empty" data-empty="projects">
            <p>Un proyecto es un nombre y una meta. Llega con su equipo: PO, Research, Artist y Taller, cada uno en su ventana.</p>
            <button type="button" className="edi-door" onClick={onNew} data-control="primer-piso">
              ＋ Abrir el primer piso
            </button>
          </div>
        ) : (
          floors.map((p) => <Floor key={p.slug} project={p} now={now} companyPaused={paused} onOpen={onOpen ? (m, el) => onOpen(p.slug, m, el) : undefined} />)
        )}
      </div>
      <div className="edi-street" aria-hidden />
    </Scene>
  );
};

// Loading draws the outline (no jump when data lands); an error puts the existing error block where the tower goes.
export const BuildingBlock = ({ loading, error, onRetry, children }: { loading: boolean; error: boolean; onRetry: () => void; children: ReactNode }) =>
  loading ? (
    <EdificioSkeleton />
  ) : error ? (
    <div data-edificio-error>
      <BlockError what="la compañía" onRetry={onRetry} />
    </div>
  ) : (
    <>{children}</>
  );
