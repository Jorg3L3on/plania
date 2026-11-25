// 2.12 "Hoy": above the city, what changed since the owner last tapped "Visto" on this device. Per project
// the digest's highlights as chips (hechos, a revisar, PRs, tomados) and what waits on him as links
// into the Bandeja on the right tab. The cursor lives in localStorage per device; "Visto" stores the
// digest's cursor there and as the server's bookmark for the screen, and clears the strip.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Link } from "react-router";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { Button } from "@/components/ui/button";
import { accentInk, projectAccent } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import type { Digest, DigestHighlights } from "@/lib/types";
import { getLanguage, words, type Language } from "@/lib/i18n";
import { HOME_HOY } from "@/lib/home-pieces-words";

const CURSOR_KEY = "plania.hoy.cursor";
// needs_owner is what waits now, not what changed: after "Visto" only what started waiting later shows.
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

// The highlights worth a chip, in the order the owner reads them.
export function chipsOf(h: DigestHighlights, language: Language = getLanguage()): Chip[] {
  const w = words(HOME_HOY, language);
  const n = (k: string[], label: (n: number) => string): Chip | null => (k.length ? { label: label(k.length), keys: k } : null);
  const prs = (list: number[], label: (n: number) => string): Chip | null => (list.length ? { label: label(list.length), keys: list.map((p) => `#${p}`) } : null);
  return [
    n(h.done, w.done),
    n(h.to_review, w.toReview),
    prs(h.prs_merged, w.prsMerged),
    prs(h.prs_opened, w.prsOpened),
    n(h.claims, w.claims),
    n(h.blocked, w.blocked),
  ].filter((c): c is Chip => c !== null);
}

// What waits on the owner and started after the last "Visto" on this device (all of it before the first).
export function waitingSince(d: Digest, seenAt: number | undefined, now = Date.now()) {
  return d.needs_owner.filter((i) => i.group !== "limpieza" && (!seenAt || now - i.wait_s * 1000 > seenAt));
}

export function hoyIsEmpty(d: Digest, seenAt?: number, now = Date.now()): boolean {
  return !waitingSince(d, seenAt, now).length && d.projects.every((p) => chipsOf(p.highlights).length === 0);
}

const sinceWord = (d: Digest) => (d.since_from === "default" ? words(HOME_HOY).last24h : words(HOME_HOY).sinceSeen);

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

  const reducido = useReducedMotion() ?? false;
  const d = digest.data;
  const show = !!d && !hoyIsEmpty(d, seenAt);

  // «Visto» clears the strip: it fades and folds (180ms) so the city moves up into its place instead of jumping. The
  // strip that leaves keeps its last content while it goes. On load it rises as before.
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          key="hoy"
          className="min-w-0"
          exit={reducido ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, height: 0, scale: 0.98, transition: { duration: 0.18, ease: [...motionTokens.ease.standard] } }}
        >
          <HoyStrip d={d} seenAt={seenAt} names={names} onSeen={() => seen.mutate(d.cursor)} pending={seen.isPending} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function HoyStrip({ d, seenAt, names, onSeen, pending }: { d: Digest; seenAt: number | undefined; names: (slug: string) => string; onSeen: () => void; pending: boolean }) {
  const w = words(HOME_HOY);
  const reducido = useReducedMotion() ?? false;
  const waiting = waitingSince(d, seenAt);
  const active = d.projects.filter((p) => chipsOf(p.highlights).length > 0);

  return (
    <section aria-labelledby="hoy-title" className="grid animate-rise grid-cols-1 gap-3 rounded-[20px] border bg-card/60 px-4 py-3.5 sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="hoy-title" className="min-w-0 font-display text-lg font-bold tracking-tight">
          {w.today} <span className="text-sm font-normal text-muted-foreground">{sinceWord(d)}</span>
        </h2>
        <Button variant="outline" size="sm" disabled={pending} onClick={onSeen} className="shrink-0 transition-[background-color,color,scale,translate] active:scale-[0.97] motion-reduce:transition-none">
          <CheckIcon aria-hidden /> {w.seen}
        </Button>
      </div>

      {active.length > 0 && (
        <ul className="grid grid-cols-1 gap-2">
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
        <div className="grid grid-cols-1 gap-1.5">
          <p className="text-xs font-semibold tracking-wide text-ink-owner uppercase">{w.waitsOnYou}</p>
          {/* A decision that arrives while the page is open folds in (200ms) instead of pushing the rows; one that is
              settled folds out (140ms). Opening the page plays nothing. Keys are the decision's, never its position, so a
              new one at the top does not replay the others. */}
          <ul className="grid grid-cols-1">
            <AnimatePresence initial={false}>
              {waiting.slice(0, 6).map((i) => (
              <motion.li
                key={`${i.project}-${i.kind}-${i.key ?? i.title}`}
                className="overflow-hidden"
                initial={reducido ? { opacity: 0 } : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto", transition: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] } }}
                exit={reducido ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, height: 0, transition: { duration: motionTokens.duration.exit, ease: [...motionTokens.ease.standard] } }}
              >
                <Link
                  to={`/inbox?tab=${i.group}#${i.project}`}
                  className="mb-1 flex min-h-11 flex-col gap-0.5 rounded-lg px-2 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none sm:min-h-10 sm:flex-row sm:items-baseline sm:gap-2 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-foreground/[0.05]"
                >
                  {/* On a phone the project and key sit over the reason, so the reason keeps the whole width. */}
                  <span className="shrink-0 text-xs text-muted-foreground">{names(i.project)}{i.key ? ` · ${i.key}` : ""}</span>
                  <span className="min-w-0 truncate max-sm:line-clamp-2 max-sm:whitespace-normal">{i.why || i.title}</span>
                </Link>
              </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          {waiting.length > 6 && (
            <Link to="/inbox" className="px-2 text-xs text-muted-foreground underline underline-offset-4">
              {w.moreInInbox(waiting.length - 6)}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
