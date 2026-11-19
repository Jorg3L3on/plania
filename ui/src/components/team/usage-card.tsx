import { useQuery } from "@tanstack/react-query";
import { api, type UsageTotal } from "@/lib/api";
import { LOCALE } from "@/lib/locale";
import { words } from "@/lib/i18n";
import { USAGE_CARD } from "@/lib/usage-card-words";

const count = (n: number) => n.toLocaleString(LOCALE);

const UsageRow = ({ row }: { row: UsageTotal }) => (
  <tr className="border-t border-border/70">
    <td className="px-3 py-2 font-medium">{row.agent}</td>
    <td className="px-3 py-2">{row.project}</td>
    <td className="px-3 py-2 tabular-nums">{row.week}</td>
    <td className="px-3 py-2 text-right tabular-nums">{count(row.input)}</td>
    <td className="px-3 py-2 text-right tabular-nums">{count(row.output)}</td>
  </tr>
);

export const UsageCard = () => {
  const w = words(USAGE_CARD);
  const usage = useQuery({ queryKey: ["usage"], queryFn: api.usage, staleTime: 15_000 });

  return (
    <section aria-labelledby="usage-title" className="grid gap-3 rounded-[20px] border bg-card/60 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="usage-title" className="font-display text-lg font-bold tracking-tight">
          {w.title}
        </h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{w.badge}</span>
      </div>
      <p className="text-sm text-muted-foreground">{w.lead}</p>
      {usage.isPending ? (
        <p className="text-sm text-muted-foreground">{w.loading}</p>
      ) : usage.isError || !usage.data ? (
        <p className="text-sm text-muted-foreground">{w.failed}</p>
      ) : usage.data.totals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{w.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <caption className="sr-only">{w.caption}</caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">{w.agent}</th>
                <th scope="col" className="px-3 py-2 font-medium">{w.project}</th>
                <th scope="col" className="px-3 py-2 font-medium">{w.week}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{w.input}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{w.output}</th>
              </tr>
            </thead>
            <tbody>
              {usage.data.totals.map((row) => (
                <UsageRow key={`${row.agent}:${row.project}:${row.week}`} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
