// "Lista": the original grouped list with filters and closed tickets, kept beside the lanes
// for searching and bulk review. Status and priority change inline here.
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TaskControls } from "@/components/task-controls";
import { TaskRow } from "@/components/task-row";
import { groupTasks, type TaskListFilters } from "@/lib/groups";
import { PRIORITIES, TICKET_STATUSES, type TaskRow as Task } from "@/lib/types";

type Filters = TaskListFilters;

export function TaskList({ slug, tasks, openKey, onOpen }: { slug: string; tasks: Task[]; openKey: string | null; onOpen: (key: string) => void }) {
  const [filters, setFilters] = useState<Filters>({ status: "all", priority: "all", showClosed: false });
  const { groups, loose } = useMemo(() => groupTasks(tasks, filters), [tasks, filters]);

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Select value={filters.status} onValueChange={(status) => setFilters((f) => ({ ...f, status }))}>
          <SelectTrigger size="sm" className="w-40" aria-label="Filtrar por estado"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {TICKET_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.priority} onValueChange={(priority) => setFilters((f) => ({ ...f, priority }))}>
          <SelectTrigger size="sm" className="w-36" aria-label="Filtrar por prioridad"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda prioridad</SelectItem>
            {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 pl-1">
          <Switch id="show-closed" checked={filters.showClosed} onCheckedChange={(showClosed) => setFilters((f) => ({ ...f, showClosed }))} />
          <Label htmlFor="show-closed" className="text-sm font-normal">Cerrados</Label>
        </div>
      </div>

      {groups.length === 0 && loose.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            {filters.status !== "all" || filters.priority !== "all" ? "Nada coincide con los filtros." : "Nada abierto."}
          </CardContent>
        </Card>
      )}
      {groups.map(({ initiative, children }) => (
        <Card key={initiative.key} className="gap-0 divide-y py-0">
          <TaskRow slug={slug} task={initiative} selected={openKey === initiative.key} onOpen={onOpen} controls={<TaskControls slug={slug} task={initiative} />} />
          {children.map((t) => (
            <TaskRow key={t.key} slug={slug} task={t} nested selected={openKey === t.key} onOpen={onOpen} controls={<TaskControls slug={slug} task={t} />} />
          ))}
        </Card>
      ))}
      {loose.length > 0 && (
        <Card className="gap-0 divide-y py-0">
          <div className="px-4 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Sin iniciativa</div>
          {loose.map((t) => (
            <TaskRow key={t.key} slug={slug} task={t} selected={openKey === t.key} onOpen={onOpen} controls={<TaskControls slug={slug} task={t} />} />
          ))}
        </Card>
      )}
    </section>
  );
}
