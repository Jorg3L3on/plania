// PLA-I39: Compañía v4, the building (Design doc of PLA-IDEA11). /ceo is one building at night, seen from across the
// street: the sky says the moment, the roof ("Tu oficina") what waits on you, a floor per running project (its plate,
// one ask box, a window per teammate lit only while its run is live), the question hanging under the window of who
// asked it, the street with the door to a new floor, paused projects below the street. Any window, the project's
// name and the "+" window open the side page on the right (from the bottom on a phone); Asistente floats bottom right
// and opens there too. PLA-22: no clock; the building always shows now.
// Data: GET /api/company (decisions[] with asker, team[] with queue), GET /api/threads/:id,
// GET /api/company/projects/:slug for the plan and adding someone; POST /api/company/decisions/:id acts.
// URL: ?m=<slug>:<agent> a teammate, ?plan=<slug> the plan, ?add=<slug> adding someone, ?asistente the thread,
// ?decision=<id> scrolls to that decision, ?doc=<id> a doc, ?nuevo the new project dialog; ?p=<slug> and
// ?vista=<slug> redirect to /p/<slug>, ?equipo to Máquina.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { BlockError, StopBody } from "@/components/compania/parts";
import type { Steer } from "@/components/compania/timon";
import { toast } from "sonner";
import { ThreadPanel } from "@/components/compania/org";
import type { DecisionBusy } from "@/components/compania/v2";
import { AskBox } from "@/components/compania/edificio/ask";
import { AsistenteFab } from "@/components/compania/edificio/asistente";
import { Building, BuildingBlock } from "@/components/compania/edificio/building";
import { PublishBody, PublishDone, publishError } from "@/components/compania/edificio/publish";
import { AddPage, MemberHead, MemberSide, PlanPage, SidePage, memberTitle } from "@/components/compania/edificio/side";
import { NewProjectDone, NewProjectForm, PromptDocBody, type NewProjectState } from "@/components/compania/sheets";
import { useThread } from "@/components/compania/use-thread";
import { GoalDialog } from "@/components/goals/goal-dialog";
import type { Goal } from "@/components/goals/model";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ApiError, api, type Decision, type DecisionInput, type OrgProject } from "@/lib/api";
import { ceoRedirect, sheetOf, sheetSearch } from "@/lib/compania";
import { caption } from "@/lib/edificio";
import { byLight, plumbingLine } from "@/lib/org";
import { greeting } from "@/lib/greeting";

const dayLabel = (timeZone: string) =>
  new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  })
    .format(new Date())
    .replace(/^./, (l) => l.toUpperCase());

export const useWide = () => {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const onChange = () => setWide(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return wide;
};

// "hace 5 min" keeps moving without a refetch.
export const useMinute = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
};

const sheetClass = "max-h-[92svh] overflow-y-auto bg-background sm:max-h-none data-[side=right]:sm:max-w-[560px]";

export const CeoPage = () => {
  const location = useLocation();
  // Old links: the project sheet is now the project page, the Equipo sheet now lives in Máquina.
  const to = ceoRedirect(location.search);
  return to ? <Navigate to={to} replace /> : <Compania />;
};

const STEER_REFUSAL: Record<string, string> = {
  PROJECT_PAUSED: "El proyecto está en pausa: reanúdalo primero.",
  COMPANY_PAUSED: "La compañía está detenida.",
  RUN_NOT_LIVE: "Esa corrida ya terminó.",
  NOT_READY: "Ese ya no está listo.",
};

const DECISION_REFUSAL: Record<string, string> = {
  NOT_COMBINABLE: "Esas opciones no van juntas.",
  ALREADY_ACTED: "Ya actuaste sobre esto.",
  CHECKS_OPEN: "El ticket tiene checks abiertos.",
  NOT_IN_REVIEW: "Ya no está en revisión.",
  MERGE_FAILED: "No se pudo fusionar: revisa el PR.",
  BASE_NOT_SANDBOX: "El cambio no apunta a la copia de prueba.",
  OWNER_CODE: "Publicar se hace en Bandeja, con tu código.",
  INVALID_ACTION: "Eso no se puede hacer aquí. Recarga la página y vuelve a intentarlo.",
  PR_NOT_OPEN: "El PR está cerrado sin fusionar: pide cambios o que Taller abra otro.",
  NO_TICKET: "El mensaje no enlaza un ticket.",
};

