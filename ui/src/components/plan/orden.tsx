// 2.11 Orden: the audit on screen, at the bottom of the project page. Collapsed with its count;
// "Lo tuyo" holds what Jorge clears with one click or a copied command, "De los agentes" the rest
// (an agent picks those up from get_next when nothing is claimable).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { toast } from "sonner";
import { CopyCommand } from "@/components/copy-command";
import { SectionTitle } from "@/components/plan/project-parts";
import { TicketButton } from "@/components/plan/ticket-button";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import type { OrdenFinding } from "@/lib/types";

const BUTTON: Record<string, string> = { retire_decision: "Retirar la decisión", mark_deployed: "Marcar desplegado" };

function Row({ slug, f, onOpen }: { slug: string; f: OrdenFinding; onOpen: (key: string) => void }) {
  const queryClient = useQueryClient();
  const fix = useMutation({
    mutationFn: () => api.fixAudit(slug, { code: f.code, key: f.key, id: f.id! }),
    onSuccess: (orden) => {
      queryClient.setQueryData(["project", slug, "audit"], orden);
      toast("Hecho");
    },
    onError: (e) => toast.error(e instanceof ApiError && e.code === "FINDING_NOT_FOUND" ? "Ya no está; se actualiza la lista." : "No se pudo; recarga y vuelve a intentarlo."),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["project", slug] }),
  });
  return (
    <li className="grid gap-1.5 px-4 py-3 text-[13px]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-[11px] font-semibold text-muted-foreground">{f.code}</span>
        {f.key && (
          <TicketButton taskKey={f.key} onOpen={onOpen}>
            <span className="font-mono text-[11px] underline-offset-4 group-hover/ticket:underline">{f.key}</span>
          </TicketButton>
        )}
      </div>
      <p className="leading-snug">{f.detail}</p>
      {f.can_fix === "copy" && f.command ? (
        <CopyCommand command={f.command} />
      ) : f.can_fix === "open" ? (
        <p className="text-xs text-muted-foreground">{f.fix_hint}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="outline" disabled={fix.isPending} onClick={() => fix.mutate()}>
            {BUTTON[f.can_fix]}
          </Button>
          <span className="text-xs text-muted-foreground">{f.fix_hint}</span>
        </div>
      )}
    </li>
  );
}

function Group({ title, items, slug, onOpen }: { title: string; items: OrdenFinding[]; slug: string; onOpen: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="grid gap-1">
      <h3 className="px-1 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
        {title} <span className="tabular-nums">{items.length}</span>
      </h3>
      <ul className="divide-y overflow-hidden rounded-[16px] border bg-card">
        {items.map((f, i) => <Row key={`${f.code}:${f.id ?? f.key ?? i}`} slug={slug} f={f} onOpen={onOpen} />)}
      </ul>
    </div>
  );
}

export function OrdenSection({ slug, onOpen }: { slug: string; onOpen: (key: string) => void }) {
  const audit = useQuery({ queryKey: ["project", slug, "audit"], queryFn: () => api.audit(slug) });
  const findings = audit.data?.findings ?? [];
  if (!audit.data) return null;
  return (
    <details className="group/orden grid gap-3">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground transition-transform group-open/orden:rotate-90" />
        <SectionTitle hint={findings.length ? "lo que los datos dicen que está mal" : "todo en orden"}>
          Orden <span className="tabular-nums">{findings.length}</span>
        </SectionTitle>
      </summary>
      <div className="mt-3 grid gap-4">
        <Group title="Lo tuyo" items={findings.filter((f) => f.owner === "jorge")} slug={slug} onOpen={onOpen} />
        <Group title="De los agentes" items={findings.filter((f) => f.owner === "agents")} slug={slug} onOpen={onOpen} />
      </div>
    </details>
  );
}
