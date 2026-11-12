// PLA-I36: the levers on a project, kept for the building's plan side page (PLA-I39-6, -9).
//   Steer      the callbacks the page passes down (ask, pick next, pause, runs, notes, cancel, options).
//   Detalles   keys, branch words and switches live here only: plan approval and the preview address.
// Presentational: data and callbacks come in as props.
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { AskResult, OrderKind, OrgProject } from "@/lib/api";
import { pillGhost } from "@/components/compania/parts";


export type Steer = {
  onAsk: (slug: string, input: { text: string; kind?: OrderKind; now: boolean }) => Promise<AskResult>;
  onPickNext: (slug: string, key: string) => void;
  onPause: (p: OrgProject) => void;
  onRun: (action: "stop" | "resume", runId: string) => void;
  onNote: (slug: string, key: string, text: string) => void;
  onCancelOrder: (slug: string, key: string) => void;
  onOptions: (slug: string, input: { plan_approval?: boolean; preview_url?: string | null }) => void;
  // Text handed back by "Cambiar algo", per project.
  prefill?: Record<string, string>;
  busy?: string | null;
};

// ---- Detalles: keys and switches, out of the main lines (PLA-I36-11)

export const Detalles = ({ project: p, steer }: { project: OrgProject; steer?: Steer }) => {
  const [url, setUrl] = useState(p.preview_url ?? "");
  const keys = [
    p.plan ? `Iniciativa ${p.plan.initiative.key}` : "",
    p.next ? `Siguiente ${p.next.key}` : "",
    ...(p.orders ?? []).filter((o) => o.key).map((o) => `Pedido ${o.key}`),
  ].filter(Boolean);
  return (
    <details className="min-w-0 text-xs text-muted-foreground" data-detalles>
      <summary className="cursor-pointer font-semibold select-none">Detalles</summary>
      <div className="grid min-w-0 gap-2 pt-2">
        {keys.length > 0 && <p className="font-mono break-words">{keys.join(" · ")}</p>}
        {steer && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!p.plan_approval} onChange={(e) => steer.onOptions(p.slug, { plan_approval: e.target.checked })} data-control="aprobar-planes" />
            Aprobar el plan antes de que empiece el trabajo
          </label>
        )}
        {steer && (
          <form
            className="flex min-w-0 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              steer.onOptions(p.slug, { preview_url: url.trim() || null });
            }}
          >
            <input
              aria-label="Dirección de la vista previa"
              className="min-h-9 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm"
              placeholder="https://… vista previa"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button type="submit" className={cn(pillGhost, "min-h-9 px-3 text-xs")}>
              Guardar
            </button>
          </form>
        )}
      </div>
    </details>
  );
};
