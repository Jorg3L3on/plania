// PLA-I2-5: under «Dónde está el código» in Ajustes; PLA-132: now in Despliegue › Repositorio y ramas. A project with no code gets its folder, repository and working
// branch from here («Preparar el código»); a repository without the working branch gets it («Crear la rama de
// trabajo»); «Revisar de nuevo» reads the readiness list again. Each step is shown as it ended. Words:
// @/lib/preparar-codigo. Never a branch name on screen.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { listoLinea } from "@/lib/listo";
import { ESTADO, NOMBRE_GITHUB, PASO, PREPARAR_CODIGO_WORDS, acciones, porQue, ramaDicho, resumen, type Preparacion } from "@/lib/preparar-codigo";
import { words } from "@/lib/i18n";
import type { Ajustes } from "@/lib/ajustes";
import { Btn, Switch } from "./parts";
import { caminoKey } from "./camino-query";

export function PrepararCodigo({ a }: { a: Ajustes }) {
  const client = useQueryClient();
  const w = words(PREPARAR_CODIGO_WORDS);
  const listo = useQuery({ queryKey: ["readiness", a.slug], queryFn: () => api.readiness(a.slug) });
  const code = listo.data?.items.find((i) => i.id === "code");
  const que = acciones(code, a.code);
  const [carpeta, setCarpeta] = useState(a.code.repo_path ?? "");
  const [enGithub, setEnGithub] = useState(!a.code.github_repo);
  const [nombre, setNombre] = useState(a.slug);
  const [privado, setPrivado] = useState(true);
  const [hecho, setHecho] = useState<Preparacion | null>(null);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["readiness", a.slug] });
    void client.invalidateQueries({ queryKey: ["ajustes", a.slug] });
    void client.invalidateQueries({ queryKey: ["company"] });
    // PLA-132: it lives in Despliegue now, whose read shows the new repo, folder and branch.
    void client.invalidateQueries({ queryKey: caminoKey(a.slug) });
  };
  const preparar = useMutation({
    mutationFn: () => api.prepararCodigo(a.slug, { version: a.version, ...(carpeta.trim() ? { repo_path: carpeta.trim() } : {}), github: enGithub ? { name: nombre.trim(), private: privado } : null }),
    onSuccess: (out) => {
      setHecho(out.setup);
      client.setQueryData(["ajustes", a.slug], out.settings);
      refresh();
    },
  });
  const rama = useMutation({ mutationFn: () => api.crearRama(a.slug), onSuccess: refresh });
  const nombreOk = !enGithub || NOMBRE_GITHUB.test(nombre.trim());
  const errorDe = (e: unknown) => (e instanceof ApiError && e.code === "STALE_VERSION" ? w.stale : porQue(e instanceof ApiError ? e.code : null));

  return (
    <div className="cor-ajustes-form" data-preparar-codigo={a.slug}>
      {code && code.state !== "not_needed" && <p className={code.state === "ready" ? "cor-cap" : "cor-state amber"}>{listoLinea(code).texto}</p>}
      {que.preparar && (
        <form
          className="cor-ajustes-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (nombreOk) preparar.mutate();
          }}
        >
          <p className="cor-text">{w.intro}</p>
          <label>
            <span className="cor-text">{w.folder}</span>
            <input className="cor-input cor-mono" value={carpeta} onChange={(e) => setCarpeta(e.target.value)} placeholder={w.folderPlaceholder} autoComplete="off" spellCheck={false} data-campo="preparar-carpeta" />
          </label>
          <Switch on={enGithub} label={w.onGithub} onChange={setEnGithub} data-campo="preparar-github" />
          {enGithub && (
            <span className="cor-hoja-two">
              <label>
                <span className="cor-text">{w.githubName}</span>
                <input className="cor-input cor-mono" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" spellCheck={false} data-campo="preparar-nombre" />
              </label>
              <Switch on={privado} label={w.private} onChange={setPrivado} data-campo="preparar-privado" />
            </span>
          )}
          {!nombreOk && <p className="cor-state amber">{w.badName}</p>}
          {preparar.error && (
            <p className="cor-state bad" role="alert">
              {errorDe(preparar.error)}
            </p>
          )}
          <div className="cor-acts">
            <Btn kind="secondary" type="submit" disabled={!nombreOk || preparar.isPending} data-control="preparar-codigo">
              {preparar.isPending ? w.preparing : w.prepare}
            </Btn>
          </div>
        </form>
      )}
      {hecho && (
        <div role="status" data-preparacion={hecho.ok ? "ok" : "falta"}>
          <ul className="cor-ajustes-notas">
            {hecho.steps.map((s) => (
              <li key={s.id} data-paso={s.id} data-estado={s.state}>
                <span className="cor-text">{`${PASO[s.id]}: ${ESTADO[s.state]}`}</span>
              </li>
            ))}
          </ul>
          <p className={hecho.ok ? "cor-cap" : "cor-state amber"}>{resumen(hecho)}</p>
        </div>
      )}
      {que.rama && (
        <div className="cor-acts">
          <Btn kind="secondary" disabled={rama.isPending} onClick={() => rama.mutate()} data-control="crear-rama">
            {rama.isPending ? w.creatingBranch : w.createBranch}
          </Btn>
        </div>
      )}
      {rama.data && <p className={rama.data.state === "failed" ? "cor-state bad" : "cor-cap"}>{ramaDicho(rama.data)}</p>}
      {rama.error && <p className="cor-state bad">{errorDe(rama.error)}</p>}
      <div className="cor-acts">
        <Btn kind="quiet" small disabled={listo.isFetching} onClick={() => void listo.refetch()} data-control="revisar-codigo">
          {listo.isFetching ? w.checking : w.checkAgain}
        </Btn>
      </div>
    </div>
  );
}
