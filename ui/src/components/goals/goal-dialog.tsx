import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { GOAL_STATUSES, GOAL_STATUS_LABEL, type Goal, type GoalStatus, type GoalWrite } from "@/components/goals/model";
import { ApiError, api } from "@/lib/api";

type ProjectOption = { slug: string; title: string };

const goalError = (error: unknown) => {
  if (!(error instanceof ApiError)) return "No se pudo guardar la meta.";
  if (error.code === "INVALID_GOAL") return "Revisa el título, el estado o la fecha (AAAA-MM-DD).";
  if (error.code === "GOAL_NOT_FOUND") return "Esa meta no está.";
  if (error.code === "PROJECT_NOT_FOUND") return "Ese proyecto no existe.";
  return "No se pudo guardar la meta.";
};

export function GoalDialog({
  open,
  goal,
  fixedProject,
  projects,
  parents,
  onOpenChange,
}: {
  open: boolean;
  goal: Goal | null;
  fixedProject?: string;
  projects: ProjectOption[];
  parents: Goal[];
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const editing = goal !== null;
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [status, setStatus] = useState<GoalStatus>("active");
  const [targetOn, setTargetOn] = useState("");
  const [projectChoice, setProjectChoice] = useState("company");
  const [parentChoice, setParentChoice] = useState("none");

  useEffect(() => {
    if (!open) return;
    setTitle(goal?.title ?? "");
    setWhy(goal?.why ?? "");
    setStatus(goal?.status ?? "active");
    setTargetOn(goal?.target_on ?? "");
    setProjectChoice(fixedProject ?? "company");
    setParentChoice("none");
  }, [open, goal, fixedProject]);

  const save = useMutation({
    mutationFn: (body: GoalWrite) => (goal ? api.patchGoal(goal.id, body) : api.createGoal(body)),
    onSuccess: () => {
      toast(editing ? "Meta actualizada" : "Meta creada");
      onOpenChange(false);
    },
    onError: (error) => toast.error(goalError(error)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
  });

  const projectSlug = fixedProject ?? (projectChoice === "company" ? null : projectChoice);
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    const body: GoalWrite = {
      title: trimmed,
      why: why.trim(),
      status,
      target_on: targetOn.trim() ? targetOn.trim() : null,
    };
    if (!editing) {
      body.project = projectSlug;
      if (projectSlug && parentChoice !== "none") body.parent_id = parentChoice;
    }
    save.mutate(body);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar meta" : "Nueva meta"}</DialogTitle>
            <DialogDescription>La fecha solo se guarda. El avance sale de los tickets hechos.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="goal-title">Título</Label>
            <Input id="goal-title" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus required aria-label="Título" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="goal-why">Por qué</Label>
            <Textarea id="goal-why" value={why} onChange={(event) => setWhy(event.target.value)} aria-label="Por qué" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="goal-status">Estado</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as GoalStatus)}>
              <SelectTrigger id="goal-status" className="w-full" aria-label="Estado">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GOAL_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>{GOAL_STATUS_LABEL[value]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="goal-target">Objetivo</Label>
            <Input id="goal-target" type="date" value={targetOn} onChange={(event) => setTargetOn(event.target.value)} aria-label="Fecha objetivo" />
          </div>
          {!editing && !fixedProject && (
            <div className="grid gap-2">
              <Label htmlFor="goal-project">Proyecto</Label>
              <Select value={projectChoice} onValueChange={setProjectChoice}>
                <SelectTrigger id="goal-project" className="w-full" aria-label="Proyecto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="company">Empresa</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.slug} value={project.slug}>{project.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!editing && projectSlug && (
            <div className="grid gap-2">
              <Label htmlFor="goal-parent">Meta de la empresa</Label>
              <Select value={parentChoice} onValueChange={setParentChoice}>
                <SelectTrigger id="goal-parent" className="w-full" aria-label="Meta de la empresa">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin meta de empresa</SelectItem>
                  {parents.map((parent) => (
                    <SelectItem key={parent.id} value={parent.id}>{parent.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={!title.trim() || save.isPending}>{editing ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
