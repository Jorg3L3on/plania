// 2.10: the release as a step in the Bandeja's Pasos. One row per project: from → into with how many
// tickets and migrations it ships, the tickets, the before-steps as a checklist, the open checks,
// and the command Jorge runs. The row goes away on its own once the poller sees `into` contain `from`.
// 2.13: in merge mode the command gives way to "Lanzar": a confirm sheet repeats the plan and the
// server merges a PR from → into with a merge commit (gh pr merge --merge) as Jorge.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { toast } from "sonner";
import { CopyCommand } from "@/components/copy-command";
import { ProjectMark } from "@/components/plania-mark";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ApiError, api } from "@/lib/api";
import { waitText } from "@/lib/inbox";
import type { InboxItem, ReleasePlan, ShipBlock } from "@/lib/types";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function releaseLine(plan: ReleasePlan): string {
  const parts = [plural(plan.tickets.length, "ticket", "tickets")];
  if (plan.migrations.length) parts.push(plural(plan.migrations.length, "migración", "migraciones"));
  return `${plan.from.branch} → ${plan.into.branch}: ${parts.join(", ")}`;
}

/** The plan waits on Jorge: from is ahead with merged tickets on it. */
export const releasePending = (plan: ReleasePlan | null | undefined): plan is ReleasePlan => !!plan && !plan.shipped && (plan.ahead ?? 0) > 0 && plan.tickets.length > 0;

/** PLA-03: tickets wait but there is no compare for these heads; unknown, never "nothing to ship". */
export const releaseUnknown = (plan: ReleasePlan | null | undefined): plan is ReleasePlan => !!plan && !plan.shipped && plan.ahead === null && plan.tickets.length > 0;

// Why Lanzar is off, said the way the row says everything else.
const SHIP_BLOCK: Record<ShipBlock, string> = {
  mode_command: "Modo comando: lo corres tú",
  no_repo: "Falta settings.github.repo",
  no_github_data: "Sin datos de GitHub",
  nothing_to_ship: "No hay nada por lanzar",
  before_steps: "Primero los pasos de arriba",
  open_checks: "Primero cierra los puntos abiertos",
  merged: "Ya fusionado",
};

function shipError(e: unknown): string {
  if (!(e instanceof ApiError)) return "No se pudo lanzar.";
  if (e.code === "RELEASE_MERGE_FAILED") return `GitHub no aceptó el paso ${String(e.detail.step)}: ${String(e.detail.output ?? "")}`;
  if (e.code === "RELEASE_NOT_READY") return `Ya no se puede lanzar: ${SHIP_BLOCK[e.detail.reason as ShipBlock] ?? String(e.detail.reason)}.`;
  return e.code;
}

