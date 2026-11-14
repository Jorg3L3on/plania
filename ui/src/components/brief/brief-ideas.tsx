// PLA-I42-3: Today's ideas (spec §8 item 4). One collapsible group per app (color square, name, count, rule line,
// chevron; collapse state per device under "ideas:<app>"), cards in a minmax(240px, 1fr) grid. A card has a check box
// that hides it (the same server checks as items), the code badge, "from {source}" when the source isn't the app,
// flags as muted captions, a select circle, the title and the why. Clicking the card toggles selection.
// PLA-I43-4: once sent, a card also shows where its idea stands in Send to Plania (the same line as the send bar),
// e.g. "Waiting: Zigzag runs are paused" (D7) or "Planned as WRK-I18, 4 tickets, Backlog".
// Plain text only (React escapes; no HTML from the brief).
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { type BriefApp, type BriefLanguage, type Idea, type IdeaGroup, type PlanIdeaProgress, parseFlag, planLine, showSource } from "@/lib/brief";
import { SLOT_BG } from "./app-badge";
import { useCollapsed } from "./brief-items";
import { BRIEF_LABELS, type BriefLabels } from "@/lib/brief-i18n";

type CardProps = {
  idea: Idea;
  app: BriefApp;
  checked: boolean;
  selected: boolean;
  readOnly: boolean;
  onCheck: (id: string, checked: boolean) => void;
  onSelect: (id: string) => void;
  language: BriefLanguage;
  plan?: PlanIdeaProgress | null;
};

/** The flag captions in the brief's language; unknown flags are left out. */
export function flagCaptions(flags: string[] | undefined, t: BriefLabels): string[] {
  return (flags ?? []).flatMap((f) => {
    const p = parseFlag(f);
    if (!p) return [];
    return [p.key === "overlap" ? t.flags.overlap(p.ref ?? "") : t.flags[p.key]];
  });
}

const stop = (e: MouseEvent) => e.stopPropagation();

export function IdeaCard({ idea, app, checked, selected, readOnly, onCheck, onSelect, language, plan = null }: CardProps) {
  const t = BRIEF_LABELS[language];
  const captions = flagCaptions(idea.flags, t);
  const line = plan ? planLine(plan) : null;
  return (
    <li
      onClick={() => onSelect(idea.id)}
      className={cn(
        "relative grid cursor-pointer content-start gap-2 rounded-2xl border bg-card p-4 transition-[opacity,box-shadow,border-color]",
        selected ? "border-foreground ring-2 ring-foreground/15" : "border-border hover:border-foreground/40",
        checked && "opacity-45",
      )}
      data-brief-idea={idea.id}
      data-code={idea.code}
      data-selected={selected || undefined}
      data-checked={checked || undefined}
    >
      <div className="flex items-center gap-2">
        <label className="-m-2.5 flex size-11 shrink-0 cursor-pointer items-center justify-center has-disabled:cursor-default" onClick={stop}>
          <input
            type="checkbox"
            className="size-5 accent-foreground"
            checked={checked}
            disabled={readOnly}
            onChange={(e) => onCheck(idea.id, e.target.checked)}
            aria-label={t.hideIdea(idea.title)}
          />
        </label>
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums" data-brief="code">
          {idea.code}
        </span>
        {showSource(idea, app) && <span className="min-w-0 truncate text-xs text-muted-foreground">{t.from(idea.source)}</span>}
        <button
          type="button"
          aria-pressed={selected}
          aria-label={t.selectIdea(idea.title)}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(idea.id);
          }}
          className="-m-2.5 ml-auto flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span
            aria-hidden
            className={cn(
              "flex size-5 items-center justify-center rounded-full border-2 transition-colors",
              selected ? "border-foreground bg-foreground text-background" : "border-muted-foreground/50",
            )}
          >
            {selected && <CheckIcon className="size-3" strokeWidth={3} />}
          </span>
        </button>
      </div>
      {captions.length > 0 && (
        <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground" data-brief="flags">
          {captions.map((c, i) => (
            <span key={c}>
              {i > 0 && <span aria-hidden className="mr-2">·</span>}
              {c}
            </span>
          ))}
        </p>
      )}
      <p className="font-semibold break-words">{idea.title}</p>
      <p className="text-sm break-words text-muted-foreground">{idea.why}</p>
      {line && (
        <p
          className={cn("text-xs font-medium", line.kind === "failed" ? "text-destructive" : "text-muted-foreground")}
          data-brief="plan-caption"
          data-state={plan!.state}
        >
          {t.planLine(line)}
        </p>
      )}
    </li>
  );
}

export function IdeaGroupView({
  group,
  checks,
  selected,
  readOnly,
  onCheck,
  onSelect,
  language,
  plans,
}: {
  group: IdeaGroup;
  checks: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  readOnly: boolean;
  onCheck: (id: string, checked: boolean) => void;
  onSelect: (id: string) => void;
  language: BriefLanguage;
  plans?: ReadonlyMap<string, PlanIdeaProgress>;
}) {
  const [collapsed, toggle] = useCollapsed(`ideas:${group.app.id}`);
  const bodyId = `brief-ideas-${group.app.id}`;
  const open = group.ideas.filter((i) => !checks.has(i.id)).length;
  return (
    <section className="grid gap-3" data-brief-group={group.app.id}>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        onClick={toggle}
        className="flex min-h-11 w-full items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span aria-hidden className={cn("size-3 shrink-0 rounded-[3px]", SLOT_BG[group.app.color])} />
        <h3 className="font-semibold">{group.app.name}</h3>
        <span className="text-sm tabular-nums text-muted-foreground">{open}</span>
        <span aria-hidden className="h-px flex-1 bg-border" />
        <ChevronDownIcon aria-hidden className={cn("size-5 text-muted-foreground transition-transform", collapsed && "-rotate-90")} />
      </button>
      <ul id={bodyId} hidden={collapsed} className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
        {group.ideas.map((idea) => (
          <IdeaCard
            key={idea.id}
            idea={idea}
            app={group.app}
            checked={checks.has(idea.id)}
            selected={selected.has(idea.id)}
            readOnly={readOnly}
            onCheck={onCheck}
            onSelect={onSelect}
            language={language}
            plan={plans?.get(idea.code) ?? null}
          />
        ))}
      </ul>
    </section>
  );
}

export function BriefIdeas({
  groups,
  checks,
  selected,
  readOnly,
  onCheck,
  onSelect,
  language,
  plans,
}: {
  groups: IdeaGroup[];
  checks: string[];
  selected: ReadonlySet<string>;
  readOnly: boolean;
  onCheck: (id: string, checked: boolean) => void;
  onSelect: (id: string) => void;
  language: BriefLanguage;
  /** Send to Plania progress by idea code (PLA-I43-4). */
  plans?: ReadonlyMap<string, PlanIdeaProgress>;
}) {
  const t = BRIEF_LABELS[language];
  const checked = new Set(checks);
  return (
    <section className="grid gap-5" data-brief="ideas" aria-labelledby="brief-ideas-title">
      <div className="grid gap-1">
        <h2 id="brief-ideas-title" className="font-display text-xl font-bold">
          {t.ideasTitle}
        </h2>
        <p className="text-sm text-muted-foreground">{t.ideasHint}</p>
      </div>
      {groups.length ? (
        groups.map((g) => (
          <IdeaGroupView key={g.app.id} group={g} checks={checked} selected={selected} readOnly={readOnly} onCheck={onCheck} onSelect={onSelect} language={language} plans={plans} />
        ))
      ) : (
        <p className="text-sm text-muted-foreground">{t.noIdeas}</p>
      )}
    </section>
  );
}
