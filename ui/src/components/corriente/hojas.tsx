// PLA-I62-8: the sheets (board A5). Each opens alone over the dimmed screen and says what happens before the click:
//   Nuevo proyecto  name and goal; its key, its PO and that it starts paused (POST /company/projects); its ready state.
//   Pausar          what closes (the runs live now), what does not start, what stays; Pausar <proyecto>.
//   Reanudar        a paused project, or the company stopped (that one is resumed from Plomería).
//   Publicar        what goes out (the release's steps and its reel), what blocks it (open checks, a step of yours
//                   first) and the ship call's progress, result and refusal words (POST …/release/ship).
//   Meta            the goal and its date (the goal routes /ceo's dialog uses).
// Esc and Cancelar close; focus starts inside and returns where it was.
import { migrationLine } from "@/lib/publicar";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router";
import { toast } from "sonner";
import { ApiError, api, type Decision, type OrgProject } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import type { GoalWrite } from "@/components/goals/model";
import { Btn, Key, Label, You } from "./parts";

// NEWPROJ-7: borrar is Borrar proyecto (hoja-borrar.tsx).
export type HojaKind = "nuevo" | "pausar" | "reanudar" | "publicar" | "meta" | "borrar";

export const Hoja = ({ label, title, onClose, children, wide }: { label: string; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) => {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("input, textarea, button:not([data-x])")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && box.current) {
        const f = [...box.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input, textarea, select")];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) (e.preventDefault(), f.at(-1)!.focus());
        else if (!e.shiftKey && document.activeElement === f.at(-1)) (e.preventDefault(), f[0]!.focus());
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (back?.isConnected) back.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="cor-hoja-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={`cor-hoja ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="hoja-t">
        <Label>{label}</Label>
        <h2 id="hoja-t" className="cor-h2">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
};

const Rows = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="cor-hoja-rows">
    {rows.map(([k, v]) => (
      <div key={k}>
        <dt>{k}</dt>
        <dd>{v}</dd>
      </div>
    ))}
  </dl>
);

export const NuevoProyecto = ({ onClose, onOpen }: { onClose: () => void; onOpen: (slug: string) => void }) => {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const make = useMutation({ mutationFn: (input: { name: string; goal: string }) => api.createCompanyProject(input), onSuccess: () => void client.invalidateQueries({ queryKey: ["company"] }) });
  const missing = make.error instanceof ApiError && (make.error.status === 404 || make.error.status === 405);
  if (make.data)
    return (
      <Hoja label="Nuevo proyecto" title={`${name.trim()} está listo`} onClose={onClose}>
        <Rows rows={[["Clave", <Key key="k">{make.data.key_prefix}</Key>], ["PO", make.data.po], ["En pausa", "Su PO despierta cuando lo reanudes."]]} />
        <p className="cor-text">«{goal.trim()}»</p>
        <div className="cor-acts">
          <Btn kind="primary" onClick={() => onOpen(make.data!.slug)} data-control="abrir-proyecto">
            Abrir el proyecto
          </Btn>
          <Btn kind="quiet" onClick={onClose}>
            Cerrar
          </Btn>
        </div>
      </Hoja>
    );
  return (
    <Hoja label="Nuevo proyecto" title="¿Qué vas a construir?" onClose={onClose}>
      <form
        className="cor-hoja-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && goal.trim()) make.mutate({ name: name.trim(), goal: goal.trim() });
        }}
      >
        <span className="cor-hoja-two">
          <label>
            <span className="cor-text">Nombre</span>
            <input className="cor-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Viajia" required />
          </label>
          <label style={{ flex: 2 }}>
            <span className="cor-text">Meta, en una oración</span>
            <input className="cor-input" value={goal} maxLength={240} onChange={(e) => setGoal(e.target.value)} placeholder="Que alguien arme su viaje en diez minutos." required />
          </label>
        </span>
        <Rows rows={[["Clave", "Recibe su clave para pasos, sacada del nombre."], ["PO", "Se crea de la plantilla, con su prompt."], ["En pausa", "Su PO despierta cuando lo reanudes."]]} />
        {missing && <p className="cor-state bad">Todavía no se pueden crear proyectos desde aquí: el servidor no tiene esa ruta. No se creó nada.</p>}
        {make.isError && !missing && <p className="cor-state bad">{make.error instanceof ApiError ? `No se pudo crear (${make.error.code}).` : "No se pudo crear el proyecto."}</p>}
        <div className="cor-acts">
          <Btn kind="primary" type="submit" disabled={make.isPending || !name.trim() || !goal.trim()} data-control="crear-proyecto">
            {make.isPending ? "Creando…" : "Crear proyecto"}
          </Btn>
          <Btn kind="quiet" onClick={onClose}>
            Cancelar
          </Btn>
        </div>
      </form>
    </Hoja>
  );
};

