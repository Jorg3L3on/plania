import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, Loader2Icon, PlayIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { Link } from "react-router";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { toast } from "sonner";
import { ActionButton } from "@/components/arc/action-button/action-button";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { CopyCommand } from "@/components/copy-command";
import { useAgregarProyecto } from "@/components/agregar/use-agregar-proyecto";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FaltaView } from "@/pages/falta";
import { api } from "@/lib/api";
import { githubAvisoWords } from "@/lib/github-aviso";
import { HOJAS_WORDS } from "@/lib/hojas-words";
import { words } from "@/lib/i18n";
import { irHref } from "@/components/listo";
import { listoGrupos, listoIrA, listoLugares, listoSeccionWords } from "@/lib/listo";
import { META_MAX, NOMBRE_MAX, agregarError, agregarWords, codigoOpciones } from "@/lib/nuevo-proyecto";
import { PASOS_ASISTENTE, aReanudar, alcanzable, asistenteHecho, pasoInicial, pasosDe, pedidoSugerido, primeraEntregaWords, puedeSeguir, requisitosFase, type GuiaRead, type PasoAsistente } from "@/lib/primera-entrega";
import { cn } from "@/lib/utils";
import styles from "./guia-wizard.module.css";

// PLA-181: the first-delivery wizard, the guide's first four steps in three (requisitos, proyecto, iniciar: start the project and
// send its first task), after the form-wizard-dialog pattern. A compact, centered stepper whose steps open once the
// required ones before them are done, one step at a time, Atrás and the step's own action at the foot, and no closing on a stray click outside (Escape and the close button still close).
// Steps 5 and 6 wait for the team and stay on the card (guia-primera-entrega.tsx). It never opens on its own.

// Motion. The wizard is seen a handful of times, so it may take a little care, but never hold the owner up: entrances
// ease out under 250ms, exits are quicker, and only opacity, transform and a 2px blur move. Reduced motion keeps the
// fades and drops every movement. Entrances of rows and fields are CSS (guia-wizard.module.css).
const entra = { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] } as const;
const sale = { duration: motionTokens.duration.exit, ease: [...motionTokens.ease.standard] } as const;
const blur = `blur(${motionTokens.blur.subtle}px)`;

/** A step's body slides in from the side it comes from (forward from the right, Atrás from the left) and leaves the other way. */
function pasoMotion(reducido: boolean): Variants {
  return {
    entra: (dir: number) => (reducido ? { opacity: 0 } : { opacity: 0, x: dir * 20, filter: blur }),
    queda: { opacity: 1, x: 0, filter: "blur(0px)", transition: entra, transitionEnd: { filter: "none" } },
    sale: (dir: number) => (reducido ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, x: dir * -12, filter: blur, transition: sale }),
  };
}

/** A small swap in place (a number for a tick, one label for another): the new one grows in from 0.6, never from nothing. */
function swap(reducido: boolean) {
  return reducido
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.1 } }
    : {
        initial: { opacity: 0, scale: 0.6, filter: blur },
        animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
        exit: { opacity: 0, scale: 0.6, filter: blur, transition: sale },
        transition: { ...motionTokens.spring.snappy, opacity: entra, filter: entra },
      };
}

