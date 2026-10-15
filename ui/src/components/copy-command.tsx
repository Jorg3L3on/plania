// A command for Jorge to run, with a copy button. Plania never runs it.
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function CopyCommand({ command, caption }: { command: string; caption?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("No se pudo copiar.");
    }
  }
  const Icon = copied ? CheckIcon : CopyIcon;
  return (
    <div className="grid gap-0.5">
      {caption && <span className="px-0.5 text-[10.5px] text-muted-foreground">{caption}</span>}
      <div className="flex items-start gap-1 rounded-lg bg-surface-sunken py-1 pr-1 pl-2.5">
        <code className="min-w-0 flex-1 py-0.5 font-mono text-xs leading-5 break-all whitespace-pre-wrap">{command}</code>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copiar el comando"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground"
        >
          <Icon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
