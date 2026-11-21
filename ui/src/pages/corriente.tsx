// PLA-I62: La corriente, Compañía redesigned (PLA-IDEA25), served at /ceo (pages/ceo.tsx moves the building's old
// addresses here first). Data and calls are the ones /ceo uses (GET /api/company, GET /api/projects and friends); only the
// drawing is new. The address (lib/corriente.ts) says which screen shows.
// Keys (inside a project): ↑ ↓ change project; E Equipo, M Máquinas (and back to the list); Esc steps out
// (what is open, then the door, then the project back to the stream). PLA-I64-7: the list is the project's entry and
// 1-7 (the retired tabs) do nothing.
import { useEffect, useMemo, useRef, useState } from "react";
import { MigracionesPropias } from "@/components/corriente/migraciones-propias";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { keepRead, lastRead } from "@/lib/last-read";
import type { StreamSummary } from "@/lib/types";
import { useCorrienteActs, SLEEPY } from "@/components/corriente/acts";
import { MoveButton, PLAN_ASK, type AhoraLinks } from "@/components/corriente/ahora";
import { Entrega, EntregaRetomando } from "@/components/corriente/entrega";
import { TeToca } from "@/components/corriente/tetoca";
import { Pedir } from "@/components/corriente/pedir";
import { Asistente } from "@/components/corriente/asistente";
import { BriefPlace, useBriefToca } from "@/components/corriente/brief";
import { Paso, type BoardLinks } from "@/components/corriente/tablero";
import { Equipo, EquipoNav, type EquipoLinks } from "@/components/corriente/equipo";
import { fichaTabOf } from "@/components/corriente/agente";
import { TiendaPage } from "@/components/corriente/tienda";
import { TraerPage } from "@/components/corriente/traer";
import { AdoptarPage, CompaniaPage, EquiposPage } from "@/components/corriente/equipos";
import { Idea } from "@/components/corriente/idea";
import { Prs } from "@/components/corriente/listas";
import type { FichaLinks } from "@/components/corriente/ficha";
import { Motores } from "@/components/corriente/motores";
import { Maquinas } from "@/components/corriente/maquinas";
import { DocHoja, Meta, NuevoProyecto, Pausar, Publicar, Reanudar, type HojaKind } from "@/components/corriente/hojas";
import { BorrarProyecto } from "@/components/corriente/hoja-borrar";
import { pausaDe, pausasWords } from "@/lib/pausas";
import { listedProjects } from "@/lib/proyectos-visibles";
import type { PendLinks } from "@/components/corriente/pendiente";
import { Head } from "@/components/corriente/header";
import { Btn, NotYet, ReadError } from "@/components/corriente/parts";
import { PedirBar } from "@/components/corriente/pedir-bar";
import { Piezas } from "@/components/corriente/piezas";
import { ProjectBar } from "@/components/corriente/strip";
import { Stream, type StreamLinks } from "@/components/corriente/stream";
import { Cabeza, Todo, type TodoLinks } from "@/components/corriente/todo";
import { PasoLado } from "@/components/corriente/lado";
import { cosaOfPaso } from "@/lib/lado";
import { CARRIED, Palanca, type PalancaLinks } from "@/components/corriente/palanca";
import { HechoView } from "@/components/corriente/hecho";
import { DocLector } from "@/components/corriente/docs-proyecto";
import { thingVer } from "@/lib/docs-proyecto";
import { Camino } from "@/components/corriente/camino";
import { Ajustes } from "@/components/corriente/ajustes";
import { Marca } from "@/components/corriente/marca";
import { cosasOf, fraseOf } from "@/lib/cosas";
import { metaLine, teamWord } from "@/lib/barra";
import { nowLine } from "@/lib/edificio";
import { rumboText } from "@/lib/v2";
import { ApiError, api, type Decision, type OrgCompany, type OrgProject } from "@/lib/api";
import { OLD_TAB, atOf, hrefOf, isBuilt, legacyHref, linkTo, pasoAt, tabName, verParam, type AskInput, type At, type Tab } from "@/lib/corriente";
import { doneOf, headlineOf, lanesOf, projectOfKey, totalsOf } from "@/lib/corriente-stream";
import { pending } from "@/lib/v2";
import { useMinute } from "@/lib/use-minute";
import { words } from "@/lib/i18n";
import { CORRIENTE_PAGE } from "@/lib/corriente-page-words";

