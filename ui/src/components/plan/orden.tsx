// 2.11 Orden: the audit on screen, at the bottom of the project page. Collapsed with its count;
// "Lo tuyo" holds what the owner clears with one click or a copied command, "De los agentes" the rest
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
import { words } from "@/lib/i18n";
import { PLAN } from "@/lib/plan-words";

// PLA-I2-10: the one-click fixes' button words, by can_fix.
const BUTTON: Record<string, "retireDecision" | "markDeployed"> = { retire_decision: "retireDecision", mark_deployed: "markDeployed" };

function Row({ slug, f, onOpen }: { slug: string; f: OrdenFinding; onOpen: (key: string) => void }) {
  const queryClient = useQueryClient();
  const w = words(PLAN);
  const fix = useMutation({
    mutationFn: () => api.fixAudit(slug, { code: f.code, key: f.key, id: f.id! }),
    onSuccess: (orden) => {
      queryClient.setQueryData(["project", slug, "audit"], orden);
      toast(w.done);
    },
    onError: (e) => toast.error(e instanceof ApiError && e.code === "FINDING_NOT_FOUND" ? w.findingGone : w.fixFailed),
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
            {BUTTON[f.can_fix] ? w[BUTTON[f.can_fix]!] : undefined}
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
  const w = words(PLAN);
  if (!audit.data) return null;
  return (
    <details className="group/orden grid gap-3">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground transition-transform group-open/orden:rotate-90" />
        <SectionTitle hint={findings.length ? w.ordenBad : w.ordenOk}>
          {w.orden} <span className="tabular-nums">{findings.length}</span>
        </SectionTitle>
      </summary>
      <div className="mt-3 grid gap-4">
        <Group title={w.yours} items={findings.filter((f) => f.owner === "owner")} slug={slug} onOpen={onOpen} />
        <Group title={w.agents} items={findings.filter((f) => f.owner === "agents")} slug={slug} onOpen={onOpen} />
      </div>
    </details>
  );
}
