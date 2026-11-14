// PLA-I42-4: the brief settings sheet (spec §8 "Settings sheet", §9). A shadcn Sheet with on/off, run time, fallback
// time, time zone and label, language, owner name, hidden refs (chip input), max items per app, ideas per project,
// ideas on/off, model (blank = default) and one row per project (include, ideas on, letter, order, "Edit persona" →
// a textarea that saves the project's "Idea persona" doc). The read-only Setup check (pnpm brief:doctor without the
// claude dry run) sits at the bottom. Labels follow the page's language (D5).
import { CheckCircle2Icon, CircleAlertIcon, XIcon } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  type BriefLanguage,
  type BriefProjectRow,
  type BriefProjectSetting,
  type BriefSettings,
  type BriefSettingsPatch,
  type BriefSettingsReply,
  useBriefDoctor,
  useBriefPersona,
  useBriefSettings,
  useSaveBriefPersona,
  useSaveBriefSettings,
} from "@/lib/brief";
import { BRIEF_LABELS, type SettingsLabels } from "@/lib/brief-i18n";
import { ApiError } from "@/lib/api";

// ---- The form (pure, for tests)

export type ProjectDraft = { slug: string; name: string; include: boolean; include_ideas: boolean; letter: string; order: string };
export type SettingsDraft = {
  enabled: boolean;
  run_at: string;
  fallback_at: string;
  timezone: string;
  timezone_label: string;
  language: BriefLanguage;
  owner_name: string;
  hidden_refs: string[];
  max_items_per_app: string;
  ideas_per_project: string;
  ideas_enabled: boolean;
  model: string;
  projects: ProjectDraft[];
};

export function draftOf(reply: BriefSettingsReply): SettingsDraft {
  const s = reply.settings;
  return {
    enabled: s.enabled,
    run_at: s.run_at,
    fallback_at: s.fallback_at,
    timezone: s.timezone ?? "",
    timezone_label: s.timezone_label ?? "",
    language: s.language,
    owner_name: s.owner_name ?? "",
    hidden_refs: [...s.hidden_refs],
    max_items_per_app: String(s.max_items_per_app),
    ideas_per_project: String(s.ideas_per_project),
    ideas_enabled: s.ideas_enabled,
    model: s.model ?? "",
    projects: (reply.projects ?? []).map((p) => ({ slug: p.slug, name: p.name, include: p.include, include_ideas: p.include_ideas, letter: p.letter, order: String(p.order) })),
  };
}

const LETTER = /^[A-WYZ]$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const blank = (v: string) => (v.trim() ? v.trim() : null);
const int = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);

export type DraftProblem = "run_at" | "fallback_at" | "max_items_per_app" | "ideas_per_project" | `letter:${string}` | `order:${string}`;

/** Fields the server would refuse, so Save can say so before sending. */
export function draftProblems(d: SettingsDraft): DraftProblem[] {
  const out: DraftProblem[] = [];
  if (!HHMM.test(d.run_at)) out.push("run_at");
  if (!HHMM.test(d.fallback_at)) out.push("fallback_at");
  const max = int(d.max_items_per_app);
  if (!(max >= 1 && max <= 20)) out.push("max_items_per_app");
  const per = int(d.ideas_per_project);
  if (!(per >= 1 && per <= 10)) out.push("ideas_per_project");
  for (const p of d.projects) {
    if (!LETTER.test(p.letter)) out.push(`letter:${p.slug}`);
    const o = int(p.order);
    if (!(o >= 0 && o <= 999)) out.push(`order:${p.slug}`);
  }
  return out;
}

/**
 * The PUT body. A project's letter and order are sent only when they were set by hand before or differ from the
 * resolved value, so the automatic letters (key prefix, else title) stay automatic.
 */
export function patchOf(d: SettingsDraft, reply: BriefSettingsReply): BriefSettingsPatch {
  const stored = reply.settings.projects;
  const resolved = new Map((reply.projects ?? []).map((p) => [p.slug, p]));
  const projects: Record<string, BriefProjectSetting> = {};
  for (const p of d.projects) {
    const was = stored[p.slug] ?? {};
    const r: BriefProjectRow | undefined = resolved.get(p.slug);
    const row: BriefProjectSetting = { include: p.include, include_ideas: p.include_ideas };
    if (was.letter || p.letter !== r?.letter) row.letter = p.letter;
    const order = int(p.order);
    if (was.order !== undefined || order !== r?.order) row.order = order;
    projects[p.slug] = row;
  }
  return {
    enabled: d.enabled,
    run_at: d.run_at,
    fallback_at: d.fallback_at,
    timezone: blank(d.timezone),
    timezone_label: blank(d.timezone_label),
    language: d.language,
    owner_name: blank(d.owner_name),
    hidden_refs: d.hidden_refs,
    max_items_per_app: int(d.max_items_per_app),
    ideas_per_project: int(d.ideas_per_project),
    ideas_enabled: d.ideas_enabled,
    model: blank(d.model),
    projects,
  };
}

