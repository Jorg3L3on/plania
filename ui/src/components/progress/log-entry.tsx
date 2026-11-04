import { useState } from "react";
import { ProjectChip } from "@/components/progress/recap-bits";
import { isGif, projectColor, TYPE_MARK } from "@/lib/progress";
import type { ProgressLogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = { entry: ProgressLogEntry; q: string };

const Mark = ({ text, q }: { text: string; q: string }) => {
  const needle = q.trim();
  if (needle.length < 2) return <>{text}</>;
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const at = lower.indexOf(n, cursor);
    if (at < 0) {
      parts.push(text.slice(cursor));
      break;
    }
    if (at > cursor) parts.push(text.slice(cursor, at));
    parts.push(
      <mark key={at} className="rounded bg-[#ff7a2e55] text-inherit">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    cursor = at + needle.length;
  }
  return <>{parts}</>;
};

const Frame = ({ src, label, tone, alt }: { src: string; label: string; tone: "before" | "after"; alt: string }) => {
  const [hidden, setHidden] = useState(false);
  const handleError = () => setHidden(true);
  if (hidden) return null;
  return (
    <div
      className={cn(
        "relative min-h-36 overflow-hidden rounded-2xl border border-white/10",
        tone === "before" ? "bg-[radial-gradient(90%_80%_at_50%_0%,#451a1a,#0a0a0d)]" : "bg-[radial-gradient(90%_80%_at_50%_0%,#064e3b,#0a0a0d)]",
      )}
    >
      <span className={cn("absolute top-2 left-2 z-10 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-black tracking-[0.14em]", tone === "before" ? "text-[#fca5a5]" : "text-[#6ee7b7]")}>
        {label}
      </span>
      {isGif(src) && (
        <span className="absolute top-2 right-2 z-10 flex size-6 items-center justify-center rounded-full bg-white text-[9px] font-black text-black" aria-hidden>
          ▶
        </span>
      )}
      <img src={src} alt={alt} loading="lazy" decoding="async" onError={handleError} className="h-40 w-full object-cover object-top" />
    </div>
  );
};

export const LogEntryCard = ({ entry, q }: Props) => {
  const color = projectColor(entry.project);
  const shots = [
    entry.images.before ? { src: entry.images.before, label: "ANTES", tone: "before" as const } : null,
    entry.images.after ? { src: entry.images.after, label: "DESPUÉS", tone: "after" as const } : null,
  ].filter((shot) => shot !== null);
  const showChange = entry.change.trim() && entry.change.trim() !== entry.summary.trim();
  return (
    <article
      className={cn(
        "relative rounded-[22px] border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.03] p-3.5",
        entry.kind === "initiative" && "border-[#a78bfa33] bg-gradient-to-br from-[#2a1240] to-[#0c0a14]",
      )}
    >
      <span
        aria-hidden
        className="absolute top-5 -left-[22px] size-3 rounded-full"
        style={{ background: color, boxShadow: `0 0 0 4px #0c0e14, 0 0 12px ${color}` }}
      />
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <ProjectChip slug={entry.project}>{entry.project_title}</ProjectChip>
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#e4e4e7]">
          <span aria-hidden>{TYPE_MARK[entry.type] ?? "•"}</span>
          {entry.type_label}
        </span>
        <time className="ml-auto text-[11px] font-bold text-[#71717a]" dateTime={entry.at}>
          {entry.time}
        </time>
      </div>
      <h3 className="text-[16px] leading-snug font-extrabold tracking-tight">
        <Mark text={entry.title} q={q} />
      </h3>
      {entry.summary && <p className="mt-1 text-[13px] leading-snug text-[#a1a1aa]">{entry.summary}</p>}
      {showChange && (
        <p className="mt-2 rounded-r-[10px] border-l-2 bg-white/5 px-2.5 py-1.5 text-[12px] text-[#d4d4d8]" style={{ borderColor: color }}>
          <b>Qué cambió: </b>
          {entry.change}
        </p>
      )}
      {shots.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {shots.map((shot) => (
            <Frame key={shot.label} src={shot.src} label={shot.label} tone={shot.tone} alt={`${shot.label}: ${entry.title}`} />
          ))}
        </div>
      )}
      {entry.kind === "initiative" && entry.child_total > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${color}, ${color})`, boxShadow: `0 0 12px ${color}` }} />
            <b className="text-[12px]">
              {entry.child_done}/{entry.child_total} tickets
            </b>
          </div>
          <ul className="mt-1">
            {entry.children.map((child) => (
              <li key={child.key} className="flex items-center gap-2 border-t border-white/10 py-2 text-[13px] first:border-none">
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-black"
                  style={{ background: color, boxShadow: `0 0 10px ${color}` }}
                  aria-hidden
                >
                  {child.status === "Done" ? "✓" : "·"}
                </span>
                <span className="min-w-0 flex-1">{child.title}</span>
                {child.pr_number && <span className="text-[11px] font-extrabold text-[#c4b5fd]">#{child.pr_number}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(entry.prs.length > 0 || entry.key) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {entry.prs.map((pr) => (
            <a
              key={pr.number}
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-[9px] border border-[#7c3aed44] bg-[#7c3aed22] px-2 py-1 text-[11.5px] font-bold text-[#c4b5fd]"
            >
              ⎇ PR #{pr.number} ↗
            </a>
          ))}
          {entry.key && <span className="rounded-[9px] border border-white/10 bg-white/5 px-2 py-1 text-[11.5px] font-bold text-[#e4e4e7]">{entry.key}</span>}
        </div>
      )}
    </article>
  );
};
