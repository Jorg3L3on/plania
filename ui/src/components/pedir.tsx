// 2.12 Pedir on Inicio: one field and the project; it becomes a Backlog ticket (origin jorge) that agents
// read first. The project page's Pedir box left with PLA-I33-2: there Jorge writes to the PO's thread.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SendIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

// The project Inicio's field asked for last, per device.
const LAST_PROJECT = "plania.pedir.project";

const selectClass =
  "h-11 min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9 md:text-sm dark:bg-input/30";
const fieldClass = "h-11 text-base md:h-9 md:text-sm";

function useCreate(onCreated: (slug: string, key: string) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { slug: string; title: string; summary?: string; priority?: string; parent_key?: string }) => {
      const { slug, ...body } = input;
      return api.createTask(slug, body).then((t) => ({ slug, key: t.key }));
    },
    onSuccess: ({ slug, key }) => {
      toast(`Pedido como ${key}`);
      void queryClient.invalidateQueries({ queryKey: ["project", slug] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      onCreated(slug, key);
    },
    onError: (e) => toast.error(e instanceof ApiError && e.code === "TASK_NOT_FOUND" ? "Esa iniciativa ya no existe." : "No se pudo pedir."),
  });
}

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT);
  } catch {
    return null;
  }
}

function writeLast(slug: string) {
  try {
    localStorage.setItem(LAST_PROJECT, slug);
  } catch {
    // Private mode: the picker just starts on the first project.
  }
}

/** Inicio's one-field version: a sentence and the project; the ticket opens on its project page. */
export function PedirHome({ projects }: { projects: { slug: string; title: string }[] }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState(() => readLast());
  const slug = projects.some((p) => p.slug === picked) ? picked! : (projects[0]?.slug ?? "");
  const create = useCreate((s, key) => {
    setTitle("");
    writeLast(s);
    navigate(`/p/${s}?task=${encodeURIComponent(key)}`);
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !slug || create.isPending) return;
    create.mutate({ slug, title: title.trim() });
  }
  if (!projects.length) return null;
  return (
    <form onSubmit={submit} className="flex animate-rise flex-wrap gap-2 rounded-[20px] border bg-card/60 p-2.5 sm:flex-nowrap" aria-label="Pedir">
      <Input
        aria-label="Qué necesitas"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Pedir algo…"
        className={cn(fieldClass, "basis-full sm:basis-auto")}
        enterKeyHint="send"
      />
      <select
        aria-label="Proyecto"
        value={slug}
        onChange={(e) => {
          setPicked(e.target.value);
          writeLast(e.target.value);
        }}
        className={cn(selectClass, "flex-1 sm:w-40 sm:flex-none")}
      >
        {projects.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.title}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={!title.trim() || create.isPending} className="h-11 shrink-0 px-4 md:h-9">
        <SendIcon aria-hidden /> Pedir
      </Button>
    </form>
  );
}
