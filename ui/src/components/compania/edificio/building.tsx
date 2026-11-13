// PLA-I39: the whole building for /ceo, from GET /api/company. Presentational: data and callbacks come in as
// props (test/edificio-ui.test.ts renders it with fake data).
//   sky        the moment in one sentence (companyLine) and Asistente's last summary
//   roof       Tu oficina (roof.tsx)
//   tower      one floor per running project, those that need the owner first
//   empty      no projects: an empty lot with the door "Abrir el primer piso"
// PLA-I39-4: each floor's plate (plate.tsx); the street with the door "Abrir un piso nuevo" (the new-project dialog);
//   below the street, paused projects with their blinds down and Reanudar (the project switch).
// PLA-I39-5: each decision hangs under its asker's window (question.tsx); one nobody on a team asked opens from its
//   roof chip, in place.
import type { ReactNode } from "react";
import type { Decision, OrgCompany, OrgMember, OrgProject } from "@/lib/api";
import { floorOrder, hourIn } from "@/lib/edificio";
import { companyLine } from "@/lib/v2";
import { BlockError } from "@/components/compania/parts";
import { Floor } from "./floor";
import { Plate } from "./plate";
import type { QuestionActs } from "./question";
import { Roof } from "./roof";
import { EdificioSkeleton, Scene } from "./scene";

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
  onFijar?: (p: OrgProject) => void;
  onPlan?: (p: OrgProject, el: HTMLElement) => void;
  onResume?: (slug: string) => void;
  resuming?: string | null;
  // PLA-I39-5: acting on a decision where it hangs, and the roof chip opened in place.
  acts?: QuestionActs;
  roofOpen?: string | null;
  // PLA-I39-6: the "+" window opens adding someone.
  onAdd?: (slug: string, el: HTMLElement) => void;
  // PLA-I39-7: the ask box of a floor, and which floors the owner is typing in.
  askFor?: (p: OrgProject) => ReactNode;
  typing?: Record<string, boolean>;
  // PLA-23: publishing a floor's finished changes, from its plate or its roof chip.
  onPublish?: (p: OrgProject) => void;
};

export const Building = ({ company, decisions, now, timeZone, hello, day, meta, onNew, onOpen, onChip, onFijar, onPlan, onResume, resuming, acts, roofOpen, onAdd, askFor, typing, onPublish }: BuildingProps) => {
  const { floors, basement } = floorOrder(company.projects, decisions);
  const paused = company.company.paused;
  // Only what Asistente wrote in a run that finished: a skipped or failed run's summary is the runner's own words.
  const summary = company.asistente.last_run?.status === "ok" && company.asistente.last_run.summary ? firstLine(company.asistente.last_run.summary) : "";
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
      {!empty && <Roof decisions={decisions} projects={company.projects} plumbing={company.plumbing} onChip={onChip} open={roofOpen} acts={acts} />}
      <div className="edi-tower" data-tower={floors.length}>
        {empty ? (
          <div className="edi-empty" data-empty="projects">
            <p>Un proyecto es un nombre y una meta. Llega con su equipo: PO, Research, Artist y Taller, cada uno en su ventana.</p>
            <button type="button" className="edi-door" onClick={onNew} data-control="primer-piso">
              ＋ Abrir el primer piso
            </button>
          </div>
        ) : (
          <>
            {floors.map((p) => (
              <Floor
                key={p.slug}
                project={p}
                now={now}
                companyPaused={paused}
                onOpen={onOpen ? (m, el) => onOpen(p.slug, m, el) : undefined}
                onFijar={onFijar}
                onPlan={onPlan}
                onPublish={onPublish}
                decisions={decisions}
                acts={acts}
                ask={askFor?.(p)}
                typing={!!typing?.[p.slug]}
              >
                {onAdd && p.team.length < 8 ? (
                  <button type="button" className="edi-win edi-add" onClick={(e) => onAdd(p.slug, e.currentTarget)} data-control="sumar" aria-label={`Sumar a alguien al equipo de ${p.title}`}>
                    <span className="edi-glass" aria-hidden>
                      +
                    </span>
                    <span className="edi-who">
                      <b>Sumar al equipo</b>
                    </span>
                  </button>
                ) : null}
              </Floor>
            ))}
            <div className="edi-lobby">
              <button type="button" className="edi-door" onClick={onNew} data-control="piso-nuevo">
                ＋ Abrir un piso nuevo
              </button>
              <span className="edi-muted">Un proyecto nuevo llega con su equipo: PO, Research, Artist y Taller.</span>
            </div>
          </>
        )}
      </div>
      <div className="edi-street" aria-hidden />
      {basement.length > 0 && (
        <div className="edi-under" data-basement={basement.length}>
          <p className="edi-eyebrow">Bajo la calle · en pausa</p>
          {basement.map((p) => (
            <Floor
              key={p.slug}
              project={p}
              now={now}
              companyPaused={paused}
              onOpen={onOpen ? (m, el) => onOpen(p.slug, m, el) : undefined}
              plate={
                <Plate project={p} onPlan={onPlan}>
                  {onResume && (
                    <div className="edi-links">
                      <button type="button" className="edi-btn" disabled={resuming === p.slug} onClick={() => onResume(p.slug)} data-control="reanudar">
                        {resuming === p.slug ? "…" : "Reanudar"}
                      </button>
                    </div>
                  )}
                </Plate>
              }
            />
          ))}
        </div>
      )}
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
