// 2.10: the release as a step in the Bandeja's Pasos. One row per project: from → into with how many
// tickets and migrations it ships, the tickets, the before-steps as a checklist, the open checks,
// and the command Jorge runs. The row goes away on its own once the poller sees `into` contain `from`.
import { Link } from "react-router";
import { CopyCommand } from "@/components/copy-command";
import { ProjectMark } from "@/components/plania-mark";
import { waitText } from "@/lib/inbox";
import type { InboxItem, ReleasePlan } from "@/lib/types";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function releaseLine(plan: ReleasePlan): string {
  const parts = [plural(plan.tickets.length, "ticket", "tickets")];
  if (plan.migrations.length) parts.push(plural(plan.migrations.length, "migración", "migraciones"));
  return `${plan.from.branch} → ${plan.into.branch}: ${parts.join(", ")}`;
}

/** The plan waits on Jorge: from is ahead with merged tickets on it. */
export const releasePending = (plan: ReleasePlan | null | undefined): plan is ReleasePlan => !!plan && !plan.shipped && (plan.ahead ?? 0) > 0 && plan.tickets.length > 0;

export function ReleaseRow({ item }: { item: InboxItem }) {
  const plan = item.target as unknown as ReleasePlan;
  const taskHref = (key: string) => `/p/${item.project}?task=${encodeURIComponent(key)}`;
  return (
    <li className="grid gap-3 rounded-2xl border bg-card px-4 py-3.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ProjectMark slug={item.project} className="size-6" />
        <span className="font-medium">{releaseLine(plan)}</span>
        <span className="text-xs text-muted-foreground">
          {plan.ahead !== null && `${plural(plan.ahead, "commit", "commits")} por delante · `}espera {waitText(item.wait_s)}
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
      <CopyCommand command={plan.command} caption="Lo corres tú; Plania no hace merge" />
    </li>
  );
}
