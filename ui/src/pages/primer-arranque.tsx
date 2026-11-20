import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PlaniaMark } from "@/components/plania-mark";
import { ApiError, api } from "@/lib/api";
import { FIRST_START, browserTimeZone, codeFromHash, formProblem, initialForm, problemInOptions, refusalText, showCodeField, type FirstStartForm, type FirstStartState } from "@/lib/primer-arranque";
import { LANGUAGES, LANGUAGE_NAMES, adoptLanguage, getLanguage, words, type Language } from "@/lib/i18n";
import { LANGUAGE_WORDS } from "@/lib/language-words";
import { FaltaPage } from "@/pages/falta";

// PLA-I2-2: the first-start screen. Shown only while Plania has no owner (GET /api/first-start); once it is done,
// the owner is signed in and lands on the company, paused. Words in lib/primer-arranque.ts.
// F4, F5 (first-install audit): the code comes in the address fragment from the install, and the form shows only the
// language, the name and the password; the time zone and the two folders wait under «Más opciones».

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

/** PLA-I2-10: the language comes first; choosing one reloads the screen in it (the form is still empty then). */
function LanguageChoice() {
  const w = words(LANGUAGE_WORDS);
  const choose = (l: Language) => {
    if (adoptLanguage(l)) window.location.reload();
  };
  return (
    <div className="grid gap-2">
      <Label htmlFor="language">{w.firstStart}</Label>
      <select id="language" className="h-9 rounded-md border bg-transparent px-3 text-sm" value={getLanguage()} onChange={(e) => choose(e.target.value as Language)}>
        {LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {LANGUAGE_NAMES[l]}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">{w.firstStartHint}</p>
    </div>
  );
}

export function PrimerArranquePage() {
  const state = useQuery({ queryKey: ["first-start"], queryFn: () => api.firstStart() });
  // F4: the install opens this page with #code=<code>. Read once, then taken out of the address bar (and history).
  const [hashCode] = useState(() => codeFromHash(window.location.hash));
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }, []);

  if (state.isPending) {
    return (
      <Frame>
        <Skeleton className="h-96 w-full max-w-md" />
      </Frame>
    );
  }
  if (state.data && !state.data.open) return <Navigate to="/login" replace />;
  return <FirstStartCard state={state.data} hashCode={hashCode} />;
}

function FirstStartCard({ state, hashCode }: { state: FirstStartState | undefined; hashCode: string | null }) {
  const WORDS = words(FIRST_START);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // F5: the folders come from the server, written the way this machine writes them.
  const [offered] = useState(() => initialForm(state, browserTimeZone(), hashCode ?? ""));
  const [form, setForm] = useState<FirstStartForm>(offered);
  const [shown, setShown] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [options, setOptions] = useState(false);
  const set = (k: keyof FirstStartForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // A folder left as offered is not sent: the server's default (or a variable set by hand) applies.
  const folder = (k: "projects_root" | "worktrees_root") => (form[k].trim() === offered[k] ? undefined : form[k]);

  const finish = useMutation({
    mutationFn: () => api.finishFirstStart({ code: form.code, name: form.name, password: form.password, time_zone: form.time_zone, projects_root: folder("projects_root"), worktrees_root: folder("worktrees_root"), language: getLanguage() }),
    // Removed, not invalidated: a refetched `open: false` would send this page to /login before navigate runs,
    // and the old UNAUTHORIZED session would do the same on the company page.
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["first-start"] });
      queryClient.removeQueries({ queryKey: ["session"] });
      navigate("/", { replace: true });
    },
    onError: (e) => {
      const code = e instanceof ApiError ? e.code : "";
      setRefused(code);
      if (e instanceof ApiError && problemInOptions(form, e.detail?.field)) setOptions(true);
      setShown(e instanceof ApiError ? refusalText(e.code, e.detail) : refusalText(""));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = formProblem(form);
    setShown(problem);
    if (problem && problemInOptions(form)) setOptions(true);
    if (!problem) finish.mutate();
  }

  const codeField = showCodeField(!!hashCode, refused);
  return (
    <Frame>
      <Card className="w-full max-w-md">
        <CardHeader>
          <PlaniaMark className="mb-2 size-10" />
          <CardTitle className="font-display text-xl font-extrabold tracking-tight">{WORDS.title}</CardTitle>
          <CardDescription>{WORDS.lead}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {state && !state.loopback ? <p className="text-sm text-destructive">{WORDS.notLoopback}</p> : null}
          <div className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
            <p>{WORDS.machine}.</p>
            <Link to="/primer-arranque/falta" className="font-medium underline underline-offset-2">
              {WORDS.machineLink}
            </Link>
          </div>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <LanguageChoice />
            {codeField ? <Field id="code" label={WORDS.code} hint={WORDS.codeHint} autoComplete="one-time-code" autoFocus value={form.code} onChange={set("code")} /> : null}
            <Field id="name" label={WORDS.name} hint={WORDS.nameHint} autoComplete="name" autoFocus={!codeField} value={form.name} onChange={set("name")} />
            <Field id="password" label={WORDS.password} hint={WORDS.passwordHint} type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
            <Field id="repeat" label={WORDS.repeat} type="password" autoComplete="new-password" value={form.repeat} onChange={set("repeat")} />
            <details className="rounded-md border px-3 py-2" open={options} onToggle={(e) => setOptions(e.currentTarget.open)} data-mas-opciones>
              <summary className="cursor-pointer text-sm font-medium">{WORDS.moreOptions}</summary>
              <p className="mt-1 text-xs text-muted-foreground">{WORDS.moreOptionsHint}</p>
              <div className="mt-3 grid gap-4 pb-2">
                <Field id="time_zone" label={WORDS.timeZone} hint={WORDS.timeZoneHint} value={form.time_zone} onChange={set("time_zone")} />
                <Field id="projects_root" label={WORDS.projectsRoot} hint={WORDS.projectsRootHint} value={form.projects_root} onChange={set("projects_root")} spellCheck={false} />
                <Field id="worktrees_root" label={WORDS.worktreesRoot} hint={WORDS.worktreesRootHint} value={form.worktrees_root} onChange={set("worktrees_root")} spellCheck={false} />
              </div>
            </details>
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
  const WORDS = words(FIRST_START);
  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
      <Link to="/primer-arranque" className="text-sm underline underline-offset-2">
        {WORDS.back}
      </Link>
      <FaltaPage firstStart />
    </div>
  );
}
