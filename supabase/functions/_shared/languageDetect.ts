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
 * Stopword sets per language. Curated to MAXIMIZE between-language
 * discrimination, not just frequency:
 *   - Spanish + Portuguese share `que`, `em/en`, `por`, `para`, `con/com`,
 *     `sobre`, `ser`, `estar`, `é/es`, `están/estão`, `porque`, etc.
 *     Counting these in BOTH languages makes Spanish content easy to
 *     misclassify as Portuguese (and vice versa) on small corpora.
 *   - We list ONLY the words that are characteristic of one language
 *     and rare/absent in the other Romance language we model.
 *   - Highly-discriminating Spanish: `el`, `la`, `los`, `las`, `del`,
 *     `pero`, `nuestro`, `nuestra`, `también`, `más`, `muy`, `son`,
 *     `esto`, `esta`, `este`. These literally do not occur as
 *     stopwords in Portuguese (Portuguese uses `o/a/os/as`, `do/da`,
 *     `mas`, `nosso/nossa`, `também`(overlap), `mais`, `muito`, `são`,
 *     `isto`/`isso`).
 *   - Highly-discriminating Portuguese: `o`, `os`, `as`, `do`, `da`,
 *     `dos`, `das`, `no`, `na`, `nos`, `nas`, `é`, `são`, `ao`, `à`,
 *     `seu`, `sua`, `nosso`, `nossa`, `isto`, `isso`, `mas`, `mais`,
 *     `muito`. These are absent from Spanish.
 *
 * Add languages by listing only the discriminating-against-already-
 * present-languages stopwords.
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
    // Articles: Spanish has masculine/feminine plurals los/las which
    // Portuguese spells os/as. Spanish "del" is a contraction
    // Portuguese never uses (Portuguese: "do/da").
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'del',
    // Verbs / copulas: Spanish-only forms.
    'son', 'soy', 'eres', 'somos',
    // Common Spanish-only function words.
    'pero', 'también', 'más', 'muy', 'todos', 'todas',
    // Demonstratives — Spanish forms (Portuguese: isto, isso, este, esta — note Portuguese also has esta/este but the cluster of esto/esta/este/estos/estas is Spanish-leaning).
    'esto', 'esta', 'este', 'estos', 'estas',
    // Possessives: nuestro/nuestra are Spanish (Portuguese: nosso/nossa).
    'nuestro', 'nuestra', 'nuestros', 'nuestras',
    // Other discriminating function words.
    'mi', 'tu', 'su', 'sus', 'cuando', 'donde', 'porque', 'cada',
  ]),
  pt: new Set([
    // Articles: Portuguese has feminine "a" and "as" as articles, and
    // partitive contractions "do/da/dos/das" which Spanish lacks.
    'o', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'do', 'da', 'dos', 'das',
    'no', 'na', 'nos', 'nas', 'pelo', 'pela', 'pelos', 'pelas',
    // Verbs / copulas: Portuguese-only forms (é, são, ao).
    'é', 'são', 'ao', 'à', 'às',
    // Discriminating function words (Portuguese forms).
    'mas', 'mais', 'muito', 'também', 'tudo',
    // Possessives Portuguese-side.
    'seu', 'sua', 'seus', 'suas', 'meu', 'minha', 'meus', 'minhas',
    'nosso', 'nossa', 'nossos', 'nossas',
    // Demonstratives Portuguese-side.
    'isto', 'isso', 'aquilo',
  ]),
}

/** Strong character-class signal: certain glyphs are ~exclusive to a
 *  language. ñ → Spanish; ã / õ → Portuguese; ç → Portuguese (some
 *  French, but we don't model French as a separate lang). Each
 *  occurrence in the corpus adds a sharp boost to that language's
 *  score. Bypasses the stopword overlap problem for romance pairs. */
const CHARACTER_SIGNAL_WEIGHT = 3
const CHARACTER_SIGNALS: Record<string, RegExp> = {
  es: /[ñ¿¡]/g,
  pt: /[ãõç]/g,
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
  // Character-class signal: add weighted points for language-
  // exclusive glyphs (ñ→es, ã/õ/ç→pt). One ñ in a five-page Spanish
  // crawl is more discriminating than ten copies of the word "que".
  if (text) {
    for (const [lang, re] of Object.entries(CHARACTER_SIGNALS)) {
      const matches = text.match(re)
      if (matches && matches.length > 0) {
        scores[lang] = (scores[lang] ?? 0) + matches.length * CHARACTER_SIGNAL_WEIGHT
      }
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
