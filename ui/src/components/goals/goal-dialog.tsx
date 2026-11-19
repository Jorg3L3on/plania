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
import { words } from "@/lib/i18n";
import { GOALS_WORDS } from "@/lib/goals-words";

type ProjectOption = { slug: string; title: string };

const goalError = (error: unknown) => {
  const w = words(GOALS_WORDS);
  if (!(error instanceof ApiError)) return w.saveFailed;
  if (error.code === "INVALID_GOAL") return w.invalid;
  if (error.code === "GOAL_NOT_FOUND") return w.notFound;
  if (error.code === "PROJECT_NOT_FOUND") return w.projectNotFound;
  return w.saveFailed;
};

export function GoalDialog({
  open,
  goal,
  fixedProject,
  projects,
  parents,
  onOpenChange,
  onSaved,
}: {
  // PLA-I36-4: Compañía refreshes its cards after Fijar.
  onSaved?: () => void;
  open: boolean;
  goal: Goal | null;
  fixedProject?: string;
  projects: ProjectOption[];
  parents: Goal[];
  onOpenChange: (open: boolean) => void;
}) {
  const w = words(GOALS_WORDS);
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
      toast(editing ? w.updated : w.created);
      onSaved?.();
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
            <DialogTitle>{editing ? w.editTitle : w.newGoal}</DialogTitle>
            <DialogDescription>{w.dateNote}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="goal-title">{w.title}</Label>
            <Input id="goal-title" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus required aria-label={w.title} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="goal-why">{w.why}</Label>
            <Textarea id="goal-why" value={why} onChange={(event) => setWhy(event.target.value)} aria-label={w.why} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="goal-status">{w.statusLabel}</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as GoalStatus)}>
              <SelectTrigger id="goal-status" className="w-full" aria-label={w.statusLabel}>
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
            <Label htmlFor="goal-target">{w.targetLabel}</Label>
            <Input id="goal-target" type="date" value={targetOn} onChange={(event) => setTargetOn(event.target.value)} aria-label={w.targetDate} />
          </div>
          {!editing && !fixedProject && (
            <div className="grid gap-2">
              <Label htmlFor="goal-project">{w.project}</Label>
              <Select value={projectChoice} onValueChange={setProjectChoice}>
                <SelectTrigger id="goal-project" className="w-full" aria-label={w.project}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="company">{w.company}</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.slug} value={project.slug}>{project.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!editing && projectSlug && (
            <div className="grid gap-2">
              <Label htmlFor="goal-parent">{w.companyGoal}</Label>
              <Select value={parentChoice} onValueChange={setParentChoice}>
                <SelectTrigger id="goal-parent" className="w-full" aria-label={w.companyGoal}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{w.noCompanyGoal}</SelectItem>
                  {parents.map((parent) => (
                    <SelectItem key={parent.id} value={parent.id}>{parent.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{w.cancel}</Button>
            <Button type="submit" disabled={!title.trim() || save.isPending}>{editing ? w.save : w.create}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