export const Pausar = ({ p, onClose, onDone }: { p: OrgProject; onClose: () => void; onDone: () => void }) => {
  const live = p.team.filter((m) => m.state === "running");
  const pause = useMutation({ mutationFn: () => api.setProjectPaused(p.slug, true), onSuccess: () => (toast(`${p.title} en pausa`), onDone()), onError: () => toast.error("No se pudo pausar.") });
  return (
    <Hoja label="Pausar" title={`¿Pausar ${p.title}?`} onClose={onClose}>
      <Rows
        rows={[
          ["Se cierra", live.length ? live.map((m) => `${seatName(m.role)}${m.now?.ticket ? ` (${m.now.ticket})` : ""}`).join(", ") + " termina su paso y se cierra." : "Nada está corriendo ahora."],
          ["No arranca", `Nada nuevo en ${p.title} hasta que lo reanudes. Los otros proyectos siguen.`],
          ["Se queda", "No se borra nada. Te toca, las fusiones y las decisiones siguen funcionando."],
        ]}
      />
      <p className="cor-cap">Se puede deshacer: reanudas cuando quieras.</p>
      <div className="cor-acts">
        <Btn kind="primary" disabled={pause.isPending} onClick={() => pause.mutate()} data-control="pausar-si">
          {pause.isPending ? "Pausando…" : `Pausar ${p.title}`}
        </Btn>
        <Btn kind="quiet" onClick={onClose}>
          Cancelar
        </Btn>
      </div>
    </Hoja>
  );
};

export const Reanudar = ({ p, companyPaused, onClose, onDone, plomeriaTo }: { p: OrgProject | null; companyPaused: boolean; onClose: () => void; onDone: () => void; plomeriaTo: string }) => {
  const go = useMutation({ mutationFn: () => api.setProjectPaused(p!.slug, false), onSuccess: () => (toast(`${p!.title} reanudado`), onDone()), onError: () => toast.error("No se pudo reanudar.") });
  return (
    <Hoja label="Reanudar · proyecto en pausa o compañía detenida" title={p ? `${p.title} está en pausa` : "La compañía está detenida"} onClose={onClose}>
      <Rows
        rows={[
          ["Al reanudar", "Su PO despierta y el equipo retoma lo que estaba Lista o a medias. Nada se perdió."],
          ["Si es toda", "Cuando la compañía entera está detenida, un aviso lo dice arriba de cada pantalla. Se reanuda desde Plomería."],
        ]}
      />
      {companyPaused && <p className="cor-state amber">La compañía está detenida: aunque reanudes este proyecto, nada arranca hasta que la reanudes en Plomería.</p>}
      <div className="cor-acts">
        {p && (
          <Btn kind="primary" disabled={go.isPending} onClick={() => go.mutate()} data-control="reanudar-si">
            {go.isPending ? "Reanudando…" : `Reanudar ${p.title}`}
          </Btn>
        )}
        <Link className="cor-btn secondary" to={plomeriaTo} data-control="ir-plomeria">
          Ir a Plomería
        </Link>
        <Btn kind="quiet" onClick={onClose}>
          Cerrar
        </Btn>
      </div>
    </Hoja>
  );
};

const publishError = (code: string, detail: Record<string, unknown> = {}): string => {
  if (code === "RELEASE_NOT_READY") {
    const why = String(detail.reason ?? "");
    if (why === "open_checks") return "Todavía hay puntos abiertos en esos cambios; ciérralos primero.";
    if (why === "before_steps") return "Antes hay un paso tuyo pendiente; hazlo primero.";
    if (why === "merged" || why === "nothing_to_ship") return "Ya no hay nada por publicar: estos cambios ya están en la versión principal.";
    if (why === "mode_command") return "Este proyecto se publica con un comando, no desde aquí. Está en Bandeja.";
    return "Ya no se puede publicar desde aquí; míralo en Bandeja.";
  }
  if (code === "RELEASE_MERGE_FAILED") return `GitHub no aceptó la publicación${detail.output ? `: ${String(detail.output)}` : "."}`;
  return `No se pudo publicar (${code}).`;
};

