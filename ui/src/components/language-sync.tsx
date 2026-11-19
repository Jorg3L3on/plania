import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { LANGUAGES, LANGUAGE_NAMES, adoptLanguage, getLanguage, words, type Language } from "@/lib/i18n";
import { LANGUAGE_WORDS } from "@/lib/language-words";

// PLA-I2-10: keeps the screen in the install's language. The page loads in the language it last saw; when the server
// has a chosen one that differs, the page reloads in it (lib/i18n.ts says why the language is fixed per load).

export function LanguageSync() {
  const server = useQuery({ queryKey: ["language"], queryFn: () => api.language(), staleTime: 5 * 60_000, retry: false });
  useEffect(() => {
    if (server.data?.chosen && adoptLanguage(server.data.language)) window.location.reload();
  }, [server.data]);
  return null;
}

/** The switch in Plomería: one choice for the screen and the morning brief. */
export function LanguageSwitch() {
  const w = words(LANGUAGE_WORDS);
  const save = useMutation({
    mutationFn: (language: Language) => api.setLanguage(language),
    onSuccess: (r) => {
      if (adoptLanguage(r.language)) window.location.reload();
    },
  });
  return (
    <label className="cor-text" data-control="idioma">
      <b>{w.label}</b> ·{" "}
      <select className="cor-input" value={getLanguage()} disabled={save.isPending} onChange={(e) => save.mutate(e.target.value as Language)} aria-label={w.label}>
        {LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {LANGUAGE_NAMES[l]}
          </option>
        ))}
      </select>{" "}
      <span className="cor-cap">{save.isError ? w.failed : w.hint}</span>
    </label>
  );
}