const typingIn = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || !!t.closest("[role=dialog]"));

/** The sheet the address opens: ?hoja=<kind>[:<slug>] (?nuevo, the building's link, is Nuevo proyecto too). */
export function hojaOf(search: string): { kind: HojaKind; slug: string | null } | null {
  const q = new URLSearchParams(search);
  if (q.has("nuevo")) return { kind: "nuevo", slug: null };
  const raw = q.get("hoja");
  if (!raw) return null;
  const [kind, slug] = raw.split(":") as [string, string | undefined];
  return (["nuevo", "pausar", "reanudar", "publicar", "meta", "borrar"] as const).includes(kind as HojaKind) ? { kind: kind as HojaKind, slug: slug || q.get("proyecto") } : null;
}

/** Esc from where the address is: what a tab has open, then the tab, then the project. */
export function escFrom(at: At): Partial<At> {
  if (!at.slug) return { view: "corriente" };
  if (at.ver) return { slug: at.slug, tab: at.tab };
  // PLA-I3-5: the step's panel closes first; the list stays.
  if (at.paso) return { slug: at.slug, tab: at.tab };
  // A door steps back to the list (Motores to Equipo, where it opens from); the list back to the stream.
  if (at.tab === "motores") return { slug: at.slug, tab: "equipo" };
  if (at.tab !== "todo") return { slug: at.slug };
  return { view: "corriente" };
}

const LAST_READ_MS = 30 * 60_000;
const keepIt =
  (key: string) =>
  <T,>(data: T): T => (keepRead(key, data), data);

