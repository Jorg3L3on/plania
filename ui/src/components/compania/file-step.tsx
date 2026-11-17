// A file step (src/api/file-step.ts): a teammate needs lines in a file its session may not write. The card shows the
// file and the lines, editable, and "Agregar al PR" commits them to the ticket's PR and marks the step done. While it
// runs it says what it is doing; a refusal stays on the card (the row's error) with GitHub's or Plania's reason.
import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import type { Decision, DecisionInput } from "@/lib/api";
import { cn } from "@/lib/utils";

const prNumber = (url: string | null) => (url ? (/\/pull\/(\d+)/.exec(url)?.[1] ?? null) : null);

export const FileStepBox = ({
  d,
  busy,
  disabled,
  onApply,
}: {
  d: Decision & { file_step: NonNullable<Decision["file_step"]> };
  busy: boolean;
  disabled?: boolean;
  onApply: (input: DecisionInput) => void;
}) => {
  const f = d.file_step;
  const [path, setPath] = useState(f.path);
  const [lines, setLines] = useState(f.lines);
  const n = prNumber(f.pr_url);
  const rows = Math.min(14, Math.max(3, lines.split("\n").length + 1));
  const ready = path.trim().length > 0 && lines.trim().length > 0;
  return (
    <div className="grid min-w-0 gap-2 rounded-xl bg-muted/60 p-3 text-sm" data-file-step={f.source}>
      <p className="font-semibold">Plania puede hacerlo por ti</p>
      <p className="text-xs text-muted-foreground">
        Agrega estas líneas al final del archivo{n ? ` en el PR #${n}` : ""} y marca el paso como hecho. Las que ya estén no se repiten.
        {f.source === "text" ? " Plania las leyó del mensaje: revísalas antes." : ""}
      </p>
      <label className="grid gap-1 text-xs font-semibold">
        Archivo
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          disabled={busy || disabled}
          className="min-h-9 w-full min-w-0 rounded-lg border border-border bg-background px-2.5 font-mono text-xs font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-control="archivo-ruta"
          spellCheck={false}
        />
      </label>
      <label className="grid gap-1 text-xs font-semibold">
        Líneas
        <textarea
          value={lines}
          onChange={(e) => setLines(e.target.value)}
          disabled={busy || disabled}
          rows={rows}
          className="w-full min-w-0 resize-y rounded-lg border border-border bg-background px-2.5 py-2 font-mono text-xs leading-relaxed font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-control="archivo-lineas"
          spellCheck={false}
        />
      </label>
      {busy ? (
        <p role="status" aria-live="polite" className="flex items-start gap-2 text-xs font-semibold" data-file-working>
          <Loader2Icon className="mt-0.5 size-3.5 shrink-0 animate-spin" aria-hidden />
          <span>
            Agregando en GitHub…
            <span className="block font-normal text-muted-foreground">Lee {path.trim()} en la rama del PR, agrega las líneas que faltan y hace un commit.</span>
          </span>
        </p>
      ) : (
        <div>
          <button
            type="button"
            className={cn(
              "inline-flex min-h-9 items-center rounded-full bg-foreground px-3.5 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-40",
            )}
            disabled={disabled || !ready}
            onClick={() => onApply({ action: "aplicar", path: path.trim(), lines })}
            data-action="aplicar"
          >
            {n ? `Agregar al PR #${n} y marcar hecho` : "Agregar al PR y marcar hecho"}
          </button>
        </div>
      )}
    </div>
  );
};
