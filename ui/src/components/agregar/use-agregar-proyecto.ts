// PLA-180: «Agregar un proyecto», the form's state and its calls, shared by the two places that draw it. Compañía's sheet
// (components/corriente/hojas.tsx, La corriente's look) and step 2 of the first-delivery wizard on Inicio
// (components/home/guia-wizard.tsx, the app's look). Rules and words in lib/nuevo-proyecto.ts.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { githubAviso, pideGithub } from "@/lib/github-aviso";
import { agregarWords, codigoBody, metaObligatoria, nombreSugerido, type CodigoBody, type CodigoOpcion } from "@/lib/nuevo-proyecto";
import { HOJAS_WORDS } from "@/lib/hojas-words";
import { words } from "@/lib/i18n";

export function useAgregarProyecto() {
  const client = useQueryClient();
  const [name, setName] = useState("");
  // Until the owner types a name, it follows the folder or the repository.
  const [nameTouched, setNameTouched] = useState(false);
  const [goal, setGoal] = useState("");
  // NEWPROJ-3: where the code is. Nothing is sent until one of the four is picked and its field is right.
  const [codigo, setCodigo] = useState<CodigoOpcion | null>(null);
  const [carpeta, setCarpeta] = useState("");
  const [repo, setRepo] = useState("");
  const [ssh, setSsh] = useState("");
  const [sinVentana, setSinVentana] = useState(false);
  const code = codigoBody(codigo, carpeta, repo, ssh);
  const pideMeta = metaObligatoria(codigo);
  const follow = (o: CodigoOpcion | null, value: string) => {
    if (!nameTouched) setName(nombreSugerido(o, value));
  };
  // F2: gh is needed only to clone from GitHub (Nube); asked once that choice is made.
  const usaGithub = pideGithub(codigo);
  const github = useQuery({ queryKey: ["onboarding", "github"], queryFn: api.githubAccess, enabled: usaGithub, staleTime: 30_000, retry: false });
  const aviso = usaGithub ? githubAviso(github.data?.access) : null;
  const ventana = useMutation({
    mutationFn: api.elegirCarpeta,
    onSuccess: (r) => {
      if (!r.available) return setSinVentana(true);
      if (r.path) {
        setCarpeta(r.path);
        follow("carpeta", r.path);
      }
    },
    onError: () => setSinVentana(true),
  });
  const make = useMutation({
    mutationFn: (input: { name: string; goal?: string } & CodigoBody) => api.createCompanyProject(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["company"] });
      void client.invalidateQueries({ queryKey: ["guia"] });
    },
  });
  const err = make.error instanceof ApiError ? make.error : null;
  // PLA-180 (the PLA-I2-5 rule): a repository without the working branch: the form offers to make it (one push), never on its own.
  const sinRama = err?.code === "REPO_NO_START_BRANCH" && codigo !== "ninguno";
  const listo_ = !!name.trim() && !!code && !(pideMeta && !goal.trim());
  const send = (crearRama = false) => {
    if (!listo_ || !code) return;
    const body = crearRama && "origen" in code ? { ...code, crear_rama: true } : code;
    make.mutate({ name: name.trim(), ...(goal.trim() ? { goal: goal.trim() } : {}), ...body });
  };
  const elegir = (o: CodigoOpcion) => {
    setCodigo(o);
    make.reset();
    follow(o, o === "carpeta" ? carpeta : o === "ssh" ? ssh : repo);
  };
  const ag = agregarWords();
  const busy = make.isPending ? (codigo === "github" || codigo === "ssh" ? ag.clonando : codigo === "carpeta" ? ag.revisando : words(HOJAS_WORDS).creating) : null;
  const typeName = (v: string) => {
    setNameTouched(true);
    setName(v);
  };
  const typeCarpeta = (v: string) => (setCarpeta(v), follow("carpeta", v));
  const typeRepo = (v: string) => (setRepo(v), follow("github", v));
  const typeSsh = (v: string) => (setSsh(v), follow("ssh", v));
  /** Back to an empty form (the wizard does it when it closes). */
  const reset = () => {
    setName("");
    setNameTouched(false);
    setGoal("");
    setCodigo(null);
    setCarpeta("");
    setRepo("");
    setSsh("");
    setSinVentana(false);
    make.reset();
  };
  return {
    name, setName, setNameTouched, typeName, goal, setGoal, codigo, elegir, carpeta, setCarpeta, typeCarpeta, repo, setRepo, typeRepo, ssh, setSsh, typeSsh,
    sinVentana, code, pideMeta, follow, usaGithub, github, aviso, ventana, make, err, sinRama, puedeEnviar: listo_, send, busy, reset,
  };
}
