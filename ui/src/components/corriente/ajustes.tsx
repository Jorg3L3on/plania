// NEWPROJ-6: a project's Ajustes door. Where the code is (the folder is checked before it is saved), the release step,
// QA's verify list, the preview address and plan approval, and the three context notes each run reads. Every save
// sends the version it read (GET/PUT /api/company/projects/:slug/settings…, src/api/project-settings.ts); the preview
// and plan approval keep the options route. After a save the readiness list and the floor read again.
// Wording and checks: @/lib/ajustes. Token fields are never shown here: they stay MCP-only, as variable names.
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import {
  CONTEXTO,
  GUARDADO,
  LANZAMIENTO_CAMPOS,
  SECCIONES,
  ajustesError,
  codigoDe,
  comandos,
  comandosAviso,
  contextoEstado,
  lanzamientoBody,
  vistaPreviaOk,
  type Ajustes as AjustesRead,
  type AjustesContexto,
} from "@/lib/ajustes";
import { CODIGO_OPCIONES, codigoBody, type CodigoOpcion } from "@/lib/nuevo-proyecto";
import { Btn, ReadError, Switch } from "./parts";
import { Arranque, Avanzado } from "./ajustes-avanzado";

const errorOf = (e: unknown) => (e instanceof ApiError ? ajustesError(e.code, e.detail) : ajustesError(null));

/** One save of the view: the answer becomes the read, the readiness list and the floor read again. */
export function useGuardar<I>(slug: string, fn: (input: I) => Promise<AjustesRead | unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (out) => {
      if (out && typeof out === "object" && "context" in out) client.setQueryData(["ajustes", slug], out);
      else void client.invalidateQueries({ queryKey: ["ajustes", slug] });
      void client.invalidateQueries({ queryKey: ["readiness", slug] });
      void client.invalidateQueries({ queryKey: ["company"] });
      toast(GUARDADO);
    },
  });
}

export const Seccion = ({ id, titulo, texto, children }: { id: string; titulo: string; texto: string; children: ReactNode }) => (
  <section className="cor-card cor-ajustes-sec" aria-labelledby={`ajustes-${id}`} data-ajustes={id}>
    <h3 id={`ajustes-${id}`} className="cor-ajustes-h">
      {titulo}
    </h3>
    <p className="cor-text">{texto}</p>
    {children}
  </section>
);

export const Falla = ({ error }: { error: unknown }) =>
  error ? (
    <p className="cor-state bad cor-ajustes-falla" role="alert">
      {errorOf(error)}
    </p>
  ) : null;

const Codigo = ({ a }: { a: AjustesRead }) => {
  const [opcion, setOpcion] = useState<CodigoOpcion | null>(codigoDe(a.code));
  const [carpeta, setCarpeta] = useState(a.code.repo_path ?? "");
  const [repo, setRepo] = useState(a.code.github_repo ?? "");
  const save = useGuardar(a.slug, (body: NonNullable<ReturnType<typeof codigoBody>>) => api.ajustesCodigo(a.slug, { version: a.version, ...body }));
  const body = codigoBody(opcion, carpeta, repo);
  return (
    <Seccion id="codigo" titulo={SECCIONES.codigo.titulo} texto={SECCIONES.codigo.texto}>
      <form
        className="cor-ajustes-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (body) save.mutate(body);
        }}
      >
        <div className="cor-opts" role="radiogroup" aria-label="Dónde está su código">
          {CODIGO_OPCIONES.map((o) => (
            <button key={o.key} type="button" role="radio" aria-checked={opcion === o.key} className="cor-opt" onClick={() => setOpcion(o.key)} data-codigo-opcion={o.key}>
              {o.label}
            </button>
          ))}
        </div>
        {(opcion === "carpeta" || opcion === "github") && (
          <span className="cor-hoja-two">
            {opcion === "carpeta" && (
              <label style={{ flex: 2 }}>
                <span className="cor-text">Carpeta en esta Mac</span>
                <input className="cor-input cor-mono" value={carpeta} onChange={(e) => setCarpeta(e.target.value)} placeholder="~/Developer/Projects/nombre" autoComplete="off" spellCheck={false} data-campo="carpeta" />
              </label>
            )}
            <label>
              <span className="cor-text">{opcion === "carpeta" ? "En GitHub (si tiene)" : "Repositorio en GitHub"}</span>
              <input className="cor-input cor-mono" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="dueño/nombre" autoComplete="off" spellCheck={false} data-campo="github" />
            </label>
          </span>
        )}
        {opcion === "github" && <p className="cor-cap">Sin carpeta guardada, Plania la busca en la de proyectos con el nombre del proyecto.</p>}
        {opcion === "ninguno" && <p className="cor-cap">El equipo trabaja sin carpeta hasta que la tenga.</p>}
        <Falla error={save.error} />
        <div className="cor-acts">
          <Btn kind="secondary" type="submit" disabled={!body || save.isPending} data-control="guardar-codigo">
            {save.isPending ? (opcion === "carpeta" ? "Revisando la carpeta…" : "Guardando…") : "Guardar"}
          </Btn>
        </div>
      </form>
    </Seccion>
  );
};

