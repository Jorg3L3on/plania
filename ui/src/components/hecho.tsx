// "Hecho": Jorge marks a human action done, with an optional note that lands in the ticket's log.
// The Bandeja's Pasos tab and the ticket sheet's "Te toca" use the same control.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function HechoForm({ slug, id, taskKey, className }: { slug: string; id: string; taskKey?: string | null; className?: string }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const act = useMutation({
    mutationFn: () => api.resolveBlocker(slug, id, note.trim() || undefined),
    onSuccess: () => {
      toast("Marcado como hecho");
      setNote("");
    },
    onError: () => toast.error("No se pudo guardar."),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project", slug] });
      if (taskKey) void queryClient.invalidateQueries({ queryKey: ["project", slug, "task", taskKey] });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    act.mutate();
  }
  return (
    <form onSubmit={submit} className={cn("flex min-w-0 items-center gap-2", className)}>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)" aria-label="Nota" className="h-8 min-w-0 flex-1 basis-32 text-xs sm:max-w-56" />
      <Button type="submit" size="sm" variant="outline" disabled={act.isPending}>
        Hecho
      </Button>
    </form>
  );
}
