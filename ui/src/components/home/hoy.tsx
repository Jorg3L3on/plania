// 2.12 "Hoy": above the city, what changed since Jorge last tapped "Visto" on this device. Per project
// the digest's highlights as chips (hechos, a revisar, PRs, tomados) and what waits on him as links
// into the Bandeja on the right tab. The cursor lives in localStorage per device; "Visto" stores the
// digest's cursor there and as the server's bookmark for the screen, and clears the strip.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { accentInk, projectAccent } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import type { Digest, DigestHighlights } from "@/lib/types";

const CURSOR_KEY = "plania.hoy.cursor";
// needs_jorge is what waits now, not what changed: after "Visto" only what started waiting later shows.
const SEEN_AT_KEY = "plania.hoy.seen_at";

function readNumber(key: string): number | undefined {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isInteger(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

function writeNumber(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    // Private mode: the server's bookmark still moved.
  }
}

type Chip = { label: string; keys: string[] };

// The highlights worth a chip, in the order Jorge reads them.
export function chipsOf(h: DigestHighlights): Chip[] {
  const n = (k: string[], one: string, many: string): Chip | null => (k.length ? { label: `${k.length} ${k.length === 1 ? one : many}`, keys: k } : null);
  const prs = (list: number[], one: string, many: string): Chip | null => (list.length ? { label: `${list.length} ${list.length === 1 ? one : many}`, keys: list.map((p) => `#${p}`) } : null);
  return [
    n(h.done, "hecho", "hechos"),
    n(h.to_review, "a revisar", "a revisar"),
    prs(h.prs_merged, "PR fusionado", "PRs fusionados"),
    prs(h.prs_opened, "PR abierto", "PRs abiertos"),
    n(h.claims, "tomado", "tomados"),
    n(h.blocked, "bloqueado", "bloqueados"),
  ].filter((c): c is Chip => c !== null);
}

// What waits on Jorge and started after the last "Visto" on this device (all of it before the first).
export function waitingSince(d: Digest, seenAt: number | undefined, now = Date.now()) {
  return d.needs_jorge.filter((i) => i.group !== "limpieza" && (!seenAt || now - i.wait_s * 1000 > seenAt));
}

export function hoyIsEmpty(d: Digest, seenAt?: number, now = Date.now()): boolean {
  return !waitingSince(d, seenAt, now).length && d.projects.every((p) => chipsOf(p.highlights).length === 0);
}

const sinceWord = (d: Digest) => (d.since_from === "default" ? "en las últimas 24 h" : "desde tu último Visto");

export function Hoy({ names }: { names: (slug: string) => string }) {
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState(() => readNumber(CURSOR_KEY));
  const [seenAt, setSeenAt] = useState(() => readNumber(SEEN_AT_KEY));
  const digest = useQuery({ queryKey: ["digest", cursor ?? null], queryFn: () => api.digest(cursor), staleTime: 15_000 });
  const seen = useMutation({
    mutationFn: (c: number) => api.digestSeen(c),
    onMutate: (c) => {
      const at = Date.now();
      writeNumber(CURSOR_KEY, c);
      writeNumber(SEEN_AT_KEY, at);
      setCursor(c);
      setSeenAt(at);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["digest"] }),
  });

  const d = digest.data;
  if (!d || hoyIsEmpty(d, seenAt)) return null;
  const waiting = waitingSince(d, seenAt);
  const active = d.projects.filter((p) => chipsOf(p.highlights).length > 0);

  return (
    <section aria-labelledby="hoy-title" className="grid animate-rise gap-3 rounded-[20px] border bg-card/60 px-4 py-3.5 sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="hoy-title" className="font-display text-lg font-bold tracking-tight">
          Hoy <span className="text-sm font-normal text-muted-foreground">{sinceWord(d)}</span>
        </h2>
        <Button variant="outline" size="sm" disabled={seen.isPending} onClick={() => seen.mutate(d.cursor)} className="shrink-0">
          <CheckIcon aria-hidden /> Visto
        </Button>
      </div>

      {active.length > 0 && (
        <ul className="grid gap-2">
          {active.map((p) => {
            const [a] = projectAccent(p.slug);
            return (
              <li key={p.slug} className="flex flex-wrap items-center gap-1.5">
                <Link to={`/p/${p.slug}`} className="mr-1 text-sm font-semibold underline-offset-4 hover:underline" style={{ color: accentInk(a) }}>
                  {names(p.slug)}
                </Link>
                {chipsOf(p.highlights).map((c) => (
                  <span key={c.label} title={c.keys.join(", ")} className="inline-flex h-7 items-center rounded-full border px-2.5 text-xs tabular-nums">
                    {c.label}
                  </span>
                ))}
              </li>
            );
          })}
        </ul>
      )}

      {waiting.length > 0 && (
        <div className="grid gap-1.5">
          <p className="text-xs font-semibold tracking-wide text-ink-jorge uppercase">Te espera</p>
          <ul className="grid gap-1">
            {waiting.slice(0, 6).map((i, n) => (
              <li key={`${i.project}-${i.kind}-${i.key ?? n}-${n}`}>
                <Link
                  to={`/inbox?tab=${i.group}#${i.project}`}
                  className="flex min-h-10 items-baseline gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="shrink-0 text-xs text-muted-foreground">{names(i.project)}{i.key ? ` · ${i.key}` : ""}</span>
                  <span className="min-w-0 truncate">{i.why || i.title}</span>
                </Link>
              </li>
            ))}
          </ul>
          {waiting.length > 6 && (
            <Link to="/inbox" className="px-2 text-xs text-muted-foreground underline underline-offset-4">
              y {waiting.length - 6} más en la Bandeja
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
