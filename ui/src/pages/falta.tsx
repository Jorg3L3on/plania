import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, MinusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import { STATE_WORD, fixParts, machineHeadline, type MachineCheckReading, type MachineItem } from "@/lib/falta";
import { localTime } from "@/lib/time";
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
        aria-label={STATE_WORD[item.state]}
      >
        <Mark className="size-3.5" />
      </span>
      <div className="grid min-w-0 gap-1">
        <p className="font-medium">
          {item.name}
          {!item.required ? <span className="ml-2 text-xs font-normal text-muted-foreground">opcional</span> : null}
        </p>
        <p className="text-sm">{item.sentence}</p>
        {item.fix ? <Fix fix={item.fix} /> : null}
      </div>
    </li>
  );
}

// PLA-I2-2: firstStart reads the same check before there is a session (GET /api/first-start/machine-check).
export function FaltaPage({ firstStart = false }: { firstStart?: boolean } = {}) {
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
        <Kicker>Esta máquina</Kicker>
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Qué le falta</h1>
        <p className="text-muted-foreground">Lo que Plania necesita para trabajar aquí, y cómo arreglar lo que falta.</p>
      </header>

      {check.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : check.isError ? (
        <p className="text-sm text-muted-foreground">No se pudo revisar la máquina.</p>
      ) : (
        <FaltaView reading={check.data} checking={checking} onAgain={again} />
      )}
    </div>
  );
}

/** The reading, apart from the query, so a test renders it from the same items the install command prints. */
export function FaltaView({ reading, checking = false, onAgain }: { reading: MachineCheckReading; checking?: boolean; onAgain?: () => void }) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg font-semibold">{machineHeadline(reading.items)}</p>
        <Button variant="outline" size="sm" onClick={onAgain} disabled={checking}>
          <RefreshCwIcon className={cn("size-4", checking && "animate-spin")} />
          Revisar otra vez
        </Button>
      </div>
      <Card className="p-0">
        <ul className="divide-y">
          {reading.items.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </ul>
      </Card>
      <p className="text-xs text-muted-foreground">Revisada a las {localTime(reading.checked_at)}.</p>
    </section>
  );
}