export const CorrientePage = () => {
  const w = words(CORRIENTE_PAGE);
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const at = atOf(location.search);
  const now = useMinute();
  const acts = useCorrienteActs();
  // PLA-82 (F-26): the delivery cards seen in this visit, so one taken off the floor for a retake still reads right.
  const seenDecisions = useRef(new Map<string, Decision>());
  // PLA-74: the last read paints at once while the fresh one loads.
  const comp = useQuery({ queryKey: ["company"], queryFn: () => api.company().then(keepIt("company")), staleTime: 10_000, refetchInterval: 20_000, placeholderData: () => lastRead<OrgCompany>("company", LAST_READ_MS) });
  // The ideas with their stage and the tickets with their status (Inicio's read): the stream's dots and the totals.
  // PLA-74: the slim read; the full one (1.3 MB, up to 7 s) is Inicio's.
  const summaries = useQuery({ queryKey: ["projects", "stream"], queryFn: () => api.projectsStream().then(keepIt("stream")), staleTime: 15_000, refetchInterval: 30_000, placeholderData: () => lastRead<StreamSummary[]>("stream", LAST_READ_MS) });
  const company = comp.data;
  const timeZone = company?.week.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const decisions = useMemo(() => acts.decisions.withActed(company?.decisions ?? []), [company, acts.decisions]);
  const waiting = decisions.filter(pending).length;
  const paused = !!company?.company.paused;
  const refresh = acts.refresh;
  const briefToca = useBriefToca();

  const [resuming, setResuming] = useState<string | null>(null);
  const resume = useMutation({
    mutationFn: (slug: string) => api.setProjectPaused(slug, false),
    onMutate: (slug) => setResuming(slug),
    onError: (e) => toast.error(e instanceof ApiError ? w.resumeFailed(e.code) : SLEEPY),
    onSettled: () => {
      setResuming(null);
      refresh();
    },
  });
  // F6: the company and this project both paused: one button resumes the two, the project first.
  const resumeBoth = useMutation({
    mutationFn: async (p: { slug: string; title: string }) => {
      await api.setProjectPaused(p.slug, false);
      await api.setCompanyPaused(false);
      return p.title;
    },
    onSuccess: (title) => toast(pausasWords().ambasHecho(title)),
    onError: (e) => toast.error(e instanceof ApiError ? w.resumeFailed(e.code) : SLEEPY),
    onSettled: refresh,
  });
  const resumeCompany = useMutation({
    mutationFn: () => api.setCompanyPaused(false),
    onError: (e) => toast.error(e instanceof ApiError ? w.resumeFailed(e.code) : SLEEPY),
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

  // F7: the lists leave out the home project while it holds no work; reads by slug below use every project.
  const listed = useMemo(() => (company ? listedProjects(company.projects) : []), [company]);
  const lanes = useMemo(() => (company ? lanesOf(listed, listedProjects(summaries.data ?? []), decisions, paused) : []), [company, listed, summaries.data, decisions, paused]);
  const project = at.slug ? (company?.projects.find((p) => p.slug === at.slug) ?? null) : null;
  const go = (to: Partial<At>, replace = false) => {
    const href = linkTo(to);
    if (href.startsWith("/ceo")) navigate(href, { replace });
    else navigate(href);
  };

  // PLA-I64-7: an old tab's address (t=ahora, pedidos, tablero, ideas, diseno, prs, docs; ver=pedido|lienzo|sueltos|
  // guardadas) is rewritten in place to its new one, keeping the rest of the address (a sheet, a doc, hasta).
  useEffect(() => {
    if (!at.slug) return;
    const q = new URLSearchParams(location.search);
    const t = q.get("t");
    const v = q.get("ver");
    const oldVer = !!v && /^(pedido|lienzo|sueltos|guardadas)(:|$)/.test(v);
    if (!(t && OLD_TAB[t]) && !oldVer && t !== "todo") return;
    if (at.tab === "todo") q.delete("t");
    else q.set("t", at.tab);
    if (at.ver) q.set("ver", verParam(at.ver));
    else q.delete("ver");
    navigate(`${location.pathname}?${q.toString()}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Keys, as on /ceo, unless the owner is typing or a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // PLA-I71: a key a widget already used (the org chart's arrows, a tab list) is not the page's.
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typingIn(e.target) || document.querySelector("[role=dialog]")) return;
      // The brief has its own keys (J K, arrows, Enter, L, X, Z, Esc).
      if (!at.slug && at.view === "brief") return;
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
      const k = e.key.toLowerCase();
      const door: Tab | null = k === "e" ? "equipo" : k === "m" ? "maquinas" : null;
      const to: Tab | null = door ? (at.tab === door && !at.ver ? "todo" : door) : null;
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
    tablero: linkTo({ slug }),
    equipo: linkTo({ slug, tab: "equipo" }),
    miembro: (agent) => linkTo({ slug, ver: { kind: "miembro", agent } }),
    publicar: hojaHref("publicar", slug),
    pausar: hojaHref("pausar", slug),
    pagina: `/p/${encodeURIComponent(slug)}`,
    hash: (href) => (href === "#te-toca" ? linkTo({ view: "tetoca" }) : href === "#publicar" ? hojaHref("publicar", slug) : linkTo({ slug })),
  });

  // PLA-I71-1: Equipo's places, a seat selected on the chart, and its work on the list.
  const equipoLinks = (slug: string): EquipoLinks => ({
    member: (agent) => linkTo({ slug, ver: { kind: "miembro", agent } }),
    equipo: linkTo({ slug, tab: "equipo" }),
    motor: linkTo({ slug, tab: "motores" }),
    sumar: linkTo({ slug, ver: { kind: "sumar" } }),
    // PLA-I71-2: the seat's panel keeps its tab in the address (&ficha=motor); Perfil has none.
    tab: (agent, t) => hrefOf({ slug, ver: { kind: "miembro", agent }, extra: t === "perfil" ? {} : { ficha: t } }),
    work: linkTo({ slug, tab: "todo" }),
    store: linkTo({ slug, ver: { kind: "tienda", skill: null } }),
    teams: linkTo({ slug, ver: { kind: "equipos" } }),
  });
  const equiposLinks = (slug: string) => ({
    adopt: (team: string) => linkTo({ slug, ver: { kind: "adoptar", team } }),
    company: linkTo({ slug, ver: { kind: "compania" } }),
    equipos: linkTo({ slug, ver: { kind: "equipos" } }),
  });

  const pendLinks: PendLinks = {
    entrega: (d) => linkTo({ slug: d.project ?? undefined, ver: { kind: "entrega", id: d.id } }),
    publicar: (d) => hojaHref("publicar", d.project),
    project: (slug) => linkTo({ slug }),
  };
  const focusParam = new URLSearchParams(location.search).get("decision");

  const projectBody = (p: OrgProject) => {
    const summary = summaries.data?.find((s) => s.slug === p.slug);
    const totals = summary ? { open: p.work.open, done: doneOf(summary) } : null;
    if (!isBuilt({ slug: p.slug, tab: at.tab, ver: at.ver })) return <NotYet what={at.ver ? w.thisOne : w.theTab(at.tab)} to={legacyHref(at)} />;
    // PLA-I64: opened from the list, a thing's view comes back to the list.
    const todoHref = linkTo({ slug: p.slug, tab: "todo" });
    if (at.ver?.kind === "entrega") {
      const verId = at.ver.id;
      const d = decisions.find((x) => x.id === verId);
      if (d) seenDecisions.current.set(d.id, d);
      const was = !d ? seenDecisions.current.get(verId) : undefined;
      if (!d && was && (was.kind === "deliverable" || was.kind === "pr") && was.ref) return <EntregaRetomando p={p} d={was} onBack={() => go({ slug: p.slug })} />;
      if (!d)
        return (
          <div className="cor-empty">
            <p className="cor-text">{w.noLongerWaits}</p>
            <Btn kind="secondary" onClick={() => go({ slug: p.slug })}>
              {w.backToList}
            </Btn>
          </div>
        );
      return <Entrega p={p} d={d} acts={acts} back={todoHref} />;
    }
    const boardLinks: BoardLinks = {
      paso: (key) => linkTo({ slug: p.slug, ver: { kind: "paso", key } }),
      iniciativa: (key) => linkTo({ slug: p.slug, ver: { kind: "iniciativa", key } }),
      entrega: (d) => linkTo({ slug: p.slug, ver: { kind: "entrega", id: d.id } }),
      sueltos: todoHref,
      doc: (id) => linkTo({ slug: p.slug, ver: { kind: "doc", id } }),
    };
    // PLA-I65: an idea or an initiative opens the one ficha over the list (Cerrar goes back); a step keeps its view.
    const fichaLinks: FichaLinks = { doc: boardLinks.doc, paso: boardLinks.paso, entrega: boardLinks.entrega, pedir: pedirTo(p.slug) };
    // PLA-62: the lever the thing's row offered comes along (Pasar a Lista, Hacer primero, Detener, Reenviar).
    const carried = (key: string) => {
      const c = cosasOf({ p, decisions, ficha: null, companyPaused: paused }).grupos.flatMap((g) => g.cosas).find((x) => x.key === key);
      return c?.palanca && CARRIED.has(c.palanca.kind) ? <Palanca p={p} c={c} primary={false} acts={acts} decisions={decisions} links={carriedLinks} onFijar={(x) => openHoja("meta", x.slug)} /> : null;
    };
    const carriedLinks: PalancaLinks = {
      entrega: (id) => linkTo({ slug: p.slug, ver: { kind: "entrega", id } }),
      tetoca: (id) => hrefOf({ view: "tetoca", extra: { decision: id } }),
      idea: (key) => linkTo({ slug: p.slug, ver: { kind: "idea", key } }),
      publicar: hojaHref("publicar", p.slug),
      ahora: ahoraLinks(p.slug),
    };
    if (at.ver?.kind === "idea" || at.ver?.kind === "iniciativa") return <Idea p={p} k={at.ver.key} now={now} timeZone={timeZone} acts={acts} decisions={decisions} links={fichaLinks} onClose={() => go({ slug: p.slug })} extra={carried(at.ver.key)} />;
    if (at.ver?.kind === "paso") return <Paso p={p} k={at.ver.key} links={boardLinks} back={todoHref} backLabel={w.all(p.title)} acts={acts} decisions={decisions} />;
    if (at.tab === "todo" && !at.ver) {
      const todoLinks: TodoLinks = {
        open: (c) =>
          c.tipo === "pedido" || c.tipo === "idea"
            ? linkTo({ slug: p.slug, tab: "todo", ver: { kind: "idea", key: c.key } })
            : c.tipo === "iniciativa"
              ? linkTo({ slug: p.slug, tab: "todo", ver: { kind: "iniciativa", key: c.key } })
              : c.tipo === "suelto"
                ? linkTo({ slug: p.slug, tab: "todo", ver: { kind: "paso", key: c.key } })
                : c.tipo === "publicar"
                  ? hojaHref("publicar", p.slug)
                  : hrefOf({ view: "tetoca", extra: { decision: c.decisions[0] ?? "" } }),
        hecha: (key) => linkTo({ slug: p.slug, tab: "todo", ver: { kind: "iniciativa", key } }),
        idea: (key) => linkTo({ slug: p.slug, ver: { kind: "idea", key } }),
        paso: (key) => linkTo({ slug: p.slug, tab: "todo", ver: { kind: "paso", key } }),
        hecho: linkTo({ slug: p.slug, tab: "hecho" }),
      };
      const palancaLinks: PalancaLinks = {
        entrega: (id) => linkTo({ slug: p.slug, tab: "todo", ver: { kind: "entrega", id } }),
        tetoca: (id) => hrefOf({ view: "tetoca", extra: { decision: id } }),
        idea: (key) => linkTo({ slug: p.slug, tab: "todo", ver: { kind: "idea", key } }),
        publicar: hojaHref("publicar", p.slug),
        ahora: ahoraLinks(p.slug),
      };
      // PLA-I3-5: a step of a row's thread opens in the panel beside the list (?paso=<K>). Opening it from the list adds
      // one entry to the history (Back closes it); moving between steps replaces it; Cerrar goes back to that entry.
      const fromList = !!(location.state as { lado?: boolean } | null)?.lado;
      const openPaso = (k: string | null) => {
        if (k === null) {
          if (fromList) navigate(-1);
          else navigate(hrefOf(pasoAt(p.slug, null)), { replace: true });
          return;
        }
        if (k === at.paso) return;
        navigate(hrefOf(pasoAt(p.slug, k)), { replace: !!at.paso, state: at.paso ? location.state : { lado: true } });
      };
      const tickets = [...(p.tablero?.initiatives.flatMap((i) => i.tickets) ?? []), ...(p.tablero?.loose ?? [])];
      const panel = (cosas: Parameters<typeof cosaOfPaso>[0]) => {
        const k = at.paso;
        if (!k) return null;
        const c = cosaOfPaso(cosas, k);
        const ticket = tickets.find((t) => t.key === k) ?? null;
        const parent = ticket?.parent_key ? (p.tablero?.initiatives.find((i) => i.key === ticket.parent_key) ?? null) : null;
        const iniciativa = c?.tipo === "iniciativa" ? { key: c.key, title: c.title } : parent ? { key: parent.key, title: parent.title } : null;
        return (
          <PasoLado
            slug={p.slug}
            k={k}
            tramos={c?.hilo.tramos ?? []}
            etapa={ticket?.etapa ?? null}
            iniciativa={iniciativa}
            links={{ full: (key) => linkTo({ slug: p.slug, tab: "todo", ver: { kind: "paso", key } }), iniciativa: (key) => linkTo({ slug: p.slug, tab: "todo", ver: { kind: "iniciativa", key } }) }}
            onMove={openPaso}
            onClose={() => openPaso(null)}
            now={now}
          />
        );
      };
      return (
        <Todo
          p={p}
          decisions={decisions}
          links={todoLinks}
          lado={{ open: at.paso ?? null, onPaso: openPaso }}
          panel={panel}
          timeZone={timeZone}
          companyPaused={paused}
          actOf={(c, cosas) => <Palanca p={p} c={c} primary={!p.paused && c.grupo === "toca" && cosas.grupos[0]?.cosas[0]?.key === c.key} acts={acts} decisions={decisions} links={palancaLinks} onFijar={(x) => openHoja("meta", x.slug)} />}
          bottom={(cosas) => (
            <PedirBar projects={company ? listed : [p]} fixed={p} primary={!p.paused && !cosas.grupos[0]?.cosas.length} disabled={paused} onAsk={ask} pedirTo={(slug) => pedirTo(slug)} />
          )}
          plan={
            !p.paused && !paused && !(p.route && p.route.legs.length > 0) ? (
              <Btn kind="secondary" onClick={() => acts.plan(p.slug, PLAN_ASK)} disabled={acts.busy === `${p.slug}:plan`} data-control="planear">
                {acts.busy === `${p.slug}:plan` ? w.asking : w.makePlan}
              </Btn>
            ) : undefined
          }
          top={(cosas) => {
            const line = nowLine(p, decisions, now, { companyPaused: paused, timeZone });
            const reason = p.light_reason && p.light !== "ok" && p.light !== "needs_owner" ? p.light_reason : null;
            // When nothing waits on him: the building's nudge (start a teammate, past the guard too) or the light's.
            const nudge =
              line.state !== "you" && line.action ? (
                <MoveButton p={p} a={line.action} d={null} primary={false} acts={acts} links={ahoraLinks(p.slug)} onFijar={(x) => openHoja("meta", x.slug)} />
              ) : line.state !== "you" && reason?.action && cosas.abiertas > 0 ? (
                <Link className="cor-btn secondary" to={reason.action.href.startsWith("#") ? ahoraLinks(p.slug).hash(reason.action.href) : reason.action.href} data-light-action>
                  {reason.action.label}
                </Link>
              ) : null;
            const r = rumboText(p);
            // PLA-I3-2: the meta line above the sentence; a paused project's Reanudar under it (the bar shows the state only).
            return (
              <Cabeza
                slug={p.slug}
                f={fraseOf(p, cosas, line, { now, companyPaused: paused, totals })}
                nudge={nudge}
                meta={{ m: metaLine(r.goal, r.date, r.missing), href: hojaHref("meta", p.slug) }}
                reanudar={pausaDe(paused, p.paused) === "proyecto" ? { title: p.title, href: hojaHref("reanudar", p.slug) } : undefined}
              />
            );
          }}
        />
      );
    }
    // PLA-I71-4: the skill store, inside Equipo.
    if (at.ver?.kind === "tienda")
      return (
        <TiendaPage
          p={p}
          selected={at.ver.skill}
          nav={<EquipoNav links={equipoLinks(p.slug)} at="store" />}
          links={{
            pick: (skill) => linkTo({ slug: p.slug, ver: { kind: "tienda", skill } }),
            tryIn: (agent, skill) => hrefOf({ slug: p.slug, ver: { kind: "miembro", agent }, extra: { ficha: "habilidades", skill } }),
            traer: linkTo({ slug: p.slug, ver: { kind: "traer" } }),
          }}
        />
      );
    // PLA-I71-6: the team catalog, adopting one, and the whole company in a file.
    if (at.ver?.kind === "equipos") return <EquiposPage p={p} nav={<EquipoNav links={equipoLinks(p.slug)} at="teams" />} links={equiposLinks(p.slug)} />;
    if (at.ver?.kind === "adoptar") return <AdoptarPage p={p} team={at.ver.team} links={equiposLinks(p.slug)} onDone={() => navigate(linkTo({ slug: p.slug, tab: "equipo" }))} />;
    if (at.ver?.kind === "compania") return <CompaniaPage links={equiposLinks(p.slug)} />;
    // PLA-I71-5: bring a skill from outside, reviewed before install.
    if (at.ver?.kind === "traer")
      return <TraerPage p={p} back={linkTo({ slug: p.slug, ver: { kind: "tienda", skill: null } })} onBrought={(skill) => navigate(linkTo({ slug: p.slug, ver: { kind: "tienda", skill } }))} />;
    if (at.tab === "equipo")
      return (
        <Equipo
          p={p}
          companyPaused={paused}
          focus={at.ver?.kind === "miembro" ? at.ver.agent : at.ver?.kind === "sumar" ? "sumar" : null}
          tab={fichaTabOf(new URLSearchParams(location.search).get("ficha"))}
          openSkill={new URLSearchParams(location.search).get("skill")}
          links={equipoLinks(p.slug)}
          motorDefault={company?.motor_default}
        />
      );
    // PLA-135: a doc opens across the whole page: from Ajustes («Docs del proyecto») it goes back there, from a thing's
    // ficha (or an old Archivo address) back to the list.
    if (at.ver?.kind === "doc" && (at.tab === "todo" || at.tab === "ajustes")) {
      const home = at.tab;
      return (
        <DocLector
          key={at.ver.id}
          p={p}
          id={at.ver.id}
          back={home}
          backTo={linkTo({ slug: p.slug, tab: home })}
          docTo={(id) => linkTo({ slug: p.slug, tab: home, ver: { kind: "doc", id } })}
          thingTo={(key) => linkTo({ slug: p.slug, ver: thingVer(key) })}
        />
      );
    }
    // PLA-I68-2: a PR opens from Camino's Propuestas and comes back there.
    if (at.tab === "camino" && at.ver?.kind === "pr") {
      const back = (
        <Link to={linkTo({ slug: p.slug, tab: "camino", ver: { kind: "camino", sec: "propuestas" } })} className="cor-strip-back cor-door-back" data-control="volver-camino">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9.5 3.5 5 8l4.5 4.5" />
          </svg>
          {tabName("camino")}
        </Link>
      );
      const arch = { slug: p.slug, tab: "camino" as Tab };
      return (
        <>
          {back}
          <Prs p={p} decisions={decisions} open={at.ver.n} links={{ pr: (n) => linkTo({ ...arch, ver: { kind: "pr", n } }), paso: (key) => linkTo({ slug: p.slug, tab: "todo", ver: { kind: "paso", key } }), entrega: (d) => linkTo({ slug: p.slug, tab: "todo", ver: { kind: "entrega", id: d.id } }) }} />
        </>
      );
    }
    if (at.tab === "hecho")
      return (
        <HechoView
          p={p}
          timeZone={timeZone}
          hasta={new URLSearchParams(location.search).get("hasta")}
          links={{
            iniciativa: (key) => linkTo({ slug: p.slug, tab: "todo", ver: { kind: "iniciativa", key } }),
            paso: (key) => linkTo({ slug: p.slug, tab: "todo", ver: { kind: "paso", key } }),
            antes: (hasta) => hrefOf({ slug: p.slug, tab: "hecho", extra: { hasta } }),
            ahora: linkTo({ slug: p.slug, tab: "hecho" }),
          }}
        />
      );
    if (at.tab === "motores")
      return (
        <>
        <EquipoNav links={equipoLinks(p.slug)} at="motores" />
        <Motores
          p={p}
          def={company?.motor_default}
          signIn={company?.claude_sign_in}
          planTo="/machine"
          acts={acts}
          now={now}
          timeZone={timeZone}
          onSave={async (save) => {
            const out = await api.saveMotores(save);
            void client.invalidateQueries({ queryKey: ["company"] });
            return out;
          }}
        />
        </>
      );
    if (at.tab === "maquinas")
      return (
        <>
          {/* PLA-I2-9: only for Plania itself, only when an agent's migration waits. */}
          <MigracionesPropias slug={p.slug} />
          <Maquinas
          p={p}
          focus={at.ver?.kind === "maq" ? at.ver.what : at.ver?.kind === "tabla" ? `tabla:${at.ver.name}` : null}
          onFocus={(what) => navigate(linkTo({ slug: p.slug, tab: "maquinas", ver: what ? (what.startsWith("tabla:") ? { kind: "tabla", name: what.slice(6) } : { kind: "maq", what }) : null }), { replace: true })}
          onPedir={(text) => navigate(hrefOf({ view: "pedir", extra: { p: p.slug, texto: text } }))}
          />
        </>
      );
    // NEWPROJ-6: the project's settings.
    // PLA-I3-2: Borrar opens from here (the same ?hoja=borrar sheet), no longer from the bar.
    if (at.tab === "ajustes") return <Ajustes p={p} borrarTo={hojaHref("borrar", p.slug)} docTo={(id) => linkTo({ slug: p.slug, tab: "ajustes", ver: { kind: "doc", id } })} />;
    // PLA-I66-2: the project's logo, its six faces and the repo's icon files.
    if (at.tab === "marca") return <Marca p={p} />;
    // PLA-I68-2: Camino, how the project's code reaches people.
    if (at.tab === "camino")
      return (
        <Camino
          p={p}
          sec={at.ver?.kind === "camino" ? at.ver.sec : "resumen"}
          hrefOf={(sec) => linkTo({ slug: p.slug, tab: "camino", ...(sec === "resumen" ? {} : { ver: { kind: "camino", sec } }) })}
          prHref={(n) => linkTo({ slug: p.slug, tab: "camino", ver: { kind: "pr", n } })}
          ajustesHref={(sec) => `${linkTo({ slug: p.slug, tab: "ajustes" })}#ajustes-${sec}`}
        />
      );
    return <NotYet what={w.thisOne} to={legacyHref(at)} />;
  };

  const body = () => {
    if (at.view === "piezas") return <Piezas />;
    if (at.view === "brief") return <BriefPlace now={now} timeZone={timeZone} />;
    if (comp.isError && !company) return <ReadError what={w.theCompany} onRetry={() => void comp.refetch()} />;
    if (!company) return <div className="cor-skel" style={{ margin: "22px 32px", flex: 1 }} role="status" aria-busy="true" aria-label={w.loadingCompany} />;
    if (at.slug) {
      if (!project)
        return (
          <div className="cor-empty">
            <p className="cor-text">{w.noProject(at.slug)}</p>
            <Btn kind="secondary" onClick={() => go({ view: "corriente" })}>
              {w.backToStream}
            </Btn>
          </div>
        );
      return (
        <div className="cor-project" data-project={project.slug}>
          <div className="cor-pbody">{projectBody(project)}</div>
        </div>
      );
    }
    if (at.view === "corriente")
      return (
        <Stream
          headline={headlineOf(lanes, decisions, paused)}
          totals={summaries.data ? totalsOf(listed, summaries.data) : null}
          lanes={lanes}
          links={streamLinks}
          onResume={(slug) => openHoja("reanudar", slug)}
          onNew={() => openHoja("nuevo")}
          resuming={resuming}
          pedir={<PedirBar projects={listed} disabled={paused} onAsk={ask} pedirTo={(slug) => pedirTo(slug)} />}
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
      return <Pedir projects={listedProjects(company.projects, new URLSearchParams(location.search).get("p"))} initial={new URLSearchParams(location.search).get("p")} initialText={new URLSearchParams(location.search).get("texto")} initialQuestion={new URLSearchParams(location.search).get("pregunta")} disabled={paused} onAsk={ask} onPictures={refresh} asistenteTo={hrefOf({ view: "asistente" })} pedidosTo={(slug) => linkTo({ slug })} />;
    if (at.view === "asistente")
      return (
        <Asistente
          threadId={company.asistente.thread_id}
          unread={company.asistente.unread ?? 0}
          waiting={company.asistente.state === "waiting_owner"}
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
    return <NotYet what={w.thisOne} to={legacyHref(at)} />;
  };

  // PLA-I3-2: the project view's one bar (the strip and the project's bar, merged).
  const bar = project ? (
    <ProjectBar
      slug={project.slug}
      title={project.title}
      lanes={lanes}
      tab={at.tab}
      href={(t) => linkTo({ slug: project.slug, tab: t })}
      projectHref={(slug) => linkTo({ slug, tab: at.tab })}
      back={hrefOf({ view: "corriente" })}
      team={teamWord(project.team.length)}
      open={project.work.open}
      paused={project.paused}
      pauseHref={hojaHref("pausar", project.slug)}
    />
  ) : null;

  return (
    <div className="cor" data-corriente={at.slug ? `proyecto:${at.tab}` : at.view}>
      <span className="cor-aura" aria-hidden />
      {bar ?? (
        <Head view={at.slug ? null : at.view} waiting={waiting} asistenteUnread={company?.asistente.unread ?? 0} now={now} timeZone={timeZone} pedirTo={pedirTo(null)} tocaTo={linkTo({ view: "tetoca" })} briefToca={briefToca} closeTo={at.view === "pedir" ? hrefOf({ view: "corriente" }) : undefined} />
      )}
      {project && pausaDe(paused, project.paused) === "ambas" ? (
        <div className="cor-notice amber" role="status" data-banner="paused-both">
          <span>{pausasWords().ambasAviso(project.title)}</span>
          <Btn kind="amber" small disabled={resumeBoth.isPending} onClick={() => resumeBoth.mutate(project)} data-control="reanudar-ambas">
            {resumeBoth.isPending ? w.resuming : pausasWords().ambasBoton(project.title)}
          </Btn>
        </div>
      ) : paused && (
        <div className="cor-notice amber" role="status" data-banner="paused">
          <span>{w.companyStopped}</span>
          <Btn kind="amber" small disabled={resumeCompany.isPending} onClick={() => resumeCompany.mutate()} data-control="reanudar-compania">
            {resumeCompany.isPending ? w.resuming : w.resumeCompany}
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
        // NEWPROJ-7: after a delete, back to the company (La corriente), where the project is gone.
        if (hoja.kind === "borrar") return <BorrarProyecto p={hp} onClose={closeHoja} onDone={() => (navigate(linkTo({ view: "corriente" }), { replace: true }), refresh())} />;
        const release = decisions.find((d) => d.project === hp.slug && d.kind === "release" && !d.state) ?? null;
        const first = decisions.find((d) => d.project === hp.slug && pending(d) && d.kind !== "release") ?? null;
        return <Publicar p={hp} release={release} first={first} firstTo={first ? (first.kind === "deliverable" || first.kind === "pr" ? linkTo({ slug: hp.slug, ver: { kind: "entrega", id: first.id } }) : hrefOf({ view: "tetoca", extra: { decision: first.id } })) : null} onClose={closeHoja} />;
      })()}
    </div>
  );
};
