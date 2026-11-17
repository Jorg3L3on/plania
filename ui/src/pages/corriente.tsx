// PLA-I62: La corriente, Compañía redesigned (PLA-IDEA25). Built at /corriente while /ceo keeps the building; PLA-I62-9
// makes it /ceo. Data and calls are the ones /ceo uses (GET /api/company, GET /api/projects and friends); only the
// drawing is new. The address (lib/corriente.ts) says which screen shows.
// Keys (inside a project, as on /ceo): ↑ ↓ change project; 1-7 the work tabs; M Máquinas and back; I Ahora; E Equipo;
// Esc steps out (what a tab has open, then the tab, then the project back to the stream).
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { useCorrienteActs, SLEEPY } from "@/components/corriente/acts";
import { Ahora, type AhoraLinks } from "@/components/corriente/ahora";
import { Head } from "@/components/corriente/header";
import { Btn, NotYet, ReadError } from "@/components/corriente/parts";
import { PedirBar } from "@/components/corriente/pedir-bar";
import { Piezas } from "@/components/corriente/piezas";
import { ProjectBar, Strip } from "@/components/corriente/strip";
import { Stream, type StreamLinks } from "@/components/corriente/stream";
import { GoalDialog } from "@/components/goals/goal-dialog";
import type { Goal } from "@/components/goals/model";
import { ApiError, api, type OrgProject } from "@/lib/api";
import { WORK_TABS, atOf, hrefOf, isBuilt, legacyHref, linkTo, type AskInput, type At, type Tab } from "@/lib/corriente";
import { CLOSED, headlineOf, lanesOf, totalsOf } from "@/lib/corriente-stream";
import { pending } from "@/lib/v2";
import { useMinute } from "@/pages/ceo";

const typingIn = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || !!t.closest("[role=dialog]"));

/** The goal dialog's goal for a project (its placeholder is edited, not kept). */
const goalOf = (p: OrgProject | null): Goal | null =>
  p?.rumbo?.goal_id != null
    ? { id: p.rumbo.goal_id, title: p.rumbo.goal ?? "", why: p.rumbo.why, status: "active", target_on: p.rumbo.target_on, position: 0, project: p.slug, parent_id: null, progress: { done: 0, total: 0 }, initiatives: [], children: [] }
    : null;

/** Esc from where the address is: what a tab has open, then the tab, then the project. */
export function escFrom(at: At): Partial<At> {
  if (!at.slug) return { view: "corriente" };
  if (at.ver) return { slug: at.slug, tab: at.tab };
  if (at.tab !== "ahora") return { slug: at.slug };
  return { view: "corriente" };
}

