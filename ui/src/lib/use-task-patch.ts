import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "./api";
import { words } from "./i18n";
import { useLive } from "./live";
import { TASK_PATCH_WORDS } from "./task-patch-words";
import type { ProjectDetail } from "./types";

type Patch = { status?: string; priority?: string; note?: string; reason?: string };

const TERMINAL = new Set(["Done", "Won't do"]);
type Target = { key: string; title: string; version: number };

// PLA-I56-2: a refused initiative Done names the tickets still open.
const describe = (e: unknown) => {
  const w = words(TASK_PATCH_WORDS);
  if (e instanceof ApiError && e.code === "INITIATIVE_CHILDREN_OPEN" && Array.isArray(e.detail?.open) && e.detail.open.length)
    return w.childrenOpen((e.detail.open as string[]).join(", "));
  return (e instanceof ApiError && w.refused[e.code]) || w.failed;
};

// Status and priority changes: applied to the cache at once, rolled back if the server refuses.
// Each carries the version on screen, so a change an agent made meanwhile is never overwritten.
export function useTaskPatch(slug: string) {
  const queryClient = useQueryClient();
  const { markLocal } = useLive();
  const queryKey = ["project", slug];

  const setVersion = (key: string, version: number) =>
    queryClient.setQueryData<ProjectDetail>(queryKey, (p) =>
      p && { ...p, tasks: p.tasks.map((t) => (t.key === key ? { ...t, version } : t)) },
    );

  // Undo calls the API directly: the row that offered it may already be gone (e.g. hidden once Done).
  function undoTo({ key, title, version }: Target, patch: Patch) {
    markLocal(slug, key);
    api
      .patchTask(slug, key, { ...patch, version })
      .then(() => toast(`${title} → ${patch.status}`))
      .catch((e: unknown) => toast.error(describe(e)))
      .finally(() => void queryClient.invalidateQueries({ queryKey }));
  }

  const mutation = useMutation({
    mutationFn: ({ target, patch }: { target: Target; patch: Patch; undo?: Patch }) =>
      api.patchTask(slug, target.key, { ...patch, version: target.version }),
    onMutate: async ({ target: { key }, patch }) => {
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
    onSuccess: (data, { target, patch, undo }) => {
      setVersion(target.key, data.version);
      // Closing with things still running on the machine: say what and how to remove each (Plania never runs them).
      const live = (data.warnings ?? []).filter((w): w is Exclude<typeof w, string> => typeof w !== "string" && w.code === "FOOTPRINT_LIVE");
      if (live.length) {
        toast.warning(words(TASK_PATCH_WORDS).stillRunning(target.title, live.length), {
          duration: 15000,
          description: live.map((w) => `${w.kind} ${w.locator}${w.teardown ? `: ${w.teardown}` : ""}`).join("\n"),
        });
      }
      if (!undo) return;
      toast(`${target.title} → ${patch.status}`, {
        duration: 8000,
        action: { label: words(TASK_PATCH_WORDS).undo, onClick: () => undoTo({ ...target, version: data.version }, undo) },
      });
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast.error(describe(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  // Status changes get an undo that puts the previous status back (with its note, if it was Blocked).
  // Leaving Done or Won't do, or returning to Won't do, is a logged move and the undo carries a reason.
  function setStatus(target: Target, from: { status: string; note: string | null }, to: string, note?: string, reason?: string) {
    const undo: Patch = {
      status: from.status,
      ...(from.status === "Blocked" && from.note ? { note: from.note } : {}),
      ...(TERMINAL.has(to) || from.status === "Won't do" ? { reason: "deshacer" } : {}),
    };
    mutation.mutate({ target, patch: { status: to, note, ...(reason ? { reason } : {}) }, undo });
  }

  const setPriority = (target: Target, priority: string) => mutation.mutate({ target, patch: { priority } });

  return { setStatus, setPriority, pending: mutation.isPending };
}