const Compania = () => {
  const client = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const wide = useWide();
  const now = useMinute();
  const comp = useQuery({
    queryKey: ["company"],
    queryFn: api.company,
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
  const company = comp.data;
  const sheet = sheetOf(location.search);
  const [creating, setCreating] = useState<NewProjectState>({ kind: "idle" });

  const timeZone = company?.week.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { hello } = greeting(timeZone);
  const asistente = useThread(company?.asistente.thread_id, {
    who: "Asistente",
    invalidate: [["company"]],
  });
  const doc = useQuery({
    queryKey: ["prompt-doc", sheet?.kind === "doc" ? sheet.id : ""],
    queryFn: () => api.promptDoc(sheet?.kind === "doc" ? sheet.id : ""),
    enabled: sheet?.kind === "doc",
  });

  const projects = useMemo(() => [...(company?.projects ?? [])].sort(byLight), [company]);
  const openSheet = (search: string) => navigate({ pathname: "/ceo", search });
  const closeSheet = () => navigate({ pathname: "/ceo", search: "" }, { replace: true });
  // PLA-I39-6: the side page. Its project and teammate come from the company read; plan and add read the project.
  const sideProject = sheet && (sheet.kind === "member" || sheet.kind === "plan" || sheet.kind === "add") ? (company?.projects.find((p) => p.slug === sheet.slug) ?? null) : null;
  const sideMember = sheet?.kind === "member" ? (sideProject?.team.find((m) => m.agent === sheet.agent) ?? null) : null;
  const detail = useQuery({
    queryKey: ["company-project", sideProject?.slug ?? ""],
    queryFn: () => api.companyProject(sideProject!.slug),
    enabled: !!sideProject && (sheet?.kind === "plan" || sheet?.kind === "add"),
  });
  const [added, setAdded] = useState<string | null>(null);
  // PLA-I39-7: floors whose ask box has text: their PO's window says "Recibiría tu pedido".
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const opener = useRef<HTMLElement | null>(null);
  // The side page last open, so closing (which clears the address first) still knows what to focus.
  const lastSide = useRef(sheet);
  if (sheet && (sheet.kind === "member" || sheet.kind === "plan" || sheet.kind === "add")) lastSide.current = sheet;
  const addMember = useMutation({
    mutationFn: (v: { slug: string; template: string }) => api.addToTeam(v.slug, v.template),
    onSuccess: (r, v) => {
      setAdded(detail.data?.templates.find((t) => t.slug === v.template)?.title ?? r.role);
      void client.invalidateQueries({ queryKey: ["company"] });
      void client.invalidateQueries({ queryKey: ["company-project", v.slug] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? `No se pudo sumar (${e.code}).` : "No se pudo. Si la Mac está dormida, intenta al despertar."),
  });

  // Te toca: the result is written in the row at once; the next read keeps it (acted rows stay 24 h).
  const [acted, setActed] = useState<Record<string, Decision>>({});
  // PLA-I36-8: words handed back to a card's box by Cambiar algo, per project.
  const [prefill, setPrefill] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<DecisionBusy>(null);
  // PLA-I39-5: ?decision=<id> still opens that decision: where it hangs, else from its roof chip.
  const openDecision = new URLSearchParams(location.search).get("decision");
  const [roofOpen, setRoofOpen] = useState<string | null>(openDecision);
  useEffect(() => {
    if (!openDecision || !company) return;
    const el = document.querySelector(`[data-bubble="${CSS.escape(openDecision)}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [openDecision, company]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const decisions = useMemo(() => (company?.decisions ?? []).map((d) => acted[d.id] ?? d), [company, acted]);
  const act = useMutation({
    mutationFn: (v: { d: Decision; input: DecisionInput; key: string }) => api.actDecision(v.d.id, v.input),
    onMutate: (v) => {
      setBusy({ id: v.d.id, key: v.key });
      setErrors((e) => ({ ...e, [v.d.id]: "" }));
    },
    onSuccess: (r, v) => {
      // Volver a probar leaves the delivery open: the live row (with its run) shows, not a frozen acted copy.
      if (v.input.action === "verificar") {
        void client.invalidateQueries({ queryKey: ["company"] });
        return;
      }
      setActed((a) => ({
        ...a,
        [v.d.id]: r.decision ?? { ...v.d, state: r.state, actions: [] },
      }));
      // PLA-I36-8: Cambiar algo hands the order's words back to its card's box.
      if (v.input.action === "cambiar" && v.d.project && typeof r.state.result.text === "string")
        setPrefill((x) => ({
          ...x,
          [v.d.project!]: r.state.result.text as string,
        }));
      void client.invalidateQueries({ queryKey: ["company"] });
      void client.invalidateQueries({ queryKey: ["thread"] });
    },
    onError: (e, v) =>
      setErrors((x) => ({
        ...x,
        // A file step's refusal carries its own reason (GitHub's, or why Plania will not write that file).
        [v.d.id]:
          e instanceof ApiError
            ? (DECISION_REFUSAL[e.code] ?? ((e.code.startsWith("FILE_") || e.code === "NOT_WOKEN" || e.code === "NO_OWNER") && typeof e.detail.hint === "string" ? e.detail.hint : `No se pudo (${e.code}). Recarga la página: puede que ya haya cambiado.`))
            : "No se pudo. Si la Mac está dormida, intenta al despertar.",
      })),
    onSettled: () => setBusy(null),
  });
  // PLA-I36-4: Fijar opens the goal dialog for that project's goal (the placeholder is edited, not kept).
  const [fijar, setFijar] = useState<OrgProject | null>(null);
  const fijarGoal: Goal | null =
    fijar?.rumbo?.goal_id != null
      ? {
          id: fijar.rumbo.goal_id,
          title: fijar.rumbo.goal ?? "",
          why: fijar.rumbo.why,
          status: "active",
          target_on: fijar.rumbo.target_on,
          position: 0,
          project: fijar.slug,
          parent_id: null,
          progress: { done: 0, total: 0 },
          initiatives: [],
          children: [],
        }
      : null;
  // PLA-I36-6/8/9: steering from the card.
  const [steerBusy, setSteerBusy] = useState<string | null>(null);
  const [pausing, setPausing] = useState<OrgProject | null>(null);
  const refresh = () => void client.invalidateQueries({ queryKey: ["company"] });
  const quietly = async (key: string, fn: () => Promise<unknown>) => {
    setSteerBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof ApiError ? (STEER_REFUSAL[e.code] ?? `No se pudo (${e.code}).`) : "No se pudo. Si la Mac está dormida, intenta al despertar.");
    } finally {
      setSteerBusy(null);
      refresh();
    }
  };
  const steer: Steer = {
    onAsk: async (slug, input) => {
      const r = await api.askProject(slug, input);
      setPrefill((x) => ({ ...x, [slug]: "" }));
      refresh();
      return r;
    },
    onPickNext: (slug, key) => void quietly(`next-${key}`, () => api.pickNext(slug, key)),
    onPause: (p) => setPausing(p),
    onRun: (action, id) => void quietly(id, () => (action === "stop" ? api.stopRun(id) : api.resumeRun(id))),
    onNote: (slug, key, text) =>
      void quietly(`note-${key}`, async () => (await api.noteTask(slug, key, text), toast("Se lo dijiste; lo lee en su siguiente paso"))),
    onCancelOrder: (slug, key) => void quietly(`cancel-${key}`, () => api.cancelOrder(slug, key)),
    onOptions: (slug, input) => void quietly(`options-${slug}`, () => api.setProjectOptions(slug, input)),
    prefill,
    busy: steerBusy,
  };
  // PLA-I40-4: the Ahora band's calls. The floor reads again right after, so the band changes without a reload.
  const [nowBusy, setNowBusy] = useState<string | null>(null);
  const START_WORDS: Record<string, string> = {
    queued: "Quedó en fila: arranca en cuanto haya lugar.",
    busy: "Ya está trabajando.",
    idle: "No tiene nada listo para empezar.",
    held: "No pudo arrancar: el uso de Claude está al límite.",
    fail: "No pudo arrancar. Míralo en Máquina.",
  };
  const nowActs = {
    busy: nowBusy,
    onElapsed: refresh,
    onAuto: (slug: string, on: boolean) => {
      setNowBusy(`${slug}:auto`);
      void api
        .setProjectOptions(slug, { auto_accept: on })
        .then(() => toast(on ? "Las entregas con pruebas en verde se aceptan solas." : "Vuelves a aceptar cada entrega."))
        .catch((e) => toast.error(e instanceof ApiError ? (STEER_REFUSAL[e.code] ?? `No se pudo (${e.code}).`) : "No se pudo. Si la Mac está dormida, intenta al despertar."))
        .finally(() => {
          setNowBusy(null);
          refresh();
        });
    },
    onResend: (slug: string, key: string) => {
      setNowBusy(`${slug}:request`);
      void api
        .resendRequest(slug, key)
        .then((r) => toast(r.wake === "queued" ? "Se lo mandaste al PO otra vez." : r.wake === "busy" ? "El PO está ocupado; lo toma al terminar." : "Los avisos están apagados; lo ve en su próximo turno."))
        .catch((e) => toast.error(e instanceof ApiError ? (STEER_REFUSAL[e.code] ?? `No se pudo (${e.code}).`) : "No se pudo. Si la Mac está dormida, intenta al despertar."))
        .finally(() => {
          setNowBusy(null);
          refresh();
        });
    },
    onClose: (slug: string, key: string) => {
      setNowBusy(`${slug}:request`);
      void api
        .cancelOrder(slug, key)
        .then(() => toast("Pedido cerrado."))
        .catch((e) => toast.error(e instanceof ApiError ? (STEER_REFUSAL[e.code] ?? `No se pudo (${e.code}).`) : "No se pudo. Si la Mac está dormida, intenta al despertar."))
        .finally(() => {
          setNowBusy(null);
          refresh();
        });
    },
    onStart: (slug: string, agent: string, pastGuard: boolean) => {
      setNowBusy(`${slug}:start`);
      void api
        .startTeammate(slug, agent, pastGuard)
        .then((r) => {
          if (!r.started) toast(START_WORDS[r.reason] ?? "No arrancó.");
        })
        .catch((e) => toast.error(e instanceof ApiError ? (STEER_REFUSAL[e.code] ?? `No se pudo (${e.code}).`) : "No se pudo. Si la Mac está dormida, intenta al despertar."))
        .finally(() => {
          setNowBusy(null);
          refresh();
        });
    },
    onPlan: (slug: string, text: string) => {
      setNowBusy(`${slug}:plan`);
      void api
        .askProject(slug, { text, now: true })
        .then(() => toast("Se lo pediste al PO."))
        .catch((e) => toast.error(e instanceof ApiError ? (STEER_REFUSAL[e.code] ?? `No se pudo (${e.code}).`) : "No se pudo. Si la Mac está dormida, intenta al despertar."))
        .finally(() => {
          setNowBusy(null);
          refresh();
        });
    },
  };
  const pause = useMutation({
    mutationFn: (slug: string) => api.setProjectPaused(slug, true),
    onSettled: () => {
      setPausing(null);
      refresh();
    },
  });
  const [resuming, setResuming] = useState<string | null>(null);
  // PLA-23: Publicar from a floor's plate or its roof chip: the release of that project, the owner's code, the ship route.
  // publishing keeps the project while the sheet slides closed, so it never flashes an empty name.
  const [publishing, setPublishing] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const liveRelease = publishing ? (decisions.find((d) => d.kind === "release" && d.project === publishing && !d.state) ?? null) : null;
  // What the owner clicked on: kept while it publishes and after, when the floor no longer lists it.
  const [shipped, setShipped] = useState<typeof liveRelease>(null);
  const [publishSince, setPublishSince] = useState<number | null>(null);
  const publishRelease = shipped ?? liveRelease;
  const publishTitle = publishing ? (company?.projects.find((p) => p.slug === publishing)?.title ?? publishing) : "";
  const openPublish = (slug: string | null | undefined) => {
    if (!slug) return;
    publish.reset();
    setShipped(null);
    setPublishSince(null);
    setPublishing(slug);
    setPublishOpen(true);
  };
  const publish = useMutation({
    mutationFn: (v: { slug: string }) => api.shipRelease(v.slug),
    onMutate: () => {
      setShipped(liveRelease);
      setPublishSince(Date.now());
    },
    // The sheet stays open on success and says what went out (PublishDone); a toast too, if it was closed meanwhile.
    onSuccess: (_r, v) => {
      toast.success(`${publishTitle || v.slug}: publicado. Ya está en la versión principal.`);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["company"] });
      void client.invalidateQueries({ queryKey: ["inbox"] });
    },
  });

  const resume = useMutation({
    mutationFn: (slug: string) => api.setProjectPaused(slug, false),
    onMutate: (slug) => setResuming(slug),
    onSettled: () => {
      setResuming(null);
      void client.invalidateQueries({ queryKey: ["company"] });
    },
  });

  const createProject = useMutation({
    mutationFn: (input: { name: string; goal: string }) => api.createCompanyProject(input),
    onMutate: () => setCreating({ kind: "busy" }),
    onSuccess: (result, input) => {
      setCreating({ kind: "done", result, name: input.name, goal: input.goal });
      void client.invalidateQueries({ queryKey: ["company"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) setCreating({ kind: "missing" });
      else
        setCreating({
          kind: "error",
          message: e instanceof ApiError ? `No se pudo crear (${e.code}).` : "No se pudo crear el proyecto.",
        });
    },
  });
  const onNew = () => {
    setCreating({ kind: "idle" });
    openSheet("?nuevo");
  };

  return (
    <div className="mx-auto grid w-full max-w-[1380px] min-w-0 gap-5">
      {company?.company.paused && (
        <p role="status" data-banner="paused" className="rounded-[16px] bg-surface-sunken px-4 py-2.5 text-sm ring-1 ring-foreground/15">
          La compañía está detenida: nada arranca. Se reanuda en Máquina.
        </p>
      )}

      {/* PLA-I39-3: the building in place of the 360 px column and the cards grid. */}
      <BuildingBlock loading={comp.isPending} error={comp.isError && !company} onRetry={() => void comp.refetch()}>
        {company && (
          <Building
            company={company}
            decisions={decisions}
            now={now}
            timeZone={timeZone}
            hello={company.projects.length === 0 ? "Hola" : hello}
            day={dayLabel(timeZone)}
            meta={
              <>
                <span className="edi-eyebrow">Compañía</span>
                <Link to="/machine" className="edi-mini" data-plumbing>
                  Plomería · {plumbingLine(company.plumbing).text}
                </Link>
              </>
            }
            onNew={onNew}
            onFijar={setFijar}
            onResume={(slug) => resume.mutate(slug)}
            resuming={resuming}
            acts={{ now, busy, errors, opened: openDecision, onAct: (d, input, key) => act.mutate({ d, input, key }), onPublish: (d) => openPublish(d.project) }}
            onPublish={(p) => openPublish(p.slug)}
            roofOpen={roofOpen}
            onChip={(d) => setRoofOpen((x) => (x === d.id ? null : d.id))}
            onOpen={(slug, m, el) => {
              opener.current = el;
              openSheet(sheetSearch({ kind: "member", slug, agent: m.agent }));
            }}
            onPlan={(p, el) => {
              opener.current = el;
              openSheet(sheetSearch({ kind: "plan", slug: p.slug }));
            }}
            askFor={(p) => (
              <AskBox
                key={p.slug}
                project={p}
                prefill={prefill[p.slug]}
                disabled={company.company.paused}
                wide={wide}
                onAsk={(slug, input) => steer.onAsk(slug, { text: input.text, now: input.now })}
                onTyping={(slug, on) => setTyping((t) => (!!t[slug] === on ? t : { ...t, [slug]: on }))}
              />
            )}
            typing={typing}
            nowActs={nowActs}
            onAdd={(slug, el) => {
              opener.current = el;
              setAdded(null);
              openSheet(sheetSearch({ kind: "add", slug }));
            }}
          />
        )}
      </BuildingBlock>

      {/* PLA-I39-7: Asistente floats; room so it never covers the last floor's controls. */}
      {company && (
        <>
          <div className="edi-fab-room" aria-hidden />
          <AsistenteFab
            unread={company.asistente.unread ?? 0}
            waiting={company.asistente.state === "waiting_jorge"}
            onOpen={(el) => {
              opener.current = el;
              openSheet(sheetSearch({ kind: "asistente" }));
            }}
          />
        </>
      )}
      <SidePage
        open={sheet?.kind === "asistente" && !!company}
        wide={wide}
        title="Asistente"
        description="Tu canal con la compañía. Pregunta o pide; va al PO correcto."
        onClose={closeSheet}
        returnTo={() => (opener.current?.isConnected ? opener.current : document.querySelector<HTMLElement>('[data-control="asistente"]'))}
      >
        <ThreadPanel
          title="Asistente"
          thread={asistente.thread}
          loading={asistente.loading}
          error={asistente.error}
          onRetry={asistente.onRetry}
          project={null}
          now={now}
          timeZone={timeZone}
          placeholder="Dile a Asistente…"
          send={asistente.send}
          onSend={asistente.onSend}
          busy={asistente.busy}
          actionError={asistente.actionError}
          onAction={asistente.onAction}
          expanded
          onToggle={asistente.onToggle}
          shown={asistente.shown}
          onMore={asistente.onMore}
          className="ring-0 p-0"
        />
      </SidePage>

      {/* PLA-I39-6: the side page: a teammate, the plan, adding someone. */}
      <SidePage
        open={!!sideProject && (sheet?.kind !== "member" || !!sideMember)}
        wide={wide}
        title={sideMember && sideProject ? memberTitle(sideMember, sideProject) : sheet?.kind === "add" ? `Sumar a ${sideProject?.title ?? ""}` : (sideProject?.title ?? "")}
        description={sideMember ? caption(sideMember, now, { companyPaused: company?.company.paused }).doing : sheet?.kind === "add" ? "Un puesto más en el equipo, con su ventana." : "El plan del proyecto"}
        head={sideMember ? <MemberHead m={sideMember} companyPaused={company?.company.paused} /> : undefined}
        onClose={closeSheet}
        returnTo={() => {
          // What opened it; after a reload, the window or the name it belongs to.
          if (opener.current?.isConnected) return opener.current;
          const last = lastSide.current;
          if (last?.kind === "member") return document.querySelector<HTMLElement>(`button[data-agent="${CSS.escape(last.agent)}"]`);
          if (last && "slug" in last) return document.querySelector<HTMLElement>(`[data-floor="${CSS.escape(last.slug)}"] [data-control="${last.kind === "add" ? "sumar" : "plan"}"]`);
          return null;
        }}
      >
        {sideProject && sideMember && <MemberSide key={sideMember.agent} project={sideProject} member={sideMember} now={now} steer={steer} />}
        {sideProject && sheet?.kind === "plan" && (
          <PlanPage project={sideProject} sheet={detail.data} loading={detail.isPending} error={detail.isError} onRetry={() => void detail.refetch()} now={now} steer={steer} onFijar={setFijar} />
        )}
        {sideProject && sheet?.kind === "add" && (
          <AddPage
            templates={detail.data?.templates}
            loading={detail.isPending}
            busy={addMember.isPending ? (addMember.variables?.template ?? null) : null}
            added={added}
            onAdd={(template) => addMember.mutate({ slug: sideProject.slug, template })}
          />
        )}
      </SidePage>

      {/* A doc linked from a message or a role row */}
      <Sheet open={sheet?.kind === "doc"} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent side={wide ? "right" : "bottom"} className={sheetClass}>
          <SheetHeader className="pr-10">
            <SheetTitle className="font-display text-xl font-extrabold tracking-tight">{doc.data?.title ?? "Doc"}</SheetTitle>
            <SheetDescription className="sr-only">Documento</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-8">
            {doc.data ? (
              <PromptDocBody doc={doc.data} />
            ) : doc.isError ? (
              <BlockError what="el doc" onRetry={() => void doc.refetch()} />
            ) : (
              <div className="h-40 animate-pulse rounded-xl bg-muted" />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <GoalDialog
        open={fijar !== null}
        goal={fijarGoal}
        fixedProject={fijar?.slug}
        projects={[]}
        parents={[]}
        onOpenChange={(open) => !open && setFijar(null)}
        onSaved={() => void client.invalidateQueries({ queryKey: ["company"] })}
      />

      {/* PLA-23: Publicar, from a floor's plate or its roof chip. */}
      <Sheet open={publishOpen} onOpenChange={(open) => !open && !publish.isPending && setPublishOpen(false)}>
        <SheetContent side="bottom" className="mx-auto max-h-[85svh] w-full max-w-xl overflow-y-auto rounded-t-[22px] bg-background">
          <SheetHeader className="pr-10">
            <SheetTitle className="font-display text-2xl font-extrabold tracking-tight">Publicar {publishTitle}</SheetTitle>
            <SheetDescription>Lo que ya aceptaste en la copia de prueba pasa a la versión principal.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-8">
            {publishing && publishRelease?.release && publish.isSuccess ? (
              <PublishDone title={publishTitle} release={publishRelease.release} result={publish.data} onClose={() => setPublishOpen(false)} />
            ) : publishing && publishRelease?.release ? (
              <PublishBody
                title={publishTitle}
                release={publishRelease.release}
                busy={publish.isPending}
                since={publishSince}
                error={publish.isError ? (publish.error instanceof ApiError ? publishError(publish.error.code, publish.error.detail) : "No se pudo. Si la Mac está dormida, intenta al despertar.") : null}
                onPublish={() => publish.mutate({ slug: publishing })}
                onCancel={() => setPublishOpen(false)}
              />
            ) : (
              <p className="text-sm text-muted-foreground" data-publish-empty>
                Ya no hay nada por publicar en {publishTitle}.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* PLA-I36-6: Pausar from the card, with the confirmation the project page uses. */}
      <Sheet open={pausing !== null} onOpenChange={(open) => !open && setPausing(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[85svh] w-full max-w-xl overflow-y-auto rounded-t-[22px] bg-background">
          <SheetHeader className="pr-10">
            <SheetTitle className="font-display text-2xl font-extrabold tracking-tight">¿Pausar {pausing?.title}?</SheetTitle>
            <SheetDescription>Se puede deshacer: reanudas cuando quieras.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-8">
            {pausing && (
              <StopBody
                scope={{
                  kind: "project",
                  slug: pausing.slug,
                  title: pausing.title,
                }}
                runs={[]}
                projectTitle={() => pausing.title}
                busy={pause.isPending}
                onCancel={() => setPausing(null)}
                onConfirm={() => pause.mutate(pausing.slug)}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* New project (4a / 4b) */}
      <Dialog open={sheet?.kind === "nuevo"} onOpenChange={(open) => !open && closeSheet()}>
        <DialogContent className="bg-background sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-extrabold tracking-tight">
              {creating.kind === "done" ? `${creating.name} está listo` : "Nuevo proyecto"}
            </DialogTitle>
            <DialogDescription>
              {creating.kind === "done" ? "Llega con su equipo: PO, Research, Artist y Taller." : "Un nombre y una meta. Lo demás tiene valores por defecto."}
            </DialogDescription>
          </DialogHeader>
          {creating.kind === "done" ? (
            <NewProjectDone state={creating} onOpen={(slug) => navigate(`/p/${encodeURIComponent(slug)}`)} onClose={closeSheet} />
          ) : (
            <NewProjectForm state={creating} onSubmit={(input) => createProject.mutate(input)} onCancel={closeSheet} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