function Stepper({ actual, pasos, onIr, bloqueado }: { actual: number; pasos: ReturnType<typeof pasosDe>; onIr: (i: number) => void; bloqueado: boolean }) {
  const w = primeraEntregaWords().asistente;
  const reducido = useReducedMotion() ?? false;
  const s = swap(reducido);
  return (
    // justify-around spreads the steps; one line behind them joins them, inset so its ends stay under the first and the
    // last step, and each step masks it with the dialog's background (bg-popover) so it only shows in the gaps.
    <ol className="relative flex items-center justify-around" aria-label={w.titulo} data-stepper>
      <span aria-hidden className="absolute inset-x-[12%] top-1/2 h-px -translate-y-1/2 bg-border" />
      {/* How far along: the line fills up to the current step, moving on screen, so ease-in-out. */}
      <motion.span
        aria-hidden
        className="absolute inset-x-[12%] top-1/2 h-px -translate-y-1/2 origin-left bg-primary"
        initial={false}
        animate={{ scaleX: actual / (PASOS_ASISTENTE.length - 1) }}
        transition={{ duration: reducido ? 0 : motionTokens.duration.considered, ease: [...motionTokens.ease.inOut] }}
        data-stepper-avance
      />
      {PASOS_ASISTENTE.map((id, i) => {
        const hecho = asistenteHecho(id, pasos);
        const aqui = i === actual;
        // A step opens once every required one before it is done; the requirements are optional and never hold it.
        const abre = !aqui && !bloqueado && alcanzable(i, pasos);
        return (
          <li key={id} className="relative min-w-0 bg-popover px-2" data-paso-asistente={id} data-hecho={hecho ? "1" : undefined}>
            <button
              type="button"
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-md p-1 text-left outline-none transition-[background-color,scale,translate] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                abre ? "cursor-pointer active:scale-[0.97] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-foreground/5" : "cursor-default",
                !aqui && !abre && "opacity-50",
              )}
              aria-current={aqui ? "step" : undefined}
              disabled={!abre}
              onClick={() => onIr(i)}
              data-control={`guia-ir-${id}`}
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold transition-[background-color,color,box-shadow] duration-200 ease-out motion-reduce:transition-none",
                  aqui ? "bg-primary text-primary-foreground ring-4 ring-primary/15" : hecho ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-foreground/10 text-muted-foreground",
                )}
              >
                {/* A step done swaps its number for a tick in place; both share the circle's one cell. */}
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span key={hecho && !aqui ? "hecho" : "numero"} className="col-start-1 row-start-1 grid place-items-center" {...s}>
                    {hecho && !aqui ? <CheckIcon className="size-3.5" /> : i + 1}
                  </motion.span>
                </AnimatePresence>
              </span>
              {/* At phone width only the current step keeps its name; the others are their number or tick. */}
              <span className={cn("truncate text-xs transition-colors duration-200", aqui ? "font-medium text-foreground" : "hidden text-muted-foreground sm:inline")}>{w.etiquetas[id]}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Step 1: the environment requirements. «Revisar» shows the same list as the machine page (/machine/falta) in place:
 * the reading of the last ten minutes when there is one, else a new check (about ten seconds, it tries Claude). The
 * button then moves under the list as «Reintentar», which always checks again. Reading it ticks the guide's step.
 */
// mostrar lives in the wizard: going to step 2 and back keeps the list and «Reintentar»; closing the wizard resets it.
// One state at a time (requisitosFase). While a check runs only its line shows: no list, no button, so nothing can be
// pressed twice and nothing reads as a failure. The list and «Reintentar» come back when it ends; a failure shows only
// once nothing is running.
function PasoRequisitos({ mostrar, setMostrar }: { mostrar: boolean; setMostrar: (v: boolean) => void }) {
  const client = useQueryClient();
  const w = primeraEntregaWords().asistente;
  // The list the machine page also reads (same cache): never fetched here on its own, only by a press.
  const lectura = useQuery({ queryKey: ["machine-check"], queryFn: () => api.machineCheck(), enabled: false }).data;
  const [corriendo, setCorriendo] = useState(false);
  const [fallo, setFallo] = useState(false);
  const revisar = async (fresh: boolean) => {
    if (corriendo) return;
    setMostrar(true);
    setCorriendo(true);
    setFallo(false);
    try {
      // First press: the reading of the last ten minutes when there is one; «Reintentar»: always a new check.
      client.setQueryData(["machine-check"], await api.machineCheck(fresh));
      void client.invalidateQueries({ queryKey: ["guia"] });
    } catch {
      setFallo(true);
    } finally {
      setCorriendo(false);
    }
  };
  const fase = requisitosFase({ pedido: mostrar, corriendo, hayLectura: !!lectura, fallo });
  if (fase === "revisando" || fase === "revisando_otra_vez") {
    return (
      <div className={cn("flex items-center gap-3 rounded-lg border p-3", styles.aparece)} role="status" aria-live="polite" data-requisitos data-fase={fase} data-revisando>
        <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{fase === "revisando" ? w.revisandoPrimera : w.revisandoOtraVez}</p>
      </div>
    );
  }
  const boton = (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="self-start justify-self-start transition-transform active:scale-[0.97] motion-reduce:transition-none"
      onClick={() => void revisar(fase !== "sin_revisar")}
      data-control={fase === "sin_revisar" ? "guia-revisar" : "guia-reintentar"}
      data-fase={fase}
    >
      <RefreshCwIcon className="size-4" />
      {fase === "sin_revisar" ? w.revisar : w.reintentar}
    </Button>
  );
  if (fase === "sin_revisar") return boton;
  return (
    <div className="grid gap-3" data-requisitos data-fase={fase}>
      {/* The reading lands row by row: the headline, each requirement, the time it was read. */}
      {lectura ? (
        <div className={styles.lectura}>
          <FaltaView reading={lectura} againButton={false} />
        </div>
      ) : null}
      {fase === "error" ? (
        <p className={cn("rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm", styles.aparece)} role="alert" data-revisar-fallo>
          {w.revisarFallo}
        </p>
      ) : null}
      {boton}
    </div>
  );
}

/** Step 2: «Agregar un proyecto» in the app's look, the same state and rules as Compañía's sheet. */
function PasoProyecto({ r, a, onEjemplo, ejemploBusy }: { r: GuiaRead; a: ReturnType<typeof useAgregarProyecto>; onEjemplo: () => void; ejemploBusy: boolean }) {
  const w = primeraEntregaWords();
  const h = words(HOJAS_WORDS);
  const ag = agregarWords();
  const slug = a.make.data?.slug ?? r.proyecto?.slug ?? null;
  const listo = useQuery({ queryKey: ["readiness", slug], queryFn: () => api.readiness(slug!), enabled: !!slug });
  if (r.proyecto || a.make.data) {
    // What is left to set up, the ones that stop work first; none of it holds the wizard back.
    const pendientes = listo.data ? (listoGrupos(listo.data.items).find((g) => g.key === "falta")?.lineas ?? []) : [];
    if (pendientes.length === 0 || !slug) return null;
    const alguno = pendientes.some((l) => l.para);
    // Where they are fixed: Ajustes, Despliegue (PLA-132: the code's folder and repository), or both, each a link to the
    // first missing item's section there, the way the readiness list links them.
    const lw = listoSeccionWords();
    const lugares = listoLugares(listo.data!.items).map((tab) => {
      const item = pendientes.map((l) => listoIrA(l.id)).find((to) => to?.tab === tab)!;
      return (
        <Link key={tab} to={irHref(slug, item)} className="font-medium text-foreground underline underline-offset-2" data-control={`guia-${tab}`}>
          {lw.lugar[tab]}
        </Link>
      );
    });
    return (
      <div className="my-auto grid gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm" role="status" data-pendientes={pendientes.length}>
        <p className="flex items-center gap-2 font-medium">
          <TriangleAlertIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          {w.asistente.pendientes(pendientes.length)}
        </p>
        <ol className="grid list-decimal gap-1 pl-6" data-filas>
          {pendientes.map((l) => (
            <li key={l.id} data-pendiente={l.id}>
              {l.titulo}
              {l.para ? <span className="ml-2 text-xs font-medium text-destructive">({w.asistente.impide})</span> : null}
            </li>
          ))}
        </ol>
        <p className="text-muted-foreground" data-lugares={lugares.length}>
          {lugares.length === 0 ? (
            alguno ? w.asistente.pendientesAlgunoSolo : w.asistente.pendientesNingunoSolo
          ) : (
            <>
              {alguno ? w.asistente.pendientesAlguno : w.asistente.pendientesNinguno} {lugares[0]}
              {lugares[1] ? (
                <>
                  {" "}
                  {w.asistente.o} {lugares[1]}
                </>
              ) : null}
              .
            </>
          )}
        </p>
      </div>
    );
  }
  const opcion = codigoOpciones().find((o) => o.key === a.codigo);
  return (
    <form
      id="guia-agregar"
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        a.send(a.sinRama);
      }}
    >
      <div className="grid gap-2">
        <span className="text-sm font-medium">{h.whereCode}</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={h.whereCodeLabel}>
          {codigoOpciones().map((o) => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={a.codigo === o.key}
              onClick={() => a.elegir(o.key)}
              data-codigo-opcion={o.key}
              className={cn(
                "h-11 rounded-md border px-3 text-sm font-medium transition-[color,background-color,border-color,box-shadow,scale,translate] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none sm:h-9",
                a.codigo === o.key ? "border-foreground/70 bg-foreground/10 text-foreground ring-1 ring-foreground/40" : "text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        {/* Keyed by the option, so the hint fades in again when the choice changes. */}
        {opcion ? (
          <p key={opcion.key} className={cn("text-xs text-muted-foreground", styles.aparece)}>
            {opcion.hint}
          </p>
        ) : null}
      </div>

      {a.codigo === "carpeta" ? (
        <div className={cn("grid gap-2", styles.aparece)}>
          <Label htmlFor="guia-carpeta">{h.folder}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="guia-carpeta" className="font-mono" value={a.carpeta} onChange={(e) => a.typeCarpeta(e.target.value)} placeholder={h.folderPlaceholder} autoComplete="off" spellCheck={false} data-campo="carpeta" />
            <Button type="button" variant="outline" disabled={a.ventana.isPending} onClick={() => a.ventana.mutate()} data-control="elegir-carpeta">
              {a.ventana.isPending ? ag.eligiendo : ag.elegir}
            </Button>
          </div>
          {a.sinVentana ? <p className="text-xs text-muted-foreground">{ag.sinVentana}</p> : null}
        </div>
      ) : null}
      {a.codigo === "github" ? (
        <div className={cn("grid gap-2", styles.aparece)}>
          <Label htmlFor="guia-repo">{h.githubRepo}</Label>
          <Input id="guia-repo" className="font-mono" value={a.repo} onChange={(e) => a.typeRepo(e.target.value)} placeholder={ag.nubePlaceholder} autoComplete="off" spellCheck={false} data-campo="repo" />
          {a.repo.trim() && !a.code ? <p className="text-xs text-muted-foreground">{ag.repoMal}</p> : null}
        </div>
      ) : null}
      {a.codigo === "ssh" ? (
        <div className={cn("grid gap-2", styles.aparece)}>
          <Label htmlFor="guia-ssh">{ag.sshLabel}</Label>
          <Input id="guia-ssh" className="font-mono" value={a.ssh} onChange={(e) => a.typeSsh(e.target.value)} placeholder={ag.sshPlaceholder} autoComplete="off" spellCheck={false} data-campo="ssh" />
          {a.ssh.trim() && !a.code ? <p className="text-xs text-muted-foreground">{ag.sshMal}</p> : null}
        </div>
      ) : null}

      {a.codigo ? (
        <div className={cn("grid gap-3 sm:grid-cols-[1fr_2fr]", styles.aparece)}>
          <div className="grid gap-2">
            <Label htmlFor="guia-nombre">{h.name}</Label>
            <Input id="guia-nombre" value={a.name} maxLength={NOMBRE_MAX} onChange={(e) => a.typeName(e.target.value)} placeholder={h.namePlaceholder} data-campo="nombre" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="guia-meta">{a.pideMeta ? h.goal : ag.metaOpcional}</Label>
            <Input id="guia-meta" value={a.goal} maxLength={META_MAX} onChange={(e) => a.setGoal(e.target.value)} placeholder={h.goalPlaceholder} data-campo="meta" />
          </div>
        </div>
      ) : null}

      {a.usaGithub && a.github.isPending ? (
        <p className={cn("flex items-center gap-2 text-xs text-muted-foreground", styles.aparece)} role="status">
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
          {githubAvisoWords().revisando}
        </p>
      ) : null}
      {a.aviso ? (
        <div className={cn("grid gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm", styles.aparece)} role="status" data-github-aviso>
          <p>
            <b>{githubAvisoWords().titulo}</b> {a.aviso.por}.
          </p>
          <p className="text-muted-foreground">{a.aviso.arregla}</p>
          {a.aviso.comando ? <CopyCommand command={a.aviso.comando} /> : null}
        </div>
      ) : null}
      {a.make.isError ? (
        <p className={cn("rounded-md border p-3 text-sm", styles.aparece, a.sinRama ? "bg-muted/40" : "border-destructive/40 bg-destructive/5")} role="alert" data-refusal={a.err?.code ?? "red"}>
          {a.err ? agregarError(a.err.code, a.err.detail) : agregarError(null)}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {w.asistente.ejemploO}{" "}
        <button type="button" className="underline underline-offset-2 hover:text-foreground" disabled={ejemploBusy} onClick={onEjemplo} data-control="guia-ejemplo">
          {w.guia.ejemplo}
        </button>
      </p>
    </form>
  );
}

/**
 * Step 3, first part: the project's state. A badge beside the title (En pausa, warning; Activo, success) and, while it
 * is paused, the body and «Iniciar proyecto». Once the server confirms the start the body folds away (300 ms, height,
 * opacity and spacing together) and only the title and the badge stay. Both follow the real state from GET /api/guia,
 * refreshed before the press settles, so a failed start never reads as Activo; paused again elsewhere, it unfolds.
 */
function PasoIniciar(props: { r: GuiaRead; pedido: string; setPedido: (v: string) => void; onIniciar: () => Promise<unknown>; busy: boolean; iniciando: boolean }) {
  const { r, pedido, setPedido, onIniciar, busy, iniciando } = props;
  const w = primeraEntregaWords().asistente;
  const reducido = useReducedMotion() ?? false;
  const s = swap(reducido);
  const tarea = useRef<HTMLTextAreaElement>(null);
  const p = r.proyecto;
  const activo = !r.company_paused && !r.project_paused;
  // Once the start lands, its button folds away with focus on it; focus moves on to the task, the step's next action.
  // It waits for the box to be enabled (busy ends after the guide's refresh), and only after a start seen here.
  const estabaPausado = useRef(!activo);
  useEffect(() => {
    if (!activo) estabaPausado.current = true;
    else if (estabaPausado.current && !busy && tarea.current) {
      estabaPausado.current = false;
      tarea.current.focus({ preventScroll: true });
    }
  }, [activo, busy]);
  if (!p) return null;
  const transicion = { duration: reducido ? 0 : 0.3, ease: "easeInOut" } as const;
  return (
    <div className="grid gap-5">
      <section data-iniciar={activo ? "activo" : "pausado"}>
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">{w.iniciarTitulo}</p>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1 text-xs font-medium ring-1 transition-colors duration-300 ease-in-out motion-reduce:transition-none",
              activo ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-400",
            )}
            role="status"
            aria-live="polite"
            data-estado-proyecto={activo ? "activo" : "pausado"}
          >
            <span className="relative grid size-2 place-items-center" aria-hidden>
              <span className={cn("size-2 rounded-full transition-colors duration-300 ease-in-out motion-reduce:transition-none", activo ? "bg-emerald-500" : "bg-amber-500")} />
              {/* The moment it starts: one ring leaves the dot, once. Never on opening an already active project. */}
              <AnimatePresence initial={false}>
                {activo && !reducido ? (
                  <motion.span
                    key="arranca"
                    className="absolute inset-0 rounded-full bg-emerald-500"
                    initial={{ opacity: 0.55, scale: 1 }}
                    animate={{ opacity: 0, scale: 3 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.7, ease: [...motionTokens.ease.enter] }}
                  />
                ) : null}
              </AnimatePresence>
            </span>
            <span className="grid">
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span key={activo ? "activo" : "pausado"} className="col-start-1 row-start-1" {...s}>
                  {activo ? w.activo : w.enPausa}
                </motion.span>
              </AnimatePresence>
            </span>
          </span>
        </div>
        <AnimatePresence initial={false}>
          {activo ? null : (
            <motion.div
              key="cuerpo"
              className="overflow-hidden"
              initial={{ height: 0, opacity: 0, paddingTop: 0 }}
              animate={{ height: "auto", opacity: 1, paddingTop: 8 }}
              exit={{ height: 0, opacity: 0, paddingTop: 0 }}
              transition={transicion}
              data-iniciar-cuerpo
            >
              <p className="text-sm text-muted-foreground">{w.iniciarCuerpo(p.title)}</p>
              {/* The Arc button keeps its pending and success states; the wizard's primary look is its own default. */}
              <ActionButton
                className="mt-3"
                label={w.iniciar}
                pendingLabel={w.iniciando}
                successLabel={w.iniciado}
                resetAfterMs={0}
                disabled={busy && !iniciando}
                onAction={async () => {
                  await onIniciar();
                }}
                data-control="guia-iniciar"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <section className="grid gap-2 border-t pt-4" data-tarea={r.pedido ? "enviada" : activo ? "lista" : "espera"}>
        <p className={cn("font-medium transition-colors duration-300", !activo && !r.pedido && "text-muted-foreground")}>{w.tareaTitulo}</p>
        {r.pedido ? (
          <p className={cn("flex items-center gap-2 text-sm text-muted-foreground", styles.aparece)}>
            <CheckIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            {w.yaPediste}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{w.tareaCuerpo}</p>
            <Label htmlFor="guia-pedido" className="sr-only">
              {w.tareaTitulo}
            </Label>
            <Textarea ref={tarea} id="guia-pedido" rows={4} value={pedido} disabled={!activo || busy} onChange={(e) => setPedido(e.target.value)} data-campo="pedido" />
            {!activo ? <p className={cn("text-xs text-muted-foreground", styles.aparece)}>{w.tareaAntes}</p> : null}
          </>
        )}
      </section>
    </div>
  );
}

export function GuiaWizard({ r, open, onOpenChange }: { r: GuiaRead; open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const w = primeraEntregaWords();
  const pasos = pasosDe(r);
  const [actual, setActual] = useState(() => pasoInicial(pasos));
  const agregar = useAgregarProyecto();
  const [pedido, setPedido] = useState(() => pedidoSugerido());
  const [requisitos, setRequisitos] = useState(false);
  const reducido = useReducedMotion() ?? false;
  const cuerpo = useRef<HTMLDivElement>(null);
  // Which way the steps moved, kept until the step changes again, so a refetch mid-transition never flips it.
  const visto = useRef({ actual, dir: 1 });
  if (visto.current.actual !== actual) visto.current = { actual, dir: actual > visto.current.actual ? 1 : -1 };
  const dir = visto.current.dir;
  const refrescar = () => Promise.all([client.invalidateQueries({ queryKey: ["guia"] }), client.invalidateQueries({ queryKey: ["company"] })]);

  // Each opening starts at the first step not done, with a clean form: an abandoned draft is not resumed silently.
  useEffect(() => {
    if (open) {
      setActual(pasoInicial(pasosDe(r)));
      agregar.reset();
      setPedido(pedidoSugerido());
      setRequisitos(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ejemplo = useMutation({ mutationFn: api.guiaEjemplo, onSuccess: () => refrescar() });
  const reanudar = useMutation({
    mutationFn: async (what: ReturnType<typeof aReanudar>) => {
      if (what.project) await api.setProjectPaused(what.project, false);
      if (what.company) await api.setCompanyPaused(false);
    },
    onError: () => toast.error(w.reanudar.fallo),
    onSuccess: () => refrescar(),
  });
  const pedir = useMutation({
    mutationFn: (slug: string) => api.askProject(slug, { text: pedido.trim(), mode: "ya" }),
    onError: () => toast.error(w.asistente.pedidoFallo),
    onSuccess: async () => {
      await refrescar();
      toast.success(w.asistente.terminado);
      onOpenChange(false);
    },
  });

  const id: PasoAsistente = PASOS_ASISTENTE[actual]!;
  const paso = pasos.find((p) => p.id === id);
  const pausado = r.company_paused || r.project_paused;
  const agregado = id === "proyecto" && (!!r.proyecto || !!agregar.make.data);
  const busy = agregar.make.isPending || ejemplo.isPending || reanudar.isPending || pedir.isPending;
  const sigue = () => setActual((i) => Math.min(i + 1, PASOS_ASISTENTE.length - 1));

  // The step's own action at the foot: what it does, then on to the next step.
  let primary: { label: string; onClick?: () => void; form?: string; disabled?: boolean; control: string; pending?: boolean };
  if (id === "proyecto" && !r.proyecto && !agregar.make.data) {
    primary = { label: agregar.busy ?? (agregar.sinRama ? agregarWords().crearRama : w.asistente.agregar), form: "guia-agregar", disabled: busy || !agregar.puedeEnviar, control: agregar.sinRama ? "crear-rama-y-agregar" : "guia-agregar", pending: agregar.make.isPending };
  } else if (id === "iniciar" && r.proyecto && !r.pedido) {
    // Starting is the step's own button; the foot sends the task, once the project runs.
    primary = { label: pedir.isPending ? w.asistente.pidiendo : w.asistente.pedirYTerminar, onClick: () => pedir.mutate(r.proyecto!.slug), disabled: busy || pausado || !pedido.trim(), control: "guia-pedir", pending: pedir.isPending };
  } else if (id === "iniciar") {
    primary = { label: w.asistente.terminar, onClick: () => onOpenChange(false), control: "guia-terminar" };
  } else {
    primary = { label: w.asistente.continuar, onClick: sigue, disabled: busy || !puedeSeguir(id, pasos), control: "guia-continuar" };
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      {/* Opens at 200ms and closes at 150ms on a strong ease-out, from 95% and centred (a modal has no trigger to grow
          from). At phone width it is a sheet from the bottom edge, full width, on the iOS drawer curve. */}
      <DialogContent
        className={cn(
          "flex max-h-[min(760px,calc(100svh-2rem))] flex-col gap-0 p-0 duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-closed:duration-150 sm:max-w-3xl",
          "max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-h-[calc(100svh-1rem)] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none",
          "max-sm:duration-300 max-sm:ease-[cubic-bezier(0.32,0.72,0,1)] max-sm:data-open:zoom-in-100 max-sm:data-open:slide-in-from-bottom max-sm:data-closed:duration-200 max-sm:data-closed:zoom-out-100 max-sm:data-closed:slide-out-to-bottom",
          "motion-reduce:data-open:zoom-in-100 motion-reduce:data-closed:zoom-out-100 motion-reduce:max-sm:data-open:slide-in-from-bottom-0 motion-reduce:max-sm:data-closed:slide-out-to-bottom-0",
        )}
        onInteractOutside={(e) => e.preventDefault()}
        data-guia-wizard
        data-paso-actual={id}
      >
        <DialogHeader className="gap-1 border-b px-4 pt-5 pb-4 text-left sm:px-5">
          <DialogTitle>{w.asistente.titulo}</DialogTitle>
          <DialogDescription>{w.asistente.intro}</DialogDescription>
          <div className="pt-3">
            <Stepper actual={actual} pasos={pasos} onIr={setActual} bloqueado={busy} />
          </div>
        </DialogHeader>

        <div ref={cuerpo} className="min-h-0 flex-1 overflow-x-hidden overscroll-contain max-sm:px-4 overflow-y-auto px-5 py-4" data-paso-cuerpo={id}>
          {/* One height for every step, the project step's with Local chosen (about 320px of content at 1280px wide), so
              the dialog does not jump from step 1 to 2. Inside the scroller: a short window still scrolls. */}
          {/* One step at a time: the old one leaves (140ms), the scroller goes back to the top, the new one comes in. */}
          <AnimatePresence mode="wait" initial={false} custom={dir} onExitComplete={() => cuerpo.current?.scrollTo({ top: 0 })}>
            <motion.div key={id} className={styles.paso} custom={dir} variants={pasoMotion(reducido)} initial="entra" animate="queda" exit="sale">
              <div className="flex min-h-80 flex-col gap-3" data-paso-alto>
                {id !== "iniciar" ? (
                  <div className="grid gap-1">
                    <p className="font-medium">{paso?.titulo}</p>
                    <p className="text-sm text-muted-foreground">
                      {id === "maquina" ? w.asistente.maquinaCuerpo : agregado ? w.asistente.agregadoCuerpo(r.proyecto?.title ?? agregar.name.trim(), !r.proyecto || pausado) : paso?.texto}
                    </p>
                  </div>
                ) : null}

                {id === "maquina" ? <PasoRequisitos mostrar={requisitos} setMostrar={setRequisitos} /> : null}

                {id === "proyecto" ? <PasoProyecto r={r} a={agregar} onEjemplo={() => ejemplo.mutate()} ejemploBusy={busy} /> : null}

                {id === "iniciar" ? (
                  <PasoIniciar
                    r={r}
                    pedido={pedido}
                    setPedido={setPedido}
                    onIniciar={() => reanudar.mutateAsync(aReanudar(r))}
                    busy={busy}
                    iniciando={reanudar.isPending}
                  />
                ) : null}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* The foot: Atrás, where you are, the step's own action. Clear of the home indicator on a phone. */}
        <div className="flex items-center justify-between gap-2 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-4">
          <Button type="button" variant="ghost" className="transition-[background-color,color,scale,translate] active:scale-[0.97] motion-reduce:transition-none" disabled={actual === 0 || busy} onClick={() => setActual((i) => Math.max(0, i - 1))} data-control="guia-atras">
            {w.asistente.atras}
          </Button>
          <p className="min-w-0 truncate text-xs text-muted-foreground tabular-nums" aria-live="polite" data-paso-contador>
            {w.tarjeta.paso(actual + 1, PASOS_ASISTENTE.length)}
          </p>
          <Button
            type={primary.form ? "submit" : "button"}
            form={primary.form}
            className="transition-[background-color,color,opacity,scale,translate] active:scale-[0.97] motion-reduce:transition-none"
            disabled={primary.disabled}
            aria-busy={primary.pending || undefined}
            onClick={primary.onClick}
            data-control={primary.control}
          >
            {primary.pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            {/* The label crossfades when the step's action changes (Continuar, Agregar, Enviar y terminar). */}
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span key={primary.label} initial={{ opacity: 0, filter: reducido ? "none" : blur }} animate={{ opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={entra}>
                {primary.label}
              </motion.span>
            </AnimatePresence>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
