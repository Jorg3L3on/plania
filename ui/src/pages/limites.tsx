import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import { words } from "@/lib/i18n";
import { LIMITS_WORDS, type LimitsPage } from "@/lib/limites";

// PLA-I2-7: what the team may never do, what only the owner does, where agents work, what leaves the machine and
// what the rules cannot stop. Built by GET /api/limits from the real rules; words in lib/limites.ts.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function LimitesPage() {
  const w = words(LIMITS_WORDS);
  const page = useQuery({ queryKey: ["limits"], queryFn: () => api.limits(), staleTime: 5 * 60_000 });
  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <Kicker>{w.kicker}</Kicker>
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{w.link}</h1>
        <p className="text-muted-foreground">{w.intro}</p>
      </header>
      {page.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : page.isError ? (
        <p className="text-sm text-muted-foreground">{w.failed}</p>
      ) : (
        <LimitesView page={page.data} />
      )}
    </div>
  );
}

/** The page apart from the query, so a test renders it from limitsPage(). */
export function LimitesView({ page }: { page: LimitsPage }) {
  const w = words(LIMITS_WORDS);
  return (
    <div className="grid gap-10">
      <Section title={w.neverTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          {page.never.map((g) => (
            <Card key={g.id} className="grid content-start gap-2 p-4" data-limit-group={g.id}>
              <p className="font-medium">{g.title}</p>
              {g.extra ? <p className="text-xs text-muted-foreground">{g.extra}</p> : null}
              <p className="text-sm">{g.lead}</p>
              <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
                {g.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </Section>

      <Section title={w.ownerTitle}>
        <ul className="grid list-disc gap-2 pl-5">
          {page.owner_only.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Section>

      <Section title={w.whereTitle}>
        {page.where.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </Section>

      <Section title={w.outboundTitle}>
        <Card className="p-0">
          <ul className="divide-y">
            {page.outbound.map((o) => (
              <li key={o.id} className="grid gap-1 px-4 py-3" data-outbound={o.id}>
                <p className="font-medium">
                  {o.name}
                  {o.optional ? <span className="ml-2 text-xs font-normal text-muted-foreground">{w.optional}</span> : null}
                </p>
                <p className="text-sm">{o.sentence}</p>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section title={w.cannotTitle}>
        <Card className="grid gap-3 border-amber-500/40 p-4" data-limits-honest>
          {page.cannot.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </Card>
      </Section>
    </div>
  );
}
