import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "./api";
import { useLive } from "./live";
import type { ProjectDetail } from "./types";

type Patch = { status?: string; priority?: string; note?: string };

const MESSAGES: Record<string, string> = {
  BLOCKED_REQUIRES_NOTE: "Blocked necesita una nota.",
  INVALID_STATUS: "Ese estado no aplica aquí.",
  INVALID_PRIORITY: "Esa prioridad no aplica aquí.",
  TASK_NOT_FOUND: "La tarea ya no existe.",
};

const describe = (e: unknown) =>
  (e instanceof ApiError && MESSAGES[e.code]) || "No se pudo guardar el cambio.";

// Status and priority changes: applied to the cache at once, rolled back if the server refuses.
export function useTaskPatch(slug: string) {
  const queryClient = useQueryClient();
  const { markLocal } = useLive();
  const queryKey = ["project", slug];

  // Undo calls the API directly: the row that offered it may already be gone (e.g. hidden once Done).
  function undoTo(key: string, patch: Patch) {
    markLocal(slug, key);
    api
      .patchTask(slug, key, patch)
      .then(() => toast(`${key} → ${patch.status}`))
      .catch((e: unknown) => toast.error(describe(e)))
      .finally(() => void queryClient.invalidateQueries({ queryKey }));
  }

  const mutation = useMutation({
    mutationFn: ({ key, patch }: { key: string; patch: Patch; undo?: Patch }) => api.patchTask(slug, key, patch),
    onMutate: async ({ key, patch }) => {
      markLocal(slug, key); // our own echo from the live stream should not flash the row
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ProjectDetail>(queryKey);
      if (previous) {
        queryClient.setQueryData<ProjectDetail>(queryKey, {
          ...previous,
          tasks: previous.tasks.map((t) =>
            t.key !== key
              ? t
              : {
                  ...t,
                  ...(patch.status !== undefined && {
                    status: patch.status,
                    blocked_note: patch.status === "Blocked" ? (patch.note ?? null) : null,
                  }),
                  ...(patch.priority !== undefined && { priority: patch.priority }),
                },
          ),
        });
      }
      return { previous };
    },
    // Lives on the mutation, not on mutate(): it still runs if the row unmounted meanwhile.
    onSuccess: (_data, { key, patch, undo }) => {
      if (!undo) return;
      toast(`${key} → ${patch.status}`, {
        duration: 8000,
        action: { label: "Deshacer", onClick: () => undoTo(key, undo) },
      });
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast.error(describe(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  // Status changes get an undo that puts the previous status back (with its note, if it was Blocked).
  function setStatus(key: string, from: { status: string; note: string | null }, to: string, note?: string) {
    const undo: Patch = { status: from.status, ...(from.status === "Blocked" && from.note ? { note: from.note } : {}) };
    mutation.mutate({ key, patch: { status: to, note }, undo });
  }

  const setPriority = (key: string, priority: string) => mutation.mutate({ key, patch: { priority } });

  return { setStatus, setPriority, pending: mutation.isPending };
}
