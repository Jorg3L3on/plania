// PLA-I33: one thread's data and actions (GET /api/threads/:id, POST messages, POST actions), shared by
// Compañía (Asistente) and the project page (its PO). The panel itself is ThreadPanel in org.tsx.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, api, type ThreadAction, type ThreadMessage, type ThreadPostResult } from "@/lib/api";
import { THREAD_PAGE } from "@/lib/org";
import type { MessageBusy, SendState } from "@/components/compania/org";
import { getLanguage, words, type Language } from "@/lib/i18n";
import { COMPANIA_THREAD } from "@/lib/compania-words";

// PLA-I2-10: the words are COMPANIA_THREAD's (lib/compania-words.ts). `who` stays the Spanish value callers pass.
const refusal = (e: unknown, what: string) => {
  const w = words(COMPANIA_THREAD);
  return e instanceof ApiError ? (w.refusal[e.code] ?? w.refusedCode(what, e.code)) : w.asleep(what);
};

export function sentText(r: ThreadPostResult, who: "Asistente" | "el PO", language: Language = getLanguage()): string {
  const w = words(COMPANIA_THREAD, language);
  const name = who === "el PO" ? w.thePo : w.asistente;
  const made = r.created ? ` · ${r.created.kind === "idea" ? w.idea : w.ticket} ${r.created.key}` : "";
  const wake = r.wake === "queued" ? w.wakes(name) : r.wake === "busy" ? w.afterCurrent(name) : r.wake === "off" ? w.onWake(name) : "";
  return w.sent(`${made}${wake}`);
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
    onError: (e) => setSend({ kind: "error", message: refusal(e, words(COMPANIA_THREAD).couldNotSend) }),
  });
  const act = useMutation({
    mutationFn: (input: { message: ThreadMessage; action: ThreadAction; text?: string }) =>
      api.threadAction(id!, { message_id: input.message.id, action: input.action, ...(input.text ? { text: input.text } : {}) }),
    onMutate: (input) => {
      setBusy({ id: input.message.id, action: input.action });
      setActionError(null);
    },
    onSuccess: () => refresh(),
    onError: (e, input) => setActionError({ id: input.message.id, message: refusal(e, words(COMPANIA_THREAD).couldNot) }),
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
