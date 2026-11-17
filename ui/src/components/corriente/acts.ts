// PLA-I62: La corriente's calls, the same ones /ceo makes (pages/ceo.tsx), gathered in one hook so every screen acts
// the same way: a decision (Aceptar, Pedir ajuste, an answer, a plan), a run (Detener, Reanudar corrida), starting a
// teammate (also past the guard), the PO's plan order, the accept-by-itself switches, a request nobody took (Reenviar,
// Cerrar), a note to a teammate, picking the next paso, pausing and resuming. The refusal words are /ceo's.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api, type Decision, type DecisionInput } from "@/lib/api";

export const SLEEPY = "No se pudo. Si la Mac está dormida, intenta al despertar.";

export const STEER_REFUSAL: Record<string, string> = {
  PROJECT_PAUSED: "El proyecto está en pausa: reanúdalo primero.",
  COMPANY_PAUSED: "La compañía está detenida.",
  RUN_NOT_LIVE: "Esa corrida ya terminó.",
  NOT_READY: "Ese ya no está listo.",
};

export const DECISION_REFUSAL: Record<string, string> = {
  NOT_COMBINABLE: "Esas opciones no van juntas.",
  ALREADY_ACTED: "Ya actuaste sobre esto.",
  CHECKS_OPEN: "El paso tiene checks abiertos.",
  NOT_IN_REVIEW: "Ya no está en revisión.",
  MERGE_FAILED: "No se pudo fusionar: revisa el PR.",
  BASE_NOT_SANDBOX: "El cambio no apunta a la copia de prueba.",
  OWNER_CODE: "Publicar se hace en Bandeja, con tu código.",
  INVALID_ACTION: "Eso no se puede hacer aquí. Recarga la página y vuelve a intentarlo.",
  PR_NOT_OPEN: "El PR está cerrado sin fusionar: pide ajuste o que Taller abra otro.",
  NO_TICKET: "El mensaje no enlaza un paso.",
};

const START_WORDS: Record<string, string> = {
  queued: "Quedó en fila: arranca en cuanto haya lugar.",
  busy: "Ya está trabajando.",
  idle: "No tiene nada listo para empezar.",
  held: "No pudo arrancar: el uso de Claude está al límite.",
  fail: "No pudo arrancar. Míralo en Máquinas.",
};

export const refusal = (e: unknown) => (e instanceof ApiError ? (STEER_REFUSAL[e.code] ?? `No se pudo (${e.code}).`) : SLEEPY);

export type DecisionBusy = { id: string; key: string } | null;

export function useCorrienteActs() {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["company"] });
    void client.invalidateQueries({ queryKey: ["projects"] });
  };

  // ---- decisions (Te toca): the result stays in place; the next read keeps it (acted rows stay 24 h).
  const [acted, setActed] = useState<Record<string, Decision>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<DecisionBusy>(null);
  // Cambiar algo hands the order's words back, per project.
  const [prefill, setPrefill] = useState<Record<string, string>>({});
  const act = useMutation({
    mutationFn: (v: { d: Decision; input: DecisionInput; key: string }) => api.actDecision(v.d.id, v.input),
    onMutate: (v) => {
      setBusy({ id: v.d.id, key: v.key });
      setErrors((e) => ({ ...e, [v.d.id]: "" }));
    },
    onSuccess: (r, v) => {
      if (v.input.action === "verificar") return refresh();
      setActed((a) => ({ ...a, [v.d.id]: r.decision ?? { ...v.d, state: r.state, actions: [] } }));
      if (v.input.action === "cambiar" && v.d.project && typeof r.state?.result?.text === "string") setPrefill((x) => ({ ...x, [v.d.project!]: r.state.result.text as string }));
      refresh();
      void client.invalidateQueries({ queryKey: ["thread"] });
    },
    onError: (e, v) =>
      setErrors((x) => ({
        ...x,
        [v.d.id]:
          e instanceof ApiError
            ? (DECISION_REFUSAL[e.code] ?? ((e.code.startsWith("FILE_") || e.code === "NOT_WOKEN" || e.code === "NO_OWNER") && typeof e.detail.hint === "string" ? e.detail.hint : `No se pudo (${e.code}). Recarga la página: puede que ya haya cambiado.`))
            : SLEEPY,
      })),
    onSettled: () => setBusy(null),
  });
  const decide = (d: Decision, input: DecisionInput, key: string = input.action) => act.mutate({ d, input, key });
  const withActed = (decisions: Decision[]) => decisions.map((d) => acted[d.id] ?? d);

  // ---- quick calls: one key busy at a time; failures toast; the company is read again after.
  const [quick, setQuick] = useState<string | null>(null);
  const run = (key: string, fn: () => Promise<unknown>, ok?: (r: any) => string | null) => {
    setQuick(key);
    fn()
      .then((r) => {
        const said = ok?.(r);
        if (said) toast(said);
      })
      .catch((e) => toast.error(refusal(e)))
      .finally(() => {
        setQuick(null);
        refresh();
      });
  };

  return {
    refresh,
    decisions: { decide, withActed, busy, errors, prefill, setPrefill },
    busy: quick,
    stopRun: (id: string) => run(`stop-${id}`, () => api.stopRun(id)),
    resumeRun: (id: string) => run(`resume-${id}`, () => api.resumeRun(id)),
    start: (slug: string, agent: string, pastGuard = false) => run(`${slug}:start`, () => api.startTeammate(slug, agent, pastGuard), (r) => (r.started ? null : (START_WORDS[r.reason] ?? "No arrancó."))),
    plan: (slug: string, text: string) => run(`${slug}:plan`, () => api.askProject(slug, { text, mode: "ya" }), () => "Se lo pediste al PO."),
    autoAccept: (slug: string, on: boolean) =>
      run(`${slug}:auto`, () => api.setProjectOptions(slug, { auto_accept: on }), () => (on ? "Las entregas con pruebas en verde se aprueban solas, solo a la copia de prueba." : "Vuelves a aprobar cada entrega.")),
    autoInvisible: (slug: string, on: boolean) =>
      run(`${slug}:auto`, () => api.setProjectOptions(slug, { auto_accept_invisible: on }), () => (on ? "Las entregas que no cambian la pantalla se aprueban solas." : "Vuelves a aprobar también lo que no se ve.")),
    resend: (slug: string, key: string) =>
      run(`${slug}:request`, () => api.resendRequest(slug, key), (r) => (r.wake === "queued" ? "Se lo mandaste al PO otra vez." : r.wake === "busy" ? "El PO está ocupado; lo toma al terminar." : "Los avisos están apagados; lo ve en su próximo turno.")),
    closeRequest: (slug: string, key: string) => run(`${slug}:request`, () => api.cancelOrder(slug, key), () => "Pedido cerrado."),
    cancelOrder: (slug: string, key: string) => run(`cancel-${key}`, () => api.cancelOrder(slug, key)),
    pickNext: (slug: string, key: string) => run(`next-${key}`, () => api.pickNext(slug, key)),
    note: (slug: string, key: string, text: string) => run(`note-${key}`, () => api.noteTask(slug, key, text), () => "Se lo dijiste; lo lee en su siguiente paso"),
    resume: (slug: string) => run(`${slug}:resume`, () => api.setProjectPaused(slug, false)),
    pause: (slug: string) => run(`${slug}:pause`, () => api.setProjectPaused(slug, true)),
  };
}
export type CorrienteActs = ReturnType<typeof useCorrienteActs>;
