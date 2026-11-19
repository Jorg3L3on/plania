import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PlaniaMark } from "@/components/plania-mark";
import { ApiError, api } from "@/lib/api";
import { DEFAULT_PROJECTS_ROOT, DEFAULT_WORKTREES_ROOT, WORDS, browserTimeZone, formProblem, refusalText, type FirstStartForm } from "@/lib/primer-arranque";
import { FaltaPage } from "@/pages/falta";

// PLA-I2-2: the first-start screen. Shown only while Plania has no owner (GET /api/first-start); once it is done,
// the owner is signed in and lands on the company, paused. Words in lib/primer-arranque.ts.

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      {children}
    </div>
  );
}

function Field({ id, label, hint, ...input }: { id: string; label: string; hint?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...input} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function PrimerArranquePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: ["first-start"], queryFn: () => api.firstStart() });
  const [form, setForm] = useState<FirstStartForm>(() => ({ code: "", name: "", password: "", repeat: "", time_zone: browserTimeZone(), projects_root: DEFAULT_PROJECTS_ROOT, worktrees_root: DEFAULT_WORKTREES_ROOT }));
  const [shown, setShown] = useState<string | null>(null);
  const set = (k: keyof FirstStartForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const finish = useMutation({
    mutationFn: () => api.finishFirstStart({ code: form.code, name: form.name, password: form.password, time_zone: form.time_zone, projects_root: form.projects_root, worktrees_root: form.worktrees_root }),
    // Removed, not invalidated: a refetched `open: false` would send this page to /login before navigate runs,
    // and the old UNAUTHORIZED session would do the same on the company page.
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["first-start"] });
      queryClient.removeQueries({ queryKey: ["session"] });
      navigate("/", { replace: true });
    },
    onError: (e) => setShown(e instanceof ApiError ? refusalText(e.code, e.detail) : refusalText("")),
  });

  if (state.isPending) {
    return (
      <Frame>
        <Skeleton className="h-96 w-full max-w-md" />
      </Frame>
    );
  }
  if (state.data && !state.data.open) return <Navigate to="/login" replace />;

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = formProblem(form);
    setShown(problem);
    if (!problem) finish.mutate();
  }

  return (
    <Frame>
      <Card className="w-full max-w-md">
        <CardHeader>
          <PlaniaMark className="mb-2 size-10" />
          <CardTitle className="font-display text-xl font-extrabold tracking-tight">{WORDS.title}</CardTitle>
          <CardDescription>{WORDS.lead}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {state.data && !state.data.loopback ? <p className="text-sm text-destructive">{WORDS.notLoopback}</p> : null}
          <div className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
            <p>{WORDS.machine}.</p>
            <Link to="/primer-arranque/falta" className="font-medium underline underline-offset-2">
              {WORDS.machineLink}
            </Link>
          </div>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <Field id="code" label={WORDS.code} hint={WORDS.codeHint} autoComplete="one-time-code" autoFocus value={form.code} onChange={set("code")} />
            <Field id="name" label={WORDS.name} hint={WORDS.nameHint} autoComplete="name" value={form.name} onChange={set("name")} />
            <Field id="password" label={WORDS.password} hint={WORDS.passwordHint} type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
            <Field id="repeat" label={WORDS.repeat} type="password" autoComplete="new-password" value={form.repeat} onChange={set("repeat")} />
            <Field id="time_zone" label={WORDS.timeZone} hint={WORDS.timeZoneHint} value={form.time_zone} onChange={set("time_zone")} />
            <Field id="projects_root" label={WORDS.projectsRoot} hint={WORDS.projectsRootHint} value={form.projects_root} onChange={set("projects_root")} />
            <Field id="worktrees_root" label={WORDS.worktreesRoot} hint={WORDS.worktreesRootHint} value={form.worktrees_root} onChange={set("worktrees_root")} />
            <p className="text-sm text-muted-foreground">{WORDS.paused}</p>
            {shown ? <p className="text-sm text-destructive">{shown}</p> : null}
            <Button type="submit" disabled={finish.isPending}>
              {finish.isPending ? WORDS.submitting : WORDS.submit}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Frame>
  );
}

/** The machine check before there is a session, with the way back to the form. */
export function PrimerArranqueFaltaPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
      <Link to="/primer-arranque" className="text-sm underline underline-offset-2">
        {WORDS.back}
      </Link>
      <FaltaPage firstStart />
    </div>
  );
}
