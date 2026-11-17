// PLA-I42-2: the footer (spec §8 item 5): "Generated {stamp}" plus the app names; a muted line when parts are
// missing (partial or facts_only). No banner.
import type { BriefData, BriefLanguage } from "@/lib/brief";
import { BRIEF_LABELS } from "@/lib/brief-i18n";

export function BriefFooter({ data, stamp, language }: { data: BriefData; stamp: string; language: BriefLanguage }) {
  const t = BRIEF_LABELS[language];
  return (
    <footer className="grid gap-1 border-t border-border pt-4 text-sm text-muted-foreground" data-brief="footer">
      <p>
        {t.generated(stamp)}
        {data.apps.length > 0 && ` · ${data.apps.map((a) => a.name).join(" · ")}`}
      </p>
      {data.mode !== "full" && <p data-brief="missing">{t.missing}</p>}
    </footer>
  );
}
