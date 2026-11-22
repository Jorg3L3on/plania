// PLA-158 (F-11): text the owner typed once (a Preguntar question) shown again on a screen others may see: the
// secret-looking parts are covered. A value after password / contraseña / clave / token / secret / api key (with ":",
// "=", "es", "is", "con password …"), a known key shape (sk-…, ghp_…, github_pat_…, xox…-, AKIA…) and a long
// base64 or hex run become «••••». Pure; the server keeps the text as it was.

export const MASK = "••••";

// Words that always label a secret, and words that do only with ":" / "=" or a token-like value («tokens gastados»
// and «la clave del asunto» stay as they are).
const STRONG = String.raw`passwords?|passwd|pwd|contrase(?:\u00f1|n)as?|secrets?|api[\s_-]?keys?|access[\s_-]?keys?`;
const WEAK = String.raw`claves?|tokens?|llaves?|secretos?|keys?`;
const L = String.raw`(?<![\p{L}\p{N}_])`;
const R = String.raw`(?![\p{L}\p{N}_])`;
const SEP = String.raw`(?:\s*[:=]\s*|\s+(?:es|is|era|was|ser\u00eda)\s+|\s*)`;
const VALUE = String.raw`(["'\u00ab\u201c]?)([^\s"'\u00bb\u201d,;)]+)`;
const LABELLED = new RegExp(String.raw`${L}((?:${STRONG})|(?:${WEAK}))${R}(${SEP})${VALUE}`, "giu");
const STRONG_RE = new RegExp(String.raw`^(?:${STRONG})$`, "iu");
const STOP = /^(?:de|del|la|el|los|las|un|una|que|para|por|en|con|y|o|no|si|of|the|a|an|for|to|and|or|in|on|is|es)$/i;
const KEYS = /(?:sk-[A-Za-z0-9_-]{8,}|sk_(?:live|test)_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[abposr]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,})/g;
// A run of 32+ characters with letters and digits mixed (base64, base64url, hex): a token, not a word.
const LONG = /[A-Za-z0-9+/_=-]{32,}/g;
const tokenLike = (s: string) => (/\d/.test(s) && /[A-Za-z]/.test(s)) || /[^\p{L}\s]/u.test(s.replace(/[.!?]$/, ""));

/** The text with each secret-looking part replaced by «••••». */
export function redactSecrets(text: string | null | undefined): string {
  let t = text ?? "";
  t = t.replace(LABELLED, (m, word: string, sep: string, quote: string, value: string) => {
    if (value === MASK || STOP.test(value)) return m;
    const strong = STRONG_RE.test(word.replace(/\s+/g, " "));
    const marked = /[:=]/.test(sep);
    if (!strong && !marked && !tokenLike(value)) return m;
    return `${word}${sep}${quote}${MASK}`;
  });
  t = t.replace(KEYS, MASK);
  t = t.replace(LONG, (m) => (/\d/.test(m) && /[A-Za-z]/.test(m) ? MASK : m));
  return t;
}
