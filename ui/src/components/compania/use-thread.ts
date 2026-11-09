// PLA-I33: one thread's data and actions (GET /api/threads/:id, POST messages, POST actions), shared by
// Compañía (Asistente) and the project page (its PO). The panel itself is ThreadPanel in org.tsx.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, api, type ThreadAction, type ThreadMessage, type ThreadPostResult } from "@/lib/api";
import { THREAD_PAGE } from "@/lib/org";
import type { MessageBusy, SendState } from "@/components/compania/org";

const REFUSAL: Record<string, string> = {
  PROJECT_PAUSED: "El proyecto está en pausa: reanúdalo en Máquina.",
  COMPANY_PAUSED: "La compañía está detenida.",
  NO_PO: "Este proyecto no tiene PO.",
  ALREADY_DONE: "Ya se hizo.",
  MERGE_FAILED: "No se pudo fusionar: revisa el PR.",
};
const refusal = (e: unknown, what: string) => (e instanceof ApiError ? (REFUSAL[e.code] ?? `${what} (${e.code}).`) : `${what}. Si la Mac está dormida, intenta al despertar.`);

export function sentText(r: ThreadPostResult, who: "Asistente" | "el PO"): string {
  const made = r.created ? ` · ${r.created.kind === "idea" ? "idea" : "ticket"} ${r.created.key}` : "";
  const wake = r.wake === "queued" ? ` · ${who} despierta` : r.wake === "busy" ? ` · ${who} lo toma al terminar lo que corre` : r.wake === "off" ? ` · ${who} lo ve al despertar` : "";
  return `Enviado${made}${wake}`;
}

export function useThread(id: string | null | undefined, opts: { who: "Asistente" | "el PO"; invalidate?: string[][] }) {
  const client = useQueryClient();
  const thread = useQuery({ queryKey: ["thread", id], queryFn: () => api.thread(id!), enabled: !!id, refetchInterval: 20_000 });
  const [send, setSend] = useState<SendState>({ kind: "idle" });
  const [busy, setBusy] = useState<MessageBusy>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [shown, setShown] = useState(THREAD_PAGE);
  useEffect(() => {
    setSend({ kind: "idle" });
    setShown(THREAD_PAGE);
  }, [id]);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["thread", id] });
    for (const key of opts.invalidate ?? []) void client.invalidateQueries({ queryKey: key });
  };
  const post = useMutation({
    mutationFn: (body: string) => api.postMessage(id!, body),
    onMutate: () => setSend({ kind: "busy" }),
    onSuccess: (r) => {
      setSend({ kind: "done", text: sentText(r, opts.who) });
      refresh();
    },
    onError: (e) => setSend({ kind: "error", message: refusal(e, "No se pudo enviar") }),
  });
  const act = useMutation({
    mutationFn: (input: { message: ThreadMessage; action: ThreadAction; text?: string }) =>
      api.threadAction(id!, { message_id: input.message.id, action: input.action, ...(input.text ? { text: input.text } : {}) }),
    onMutate: (input) => {
      setBusy({ id: input.message.id, action: input.action });
      setActionError(null);
    },
    onSuccess: () => refresh(),
    onError: (e, input) => setActionError({ id: input.message.id, message: refusal(e, "No se pudo") }),
    onSettled: () => setBusy(null),
  });

  return {
    thread: thread.data,
    loading: !!id && thread.isPending,
    error: thread.isError,
    onRetry: () => void thread.refetch(),
    send,
    onSend: (body: string) => id && post.mutate(body),
    busy,
    actionError,
    onAction: (message: ThreadMessage, action: ThreadAction, text?: string) => id && act.mutate({ message, action, text }),
    expanded,
    onToggle: () => setExpanded((v) => !v),
    shown,
    onMore: () => setShown((n) => n + THREAD_PAGE),
  };
}
