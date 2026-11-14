// PLA-I39: the whole building for /ceo, from GET /api/company. Presentational: data and callbacks come in as
// props (test/edificio-ui.test.ts renders it with fake data).
//   sky        the moment in one sentence (companyLine) and Asistente's last summary
//   roof       Tu oficina (roof.tsx)
//   tower      one floor per running project, those that need the owner first
//   empty      no projects: an empty lot with the door "Abrir el primer piso"
// PLA-I39-4: each floor's plate (plate.tsx); the street; below it, paused projects with their blinds down and Reanudar
//   (the project switch); last, at the end of the page, the door "Abrir un piso nuevo" (the new-project dialog).
// PLA-I39-5: each decision hangs under its asker's window (question.tsx); one nobody on a team asked opens from its
//   roof chip, in place.
import type { ReactNode } from "react";
import type { Decision, OrgCompany, OrgMember, OrgProject } from "@/lib/api";
import { floorOrder, hourIn, skyLine, skyMove } from "@/lib/edificio";
import { companyLine } from "@/lib/v2";
import { BlockError } from "@/components/compania/parts";
import { Floor } from "./floor";
import { Plate } from "./plate";
import { ActButton, type NowActs } from "./now";
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
  // PLA-I40-4: the calls of each floor's Ahora band.
  nowActs?: NowActs;
  // PLA-I46-7: the Ventana a la app of a floor (the page passes VentanaLive).
  ventanaFor?: (p: OrgProject) => ReactNode;
};

export const Building = ({ company, decisions, now, timeZone, hello, day, meta, onNew, onOpen, onChip, onFijar, onPlan, onResume, resuming, acts, roofOpen, onAdd, askFor, typing, onPublish, nowActs, ventanaFor }: BuildingProps) => {
  const { floors, basement } = floorOrder(company.projects, decisions);
  const paused = company.company.paused;
  // Only what Asistente wrote in a run that finished: a skipped or failed run's summary is the runner's own words.
  const summary = company.asistente.last_run?.status === "ok" && company.asistente.last_run.summary ? firstLine(company.asistente.last_run.summary) : "";
  const empty = company.projects.length === 0;
  return (
    <Scene
      hour={hourIn(now, timeZone)}
      pre={`${hello}, Jorge · ${day}`}
      line={empty ? "Todavía no hay pisos." : skyLine(company.projects, decisions, companyLine(company.projects).replace(/^./, (c) => c.toUpperCase()))}
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
                timeZone={timeZone}
                nowActs={nowActs}
                ventana={ventanaFor?.(p)}
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
              timeZone={timeZone}
              onOpen={onOpen ? (m, el) => onOpen(p.slug, m, el) : undefined}
              plate={
                <Plate project={p} onPlan={onPlan} noSteps={p.route !== undefined}>
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
      {!empty && <PhoneBar projects={company.projects} decisions={decisions} ctx={{ decisions, acts: nowActs, qacts: acts, onFijar, onPublish }} pedir={!!askFor} />}
      {!empty && (
        <div className="edi-lobby edi-lobby-end">
          <button type="button" className="edi-door" onClick={onNew} data-control="piso-nuevo">
            ＋ Abrir un piso nuevo
          </button>
          <span className="edi-muted">Un proyecto nuevo llega con su equipo: PO, Research, Artist y Taller.</span>
        </div>
      )}
    </Scene>
  );
};

// PLA-I46-3: the bar fixed at the bottom of a phone (CSS shows it under 40rem). It carries the one main button, the
// first floor's move (the same action as Ahora's, whose own button hides there), and Pedir for that floor (it opens
// the plate's side page). Without a move it says so and draws no green button.
const openAsk = (slug: string) => document.querySelector<HTMLButtonElement>(`[data-ask-open="${CSS.escape(slug)}"] [data-control="pedir-abrir"]`)?.click();
export const PhoneBar = ({ projects, decisions, ctx, pedir }: { projects: OrgProject[]; decisions: Decision[]; ctx: Parameters<typeof ActButton>[0]["ctx"]; pedir?: boolean }) => {
  const sky = skyMove(projects, decisions);
  const floor = sky?.project ?? floorOrder(projects, decisions).floors[0];
  if (!floor) return null;
  return (
    <div className="edi-pbar" data-pbar={floor.slug} role="region" aria-label="Tu siguiente jugada">
      <p className="edi-pbar-say" data-pbar-say>
        {sky ? sky.move.texto : "Nada te toca ahora"}
      </p>
      <div className="edi-pbar-acts">
        {sky && <ActButton project={sky.project} action={sky.move.accion} move where="barra" ctx={ctx} className="edi-pbar-go" />}
        {pedir && (
          <button type="button" className="edi-btn" onClick={() => openAsk(floor.slug)} data-control="barra-pedir">
            Pedir
          </button>
        )}
      </div>
    </div>
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
