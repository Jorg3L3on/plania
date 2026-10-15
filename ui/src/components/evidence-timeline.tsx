// 2.11 (fix d): the ticket sheet's evidence as a timeline, so a Done ticket tells what ran and
// against which commit without opening GitHub: verdict in tone, kind, cite, the commit (linked to
// the PR's commit page when the task has a PR), the command, counts, duration, "en commit anterior"
// when the branch moved past it, and the checks the result ticked.
import { ExternalLinkIcon } from "lucide-react";
import type { StationTone } from "@/lib/lanes";
import { TONE_BG, TONE_TEXT } from "@/components/plan/visuals";
import { localTime } from "@/lib/time";
import type { Result } from "@/lib/types";
import { cn } from "@/lib/utils";

const VERDICT: Record<string, { glyph: string; tone: StationTone; word: string }> = {
  pass: { glyph: "✓", tone: "done", word: "pasó" },
  warn: { glyph: "!", tone: "now", word: "aviso" },
  fail: { glyph: "✗", tone: "blocked", word: "falló" },
};

/** "/pull/12" → "…/pull/12/commits/<sha>"; elsewhere no link. */
function commitHref(prUrl: string | null | undefined, sha: string): string | null {
  return prUrl && /\/pull\/\d+$/.test(prUrl) ? `${prUrl}/commits/${sha}` : null;
}

function duration(s: number): string {
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60 ? `${s % 60} s` : ""}`.trim() : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function countsText(c: NonNullable<Result["counts"]>): string {
  return [c.pass !== undefined && `${c.pass} ok`, c.fail ? `${c.fail} fallidas` : null, c.skip ? `${c.skip} omitidas` : null].filter(Boolean).join(" · ");
}

export function EvidenceTimeline({ results, prUrl }: { results: Result[]; prUrl?: string | null }) {
  // Newest first: the last run is what the ticket stands on.
  const rows = [...results].reverse();
  return (
    <ol className="relative grid gap-3 text-sm before:absolute before:top-2 before:bottom-2 before:left-[9px] before:w-px before:bg-border">
      {rows.map((r) => {
        const v = VERDICT[r.verdict] ?? { glyph: "·", tone: "pending" as StationTone, word: r.verdict };
        const href = r.commit ? commitHref(prUrl, r.commit) : null;
        return (
          <li key={r.id} className="relative grid grid-cols-[20px_minmax(0,1fr)] gap-x-2.5">
            <span
              aria-label={v.word}
              title={v.word}
              className={cn("z-10 mt-0.5 inline-flex size-[19px] items-center justify-center rounded-full text-[11px] font-bold text-white", TONE_BG[v.tone])}
            >
              {v.glyph}
            </span>
            <div className="grid min-w-0 gap-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className={cn("font-mono text-xs font-semibold", TONE_TEXT[v.tone])}>{r.kind}</span>
                {r.commit &&
                  (href ? (
                    <a href={href} target="_blank" rel="noreferrer" className="font-mono text-xs underline underline-offset-4">
                      {r.commit.slice(0, 7)}
                    </a>
                  ) : (
                    <span className="font-mono text-xs">{r.commit.slice(0, 7)}</span>
                  ))}
                {r.stale_for_head && (
                  <span className="rounded-full bg-foreground/[0.06] px-1.5 py-px text-[10.5px] text-muted-foreground" title="La rama avanzó desde esta corrida">
                    en commit anterior
                  </span>
                )}
                {r.ticked_checks && r.ticked_checks.length > 0 && (
                  <span className="text-xs text-ink-done" title="Checks que esta evidencia marcó">☑ {r.ticked_checks.join(", ")}</span>
                )}
                {r.env && <span className="text-xs text-muted-foreground">en {r.env}</span>}
              </div>
              <p className="leading-snug break-words">{r.cite}</p>
              {r.command && <code className="w-fit max-w-full rounded-md bg-surface-sunken px-2 py-0.5 font-mono text-xs break-all">{r.command}</code>}
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {r.counts && countsText(r.counts) && <span>{countsText(r.counts)}</span>}
                {r.duration_s != null && <span>{duration(r.duration_s)}</span>}
                {r.exit_code != null && r.exit_code !== 0 && <span>salida {r.exit_code}</span>}
                <span>{r.actor.agent} · {localTime(r.at)}</span>
                {r.url && (
                  <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-4">
                    enlace <ExternalLinkIcon className="size-3" />
                  </a>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