export const Publicar = ({ p, release, first, firstTo, onClose }: { p: OrgProject; release: Decision | null; first: Decision | null; firstTo: string | null; onClose: () => void }) => {
  const client = useQueryClient();
  const [kept] = useState(release);
  const [since, setSince] = useState<number | null>(null);
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    if (since === null) return;
    const id = window.setInterval(() => setT(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  const ship = useMutation({
    mutationFn: () => api.shipRelease(p.slug),
    onMutate: () => setSince(Date.now()),
    onSuccess: () => toast.success(`${p.title}: publicado. Ya está en la versión principal.`),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["company"] });
      void client.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
  const r = (release ?? kept)?.release ?? null;
  if (!r)
    return (
      <Hoja label="Publicar" title={`Publicar ${p.title}`} onClose={onClose}>
        <p className="cor-text" data-publish-empty>
          Ya no hay nada por publicar en {p.title}.
        </p>
        <div className="cor-acts">
          <Btn kind="secondary" onClick={onClose}>
            Cerrar
          </Btn>
        </div>
      </Hoja>
    );
  const n = r.tickets.length;
  const blocked = r.open_checks > 0 || r.before > 0;
  const done = ship.isSuccess ? ship.data : null;
  return (
    <Hoja label="Publicar" title={`Publicar ${p.title}`} onClose={onClose} wide>
      <div className="cor-card cor-hoja-what">
        <Label>{`Lo que verá quien usa ${p.title}`}</Label>
        <p className="cor-text">{`${n === 1 ? "1 cambio terminado pasa" : `${n} cambios terminados pasan`} de la copia de prueba a la versión principal (${r.from} → ${r.into}${r.ahead != null ? `, ${r.ahead} commits` : ""}).`}</p>
      </div>
      <ul className="cor-hoja-list" data-publish-list={n}>
        {r.tickets.slice(0, 4).map((x) => (
          <li key={x.key} className="cor-row">
            <Key>{x.key}</Key>
            <span className="cor-ellipsis">{x.title}</span>
          </li>
        ))}
        {n > 4 && <li className="cor-cap">{`y ${n - 4} más`}</li>}
      </ul>
      {!!r.migrations?.length && (
        <p className="cor-text" data-publish-migrations={r.migrate ?? ""}>
          {migrationLine(r.migrations, r.migrate ?? null, p.title)}
        </p>
      )}
      {!!r.reel?.length && (
        <div className="cor-reel" data-publish-reel={r.reel.length}>
          {r.reel.slice(0, 3).map((x) => (
            <figure key={x.key}>
              <img src={x.image_url} alt={`${x.title}: ${x.label}`} loading="lazy" />
              <figcaption className="cor-cap">{`${x.kind === "nueva" ? "NUEVA" : "CAMBIÓ"} · ${x.label}`}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {blocked && !done && (
        <p className="cor-hoja-block" data-publish-blocked>
          <You small flat />
          {r.open_checks > 0 ? `${r.open_checks === 1 ? "Hay 1 punto abierto" : `Hay ${r.open_checks} puntos abiertos`} en estos cambios: GitHub lo rechazará hasta que se resuelva.` : first ? `Antes hay un paso tuyo: ${first.kind === "deliverable" || first.kind === "pr" ? `aceptar ${first.ref ?? "una entrega"}` : first.title}.` : `${r.before === 1 ? "Hay 1 paso tuyo" : `Hay ${r.before} pasos tuyos`} antes de publicar.`}
          {firstTo && (
            <Link className="cor-inline" to={firstTo}>
              Hazlo primero
            </Link>
          )}
        </p>
      )}
      {ship.isPending && since !== null && (
        <p className="cor-text" role="status" data-publish-working>
          Publicando en GitHub… <span className="cor-mono">{`${Math.floor((t - since) / 60000)}:${String(Math.floor(((t - since) / 1000) % 60)).padStart(2, "0")}`}</span> Se abre la propuesta {r.from} → {r.into} y se fusiona.
        </p>
      )}
      {done && (
        <p className="cor-state ok" role="status" data-publish-done>
          {`✓ Publicado. ${n === 1 ? "1 cambio ya está" : `${n} cambios ya están`} en la versión principal (${done.merge_sha.slice(0, 7)}).`}
          {done.migrate === "auto" ? " Plania respalda y migra la base de la app ahora; si algo falla, te lo dice en el hilo." : done.migrate === "manual" ? " Falta migrar la base de la app." : ""}{" "}
          <a className="cor-inline" href={done.pr.url} target="_blank" rel="noreferrer">
            Ver en GitHub
          </a>
        </p>
      )}
      {ship.isError && <p className="cor-state bad" role="alert" data-publish-error>{ship.error instanceof ApiError ? publishError(ship.error.code, ship.error.detail) : "No se pudo. Si la Mac está dormida, intenta al despertar."}</p>}
      <div className="cor-acts">
        {done ? (
          <Btn kind="primary" onClick={onClose} data-control="publicar-listo">
            Listo
          </Btn>
        ) : (
          <>
            <Btn kind="primary" disabled={ship.isPending || blocked} onClick={() => ship.mutate()} data-control="publicar-si">
              {ship.isPending ? "Publicando…" : "Publicar cambios"}
            </Btn>
            <Btn kind="quiet" disabled={ship.isPending} onClick={onClose}>
              Cerrar
            </Btn>
          </>
        )}
      </div>
    </Hoja>
  );
};

export const Meta = ({ p, onClose }: { p: OrgProject; onClose: () => void }) => {
  const client = useQueryClient();
  const goalId = p.rumbo?.goal_id ?? null;
  const [title, setTitle] = useState(p.rumbo?.goal ?? "");
  const [date, setDate] = useState(p.rumbo?.target_on ?? "");
  const save = useMutation({
    mutationFn: (body: GoalWrite) => (goalId ? api.patchGoal(goalId, body) : api.createGoal({ ...body, project: p.slug })),
    onSuccess: () => {
      toast(goalId ? "Meta actualizada" : "Meta creada");
      void client.invalidateQueries({ queryKey: ["company"] });
      void client.invalidateQueries({ queryKey: ["goals"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? `No se pudo guardar la meta (${e.code}).` : "No se pudo guardar la meta."),
  });
  return (
    <Hoja label="Meta · fijar o cambiar" title={`¿A dónde va ${p.title}?`} onClose={onClose} wide>
      <form
        className="cor-hoja-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) save.mutate({ title: title.trim(), why: p.rumbo?.why ?? "", status: "active", target_on: date.trim() ? date.trim() : null });
        }}
      >
        <span className="cor-hoja-two">
          <label style={{ flex: 3 }}>
            <span className="cor-text">Meta, en una oración</span>
            <input className="cor-input" value={title} maxLength={240} onChange={(e) => setTitle(e.target.value)} required data-control="meta-titulo" />
          </label>
          <label>
            <span className="cor-text">Fecha</span>
            <input type="date" className="cor-input" value={date} onChange={(e) => setDate(e.target.value)} data-control="meta-fecha" />
          </label>
        </span>
        <p className="cor-cap">El PO la lee en cada corrida y no propone trabajo sin ella. Con la fecha se calcula el pronóstico que ves en Ahora.</p>
        <div className="cor-acts">
          <Btn kind="primary" type="submit" disabled={save.isPending || !title.trim()} data-control="guardar-meta">
            {save.isPending ? "Guardando…" : "Guardar meta"}
          </Btn>
          <Btn kind="quiet" onClick={onClose}>
            Cancelar
          </Btn>
        </div>
      </form>
    </Hoja>
  );
};

/** A doc linked from a message or a role (?doc=<id>, the address lib/org.ts gives company docs). */
export const DocHoja = ({ id, onClose }: { id: string; onClose: () => void }) => {
  const q = useQuery({ queryKey: ["prompt-doc", id], queryFn: () => api.promptDoc(id) });
  return (
    <Hoja label={q.data ? `Doc · v${q.data.version}` : "Doc"} title={q.data?.title ?? "Doc"} onClose={onClose} wide>
      {q.isError ? (
        <p className="cor-state bad">No se pudo leer el doc.</p>
      ) : q.data ? (
        <div className="cor-md cor-hoja-doc" tabIndex={0} role="region" aria-label={q.data.title}>
          <Markdown remarkPlugins={[remarkGfm]}>{q.data.markdown}</Markdown>
        </div>
      ) : (
        <div className="cor-skel" style={{ height: 200 }} aria-busy="true" />
      )}
      <div className="cor-acts">
        <Btn kind="secondary" onClick={onClose}>
          Cerrar
        </Btn>
      </div>
    </Hoja>
  );
};
