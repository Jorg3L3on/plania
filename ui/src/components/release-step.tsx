// 2.10: the release as a step in the Bandeja's Pasos. One row per project: from → into with how many
// tickets and migrations it ships, the tickets, the before-steps as a checklist, the open checks,
// and the command the owner runs. The row goes away on its own once the poller sees `into` contain `from`.
// 2.13: in merge mode the command gives way to "Lanzar": a confirm sheet repeats the plan and the
// server merges a PR from → into with a merge commit (gh pr merge --merge) as the owner.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { toast } from "sonner";
import { CopyCommand } from "@/components/copy-command";
import { ProjectMark } from "@/components/plania-mark";
import { OWNER_CODE_WORDS } from "@/components/compania/sheets";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ApiError, api } from "@/lib/api";
import { waitText } from "@/lib/inbox";
import type { InboxItem, ReleasePlan, ShipBlock } from "@/lib/types";
import { getLanguage, words, type Language } from "@/lib/i18n";
import { RELEASE } from "@/lib/release-words";

type ReleaseWords = (typeof RELEASE)["es"];

export function releaseLine(plan: ReleasePlan, language: Language = getLanguage()): string {
  const w = words(RELEASE, language);
  const parts = [w.tickets(plan.tickets.length)];
  if (plan.migrations.length) parts.push(w.migrations(plan.migrations.length));
  return `${plan.from.branch} → ${plan.into.branch}: ${parts.join(", ")}`;
}

/** The plan waits on the owner: from is ahead with merged tickets on it. */
export const releasePending = (plan: ReleasePlan | null | undefined): plan is ReleasePlan => !!plan && !plan.shipped && (plan.ahead ?? 0) > 0 && plan.tickets.length > 0;

/** PLA-03: tickets wait but there is no compare for these heads; unknown, never "nothing to ship". */
export const releaseUnknown = (plan: ReleasePlan | null | undefined): plan is ReleasePlan => !!plan && !plan.shipped && plan.ahead === null && plan.tickets.length > 0;

// Why Lanzar is off (ShipBlock): the words live in lib/release-words.ts (PLA-I2-10).
const shipBlock = (w: ReleaseWords, reason: ShipBlock): string | undefined => (w.shipBlock as Record<ShipBlock, string>)[reason];

function shipError(e: unknown, w: ReleaseWords): string {
  if (!(e instanceof ApiError)) return w.shipFailed;
  if (OWNER_CODE_WORDS[e.code]) return OWNER_CODE_WORDS[e.code]!;
  if (e.code === "RELEASE_MERGE_FAILED") return w.mergeFailed(String(e.detail.step), String(e.detail.output ?? ""));
  if (e.code === "RELEASE_NOT_READY") return w.notReady(shipBlock(w, e.detail.reason as ShipBlock) ?? String(e.detail.reason));
  return e.code;
}

function ShipButton({ item, plan }: { item: InboxItem; plan: ReleasePlan }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const w = words(RELEASE);
  const ship = useMutation({
    mutationFn: () => api.shipRelease(item.project),
    onSuccess: (out) => {
      toast(w.merged(plan.from.branch, plan.into.branch, out.merge_sha.slice(0, 7)));
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
        {w.release}
      </Button>
      {reason && reason !== "merged" && <span className="text-xs text-muted-foreground">{shipBlock(w, reason)}</span>}
      <Sheet open={open} onOpenChange={(o) => !ship.isPending && setOpen(o)}>
        <SheetContent side="bottom" className="mx-auto max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl">
          <SheetHeader>
            <SheetDescription>{w.releaseTo(plan.env)}</SheetDescription>
            <SheetTitle className="font-display text-2xl">
              {plan.from.branch} → {plan.into.branch}
            </SheetTitle>
          </SheetHeader>
          <div className="grid gap-4 px-4 text-sm">
            <p>
              {w.planOpens}
              <span className="font-mono">{plan.from.branch}</span>
              {w.planTo}
              <span className="font-mono">{plan.into.branch}</span>
              {w.planMerges}
              {plan.from.head_sha ? <>{w.planAt}<span className="font-mono">{plan.from.head_sha.slice(0, 7)}</span></> : null}
              {w.planThen(plan.env)}
            </p>
            <div className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                {w.tickets(plan.tickets.length)}
                {plan.ahead !== null && ` · ${w.commits(plan.ahead)}`}
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
                {w.migrationsLine(plan.migrations.length, plan.migrations.join(", "), plan.into.branch, plan.env)}
              </p>
            )}
            {ship.isError && (
              <p role="alert" className="rounded-lg border border-destructive/40 px-3 py-2 text-destructive">
                {shipError(ship.error, w)}
              </p>
            )}
          </div>
          <SheetFooter className="flex-row justify-end gap-2">
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setOpen(false)} disabled={ship.isPending}>
              {w.cancel}
            </Button>
            <Button className="h-11 sm:h-9" onClick={() => ship.mutate()} disabled={ship.isPending}>
              {ship.isPending ? w.releasing : w.releaseN(plan.tickets.length)}
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
  const w = words(RELEASE);
  return (
    <li className="grid gap-3 rounded-2xl border bg-card px-4 py-3.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ProjectMark slug={item.project} className="size-6" />
        <span className="font-medium">{releaseLine(plan)}</span>
        <span className="text-xs text-muted-foreground">
          {plan.ahead !== null ? w.ahead(plan.ahead) : w.noGithub}{w.waits(waitText(item.wait_s))}
        </span>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label={w.ticketsAria}>
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
          <span className="text-xs font-medium text-muted-foreground">{w.beforeRelease}</span>
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
        <span className="text-xs font-medium text-ink-now">{w.openChecks(plan.open_checks)}</span>
      )}
      {plan.merged ? (
        <span className="text-xs text-muted-foreground">
          {w.mergedLabel}{" "}
          <a href={plan.merged.pr_url} target="_blank" rel="noreferrer" className="font-mono underline-offset-4 hover:underline">
            {plan.merged.sha.slice(0, 7)}
          </a>
          {w.waitDeploy(plan.into.branch, plan.env)}
        </span>
      ) : plan.mode === "merge" ? (
        <ShipButton item={item} plan={plan} />
      ) : (
        <CopyCommand command={plan.command} caption={w.youRunIt} />
      )}
    </li>
  );
}
