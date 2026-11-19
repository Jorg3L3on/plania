import { localTime } from "@/lib/time";
import { words } from "@/lib/i18n";
import { DELEGATION } from "@/lib/delegation-words";

// A short review mark: the owner answered through the bot. The quote and the time stay visible.
export const DelegadaBadge = ({ quote, at }: { quote: string; at: string }) => {
  const w = words(DELEGATION);
  return (
    <span
      className="inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-full border border-orange-500/40 bg-orange-500/10 px-2 py-0.5 text-[11px] text-orange-800 dark:text-orange-200"
      aria-label={w.delegated}
    >
      <span className="font-semibold">{w.delegatedMark}</span>
      <span className="min-w-0 break-words">{quote}</span>
      <time dateTime={at}>{localTime(at)}</time>
    </span>
  );
};
