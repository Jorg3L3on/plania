import { recapGlass } from "@/components/progress/recap-bits";
import { words } from "@/lib/i18n";
import { PROGRESS_WORDS } from "@/lib/progress-words";

export const RecapEmpty = () => {
  const w = words(PROGRESS_WORDS);
  return (
  <section className={`${recapGlass} px-6 py-10 text-center`}>
    <p className="text-5xl" aria-hidden>
      🌱
    </p>
    <h2 className="mt-3 font-display text-xl font-black tracking-tight">{w.emptyTitle}</h2>
    <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-[#a1a1aa]">
      {w.emptyLine}
    </p>
  </section>
  );
};
