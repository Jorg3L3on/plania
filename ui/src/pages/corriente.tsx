// PLA-I62: La corriente, Compañía redesigned (PLA-IDEA25), served at /ceo (pages/ceo.tsx moves the building's old
// addresses here first). Data and calls are the ones /ceo uses (GET /api/company, GET /api/projects and friends); only the
// drawing is new. The address (lib/corriente.ts) says which screen shows.
// Keys (inside a project, as on /ceo): ↑ ↓ change project; 1-7 the work tabs; M Máquinas and back; I Ahora; E Equipo;
// Esc steps out (what a tab has open, then the tab, then the project back to the stream).
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { useCorrienteActs, SLEEPY } from "@/components/corriente/acts";
import { Ahora, type AhoraLinks } from "@/components/corriente/ahora";
import { Entrega } from "@/components/corriente/entrega";
import { TeToca } from "@/components/corriente/tetoca";
import { Pedir } from "@/components/corriente/pedir";
import { Pedidos } from "@/components/corriente/pedidos";
import { Asistente } from "@/components/corriente/asistente";
import { Board, Paso, type BoardLinks } from "@/components/corriente/tablero";
import { Equipo } from "@/components/corriente/equipo";
import { Idea } from "@/components/corriente/idea";
import { Disenos, Docs, Ideas, Prs } from "@/components/corriente/listas";
import { Motores } from "@/components/corriente/motores";
import { Maquinas } from "@/components/corriente/maquinas";
import { DocHoja, Meta, NuevoProyecto, Pausar, Publicar, Reanudar, type HojaKind } from "@/components/corriente/hojas";
import type { PendLinks } from "@/components/corriente/pendiente";
import { Head } from "@/components/corriente/header";
import { Btn, NotYet, ReadError } from "@/components/corriente/parts";
import { PedirBar } from "@/components/corriente/pedir-bar";
import { Piezas } from "@/components/corriente/piezas";
import { ProjectBar, Strip } from "@/components/corriente/strip";
import { Stream, type StreamLinks } from "@/components/corriente/stream";
import { ApiError, api, type OrgProject } from "@/lib/api";
import { WORK_TABS, atOf, hrefOf, isBuilt, legacyHref, linkTo, type AskInput, type At, type Tab } from "@/lib/corriente";
import { CLOSED, headlineOf, lanesOf, projectOfKey, totalsOf } from "@/lib/corriente-stream";
import { pending } from "@/lib/v2";
import { useMinute } from "@/lib/use-minute";

const typingIn = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || !!t.closest("[role=dialog]"));

