// PLA-148 (F-6): a request's name on the board, the ficha and the headline. A request's title is the start of the
// owner's own text, cut at about 80 characters mid-word: the name is its first sentence, cut on a word when it runs long. The full text stays on hover and in the ficha. Pure.

export const NAME_MAX = 48;
const MIN_SENTENCE = 16;

/** The first sentence (up to the first period, colon, ! or ? followed by a space), at most `max` characters, cut on a word. */
export function ideaName(text: string | null | undefined, max = NAME_MAX): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const end = t.search(/[.:!?](?=\s|$)/);
  // A first sentence too short to name anything («Arreglar: …») keeps going.
  const first = (end >= MIN_SENTENCE ? t.slice(0, end) : t).trim().replace(/[.:]+$/, "");
  if (first.length <= max) return first;
  const cut = first.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  const head = (space > max / 2 ? cut.slice(0, space) : first.slice(0, max)).replace(/[\s,;:.\-–—]+$/, "");
  return `${head}…`;
}
