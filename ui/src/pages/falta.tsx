import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, MinusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Kicker } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import { FALTA, fixParts, machineHeadline, type MachineCheckReading, type MachineItem } from "@/lib/falta";
import { words } from "@/lib/i18n";
import { localTime } from "@/lib/time";
import { revisandoLine } from "@/lib/revisando";
import { cn } from "@/lib/utils";

// PLA-I2-12: what this machine lacks to run Plania, the same items the install command prints
// (GET /api/machine-check, words in lib/falta.ts). Required items first, Chrome last as optional.

const MARK = { ready: CheckIcon, missing: XIcon, optional: MinusIcon } as const;

function Fix({ fix }: { fix: string }) {
  const { before, url, after } = fixParts(fix);
  return (
    <p className="text-sm text-muted-foreground">
      {before}
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
          {url}
        </a>
      ) : null}
      {after}
    </p>
  );
}

function Row({ item }: { item: MachineItem }) {
  const w = words(FALTA);
  const Mark = MARK[item.state];
  return (
    <li className="flex gap-3 px-4 py-3">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
          item.state === "ready" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
          item.state === "missing" && "bg-red-500/15 text-red-700 dark:text-red-300",
          item.state === "optional" && "bg-foreground/10 text-muted-foreground",
        )}
        aria-label={w.states[item.state]}
      >
        <Mark className="size-3.5" />
      </span>
      <div className="grid min-w-0 gap-1">
        <p className="font-medium">
          {item.name}
          {!item.required ? <span className="ml-2 text-xs font-normal text-muted-foreground">{w.optional}</span> : null}
        </p>
        <p className="text-sm">{item.sentence}</p>
        {item.fix ? <Fix fix={item.fix} /> : null}
      </div>
    </li>
  );
}

// PLA-I2-2: firstStart reads the same check before there is a session (GET /api/first-start/machine-check).
export function FaltaPage({ firstStart = false }: { firstStart?: boolean } = {}) {
  const w = words(FALTA);
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const read = firstStart ? api.firstStartMachineCheck : api.machineCheck;
  const key = firstStart ? ["first-start", "machine-check"] : ["machine-check"];
  const check = useQuery({ queryKey: key, queryFn: () => read(), staleTime: 60_000 });
  const again = async () => {
    setChecking(true);
    try {
      queryClient.setQueryData(key, await read(true));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <Kicker>{w.kicker}</Kicker>
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{w.title}</h1>
        <p className="text-muted-foreground">{w.lead}</p>
      </header>

      {check.isPending ? (
        // P3: the Claude test takes about ten seconds; say so instead of an empty card.
        <Card className="flex-row items-center gap-3 p-4" role="status" aria-busy="true" data-revisando>
          <RefreshCwIcon className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{revisandoLine()}</p>
        </Card>
      ) : check.isError ? (
        <p className="text-sm text-muted-foreground">{w.failed}</p>
      ) : (
        <FaltaView reading={check.data} checking={checking} onAgain={again} />
      )}
    </div>
  );
}

/** The reading, apart from the query, so a test renders it from the same items the install command prints. */
// againButton false: the caller draws its own (the first-delivery wizard's «Reintentar», under the list).
export function FaltaView({ reading, checking = false, onAgain, againButton = true }: { reading: MachineCheckReading; checking?: boolean; onAgain?: () => void; againButton?: boolean }) {
  const w = words(FALTA);
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg font-semibold">{machineHeadline(reading.items)}</p>
        {againButton ? (
          <Button variant="outline" size="sm" onClick={onAgain} disabled={checking}>
            <RefreshCwIcon className={cn("size-4", checking && "animate-spin")} />
            {w.again}
          </Button>
        ) : null}
      </div>
      <Card className="p-0">
        <ul className="divide-y">
          {reading.items.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </ul>
      </Card>
      <p className="text-xs text-muted-foreground">{w.checkedAt(localTime(reading.checked_at))}</p>
    </section>
  );
}