const Lanzamiento = ({ a }: { a: AjustesRead }) => {
  const [form, setForm] = useState({ from: a.release?.from ?? "", into: a.release?.into ?? "", env: a.release?.env ?? "", merge: a.release ? a.release.mode === "merge" : true });
  const save = useGuardar(a.slug, (release: ReturnType<typeof lanzamientoBody>) => api.ajustesLanzamiento(a.slug, { version: a.version, release }));
  const body = lanzamientoBody(form);
  const field = (k: "from" | "into" | "env") => (
    <label>
      <span className="cor-text">{LANZAMIENTO_CAMPOS[k].label}</span>
      <input className="cor-input cor-mono" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} autoComplete="off" spellCheck={false} data-campo={k} />
      <span className="cor-cap">{LANZAMIENTO_CAMPOS[k].hint}</span>
    </label>
  );
  return (
    <Seccion id="lanzamiento" titulo={SECCIONES.lanzamiento.titulo} texto={SECCIONES.lanzamiento.texto}>
      <form
        className="cor-ajustes-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (body) save.mutate(body);
        }}
      >
        <span className="cor-hoja-two cor-ajustes-three">
          {field("from")}
          {field("into")}
          {field("env")}
        </span>
        <span className="cor-ajustes-switch">
          <Switch on={form.merge} label={LANZAMIENTO_CAMPOS.merge.label} onChange={(merge) => setForm({ ...form, merge })} data-campo="merge" />
          <span className="cor-cap">{LANZAMIENTO_CAMPOS.merge.hint}</span>
        </span>
        {!a.release && <p className="cor-cap">Todavía no tiene paso a producción.</p>}
        <Falla error={save.error} />
        <div className="cor-acts">
          <Btn kind="secondary" type="submit" disabled={!body || save.isPending} data-control="guardar-lanzamiento">
            {save.isPending ? "Guardando…" : "Guardar"}
          </Btn>
          {a.release && (
            <Btn
              kind="quiet"
              disabled={save.isPending}
              onClick={() => {
                save.mutate(null);
                setForm({ from: "", into: "", env: "", merge: true });
              }}
              data-control="quitar-lanzamiento"
            >
              Quitar el paso
            </Btn>
          )}
        </div>
      </form>
    </Seccion>
  );
};

const Pruebas = ({ a }: { a: AjustesRead }) => {
  const [text, setText] = useState(a.verify.map((v) => v.command).join("\n"));
  const save = useGuardar(a.slug, (commands: string[]) => api.ajustesPruebas(a.slug, { version: a.version, commands }));
  const cmds = comandos(text);
  const aviso = comandosAviso(cmds);
  return (
    <Seccion id="pruebas" titulo={SECCIONES.pruebas.titulo} texto={SECCIONES.pruebas.texto}>
      <form
        className="cor-ajustes-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!aviso) save.mutate(cmds);
        }}
      >
        <label>
          <span className="sr-only">Comandos de QA, uno por línea</span>
          <textarea className="cor-textarea cor-mono cor-ajustes-area" rows={Math.max(3, cmds.length + 1)} value={text} onChange={(e) => setText(e.target.value)} placeholder={"pnpm test\npnpm exec tsc --noEmit"} spellCheck={false} data-campo="comandos" />
        </label>
        {aviso && <p className="cor-state amber">{aviso}</p>}
        {!aviso && cmds.length === 0 && <p className="cor-cap">Sin comandos, QA no corre pruebas en cada entrega.</p>}
        <Falla error={save.error} />
        <div className="cor-acts">
          <Btn kind="secondary" type="submit" disabled={!!aviso || save.isPending} data-control="guardar-pruebas">
            {save.isPending ? "Guardando…" : "Guardar"}
          </Btn>
        </div>
      </form>
    </Seccion>
  );
};

