// PLA-I62: La corriente's calls, the same ones /ceo makes (pages/ceo.tsx), gathered in one hook so every screen acts
// the same way: a decision (Aceptar, Pedir ajuste, an answer, a plan), a run (Detener, Reanudar corrida), starting a
// teammate (also past the guard), the PO's plan order, the accept-by-itself switches, a request nobody took (Reenviar,
// Cerrar), a note to a teammate, picking the next paso, pausing and resuming. The refusal words are /ceo's.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api, uploadPedidoImages, type Decision, type DecisionInput, type IdeaAnswerInput, type IdeaDecisionInput, type PedidoStop } from "@/lib/api";
import { arranqueLine } from "@/lib/arranque";
import { words } from "@/lib/i18n";
import { ACTS_WORDS } from "@/lib/acts-words";

// PLA-I2-10: the words live in @/lib/acts-words; these exports stay for the files that import them (the language is
// fixed for the page's life, so reading them once at load is the same as reading them at use).
export const SLEEPY: string = words(ACTS_WORDS).sleepy;
export const STEER_REFUSAL: Record<string, string> = words(ACTS_WORDS).steerRefusal;
export const DECISION_REFUSAL: Record<string, string> = words(ACTS_WORDS).decisionRefusal;

export const refusal = (e: unknown) => {
  const w = words(ACTS_WORDS);
  return e instanceof ApiError ? (w.steerRefusal[e.code] ?? w.failedCode(e.code)) : w.sleepy;
};

export type DecisionBusy = { id: string; key: string } | null;

