// 2.12 Pedir: Jorge asks for something and it becomes a Backlog ticket (origin jorge) that agents
// read first. On a project's header: a title, an optional line, an optional initiative and the
// priority (P2 unless changed). On Inicio: one field and the project. Both fit a phone; the new
// ticket opens in the sheet.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SendIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import type { Request, TaskRow } from "@/lib/types";
import { cn } from "@/lib/utils";

const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
const CLOSED = ["Done", "Won't do"];
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

/** The project's Pedir box: the title first; the rest shows once there is something to ask. */
export function PedirBox({ slug, tasks, requests, onOpen }: { slug: string; tasks: TaskRow[]; requests?: Request[]; onOpen: (key: string) => void }) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [parent, setParent] = useState("");
  const [priority, setPriority] = useState("P2");
  const initiatives = tasks.filter((t) => t.kind === "initiative" && !CLOSED.includes(t.status));
  const create = useCreate((_slug, key) => {
    setTitle("");
    setSummary("");
    setParent("");
    setPriority("P2");
    onOpen(key);
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || create.isPending) return;
    create.mutate({ slug, title: title.trim(), summary: summary.trim() || undefined, priority, parent_key: parent || undefined });
  }
  const open = title.trim().length > 0;
  return (
    <section aria-labelledby={`${id}-t`} className="grid animate-rise gap-2.5 rounded-[20px] border bg-card/60 px-4 py-3.5 sm:px-5">
      <form onSubmit={submit} className="grid gap-2.5">
        <label id={`${id}-t`} htmlFor={`${id}-title`} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Pedir
        </label>
        <div className="flex gap-2">
          <Input
            id={`${id}-title`}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="¿Qué necesitas en este proyecto?"
            className={fieldClass}
            enterKeyHint="send"
          />
          <Button type="submit" disabled={!open || create.isPending} className="h-11 shrink-0 px-4 md:h-9">
            <SendIcon aria-hidden /> Pedir
          </Button>
        </div>
        {open && (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <Input
              aria-label="Una línea más (opcional)"
              value={summary}
              maxLength={500}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Una línea más (opcional)"
              className={fieldClass}
            />
            <select aria-label="Iniciativa" value={parent} onChange={(e) => setParent(e.target.value)} className={cn(selectClass, "sm:max-w-56")}>
              <option value="">Sin iniciativa</option>
              {initiatives.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.key} · {i.title}
                </option>
              ))}
            </select>
            <select aria-label="Prioridad" value={priority} onChange={(e) => setPriority(e.target.value)} className={selectClass}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        )}
      </form>
      {(requests?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{requests!.length === 1 ? "Un pedido abierto:" : `${requests!.length} pedidos abiertos:`}</span>
          {requests!.slice(0, 6).map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => onOpen(r.key)}
              title={r.title}
              className="inline-flex min-h-8 max-w-60 items-center gap-1.5 rounded-full border px-2.5 transition hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="font-mono text-[11px]">{r.key}</span>
              <span className="truncate text-foreground">{r.title}</span>
              {r.claimed && <span className="size-1.5 shrink-0 rounded-full bg-status-now" aria-label="en curso" />}
            </button>
          ))}
        </div>
      )}
    </section>
  );
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