const Vista = ({ a }: { a: AjustesRead }) => {
  const [url, setUrl] = useState(a.preview_url ?? "");
  const save = useGuardar(a.slug, (input: { preview_url?: string | null; plan_approval?: boolean }) => api.setProjectOptions(a.slug, input));
  const ok = vistaPreviaOk(url);
  return (
    <Seccion id="vista" titulo={SECCIONES.vista.titulo} texto={SECCIONES.vista.texto}>
      <form
        className="cor-ajustes-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) save.mutate({ preview_url: url.trim() || null });
        }}
      >
        <label>
          <span className="cor-text">Dirección de la vista previa</span>
          <span className="cor-ajustes-row">
            <input className="cor-input cor-mono" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoComplete="off" spellCheck={false} data-campo="vista" />
            <Btn kind="secondary" type="submit" disabled={!ok || save.isPending} data-control="guardar-vista">
              Guardar
            </Btn>
          </span>
        </label>
        {!ok && <p className="cor-state amber">Empieza con http:// o https://. Vacía, se quita.</p>}
        <Switch on={a.plan_approval} label="Un plan espera tu «Sí, empiecen»" onChange={(plan_approval) => save.mutate({ plan_approval })} disabled={save.isPending} data-campo="aprobar-planes" />
        <Falla error={save.error} />
      </form>
    </Seccion>
  );
};

const Nota = ({ a, c }: { a: AjustesRead; c: AjustesContexto }) => {
  const [text, setText] = useState<string | null>(null);
  const save = useGuardar(a.slug, (markdown: string) => api.ajustesContexto(a.slug, c.id, c.doc_id ? { markdown, version: c.version! } : { markdown }));
  const w = CONTEXTO[c.id];
  return (
    <li className="cor-ajustes-nota" data-contexto={c.id} data-existe={c.doc_id ? "1" : "0"}>
      <div className="cor-ajustes-nota-head">
        <span className="cor-ajustes-nota-tx">
          <b>{w.titulo}</b>
          <span className="cor-text">{w.para}</span>
          <span className="cor-cap">{contextoEstado(c)}</span>
        </span>
        {text === null && (
          <Btn kind="secondary" small onClick={() => (save.reset(), setText(c.doc_id ? c.markdown : c.template))} data-control={c.doc_id ? "editar-contexto" : "crear-contexto"}>
            {c.doc_id ? "Editar" : "Crear desde la plantilla"}
          </Btn>
        )}
      </div>
      {text !== null && (
        <form
          className="cor-ajustes-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(text, { onSuccess: () => setText(null) });
          }}
        >
          <label>
            <span className="sr-only">{`${w.titulo}, en markdown`}</span>
            <textarea className="cor-textarea cor-mono cor-ajustes-area tall" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} data-campo={`contexto-${c.id}`} />
          </label>
          {!c.doc_id && <p className="cor-cap">Es la plantilla: llénala y borra los comentarios antes de guardar.</p>}
          <Falla error={save.error} />
          <div className="cor-acts">
            <Btn kind="secondary" type="submit" disabled={save.isPending} data-control="guardar-contexto">
              {save.isPending ? "Guardando…" : c.doc_id ? "Guardar" : "Crear"}
            </Btn>
            <Btn kind="quiet" onClick={() => (save.reset(), setText(null))}>
              Cancelar
            </Btn>
          </div>
        </form>
      )}
    </li>
  );
};

export const Ajustes = ({ p }: { p: { slug: string; title: string } }) => {
  const q = useQuery({ queryKey: ["ajustes", p.slug], queryFn: () => api.ajustes(p.slug) });
  // PLA-I2-6: the readiness list links to a section (#ajustes-<id>); scroll there once the view has loaded.
  const loaded = !!q.data;
  useEffect(() => {
    if (!loaded || !window.location.hash.startsWith("#ajustes-")) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [loaded]);
  if (q.isError && !q.data) return <ReadError what="los ajustes" onRetry={() => void q.refetch()} />;
  const a = q.data;
  return (
    <div className="cor-ajustes" data-ajustes-de={p.slug}>
      <header className="cor-door-head">
        <h2 className="cor-door-h">{`Ajustes de ${p.title}`}</h2>
        <p className="cor-text">Lo que el equipo necesita para trabajar en este proyecto. Cada cambio se guarda por separado.</p>
      </header>
      {!a ? (
        <div className="cor-skel" style={{ height: 320 }} role="status" aria-busy="true" aria-label="Cargando los ajustes" />
      ) : (
        <div className="cor-ajustes-cols">
          <Codigo a={a} />
          <Pruebas a={a} />
          <Lanzamiento a={a} />
          <Vista a={a} />
          <Arranque a={a} />
          <Seccion id="contexto" titulo={SECCIONES.contexto.titulo} texto={SECCIONES.contexto.texto}>
            <ul className="cor-ajustes-notas">
              {a.context.map((c) => (
                <Nota key={c.id} a={a} c={c} />
              ))}
            </ul>
          </Seccion>
          <Avanzado a={a} />
        </div>
      )}
    </div>
  );
};
