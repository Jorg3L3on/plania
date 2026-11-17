// PLA-I62: La corriente, Compañía redesigned (PLA-IDEA25). Built at /corriente while /ceo keeps the building; PLA-I62-9
// makes it /ceo. Data and calls are the ones /ceo uses (GET /api/company, GET /api/projects and friends); only the
// drawing is new. The address (lib/corriente.ts) says which screen shows.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { toast } from "sonner";
import { Head } from "@/components/corriente/header";
import { Btn, NotYet, ReadError } from "@/components/corriente/parts";
import { PedirBar } from "@/components/corriente/pedir-bar";
import { Piezas } from "@/components/corriente/piezas";
import { Stream, type StreamLinks } from "@/components/corriente/stream";
import { ApiError, api } from "@/lib/api";
import { atOf, hrefOf, isBuilt, legacyHref, linkTo, type AskInput } from "@/lib/corriente";
import { headlineOf, lanesOf, totalsOf } from "@/lib/corriente-stream";
import { pending } from "@/lib/v2";
import { useMinute } from "@/pages/ceo";

const SLEEPY = "No se pudo. Si la Mac está dormida, intenta al despertar.";

export const CorrientePage = () => {
  const location = useLocation();
  const client = useQueryClient();
  const at = atOf(location.search);
  const now = useMinute();
  const comp = useQuery({ queryKey: ["company"], queryFn: api.company, staleTime: 10_000, refetchInterval: 20_000 });
  // The ideas with their stage and the tickets with their status (Inicio's read): the stream's dots and the totals.
  const summaries = useQuery({ queryKey: ["projects"], queryFn: api.projects, staleTime: 15_000, refetchInterval: 30_000 });
  const company = comp.data;
  const timeZone = company?.week.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const decisions = company?.decisions ?? [];
  const waiting = decisions.filter(pending).length;
  const paused = !!company?.company.paused;
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["company"] });
    void client.invalidateQueries({ queryKey: ["projects"] });
  };

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

  const lanes = useMemo(() => (company ? lanesOf(company.projects, summaries.data, decisions, paused) : []), [company, summaries.data, decisions, paused]);
  const links: StreamLinks = {
    project: (slug) => linkTo({ slug }),
    agent: (slug, agent) => linkTo({ slug, ver: { kind: "miembro", agent } }),
    // A delivery opens its Entrega; anything else its card in Te toca (the building's floor until those exist).
    you: (slug, d) =>
      d.kind === "deliverable" || d.kind === "pr"
        ? linkTo({ slug, ver: { kind: "entrega", id: d.id } })
        : isBuilt({ view: "tetoca" })
          ? hrefOf({ view: "tetoca", extra: { decision: d.id } })
          : legacyHref({ slug, ver: { kind: "entrega", id: d.id } }),
    reason: (slug, href) => (href.startsWith("#") ? linkTo({ slug }) : href),
  };
  const pedirTo = (slug: string | null) =>
    isBuilt({ view: "pedir" }) ? hrefOf({ view: "pedir", extra: slug ? { p: slug } : {} }) : slug ? legacyHref({ slug }) : legacyHref({});

  const body = () => {
    if (at.view === "piezas") return <Piezas />;
    if (comp.isError && !company) return <ReadError what="la compañía" onRetry={() => void comp.refetch()} />;
    if (!company) return <div className="cor-skel" style={{ margin: "22px 32px", flex: 1 }} aria-busy="true" aria-label="Cargando la compañía" />;
    if (at.slug) return <NotYet what="Este proyecto" to={legacyHref(at)} />;
    if (at.view === "corriente")
      return (
        <Stream
          headline={headlineOf(lanes, decisions, paused)}
          totals={summaries.data ? totalsOf(company.projects, summaries.data) : null}
          lanes={lanes}
          links={links}
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
      <Head view={at.slug ? null : at.view} waiting={waiting} asistenteUnread={company?.asistente.unread ?? 0} now={now} timeZone={timeZone} pedirTo={pedirTo(at.slug)} tocaTo={linkTo({ view: "tetoca" })} />
      {paused && (
        <div className="cor-notice amber" role="status" data-banner="paused">
          <span>La compañía está detenida: nada arranca.</span>
          <Btn kind="amber" small disabled={resumeCompany.isPending} onClick={() => resumeCompany.mutate()} data-control="reanudar-compania">
            {resumeCompany.isPending ? "Reanudando…" : "Reanudar la compañía"}
          </Btn>
        </div>
      )}
      <div className="cor-main">{body()}</div>
    </div>
  );
};
