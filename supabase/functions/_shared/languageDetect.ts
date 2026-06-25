/**
 * Lightweight language detection from page markdown.
 *
 * Used by crawl-categorize to tag projects (single-campus) or each
 * campus partition (multi-campus) with the language partners write in.
 * Drives downstream "verbatim only" gates — when a church publishes
 * entirely in Spanish (or any non-English language), we don't suggest
 * rewrites; we just help organize and redesign.
 *
 * Approach: stopword tally. Each language carries a small set of
 * very-common function words (articles, prepositions, conjunctions,
 * pronouns) that essentially never appear in other languages. We
 * tokenize the text, count hits per language, and pick the winner.
 * Cheap, deterministic, no model call. Wrong for very short text
 * (< 20 words) but those are footer blurbs / nav — uninteresting.
 *
 * Not a full language identifier — this is a "is this English vs
 * Spanish (or Portuguese)" classifier. Adding new languages is one
 * line each in LANG_STOPWORDS.
 */

/**
 * Stopword sets per language. Word lists are deliberately short and
 * orthogonal — only words that are unambiguous in their language
 * (e.g. Spanish "el" is also English "El" the name; we lowercase
 * during tokenize, but English text shouldn't accumulate Spanish-
 * stopword hits unless it really IS Spanish).
 *
 * If you add a language, keep the list to ~30 high-frequency words
 * — too many false positives if you over-include.
 */
const LANG_STOPWORDS: Record<string, ReadonlySet<string>> = {
  en: new Set([
    'the', 'and', 'a', 'an', 'of', 'to', 'in', 'is', 'are', 'was',
    'were', 'for', 'with', 'that', 'this', 'these', 'those', 'on',
    'at', 'by', 'from', 'as', 'it', 'its', 'he', 'she', 'we', 'they',
    'you', 'your', 'our', 'their', 'will', 'would', 'should', 'have',
    'has', 'had', 'do', 'does', 'did', 'be', 'been', 'being',
  ]),
  es: new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del',
    'y', 'o', 'que', 'qué', 'en', 'por', 'para', 'con', 'sin', 'sobre',
    'es', 'son', 'está', 'están', 'ser', 'estar', 'al', 'lo', 'le',
    'les', 'su', 'sus', 'mi', 'tu', 'nuestro', 'nuestra', 'esto',
    'esta', 'este', 'pero', 'porque', 'cuando', 'donde', 'también',
    'más', 'muy', 'todo', 'todos', 'todas', 'cada',
  ]),
  pt: new Set([
    'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da',
    'dos', 'das', 'e', 'ou', 'que', 'em', 'no', 'na', 'nos', 'nas',
    'por', 'para', 'com', 'sem', 'sobre', 'é', 'são', 'está', 'estão',
    'ser', 'estar', 'ao', 'à', 'seu', 'sua', 'seus', 'suas', 'meu',
    'minha', 'nosso', 'nossa', 'isto', 'isso', 'mas', 'porque',
    'quando', 'onde', 'também', 'muito', 'todo', 'cada',
  ]),
}

/**
 * Tokenize text for stopword matching. Lowercases, splits on any
 * non-letter character (including accents and dashes), drops empty
 * tokens. Keeps accented chars (á, é, ñ, etc.) intact via the
 * Unicode-aware regex.
 */
function tokenize(text: string): string[] {
  if (!text) return []
  // Split on anything that isn't a Unicode letter. Keeps á / é / ñ.
  return text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(w => w.length > 0)
}

export interface LanguageDetectionResult {
  /** ISO 639-1 code. Falls back to 'en' when no clear winner. */
  language: string
  /** Per-language hit counts (debug / surfacing in UI when confidence
   *  is low — staff can see why we decided what we decided). */
  scores: Record<string, number>
  /** Total tokens examined. Detection on < MIN_TOKENS is unreliable;
   *  callers may want to fall back to 'en' or 'unknown'. */
  total_tokens: number
}

/** Below this many tokens, detection is too noisy to trust. */
export const MIN_TOKENS_FOR_DETECTION = 80

/**
 * Detect the dominant language from a body of text. Returns 'en' when
 * the text is too short to trust OR when no language clearly wins
 * (within 25% of next-best — ties are typically multilingual nav, not
 * a real signal).
 */
export function detectLanguage(text: string): LanguageDetectionResult {
  const tokens = tokenize(text)
  const scores: Record<string, number> = {}
  for (const lang of Object.keys(LANG_STOPWORDS)) scores[lang] = 0
  for (const tok of tokens) {
    for (const [lang, set] of Object.entries(LANG_STOPWORDS)) {
      if (set.has(tok)) scores[lang]++
    }
  }
  if (tokens.length < MIN_TOKENS_FOR_DETECTION) {
    return { language: 'en', scores, total_tokens: tokens.length }
  }
  // Pick the winner, but require a clear margin over the runner-up.
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [topLang, topScore] = sorted[0]
  const runnerUpScore = sorted[1]?.[1] ?? 0
  if (topScore === 0) return { language: 'en', scores, total_tokens: tokens.length }
  // 25% margin — keeps multilingual sites with a Spanish ministry
  // page mixed into mostly-English content from flipping to Spanish.
  if (runnerUpScore > 0 && topScore / runnerUpScore < 1.25) {
    return { language: 'en', scores, total_tokens: tokens.length }
  }
  return { language: topLang, scores, total_tokens: tokens.length }
}

/**
 * Detect across a corpus (an array of page-like objects). Concatenates
 * each page's markdown/content with a separator, then runs single-doc
 * detection. Used per campus partition during crawl-categorize.
 */
export function detectLanguageFromPages(
  pages: ReadonlyArray<{ markdown?: string | null; content?: string | null }>,
): LanguageDetectionResult {
  const parts: string[] = []
  for (const p of pages) {
    const text = p?.markdown ?? p?.content ?? ''
    if (text) parts.push(text)
  }
  return detectLanguage(parts.join('\n\n'))
}
