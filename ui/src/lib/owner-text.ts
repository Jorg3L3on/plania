// PLA-141: a built-in text (a role's prompt, a factory skill) as the owner reads it on the screen. The kit keeps its
// provenance for maintainers (a skill's closing «Origin:» line, ticket keys in parentheses, a prompt's header note on
// where it is appended and edited); none of that is meant for the owner's screen. Display only: what runs is unchanged.

const KEY = String.raw`[A-Z]{2,8}-[A-Z0-9]+(?:-[A-Z0-9]+)*`;
/** «(PLA-82, F-11: «…»)», «(AUDIT-4)», «(PLA-I46-12)»: a parenthesis that starts with a ticket key. */
const KEYED = new RegExp(String.raw` ?\(${KEY}\b[^()]*\)`, "g");

export function ownerText(md: string): string {
  const paras = md.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const kept = paras.filter((p, i) => {
    const t = p.trim();
    if (i === 0 && /^# Prompt:/.test(t) && !t.includes("\n")) return false;
    if (/^Role prompt the Plania runner\b/.test(t)) return false;
    if (/^Origin:/.test(t)) return false;
    return true;
  });
  return kept
    .join("\n\n")
    .replace(KEYED, "")
    .replace(/[ \t]+([.,;:])/g, "$1")
    .trim();
}