export const CorrientePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const at = atOf(location.search);
  const now = useMinute();
  const acts = useCorrienteActs();
  const comp = useQuery({ queryKey: ["company"], queryFn: api.company, staleTime: 10_000, refetchInterval: 20_000 });
  // The ideas with their stage and the tickets with their status (Inicio's read): the stream's dots and the totals.
  const summaries = useQuery({ queryKey: ["projects"], queryFn: api.projects, staleTime: 15_000, refetchInterval: 30_000 });
  const company = comp.data;
  const timeZone = company?.week.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const decisions = useMemo(() => acts.decisions.withActed(company?.decisions ?? []), [company, acts.decisions]);
  const waiting = decisions.filter(pending).length;
  const paused = !!company?.company.paused;
  const refresh = acts.refresh;

  const [resuming, setResuming] = useState<string | null>(null);
  const resume = useMutation({
    mutationFn: (slug: string) => api.setProjectPaused(slug, false),
    onMutate: (slug) => setResuming(slug),
    onError: (e) => toast.error(e instanceof ApiError ? `No se pudo reanudar (${e.code}).` : SLEEPY),
    onSettled: () => {
      setResuming(null);
      refresh();
    },
  });
  const resumeCompany = useMutation({
    mutationFn: () => api.setCompanyPaused(false),
    onError: (e) => toast.error(e instanceof ApiError ? `No se pudo reanudar (${e.code}).` : SLEEPY),
    onSettled: refresh,
  });
  const ask = async (slug: string, input: AskInput) => {
    const r = await api.askProject(slug, input);
    refresh();
    return r;
  };
  const [fijar, setFijar] = useState<OrgProject | null>(null);

  const lanes = useMemo(() => (company ? lanesOf(company.projects, summaries.data, decisions, paused) : []), [company, summaries.data, decisions, paused]);
  const project = at.slug ? (company?.projects.find((p) => p.slug === at.slug) ?? null) : null;
  const go = (to: Partial<At>, replace = false) => {
    const href = linkTo(to);
    if (href.startsWith("/corriente")) navigate(href, { replace });
    else navigate(href);
  };

  // Keys, as on /ceo, unless the owner is typing or a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typingIn(e.target) || document.querySelector("[role=dialog]")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        go(escFrom(at), true);
        return;
      }
      if (!at.slug) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const i = lanes.findIndex((l) => l.slug === at.slug);
        const to = lanes[i + (e.key === "ArrowUp" ? -1 : 1)];
        if (to) {
          e.preventDefault();
          go({ slug: to.slug, tab: at.tab }, true);
        }
        return;
      }
      if (e.key.length === 1 && "1234567".includes(e.key)) {
        e.preventDefault();
        go({ slug: at.slug, tab: WORK_TABS[Number(e.key) - 1]! });
        return;
      }
      const k = e.key.toLowerCase();
      const to: Tab | null = k === "m" ? (at.tab === "maquinas" ? "ahora" : "maquinas") : k === "i" ? "ahora" : k === "e" ? (at.tab === "equipo" ? "ahora" : "equipo") : null;
      if (to) {
        e.preventDefault();
        go({ slug: at.slug, tab: to });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, lanes]);

  const streamLinks: StreamLinks = {
    project: (slug) => linkTo({ slug }),
    agent: (slug, agent) => linkTo({ slug, ver: { kind: "miembro", agent } }),
    // A delivery opens its Entrega; anything else its card in Te toca (the building's floor until those exist).
    you: (slug, d) =>
      d.kind === "deliverable" || d.kind === "pr"
        ? linkTo({ slug, ver: { kind: "entrega", id: d.id } })
        : isBuilt({ view: "tetoca" })
          ? hrefOf({ view: "tetoca", extra: { decision: d.id } })
          : legacyHref({ slug, ver: { kind: "entrega", id: d.id } }),
    // The server's in-page anchors: «#te-toca» is Te toca, «#publicar» and the rest the project.
    reason: (slug, href) => (href === "#te-toca" ? linkTo({ view: "tetoca" }) : href.startsWith("#") ? linkTo({ slug }) : href),
  };
  const pedirTo = (slug: string | null) => (isBuilt({ view: "pedir" }) ? hrefOf({ view: "pedir", extra: slug ? { p: slug } : {} }) : slug ? legacyHref({ slug }) : legacyHref({}));
  const ahoraLinks = (slug: string): AhoraLinks => ({
    entrega: (d) => linkTo({ slug, ver: { kind: "entrega", id: d.id } }),
    tetoca: (d) => (isBuilt({ view: "tetoca" }) ? hrefOf({ view: "tetoca", extra: d ? { decision: d.id } : {} }) : d ? legacyHref({ slug, ver: { kind: "entrega", id: d.id } }) : legacyHref({ view: "tetoca" })),
    paso: (key) => linkTo({ slug, ver: { kind: "paso", key } }),
    tablero: linkTo({ slug, tab: "tablero" }),
    equipo: linkTo({ slug, tab: "equipo" }),
    miembro: (agent) => linkTo({ slug, ver: { kind: "miembro", agent } }),
    // Publicar is a sheet of PLA-I62-8; until then the building's floor, where its button is.
    publicar: legacyHref({ slug }),
    pagina: `/p/${encodeURIComponent(slug)}`,
    hash: (href) => (href === "#te-toca" ? linkTo({ view: "tetoca" }) : legacyHref({ slug })),
  });

  const projectBody = (p: OrgProject) => {
    const summary = summaries.data?.find((s) => s.slug === p.slug);
    const tickets = summary?.tasks.filter((t) => t.kind === "ticket");
    const totals = tickets ? { open: p.work.open, done: tickets.filter((t) => CLOSED.has(t.status) && t.status !== "Won't do" && t.status !== "Cancelled").length } : null;
    if (!isBuilt({ slug: p.slug, tab: at.tab, ver: at.ver })) return <NotYet what={at.ver ? "Esto" : `La pestaña ${at.tab}`} to={legacyHref(at)} />;
    if (at.tab === "ahora") return <Ahora p={p} decisions={decisions} now={now} timeZone={timeZone} companyPaused={paused} totals={totals} acts={acts} links={ahoraLinks(p.slug)} onFijar={setFijar} />;
    return <NotYet what="Esto" to={legacyHref(at)} />;
  };

  const body = () => {
    if (at.view === "piezas") return <Piezas />;
    if (comp.isError && !company) return <ReadError what="la compañía" onRetry={() => void comp.refetch()} />;
    if (!company) return <div className="cor-skel" style={{ margin: "22px 32px", flex: 1 }} aria-busy="true" aria-label="Cargando la compañía" />;
    if (at.slug) {
      if (!project)
        return (
          <div className="cor-empty">
            <p className="cor-text">No hay un proyecto «{at.slug}» en la compañía.</p>
            <Btn kind="secondary" onClick={() => go({ view: "corriente" })}>
              Volver a la corriente
            </Btn>
          </div>
        );
      const mine = decisions.filter((d) => d.project === project.slug && pending(d)).length;
      return (
        <div className="cor-project" data-project={project.slug}>
          <ProjectBar slug={project.slug} title={project.title} tab={at.tab} href={(t) => linkTo({ slug: project.slug, tab: t })} counts={{ ahora: { n: mine, amber: true }, pedidos: { n: (project.pedidos ?? []).filter((x) => !x.guardada && x.question).length, amber: true } }} />
          <div className="cor-pbody">{projectBody(project)}</div>
        </div>
      );
    }
    if (at.view === "corriente")
      return (
        <Stream
          headline={headlineOf(lanes, decisions, paused)}
          totals={summaries.data ? totalsOf(company.projects, summaries.data) : null}
          lanes={lanes}
          links={streamLinks}
          onResume={(slug) => resume.mutate(slug)}
          resuming={resuming}
          pedir={<PedirBar projects={company.projects} disabled={paused} onAsk={ask} pedirTo={(slug) => pedirTo(slug)} />}
        />
      );
    return <NotYet what={at.view === "tetoca" ? "Te toca" : at.view === "asistente" ? "Asistente" : "Pedir"} to={legacyHref(at)} />;
  };

  return (
    <div className="cor" data-corriente={at.slug ? `proyecto:${at.tab}` : at.view}>
      <span className="cor-aura" aria-hidden />
      {at.slug && company ? (
        <Strip lanes={lanes} open={at.slug} href={(slug) => linkTo({ slug, tab: at.tab })} back={hrefOf({ view: "corriente" })} pedirTo={pedirTo(at.slug)} />
      ) : (
        <Head view={at.slug ? null : at.view} waiting={waiting} asistenteUnread={company?.asistente.unread ?? 0} now={now} timeZone={timeZone} pedirTo={pedirTo(null)} tocaTo={linkTo({ view: "tetoca" })} />
      )}
      {paused && (
        <div className="cor-notice amber" role="status" data-banner="paused">
          <span>La compañía está detenida: nada arranca.</span>
          <Btn kind="amber" small disabled={resumeCompany.isPending} onClick={() => resumeCompany.mutate()} data-control="reanudar-compania">
            {resumeCompany.isPending ? "Reanudando…" : "Reanudar la compañía"}
          </Btn>
        </div>
      )}
      <div className="cor-main">{body()}</div>
      <GoalDialog
        open={fijar !== null}
        goal={goalOf(fijar)}
        fixedProject={fijar?.slug}
        projects={[]}
        parents={[]}
        onOpenChange={(open) => !open && setFijar(null)}
        onSaved={() => void client.invalidateQueries({ queryKey: ["company"] })}
      />
    </div>
  );
};