/** The sheet the address opens: ?hoja=<kind>[:<slug>] (?nuevo, the building's link, is Nuevo proyecto too). */
export function hojaOf(search: string): { kind: HojaKind; slug: string | null } | null {
  const q = new URLSearchParams(search);
  if (q.has("nuevo")) return { kind: "nuevo", slug: null };
  const raw = q.get("hoja");
  if (!raw) return null;
  const [kind, slug] = raw.split(":") as [string, string | undefined];
  return (["nuevo", "pausar", "reanudar", "publicar", "meta"] as const).includes(kind as HojaKind) ? { kind: kind as HojaKind, slug: slug || q.get("proyecto") } : null;
}

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
  const hoja = hojaOf(location.search);
  const hojaHref = (kind: HojaKind, slug?: string | null) => {
    const q = new URLSearchParams(location.search);
    q.delete("nuevo");
    q.set("hoja", slug ? `${kind}:${slug}` : kind);
    return `${location.pathname}?${q.toString()}`;
  };
  const closeHoja = () => {
    const q = new URLSearchParams(location.search);
    q.delete("hoja");
    q.delete("nuevo");
    const out = q.toString();
    navigate(`${location.pathname}${out ? `?${out}` : ""}`, { replace: true });
  };
  const openHoja = (kind: HojaKind, slug?: string | null) => navigate(hojaHref(kind, slug));

  const lanes = useMemo(() => (company ? lanesOf(company.projects, summaries.data, decisions, paused) : []), [company, summaries.data, decisions, paused]);
  const project = at.slug ? (company?.projects.find((p) => p.slug === at.slug) ?? null) : null;
  const go = (to: Partial<At>, replace = false) => {
    const href = linkTo(to);
    if (href.startsWith("/ceo")) navigate(href, { replace });
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
    publicar: hojaHref("publicar", slug),
    pausar: hojaHref("pausar", slug),
    pagina: `/p/${encodeURIComponent(slug)}`,
    hash: (href) => (href === "#te-toca" ? linkTo({ view: "tetoca" }) : href === "#publicar" ? hojaHref("publicar", slug) : linkTo({ slug })),
  });

  const pendLinks: PendLinks = {
    entrega: (d) => linkTo({ slug: d.project ?? undefined, ver: { kind: "entrega", id: d.id } }),
    publicar: (d) => hojaHref("publicar", d.project),
    project: (slug) => linkTo({ slug }),
  };
  const focusParam = new URLSearchParams(location.search).get("decision");

  const projectBody = (p: OrgProject) => {
    const summary = summaries.data?.find((s) => s.slug === p.slug);
    const tickets = summary?.tasks.filter((t) => t.kind === "ticket");
    const totals = tickets ? { open: p.work.open, done: tickets.filter((t) => CLOSED.has(t.status) && t.status !== "Won't do" && t.status !== "Cancelled").length } : null;
    if (!isBuilt({ slug: p.slug, tab: at.tab, ver: at.ver })) return <NotYet what={at.ver ? "Esto" : `La pestaña ${at.tab}`} to={legacyHref(at)} />;
    if (at.ver?.kind === "entrega") {
      const verId = at.ver.id;
      const d = decisions.find((x) => x.id === verId);
      if (!d)
        return (
          <div className="cor-empty">
            <p className="cor-text">Esta entrega ya no espera tu decisión.</p>
            <Btn kind="secondary" onClick={() => go({ slug: p.slug })}>
              Volver a Ahora
            </Btn>
          </div>
        );
      return <Entrega p={p} d={d} acts={acts} back={linkTo({ slug: p.slug })} />;
    }
    const boardLinks: BoardLinks = {
      paso: (key) => linkTo({ slug: p.slug, ver: { kind: "paso", key } }),
      iniciativa: (key) => linkTo({ slug: p.slug, ver: { kind: "iniciativa", key } }),
      entrega: (d) => linkTo({ slug: p.slug, ver: { kind: "entrega", id: d.id } }),
      sueltos: linkTo({ slug: p.slug, tab: "tablero" }),
      doc: (id) => linkTo({ slug: p.slug, ver: { kind: "doc", id } }),
    };
    if (at.ver?.kind === "paso" || at.ver?.kind === "iniciativa") return <Paso p={p} k={at.ver.key} links={boardLinks} back={linkTo({ slug: p.slug, tab: "tablero" })} />;
    if (at.tab === "tablero")
      return <Board p={p} decisions={decisions} acts={acts} links={boardLinks} now={now} chosenKey={new URLSearchParams(location.search).get("elegida")} onChoose={(k) => navigate(hrefOf({ slug: p.slug, tab: "tablero", extra: k ? { elegida: k } : {} }), { replace: true })} />;
    if (at.tab === "equipo")
      return (
        <Equipo
          p={p}
          now={now}
          timeZone={timeZone}
          companyPaused={paused}
          acts={acts}
          focus={at.ver?.kind === "miembro" ? at.ver.agent : at.ver?.kind === "sumar" ? "sumar" : null}
          motorTo={linkTo({ slug: p.slug, tab: "motores" })}
          sumarTo={linkTo({ slug: p.slug, ver: { kind: "sumar" } })}
          motorDefault={company?.motor_default}
        />
      );
    if (at.ver?.kind === "idea")
      return <Idea p={p} k={at.ver.key} now={now} timeZone={timeZone} acts={acts} links={{ back: linkTo({ slug: p.slug, tab: "ideas" }), doc: (id) => linkTo({ slug: p.slug, ver: { kind: "doc", id } }), track: (key) => linkTo({ slug: p.slug, ver: { kind: "iniciativa", key } }) }} />;
    if (at.tab === "ideas") return <Ideas p={p} acts={acts} links={{ idea: (key) => linkTo({ slug: p.slug, ver: { kind: "idea", key } }), pedir: pedirTo(p.slug) }} />;
    if (at.tab === "diseno") return <Disenos p={p} links={{ idea: (key) => linkTo({ slug: p.slug, ver: { kind: "idea", key } }) }} />;
    if (at.tab === "prs")
      return <Prs p={p} decisions={decisions} open={at.ver?.kind === "pr" ? at.ver.n : null} links={{ pr: (n) => linkTo({ slug: p.slug, ver: { kind: "pr", n } }), paso: (key) => linkTo({ slug: p.slug, ver: { kind: "paso", key } }), entrega: (d) => linkTo({ slug: p.slug, ver: { kind: "entrega", id: d.id } }) }} />;
    if (at.tab === "docs") return <Docs p={p} open={at.ver?.kind === "doc" ? at.ver.id : null} links={{ doc: (id) => linkTo({ slug: p.slug, ver: { kind: "doc", id } }), iniciativa: (key) => linkTo({ slug: p.slug, ver: { kind: "iniciativa", key } }) }} />;
    if (at.tab === "pedidos")
      return (
        <Pedidos
          p={p}
          decisions={decisions}
          now={now}
          timeZone={timeZone}
          open={at.ver?.kind === "pedido" ? at.ver.key : null}
          guardadas={at.ver?.kind === "guardadas"}
          acts={acts}
          links={{
            open: (key) => linkTo({ slug: p.slug, tab: "pedidos", ver: key ? { kind: "pedido", key } : null }),
            guardadas: linkTo({ slug: p.slug, ver: { kind: "guardadas" } }),
            pedir: pedirTo(p.slug),
            idea: (key) => linkTo({ slug: p.slug, ver: { kind: "idea", key } }),
          }}
        />
      );
    if (at.tab === "motores")
      return (
        <Motores
          p={p}
          def={company?.motor_default}
          planTo="/machine"
          onSave={async (save) => {
            const out = await api.saveMotores(save);
            void client.invalidateQueries({ queryKey: ["company"] });
            return out;
          }}
        />
      );
    if (at.tab === "maquinas")
      return (
        <Maquinas
          p={p}
          focus={at.ver?.kind === "maq" ? at.ver.what : at.ver?.kind === "tabla" ? `tabla:${at.ver.name}` : null}
          onFocus={(what) => navigate(linkTo({ slug: p.slug, tab: "maquinas", ver: what ? (what.startsWith("tabla:") ? { kind: "tabla", name: what.slice(6) } : { kind: "maq", what }) : null }), { replace: true })}
          onPedir={(text) => navigate(hrefOf({ view: "pedir", extra: { p: p.slug, texto: text } }))}
        />
      );
    if (at.tab === "ahora") return <Ahora p={p} decisions={decisions} now={now} timeZone={timeZone} companyPaused={paused} totals={totals} acts={acts} links={ahoraLinks(p.slug)} onFijar={(x) => openHoja("meta", x.slug)} />;
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
          onResume={(slug) => openHoja("reanudar", slug)}
          onNew={() => openHoja("nuevo")}
          resuming={resuming}
          pedir={<PedirBar projects={company.projects} disabled={paused} onAsk={ask} pedirTo={(slug) => pedirTo(slug)} />}
        />
      );
    if (at.view === "tetoca")
      return (
        <TeToca
          company={company}
          decisions={decisions}
          focus={focusParam}
          now={now}
          timeZone={timeZone}
          acts={acts}
          links={{ ...pendLinks, consulta: (slug) => pedirTo(slug) }}
          onFocus={(id) => navigate(hrefOf({ view: "tetoca", extra: { decision: id } }), { replace: true })}
          askTo={pedirTo(null)}
        />
      );
    if (at.view === "pedir")
      return <Pedir projects={company.projects} initial={new URLSearchParams(location.search).get("p")} initialText={new URLSearchParams(location.search).get("texto")} disabled={paused} onAsk={ask} onPictures={refresh} asistenteTo={hrefOf({ view: "asistente" })} pedidosTo={(slug) => linkTo({ slug, tab: "pedidos" })} />;
    if (at.view === "asistente")
      return (
        <Asistente
          threadId={company.asistente.thread_id}
          unread={company.asistente.unread ?? 0}
          waiting={company.asistente.state === "waiting_jorge"}
          timeZone={timeZone}
          invalidate={[["company"]]}
          pedirTo={pedirTo(null)}
          workTo={(kind, ref) => {
            const slug = projectOfKey(ref, summaries.data);
            if (!slug) return null;
            return kind === "idea" ? linkTo({ slug, ver: { kind: "pedido", key: ref } }) : linkTo({ slug, ver: { kind: "paso", key: ref } });
          }}
        />
      );
    return <NotYet what="Esto" to={legacyHref(at)} />;
  };

  return (
    <div className="cor" data-corriente={at.slug ? `proyecto:${at.tab}` : at.view}>
      <span className="cor-aura" aria-hidden />
      {at.slug && company ? (
        <Strip lanes={lanes} open={at.slug} href={(slug) => linkTo({ slug, tab: at.tab })} back={hrefOf({ view: "corriente" })} pedirTo={pedirTo(at.slug)} />
      ) : (
        <Head view={at.slug ? null : at.view} waiting={waiting} asistenteUnread={company?.asistente.unread ?? 0} now={now} timeZone={timeZone} pedirTo={pedirTo(null)} tocaTo={linkTo({ view: "tetoca" })} closeTo={at.view === "pedir" ? hrefOf({ view: "corriente" }) : undefined} />
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
      {new URLSearchParams(location.search).get("doc") && (
        <DocHoja
          id={new URLSearchParams(location.search).get("doc")!}
          onClose={() => {
            const q = new URLSearchParams(location.search);
            q.delete("doc");
            navigate(`${location.pathname}${q.toString() ? `?${q}` : ""}`, { replace: true });
          }}
        />
      )}
      {hoja && company && (() => {
        const hp = hoja.slug ? (company.projects.find((x) => x.slug === hoja.slug) ?? null) : null;
        if (hoja.kind === "nuevo") return <NuevoProyecto onClose={closeHoja} onOpen={(slug) => navigate(linkTo({ slug }))} />;
        if (!hp) return null;
        if (hoja.kind === "pausar") return <Pausar p={hp} onClose={closeHoja} onDone={() => (closeHoja(), refresh())} />;
        if (hoja.kind === "reanudar") return <Reanudar p={hp} companyPaused={paused} onClose={closeHoja} onDone={() => (closeHoja(), refresh())} plomeriaTo="/machine" />;
        if (hoja.kind === "meta") return <Meta p={hp} onClose={closeHoja} />;
        const release = decisions.find((d) => d.project === hp.slug && d.kind === "release" && !d.state) ?? null;
        const first = decisions.find((d) => d.project === hp.slug && pending(d) && d.kind !== "release") ?? null;
        return <Publicar p={hp} release={release} first={first} firstTo={first ? (first.kind === "deliverable" || first.kind === "pr" ? linkTo({ slug: hp.slug, ver: { kind: "entrega", id: first.id } }) : hrefOf({ view: "tetoca", extra: { decision: first.id } })) : null} onClose={closeHoja} />;
      })()}
    </div>
  );
};
