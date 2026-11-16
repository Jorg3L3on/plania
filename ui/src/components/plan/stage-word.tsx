// PLA-I53-5: a ticket's stage word with its dot, from the app's one stage map (lib/etapas.ts), the same word its card
// shows on the stage board. Without the server's etapa it reads the stored status as a stage (statusEtapa).
import type { Etapa } from "@/lib/api";
import { ETAPA_TONE, statusEtapa, wordOf } from "@/lib/etapas";
import { Glyph, TONE_TEXT } from "@/components/plan/visuals";
import { cn } from "@/lib/utils";

export function StageWord({ etapa, status }: { etapa?: Pick<Etapa, "etapa" | "qa" | "live"> | null; status: string }) {
  const e = etapa ?? (statusEtapa(status) ? { etapa: statusEtapa(status)!, qa: null, live: false } : null);
  if (!e) return null;
  const tone = e.etapa === "en_qa" && e.qa !== "running" ? "pending" : ETAPA_TONE[e.etapa];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap", TONE_TEXT[tone])} data-stage-word={e.etapa}>
      <Glyph tone={tone} size={7} />
      {wordOf({ ...e, holder: null, since: null, ci: null, reason: null })}
    </span>
  );
}

