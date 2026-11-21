// NEWPROJ-6: a project's Ajustes door: QA's verify list, plan approval, how the app starts, the three context notes
// each run reads, «Avanzado» and Borrar. PLA-132: where the code is, the release step and the production address
// moved to Despliegue (camino-codigo.tsx, camino-entornos.tsx), which already edited the same values. Every save
// sends the version it read (GET/PUT /api/company/projects/:slug/settings…, src/api/project-settings.ts); plan
// approval keeps the options route. After a save the readiness list and the floor read again.
// Wording and checks: @/lib/ajustes. Token fields are never shown here: they stay MCP-only, as variable names.
// PLA-135: the three context notes became «Docs del proyecto» (docs-proyecto.tsx), with the project's library beside
// them now that Archivo is gone; the old project page (?pagina) is reached from the header here.
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import { ajustesError, ajustesWords, borrarBoton, comandos, comandosAviso, type Ajustes as AjustesRead } from "@/lib/ajustes";
import { Btn, ReadError, Switch } from "./parts";
import { words } from "@/lib/i18n";
import { AJUSTES_VIEW_WORDS } from "@/lib/ajustes-words";
import { Arranque, Avanzado } from "./ajustes-avanzado";
import { DocsProyecto, type Seat } from "./docs-proyecto";
import { docsWords } from "@/lib/docs-proyecto";

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
      toast(ajustesWords().guardado);
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

const Pruebas = ({ a }: { a: AjustesRead }) => {
  const [text, setText] = useState(a.verify.map((v) => v.command).join("\n"));
  const save = useGuardar(a.slug, (commands: string[]) => api.ajustesPruebas(a.slug, { version: a.version, commands }));
  const cmds = comandos(text);
  const aviso = comandosAviso(cmds);
  const w = words(AJUSTES_VIEW_WORDS);
  const S = ajustesWords().secciones;
  return (
    <Seccion id="pruebas" titulo={S.pruebas.titulo} texto={S.pruebas.texto}>
      <form
        className="cor-ajustes-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!aviso) save.mutate(cmds);
        }}
      >
        <label>
          <span className="sr-only">{w.qaCommands}</span>
          <textarea className="cor-textarea cor-mono cor-ajustes-area" rows={Math.max(3, cmds.length + 1)} value={text} onChange={(e) => setText(e.target.value)} placeholder={"pnpm test\npnpm exec tsc --noEmit"} spellCheck={false} data-campo="comandos" />
        </label>
        {aviso && <p className="cor-state amber">{aviso}</p>}
        {!aviso && cmds.length === 0 && <p className="cor-cap">{w.noCommands}</p>}
        <Falla error={save.error} />
        <div className="cor-acts">
          <Btn kind="secondary" type="submit" disabled={!!aviso || save.isPending} data-control="guardar-pruebas">
            {save.isPending ? w.saving : w.save}
          </Btn>
        </div>
      </form>
    </Seccion>
  );
};

// PLA-132: the preview address left with the release step for Despliegue (its production environment); the plan
// switch stays.
const Vista = ({ a }: { a: AjustesRead }) => {
  const save = useGuardar(a.slug, (input: { plan_approval?: boolean }) => api.setProjectOptions(a.slug, input));
  const w = words(AJUSTES_VIEW_WORDS);
  const S = ajustesWords().secciones;
  return (
    <Seccion id="vista" titulo={S.vista.titulo} texto={S.vista.texto}>
      <div className="cor-ajustes-form">
        <Switch on={a.plan_approval} label={w.planApproval} onChange={(plan_approval) => save.mutate({ plan_approval })} disabled={save.isPending} data-campo="aprobar-planes" />
        <Falla error={save.error} />
      </div>
    </Seccion>
  );
};

/** PLA-I3-2: Borrar proyecto opens from Ajustes (its sheet is ?hoja=borrar, unchanged). */
export const AjustesBorrar = ({ title, to }: { title: string; to: string }) => (
  <Seccion id="borrar" titulo={ajustesWords().secciones.borrar.titulo} texto={ajustesWords().secciones.borrar.texto}>
    <div className="cor-acts">
      <Link className="cor-btn danger" to={to} data-control="borrar">
        {borrarBoton(title)}
      </Link>
    </div>
  </Seccion>
);

export const Ajustes = ({ p, borrarTo, docTo }: { p: { slug: string; title: string; team?: Seat[] }; borrarTo?: string; docTo: (id: string) => string }) => {
  const q = useQuery({ queryKey: ["ajustes", p.slug], queryFn: () => api.ajustes(p.slug) });
  // PLA-I2-6: the readiness list links to a section (#ajustes-<id>); scroll there once the view has loaded.
  const loaded = !!q.data;
  const w = words(AJUSTES_VIEW_WORDS);
  useEffect(() => {
    if (!loaded || !window.location.hash.startsWith("#ajustes-")) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [loaded]);
  if (q.isError && !q.data) return <ReadError what={w.readWhat} onRetry={() => void q.refetch()} />;
  const a = q.data;
  return (
    <div className="cor-ajustes" data-ajustes-de={p.slug}>
      <header className="cor-door-head">
        <h2 className="cor-door-h">{w.title(p.title)}</h2>
        <p className="cor-text">
          {w.lead}{" "}
          <a className="cor-inline" href={`/p/${encodeURIComponent(p.slug)}?pagina`} data-control="pagina">
            {docsWords().paginaVieja}
          </a>
        </p>
      </header>
      {!a ? (
        <div className="cor-skel" style={{ height: 320 }} role="status" aria-busy="true" aria-label={w.loading} />
      ) : (
        <div className="cor-ajustes-cols">
          <DocsProyecto a={a} p={p} docTo={docTo} />
          <Pruebas a={a} />
          <Vista a={a} />
          <Arranque a={a} />
          <Avanzado a={a} />
          {borrarTo && <AjustesBorrar title={p.title} to={borrarTo} />}
        </div>
      )}
    </div>
  );
};
