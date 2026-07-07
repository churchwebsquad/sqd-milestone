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
 * Stopword sets per language. CMS partners are essentially never
 * Portuguese churches — the Spanish-speaking world (Latin America +
 * the US Hispanic church) is where multilingual sites land. So we
 * model only English vs Spanish and DON'T try to disambiguate
 * Portuguese as a separate language; the Romance signal is "this is
 * Spanish (or close enough that Spanish-verbatim treatment is the
 * right call)". A Portuguese partner is rare enough that the false
 * positive is preferable to mistagging a Spanish church as Portuguese
 * — which would route copy to the wrong verbatim-locked workflow.
 *
 * Spanish stopwords are curated to MAXIMIZE discrimination against
 * English specifically. Words shared with Portuguese (que, en/em, por,
 * para, con/com, sobre, ser, estar, etc.) are EXCLUDED on purpose —
 * those don't help separate Spanish from English either, since they
 * also don't appear in English.
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
    // Articles — Spanish has unique forms vs Portuguese.
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'del',
    // Copulas + verb conjugations distinct from Portuguese forms.
    'son', 'soy', 'eres', 'somos',
    // Common Spanish-only function words / discriminators.
    'pero', 'también', 'más', 'muy', 'todos', 'todas',
    // Demonstratives — Spanish forms.
    'esto', 'esta', 'este', 'estos', 'estas',
    // Possessives — Spanish has nuestro/nuestra (Portuguese nosso/nossa).
    'nuestro', 'nuestra', 'nuestros', 'nuestras',
    // Other discriminating function words.
    'mi', 'tu', 'su', 'sus', 'cuando', 'donde', 'porque', 'cada',
    // Romance-language stopwords that nonetheless help separate Spanish
    // from English. Portuguese also uses some of these but since we
    // don't try to model Portuguese, including them just makes Spanish
    // detection more sensitive on small corpora.
    'que', 'en', 'por', 'para', 'con', 'sin', 'sobre',
    'es', 'ser', 'estar', 'está', 'están', 'al', 'lo', 'le', 'les',
    'y', 'o', 'no', 'si', 'sí',
  ]),
}

/** Strong character-class signal: certain glyphs are essentially
 *  exclusive to Spanish in a partner-CMS-content context (ñ, ¿, ¡).
 *  Each occurrence weighted heavily so a bilingual site whose template
 *  chrome is in English but whose body text is in Spanish still tags
 *  as Spanish — these characters literally don't appear in English
 *  outside foreign-name references, so even ~10 occurrences across a
 *  full crawl mean the partner is writing in Spanish. */
const CHARACTER_SIGNAL_WEIGHT = 10
const CHARACTER_SIGNALS: Record<string, RegExp> = {
  es: /[ñ¿¡]/g,
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
  // Character-class signal: count language-exclusive glyphs (ñ, ¿, ¡
  // for Spanish). Two roles:
  //   1. Weighted boost on scores[lang] so glyphs inform the tally.
  //   2. A hard override for the case where English template chrome
  //      (nav / footer boilerplate / Squarespace scaffolding) drowns
  //      out genuinely-Spanish body content in the stopword tally.
  //
  // The override is NOT an absolute count. Axis Church has 177 ñ / ¿
  // / ¡ glyphs across 48 pages, but 39 of them are on a single
  // /espanol page and the remaining 138 are 3-per-page template
  // chrome (a `¿Español?` language switcher). Density across the
  // corpus is only ~3 per 1000 tokens, and English stopwords
  // decisively win the tally. Forcing Spanish on that basis
  // misclassifies the whole site.
  //
  // Override rule: force only when the corpus is glyph-dense AND
  // English stopwords do not decisively outscore Spanish stopwords
  // on their own (i.e. we're not overriding a clear English tally).
  const GLYPH_DENSITY_THRESHOLD_PER_1K = 5   // ~5 ñ per 1000 tokens
  const EN_DOMINANCE_MULT              = 3   // en >> es without glyphs
  const baseScores: Record<string, number> = { ...scores }
  const glyphCounts: Record<string, number> = {}
  if (text) {
    for (const [lang, re] of Object.entries(CHARACTER_SIGNALS)) {
      const matches = text.match(re)
      const n = matches ? matches.length : 0
      glyphCounts[lang] = n
      if (n > 0) scores[lang] = (scores[lang] ?? 0) + n * CHARACTER_SIGNAL_WEIGHT
    }
  }
  let forcedLanguage: string | null = null
  for (const [lang, n] of Object.entries(glyphCounts)) {
    if (n === 0 || tokens.length === 0) continue
    const density = (n / tokens.length) * 1000
    const enBase  = baseScores.en ?? 0
    const langBase = baseScores[lang] ?? 0
    const englishDecisive = lang !== 'en' && enBase > 0 && enBase > langBase * EN_DOMINANCE_MULT
    if (density >= GLYPH_DENSITY_THRESHOLD_PER_1K && !englishDecisive) {
      forcedLanguage = lang
    }
  }
  if (forcedLanguage) {
    return { language: forcedLanguage, scores, total_tokens: tokens.length }
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
