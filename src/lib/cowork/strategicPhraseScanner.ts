/**
 * Strategic-phrase scanner (Phase 3).
 *
 * The strategist's "inspirational sites" notes often carry strategic
 * intent embedded in casual language — e.g. "easy to access", "minimal",
 * "video-forward". The designer needs to see these as ASKS, not just
 * URLs to look at. This scanner pulls a closed taxonomy of phrases out
 * of the free-text value and returns them with their strategic
 * implication.
 *
 * Closed taxonomy keeps the scanner deterministic (no LLM) and
 * predictable for the designer. Adding a phrase = one entry below.
 */

export interface ScannedPhrase {
  /** The phrase literally found in the text (lowercased for matching, but
   *  rendered back in title case so the designer sees a clean label). */
  phrase:       string
  /** What the designer should DO when they see this. */
  implication:  string
  /** Where in the source text the phrase landed (1-indexed line, for
   *  display only — not for diffing). */
  source_line?: number
}

interface PhraseEntry {
  match:       string             // lowercase substring or regex source
  is_regex?:   boolean
  label:       string
  implication: string
}

const PHRASE_TAXONOMY: ReadonlyArray<PhraseEntry> = [
  { match: 'easy to access',    label: 'Easy to access',       implication: 'Surface every primary nav target ≤2 clicks from home; persistent CTAs for high-value actions.' },
  { match: 'easy to navigate',  label: 'Easy to navigate',     implication: 'Limit nav width; group children only where the hierarchy survives a 5-second scan.' },
  { match: 'clean',             label: 'Clean',                implication: 'White space discipline; minimum 1.4 line-height; no decorative borders unless they carry meaning.' },
  { match: 'minimal',           label: 'Minimal',              implication: 'Restrained color palette; type sets the tone. Avoid card stacks where the section can be a single hero.' },
  { match: 'modern',            label: 'Modern',               implication: 'Larger H1 scale; full-bleed photography; CTA chips over filled rectangles.' },
  { match: 'video',             label: 'Video-forward',        implication: 'Build at least one hero variant around an embedded video. Plan an asset bundle slot for it.' },
  { match: 'inspiring',         label: 'Inspiring',            implication: 'Lead each section with story or testimonial atom, then context — not the other way.' },
  { match: 'warm',              label: 'Warm',                 implication: 'Avoid pure white; tone with the brand secondary. Photography of faces over object stills.' },
  { match: 'sticky cta',        label: 'Sticky CTA',           implication: 'Persistent CTA dock in the footer or header — typically Plan a Visit or Give.' },
  { match: 'side',              label: 'Side rail',            implication: 'Build space for a side rail or sticky-side panel; talk to dev about z-index reservation early.' },
  { match: 'tab on the side',   label: 'Side tab',             implication: 'Edge-anchored persistent tab UI — coordinate with dev about scroll behavior + mobile fallback.' },
  { match: 'mobile',            label: 'Mobile-first',         implication: 'Designs reviewed at 375px first; desktop is the extension, not the canonical comp.' },
  { match: 'photo',             label: 'Photography-led',      implication: 'Build the visual story on photos before type. Asset bundle needs a photography slot.' },
  { match: 'simple',            label: 'Simple',               implication: 'Cut sections aggressively; each kept section must earn its placement.' },
  { match: 'clear',             label: 'Clear',                implication: 'Direct CTAs; explicit page purpose in the H1; no ambiguous secondary text.' },
]

/** Scan a multi-line free-text value (e.g. inspirational_websites)
 *  for strategic phrases. De-dupes per match key so "easy to access"
 *  appearing on lines 3 + 7 surfaces once. */
export function scanStrategicPhrases(text: string | null | undefined): ScannedPhrase[] {
  if (!text || typeof text !== 'string') return []
  const norm = text.toLowerCase()
  const lines = text.split('\n')
  const seen = new Set<string>()
  const out: ScannedPhrase[] = []
  for (const entry of PHRASE_TAXONOMY) {
    if (!norm.includes(entry.match)) continue
    if (seen.has(entry.label)) continue
    seen.add(entry.label)
    // Locate the line where the phrase first appears (for display).
    let lineNum: number | undefined
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(entry.match)) { lineNum = i + 1; break }
    }
    out.push({ phrase: entry.label, implication: entry.implication, source_line: lineNum })
  }
  return out
}

/** Extract URLs from a free-text value. Used by the Design Handoff
 *  to render the inspirational sites as clickable links alongside
 *  the scanned phrases. */
export function extractInspirationalUrls(text: string | null | undefined): string[] {
  if (!text || typeof text !== 'string') return []
  const urlRegex = /https?:\/\/[^\s)>,]+/gi
  const matches = text.match(urlRegex) ?? []
  const cleaned = matches.map(u => u.replace(/[).,;]+$/, ''))
  return Array.from(new Set(cleaned))
}