export function useCorrienteActs() {
  const client = useQueryClient();
  const w = words(ACTS_WORDS);
  // PLA-112 (guided test PLA-86, F-4): an open step or idea view reads again too; after «Quitar» the ficha still said
  // «Pasó a Backlog».
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["company"] });
    void client.invalidateQueries({ queryKey: ["projects"] });
    void client.invalidateQueries({ queryKey: ["task"] });
    void client.invalidateQueries({ queryKey: ["idea"] });
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
            ? (w.decisionRefusal[e.code] ?? ((e.code.startsWith("FILE_") || e.code === "NOT_WOKEN" || e.code === "NO_OWNER") && typeof e.detail.hint === "string" ? e.detail.hint : w.decisionFailed(e.code)))
            : w.sleepy,
      })),
    onSettled: () => setBusy(null),
  });
  const decide = (d: Decision, input: DecisionInput, key: string = input.action) => act.mutate({ d, input, key });
  const withActed = (decisions: Decision[]) => decisions.map((d) => acted[d.id] ?? d);

  // ---- quick calls: one key busy at a time; failures toast; the company is read again after.
  const [quick, setQuick] = useState<string | null>(null);
  // PLA-I64-4: the last refusal per call key, so a row can say it in place (the toast says it too).
  const [failed, setFailed] = useState<Record<string, string>>({});
  const run = (key: string, fn: () => Promise<unknown>, ok?: (r: any) => string | null, say: (e: unknown) => string = refusal) => {
    setQuick(key);
    setFailed((f) => (f[key] ? { ...f, [key]: "" } : f));
    fn()
      .then((r) => {
        const said = ok?.(r);
        if (said) toast(said);
      })
      .catch((e) => {
        const said = say(e);
        setFailed((f) => ({ ...f, [key]: said }));
        toast.error(said);
      })
      .finally(() => {
        setQuick(null);
        refresh();
      });
  };

  return {
    refresh,
    decisions: { decide, withActed, busy, errors, prefill, setPrefill },
    busy: quick,
    failed,
    stopRun: (id: string) => run(`stop-${id}`, () => api.stopRun(id)),
    resumeRun: (id: string) => run(`resume-${id}`, () => api.resumeRun(id)),
    start: (slug: string, agent: string, pastGuard = false, key: string | null = null) => run(`${slug}:start`, () => api.startTeammate(slug, agent, pastGuard, key), (r) => (r.started ? null : ((r.reason === "fail" && arranqueLine(r.summary)) || (w.start[r.reason] ?? w.notStarted)))),
    plan: (slug: string, text: string) => run(`${slug}:plan`, () => api.askProject(slug, { text, mode: "ya" }), () => w.planAsked),
    autoAccept: (slug: string, on: boolean) =>
      run(`${slug}:auto`, () => api.setProjectOptions(slug, { auto_accept: on }), () => (on ? w.autoAcceptOn : w.autoAcceptOff)),
    autoInvisible: (slug: string, on: boolean) =>
      run(`${slug}:auto`, () => api.setProjectOptions(slug, { auto_accept_invisible: on }), () => (on ? w.autoInvisibleOn : w.autoInvisibleOff)),
    resend: (slug: string, key: string) =>
      run(`${slug}:request`, () => api.resendRequest(slug, key), (r) => (r.wake === "queued" ? w.resendQueued : r.wake === "busy" ? w.resendBusy : w.resendOff)),
    closeRequest: (slug: string, key: string) => run(`${slug}:request`, () => api.cancelOrder(slug, key), () => w.requestClosed),
    cancelOrder: (slug: string, key: string) => run(`cancel-${key}`, () => api.cancelOrder(slug, key)),
    pickNext: (slug: string, key: string) => run(`next-${key}`, () => api.pickNext(slug, key)),
    note: (slug: string, key: string, text: string) => run(`note-${key}`, () => api.noteTask(slug, key, text), () => w.noteSent),
    resume: (slug: string) => run(`${slug}:resume`, () => api.setProjectPaused(slug, false)),
    // PLA-I54-3/4, PLA-I61: a request or idea (Guardar, Restaurar, Descartar, Constrúyelo), its question, a wake.
    pedido: (slug: string, key: string, action: "guardar" | "restaurar" | "descartar" | "construir") =>
      run(`pedido-${key}:${action}`, async () => {
        await api.pedidoAct(slug, key, action);
        void client.invalidateQueries({ queryKey: ["idea", slug, key] });
      }),
    answerQuestion: (slug: string, key: string, questionId: string, text: string) =>
      run(`pedido-${key}:answer`, async () => {
        await api.answer(slug, questionId, text);
        void client.invalidateQueries({ queryKey: ["idea", slug, key] });
      }),
    despertar: (slug: string, key: string) =>
      run(`pedido-${key}:despertar`, async () => {
        await api.ideaDespertar(slug, key);
        void client.invalidateQueries({ queryKey: ["idea", slug, key] });
      }),
    // PLA-I61: an answer to a stop (Me gusta, notes, an option, Deshacer), a note with its pictures, and «seen».
    respuesta: (slug: string, key: string, input: IdeaAnswerInput) =>
      run(`pedido-${key}:respuesta`, async () => {
        await api.ideaRespuesta(slug, key, input);
        void client.invalidateQueries({ queryKey: ["idea", slug, key] });
      }),
    // AUDIT-8: his pick on one of the PO's decisions. The server's refusal is already in his words.
    decision: (slug: string, key: string, input: IdeaDecisionInput) =>
      run(
        `pedido-${key}:decision`,
        async () => {
          try {
            const r = await api.ideaDecision(slug, key, input);
            void client.invalidateQueries({ queryKey: ["idea", slug, key] });
            return r;
          } catch (e) {
            if (!(e instanceof ApiError) || e.status === 401 || typeof e.detail.hint !== "string") throw e;
            toast.error(e.detail.hint);
            void client.invalidateQueries({ queryKey: ["idea", slug, key] });
            return null;
          }
        },
        (r) => (!r ? null : r.changed ? w.decisionChanged : w.decisionKept),
      ),
    notePedido: (slug: string, key: string, text: string, files: File[]) =>
      run(`pedido-${key}:note`, async () => {
        await api.noteTask(slug, key, text);
        if (files.length) {
          const r = await uploadPedidoImages(slug, key, files);
          if (r.error) toast.error(typeof r.error.detail.message === "string" ? r.error.detail.message : w.imageFailed);
        }
        void client.invalidateQueries({ queryKey: ["idea", slug, key] });
      }),
    visto: (slug: string, key: string, stop: PedidoStop) => void api.ideaVisto(slug, key, stop).then(() => client.invalidateQueries({ queryKey: ["idea", slug, key] }), () => undefined),
    pause: (slug: string) => run(`${slug}:pause`, () => api.setProjectPaused(slug, true)),
    // PLA-I64-4: Pasar a Lista (a step that only sits in Backlog goes to Ready, as the owner would on the board) and
    // Cerrar iniciativa from the list (the board's call, PLA-I56-2).
    aLista: (slug: string, key: string) =>
      run(
        `lista-${key}`,
        async () => {
          const t = await api.task(slug, key);
          await api.patchTask(slug, key, { status: "Ready", version: t.version });
        },
        () => w.toReady,
        (e) => (e instanceof ApiError && e.code === "INVALID_TRANSITION" ? w.notInBacklog : e instanceof ApiError && e.code === "STALE_VERSION" ? w.stale : refusal(e)),
      ),
    // PLA-161: Aplazar from En fila: a Ready step back to Backlog, or its initiative On hold.
    aplazar: (slug: string, key: string, to: "Backlog" | "On hold") =>
      run(
        `aplazar-${key}`,
        async () => {
          const t = await api.task(slug, key);
          await api.patchTask(slug, key, { status: to, version: t.version });
        },
        () => (to === "On hold" ? w.held : w.postponed),
        (e) => (e instanceof ApiError && e.code === "INVALID_TRANSITION" ? w.notReady : e instanceof ApiError && e.code === "STALE_VERSION" ? w.stale : refusal(e)),
      ),
    cerrar: (slug: string, key: string, version: number) =>
      run(
        `cerrar-${key}`,
        () => api.patchTask(slug, key, { status: "Done", version }),
        () => w.initiativeClosed,
        (e) =>
          e instanceof ApiError && e.code === "INITIATIVE_CHILDREN_OPEN"
            ? w.childrenOpen
            : e instanceof ApiError && e.code === "STALE_VERSION"
              ? w.stale
              : refusal(e),
      ),
  };
}
export type CorrienteActs = ReturnType<typeof useCorrienteActs>;