/** Chips from typed text: split on commas and spaces, trimmed, no repeats, in typed order. */
export function addRefs(current: string[], typed: string): string[] {
  const add = typed.split(/[,\s]+/).map((r) => r.trim()).filter(Boolean);
  return [...new Set([...current, ...add])];
}

// ---- Pieces

function Field({ label, hint, htmlFor, children, className }: { label: string; hint?: string; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SwitchRow({ label, hint, checked, onChange, id }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Group({ title, children, hint }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <div className="grid gap-0.5">
        <h3 className="font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function RefChips({ refs, onChange, t }: { refs: string[]; onChange: (refs: string[]) => void; t: SettingsLabels }) {
  const [typed, setTyped] = useState("");
  const id = useId();
  const add = () => {
    if (!typed.trim()) return;
    onChange(addRefs(refs, typed));
    setTyped("");
  };
  return (
    <Field label={t.hiddenRefs} hint={t.hiddenRefsHint} htmlFor={id}>
      {refs.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" data-brief="hidden-refs">
          {refs.map((r) => (
            <li key={r} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted py-0.5 pr-0.5 pl-2.5 font-mono text-xs">
              {r}
              <button
                type="button"
                aria-label={t.removeRef(r)}
                onClick={() => onChange(refs.filter((x) => x !== r))}
                className="relative flex size-7 items-center justify-center rounded-full text-muted-foreground outline-none after:absolute after:-inset-2 hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <XIcon className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          className="min-h-11 font-mono sm:min-h-9"
          autoComplete="off"
        />
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={add} disabled={!typed.trim()}>
          {t.addRef}
        </Button>
      </div>
    </Field>
  );
}

function PersonaEditor({ slug, name, t }: { slug: string; name: string; t: SettingsLabels }) {
  const persona = useBriefPersona(slug);
  const save = useSaveBriefPersona();
  const [text, setText] = useState<string | null>(null);
  const id = useId();
  const value = text ?? persona.data?.markdown ?? "";
  const stale = save.error instanceof ApiError && save.error.status === 409;
  return (
    <div className="grid gap-2 rounded-xl bg-muted/50 p-3" data-brief-persona={slug}>
      <Label htmlFor={id}>{t.persona(name)}</Label>
      <p className="text-xs text-muted-foreground">{t.personaHint}</p>
      {persona.isLoading ? (
        <p className="text-sm text-muted-foreground">{t.loading}</p>
      ) : (
        <Textarea id={id} value={value} onChange={(e) => setText(e.target.value)} rows={5} placeholder={t.personaNone} className="min-h-28 bg-background" />
      )}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          className="min-h-11 sm:min-h-8"
          disabled={persona.isLoading || save.isPending || text === null}
          onClick={() =>
            save.mutate(
              { slug, markdown: value, version: persona.data?.version ?? undefined },
              { onSuccess: () => setText(null) },
            )
          }
          data-brief="save-persona"
        >
          {save.isPending ? t.saving : t.savePersona}
        </Button>
        <span className="text-xs text-muted-foreground" role="status">
          {save.isSuccess && text === null ? t.personaSaved : save.isError ? (stale ? t.personaStale : t.saveFailed) : ""}
        </span>
      </div>
    </div>
  );
}

function ProjectRow({ p, onChange, t, bad }: { p: ProjectDraft; onChange: (p: ProjectDraft) => void; t: SettingsLabels; bad: Set<string> }) {
  const [persona, setPersona] = useState(false);
  const base = useId();
  return (
    <li className="grid gap-3 py-3" data-brief-project={p.slug}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="min-w-0 flex-1 basis-full font-medium sm:basis-auto">{p.name}</span>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Switch checked={p.include} onCheckedChange={(v) => onChange({ ...p, include: v, include_ideas: v ? p.include_ideas : false })} aria-label={t.include(p.name)} />
          {t.inBrief}
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Switch checked={p.include_ideas} disabled={!p.include} onCheckedChange={(v) => onChange({ ...p, include_ideas: v })} aria-label={t.includeIdeas(p.name)} />
          {t.ideasOn}
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t.letter} htmlFor={`${base}-letter`} className="w-16">
          <Input
            id={`${base}-letter`}
            value={p.letter}
            maxLength={1}
            onChange={(e) => onChange({ ...p, letter: e.target.value.toUpperCase() })}
            aria-invalid={bad.has(`letter:${p.slug}`) || undefined}
            className="min-h-11 text-center font-mono sm:min-h-9"
          />
        </Field>
        <Field label={t.order} htmlFor={`${base}-order`} className="w-20">
          <Input
            id={`${base}-order`}
            inputMode="numeric"
            value={p.order}
            onChange={(e) => onChange({ ...p, order: e.target.value })}
            aria-invalid={bad.has(`order:${p.slug}`) || undefined}
            className="min-h-11 tabular-nums sm:min-h-9"
          />
        </Field>
        <Button type="button" variant="outline" size="sm" className="ml-auto min-h-11 sm:min-h-9" aria-expanded={persona} onClick={() => setPersona((v) => !v)}>
          {persona ? t.hidePersona : t.editPersona}
        </Button>
      </div>
      {persona && <PersonaEditor slug={p.slug} name={p.name} t={t} />}
    </li>
  );
}

function SetupCheck({ open, t }: { open: boolean; t: SettingsLabels }) {
  const doctor = useBriefDoctor(open);
  return (
    <section className="grid gap-3 border-t border-border pt-5" data-brief="setup">
      <div className="grid gap-0.5">
        <h3 className="font-semibold">{t.setup}</h3>
        <p className="text-xs text-muted-foreground">{t.setupHint}</p>
      </div>
      {doctor.isLoading && <p className="text-sm text-muted-foreground">{t.loading}</p>}
      {doctor.isError && <p className="text-sm text-muted-foreground">{t.setupFailed}</p>}
      {doctor.data && (
        <ul className="grid gap-2">
          {doctor.data.lines.map((l, i) => (
            <li key={i} className="flex items-start gap-2 text-sm" data-ok={l.ok}>
              {l.ok ? (
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label={t.setupOk} />
              ) : (
                <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-label={t.setupBad} />
              )}
              <span className={cn("break-words", !l.ok && "text-destructive")}>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- The sheet

export function BriefSettingsSheet({ open, onOpenChange, language }: { open: boolean; onOpenChange: (open: boolean) => void; language: BriefLanguage }) {
  const t = BRIEF_LABELS[language].s;
  const settings = useBriefSettings();
  const save = useSaveBriefSettings();
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [tried, setTried] = useState(false);
  const ids = useId();

  // A fresh draft each time the sheet opens (or once settings arrive).
  useEffect(() => {
    if (open && settings.data) setDraft(draftOf(settings.data));
    if (!open) {
      setDraft(null);
      setTried(false);
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, !!settings.data]);

  const problems = draft ? draftProblems(draft) : [];
  const bad = new Set<string>(tried ? problems : []);
  const set = <K extends keyof SettingsDraft>(k: K, v: SettingsDraft[K]) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
    if (save.isSuccess) save.reset();
  };
  const r = settings.data?.resolved;

  const onSave = () => {
    if (!draft || !settings.data) return;
    setTried(true);
    if (problems.length) return;
    save.mutate(patchOf(draft, settings.data), { onSuccess: (reply) => setDraft(draftOf(reply)) });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg" data-brief="settings">
        <SheetHeader className="flex-row items-start justify-between gap-3 border-b border-border">
          <div className="grid gap-1">
            <SheetTitle className="font-display text-xl">{t.title}</SheetTitle>
            <SheetDescription>{t.description}</SheetDescription>
          </div>
          <Button type="button" variant="ghost" size="icon" className="-mt-1 size-11 pointer-coarse:size-11 sm:size-9" aria-label={t.close} onClick={() => onOpenChange(false)}>
            <XIcon />
          </Button>
        </SheetHeader>

        <div className="grid flex-1 content-start gap-6 overflow-y-auto p-4 sm:p-6">
          {!draft ? (
            <p className="text-sm text-muted-foreground">{t.loading}</p>
          ) : (
            <>
              <Group title={t.general}>
                <SwitchRow id={`${ids}-on`} label={t.enabled} hint={t.enabledHint} checked={draft.enabled} onChange={(v) => set("enabled", v)} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t.runAt} htmlFor={`${ids}-run`}>
                    <Input id={`${ids}-run`} type="time" value={draft.run_at} onChange={(e) => set("run_at", e.target.value)} aria-invalid={bad.has("run_at") || undefined} className="min-h-11 sm:min-h-9" />
                  </Field>
                  <Field label={t.fallbackAt} htmlFor={`${ids}-fallback`}>
                    <Input id={`${ids}-fallback`} type="time" value={draft.fallback_at} onChange={(e) => set("fallback_at", e.target.value)} aria-invalid={bad.has("fallback_at") || undefined} className="min-h-11 sm:min-h-9" />
                  </Field>
                </div>
                <p className="-mt-2 text-xs text-muted-foreground">{t.fallbackHint}</p>
                <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
                  <Field label={t.timezone} hint={r ? t.timezoneHint(r.timezone) : undefined} htmlFor={`${ids}-tz`}>
                    <Input id={`${ids}-tz`} value={draft.timezone} placeholder={r?.timezone} onChange={(e) => set("timezone", e.target.value)} className="min-h-11 font-mono sm:min-h-9" autoComplete="off" />
                  </Field>
                  <Field label={t.timezoneLabel} htmlFor={`${ids}-tzl`}>
                    <Input id={`${ids}-tzl`} value={draft.timezone_label} placeholder={r?.timezone_label} onChange={(e) => set("timezone_label", e.target.value)} className="min-h-11 sm:min-h-9" autoComplete="off" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t.language} htmlFor={`${ids}-lang`}>
                    <Select value={draft.language} onValueChange={(v) => set("language", v as BriefLanguage)}>
                      <SelectTrigger id={`${ids}-lang`} className="min-h-11 w-full sm:min-h-9" data-brief="language">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">{t.languages.en}</SelectItem>
                        <SelectItem value="es">{t.languages.es}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={t.ownerName} htmlFor={`${ids}-owner`}>
                    <Input id={`${ids}-owner`} value={draft.owner_name} placeholder={r?.owner_name} onChange={(e) => set("owner_name", e.target.value)} className="min-h-11 sm:min-h-9" autoComplete="off" />
                  </Field>
                </div>
              </Group>

              <Group title={t.content}>
                <RefChips refs={draft.hidden_refs} onChange={(v) => set("hidden_refs", v)} t={t} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t.maxItems} htmlFor={`${ids}-max`}>
                    <Input id={`${ids}-max`} type="number" min={1} max={20} value={draft.max_items_per_app} onChange={(e) => set("max_items_per_app", e.target.value)} aria-invalid={bad.has("max_items_per_app") || undefined} className="min-h-11 sm:min-h-9" />
                  </Field>
                  <Field label={t.ideasPerProject} htmlFor={`${ids}-per`}>
                    <Input id={`${ids}-per`} type="number" min={1} max={10} value={draft.ideas_per_project} onChange={(e) => set("ideas_per_project", e.target.value)} aria-invalid={bad.has("ideas_per_project") || undefined} className="min-h-11 sm:min-h-9" />
                  </Field>
                </div>
                <SwitchRow id={`${ids}-ideas`} label={t.ideasEnabled} checked={draft.ideas_enabled} onChange={(v) => set("ideas_enabled", v)} />
                <Field label={t.model} hint={t.modelHint} htmlFor={`${ids}-model`}>
                  <Input id={`${ids}-model`} value={draft.model} onChange={(e) => set("model", e.target.value)} className="min-h-11 font-mono sm:min-h-9" autoComplete="off" />
                </Field>
              </Group>

              <Group title={t.projects} hint={t.projectsHint}>
                <ul className="-my-3 divide-y divide-border">
                  {draft.projects.map((p, i) => (
                    <ProjectRow key={p.slug} p={p} t={t} bad={bad} onChange={(np) => set("projects", draft.projects.map((x, j) => (j === i ? np : x)))} />
                  ))}
                </ul>
              </Group>

              <SetupCheck open={open} t={t} />
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border p-4">
          <span className="mr-auto text-sm text-muted-foreground" role="status" data-brief="settings-status">
            {save.isSuccess ? t.saved : save.isError || (tried && problems.length) ? t.saveFailed : ""}
          </span>
          <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button type="button" className="min-h-11 sm:min-h-9" onClick={onSave} disabled={!draft || save.isPending} data-brief="save-settings">
            {save.isPending ? t.saving : t.save}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
