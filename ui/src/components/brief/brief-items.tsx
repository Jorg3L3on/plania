// PLA-I42-2: Needs you and Up next (spec §8 item 3). Each is a card whose header is a collapsible button (title,
// count, chevron); the collapse state lives per device in localStorage plania.brief.collapsed. Rows render as plain
// text only (React escapes; no HTML from the brief). Checks are optimistic through useBriefCheck.
import { ArrowUpRightIcon, ChevronDownIcon } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type BriefApp, type BriefLanguage, type Item, type SectionId, readCollapsed, safeUrl, writeCollapsed } from "@/lib/brief";
import { AppBadge } from "./app-badge";
import { BRIEF_LABELS } from "./labels";

/** One section's collapsed flag, read once and written on every toggle. */
export function useCollapsed(id: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => readCollapsed()[id] === true);
  const toggle = useCallback(() => {
    setCollapsed((was) => {
      const next = !was;
      const all = readCollapsed();
      if (next) all[id] = true;
      else delete all[id];
      writeCollapsed(all);
      return next;
    });
  }, [id]);
  return [collapsed, toggle];
}

export function BriefSection({ id, title, count, children, className }: { id: SectionId; title: string; count: number; children: ReactNode; className?: string }) {
  const [collapsed, toggle] = useCollapsed(id);
  const bodyId = `brief-section-${id}`;
  return (
    <Card className={cn("gap-0 rounded-2xl py-0", className)} data-brief-section={id}>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        onClick={toggle}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <h2 className="font-display text-lg font-bold">{title}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">{count}</span>
        <ChevronDownIcon aria-hidden className={cn("ml-auto size-5 text-muted-foreground transition-transform", collapsed && "-rotate-90")} />
      </button>
      <div id={bodyId} hidden={collapsed} className="border-t border-border">
        {children}
      </div>
    </Card>
  );
}

function CheckBox({ item, checked, disabled, onCheck, language }: { item: Item; checked: boolean; disabled: boolean; onCheck: (id: string, checked: boolean) => void; language: BriefLanguage }) {
  return (
    <label className="-m-2.5 flex size-11 shrink-0 cursor-pointer items-center justify-center has-disabled:cursor-default">
      <input
        type="checkbox"
        className="size-5 accent-foreground"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheck(item.id, e.target.checked)}
        aria-label={BRIEF_LABELS[language].check(item.title)}
      />
    </label>
  );
}

type RowProps = { item: Item; app: BriefApp | undefined; checked: boolean; readOnly: boolean; onCheck: (id: string, checked: boolean) => void; language: BriefLanguage };

export function NeedsRow({ item, index, app, checked, readOnly, onCheck, language }: RowProps & { index: number }) {
  const t = BRIEF_LABELS[language];
  const blocker = item.status === "blocker";
  const url = safeUrl(item.url);
  return (
    <li
      className={cn("flex gap-3 px-5 py-4 transition-opacity", blocker && "bg-destructive/5", checked && "opacity-45")}
      data-brief-item={item.id}
      data-checked={checked || undefined}
    >
      <CheckBox item={item} checked={checked} disabled={readOnly} onCheck={onCheck} language={language} />
      <span className={cn("w-6 shrink-0 pt-0.5 font-mono text-sm tabular-nums", blocker ? "font-semibold text-destructive" : "text-muted-foreground")}>
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <AppBadge app={app} />
          {item.ref && <span className="font-mono text-xs break-all text-muted-foreground">{item.ref}</span>}
          {blocker && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">{t.blocker}</span>}
        </div>
        <p className="font-semibold break-words">{item.title}</p>
        {item.detail && <p className="text-sm break-words text-muted-foreground">{item.detail}</p>}
        {url && (
          <div>
            <Button asChild variant="outline" size="sm" className="mt-1 min-h-11 sm:min-h-8">
              <a href={url} target="_blank" rel="noopener noreferrer">
                {item.action ?? BRIEF_LABELS[language].open}
                <ArrowUpRightIcon aria-hidden />
              </a>
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

export function NextRow({ item, app, checked, readOnly, onCheck, language }: RowProps) {
  const url = safeUrl(item.url);
  return (
    <li className={cn("flex gap-3 px-5 py-4 transition-opacity", checked && "opacity-45")} data-brief-item={item.id} data-checked={checked || undefined}>
      <CheckBox item={item} checked={checked} disabled={readOnly} onCheck={onCheck} language={language} />
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <AppBadge app={app} />
          {item.ref && <span className="font-mono text-xs break-all text-muted-foreground">{item.ref}</span>}
        </div>
        <p className="font-semibold break-words">{item.title}</p>
        {item.detail && <p className="text-sm break-words text-muted-foreground">{item.detail}</p>}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-medium underline-offset-4 hover:underline sm:min-h-0"
          >
            {item.action ?? BRIEF_LABELS[language].open}
            <ArrowUpRightIcon aria-hidden className="size-3.5" />
          </a>
        )}
      </div>
    </li>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="px-5 py-6 text-sm text-muted-foreground">{children}</p>;
}
