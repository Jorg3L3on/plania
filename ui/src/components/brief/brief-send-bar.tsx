// PLA-I42-3: the floating send bar (spec §8 item 6), shown while at least one idea is selected: top center,
// max 640 px. "2 ideas → Plania", the mono reply box ("yes W1 Z3"), Clear and Copy reply.
// PLA-I43-4: Send to Plania. Before sending, the cost line ("This wakes 3 project bots, one after another, about
// 30–75 min"); after sending, the progress per idea (Queued · Planning in Workia · Planned as WRK-I18, 4 tickets,
// Backlog) with links to the keys, until every target is done, and "Waiting: <Project> runs are paused" (D7).
import { CopyIcon, SendIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { planLine, planLink, type BriefLanguage, type PlanIdeaProgress, type PlanProgress } from "@/lib/brief";
import { BRIEF_LABELS } from "@/lib/brief-i18n";

type CopyState = "idle" | "copied" | "failed";

/** Copies text with the Clipboard API, falling back to a hidden textarea where it is missing (plain http on a LAN). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return ok;
  } catch {
    return false;
  }
}

export type SendCost = { bots: number; low: number; high: number };

/** One line per chosen idea: its code, where it stands, and a link to the key once it is planned. */
export function PlanProgressList({ ideas, language }: { ideas: PlanIdeaProgress[]; language: BriefLanguage }) {
  const t = BRIEF_LABELS[language];
  return (
    <ul className="grid gap-1.5 text-sm" data-brief="progress">
      {ideas.map((p) => {
        const line = planLine(p);
        const link = planLink(p);
        const text = t.planLine(line);
        const paused = line.kind === "waiting" || line.kind === "waitingCompany";
        return (
          <li key={p.code} className="flex min-w-0 items-baseline gap-2" data-brief="progress-row" data-state={p.state}>
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold">{p.code}</span>
            <span className={cn("min-w-0", line.kind === "failed" ? "text-destructive" : paused ? "text-muted-foreground" : "")} data-brief={paused ? "paused" : undefined}>
              {link ? (
                <>
                  {text.slice(0, text.indexOf(link.key))}
                  <Link to={link.href} className="font-mono font-semibold underline-offset-2 hover:underline" data-brief="plan-link">
                    {link.key}
                  </Link>
                  {text.slice(text.indexOf(link.key) + link.key.length)}
                </>
              ) : (
                text
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function BriefSendBar({
  count,
  reply,
  onClear,
  language,
  canSend = true,
  onSend,
  cost = null,
  sending = false,
  sendError = false,
  alreadySent = [],
  plan = null,
  onDismiss,
}: {
  count: number;
  reply: string;
  onClear: () => void;
  language: BriefLanguage;
  canSend?: boolean;
  onSend?: () => void;
  cost?: SendCost | null;
  sending?: boolean;
  sendError?: boolean;
  alreadySent?: string[];
  plan?: PlanProgress | null;
  onDismiss?: () => void;
}) {
  const t = BRIEF_LABELS[language];
  const [copy, setCopy] = useState<CopyState>("idle");
  useEffect(() => setCopy("idle"), [reply]);
  const showPlan = !!plan && plan.ideas.length > 0;
  if (count < 1 && !showPlan) return null;

  return (
    <div
      role="region"
      aria-label={t.sendBar}
      className="fixed inset-x-3 top-16 z-50 mx-auto grid max-h-[70vh] max-w-[640px] gap-2 overflow-y-auto rounded-2xl border border-border bg-popover/95 p-3 text-popover-foreground shadow-lg backdrop-blur"
      data-brief="send-bar"
    >
      {count > 0 && (
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <span className="shrink-0 text-sm font-semibold" aria-live="polite">
            {t.toPlania(count)}
          </span>
          <output
            aria-label={t.reply}
            className="order-last w-full min-w-0 truncate rounded-lg bg-muted px-3 py-2 font-mono text-sm sm:order-none sm:w-auto sm:flex-1"
            data-brief="reply"
          >
            {reply}
          </output>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={onClear}>
              <XIcon aria-hidden />
              {t.clear}
            </Button>
            <Button
              type="button"
              variant={canSend ? "outline" : "default"}
              size="sm"
              className="min-h-11 sm:min-h-8"
              onClick={async () => setCopy((await copyText(reply)) ? "copied" : "failed")}
              data-brief="copy"
            >
              <CopyIcon aria-hidden />
              {copy === "copied" ? t.copied : copy === "failed" ? t.copyFailed : t.copyReply}
            </Button>
            {canSend && (
              <Button type="button" size="sm" className="min-h-11 sm:min-h-8" onClick={onSend} disabled={sending} data-brief="send">
                <SendIcon aria-hidden />
                {sending ? t.sending : t.sendToPlania}
              </Button>
            )}
          </div>
        </div>
      )}
      {count > 0 && canSend && cost && cost.bots > 0 && (
        <p className="text-xs text-muted-foreground" data-brief="cost">
          {t.sendCost(cost.bots, cost.low, cost.high)}
        </p>
      )}
      {count > 0 && sendError && (
        <p className="text-xs text-destructive" role="alert" data-brief="send-failed">
          {t.sendFailed}
        </p>
      )}
      {alreadySent.length > 0 && (
        <p className="text-xs text-muted-foreground" data-brief="already-sent">
          {t.alreadySent(alreadySent.join(" "))}
        </p>
      )}
      {showPlan && (
        <section aria-label={t.progress} aria-live="polite" className={cn("grid gap-2", count > 0 && "border-t border-border pt-2")}>
          <PlanProgressList ideas={plan.ideas} language={language} />
          <div className="flex items-center gap-2">
            <p className="flex-1 text-xs text-muted-foreground" data-brief="plan-status" data-status={plan.status}>
              {plan.status === "open" ? t.planOpen : plan.status === "done" ? t.planDone : t.planPartial}
            </p>
            {plan.status !== "open" && onDismiss && (
              <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={onDismiss} data-brief="dismiss">
                <XIcon aria-hidden />
                {t.dismiss}
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