function ShipButton({ item, plan }: { item: InboxItem; plan: ReleasePlan }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const ship = useMutation({
    mutationFn: () => api.shipRelease(item.project),
    onSuccess: (out) => {
      toast(`${plan.from.branch} → ${plan.into.branch} fusionado (${out.merge_sha.slice(0, 7)}); el deploy lo cierra`);
      setOpen(false);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const reason = plan.ship.reason;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => (ship.reset(), setOpen(true))} disabled={!plan.ship.ready} className="h-11 px-5 sm:h-9">
        Lanzar
      </Button>
      {reason && reason !== "merged" && <span className="text-xs text-muted-foreground">{SHIP_BLOCK[reason]}</span>}
      <Sheet open={open} onOpenChange={(o) => !ship.isPending && setOpen(o)}>
        <SheetContent side="bottom" className="mx-auto max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl">
          <SheetHeader>
            <SheetDescription>Lanzar a {plan.env}</SheetDescription>
            <SheetTitle className="font-display text-2xl">
              {plan.from.branch} → {plan.into.branch}
            </SheetTitle>
          </SheetHeader>
          <div className="grid gap-4 px-4 text-sm">
            <p>
              Plania abre (o reutiliza) un PR de <span className="font-mono">{plan.from.branch}</span> a <span className="font-mono">{plan.into.branch}</span> y lo fusiona con merge
              commit{plan.from.head_sha ? <> en <span className="font-mono">{plan.from.head_sha.slice(0, 7)}</span></> : null}. Cuando {plan.env} despliegue, los tickets pasan a Released.
            </p>
            <div className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                {plural(plan.tickets.length, "ticket", "tickets")}
                {plan.ahead !== null && ` · ${plural(plan.ahead, "commit", "commits")}`}
              </span>
              <ul className="grid gap-1">
                {plan.tickets.map((t) => (
                  <li key={t.key} className="flex items-baseline gap-2">
                    <span className="font-mono text-xs">{t.key}</span>
                    <span>{t.title}</span>
                  </li>
                ))}
              </ul>
            </div>
            {plan.migrations.length > 0 && (
              <p className="font-medium text-ink-now">
                {plural(plan.migrations.length, "migración", "migraciones")}: {plan.migrations.join(", ")}. {plan.into.branch} las necesita en {plan.env}.
              </p>
            )}
            {ship.isError && (
              <p role="alert" className="rounded-lg border border-destructive/40 px-3 py-2 text-destructive">
                {shipError(ship.error)}
              </p>
            )}
          </div>
          <SheetFooter className="flex-row justify-end gap-2">
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setOpen(false)} disabled={ship.isPending}>
              Cancelar
            </Button>
            <Button className="h-11 sm:h-9" onClick={() => ship.mutate()} disabled={ship.isPending}>
              {ship.isPending ? "Lanzando…" : `Lanzar ${plural(plan.tickets.length, "ticket", "tickets")}`}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function ReleaseRow({ item }: { item: InboxItem }) {
  const plan = item.target as unknown as ReleasePlan;
  const taskHref = (key: string) => `/p/${item.project}?task=${encodeURIComponent(key)}`;
  return (
    <li className="grid gap-3 rounded-2xl border bg-card px-4 py-3.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ProjectMark slug={item.project} className="size-6" />
        <span className="font-medium">{releaseLine(plan)}</span>
        <span className="text-xs text-muted-foreground">
          {plan.ahead !== null ? `${plural(plan.ahead, "commit", "commits")} por delante · ` : "sin datos de GitHub · "}espera {waitText(item.wait_s)}
        </span>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Tickets">
        {plan.tickets.map((t) => (
          <li key={t.key}>
            <Link to={taskHref(t.key)} title={t.title} className="inline-flex h-6 items-center rounded-full border px-2 font-mono text-[11px] underline-offset-4 hover:underline">
              {t.key}
            </Link>
          </li>
        ))}
        {plan.migrations.map((m) => (
          <li key={m} className="inline-flex h-6 items-center rounded-full bg-muted px-2 font-mono text-[11px] text-muted-foreground">mig {m}</li>
        ))}
      </ul>
      {plan.before.length > 0 && (
        <div className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">Antes de lanzar</span>
          <ul className="grid gap-1">
            {plan.before.map((b) => (
              <li key={b.blocker_id} className="flex items-baseline gap-2">
                <span aria-hidden>○</span>
                <span>
                  {b.text}{" "}
                  <Link to={taskHref(b.key)} className="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline">{b.key}</Link>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.open_checks > 0 && (
        <span className="text-xs font-medium text-ink-now">{plural(plan.open_checks, "punto abierto", "puntos abiertos")} en el Done when de estos tickets</span>
      )}
      {plan.merged ? (
        <span className="text-xs text-muted-foreground">
          Fusionado{" "}
          <a href={plan.merged.pr_url} target="_blank" rel="noreferrer" className="font-mono underline-offset-4 hover:underline">
            {plan.merged.sha.slice(0, 7)}
          </a>
          ; espera a que {plan.into.branch} llegue a {plan.env}
        </span>
      ) : plan.mode === "merge" ? (
        <ShipButton item={item} plan={plan} />
      ) : (
        <CopyCommand command={plan.command} caption="Lo corres tú; Plania no hace merge" />
      )}
    </li>
  );
}
