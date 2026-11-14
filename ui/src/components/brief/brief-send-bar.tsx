// PLA-I42-3: the floating send bar (spec §8 item 6), shown while at least one idea is selected: top center,
// max 640 px. "2 ideas → Plania", the mono reply box ("yes W1 Z3"), Clear and Copy reply. Send to Plania and its
// progress belong to PLA-I43 and stay hidden behind BRIEF_SEND_ENABLED until it ships.
import { CopyIcon, SendIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { BRIEF_SEND_ENABLED, type BriefLanguage } from "@/lib/brief";
import { BRIEF_LABELS } from "./labels";

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

export function BriefSendBar({
  count,
  reply,
  onClear,
  language,
  canSend = BRIEF_SEND_ENABLED,
  onSend,
}: {
  count: number;
  reply: string;
  onClear: () => void;
  language: BriefLanguage;
  canSend?: boolean;
  onSend?: () => void;
}) {
  const t = BRIEF_LABELS[language];
  const [copy, setCopy] = useState<CopyState>("idle");
  useEffect(() => setCopy("idle"), [reply]);
  if (count < 1) return null;

  return (
    <div
      role="region"
      aria-label={t.sendBar}
      className="fixed inset-x-3 top-16 z-50 mx-auto max-w-[640px] rounded-2xl border border-border bg-popover/95 p-3 text-popover-foreground shadow-lg backdrop-blur"
      data-brief="send-bar"
    >
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
            <Button type="button" size="sm" className="min-h-11 sm:min-h-8" onClick={onSend} data-brief="send">
              <SendIcon aria-hidden />
              {t.sendToPlania}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
