import { CheckIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PriorityLabel, StatusLabel } from "@/components/task-row";
import { statusDot } from "@/lib/status";
import { CLOSED_STATUSES, IDEA_STATUSES, INITIATIVE_STATUSES, PRIORITIES, TICKET_STATUSES, type TaskRow as Row } from "@/lib/types";
import { useTaskPatch } from "@/lib/use-task-patch";
import { cn } from "@/lib/utils";

// What the controls need from a task: a list row and the side panel's full task both have it.
type TaskRow = Pick<Row, "key" | "title" | "kind" | "status" | "priority" | "blocked_note" | "version">;

function BlockedDialog({
  task,
  open,
  onOpenChange,
  onConfirm,
}: {
  task: TaskRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    onConfirm(note.trim());
    setNote("");
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Bloquear «{task.title}»</DialogTitle>
            <DialogDescription>Di qué lo bloquea. La nota se muestra en la lista y la leen los agentes.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`blocked-${task.key}`}>Nota</Label>
            <Textarea
              id={`blocked-${task.key}`}
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Esperando…"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={!note.trim()}>Bloquear</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TaskControls({ slug, task }: { slug: string; task: TaskRow }) {
  const { setStatus, setPriority } = useTaskPatch(slug);
  const [blocking, setBlocking] = useState(false);
  const statuses = task.kind === "initiative" ? INITIATIVE_STATUSES : task.kind === "idea" ? IDEA_STATUSES : TICKET_STATUSES;
  // Jorge marks Done after merging: tickets offer it once In review, initiatives while open, ideas from Open.
  const from = { status: task.status, note: task.blocked_note };
  const offerDone = task.kind === "idea" ? task.status === "Open" : task.kind === "initiative" ? !CLOSED_STATUSES.has(task.status) : task.status === "In review";

  function chooseStatus(next: string) {
    if (next === task.status) return;
    if (next === "Blocked") setBlocking(true);
    else setStatus(task, from, next);
  }

  return (
    <>
      {offerDone && (
        <Button size="sm" variant="outline" onClick={() => setStatus(task, from, "Done")}>
          <CheckIcon /> Done
        </Button>
      )}

      {task.kind === "ticket" && task.priority && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="rounded-4xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-label={`Prioridad de ${task.title}: ${task.priority}`}
          >
            <PriorityLabel priority={task.priority} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Prioridad</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={task.priority} onValueChange={(p) => p !== task.priority && setPriority(task, p)}>
              {PRIORITIES.map((p) => (
                <DropdownMenuRadioItem key={p} value={p} className="font-mono">{p}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="px-2" aria-label={`Estado de ${task.title}: ${task.status}`}>
            <StatusLabel status={task.status} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Estado</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={task.status} onValueChange={chooseStatus}>
            {statuses.map((s) => (
              <DropdownMenuRadioItem key={s} value={s}>
                <span className={cn("size-2 rounded-full", statusDot(s))} />
                {s}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <BlockedDialog
        task={task}
        open={blocking}
        onOpenChange={setBlocking}
        onConfirm={(note) => {
          setBlocking(false);
          setStatus(task, from, "Blocked", note);
        }}
      />
    </>
  );
}
