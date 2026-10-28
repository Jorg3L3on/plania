import { localTime } from "@/lib/time";

// A short review mark: the owner answered through the bot. The quote and the time stay visible.
export const DelegadaBadge = ({ quote, at }: { quote: string; at: string }) => {
  return (
    <span
      className="inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-full border border-orange-500/40 bg-orange-500/10 px-2 py-0.5 text-[11px] text-orange-800 dark:text-orange-200"
      aria-label="Delegada"
    >
      <span className="font-semibold">«Delegada»</span>
      <span className="min-w-0 break-words">{quote}</span>
      <time dateTime={at}>{localTime(at)}</time>
    </span>
  );
};
