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
// PLA-I47-2 (v6): one floor at a time. The tower rail (tower.tsx) replaces scrolling between floors: Tu oficina (the
//   roof, opened over the floor), one tile per floor, the street, the paused floors and «+». ?piso=<slug> picks the
//   floor; ↑ ↓ walk the tower (the page listens: this component stays hook-free for the tests). The open floor fills
//   the window and never grows with its content.
import type { ReactNode } from "react";
import type { Decision, OrgCompany, OrgMember, OrgProject } from "@/lib/api";
import { floorOrder, hourIn, skyLine, skyMove } from "@/lib/edificio";
import { companyLine } from "@/lib/v2";
import { BlockError } from "@/components/compania/parts";
import { DecisionLayer } from "./decision-layer";
import { Floor } from "./floor";
import { ActButton, type NowActs } from "./now";
import type { QuestionActs } from "./question";
import { Roof } from "./roof";
import { EdificioSkeleton, Scene } from "./scene";
import { Tower, openFloor } from "./tower";
import type { FilaActs } from "./fila";

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
  // PLA-I47-2: the open floor (?piso=<slug>) and changing it (the rail, ↑ ↓).
  piso?: string | null;
  onPiso?: (slug: string) => void;
  // PLA-I47-2: Tu oficina opened over the floor (the page holds it), and what else lives there (Brief de hoy).
  office?: boolean;
  onOffice?: () => void;
  officeMore?: ReactNode;
  // PLA-I47-3: La fila's calls (Hacer primero, Detener, Aceptar, Quitar).
  fila?: FilaActs;
  // PLA-I47-4: La ficha beside the floor (the page reads and draws it), and a leg opening in it.
  ficha?: ReactNode;
  fichaOpen?: boolean;
  onLeg?: (slug: string, key: string, el: HTMLElement) => void;
};


export const Building = ({ company, decisions, now, timeZone, hello, day, meta, onNew, onOpen, onChip, onFijar, onPlan, onResume, resuming, acts, roofOpen, onAdd, askFor, typing, onPublish, nowActs, ventanaFor, piso, onPiso, office, onOffice, officeMore, fila, ficha, fichaOpen, onLeg }: BuildingProps) => {
  const { floors, basement } = floorOrder(company.projects, decisions);
  const paused = company.company.paused;
  const open = openFloor(floors, basement, piso);
  const officeOpen = !!office || !!roofOpen;
  // Only what Asistente wrote in a run that finished: a skipped or failed run's summary is the runner's own words.
  const summary = company.asistente.last_run?.status === "ok" && company.asistente.last_run.summary ? firstLine(company.asistente.last_run.summary) : "";
  const empty = company.projects.length === 0;
  const isOff = !!open && basement.includes(open);
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
      {empty ? (
        <div className="edi-tower">
          <div className="edi-empty" data-empty="projects">
            <p>Un proyecto es un nombre y una meta. Llega con su equipo: PO, Research, Artist y Taller, cada uno en su ventana.</p>
            <button type="button" className="edi-door" onClick={onNew} data-control="primer-piso">
              ＋ Abrir el primer piso
            </button>
          </div>
        </div>
      ) : (
        <div className="edi-bld" data-open={open?.slug} data-ficha={ficha ? (fichaOpen ? "open" : "closed") : undefined}>
          <Tower floors={floors} basement={basement} decisions={decisions} projects={company.projects} open={open?.slug ?? null} officeOpen={officeOpen} companyPaused={paused} onPiso={onPiso} onOffice={onOffice} onNew={onNew} />
          {/* Tu oficina: what waits on the owner across floors, over the floor while open. */}
          <div className="edi-office" data-office={officeOpen ? "open" : "closed"} hidden={!officeOpen}>
            <Roof decisions={decisions} projects={company.projects} plumbing={company.plumbing} onChip={onChip} open={roofOpen} acts={acts} />
            {officeMore && <div className="edi-office-more">{officeMore}</div>}
          </div>
          {open && (
            <Floor
              key={open.slug}
              project={open}
              now={now}
              companyPaused={paused}
              onOpen={onOpen ? (m, el) => onOpen(open.slug, m, el) : undefined}
              onFijar={onFijar}
              onPlan={onPlan}
              onPublish={isOff ? undefined : onPublish}
              decisions={isOff ? undefined : decisions}
              acts={isOff ? undefined : acts}
              ask={isOff ? undefined : askFor?.(open)}
              typing={!!typing?.[open.slug]}
              timeZone={timeZone}
              nowActs={isOff ? undefined : nowActs}
              ventana={isOff ? undefined : ventanaFor?.(open)}
              fila={isOff ? undefined : fila}
              ficha={!!ficha}
              onLeg={onLeg ? (key, el) => onLeg(open.slug, key, el) : undefined}
              resume={
                isOff && onResume ? (
                  <button type="button" className="edi-btn" disabled={resuming === open.slug} onClick={() => onResume(open.slug)} data-control="reanudar">
                    {resuming === open.slug ? "…" : "Reanudar"}
                  </button>
                ) : undefined
              }
            >
              {!isOff && onAdd && open.team.length < 8 ? (
                <button type="button" className="edi-win edi-add" onClick={(e) => onAdd(open.slug, e.currentTarget)} data-control="sumar" aria-label={`Sumar a alguien al equipo de ${open.title}`}>
                  <span className="edi-glass" aria-hidden>
                    +
                  </span>
                  <span className="edi-who">
                    <b>Sumar</b>
                  </span>
                </button>
              ) : null}
            </Floor>
          )}
          {ficha && (
            <>
              <div className="edi-scrim" aria-hidden hidden={!fichaOpen} />
              {ficha}
            </>
          )}
        </div>
      )}
      {!empty && open && <PhoneBar projects={company.projects} decisions={decisions} floor={open} ctx={{ decisions, acts: nowActs, qacts: acts, onFijar, onPublish }} pedir={!!askFor && !isOff} />}
      {/* PLA-I46-15: a decision at the front (Ahora's «Al frente»). */}
      {!empty && <DecisionLayer projects={company.projects} decisions={decisions} ctx={{ decisions, acts: nowActs, qacts: acts, onFijar, onPublish }} now={now} companyPaused={paused} timeZone={timeZone} />}
    </Scene>
  );
};

// PLA-I46-3: the bar fixed at the bottom of a phone (CSS shows it under 40rem). It carries the one main button, the
// first floor's move (the same action as Ahora's, whose own button hides there), and Pedir for that floor (it opens
// the plate's side page). Without a move it says so and draws no green button.
const openAsk = (slug: string) => document.querySelector<HTMLButtonElement>(`[data-ask-open="${CSS.escape(slug)}"] [data-control="pedir-abrir"]`)?.click();
export const PhoneBar = ({ projects, decisions, ctx, pedir, floor: shown }: { projects: OrgProject[]; decisions: Decision[]; ctx: Parameters<typeof ActButton>[0]["ctx"]; pedir?: boolean; floor?: OrgProject }) => {
  const sky = skyMove(projects, decisions);
  const floor = shown ?? sky?.project ?? floorOrder(projects, decisions).floors[0];
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
